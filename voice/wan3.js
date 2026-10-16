// =========================================================
// 🎬 장면 공장 (주인 전용, 숏츠 공방 버튼, GET /story) — 万相 3.0 참조 생성: 캐릭터·장소 그림 + 대사(내 목소리) + 한국어 장면 → 2~30초 멀티샷 영상(소리 포함)
//  서버: /shorts/w3/state · make · poll · del (shorts.js w3*). 결과는 R2 → 저장·공유해서 편집실 클립으로
// =========================================================
export const W3_HTML = String.raw`<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#1664B0">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="장면 공장">
<link rel="apple-touch-icon" href="/shorts-180.png"><link rel="icon" href="/shorts-192.png">
<title>장면 공장</title>
<style>
:root{--sky:#1664B0;--bg:#EFE8DE;--card:#F7F2EA;--ink:#1A2330;--ink2:#5E6672;--line:#D9CEBD;--red:#D21624;--soft:#E6DCCB;--ok:#1F7A4D}
@media (prefers-color-scheme:dark){:root{--bg:#141A22;--card:#1C2430;--ink:#EDE6DA;--ink2:#9AA3AE;--line:#2C3644;--soft:#253041;--ok:#5CC08C}}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,"Apple SD Gothic Neo","PingFang SC",system-ui,sans-serif;-webkit-text-size-adjust:100%}
header{background:var(--sky);color:#fff;padding:calc(env(safe-area-inset-top) + 14px) 16px 14px;border-bottom:3px solid var(--red);display:flex;align-items:center;gap:12px}
header h1{margin:0;font-size:19px}a.back{color:#fff;text-decoration:none;font-size:20px}
main{max-width:640px;margin:0 auto;padding:14px 16px 60px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:12px}
.card h2{margin:0 0 8px;font-size:15.5px}.lbl{font-size:12.5px;color:var(--ink2);margin:10px 0 4px}
input[type=text],textarea,select{width:100%;font:inherit;font-size:16px;padding:9px 10px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink)}
textarea{min-height:72px;resize:vertical}
.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{border:1px solid var(--line);background:transparent;color:var(--ink);border-radius:999px;padding:5px 11px;font:inherit;font-size:13px}.chip.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.big{display:block;width:100%;border:0;border-radius:12px;background:var(--sky);color:#fff;font:inherit;font-weight:700;font-size:16px;padding:14px;margin-top:10px;text-align:center}.big:disabled{opacity:.5}.big.red{background:var(--red)}
.refs{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.ref{position:relative;aspect-ratio:3/4;border:2px dashed var(--line);border-radius:10px;overflow:hidden;background:var(--soft);display:flex;align-items:center;justify-content:center;color:var(--ink2);font-size:12px;text-align:center;padding:4px}
.ref img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.ref input{position:absolute;inset:0;opacity:0;width:100%;height:100%}.ref .x{position:absolute;top:2px;right:2px;background:rgba(0,0,0,.6);color:#fff;border:0;border-radius:50%;width:22px;height:22px;font-size:12px;z-index:2}
.ref .tag{position:absolute;left:0;right:0;bottom:0;background:rgba(0,0,0,.55);color:#fff;font-size:10.5px;padding:2px 4px;border:0;text-align:center}
.note{font-size:12.5px;color:var(--ink2);margin:6px 0 0}.err{color:var(--red);font-size:13.5px;margin-top:8px;white-space:pre-wrap}
.gal .it{background:var(--soft);border-radius:10px;padding:8px;margin-top:8px}.gal video{width:100%;max-height:420px;border-radius:8px;background:#000;display:block}
.gal small{display:block;color:var(--ink2);font-size:11.5px;margin:4px 2px}.pd{background:var(--soft);border-radius:10px;padding:10px;margin-top:8px;font-size:14px}
.mini{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.mini button{border:1px solid var(--line);background:transparent;color:var(--ink);border-radius:8px;padding:5px 9px;font:inherit;font-size:12.5px}
.toast{position:fixed;left:50%;bottom:30px;transform:translateX(-50%);background:var(--ink);color:var(--bg);padding:10px 16px;border-radius:999px;font-size:14px;z-index:9;max-width:90vw;text-align:center}
.spin{display:inline-block;animation:sp 1.2s linear infinite}@keyframes sp{to{transform:rotate(360deg)}}
.gate{padding:40px 0;text-align:center}.cost{font-weight:700;color:var(--sky)}
details summary{font-size:12px;color:var(--ink2);cursor:pointer}
</style></head><body>
<header><a class="back" href="/shorts" aria-label="숏츠 공방">‹</a><h1>🎬 장면 공장</h1></header>
<main id="main"></main>
<script>
var CODE='';try{CODE=localStorage.getItem('pb-code')||'';}catch(e){}
var S={refs:[null,null,null,null],roles:['주인공 캐릭터','장소·배경','',''],sec:10,res:'720P',ratio:'9:16',voice:'mine',fast:false},ST=null,POLL={};
try{var sv=JSON.parse(localStorage.getItem('w3-opt')||'null');if(sv){S.sec=sv.sec||10;S.res=sv.res||'720P';S.ratio=sv.ratio||'9:16';S.voice=sv.voice||'mine';}}catch(e){}
function keep(){try{localStorage.setItem('w3-opt',JSON.stringify({sec:S.sec,res:S.res,ratio:S.ratio,voice:S.voice}));}catch(e){}}
function $(i){return document.getElementById(i);}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function toast(t){var d=document.createElement('div');d.className='toast';d.textContent=t;document.body.appendChild(d);setTimeout(function(){d.remove();},2800);}
function api(p,b){return fetch(p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.assign({code:CODE},b||{}))}).then(function(r){return r.json().catch(function(){return {ok:false,error:'서버 응답 오류 '+r.status};});}).catch(function(){return {ok:false,error:'네트워크 오류 — 다시 눌러 주세요'};});}
function chips(id,arr,cur,attr){return '<div class="chips" id="'+id+'">'+arr.map(function(a){return '<button class="chip'+(String(a[0])===String(cur)?' on':'')+'" data-'+attr+'="'+a[0]+'">'+a[1]+'</button>';}).join('')+'</div>';}
function bindChips(attr,fn){document.querySelectorAll('[data-'+attr+']').forEach(function(b){b.onclick=function(){var v=b.getAttribute('data-'+attr);document.querySelectorAll('[data-'+attr+']').forEach(function(x){x.classList.toggle('on',x===b);});fn(v);};});}
function shrink(file){return new Promise(function(ok,no){var u=URL.createObjectURL(file),im=new Image();im.onload=function(){var w=im.naturalWidth,h=im.naturalHeight,k=Math.min(1,1280/Math.max(w,h));var c=document.createElement('canvas');c.width=Math.round(w*k);c.height=Math.round(h*k);var x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);x.drawImage(im,0,0,c.width,c.height);URL.revokeObjectURL(u);ok(c.toDataURL('image/jpeg',0.9));};im.onerror=function(){no(new Error('그림을 열지 못했어요'));};im.src=u;});}
function start(){
  if(!CODE){$('main').innerHTML='<div class="gate">숏츠 공방에서 초대 코드를 먼저 넣어 주세요.<br><a class="big" href="/shorts">숏츠 공방으로</a></div>';return;}
  api('/shorts/w3/state').then(function(r){if(r.error==='not_owner'){$('main').innerHTML='<div class="gate">주인만 쓸 수 있는 화면이에요.</div>';return;}if(!r.ok){$('main').innerHTML='<div class="gate">'+esc(r.detail||r.error)+'</div>';return;}ST=r;if(!r.voiceMine&&S.voice==='mine')S.voice='Ethan';draw();});
}
function draw(){
  var h='<div class="card"><h2>참조 그림 (최대 4장)</h2><div class="refs" id="refs"></div><p class="note">1번은 캐릭터(공감툰 치비 등) — 외형이 영상 내내 유지돼요. 2~4번은 장소·소품 사진. 그림 밑 이름표를 바꾸면 AI가 그 역할로 씁니다. 투명 PNG 는 흰 바탕으로 바뀌어요.</p></div>'
    +'<div class="card"><h2>장면</h2><textarea id="scene" placeholder="예: 광저우 아파트 베란다, 아침. 주인공이 커피를 들고 밖을 보다가 카메라를 돌아보며 말한다. 멀리 광저우탑."></textarea>'
    +'<p class="lbl">대사 (선택, 한국어 ≤60자 — 캐릭터가 입 맞춰 말해요)</p><input type="text" id="say" maxlength="120" placeholder="예: 광저우 물가, 진짜 이 정도예요.">'
    +'<p class="lbl">목소리</p>'+chips('vc',[['mine','🎙 내 목소리'+(ST.voiceMine?'':' (미등록)')],['Ethan','남성 Ethan'],['Cherry','여성 Cherry']],S.voice,'voice')
    +'<p class="lbl">길이</p>'+chips('sc',[[5,'5초'],[10,'10초'],[15,'15초'],[20,'20초'],[30,'30초']],S.sec,'sec')
    +'<p class="lbl">화질 · 비율</p>'+chips('rs',[['480P','480P (반값)'],['720P','720P']],S.res,'res')+'<div style="height:6px"></div>'+chips('rt',[['9:16','세로 9:16'],['16:9','가로 16:9'],['1:1','정사각']],S.ratio,'ratio')
    +'<p class="lbl">속도</p>'+chips('fs',[['0','만상 3.0 (기본)'],['1','⚡ prime (빠름)']],S.fast?'1':'0','fast')
    +'<button class="big red" id="go">🎬 영상 만들기</button><p class="note" id="cnt"></p><div class="err" id="err"></div><div id="pend"></div></div>'
    +'<div class="card"><h2>만든 영상</h2><div id="gal" class="gal"></div><p class="note">소리(대사·효과음·배경음)까지 들어 있어요. 📥 저장 → 편집실 클립으로. 같은 캐릭터 그림을 계속 1번에 두면 시리즈가 됩니다.</p></div>';
  $('main').innerHTML=h;refs();
  bindChips('voice',function(v){S.voice=v;keep();});bindChips('sec',function(v){S.sec=+v;keep();counter();});bindChips('res',function(v){S.res=v;keep();counter();});bindChips('ratio',function(v){S.ratio=v;keep();});bindChips('fast',function(v){S.fast=v==='1';});
  $('go').onclick=make;counter();gallery();pending();
}
function refs(){var box=$('refs');box.innerHTML=S.refs.map(function(r,i){return '<div class="ref">'+(r?'<img src="'+r+'"><button class="x" data-x="'+i+'">✕</button>':'<span>+ '+(i===0?'캐릭터':'사진 '+i)+'</span><input type="file" accept="image/*" data-f="'+i+'">')+'<input class="tag" type="text" data-r="'+i+'" value="'+esc(S.roles[i])+'" placeholder="역할">'+'</div>';}).join('');
  box.querySelectorAll('[data-f]').forEach(function(inp){inp.onchange=function(){var f=inp.files&&inp.files[0],i=+inp.getAttribute('data-f');if(!f)return;shrink(f).then(function(d){S.refs[i]=d;refs();}).catch(function(e){$('err').textContent=e.message;});};});
  box.querySelectorAll('[data-x]').forEach(function(b){b.onclick=function(){S.refs[+b.getAttribute('data-x')]=null;refs();};});
  box.querySelectorAll('[data-r]').forEach(function(t){t.onchange=function(){S.roles[+t.getAttribute('data-r')]=t.value;};});}
function counter(){var pr=ST.price[S.res]||0.6;$('cnt').innerHTML='오늘 '+ST.used+' / '+ST.cap+'초 · 이 영상 약 <span class="cost">'+(pr*S.sec).toFixed(1)+'위안</span> ('+S.res+' '+pr+'위안/초, 실패하면 안 나가요) · 1~5분 걸림';}
function make(){
  var imgs=S.refs.filter(Boolean),roles=S.roles.filter(function(_,i){return S.refs[i];});
  if(!imgs.length&&!$('scene').value.trim()){$('err').textContent='장면 설명이나 그림을 넣어 주세요';return;}
  var b=$('go');b.disabled=true;b.innerHTML='<span class="spin">🎬</span> 연출 짜고 맡기는 중… (20~40초)';$('err').textContent='';
  api('/shorts/w3/make',{images:imgs,roles:roles,scene:$('scene').value,say:$('say').value,voice:S.voice,sec:S.sec,res:S.res,ratio:S.ratio,fast:S.fast}).then(function(r){b.disabled=false;b.textContent='🎬 영상 만들기';
    if(!r.ok){$('err').textContent=r.detail||r.error;return;}
    ST.used=r.used;counter();ST.pend.push({task:r.task,sec:S.sec,res:S.res,at:Date.now(),title:r.title});pending();toast('맡겼어요 — 1~5분. 화면 닫아도 돼요');});
}
function pending(){var box=$('pend');if(!box)return;
  box.innerHTML=ST.pend.map(function(p){return '<div class="pd" id="p_'+p.task+'"><span class="spin">⏳</span> '+esc(p.title||'')+' · '+p.sec+'초 '+p.res+' — <span>만드는 중…</span></div>';}).join('');
  ST.pend.forEach(function(p){if(!POLL[p.task])poll(p.task);});}
function poll(task){POLL[task]=1;
  api('/shorts/w3/poll',{task:task}).then(function(r){var el=$('p_'+task);
    if(r.ok&&r.status==='done'){delete POLL[task];ST.pend=ST.pend.filter(function(x){return x.task!==task;});toast('영상이 나왔어요 🎬');api('/shorts/w3/state').then(function(s){if(s.ok){ST=s;pending();gallery();counter();}});return;}
    if(r.ok&&(r.status==='failed'||r.status==='none')){delete POLL[task];ST.pend=ST.pend.filter(function(x){return x.task!==task;});if(el)el.innerHTML='❌ 실패: '+esc(r.detail||'작업을 못 찾음')+' (비용 안 나감)';api('/shorts/w3/state').then(function(s){if(s.ok){ST.used=s.used;counter();}});return;}
    if(el&&r.el)el.querySelector('span:last-child').textContent=(r.status==='PENDING'?'차례 기다리는 중':'만드는 중')+'… '+r.el+'초';
    setTimeout(function(){poll(task);},12000);});}
function gallery(){var g=$('gal');if(!g)return;
  if(!ST.list.length){g.innerHTML='<p class="note">아직 없어요.</p>';return;}
  g.innerHTML=ST.list.map(function(x,i){return '<div class="it"><video src="'+esc(x.url)+'"'+(x.poster?' poster="'+esc(x.poster)+'"':'')+' controls playsinline preload="none"></video><small><b>'+esc(x.title||'')+'</b> · '+x.sec+'초 · '+esc(x.res)+' · '+new Date(x.at).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit'})+(x.say?'<br>🗣 '+esc(x.say):'')+(x.zh?'<details><summary>AI 연출 보기</summary><span style="font-size:11px;white-space:pre-wrap">'+esc(x.zh)+'</span></details>':'')+'</small><div class="mini"><button data-sv="'+i+'">📥 저장</button><button data-re="'+i+'">↻ 같은 설정으로</button><button data-dl="'+i+'">🗑</button></div></div>';}).join('');
  g.querySelectorAll('[data-sv]').forEach(function(b){b.onclick=function(){var x=ST.list[+b.getAttribute('data-sv')];b.disabled=true;b.textContent='받는 중…';
    fetch(x.url).then(function(r){return r.blob();}).then(function(bl){b.disabled=false;b.textContent='📥 저장';var f=new File([bl],'story-'+x.at+'.mp4',{type:'video/mp4'});
      if(navigator.canShare&&navigator.canShare({files:[f]}))navigator.share({files:[f]}).catch(function(){});else{var a=document.createElement('a');a.href=URL.createObjectURL(bl);a.download=f.name;a.click();}}).catch(function(){b.disabled=false;b.textContent='📥 다시';toast('받기 실패');});};});
  g.querySelectorAll('[data-re]').forEach(function(b){b.onclick=function(){var x=ST.list[+b.getAttribute('data-re')];$('scene').value=x.scene||'';$('say').value=x.say||'';window.scrollTo({top:0,behavior:'smooth'});toast('장면·대사를 채웠어요 — 그림은 다시 골라 주세요');};});
  g.querySelectorAll('[data-dl]').forEach(function(b){b.onclick=function(){var x=ST.list[+b.getAttribute('data-dl')];if(!confirm('이 영상을 지울까요?'))return;api('/shorts/w3/del',{k:x.k}).then(function(s){if(s.ok){ST.list=s.list;gallery();}});};});}
start();
</script></body></html>`;
