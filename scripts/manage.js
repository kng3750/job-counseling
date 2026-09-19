import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline/promises';
import {getDb,transaction} from '../server/db.js';
import * as sec from '../server/security.js';
async function ask(question,secret=false){
 if(!secret){const r=createInterface({input:process.stdin,output:process.stdout});try{return await r.question(question);}finally{r.close();}}
 if(!process.stdin.isTTY)throw new Error('비밀번호는 대화형 터미널에서 입력해 주세요.');
 process.stdout.write(question);process.stdin.setRawMode(true);process.stdin.resume();
 return new Promise((resolve,reject)=>{
  let value='';
  const done=()=>{process.stdin.setRawMode(false);process.stdin.pause();process.stdin.off('data',data);process.stdout.write('\n');};
  function data(chunk){for(const c of chunk.toString('utf8')){
   if(c==='\r'||c==='\n'){done();resolve(value);return;}
   if(c==='\u0003'){done();reject(new Error('취소했습니다.'));return;}
   if(c==='\u007f'||c==='\b')value=[...value].slice(0,-1).join('');else if(c>=' ')value+=c;
  }}
  process.stdin.on('data',data);
 });
}
const db=getDb();
try{
 const command=process.argv[2];
 if(command==='migrate'){
  await db.query(await readFile(new URL('../server/schema.sql',import.meta.url),'utf8'));await db.query(await readFile(new URL('../server/sso-schema.sql',import.meta.url),'utf8'));console.log('DB 스키마 적용 완료');
 }else if(command==='create-admin'){
  const login=sec.normalizeId(await ask('관리자 아이디: '));
  const name=(await ask('관리자 이름: ')).trim();if(!name||name.length>80)throw new Error('이름은 1~80자입니다.');
  const password=sec.validPassword(await ask('비밀번호 (15~128자, 입력 숨김): ',true));
  if(password!==await ask('비밀번호 확인: ',true))throw new Error('비밀번호가 일치하지 않습니다.');
  await db.query("INSERT INTO users(id,login_cipher,login_lookup,password_hash,name,role,status,approved_at) VALUES($1,$2,$3,$4,$5,'admin','approved',now())",
   [randomUUID(),sec.encrypt(login),sec.lookup(login),await sec.hashPassword(password),name]);
  console.log('관리자 생성 완료');
 }else if(command==='reset-admin'){
  const login=sec.normalizeId(await ask('복구할 관리자 아이디: '));
  const password=sec.validPassword(await ask('새 비밀번호 (입력 숨김): ',true));
  if(password!==await ask('비밀번호 확인: ',true))throw new Error('비밀번호가 일치하지 않습니다.');
  const hashed=await sec.hashPassword(password);
  await transaction(db,async c=>{
   const user=(await c.query("SELECT id FROM users WHERE login_lookup=$1 AND role='admin' FOR UPDATE",[sec.lookup(login)])).rows[0];
   if(!user)throw new Error('관리자를 찾을 수 없습니다.');
   await c.query("UPDATE users SET password_hash=$1,status='approved' WHERE id=$2",[hashed,user.id]);
   await c.query('DELETE FROM sessions WHERE user_id=$1',[user.id]);
   await c.query('DELETE FROM reset_tokens WHERE user_id=$1',[user.id]);
   await c.query("INSERT INTO audit_logs(target_id,action) VALUES($1,'admin-recovery')",[user.id]);
  });console.log('관리자 복구 완료');
 }else if(command==='cleanup'){
  await db.query("DELETE FROM sessions WHERE expires_at<now() OR last_seen<now()-interval '30 minutes'");
  await db.query('DELETE FROM reset_tokens WHERE expires_at<now()');
  await db.query('DELETE FROM sso_codes WHERE expires_at<now()');
  await db.query('DELETE FROM service_sessions WHERE expires_at<now()');
  await db.query('DELETE FROM rate_limits WHERE expires_at<now()');console.log('만료 데이터 정리 완료');
 }else throw new Error('명령: migrate | create-admin | reset-admin | cleanup');
}catch(e){console.error(e.code==='23505'?'이미 사용 중인 아이디입니다.':e.code?'DB 작업 실패: '+e.code:e.message);process.exitCode=1;}
finally{await db.end();}

