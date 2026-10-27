import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {createD1Harness,readMigrations} from './support/sqlite-d1.mjs';

const projectRoot=fileURLToPath(new URL('../',import.meta.url));
const outputs=path.join(projectRoot,'outputs');mkdirSync(outputs,{recursive:true});
const compiled=mkdtempSync(path.join(outputs,'security-suite-'));
writeFileSync(path.join(compiled,'package.json'),'{"type":"commonjs"}\n');
for(const name of ['security','auth','users','mfa']){
 const source=readFileSync(path.join(projectRoot,`server/${name}.ts`),'utf8');
 writeFileSync(path.join(compiled,`${name}.js`),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText);
}
const require=createRequire(import.meta.url),security=require(path.join(compiled,'security.js')),auth=require(path.join(compiled,'auth.js'));
const {handleUsers}=require(path.join(compiled,'users.js')),{handleMfa}=require(path.join(compiled,'mfa.js'));
const migrations=readMigrations(projectRoot);
const results=[],startedAt=new Date().toISOString();
let database;
const harness=()=>createD1Harness(migrations);
const password='Verification-password-42!';
const hash=security.hashPassword(password);
const request=(route,body,method='POST',headers={})=>new Request(`https://vitality.test/api/${route}`,{method,headers:{'Content-Type':'application/json',Origin:'https://vitality.test',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
const denied=(status)=>error=>error instanceof security.ApiError&&error.status===status;
function account(h,id,role='super_admin',active=1){const now=security.timestamp();h.sql.prepare('INSERT INTO users(id,name,login,password_hash,role,active,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').run(id,id,`${id}@example.invalid`,hash,role,active,now,now);return actor(h,id);}
function actor(h,id){return auth.publicUser(h.sql.prepare('SELECT * FROM users WHERE id=?').get(id));}
function session(h,id,userId,age=0){const now=Date.now(),token=security.randomToken();h.sql.prepare('INSERT INTO sessions(id,user_id,token_hash,csrf_token,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?,?,?)').run(id,userId,security.digest(token),'csrf-test',new Date(now+auth.SESSION_ABSOLUTE_MS).toISOString(),new Date(now-age).toISOString(),new Date(now-age).toISOString());return{token,request:request('me',undefined,'GET',{Cookie:`vg_session=${token}`})};}
function context(h,id,sessionId){return{user:actor(h,id),sessionId,csrfToken:'csrf-test'};}
async function step(name,run){const start=Date.now();try{await run();results.push({name,status:'PASS',durationMs:Date.now()-start});console.log(`PASS ${name}`);}catch(error){results.push({name,status:'FAIL',error:error.message});throw error;}}
function freezeClock(value){const OriginalDate=Date;let instant=value;class ClockDate extends OriginalDate{constructor(...args){super(...(args.length?args:[instant]));}static now(){return instant;}}globalThis.Date=ClockDate;return{advance(ms){instant+=ms;},restore(){globalThis.Date=OriginalDate;}};}

try{
 await step('MIGRATION_PRESERVES_EXISTING_ACCOUNTS_AND_SESSION_AGE',async()=>{
  const old=new DatabaseSync(':memory:');old.exec('PRAGMA foreign_keys=ON');old.exec(migrations[0]);
  const stamp='2026-10-01T10:00:00.000Z';old.prepare("INSERT INTO users(id,name,login,password_hash,role,active,created_at,updated_at,version) VALUES('legacy','Legacy','legacy',?,'super_admin',1,?,?,1)").run(hash,stamp,stamp);
  old.prepare("INSERT INTO sessions(id,user_id,token_hash,csrf_token,expires_at,created_at) VALUES('legacy-session','legacy','legacy-token','csrf','2026-10-01T22:00:00.000Z',?)").run(stamp);
  for(const migration of migrations.slice(1))old.exec(migration);
  assert.equal(old.prepare("SELECT last_seen_at FROM sessions WHERE id='legacy-session'").get().last_seen_at,stamp);
  assert.equal(old.prepare("SELECT totp_last_counter FROM users WHERE id='legacy'").get().totp_last_counter,-1);
  assert.deepEqual(old.prepare('PRAGMA foreign_key_check').all(),[]);old.close();
 });
 database=harness();const h=database;account(h,'owner');
 await step('PASSWORD_HASH_FORMAT_SALT_AND_VERIFICATION',async()=>{
  assert.notEqual(hash,security.hashPassword(password));assert.equal(security.verifyPassword(password,hash),true);assert.equal(security.verifyPassword('wrong',hash),false);assert.equal(security.verifyPassword(password,`${hash}$extra`),false);
  assert.equal(security.verifyPassword(password,'scrypt$1048576$8$3$bad$bad'),false);assert.equal(security.verifyPassword('x'.repeat(257),hash),false);
 });
 await step('TOTP_RFC_VECTORS_AND_BOUNDED_TIME_WINDOW',async()=>{
  const secret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  for(const [seconds,expected] of [[59,'287082'],[1111111109,'081804'],[1111111111,'050471'],[1234567890,'005924'],[2000000000,'279037'],[20000000000,'353130']])assert.equal(security.totp(secret,seconds*1000),expected);
  const time=1_800_000_010_000,counter=Math.floor(time/30000);
  for(const delta of [-1,0,1])assert.equal(security.matchTotpCounter(secret,security.totp(secret,(counter+delta)*30000),time),counter+delta);
  assert.equal(security.matchTotpCounter(secret,security.totp(secret,(counter+2)*30000),time),null);assert.equal(security.matchTotpCounter(secret,'12345x',time),null);
 });
 await step('TOTP_ENCRYPTION_TAMPER_AND_CONFIGURATION_FAIL_CLOSED',async()=>{
  const secret=security.createTotpSecret(),key='1'.repeat(64),encrypted=security.encryptSecret(secret,key);
  assert.equal(security.decryptSecret(encrypted,key),secret);assert.notEqual(encrypted,security.encryptSecret(secret,key));
  assert.throws(()=>security.decryptSecret(encrypted,'2'.repeat(64)),denied(503));assert.throws(()=>security.decryptSecret('broken',key),denied(503));assert.throws(()=>security.decryptSecret(encrypted,''),denied(503));
  assert.throws(()=>security.encryptSecret(secret,'short'),denied(503));
 });
 await step('REQUEST_ORIGIN_CSRF_COOKIE_AND_JSON_BOUNDARIES',async()=>{
  security.requireOrigin(request('users',{}));assert.throws(()=>security.requireOrigin(request('users',{},'POST',{Origin:'https://attacker.invalid'})),denied(403));
  assert.throws(()=>security.requireOrigin(request('users',{},'POST',{'Sec-Fetch-Site':'cross-site'})),denied(403));
  auth.checkCsrf(request('users',{},'POST',{'X-CSRF-Token':'expected'}),'expected');assert.throws(()=>auth.checkCsrf(request('users',{}),'expected'),denied(403));assert.throws(()=>auth.checkCsrf(request('users',{}),''),denied(403));
  assert.equal(auth.sessionCookie(request('me',undefined,'GET',{Cookie:'vg_session=one; vg_session=two'})),'');
  await assert.rejects(security.bodyJson(request('users',{},'POST',{'Content-Type':'text/application/json'})),denied(415));await assert.rejects(security.bodyJson(request('users',[])),denied(400));
  let cancelled=false;const stream=new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(64*1024));},cancel(){cancelled=true;}});
  await assert.rejects(security.bodyJson(new Request('https://vitality.test/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:stream,duplex:'half'})),denied(413));assert.equal(cancelled,true);
  const response=security.secureResponse(Response.json({ok:true}),request('me',undefined,'GET'));assert.equal(response.headers.get('Cache-Control'),'no-store');assert.match(response.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);assert.match(auth.cookie('token',request('me',undefined,'GET')),/HttpOnly; SameSite=Strict; Max-Age=43200; Secure/);
 });
 await step('ATOMIC_RATE_LIMIT_HAS_NO_PARALLEL_OVERBOOKING',async()=>{
  const attempts=await Promise.allSettled(Array.from({length:30},()=>security.reserveAuthAttempt(h.db,{key:'test-concurrency',limit:12})));
  assert.equal(attempts.filter(result=>result.status==='fulfilled').length,12);for(const result of attempts.filter(result=>result.status==='rejected'))assert.equal(result.reason.status,429);
  assert.equal(h.sql.prepare("SELECT count(*) AS n FROM login_attempts WHERE login_key='test-concurrency'").get().n,12);
 });
 await step('RATE_LIMIT_IP_SCOPE_EXPIRY_AND_BOUNDED_CLEANUP',async()=>{
  for(let index=0;index<3;index++)await security.reserveAuthAttempt(h.db,{key:`account-${index}`,ipKey:'shared-ip',limit:12,ipLimit:3});
  await assert.rejects(security.reserveAuthAttempt(h.db,{key:'different-account',ipKey:'shared-ip',limit:12,ipLimit:3}),denied(429));
  h.sql.prepare("UPDATE login_attempts SET created_at=? WHERE ip_key='shared-ip'").run(new Date(Date.now()-16*60*1000).toISOString());await security.reserveAuthAttempt(h.db,{key:'different-account',ipKey:'shared-ip',limit:12,ipLimit:3});
  for(let index=0;index<300;index++)h.sql.prepare('INSERT INTO login_attempts(id,login_key,ip_key,created_at,success) VALUES(?,?,?,?,0)').run(`expired-${index}`,'expired','expired',new Date(Date.now()-25*60*60*1000).toISOString());
  await security.reserveAuthAttempt(h.db,{key:'cleanup-check'});assert.equal(h.sql.prepare("SELECT count(*) AS n FROM login_attempts WHERE login_key='expired'").get().n,44);
 });
 await step('LOGIN_ISSUES_OPAQUE_SESSION_WITHOUT_PRIVATE_FIELDS',async()=>{
  const result=await auth.signIn(request('login',{login:' OWNER@EXAMPLE.INVALID ',password}),h.db,{},{});assert.equal(result.status,200);
  const data=await result.json();for(const key of ['password_hash','totp_secret','totp_last_counter','session_id'])assert.equal(data.user[key],undefined);
  const token=result.headers.get('set-cookie').match(/^vg_session=([^;]+)/)[1];assert.equal(token.length,64);assert.equal(h.sql.prepare('SELECT count(*) AS n FROM sessions WHERE token_hash=?').get(token).n,0);assert.equal(h.sql.prepare('SELECT count(*) AS n FROM sessions WHERE token_hash=?').get(security.digest(token)).n,1);
  assert.equal((await auth.authenticate(request('me',undefined,'GET',{Cookie:`vg_session=${token}`}),h.db)).user.id,'owner');
  account(h,'inactive','reception',0);for(const login of ['missing@example.invalid','inactive@example.invalid'])await assert.rejects(auth.signIn(request('login',{login,password}),h.db,{},{}),error=>denied(401)(error)&&error.message==='Acesso ou senha incorretos.');
 });
 await step('IDLE_AND_ABSOLUTE_EXPIRATION_AND_ACTIVITY_TOUCH',async()=>{
  const clock=freezeClock(Date.now());try{
   const idle=session(h,'idle','owner',auth.SESSION_IDLE_MS);await assert.rejects(auth.authenticate(idle.request,h.db),denied(401));
   const active=session(h,'active','owner',2*60*1000);const before=h.sql.prepare("SELECT last_seen_at FROM sessions WHERE id='active'").get().last_seen_at;
   await auth.authenticate(active.request,h.db);assert.ok(h.sql.prepare("SELECT last_seen_at FROM sessions WHERE id='active'").get().last_seen_at>before);
   const expired=session(h,'absolute','owner');h.sql.prepare("UPDATE sessions SET expires_at=? WHERE id='absolute'").run(new Date(Date.now()).toISOString());await assert.rejects(auth.authenticate(expired.request,h.db),denied(401));
   const delayed=session(h,'delayed','owner',29*60*1000);h.hooks.afterFirst=(query)=>{if(query.text.startsWith('SELECT u.*')){h.hooks.afterFirst=null;clock.advance(2*60*1000);}};await assert.rejects(auth.authenticate(delayed.request,h.db),denied(401));
  }finally{h.hooks.afterFirst=null;clock.restore();}
 });
 await step('SESSION_TOUCH_CANNOT_REVIVE_REVOKED_SESSION',async()=>{
  const current=session(h,'revoked-during-touch','owner',2*60*1000);h.hooks.beforeRun=(query)=>{if(query.text.startsWith('UPDATE sessions SET last_seen_at')){h.hooks.beforeRun=null;h.sql.prepare("DELETE FROM sessions WHERE id='revoked-during-touch'").run();}};
  await assert.rejects(auth.authenticate(current.request,h.db),denied(401));assert.equal(h.sql.prepare("SELECT count(*) AS n FROM sessions WHERE id='revoked-during-touch'").get().n,0);
 });
 await step('STALE_PASSWORD_CANNOT_CREATE_SESSION_AFTER_RESET',async()=>{
  account(h,'password-race','reception');const newer=security.hashPassword('Different-password-42!');
  h.hooks.beforeBatch=(queries)=>{if(queries.some(query=>query.text.startsWith('INSERT INTO sessions'))){h.hooks.beforeBatch=null;h.sql.prepare("UPDATE users SET password_hash=?,version=version+1 WHERE id='password-race'").run(newer);}};
  await assert.rejects(auth.signIn(request('login',{login:'password-race@example.invalid',password}),h.db,{},{}),denied(409));assert.equal(h.sql.prepare("SELECT count(*) AS n FROM sessions WHERE user_id='password-race'").get().n,0);
 });
 await step('MFA_SINGLE_USE_CONCURRENT_LOGIN_AND_DISABLE',async()=>{
  const clock=freezeClock(Date.now()),key='3'.repeat(64);try{
   account(h,'mfa-user','admin');session(h,'mfa-primary','mfa-user');const other=session(h,'mfa-old','mfa-user');
   const enrollment=await (await handleMfa(request('mfa/setup',{password}),h.db,{TOTP_ENCRYPTION_KEY:key},context(h,'mfa-user','mfa-primary'))).json();
   const counter=Math.floor(Date.now()/30000),code=delta=>security.totp(enrollment.secret,(counter+delta)*30000);
   await handleMfa(request('mfa/enable',{code:code(-1)}),h.db,{TOTP_ENCRYPTION_KEY:key},context(h,'mfa-user','mfa-primary'));
   await assert.rejects(auth.authenticate(other.request,h.db),denied(401));
   await assert.rejects(auth.signIn(request('login',{login:'mfa-user@example.invalid',password,otp:code(-1)}),h.db,{TOTP_ENCRYPTION_KEY:key},{}),denied(401));
   const race=await Promise.allSettled([1,2].map(()=>auth.signIn(request('login',{login:'mfa-user@example.invalid',password,otp:code(0)}),h.db,{TOTP_ENCRYPTION_KEY:key},{})));
   assert.equal(race.filter(result=>result.status==='fulfilled').length,1);assert.equal(race.find(result=>result.status==='rejected').reason.status,409);
   const signed=race.find(result=>result.status==='fulfilled').value,token=signed.headers.get('set-cookie').match(/^vg_session=([^;]+)/)[1],signedAuth=await auth.authenticate(request('me',undefined,'GET',{Cookie:`vg_session=${token}`}),h.db);
   await assert.rejects(handleMfa(request('mfa/disable',{password,code:code(0)}),h.db,{TOTP_ENCRYPTION_KEY:key},signedAuth),denied(400));
   await assert.rejects(handleMfa(request('mfa/disable',{password:'wrong',code:code(1)}),h.db,{TOTP_ENCRYPTION_KEY:key},signedAuth),denied(403));
   await handleMfa(request('mfa/disable',{password,code:code(1)}),h.db,{TOTP_ENCRYPTION_KEY:key},signedAuth);
   const row=h.sql.prepare("SELECT * FROM users WHERE id='mfa-user'").get();assert.equal(row.totp_enabled,0);assert.equal(row.totp_secret,null);assert.equal(h.sql.prepare("SELECT count(*) AS n FROM sessions WHERE user_id='mfa-user'").get().n,1);
   assert.equal(JSON.stringify(h.sql.prepare('SELECT * FROM audit_logs').all()).includes(enrollment.secret),false);
  }finally{clock.restore();}
 });
 await step('MFA_MISSING_OR_CORRUPTED_KEY_FAILS_WITH_SERVICE_ERROR',async()=>{
  account(h,'mfa-key','reception');const secret=security.createTotpSecret();h.sql.prepare("UPDATE users SET totp_enabled=1,totp_secret=? WHERE id='mfa-key'").run(security.encryptSecret(secret,'4'.repeat(64)));
  await assert.rejects(auth.signIn(request('login',{login:'mfa-key@example.invalid',password,otp:security.totp(secret)}),h.db,{},{}),denied(503));
  await assert.rejects(auth.signIn(request('login',{login:'mfa-key@example.invalid',password,otp:security.totp(secret)}),h.db,{TOTP_ENCRYPTION_KEY:'5'.repeat(64)},{}),denied(503));
 });
 await step('PASSWORD_REAUTH_LIMIT_AND_ALL_SESSION_REVOCATION',async()=>{
  const changing=account(h,'changing','reception');session(h,'changing-one','changing');session(h,'changing-two','changing');
  for(let index=0;index<10;index++)await assert.rejects(auth.changePassword(request('password',{currentPassword:'wrong',newPassword:'New-password-42!'}),h.db,changing),denied(403));
  await assert.rejects(auth.changePassword(request('password',{currentPassword:password,newPassword:'New-password-42!'}),h.db,changing),denied(429));
  h.sql.prepare("UPDATE login_attempts SET created_at=? WHERE login_key='password-change:changing'").run(new Date(Date.now()-16*60*1000).toISOString());
  const changed=await auth.changePassword(request('password',{currentPassword:password,newPassword:'New-password-42!'}),h.db,changing);assert.match(changed.headers.get('set-cookie'),/Max-Age=0/);assert.equal(h.sql.prepare("SELECT count(*) AS n FROM sessions WHERE user_id='changing'").get().n,0);assert.equal(security.verifyPassword('New-password-42!',h.sql.prepare("SELECT password_hash FROM users WHERE id='changing'").get().password_hash),true);
 });
 await step('MFA_SETUP_PASSWORD_GUESSING_IS_RATE_LIMITED',async()=>{
  account(h,'mfa-rate','reception');session(h,'mfa-rate-session','mfa-rate');const access=context(h,'mfa-rate','mfa-rate-session');
  for(let index=0;index<10;index++)await assert.rejects(handleMfa(request('mfa/setup',{password:'wrong'}),h.db,{TOTP_ENCRYPTION_KEY:'6'.repeat(64)},access),denied(403));
  await assert.rejects(handleMfa(request('mfa/setup',{password}),h.db,{TOTP_ENCRYPTION_KEY:'6'.repeat(64)},access),denied(429));
  assert.equal(h.sql.prepare("SELECT totp_secret FROM users WHERE id='mfa-rate'").get().totp_secret,null);
 });
 await step('CONCURRENT_PASSWORD_RESET_PRESERVES_NEWER_CREDENTIAL',async()=>{
  const access=account(h,'password-change-race','reception'),newer=security.hashPassword('Administrative-reset-42!');
  h.hooks.beforeBatch=(queries)=>{if(queries.some(query=>query.text.startsWith('UPDATE users SET password_hash'))){h.hooks.beforeBatch=null;h.sql.prepare("UPDATE users SET password_hash=?,version=version+1 WHERE id='password-change-race'").run(newer);}};
  await assert.rejects(auth.changePassword(request('password',{currentPassword:password,newPassword:'Rejected-password-42!'}),h.db,access),denied(409));
  assert.equal(h.sql.prepare("SELECT password_hash FROM users WHERE id='password-change-race'").get().password_hash,newer);
 });
 await step('USER_ROUTE_PAGINATION_AND_ROLE_BOUNDARIES',async()=>{
  const owner=actor(h,'owner'),admin=account(h,'admin','admin');
  for(const route of ['usersxxx','users/owner/extra'])await assert.rejects(handleUsers(request(route,undefined,'GET'),new URL(`https://vitality.test/api/${route}`),h.db,owner),denied(404));
  await assert.rejects(handleUsers(request('users?pageSize=999',undefined,'GET'),new URL('https://vitality.test/api/users?pageSize=999'),h.db,owner),denied(400));
  await assert.rejects(handleUsers(request('users',{name:'Forbidden',login:'forbidden',password,role:'super_admin'}),new URL('https://vitality.test/api/users'),h.db,admin),denied(403));
  await assert.rejects(handleUsers(request('users/owner',{version:owner.version,active:false},'PATCH'),new URL('https://vitality.test/api/users/owner'),h.db,owner),denied(400));
  await assert.rejects(handleUsers(request('users/owner',{version:owner.version,password:'New-password-42!'},'PATCH'),new URL('https://vitality.test/api/users/owner'),h.db,owner),denied(403));
  for(const query of ['%',"_';SELECT",'Á'.repeat(100)]){const route=`users?q=${encodeURIComponent(query)}`;const listed=await (await handleUsers(request(route,undefined,'GET'),new URL(`https://vitality.test/api/${route}`),h.db,owner)).json();assert.equal(listed.total,0);}
  assert.equal(auth.can({...owner,active:false},'users.write'),false);const copied=auth.rolePermissions('admin');copied.push('*');assert.equal(auth.rolePermissions('admin').includes('*'),false);
 });
 await step('STALE_ADMIN_CANNOT_CREATE_ACCOUNT_AFTER_DEMOTION',async()=>{
  const stale=account(h,'stale-admin','admin');
  h.hooks.beforeBatch=(queries)=>{if(queries.some(query=>query.text.startsWith('INSERT INTO users'))){h.hooks.beforeBatch=null;h.sql.prepare("UPDATE users SET role='reception',version=version+1 WHERE id='stale-admin'").run();}};
  await assert.rejects(handleUsers(request('users',{name:'Should rollback',login:'rollback-account',password,role:'reception'}),new URL('https://vitality.test/api/users'),h.db,stale),denied(409));assert.equal(h.sql.prepare("SELECT count(*) AS n FROM users WHERE login='rollback-account'").get().n,0);
 });
 await step('LOGOUT_OR_EXPIRY_BEFORE_COMMIT_BLOCKS_AUTHENTICATED_MUTATION',async()=>{
  account(h,'logout-race','admin');
  for(const mode of ['logout','expiry','idle']){
   const sessionId=`logout-race-${mode}`,current=session(h,sessionId,'logout-race'),access=await auth.authenticate(current.request,h.db);
   assert.equal(Object.hasOwn(access.user,'sessionId'),false);
   h.hooks.beforeBatch=(queries)=>{if(queries.some(query=>query.text.startsWith('INSERT INTO users'))){h.hooks.beforeBatch=null;if(mode==='logout')h.sql.prepare('DELETE FROM sessions WHERE id=?').run(sessionId);else h.sql.prepare(`UPDATE sessions SET ${mode==='expiry'?'expires_at':'last_seen_at'}=? WHERE id=?`).run(new Date(Date.now()-(mode==='expiry'?1000:31*60*1000)).toISOString(),sessionId);}};
   await assert.rejects(handleUsers(request('users',{name:'No stale session',login:`rejected-${mode}`,password,role:'reception'}),new URL('https://vitality.test/api/users'),h.db,access.user),denied(409));
   assert.equal(h.sql.prepare('SELECT count(*) AS n FROM users WHERE login=?').get(`rejected-${mode}`).n,0);
  }
 });
 await step('CONCURRENT_OWNER_DEMOTION_PRESERVES_ACTIVE_OWNER',async()=>{
  const isolated=harness();try{
   const left=account(isolated,'left'),right=account(isolated,'right');
   const operations=await Promise.allSettled([[left,right],[right,left]].map(([actor,target])=>handleUsers(request(`users/${target.id}`,{version:target.version,role:'reception'},'PATCH'),new URL(`https://vitality.test/api/users/${target.id}`),isolated.db,actor)));
   assert.equal(operations.filter(result=>result.status==='fulfilled').length,1);assert.equal(operations.find(result=>result.status==='rejected').reason.status,409);assert.equal(isolated.sql.prepare("SELECT count(*) AS n FROM users WHERE role='super_admin' AND active=1").get().n,1);
  }finally{isolated.sql.close();}
 });
 await step('INTEGRITY_AND_GUARDS_REMAIN_CLEAN',async()=>{assert.deepEqual(h.sql.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(h.sql.prepare('SELECT count(*) AS n FROM transaction_guards').get().n,0);});
}catch(error){console.error(error);process.exitCode=1;}finally{
 database?.sql.close();rmSync(compiled,{recursive:true,force:true});
 const report={status:process.exitCode?'FAIL':'PASS',startedAt,finishedAt:new Date().toISOString(),passed:results.filter(result=>result.status==='PASS').length,failed:results.filter(result=>result.status==='FAIL').length,results};
 writeFileSync(path.join(outputs,'security-hardening-report.json'),`${JSON.stringify(report,null,2)}\n`);console.log(`${report.status}: ${report.passed} security gates passed, ${report.failed} failed.`);
}
