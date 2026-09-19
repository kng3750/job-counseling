import * as sec from './security.js';
export async function inspectReadiness(db) {
 const checks={};
 for(const name of ['ID_ENCRYPTION_KEY','ID_LOOKUP_KEY']){
  const value=process.env[name]||'';
  checks[name]=Buffer.from(value,'base64').length===32 && Buffer.from(value,'base64').toString('base64')===value;
 }
 checks.independentKeys=process.env.ID_ENCRYPTION_KEY!==process.env.ID_LOOKUP_KEY;
 try { const u=new URL(process.env.APP_ORIGIN); checks.origin=u.protocol==='https:'&&u.origin===process.env.APP_ORIGIN; } catch {checks.origin=false;}
 checks.geminiKey=!!process.env.GEMINI_API_KEY?.trim();
 checks.databaseUrl=!!process.env.DATABASE_URL;
 if(checks.ID_ENCRYPTION_KEY&&checks.ID_LOOKUP_KEY){
  try{checks.cryptoRoundtrip=sec.decrypt(sec.encrypt('readiness-check'))==='readiness-check'&&sec.lookup('readiness-check').length===64;}catch{checks.cryptoRoundtrip=false;}
 }
 try{
  await db.query('SELECT id,login_cipher,login_lookup,password_hash,name,role,status,created_at,approved_at,approved_by FROM users LIMIT 0');
  await db.query('SELECT token_hash,user_id,created_at,last_seen,expires_at FROM sessions LIMIT 0');
  await db.query('SELECT token_hash,user_id,expires_at FROM reset_tokens LIMIT 0');
  await db.query('SELECT id,actor_id,target_id,action,created_at FROM audit_logs LIMIT 0');
  await db.query('SELECT key,count,expires_at FROM rate_limits LIMIT 0');
  checks.databaseSchema=true;
 }catch(e){checks.databaseSchema=false;console.error('Readiness database:',e.code||e.name);}
 return checks;
}
