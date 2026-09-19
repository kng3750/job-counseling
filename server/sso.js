import express from 'express';
import OAuth2Server from '@node-oauth/oauth2-server';
import * as sec from './security.js';
import {transaction} from './db.js';
const fail=(status,message)=>Object.assign(new Error(message),{status});
export function createSso({db,authenticate,limit}) {
 const router=express.Router();
 router.use(express.urlencoded({extended:false,limit:'4kb'}));
 const validSession=async(hash,client=db())=>{
  const r=await client.query(`SELECT s.token_hash,s.expires_at,u.id,u.name,u.role FROM sessions s JOIN users u ON u.id=s.user_id
   WHERE s.token_hash=$1 AND s.expires_at>now() AND s.last_seen>now()-interval '30 minutes' AND u.status='approved'`,[hash]);
  return r.rows[0];
 };
 async function registered(id){
  if(typeof id!=='string'||id.length>100)return null;
  return (await db().query('SELECT * FROM sso_clients WHERE id=$1 AND enabled=true',[id])).rows[0];
 }
 async function serverClient(req,res,next){
  try {
   // Browser Origin is never accepted on the back channel. Credentials alone are insufficient to bypass token audience checks.
   if(req.headers.origin)throw fail(403,'서버 전용 요청입니다.');
   const header=req.headers.authorization||'';
   if(!header.startsWith('Basic '))throw fail(401,'클라이언트 인증이 필요합니다.');
   const raw=Buffer.from(header.slice(6),'base64').toString('utf8'),at=raw.indexOf(':');
   if(at<1)throw fail(401,'잘못된 클라이언트 인증입니다.');
   let id,secret;try{id=decodeURIComponent(raw.slice(0,at));secret=decodeURIComponent(raw.slice(at+1));}catch{throw fail(401,'잘못된 클라이언트 인증입니다.');}
   await limit(req,'sso-client-ip',6000,60);
   const c=await registered(id);
   if(!c||!sec.equal(c.secret_hash,sec.digest(secret)))throw fail(401,'클라이언트 인증에 실패했습니다.');
   req.ssoClient=c;next();
  }catch(e){next(e);}
 }
 const oauth=new OAuth2Server({
  authorizationCodeLifetime:60,accessTokenLifetime:28800,allowEmptyState:false,enablePlainPKCE:false,
  model:{
   async getClient(id,secret){
    // RFC 6749 Basic credentials are form-encoded; basic-auth itself does not decode them.
    if(secret!==null&&secret!==undefined){
     try{id=decodeURIComponent(id.replace(/\+/g,' '));secret=decodeURIComponent(secret.replace(/\+/g,' '));}catch{return false;}
    }
    const c=await registered(id);
    if(!c||(secret!==null&&secret!==undefined&&!sec.equal(c.secret_hash,sec.digest(secret))))return false;
    return {id:c.id,grants:['authorization_code'],redirectUris:[c.redirect_uri]};
   },
   validateRedirectUri:(uri,client)=>client.redirectUris.includes(uri),
   validateScope:(_user,_client,scope)=>!scope||scope.every(s=>s==='job-star')?['job-star']:false,
   generateAuthorizationCode:()=>sec.token(),
   generateAccessToken:()=>sec.token(),
   async saveAuthorizationCode(code,client,user){
    if(code.codeChallengeMethod!=='S256'||!/^[A-Za-z0-9_-]{43}$/.test(code.codeChallenge||''))throw fail(400,'PKCE가 필요합니다.');
    if(!await validSession(user.sessionHash))throw fail(401,'로그인이 만료되었습니다.');
    await db().query('INSERT INTO sso_codes(code_hash,session_hash,client_id,redirect_uri,challenge,expires_at) VALUES($1,$2,$3,$4,$5,$6)',
     [sec.digest(code.authorizationCode),user.sessionHash,client.id,code.redirectUri,code.codeChallenge,code.expiresAt]);
    return {...code,client,user};
   },
   async getAuthorizationCode(value){
    if(typeof value!=='string'||value.length>128)return false;
    const c=(await db().query('SELECT * FROM sso_codes WHERE code_hash=$1',[sec.digest(value)])).rows[0];
    if(!c)return false;const s=await validSession(c.session_hash);if(!s)return false;
    return {authorizationCode:value,expiresAt:new Date(c.expires_at),redirectUri:c.redirect_uri,codeChallenge:c.challenge,codeChallengeMethod:'S256',
     scope:['job-star'],client:{id:c.client_id},user:{id:s.id,sessionHash:c.session_hash}};
   },
   async revokeAuthorizationCode(code){
    // Atomic consume prevents parallel exchanges from both succeeding.
    const r=await db().query('DELETE FROM sso_codes WHERE code_hash=$1 AND expires_at>now() RETURNING code_hash',[sec.digest(code.authorizationCode)]);
    return r.rows.length===1;
   },
   async saveToken(t,client,user){
    return transaction(db(),async c=>{
     await c.query('SELECT token_hash FROM sessions WHERE token_hash=$1 FOR UPDATE',[user.sessionHash]);
     const s=await validSession(user.sessionHash,c);if(!s)throw fail(401,'로그인이 만료되었습니다.');
     const expiry=new Date(Math.min(new Date(s.expires_at).getTime(),t.accessTokenExpiresAt.getTime()));
     await c.query('INSERT INTO service_sessions(token_hash,session_hash,client_id,expires_at) VALUES($1,$2,$3,$4)',
      [sec.digest(t.accessToken),user.sessionHash,client.id,expiry]);
     await c.query("INSERT INTO audit_logs(actor_id,target_id,action) VALUES($1,$1,'job-star:sso-login')",[user.id]);
     // No refresh token: switching services must never extend absolute session expiry.
     return {accessToken:t.accessToken,accessTokenExpiresAt:expiry,scope:['job-star'],client,user};
    });
   }
  }
 });
 router.get('/authorize',async(req,res,next)=>{
  try{
   const q=req.query,c=await registered(q.client_id);
   if(!c||q.redirect_uri!==c.redirect_uri||q.response_type!=='code'||q.scope!=='job-star'||
    typeof q.state!=='string'||!/^[A-Za-z0-9_-]{32,128}$/.test(q.state)||
    q.code_challenge_method!=='S256'||typeof q.code_challenge!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(q.code_challenge))throw fail(400,'잘못된 통합 로그인 요청입니다.');
   await limit(req,'sso-authorize',60,60);
   next();
  }catch(e){next(e);}
 },authenticate,async(req,res,next)=>{
  try{
   const response=new OAuth2Server.Response();
   await oauth.authorize(new OAuth2Server.Request(req),response,{
    authenticateHandler:{handle:()=>({id:req.user.id,sessionHash:sec.digest(req.sessionToken)})}
   });
   res.set(response.headers).status(response.status).end();
  }catch(e){next(fail(e.code>=400&&e.code<500?e.code:503,'통합 로그인에 실패했습니다. 다시 시도해 주세요.'));}
 });
 router.post('/token',serverClient,async(req,res)=>{
  try{
   if(req.body.grant_type!=='authorization_code'||req.body.client_id&&req.body.client_id!==req.ssoClient.id||
    !/^[A-Za-z0-9._~-]{43,128}$/.test(req.body.code_verifier||''))throw fail(400,'invalid_request');
   const response=new OAuth2Server.Response();
   await oauth.token(new OAuth2Server.Request(req),response);
   res.set(response.headers).status(response.status).json(response.body);
  }catch(e){console.error('SSO token:',e.name,e.status||e.code);res.status(e.status||e.code>=400&&e.code<500&&e.code||503).json({error:'invalid_grant',error_description:'인증 코드 교환에 실패했습니다.'});}
 });
 router.post('/introspect',serverClient,async(req,res,next)=>{
  try{
   const t=req.body.token;if(typeof t!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(t))return res.json({active:false});
   const r=await db().query(`UPDATE sessions s SET last_seen=now() FROM service_sessions a,users u
    WHERE a.token_hash=$1 AND a.client_id=$2 AND a.session_hash=s.token_hash AND u.id=s.user_id AND u.status='approved'
    AND a.expires_at>now() AND s.expires_at>now() AND s.last_seen>now()-interval '30 minutes'
    RETURNING u.id,u.name,u.role,s.expires_at`,[sec.digest(t),req.ssoClient.id]);
   const u=r.rows[0];if(!u)return res.json({active:false});
   if(req.body.operation==='generate')await limit(req,'job-star:generate',30,3600,u.id);
   res.json({active:true,sub:u.id,name:u.name,role:u.role,aud:req.ssoClient.id,exp:Math.floor(new Date(u.expires_at).getTime()/1000)});
  }catch(e){next(e);}
 });
 router.post('/revoke',serverClient,async(req,res,next)=>{
  try{
   const t=req.body.token;if(typeof t!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(t))throw fail(400,'잘못된 세션입니다.');
   await transaction(db(),async c=>{
    const r=await c.query(`DELETE FROM sessions WHERE token_hash IN
     (SELECT session_hash FROM service_sessions WHERE token_hash=$1 AND client_id=$2) RETURNING user_id`,[sec.digest(t),req.ssoClient.id]);
    if(r.rows[0])await c.query("INSERT INTO audit_logs(actor_id,target_id,action) VALUES($1,$1,'job-star:logout')",[r.rows[0].user_id]);
   });res.json({ok:true});
  }catch(e){next(e);}
 });
 return router;
}
