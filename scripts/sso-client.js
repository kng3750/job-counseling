import {getDb,transaction} from '../server/db.js';
import {digest} from '../server/security.js';
const db=getDb();
try{
 const id=process.env.SSO_CLIENT_ID||'job-star',uri=process.env.SSO_REDIRECT_URI,secret=process.env.SSO_CLIENT_SECRET;
 if(!/^[a-z0-9-]{3,60}$/.test(id)||!secret||secret.length<43)throw new Error('SSO_CLIENT_ID/SSO_CLIENT_SECRET 설정을 확인하세요.');
 const url=new URL(uri);
 if(url.username||url.password||url.hash||url.search||url.pathname!=='/auth/callback'||
  (url.protocol!=='https:'&&!(process.env.NODE_ENV!=='production'&&url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname))))throw new Error('등록할 콜백 URL이 올바르지 않습니다.');
 await transaction(db,async c=>{
  await c.query('INSERT INTO sso_clients(id,secret_hash,redirect_uri) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET secret_hash=excluded.secret_hash,redirect_uri=excluded.redirect_uri,enabled=true',[id,digest(secret),uri]);
  await c.query('DELETE FROM sso_codes WHERE client_id=$1',[id]);
  await c.query('DELETE FROM service_sessions WHERE client_id=$1',[id]);
 });
 console.log('SSO 클라이언트 등록/갱신 완료. 이전 Job Star 세션은 폐기되었습니다.');
}catch(e){console.error(e.code?'클라이언트 등록 실패: '+e.code:e.message);process.exitCode=1;}finally{await db.end();}

