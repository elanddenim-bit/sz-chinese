// =========================================================
// 🎞 사진 한 장 → 시네마틱 영상 (주인 전용, 숏츠 공방 버튼) — 通义万相 图生视频(빠른판 wan2.6-i2v-flash 소리 자동 / 고품질 wan2.7-i2v)
//  서버: /shorts/cine/state · make · poll · del (shorts.js cine*). 결과는 R2 → 저장·공유해서 편집실 클립으로
// =========================================================
export const CINE_HTML = String.raw`<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#1664B0">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="시네마틱">
<link rel="apple-touch-icon" href="/shorts-180.png"><link rel="icon" href="/shorts-192.png">
<title>사진 → 시네마틱 영상</title>
<style>
:root{--sky:#1664B0;--bg:#EFE8DE;--card:#F7F2EA;--ink:#1A2330;--ink2:#5E6672;--line:#D9CEBD;--red:#D21624;--soft:#E6DCCB;--ok:#1F7A4D}
@media (prefers-color-scheme:dark){:root{--bg:#141A22;--card:#1C2430;--ink:#EDE6DA;--ink2:#9AA3AE;--line:#2C3644;--soft:#253041;--ok:#5CC08C}}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,"Apple SD Gothic Neo","PingFang SC",system-ui,sans-serif;-webkit-text-size-adjust:100%}
header{background:var(--sky);color:#fff;padding:calc(env(safe-area-inset-top) + 14px) 16px 14px;border-bottom:3px solid var(--red);display:flex;align-items:center;gap:12px}
header h1{margin:0;font-size:19px}a.back{color:#fff;text-decoration:none;font-size:20px}
main{max-width:640px;margin:0 auto;padding:14px 16px 110px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:12px}
.card h2{margin:0 0 8px;font-size:15.5px}.lbl{font-size:12.5px;color:var(--ink2);margin:10px 0 4px}
input[type=text],textarea{width:100%;font:inherit;font-size:16px;padding:9px 10px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink)}
textarea{min-height:52px;resize:vertical}
.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{border:1px solid var(--line);background:transparent;color:var(--ink);border-radius:999px;padding:5px 11px;font:inherit;font-size:13px}.chip.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.big{display:block;width:100%;border:0;border-radius:12px;background:var(--sky);color:#fff;font:inherit;font-weight:700;font-size:16px;padding:14px;margin-top:10px;text-align:center}.big:disabled{opacity:.5}
.big.ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}.big.red{background:var(--red)}.big.ok{background:var(--ok)}
.pick{display:block;border:2px dashed var(--line);border-radius:14px;padding:18px;text-align:center;color:var(--ink2)}.pick input{display:none}.pick b{display:block;color:var(--ink);font-size:16px;margin-bottom:2px}
.idea{background:var(--soft);border-radius:10px;padding:10px;margin-top:8px;font-size:14px}
.idea .pr{font-family:ui-monospace,Menlo,monospace;font-size:12px;white-space:pre-wrap;background:var(--bg);border-radius:8px;padding:8px;margin:6px 0;max-height:150px;overflow:auto}
.sc{display:grid;grid-template-columns:96px 1fr;gap:10px;border-top:1px solid var(--line);padding:12px 0}.sc:first-of-type{border-top:0}
.th{position:relative;width:96px;aspect-ratio:9/16;border-radius:8px;overflow:hidden;background:var(--soft)}.th img{width:100%;height:100%;object-fit:cover;display:block}
.th i{position:absolute;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:var(--red);border:2px solid #fff}
.sc .hd{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--ink2);margin-bottom:6px;flex-wrap:wrap}.sc .hd b{color:var(--sky)}
.sc input[type=text]{font-size:14.5px;padding:7px 9px;margin-bottom:6px}
.mini{display:flex;gap:6px;flex-wrap:wrap}.mini button{border:1px solid var(--line);background:transparent;color:var(--ink);border-radius:8px;padding:5px 9px;font:inherit;font-size:12.5px}
.row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:4px 0}.row span{font-size:12px;color:var(--ink2);min-width:48px}
.note{font-size:12.5px;color:var(--ink2);margin:6px 0 0}.err{color:var(--red);font-size:13.5px;margin-top:8px;white-space:pre-wrap}
.prog{font-size:14px;margin:8px 0}.bar{height:6px;background:var(--soft);border-radius:3px;overflow:hidden}.bar i{display:block;height:100%;background:var(--sky);width:0}
canvas.pv{width:62%;max-width:300px;display:block;margin:10px auto;border-radius:10px;background:#000}
video.out{width:70%;max-width:320px;display:block;margin:10px auto;border-radius:10px;background:#000}
.dock{position:sticky;bottom:0;z-index:5;margin:0 -16px;padding:8px 16px calc(10px + env(safe-area-inset-bottom));background:linear-gradient(rgba(239,232,222,0),var(--bg) 35%);display:flex;gap:8px}
.dock .big{margin-top:0}
@media (prefers-color-scheme:dark){.dock{background:linear-gradient(rgba(20,26,34,0),var(--bg) 35%)}}
.toast{position:fixed;left:50%;bottom:calc(84px + env(safe-area-inset-bottom));transform:translateX(-50%);background:var(--ink);color:var(--bg);padding:10px 16px;border-radius:999px;font-size:14px;z-index:9;max-width:90vw;text-align:center}
.spin{display:inline-block;animation:sp 1.2s linear infinite}@keyframes sp{to{transform:rotate(360deg)}}
.gate{padding:40px 0;text-align:center}
</style>
<style>.pv{width:100%;max-height:360px;object-fit:contain;border-radius:10px;background:#000;display:block;margin-top:8px}
.gal{display:grid;grid-template-columns:1fr 1fr;gap:10px}.gal .it{background:var(--soft);border-radius:10px;padding:6px}.gal video{width:100%;border-radius:8px;background:#000;display:block}
.gal small{display:block;color:var(--ink2);font-size:11.5px;margin:4px 2px}.pd{background:var(--soft);border-radius:10px;padding:10px;margin-top:8px;font-size:14px}</style>
</head><body>
<header><a class="back" href="/shorts" aria-label="숏츠 공방">‹</a><h1>🎞 사진 → 시네마틱 영상</h1></header>
<main id="main"></main>
<script>
var CODE='';try{CODE=localStorage.getItem('pb-code')||'';}catch(e){}
var S={mood:'cine',model:'hq',sec:5,img:null},ST=null,POLL={};
try{var sv=JSON.parse(localStorage.getItem('cine-opt')||'null');if(sv){S.mood=sv.mood||'cine';S.model=sv.model||'hq';}}catch(e){}
function keep(){try{localStorage.setItem('cine-opt',JSON.stringify({mood:S.mood,model:S.model}));}catch(e){}}
function $(i){return document.getElementById(i);}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function toast(t){var d=document.createElement('div');d.className='toast';d.textContent=t;document.body.appendChild(d);setTimeout(function(){d.remove();},2800);}
function api(p,b){return fetch(p,{method:'POST',headers:{'content-type':'application/json','x-code':CODE},body:JSON.stringify(Object.assign({code:CODE},b||{}))}).then(function(r){return r.json().catch(function(){return {ok:false,error:'서버 응답 오류 '+r.status};});}).catch(function(){return {ok:false,error:'네트워크 오류 — 다시 눌러 주세요'};});}
function chips(id,arr,cur,attr){return '<div class="chips" id="'+id+'">'+arr.map(function(a){return '<button class="chip'+(a[0]===cur?' on':'')+'" data-'+attr+'="'+a[0]+'">'+a[1]+'</button>';}).join('')+'</div>';}
function bindChips(attr,fn){document.querySelectorAll('[data-'+attr+']').forEach(function(b){b.onclick=function(){var v=b.getAttribute('data-'+attr);document.querySelectorAll('[data-'+attr+']').forEach(function(x){x.classList.toggle('on',x===b);});fn(v);};});}
function shrink(file){return new Promise(function(ok,no){var u=URL.createObjectURL(file),im=new Image();im.onload=function(){var w=im.naturalWidth,h=im.naturalHeight,k=Math.min(1,1600/Math.max(w,h));var c=document.createElement('canvas');c.width=Math.round(w*k);c.height=Math.round(h*k);c.getContext('2d').drawImage(im,0,0,c.width,c.height);URL.revokeObjectURL(u);ok({data:c.toDataURL('image/jpeg',0.9),w:c.width,h:c.height});};im.onerror=function(){no(new Error('사진을 열지 못했어요'));};im.src=u;});}
function start(){
  if(!CODE){$('main').innerHTML='<div class="gate">숏츠 공방에서 초대 코드를 먼저 넣어 주세요.<br><a class="big" href="/shorts">숏츠 공방으로</a></div>';return;}
  api('/shorts/cine/state').then(function(r){if(r.error==='not_owner'){$('main').innerHTML='<div class="gate">주인만 쓸 수 있는 화면이에요.</div>';return;}if(!r.ok){$('main').innerHTML='<div class="gate">'+esc(r.detail||r.error)+'</div>';return;}ST=r;draw();});
}
function draw(){
  var moods=Object.keys(ST.moods).map(function(k){return [k,ST.moods[k]];});
  var h='<div class="card"><h2>사진 고르기</h2><label class="pick"><input type="file" id="ph" accept="image/*"><b>📷 사진 한 장</b>세로 사진이면 숏츠에 바로 쓰기 좋아요 · 영상은 사진 비율 그대로</label><div id="pvBox"></div></div>'
    +'<div class="card"><h2>어떻게 움직일까요?</h2>'+chips('md',moods,S.mood,'mood')
    +'<p class="lbl">추가 연출 (선택, 한국어 OK)</p><input type="text" id="extra" placeholder="예: 커피잔에서 김이 오르고 창밖 사람들이 지나감">'
    +'<p class="lbl">품질</p>'+chips('mdl',[['hq','💎 고품질 (wan2.7, 추천)'],['flash','⚡ 빠른판 (소리 자동·움직임 단순)']],S.model,'model')
    +'<p class="lbl">길이</p>'+chips('sc',[[5,'5초'],[10,'10초 (비용 2배)']],S.sec,'sec')
    +'<button class="big" id="go">🎞 영상 만들기</button><p class="note" id="cnt"></p><div class="err" id="err"></div><div id="pend"></div></div>'
    +'<div class="card"><h2>만든 영상</h2><div id="gal" class="gal"></div><p class="note">저장 → 편집실에서 클립으로 고르면 숏츠 인트로·전환 컷으로 쓸 수 있어요. 소리는 AI가 만든 효과음·배경음이에요.</p></div>';
  $('main').innerHTML=h;
  bindChips('mood',function(v){S.mood=v;keep();});bindChips('model',function(v){S.model=v;keep();});bindChips('sec',function(v){S.sec=+v;});
  $('ph').onchange=function(){var f=this.files&&this.files[0];if(!f)return;$('err').textContent='';shrink(f).then(function(x){S.img=x;$('pvBox').innerHTML='<img class="pv" src="'+x.data+'">'+(x.w>x.h?'<p class="note">가로 사진이에요 — 영상도 가로로 나와요(숏츠엔 편집실 ‘전체 보기’로).</p>':'');}).catch(function(e){$('err').textContent=e.message;});};
  $('go').onclick=make;
  counter();gallery();pending();
}
function counter(){$('cnt').textContent='오늘 '+ST.used+' / '+ST.cap+'개 · 720P · 실패하면 개수·비용 안 나가요';}
function make(){
  if(!S.img){$('err').textContent='사진을 먼저 골라 주세요';return;}
  var b=$('go');b.disabled=true;b.innerHTML='<span class="spin">🎞</span> 맡기는 중…';$('err').textContent='';
  b.innerHTML='<span class="spin">🎬</span> 사진 보고 연출 짜는 중…';api('/shorts/cine/make',{image:S.img.data,mood:S.mood,model:S.model,sec:S.sec,prompt:$('extra').value}).then(function(r){b.disabled=false;b.textContent='🎞 영상 만들기';
    if(!r.ok){$('err').textContent=r.detail||r.error;return;}
    ST.used=r.used;counter();ST.pend.push({task:r.task,model:S.model,mood:S.mood,at:Date.now()});pending();toast('맡겼어요 — 1~5분 걸려요. 화면 닫아도 돼요');});
}
function pending(){
  var box=$('pend');if(!box)return;
  box.innerHTML=ST.pend.map(function(p){return '<div class="pd" id="p_'+p.task+'"><span class="spin">⏳</span> '+esc(ST.moods[p.mood]||'')+' · '+(p.model==='hq'?'고품질':'빠른판')+' — <span>만드는 중…</span></div>';}).join('');
  ST.pend.forEach(function(p){if(!POLL[p.task])poll(p.task);});
}
function poll(task){
  POLL[task]=1;
  api('/shorts/cine/poll',{task:task}).then(function(r){
    var el=$('p_'+task);
    if(r.ok&&r.status==='done'){delete POLL[task];ST.pend=ST.pend.filter(function(x){return x.task!==task;});toast('영상이 나왔어요 🎞');api('/shorts/cine/state').then(function(s){if(s.ok){ST=s;pending();gallery();counter();}});return;}
    if(r.ok&&(r.status==='failed'||r.status==='none')){delete POLL[task];ST.pend=ST.pend.filter(function(x){return x.task!==task;});if(el)el.innerHTML='❌ 실패: '+esc(r.detail||'작업을 못 찾음')+' (개수 안 셈)';api('/shorts/cine/state').then(function(s){if(s.ok){ST.used=s.used;counter();}});return;}
    if(el&&r.el)el.querySelector('span:last-child').textContent=(r.status==='PENDING'?'차례 기다리는 중':'만드는 중')+'… '+r.el+'초';
    setTimeout(function(){poll(task);},8000);
  });
}
function gallery(){
  var g=$('gal');if(!g)return;
  if(!ST.list.length){g.innerHTML='<p class="note">아직 없어요.</p>';return;}
  g.innerHTML=ST.list.map(function(x,i){return '<div class="it"><video src="'+esc(x.url)+'" poster="'+esc(x.srcUrl)+'" controls playsinline preload="none"></video><small>'+esc(ST.moods[x.mood]||'')+' · '+(x.model==='hq'?'고품질':'빠른판')+' · '+x.sec+'초<br>'+new Date(x.at).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit'})+(x.zh?'<details><summary style="font-size:11px;color:var(--ink2)">AI 연출 보기</summary><span style="font-size:11px">'+esc(x.zh)+'</span></details>':'')+'</small><div class="mini"><button data-sv="'+i+'">📥 저장</button><button data-dl="'+i+'">🗑</button></div></div>';}).join('');
  g.querySelectorAll('[data-sv]').forEach(function(b){b.onclick=function(){var x=ST.list[+b.getAttribute('data-sv')];b.disabled=true;b.textContent='받는 중…';
    fetch(x.url).then(function(r){return r.blob();}).then(function(bl){b.disabled=false;b.textContent='📥 저장';var f=new File([bl],'cine-'+x.at+'.mp4',{type:'video/mp4'});
      if(navigator.canShare&&navigator.canShare({files:[f]}))navigator.share({files:[f]}).catch(function(){});else{var a=document.createElement('a');a.href=URL.createObjectURL(bl);a.download=f.name;a.click();}}).catch(function(){b.disabled=false;b.textContent='📥 다시';toast('받기 실패 — 다시 눌러 주세요');});};});
  g.querySelectorAll('[data-dl]').forEach(function(b){b.onclick=function(){var x=ST.list[+b.getAttribute('data-dl')];if(!confirm('이 영상을 지울까요?'))return;api('/shorts/cine/del',{k:x.k}).then(function(s){if(s.ok){ST=Object.assign(ST,{list:s.list});gallery();}});};});
}
start();
</script></body></html>`;
