import {randomBytes,createCipheriv,createDecipheriv,createHmac,createHash,timingSafeEqual} from 'node:crypto';
import {hash,verify,Algorithm} from '@node-rs/argon2';
export const token=()=>randomBytes(32).toString('base64url');
export const digest=s=>createHash('sha256').update(s).digest('hex');
function key(name) { const k=Buffer.from(process.env[name]||'','base64'); if(k.length!==32) throw new Error('Encryption key not configured'); return k; }
export function lookup(id) { return createHmac('sha256',key('ID_LOOKUP_KEY')).update(id).digest('hex'); }
export function encrypt(id) {
 const iv=randomBytes(12), c=createCipheriv('aes-256-gcm',key('ID_ENCRYPTION_KEY'),iv);
 const body=Buffer.concat([c.update(id,'utf8'),c.final()]);
 return ['v1',iv.toString('base64'),c.getAuthTag().toString('base64'),body.toString('base64')].join('.');
}
export function decrypt(value) {
 const [v,iv,tag,body]=value.split('.'); if(v!=='v1') throw new Error('Unknown key version');
 const d=createDecipheriv('aes-256-gcm',key('ID_ENCRYPTION_KEY'),Buffer.from(iv,'base64')); d.setAuthTag(Buffer.from(tag,'base64'));
 return Buffer.concat([d.update(Buffer.from(body,'base64')),d.final()]).toString('utf8');
}
export function normalizeId(value) {
 if(typeof value!=='string') throw Object.assign(new Error('아이디를 입력해 주세요.'),{status:400});
 const id=value.trim().toLowerCase();
 if(!/^[a-z0-9._-]{4,40}$/.test(id)) throw Object.assign(new Error('아이디는 영문, 숫자, 점, 밑줄, 하이픈으로 4~40자입니다.'),{status:400}); return id;
}
export function validPassword(p) {
 if(typeof p!=='string'||[...p].length<15||[...p].length>128) throw Object.assign(new Error('비밀번호는 15~128자로 입력해 주세요.'),{status:400}); return p;
}
export const hashPassword=p=>hash(p,{algorithm:Algorithm.Argon2id,memoryCost:19456,timeCost:2,parallelism:1});
export const verifyPassword=(h,p)=>verify(h,p);
export function equal(a,b) { if(typeof a!=='string'||typeof b!=='string') return false; const x=Buffer.from(a),y=Buffer.from(b); return x.length===y.length&&timingSafeEqual(x,y); }
export const csrf=t=>digest('csrf:'+t);
export function cookieToken(req) {
 const prefix=process.env.NODE_ENV==='production'?'__Host-session':'session';
 const entry=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(prefix+'='));
 return entry?.slice(prefix.length+1)||'';
}
export function setSession(res,t) {
 const prod=process.env.NODE_ENV==='production';
 res.setHeader('Set-Cookie',(prod?'__Host-session':'session')+'='+t+'; Path=/; HttpOnly; SameSite=Lax; Max-Age='+(t?28800:0)+(prod?'; Secure':''));
}

