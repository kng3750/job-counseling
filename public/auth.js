let csrfToken='';
let resetToken=location.hash.slice(1);
if(resetToken)history.replaceState(null,'',location.pathname);
const form=document.querySelector('form');
const message=document.getElementById('message');
if(form?.dataset.action==='password'){
 fetch('/api/auth/me').then(async r=>{if(!r.ok){location.replace('/login');return;}csrfToken=(await r.json()).csrfToken;}).catch(()=>{message.textContent='서버 연결에 실패했습니다.';});
}
form?.addEventListener('submit',async event=>{
 event.preventDefault();message.textContent='';
 const button=form.querySelector('button');button.disabled=true;
 try{
  const body=Object.fromEntries(new FormData(form));
  if(form.dataset.action==='login')body.returnTo=new URLSearchParams(location.search).get('returnTo')||'';
  if(body.confirmPassword!==undefined&&body.password!==body.confirmPassword)throw new Error('비밀번호 확인이 일치하지 않습니다.');
  if(form.dataset.action==='reset-password')body.token=resetToken;
  const r=await fetch('/api/auth/'+form.dataset.action,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:JSON.stringify(body)});
  const data=await r.json();
  if(!r.ok)throw new Error(data.error||'요청에 실패했습니다.');
  if(data.redirect){location.replace(data.redirect);return;}
  message.textContent=data.message;
  form.reset();form.hidden=true;
  if(form.dataset.action==='password'){const a=document.createElement('a');a.href='/login';a.textContent=' 로그인으로 이동';message.append(a);}
 }catch(e){message.textContent=e.message==='Failed to fetch'?'서버 연결에 실패했습니다. 다시 시도해 주세요.':e.message;}
 finally{button.disabled=false;}
});


const returnTo=new URLSearchParams(location.search).get('returnTo');
if(returnTo?.startsWith('/oauth/authorize?'))document.querySelectorAll('a[href="/login"],a[href="/register"]').forEach(a=>a.href=a.getAttribute('href')+'?returnTo='+encodeURIComponent(returnTo));
