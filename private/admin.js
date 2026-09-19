let csrf='',offset=0;
const message=document.getElementById('message'), list=document.getElementById('users');
const statuses={pending:'승인 대기',approved:'승인',rejected:'거절',suspended:'정지'};
async function request(url,method='GET',body){
 const r=await fetch(url,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body?JSON.stringify(body):undefined});
 const data=await r.json();
 if(r.status===401){location.replace('/login');throw new Error('로그인이 필요합니다.');}
 if(!r.ok)throw new Error(data.error||'요청에 실패했습니다.');return data;
}
function text(tag,value,parent){const e=document.createElement(tag);e.textContent=value;parent.append(e);return e;}
async function load(){
 const data=await request('/api/admin/users?offset='+offset);list.replaceChildren();
 for(const u of data.users){
  const card=document.createElement('article');card.className='user-card';
  text('h3',u.name+' · '+u.login,card);
  text('p',(u.role==='admin'?'관리자':'사용자')+' / '+statuses[u.status],card);
  text('p','신청: '+new Date(u.createdAt).toLocaleString('ko-KR')+(u.approvedAt?' / 승인: '+new Date(u.approvedAt).toLocaleString('ko-KR'):''),card);
  const actions=document.createElement('div');actions.className='user-actions';card.append(actions);
  for(const [status,label] of [['approved','승인'],['rejected','거절'],['suspended','이용 정지'],['reset','비밀번호 재설정']]){
   if(status===u.status)continue;
   const b=text('button',label,actions);b.type='button';if(status==='suspended')b.className='danger';
   b.onclick=async()=>{
    if(!confirm(u.name+' 계정에 '+label+' 처리를 하시겠습니까?'))return;
    b.disabled=true;message.textContent='';
    try{
     if(status==='reset'){
      const result=await request('/api/admin/users/'+u.id+'/reset-password','POST',{});
      document.getElementById('resetLink').value=result.url;document.getElementById('resetResult').hidden=false;
     }else{await request('/api/admin/users/'+u.id,'PATCH',{status});await load();}
     message.textContent=label+' 처리를 완료했습니다.';
    }catch(e){message.textContent=e.message;}finally{b.disabled=false;}
   };
  }list.append(card);
 }
 if(!data.users.length)text('p','등록된 계정이 없습니다.',list);
 document.getElementById('prev').disabled=offset===0;document.getElementById('next').disabled=!data.hasMore;
}
const reload=()=>load().catch(e=>message.textContent=e.message);
document.getElementById('refresh').onclick=reload;
document.getElementById('prev').onclick=()=>{offset=Math.max(0,offset-50);reload();};
document.getElementById('next').onclick=()=>{offset+=50;reload();};
document.getElementById('hideReset').onclick=()=>{document.getElementById('resetLink').value='';document.getElementById('resetResult').hidden=true;};
document.getElementById('logout').onclick=async()=>{try{await request('/api/auth/logout','POST',{});location.replace('/login');}catch(e){message.textContent=e.message;}};
request('/api/auth/me').then(me=>{csrf=me.csrfToken;return load();}).catch(e=>message.textContent=e.message);

