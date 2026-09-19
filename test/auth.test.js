import {test,after,before} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import request from 'supertest';
import {createApp} from '../server/app.js';
import * as sec from '../server/security.js';
import generate from '../server/generate.js';
const origin='http://localhost:3000', password='test-password-123456';
let pg,db,app,adminCookie,adminCsrf,userId,userCookie,userCsrf;
const participant={age:35,gender:'남성',experienceType:'newcomer',industry:'',jobType:'',experience:0,careerDecision:'decided',goal:'상담사',situation:'취업 준비'};
const post=(path,body,cookie,csrf)=>{let r=request(app).post(path).set('Origin',origin);if(cookie)r=r.set('Cookie',cookie);if(csrf)r=r.set('X-CSRF-Token',csrf);return r.send(body);};
const update=status=>request(app).patch('/api/admin/users/'+userId).set('Origin',origin).set('Cookie',adminCookie).set('X-CSRF-Token',adminCsrf).send({status});
async function login(id){
 const r=await post('/api/auth/login',{login:id,password});assert.equal(r.status,200,JSON.stringify(r.body));
 const cookie=r.headers['set-cookie'][0].split(';')[0];
 const me=await request(app).get('/api/auth/me').set('Cookie',cookie);
 return {cookie,csrf:me.body.csrfToken};
}
before(async()=>{
 process.env.APP_ORIGIN=origin;process.env.ID_ENCRYPTION_KEY=randomBytes(32).toString('base64');process.env.ID_LOOKUP_KEY=randomBytes(32).toString('base64');
 pg=new PGlite();await pg.exec(await readFile(new URL('../server/schema.sql',import.meta.url),'utf8'));
 db={query:(...args)=>pg.query(...args),connect:async()=>({query:(...args)=>pg.query(...args),release(){}})};
 app=createApp({db});
 await db.query("INSERT INTO users(id,login_cipher,login_lookup,password_hash,name,role,status) VALUES($1,$2,$3,$4,'관리자','admin','approved')",
 [randomUUID(),sec.encrypt('administrator'),sec.lookup('administrator'),await sec.hashPassword(password)]);
 const a=await login('administrator');adminCookie=a.cookie;adminCsrf=a.csrf;
});
after(async()=>{await pg.close();});
test('public pages work; protected pages, old scripts and source files cannot bypass login',async()=>{
 for(const path of ['/login','/register'])assert.equal((await request(app).get(path)).status,200);
 for(const path of ['/app','/script.js','/assets/counseling.js','/admin'])assert.equal((await request(app).get(path)).status,302);
 for(const path of ['/private/counseling.html','/server/app.js','/.env.local','/server/schema.sql'])assert.equal((await request(app).get(path)).status,404);
 assert.equal((await post('/api/generate',{participant})).status,401);
});
test('signup is pending; encrypted ID, salted Argon2id; client role/status ignored',async()=>{
 const r=await post('/api/auth/register',{login:'User.Name',password,confirmPassword:password,name:'신청자',role:'admin',status:'approved'});
 assert.equal(r.status,202);
 const u=(await db.query('SELECT * FROM users WHERE login_lookup=$1',[sec.lookup('user.name')])).rows[0];userId=u.id;
 assert.equal(u.status,'pending');assert.equal(u.role,'user');assert.notEqual(u.login_cipher,'user.name');
 assert.equal(sec.decrypt(u.login_cipher),'user.name');assert.match(u.password_hash,/^\$argon2id\$/);
 assert.equal(await sec.verifyPassword(u.password_hash,password),true);
 assert.notEqual(await sec.hashPassword(password),u.password_hash);
 assert.equal((await post('/api/auth/login',{login:'user.name',password})).status,403);
 await post('/api/auth/register',{login:' USER.NAME ',password,confirmPassword:password,name:'중복'});
 assert.equal((await db.query('SELECT count(*)::int AS n FROM users WHERE login_lookup=$1',[sec.lookup('user.name')])).rows[0].n,1);
});
test('admin approves; approved member logs in but cannot administer; CSRF blocked',async()=>{
 assert.equal((await update('approved')).status,200);
 const u=await login('user.name');userCookie=u.cookie;userCsrf=u.csrf;
 assert.equal((await request(app).get('/app').set('Cookie',userCookie)).status,200);
 assert.equal((await request(app).get('/api/admin/users').set('Cookie',userCookie)).status,403);
 assert.equal((await post('/api/generate',{participant},userCookie)).status,403);
 assert.equal((await request(app).post('/api/auth/logout').set('Origin','https://evil.example').set('Cookie',userCookie).set('X-CSRF-Token',userCsrf).send({})).status,403);
 assert.equal((await request(app).patch('/api/admin/users/'+userId).set('Origin',origin).set('Cookie',userCookie).set('X-CSRF-Token',userCsrf).send({status:'approved'})).status,403);
});
test('AI configuration and upstream failures return errors without fallback questions',async()=>{
 delete process.env.GEMINI_API_KEY;
 const r=await post('/api/generate',{participant},userCookie,userCsrf);
 assert.equal(r.status,503);assert.equal(r.body.questions,undefined);
 const originalFetch=global.fetch;process.env.GEMINI_API_KEY='test-only';
 try{
  global.fetch=async()=>new Response('failure',{status:429});
  const r2=await post('/api/generate',{participant},userCookie,userCsrf);assert.equal(r2.status,502);assert.equal(r2.body.questions,undefined);
  global.fetch=async()=>{throw new Error('network');};
  assert.equal((await post('/api/generate',{participant},userCookie,userCsrf)).status,502);
  global.fetch=async()=>Response.json({candidates:[{content:{parts:[{text:'{}'}]}}]});
  assert.equal((await post('/api/generate',{participant},userCookie,userCsrf)).status,502);
  const questions=Object.fromEntries([5,3,4,3].map((n,i)=>['stage'+(i+1),{title:'단계',description:'설명',questions:Array(n).fill('<img src=x onerror=alert(1)>')}]));
  global.fetch=async()=>Response.json({candidates:[{content:{parts:[{text:JSON.stringify(questions)}]}}]});
  assert.equal((await post('/api/generate',{participant},userCookie,userCsrf)).status,200);
 }finally{global.fetch=originalFetch;delete process.env.GEMINI_API_KEY;}
});
test('suspension immediately invalidates existing session and reapproval permits login',async()=>{
 assert.equal((await update('suspended')).status,200);
 assert.equal((await post('/api/generate',{participant},userCookie,userCsrf)).status,401);
 assert.equal((await post('/api/auth/login',{login:'user.name',password})).status,403);
 await update('approved');const u=await login('user.name');userCookie=u.cookie;userCsrf=u.csrf;
});
test('last admin cannot be suspended; password reset is single use and revokes sessions',async()=>{
 const adminId=(await db.query("SELECT id FROM users WHERE role='admin'")).rows[0].id;
 const r=await request(app).patch('/api/admin/users/'+adminId).set('Origin',origin).set('Cookie',adminCookie).set('X-CSRF-Token',adminCsrf).send({status:'suspended'});assert.equal(r.status,409);
 const reset=await post('/api/admin/users/'+userId+'/reset-password',{},adminCookie,adminCsrf);assert.equal(reset.status,200);
 const token=reset.body.url.split('#')[1],next='replacement-password-12345';
 const body={token,password:next,confirmPassword:next};
 assert.equal((await post('/api/auth/reset-password',body)).status,200);
 assert.equal((await request(app).get('/api/auth/me').set('Cookie',userCookie)).status,401);
 assert.equal((await post('/api/auth/reset-password',body)).status,400);
 assert.equal((await post('/api/auth/login',{login:'user.name',password})).status,401);
 assert.equal((await post('/api/auth/login',{login:'user.name',password:next})).status,200);
});
test('session idle expiry, logout and rate limiting are enforced',async()=>{
 const a=await login('administrator');
 await db.query("UPDATE sessions SET last_seen=now()-interval '31 minutes' WHERE token_hash=$1",[sec.digest(a.cookie.split('=')[1])]);
 assert.equal((await request(app).get('/api/auth/me').set('Cookie',a.cookie)).status,401);
 assert.equal((await post('/api/auth/logout',{},adminCookie,adminCsrf)).status,200);
 assert.equal((await request(app).get('/api/auth/me').set('Cookie',adminCookie)).status,401);
 let last;for(let i=0;i<11;i++)last=await post('/api/auth/login',{login:'missing.user',password});
 assert.equal(last.status,429);
});
test('DB outage fails closed; client contains no fallback or unsafe HTML insertion',async()=>{
 const broken=createApp({db:{query(){throw new Error('offline');}}});
 const r=await request(broken).get('/api/auth/me').set('Cookie','session='+sec.token());assert.equal(r.status,503);
 const js=await readFile(new URL('../private/counseling.js',import.meta.url),'utf8');
 assert.doesNotMatch(js,/innerHTML|function generateQuestions\(|기본 템플릿/);assert.match(js,/호출 실패/);
});

