import { randomBytes, createHash, scryptSync, timingSafeEqual, createHmac, createCipheriv, createDecipheriv } from 'node:crypto';

export class ApiError extends Error {
  constructor(public status: number, message: string, public fields?: Record<string,string>) { super(message); }
}
export const uuid = () => crypto.randomUUID();
export const timestamp = () => new Date().toISOString();
export const randomToken = () => randomBytes(32).toString('hex');
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const json = (value: unknown, status = 200, headers: HeadersInit = {}) => Response.json(value, {status, headers});
export function safeEqual(a: string,b: string) {
  const left=Buffer.from(a); const right=Buffer.from(b);
  return left.length===right.length && timingSafeEqual(left,right);
}
export function hashPassword(password: string) {
  const salt=randomBytes(16); const hash=scryptSync(password,salt,64,{N:32768,r:8,p:3,maxmem:64*1024*1024});
  return ['scrypt',32768,8,3,salt.toString('base64'),hash.toString('base64')].join('$');
}
export function verifyPassword(password:string, stored:string) {
  try {
    const [algorithm,n,r,p,salt,hash]=stored.split('$');
    if(password.length>256||stored.split('$').length!==6||algorithm!=='scrypt'||Number(n)!==32768||Number(r)!==8||Number(p)!==3) return false;
    if(Buffer.from(salt,'base64').length!==16||Buffer.from(hash,'base64').length!==64)return false;
    const derived=scryptSync(password,Buffer.from(salt,'base64'),64,{N:32768,r:8,p:3,maxmem:64*1024*1024});
    const expected=Buffer.from(hash,'base64');return derived.length===expected.length && timingSafeEqual(derived,expected);
  } catch {return false;}
}
export async function readBodyBytes(request:Request,max:number):Promise<Uint8Array<ArrayBuffer>> {
  if(Number(request.headers.get('content-length')||0)>max)throw new ApiError(413,'O conteúdo excede o limite permitido.');
  const reader=request.body?.getReader();if(!reader)return new Uint8Array();
  let size=0;const chunks:Uint8Array[]=[];
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw new ApiError(413,'O conteúdo excede o limite permitido.');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;
}
export async function bodyJson(request:Request,max=256*1024):Promise<Record<string,unknown>> {
  if(request.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase()!=='application/json') throw new ApiError(415,'Envie os dados em JSON.');
  const text=new TextDecoder().decode(await readBodyBytes(request,max));
  try {const value=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))throw 0;return value;}catch{throw new ApiError(400,'O conteúdo enviado não é um objeto JSON válido.');}
}
export async function guardedAuthWrite(db:D1Database,predicate:string,values:unknown[],queries:D1PreparedStatement[]) {
  const guard=uuid();
  try{return await db.batch([db.prepare(`INSERT INTO transaction_guards(id,ok) VALUES (?,CASE WHEN (${predicate}) THEN 1 ELSE 0 END)`).bind(guard,...values),...queries,db.prepare('DELETE FROM transaction_guards WHERE id=?').bind(guard)]);}
  catch(error){if(String(error).includes('transaction_guard'))throw new ApiError(409,'A conta foi alterada durante esta operação. Entre novamente e tente outra vez.');throw error;}
}
export function requireOrigin(request:Request) {
  const origin=request.headers.get('origin');const url=new URL(request.url);
  if(!origin||origin!==url.origin) throw new ApiError(403,'Origem da solicitação não autorizada. Recarregue a página.');
  const fetchSite=request.headers.get('sec-fetch-site');if(fetchSite==='cross-site')throw new ApiError(403,'Solicitação externa bloqueada.');
}
export function secureResponse(response:Response,request:Request) {
  const headers=new Headers(response.headers);
  headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','same-origin');
  headers.set('Cache-Control','no-store');headers.set('X-Frame-Options','DENY');
  headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  if(!headers.has('Content-Security-Policy'))headers.set('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  if(new URL(request.url).protocol==='https:') headers.set('Strict-Transport-Security','max-age=31536000');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function createTotpSecret(){const bytes=randomBytes(20);let bits=0,value=0,result='';for(const b of bytes){value=(value<<8)|b;bits+=8;while(bits>=5){result+=alphabet[(value>>>(bits-5))&31];bits-=5;}}return result;}
function decodeBase32(secret:string){let value=0,bits=0;const bytes=[];for(const char of secret.replace(/=|\s/g,'').toUpperCase()){const index=alphabet.indexOf(char);if(index<0)throw new Error('Invalid base32');value=(value<<5)|index;bits+=5;if(bits>=8){bytes.push((value>>>(bits-8))&255);bits-=8;}}return Buffer.from(bytes);}
export function totp(secret:string, time=Date.now()){const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(time/30000)));const hmac=createHmac('sha1',decodeBase32(secret)).update(counter).digest();const offset=hmac[hmac.length-1]&15;return String((hmac.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');}
/** Returns the counter so callers can consume it in the same transaction as the action. */
export function matchTotpCounter(secret:string,code:string,time=Date.now()):number|null {
  if(!/^[A-Z2-7]{32}$/.test(secret)||!/^\d{6}$/.test(code))return null;
  const counter=Math.floor(time/30000);
  // Prefer the highest matching counter in the unlikely event of a six-digit collision.
  for(const delta of [1,0,-1])if(counter+delta>=0&&safeEqual(totp(secret,(counter+delta)*30000),code))return counter+delta;
  return null;
}
export function verifyTotp(secret:string,code:string){return matchTotpCounter(secret,code)!==null;}
function requireEncryptionKey(key:string){if(key.length<32)throw new ApiError(503,'O autenticador está indisponível. Peça ao responsável para verificar a configuração do servidor.');}
export function encryptSecret(value:string,key:string){requireEncryptionKey(key);const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',createHash('sha256').update(key).digest(),iv);const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return [iv.toString('base64'),cipher.getAuthTag().toString('base64'),encrypted.toString('base64')].join('.');}
export function decryptSecret(value:string,key:string){
  requireEncryptionKey(key);
  try{
    const parts=value.split('.');if(parts.length!==3)throw new Error('Invalid encrypted value');
    const [iv,tag,payload]=parts.map(part=>Buffer.from(part,'base64'));
    if(iv.length!==12||tag.length!==16||payload.length!==32)throw new Error('Invalid encrypted value');
    const cipher=createDecipheriv('aes-256-gcm',createHash('sha256').update(key).digest(),iv);cipher.setAuthTag(tag);
    const secret=Buffer.concat([cipher.update(payload),cipher.final()]).toString('utf8');
    if(!/^[A-Z2-7]{32}$/.test(secret))throw new Error('Invalid secret');
    return secret;
  }catch{throw new ApiError(503,'O autenticador está indisponível. Peça ao responsável para verificar a configuração do servidor.');}
}

type AttemptOptions={key:string;ipKey?:string;limit?:number;ipLimit?:number;message?:string};
/** Reserve the attempt atomically before expensive password/OTP verification. */
export async function reserveAuthAttempt(db:D1Database,{key,ipKey=key,limit=10,ipLimit=limit,message='Muitas tentativas. Aguarde 15 minutos antes de tentar novamente.'}:AttemptOptions){
  const id=uuid(),now=timestamp(),since=new Date(Date.now()-15*60*1000).toISOString();
  const results=await db.batch([
    // Bounded retention also runs for failed attempts, not only successful sign-ins.
    db.prepare('DELETE FROM login_attempts WHERE id IN (SELECT id FROM login_attempts WHERE created_at<? ORDER BY created_at LIMIT 256)').bind(new Date(Date.now()-24*60*60*1000).toISOString()),
    db.prepare('INSERT INTO login_attempts (id,login_key,ip_key,created_at,success) SELECT ?,?,?,?,0 WHERE (SELECT count(*) FROM login_attempts WHERE login_key=? AND created_at>? AND success=0)<? AND (SELECT count(*) FROM login_attempts WHERE ip_key=? AND created_at>? AND success=0)<?').bind(id,key,ipKey,now,key,since,limit,ipKey,since,ipLimit)
  ]);
  if(results[1].meta.changes!==1)throw new ApiError(429,message);
  return id;
}
