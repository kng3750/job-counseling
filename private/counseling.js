let csrfToken='';
const form=document.getElementById('participantForm'), errorBox=document.getElementById('requestError'), output=document.getElementById('outputSection');
const submit=form.querySelector('button[type="submit"]');submit.disabled=true;
async function session(){
 const r=await fetch('/api/auth/me');
 if(!r.ok){if(r.status===401){location.replace('/login');return;}throw new Error('로그인 확인에 실패했습니다. 새로고침해 주세요.');}
 const me=await r.json();csrfToken=me.csrfToken;
 document.getElementById('sessionName').textContent=me.name;
 document.getElementById('adminLink').hidden=me.role!=='admin';submit.disabled=false;
}
session().catch(e=>errorBox.textContent=e.message);
function experienceFields(){
 for(const id of ['industryGroup','jobTypeGroup','experienceGroup'])document.getElementById(id).hidden=document.getElementById('experienceType').value!=='experienced';
}
document.getElementById('experienceType').addEventListener('change',experienceFields);experienceFields();
document.getElementById('careerDecision').addEventListener('change',function(){
 document.getElementById('goal').placeholder=this.value==='undecided'?'예: 사무직, 서비스업 등 관심 분야 (탐색 중)':'예: 사무직 전환';
});
function clearResults(){
 output.style.display='none';
 document.getElementById('participantSummary').replaceChildren();
 document.getElementById('questionsContainer').replaceChildren();
}
function addText(parent,tag,content,className){
 const el=document.createElement(tag);el.textContent=content;if(className)el.className=className;parent.append(el);return el;
}
function displayResults(p,questions){
 const summary=document.getElementById('participantSummary');
 addText(summary,'h3','참여자 정보');addText(summary,'span','✨ Gemini AI 생성','ai-badge');
 addText(summary,'p','기본정보: '+p.age+'세, '+p.gender);
 addText(summary,'p','경력: '+(p.experienceType==='experienced'?p.industry+' '+p.jobType+' '+p.experience+'년':'신입/무경력'));
 addText(summary,'p','진로 상태: '+(p.careerDecision==='decided'?'진로결정':'미결정관련 탐색'));
 addText(summary,'p','현재 상황: '+p.situation);addText(summary,'p','희망 목표: '+p.goal);
 const container=document.getElementById('questionsContainer');
 for(const key of ['stage1','stage2','stage3','stage4']){
  const stage=questions[key],block=document.createElement('div');block.className='stage';
  const header=document.createElement('div');header.className='stage-header';
  addText(header,'h3',stage.title);addText(header,'span',stage.questions.length+'개 질문','count');block.append(header);
  const body=document.createElement('div');body.className='stage-content';
  stage.questions.forEach((q,i)=>{const item=document.createElement('div');item.className='question-item';addText(item,'span',String(i+1),'question-number');addText(item,'span',q,'question-text');body.append(item);});
  block.append(body);container.append(block);
 }
 output.style.display='block';output.scrollIntoView({behavior:'smooth'});
}
form.addEventListener('submit',async event=>{
 event.preventDefault();clearResults();errorBox.textContent='';submit.disabled=true;submit.textContent='질문 생성 중...';
 const value=id=>document.getElementById(id).value,experienced=value('experienceType')==='experienced';
 const participant={age:Number(value('age')),gender:value('gender')==='male'?'남성':'여성',experienceType:value('experienceType'),
 industry:experienced?value('industry'):'',jobType:experienced?value('jobType'):'',experience:experienced?Number(value('experience')):0,
 careerDecision:value('careerDecision'),goal:value('goal'),situation:value('situation')||'현재 상황 미기재'};
 try{
  const r=await fetch('/api/generate',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:JSON.stringify({participant}),signal:AbortSignal.timeout(55000)});
  const data=await r.json().catch(()=>({}));
  if(!r.ok){if(r.status===401){location.replace('/login');return;}throw new Error(data.error||'질문 생성 API 호출에 실패했습니다.');}
  if(!data.success||!data.questions)throw new Error('질문 생성 API 응답이 올바르지 않습니다.');
  displayResults(participant,data.questions);
 }catch(e){clearResults();errorBox.textContent='호출 실패: '+(e.name==='TimeoutError'?'응답 시간이 초과되었습니다. 다시 시도해 주세요.':e.message);errorBox.scrollIntoView({behavior:'smooth'});}
 finally{submit.disabled=false;submit.textContent='질문지 생성하기';}
});
document.getElementById('printButton').onclick=()=>window.print();
document.getElementById('resetButton').onclick=()=>{form.reset();clearResults();errorBox.textContent='';experienceFields();window.scrollTo({top:0,behavior:'smooth'});};
document.getElementById('logout').onclick=async()=>{
 try{
  const r=await fetch('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:'{}'});
  if(!r.ok&&r.status!==401)throw new Error('로그아웃에 실패했습니다. 다시 시도해 주세요.');
  clearResults();location.replace('/login');
 }catch(e){errorBox.textContent=e.message;}
};
window.addEventListener('pagehide',clearResults);
window.addEventListener('pageshow',e=>{if(e.persisted){clearResults();session().catch(err=>errorBox.textContent=err.message);}});

