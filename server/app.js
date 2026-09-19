import express from 'express';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {getDb,transaction} from './db.js';
import * as sec from './security.js';
import generate from './generate.js';
import {inspectReadiness} from './readiness.js';
const privateDir=fileURLToPath(new URL('../private/',import.meta.url));
const publicDir=fileURLToPath(new URL('../public/',import.meta.url));
const fail=(status,message)=>Object.assign(new Error(message),{status});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let dummy;
export function createApp({db:injectedDb,generator=generate}={}) {
 const app=express(); app.disable('x-powered-by');
 app.use((req,res,next)=>{
  res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY',
   'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});
  if(process.env.NODE_ENV==='production')res.set('Strict-Transport-Security','max-age=31536000');
  next();
 });
 app.use(express.json({limit:'16kb'}));
 app.use('/api',(req,res,next)=>{
  if(!['GET','HEAD'].includes(req.method)) {
   const origin=process.env.APP_ORIGIN;
   if(!origin) return next(fail(503,'서버 설정이 필요합니다.'));
   if(req.headers.origin!==origin) return next(fail(403,'허용되지 않은 요청입니다.'));
   if(!req.is('application/json'))return next(fail(415,'JSON 요청이 필요합니다.'));
  }
  next();
 });
 const db=()=>injectedDb||getDb();
 let readinessPromise,readinessUntil=0;
 app.get('/api/health',async(req,res)=>{
  if(Date.now()>readinessUntil){
   readinessUntil=Date.now()+60000;
   readinessPromise=(async()=>{
    const checks=await inspectReadiness(db());
    const failed=Object.entries(checks).filter(([,ok])=>!ok).map(([name])=>name);
    if(failed.length)console.error('Readiness failed:',failed.join(','));
    return failed.length===0;
   })().catch(e=>{console.error('Readiness failed:',e.code||e.name);return false;});
  }
  const ok=await readinessPromise;
  res.status(ok?200:503).json({status:ok?'ok':'unavailable'});
 });
 async function limit(req,scope,maximum,seconds,identity='') {
  // Only Vercel's overwritten header is trusted in production. Local requests use the socket.
  const ip=process.env.VERCEL ? req.headers['x-vercel-forwarded-for'] : req.socket.remoteAddress;
  const key=sec.lookup(scope+':'+(identity||ip||'unknown'));
  const result=await db().query(`INSERT INTO rate_limits(key,count,expires_at) VALUES($1,1,now()+$2*interval '1 second')
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.expires_at<=now() THEN 1 ELSE rate_limits.count+1 END,
    expires_at=CASE WHEN rate_limits.expires_at<=now() THEN excluded.expires_at ELSE rate_limits.expires_at END RETURNING count`,[key,seconds]);
  if(result.rows[0].count>maximum) throw fail(429,'요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.');
 }
 async function authenticate(req,res,next) {
  try {
   const t=sec.cookieToken(req); if(!/^[A-Za-z0-9_-]{43}$/.test(t))throw fail(401,'로그인이 필요합니다.');
   const r=await db().query(`UPDATE sessions SET last_seen=now() FROM users
    WHERE sessions.token_hash=$1 AND users.id=sessions.user_id AND users.status='approved'
    AND sessions.expires_at>now() AND sessions.last_seen>now()-interval '30 minutes'
    RETURNING users.*, sessions.token_hash`,[sec.digest(t)]);
   if(!r.rows.length) {sec.setSession(res,'');throw fail(401,'로그인이 만료되었거나 이용 승인이 해제되었습니다.');}
   req.user=r.rows[0]; req.sessionToken=t;
   if(!['GET','HEAD'].includes(req.method)&&!sec.equal(req.headers['x-csrf-token'],sec.csrf(t)))throw fail(403,'요청 인증에 실패했습니다. 페이지를 새로고침해 주세요.');
   next();
  } catch(e) {
   if(e.status===401&&!req.path.startsWith('/api/'))return res.redirect('/login');
   next(e);
  }
 }
 const admin=(req,res,next)=>req.user.role==='admin'?next():next(fail(403,'관리자만 이용할 수 있습니다.'));
 const page=name=>(req,res)=>res.sendFile(name,{root:privateDir});
 app.get(['/','/index.html'],(req,res)=>res.redirect('/app'));
 app.get('/login',page('login.html')); app.get('/register',page('register.html')); app.get('/reset-password',page('reset.html'));
 app.get('/app',authenticate,page('counseling.html'));
 app.get('/admin',authenticate,admin,page('admin.html'));
 app.get('/password',authenticate,page('password.html'));
 app.get(['/script.js','/assets/counseling.js'],authenticate,page('counseling.js'));
 app.get('/assets/admin.js',authenticate,admin,page('admin.js'));
 app.use(express.static(publicDir,{index:false,dotfiles:'deny',maxAge:0}));
 app.post('/api/auth/register',async(req,res)=>{
  await limit(req,'register',10,3600);
  const id=sec.normalizeId(req.body?.login), password=sec.validPassword(req.body?.password);
  const name=typeof req.body?.name==='string'?req.body.name.trim():'';
  if(!name||name.length>80)throw fail(400,'이름은 1~80자로 입력해 주세요.');
  if(password!==req.body.confirmPassword)throw fail(400,'비밀번호 확인이 일치하지 않습니다.');
  await db().query(`INSERT INTO users(id,login_cipher,login_lookup,password_hash,name) VALUES($1,$2,$3,$4,$5) ON CONFLICT(login_lookup) DO NOTHING`,
   [randomUUID(),sec.encrypt(id),sec.lookup(id),await sec.hashPassword(password),name]);
  res.status(202).json({message:'가입 신청을 접수했습니다. 이미 신청한 아이디라면 기존 신청 상태가 유지됩니다. 관리자 승인 후 로그인해 주세요.'});
 });
 app.post('/api/auth/login',async(req,res)=>{
  await limit(req,'login-ip',30,900);
  const id=sec.normalizeId(req.body?.login);
  await limit(req,'login-id',10,900,id);
  const p=req.body?.password;
  if(typeof p!=='string'||p.length>512)throw fail(400,'아이디와 비밀번호를 확인해 주세요.');
  const user=(await db().query('SELECT * FROM users WHERE login_lookup=$1',[sec.lookup(id)])).rows[0];
  dummy ||= sec.hashPassword(sec.token());
  const valid=await sec.verifyPassword(user?.password_hash||await dummy,p);
  if(!user||!valid)throw fail(401,'아이디 또는 비밀번호가 올바르지 않습니다.');
  if(user.status!=='approved')throw fail(403,user.status==='pending'?'관리자 승인 대기 중입니다.':'이 계정은 이용할 수 없습니다. 관리자에게 문의해 주세요.');
  const t=sec.token();
  await transaction(db(),async c=>{
   // Recheck under lock: suspension/password reset cannot race session creation.
   const current=(await c.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[user.id])).rows[0];
   if(current.status!=='approved'||current.password_hash!==user.password_hash)throw fail(401,'계정 상태가 변경되었습니다. 다시 로그인해 주세요.');
   const old=sec.cookieToken(req); if(old)await c.query('DELETE FROM sessions WHERE token_hash=$1',[sec.digest(old)]);
   await c.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '8 hours')",[sec.digest(t),user.id]);
  });
  sec.setSession(res,t); res.json({redirect:'/app'});
 });
 app.get('/api/auth/me',authenticate,(req,res)=>res.json({name:req.user.name,role:req.user.role,csrfToken:sec.csrf(req.sessionToken)}));
 app.post('/api/auth/logout',authenticate,async(req,res)=>{
  await db().query('DELETE FROM sessions WHERE token_hash=$1',[sec.digest(req.sessionToken)]);
  sec.setSession(res,'');res.json({ok:true});
 });
 app.post('/api/auth/password',authenticate,async(req,res)=>{
  await limit(req,'password',10,900,req.user.id);
  const p=sec.validPassword(req.body?.password);
  if(p!==req.body.confirmPassword)throw fail(400,'비밀번호 확인이 일치하지 않습니다.');
  if(typeof req.body.currentPassword!=='string'||req.body.currentPassword.length>512||
    !await sec.verifyPassword(req.user.password_hash,req.body.currentPassword))throw fail(400,'현재 비밀번호가 올바르지 않습니다.');
  const hashed=await sec.hashPassword(p);
  await transaction(db(),async c=>{
   const current=(await c.query('SELECT password_hash FROM users WHERE id=$1 FOR UPDATE',[req.user.id])).rows[0];
   if(current.password_hash!==req.user.password_hash)throw fail(409,'계정 정보가 변경되었습니다. 다시 로그인해 주세요.');
   await c.query('UPDATE users SET password_hash=$1 WHERE id=$2',[hashed,req.user.id]);
   await c.query('DELETE FROM sessions WHERE user_id=$1',[req.user.id]);
   await c.query('DELETE FROM reset_tokens WHERE user_id=$1',[req.user.id]);
   await c.query("INSERT INTO audit_logs(actor_id,target_id,action) VALUES($1,$1,'password-change')",[req.user.id]);
  });
  sec.setSession(res,'');res.json({message:'비밀번호를 변경했습니다. 다시 로그인해 주세요.'});
 });
 app.get('/api/admin/users',authenticate,admin,async(req,res)=>{
  const offset=Math.max(0,Number.parseInt(req.query.offset,10)||0);
  const rows=(await db().query('SELECT * FROM users ORDER BY created_at DESC LIMIT 51 OFFSET $1',[offset])).rows;
  res.json({hasMore:rows.length>50,users:rows.slice(0,50).map(u=>({id:u.id,login:sec.decrypt(u.login_cipher),name:u.name,role:u.role,status:u.status,createdAt:u.created_at,approvedAt:u.approved_at}))});
 });
 app.patch('/api/admin/users/:id',authenticate,admin,async(req,res)=>{
  if(!uuid.test(req.params.id)||!['approved','rejected','suspended'].includes(req.body?.status))throw fail(400,'잘못된 변경 요청입니다.');
  await transaction(db(),async c=>{
   // Lock all administrators in stable order to preserve the last administrator.
   const admins=(await c.query("SELECT id FROM users WHERE role='admin' AND status='approved' ORDER BY id FOR UPDATE")).rows;
   if(!admins.some(a=>a.id===req.user.id))throw fail(403,'관리자 권한이 해제되었습니다.');
   const u=(await c.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];
   if(!u)throw fail(404,'계정을 찾을 수 없습니다.');
   if(u.role==='admin'&&u.status==='approved'&&req.body.status!=='approved'&&admins.length<=1)throw fail(409,'마지막 관리자는 정지하거나 거절할 수 없습니다.');
   await c.query("UPDATE users SET status=$1, approved_at=CASE WHEN $1='approved' THEN now() ELSE approved_at END, approved_by=CASE WHEN $1='approved' THEN $2 ELSE approved_by END WHERE id=$3",[req.body.status,req.user.id,u.id]);
   if(req.body.status!=='approved')await c.query('DELETE FROM sessions WHERE user_id=$1',[u.id]);
   await c.query('INSERT INTO audit_logs(actor_id,target_id,action) VALUES($1,$2,$3)',[req.user.id,u.id,req.body.status]);
  });res.json({ok:true});
 });
 app.post('/api/admin/users/:id/reset-password',authenticate,admin,async(req,res)=>{
  if(!uuid.test(req.params.id))throw fail(400,'잘못된 계정입니다.');
  await limit(req,'reset-issue',20,3600,req.user.id);
  const t=sec.token();
  await transaction(db(),async c=>{
   const users=(await c.query('SELECT * FROM users WHERE id IN ($1,$2) ORDER BY id FOR UPDATE',[req.user.id,req.params.id])).rows;
   if(!users.some(u=>u.id===req.user.id&&u.role==='admin'&&u.status==='approved'))throw fail(403,'관리자 권한이 해제되었습니다.');
   if(!users.some(u=>u.id===req.params.id))throw fail(404,'계정을 찾을 수 없습니다.');
   await c.query('DELETE FROM reset_tokens WHERE user_id=$1',[req.params.id]);
   await c.query("INSERT INTO reset_tokens(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '30 minutes')",[sec.digest(t),req.params.id]);
   await c.query("INSERT INTO audit_logs(actor_id,target_id,action) VALUES($1,$2,'reset-issued')",[req.user.id,req.params.id]);
  });
  res.json({url:process.env.APP_ORIGIN+'/reset-password#'+t});
 });
 app.post('/api/auth/reset-password',async(req,res)=>{
  await limit(req,'reset',10,900);
  const p=sec.validPassword(req.body?.password),t=req.body?.token;
  if(p!==req.body.confirmPassword)throw fail(400,'비밀번호 확인이 일치하지 않습니다.');
  if(typeof t!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(t))throw fail(400,'재설정 링크가 유효하지 않습니다.');
  const hashed=await sec.hashPassword(p);
  await transaction(db(),async c=>{
   const reset=(await c.query('SELECT * FROM reset_tokens WHERE token_hash=$1 AND expires_at>now()',[sec.digest(t)])).rows[0];
   if(!reset)throw fail(400,'재설정 링크가 만료되었거나 이미 사용되었습니다.');
   await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[reset.user_id]);
   const consumed=await c.query('DELETE FROM reset_tokens WHERE token_hash=$1 AND expires_at>now() RETURNING user_id',[sec.digest(t)]);
   if(!consumed.rows.length)throw fail(400,'재설정 링크가 만료되었거나 이미 사용되었습니다.');
   await c.query('UPDATE users SET password_hash=$1 WHERE id=$2',[hashed,reset.user_id]);
   await c.query('DELETE FROM sessions WHERE user_id=$1',[reset.user_id]);
   await c.query("INSERT INTO audit_logs(target_id,action) VALUES($1,'password-reset')",[reset.user_id]);
  });sec.setSession(res,'');res.json({message:'비밀번호를 재설정했습니다. 다시 로그인해 주세요.'});
 });
 app.post('/api/generate',authenticate,async(req,res)=>{
  await limit(req,'generate',30,3600,req.user.id);
  const p=req.body?.participant;
  if(!p||!Number.isInteger(p.age)||p.age<14||p.age>100||!['남성','여성'].includes(p.gender)||
   !['experienced','newcomer'].includes(p.experienceType)||!['decided','undecided'].includes(p.careerDecision)||
   typeof p.goal!=='string'||!p.goal.trim()||p.goal.length>200||
   ['industry','jobType','situation'].some(k=>typeof p[k]!=='string'||p[k].length>1000)||
   !Number.isInteger(p.experience)||p.experience<0||p.experience>80)throw fail(400,'참여자 입력 내용을 확인해 주세요. 나이는 14~100세, 경력은 0~80년입니다.');
  await generator(req,res);
 });
 app.use((req,res)=>res.status(404).json({error:'페이지를 찾을 수 없습니다.'}));
 app.use((err,req,res,next)=>{
  if(res.headersSent)return next(err);
  const status=err.type==='entity.parse.failed'?400:err.type==='entity.too.large'?413:err.status||503;
  if(status>=500) console.error('Request failed:',err.code||err.name);
  res.status(status).json({error:status>=500?'서버 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.':err.message});
 });
 return app;
}
