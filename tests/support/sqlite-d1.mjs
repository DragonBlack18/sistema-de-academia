import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export function readMigrations(projectRoot){
 const journal=JSON.parse(readFileSync(path.join(projectRoot,'drizzle/meta/_journal.json'),'utf8'));
 return journal.entries.map(entry=>readFileSync(path.join(projectRoot,`drizzle/${entry.tag}.sql`),'utf8'));
}

/** Real SQLite with D1's atomic batch semantics; hooks model concurrent committed changes. */
export function createD1Harness(migrations=[]){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');for(const migration of migrations)sql.exec(migration);
 const hooks={beforeBatch:null,beforeRun:null,afterFirst:null};
 class Statement{
  constructor(text,args=[]){this.text=text;this.args=args;}
  bind(...args){return new Statement(this.text,args);}
  execute(){const statement=sql.prepare(this.text);if(/^\s*(SELECT|WITH|PRAGMA)/i.test(this.text))return{results:statement.all(...this.args),meta:{changes:0}};const result=statement.run(...this.args);return{results:[],meta:{changes:Number(result.changes)}};}
  async first(){const result=sql.prepare(this.text).get(...this.args)||null;hooks.afterFirst?.(this,result);return result;}
  async all(){return this.execute();}
  async run(){hooks.beforeRun?.(this);return this.execute();}
 }
 const db={prepare(text){return new Statement(text);},async batch(statements){hooks.beforeBatch?.(statements);sql.exec('BEGIN IMMEDIATE');try{const result=statements.map(statement=>statement.execute());sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}}};
 return{db,sql,hooks};
}
