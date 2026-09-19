// Maintenance only: stop traffic, back up DB and existing keys before running.
import {getDb,transaction} from '../server/db.js';
import * as sec from '../server/security.js';
const db=getDb();
try{
 const oldEncryption=process.env.ID_ENCRYPTION_KEY,oldLookup=process.env.ID_LOOKUP_KEY;
 const nextEncryption=process.env.NEW_ID_ENCRYPTION_KEY,nextLookup=process.env.NEW_ID_LOOKUP_KEY;
 if(Buffer.from(nextEncryption||'','base64').length!==32||Buffer.from(nextLookup||'','base64').length!==32)throw new Error('새 키 2개가 필요합니다.');
 await transaction(db,async c=>{
  await c.query('LOCK TABLE users, sessions, reset_tokens, rate_limits IN ACCESS EXCLUSIVE MODE');
  const rows=(await c.query('SELECT id,login_cipher FROM users')).rows;
  for(const row of rows){
   process.env.ID_ENCRYPTION_KEY=oldEncryption;process.env.ID_LOOKUP_KEY=oldLookup;
   const login=sec.decrypt(row.login_cipher);
   process.env.ID_ENCRYPTION_KEY=nextEncryption;process.env.ID_LOOKUP_KEY=nextLookup;
   await c.query('UPDATE users SET login_cipher=$1,login_lookup=$2 WHERE id=$3',[sec.encrypt(login),sec.lookup(login),row.id]);
  }
  await c.query('DELETE FROM sessions');await c.query('DELETE FROM reset_tokens');await c.query('DELETE FROM rate_limits');
 });
 console.log('키 교체 완료. 서버의 ID_ENCRYPTION_KEY/ID_LOOKUP_KEY를 새 값으로 변경한 뒤 서비스를 재개하세요.');
}catch(e){console.error(e.code?'키 교체 실패: '+e.code:e.message);process.exitCode=1;}
finally{await db.end();}
