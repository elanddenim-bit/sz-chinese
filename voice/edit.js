// =========================================================
// 🎥 편집실 — 내가 찍은 클립으로 숏츠 만들기 (주인 전용, 숏츠 공방과 같은 초안·업로드)
//  원본 영상은 폰 밖으로 나가지 않는다: 폰이 클립마다 작은 캡처(JPEG)만 뽑아 /shorts/plan 에 보내고,
//  AI 가 정한 구간·자막·내레이션을 폰 캔버스에서 렌더링 → 완성본만 /shorts/save → /shorts/yt/upload
// =========================================================
export const EDIT_HTML = String.raw`<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#1664B0">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="편집실">
<link rel="apple-touch-icon" href="/icon-180.png">
<title>편집실</title>
<style>
:root{--sky:#1664B0;--bg:#EFE8DE;--card:#F7F2EA;--ink:#1A2330;--ink2:#5E6672;--line:#D9CEBD;--red:#D21624;--soft:#E6DCCB;--ok:#1F7A4D}
@media (prefers-color-scheme:dark){:root{--bg:#141A22;--card:#1C2430;--ink:#EDE6DA;--ink2:#9AA3AE;--line:#2C3644;--soft:#253041;--ok:#5CC08C}}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,"Apple SD Gothic Neo","PingFang SC",system-ui,sans-serif;-webkit-text-size-adjust:100%}
header{background:var(--sky);color:#fff;padding:calc(env(safe-area-inset-top) + 14px) 16px 14px;border-bottom:3px solid var(--red);display:flex;align-items:center;gap:12px}
header h1{margin:0;font-size:19px}a.back{color:#fff;text-decoration:none;font-size:20px}
main{max-width:640px;margin:0 auto;padding:14px 16px 60px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:12px}
.card h2{margin:0 0 8px;font-size:15.5px}.lbl{font-size:12.5px;color:var(--ink2);margin:10px 0 4px}
input[type=text],textarea{width:100%;font:inherit;font-size:16px;padding:10px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink)}
textarea{min-height:56px;resize:vertical}
.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{border:1px solid var(--line);background:transparent;color:var(--ink);border-radius:999px;padding:6px 12px;font:inherit;font-size:13.5px}.chip.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.big{display:block;width:100%;border:0;border-radius:12px;background:var(--sky);color:#fff;font:inherit;font-weight:700;font-size:16px;padding:14px;margin-top:10px;text-align:center;text-decoration:none}.big:disabled{opacity:.5}
.big.ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}.big.red{background:var(--red)}
.pick{display:block;border:2px dashed var(--line);border-radius:14px;padding:22px;text-align:center;color:var(--ink2)}.pick input{display:none}.pick b{display:block;color:var(--ink);font-size:16px;margin-bottom:4px}
.clips{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:10px}.clips div{position:relative}.clips img{width:100%;aspect-ratio:9/16;object-fit:cover;border-radius:8px;background:var(--soft);display:block}
.clips span{position:absolute;left:4px;bottom:4px;background:rgba(0,0,0,.6);color:#fff;font-size:11px;padding:1px 5px;border-radius:5px}
.seg{display:grid;grid-template-columns:72px 1fr;gap:10px;border-top:1px solid var(--line);padding:12px 0}.seg:first-of-type{border-top:0}
.seg img{width:72px;height:128px;object-fit:cover;border-radius:8px;background:var(--soft);display:block}
.seg .hd{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--ink2);margin-bottom:6px;flex-wrap:wrap}.seg .hd b{color:var(--sky)}
.seg input[type=number]{width:62px;font:inherit;font-size:15px;padding:5px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink)}
.seg input[type=text],.seg textarea{font-size:14.5px;padding:7px 9px;margin-bottom:6px}
.mini{display:flex;gap:6px;flex-wrap:wrap}.mini button{border:1px solid var(--line);background:transparent;color:var(--ink);border-radius:8px;padding:5px 9px;font:inherit;font-size:12.5px}
.note{font-size:12.5px;color:var(--ink2);margin:6px 0 0}.err{color:var(--red);font-size:13.5px;margin-top:8px;white-space:pre-wrap}
.prog{font-size:14px;margin:8px 0}.bar{height:6px;background:var(--soft);border-radius:3px;overflow:hidden}.bar i{display:block;height:100%;background:var(--sky);width:0}
canvas.pv{width:60%;max-width:300px;display:block;margin:10px auto;border-radius:10px;background:#000}
video.out,video.prev{width:70%;max-width:320px;display:block;margin:10px auto;border-radius:10px;background:#000}
#stash{position:fixed;left:-10px;top:0;width:2px;height:2px;overflow:hidden;opacity:.01}
.toast{position:fixed;left:50%;bottom:calc(20px + env(safe-area-inset-bottom));transform:translateX(-50%);background:var(--ink);color:var(--bg);padding:10px 16px;border-radius:999px;font-size:14px;z-index:9;max-width:90vw;text-align:center}
.spin{display:inline-block;animation:sp 1.2s linear infinite}@keyframes sp{to{transform:rotate(360deg)}}
.gate{padding:40px 0;text-align:center}
</style></head><body>
<header><a class="back" href="/shorts" aria-label="숏츠 공방">‹</a><h1>🎥 편집실</h1></header>
<main id="main"></main><div id="stash"></div>
<script>
var CODE='';try{CODE=localStorage.getItem('pb-code')||'';}catch(e){}
var CLIPS=[],D=null,SEC=45,ANG='mix',NARR={},RECING=null,MIC=null,MREC=null,AC=null,BUS=null,BGM=null,CH=null,RUN=null,SECMAN=false;try{ANG=localStorage.getItem('sh-ang')||'mix';}catch(e){}
var ANGS=[['mix','골고루'],['compare','🇰🇷 한국이랑 비교'],['price','💰 원화로 얼마?'],['tip','✈️ 여행 꿀팁'],['shock','😮 문화 충격'],['food','🍜 한국인 입맛'],['life','🏠 주재원 현실']];
function $(i){return document.getElementById(i);}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function toast(t){var d=document.createElement('div');d.className='toast';d.textContent=t;document.body.appendChild(d);setTimeout(function(){d.remove();},3200);}
function api(p,b){b=b||{};b.code=CODE;return fetch(p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json().catch(function(){return {error:'서버 응답 오류 '+r.status};});});}
function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}
function fmt(s){return (Math.round(s*10)/10).toFixed(1);}
var QID=(location.search.match(/[?&]id=([^&]+)/)||[])[1]||'';

// ---------- 1) 클립 고르기 ----------
function start(){
  if(!CODE){$('main').innerHTML='<div class="gate">숏츠 공방에서 초대 코드를 먼저 넣어 주세요.<br><a class="big" href="/shorts">숏츠 공방으로</a></div>';return;}
  var h='';
  if(QID)h+='<div class="card"><h2>이어서 편집</h2><p class="note">원본 영상은 폰에만 있어서 서버엔 없어요. 이 초안에 썼던 클립을 <b>같은 순서로</b> 다시 골라 주세요.</p></div>';
  h+='<div class="card"><label class="pick"><input type="file" id="files" accept="video/*" multiple><b>📂 영상 클립 고르기</b>여러 개 한 번에 · 5~15초짜리가 좋아요<br>원본은 서버로 올라가지 않아요</label><div class="clips" id="clips"></div></div>';
  if(!QID){
    h+='<div class="card"><h2>어떤 영상인가요?</h2><input type="text" id="topic" placeholder="예: 永庆坊 산책, 早茶 집 첫 방문 (짧게)"><p class="lbl">한국 시청자 각도</p><div class="chips">'+ANGS.map(function(a){return '<button class="chip'+(a[0]===ANG?' on':'')+'" data-ang="'+a[0]+'">'+a[1]+'</button>';}).join('')+'</div>'
      +'<p class="lbl">길이</p><div class="chips">'+[15,20,30,45,60].map(function(s){return '<button class="chip'+(s===SEC?' on':'')+'" data-sec="'+s+'">'+s+'초</button>';}).join('')+'</div><p class="note" id="secNote"></p>'
      +'<button class="big" id="planBtn" disabled>🤖 AI 편집 계획 받기</button><div class="prog" id="pp"></div><div class="err" id="pe"></div></div>';
  }else h+='<button class="big" id="resumeBtn" disabled>이 클립으로 편집 이어가기</button><div class="err" id="pe"></div>';
  $('main').innerHTML=h;
  $('files').onchange=function(){addFiles(this.files);this.value='';};
  document.querySelectorAll('[data-ang]').forEach(function(b){b.onclick=function(){ANG=b.getAttribute('data-ang');try{localStorage.setItem('sh-ang',ANG);}catch(e){}document.querySelectorAll('[data-ang]').forEach(function(x){x.classList.toggle('on',x===b);});};});
  document.querySelectorAll('[data-sec]').forEach(function(b){b.onclick=function(){SEC=+b.getAttribute('data-sec');SECMAN=true;document.querySelectorAll('[data-sec]').forEach(function(x){x.classList.toggle('on',x===b);});};});
  if($('planBtn'))$('planBtn').onclick=makePlan;
  if($('resumeBtn'))$('resumeBtn').onclick=resume;
}
function mkVideo(url){var v=document.createElement('video');v.muted=true;v.playsInline=true;v.setAttribute('playsinline','');v.setAttribute('webkit-playsinline','');v.preload='auto';v.src=url;$('stash').appendChild(v);return v;}
function waitEv(el,ev,ms){return new Promise(function(ok){var done=false;function f(){if(done)return;done=true;el.removeEventListener(ev,f);ok(true);}el.addEventListener(ev,f);setTimeout(function(){if(!done){done=true;el.removeEventListener(ev,f);ok(false);}},ms||4000);});}
async function seekTo(v,t){if(Math.abs(v.currentTime-t)<0.05&&v.readyState>=2)return;v.currentTime=t;await waitEv(v,'seeked',4000);}
function grab(v,max,q){var w=v.videoWidth,h=v.videoHeight;if(!w||!h)return '';var s=Math.min(1,max/Math.max(w,h));var c=document.createElement('canvas');c.width=Math.round(w*s);c.height=Math.round(h*s);c.getContext('2d').drawImage(v,0,0,c.width,c.height);try{return c.toDataURL('image/jpeg',q||0.7);}catch(e){return '';}}
async function addFiles(fl){
  var arr=Array.prototype.slice.call(fl||[]);if(!arr.length)return;
  for(var i=0;i<arr.length&&CLIPS.length<20;i++){
    var f=arr[i],url=URL.createObjectURL(f),v=mkVideo(url);
    var c={file:f,url:url,v:v,name:f.name,dur:0,thumb:'',src:null,gain:null};CLIPS.push(c);renderClips();
    await waitEv(v,'loadedmetadata',8000);c.dur=v.duration&&isFinite(v.duration)?v.duration:0;
    try{var p=v.play();if(p&&p.then)await p.catch(function(){});v.pause();}catch(e){}
    await seekTo(v,Math.min(0.5,c.dur/2));c.thumb=grab(v,240,0.6);renderClips();
  }
  var ok=CLIPS.length&&CLIPS.every(function(c){return c.dur>0;});
  // 재료(클립 합계)에 맞는 길이 추천 — 모자란데 길게 잡으면 같은 장면이 반복됨
  var tot=CLIPS.reduce(function(a,c){return a+c.dur;},0),rec=tot<18?15:tot<26?20:tot<40?30:tot<55?45:60;
  if(ok&&$('secNote')){if(!SECMAN){SEC=rec;document.querySelectorAll('[data-sec]').forEach(function(x){x.classList.toggle('on',+x.getAttribute('data-sec')===SEC);});}
    $('secNote').textContent='클립 합계 '+Math.round(tot)+'초 → '+rec+'초 추천'+(SEC>rec?' (지금 고른 길이는 같은 장면이 반복될 수 있어요)':'');}
  if($('planBtn'))$('planBtn').disabled=!ok;if($('resumeBtn'))$('resumeBtn').disabled=!ok;
}
function renderClips(){$('clips').innerHTML=CLIPS.map(function(c,i){return '<div>'+(c.thumb?'<img src="'+c.thumb+'">':'<img>')+'<span>#'+(i+1)+' · '+(c.dur?fmt(c.dur)+'초':'…')+'</span></div>';}).join('');}

// ---------- 2) AI 계획 ----------
async function makePlan(){
  var b=$('planBtn'),pp=$('pp'),pe=$('pe');b.disabled=true;pe.textContent='';
  var tot=CLIPS.reduce(function(a,c){return a+c.dur;},0),budget=36,frames=[];
  for(var i=0;i<CLIPS.length;i++){
    var c=CLIPS[i],n=Math.max(2,Math.min(8,Math.round(budget*c.dur/Math.max(1,tot))));
    for(var k=0;k<n;k++){var t=c.dur*(k+0.5)/n;pp.textContent='장면 캡처 중… 클립 '+(i+1)+'/'+CLIPS.length;await seekTo(c.v,t);var img=grab(c.v,384,0.62);if(img)frames.push({c:i,t:+t.toFixed(1),img:img});}
  }
  frames=frames.slice(0,40);
  pp.innerHTML='<span class="spin">🤖</span> AI가 장면을 보고 편집 계획을 짜는 중… (20~40초)';
  var r=await api('/shorts/plan',{topic:$('topic').value.trim(),sec:SEC,angle:ANG,clips:CLIPS.map(function(c){return {dur:c.dur,name:c.name};}),frames:frames});
  if(!r.ok){pp.textContent='';pe.textContent=r.detail||r.error||'실패';b.disabled=false;return;}
  D=r.draft;NARR={};editor();
}
async function resume(){
  var r=await api('/shorts/load',{id:QID});if(!r.ok){$('pe').textContent=r.detail||r.error;return;}
  D=r.draft;if(!D.clips||D.clips.length!==CLIPS.length)toast('클립 수가 처음과 달라요('+(D.clips?D.clips.length:0)+'개). 구간을 확인해 주세요.');
  NARR={};editor();
}

// ---------- 3) 편집 ----------
var SPEEDS=[0.5,1,1.5,2];
function segLen(s){return Math.max(0.3,(s.e-s.s)/(s.sp||1));}
function segHtml(s,i){
  var c=CLIPS[s.clip],sp=s.sp||1;
  return '<div class="seg" data-i="'+i+'"><img id="st'+i+'" src="'+(c&&c.thumb||'')+'"><div>'
    +'<div class="hd"><b>#'+(i+1)+'</b> 클립 <select data-f="clip">'+CLIPS.map(function(x,k){return '<option value="'+k+'"'+(k===s.clip?' selected':'')+'>'+(k+1)+'</option>';}).join('')+'</select>'
    +' <input type="number" step="0.1" min="0" data-f="s" value="'+fmt(s.s)+'">~<input type="number" step="0.1" min="0" data-f="e" value="'+fmt(s.e)+'">초'
    +' <select data-f="sp" aria-label="속도">'+SPEEDS.map(function(x){return '<option value="'+x+'"'+(x===sp?' selected':'')+'>'+x+'×</option>';}).join('')+'</select></div>'
    +'<input type="text" data-f="cap" value="'+esc(s.cap)+'" placeholder="화면 큰 글씨 (비워도 돼요)">'
    +'<textarea data-f="say" placeholder="내레이션 (비우면 원본 소리만)">'+esc(s.say)+'</textarea>'
    +((D.opts&&D.opts.voice==='rec')?'<div class="mini" style="margin-bottom:6px"><button data-a="rec" style="border-color:var(--red);color:var(--red)">'+(RECING===s?'■ 정지':'🎙 녹음')+'</button>'+(s._rec?'<button data-a="hear">▶ 들어보기</button><span class="note" style="margin:0;align-self:center">'+fmt(s._rec.dur)+'초 녹음됨</span>':'')+'</div>':'')
    +'<div class="mini"><button data-a="pv">▶ 보기</button><button data-a="up">▲</button><button data-a="dn">▼</button><button data-a="dup">복제</button><button data-a="del">✕</button></div></div></div>';
}
function chipRow(key,list,cur){return '<div class="chips">'+list.map(function(x){return '<button class="chip'+(cur===x[0]?' on':'')+'" data-o="'+key+'" data-v="'+x[0]+'">'+x[1]+'</button>';}).join('')+'</div>';}
function editor(){
  var o=D.opts||{};D.opts=o;
  if(!o.fit)o.fit='crop';if(o.orig==null)o.orig=0.3;if(o.narr==null)o.narr=true;if(o.subs==null)o.subs=true;
  if(o.tag==null)o.tag='📍 광저우 广州';if(o.end==null)o.end=true;if(o.bgv==null)o.bgv=0.12;
  if(CH===null){CH='';api('/shorts/yt/status').then(function(y){CH=(y&&y.channel)||'';}).catch(function(){});}
  var tot=D.scenes.reduce(function(a,s){return a+segLen(s);},0)+(o.end?2:0);
  var h='<div class="card"><h2>제목·설명</h2><input type="text" id="tt" value="'+esc(D.title)+'"><p class="lbl">설명</p><textarea id="ds">'+esc(D.description)+'</textarea><p class="lbl">태그(쉼표)</p><input type="text" id="tg" value="'+esc((D.tags||[]).join(', '))+'"></div>';
  h+='<div class="card"><h2>구간 '+D.scenes.length+'개 · 약 '+Math.round(tot)+'초</h2><p class="note" style="margin:0 0 6px">내레이션이 구간보다 길면 그만큼 늘어나요. 속도 0.5×=슬로모션, 2×=빨리감기.</p><video class="prev" id="pv" playsinline muted controls style="display:none"></video>'+D.scenes.map(segHtml).join('')+'<button class="big ghost" id="addSeg">＋ 구간 추가</button></div>';
  h+='<div class="card"><h2>설정</h2><p class="lbl">화면</p>'+chipRow('fit',[['crop','꽉 채우기(가운데 자르기)'],['full','전체 보기(흐린 배경)']],o.fit)
   +'<p class="lbl">원본 소리 <span style="font-weight:400">(내레이션 나올 땐 자동으로 줄어요)</span></p>'+chipRow('orig',[[0,'끄기'],[0.3,'작게'],[1,'그대로']],o.orig)
   +'<p class="lbl">내레이션 목소리</p>'+chipRow('voice',[['Cherry','👩 AI 여성'],['Ethan','👨 AI 남성'],['mine','🗣 내 목소리(AI 복제)'],['rec','🎙 직접 녹음']],o.voice||'Cherry')
   +((o.voice==='rec')?'<p class="note">구간마다 🎙 녹음을 눌러 직접 말하세요. 녹음은 이 화면을 닫으면 사라져요.</p>':(o.voice==='mine')?'<p class="note">실전 중국어 발음 탭에서 등록한 목소리로 한국어를 읽어요. 등록 전이면 AI 여성 목소리로 나와요.</p>':'')
   +'<p class="lbl">내레이션 · 자막 · 끝 화면</p><div class="chips"><button class="chip'+(o.narr?' on':'')+'" data-o="narr">🔊 내레이션</button><button class="chip'+(o.subs?' on':'')+'" data-o="subs">💬 자막</button><button class="chip'+(o.end?' on':'')+'" data-o="end">🔔 끝에 구독 카드(2초)</button></div>'
   +'<p class="lbl">영상 속 말 자막 <span style="font-weight:400">(현지인 중국어·광둥어 → 한국어)</span></p><div class="chips"><button class="chip'+(o.osub?' on':'')+'" data-o="osub">🗣 영상 속 말 자막</button></div>'+(o.osub?osubHtml():'')
   +'<p class="lbl">배경음악</p><label class="pick" style="padding:12px"><input type="file" id="bgmIn" accept=".mp3,.m4a,.aac,.wav,audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/aac"><b style="font-size:14.5px">🎵 '+(BGM?esc(BGM.name):'폰에 있는 음악 고르기')+'</b>'+(BGM?'눌러서 다른 곡으로':'유튜브 오디오 보관함처럼 저작권 걱정 없는 곡만')+'</label>'
   +(BGM?'<div style="margin-top:6px">'+chipRow('bgv',[[0,'끄기'],[0.07,'아주 작게'],[0.12,'작게'],[0.22,'보통']],o.bgv)+'</div><p class="note">내레이션 나올 땐 자동으로 줄고 끝에서 서서히 꺼져요. 곡은 이 화면을 닫으면 다시 골라야 해요.</p>':'')
   +'<p class="lbl">왼쪽 위 위치 표시 (비우면 없음)</p><input type="text" id="tagIn" maxlength="20" value="'+esc(o.tag)+'"></div>';
  h+='<div class="card"><h2>영상 완성</h2><p class="note">폰에서 720×1280으로 녹화해요. 길이만큼 걸리니 화면을 켜 두세요.</p><button class="big ghost" id="pvAll">▶ 전체 미리보기 (녹화 안 함)</button><button class="big" id="renderBtn">🎬 영상 만들기</button><div id="out"></div></div>';
  h+='<a class="big ghost" href="/shorts">← 숏츠 공방</a>';
  $('main').innerHTML=h;window.scrollTo(0,0);bind();
}
function usedClips(){var u=[];D.scenes.forEach(function(s){if(CLIPS[s.clip]&&u.indexOf(s.clip)<0)u.push(s.clip);});return u.sort(function(a,b){return a-b;});}
function clipAsr(i){return D.clips&&D.clips[i]&&D.clips[i].asr;}
function osubHtml(){
  var u=usedClips(),miss=u.filter(function(i){return !clipAsr(i);});
  var h='<p class="note">클립 소리만 서버로 보내 받아 적어요(영상은 안 보내요). 내레이션이 나오는 동안은 내레이션 자막이 우선이에요.</p>';
  h+='<button class="big ghost" id="asrBtn">'+(miss.length?'🗣 자막 만들기 (클립 '+miss.length+'개)':'🔁 다시 받아 적기')+'</button><div class="prog" id="asrP"></div>';
  u.forEach(function(i){var a=clipAsr(i);if(!a)return;
    h+='<details style="margin-top:6px"><summary class="note" style="margin:0">클립 '+(i+1)+' · '+(a.length?a.length+'문장 (눌러서 고치기)':'알아들은 말 없음')+'</summary>'
     +a.map(function(r,k){return '<div style="margin:6px 0"><span class="note" style="margin:0">'+fmt(r[0])+'초 · '+esc(r[2])+'</span><input type="text" data-asr="'+i+':'+k+'" value="'+esc(r[3])+'" style="padding:6px 8px;font-size:14.5px"></div>';}).join('')+'</details>';});
  return h;
}
function readForm(){
  D.title=$('tt').value.trim()||D.title;D.description=$('ds').value;D.tags=$('tg').value.split(/[,，]/).map(function(x){return x.trim();}).filter(Boolean);
  if($('tagIn'))D.opts.tag=$('tagIn').value.trim().slice(0,20);
  document.querySelectorAll('[data-asr]').forEach(function(x){var q=x.getAttribute('data-asr').split(':'),a=clipAsr(+q[0]);if(a&&a[+q[1]])a[+q[1]][3]=x.value.trim();});
  document.querySelectorAll('.seg').forEach(function(el){var i=+el.getAttribute('data-i'),s=D.scenes[i];if(!s)return;
    el.querySelectorAll('[data-f]').forEach(function(f){var k=f.getAttribute('data-f'),v=f.value;if(k==='clip')s.clip=+v;else if(k==='sp')s.sp=+v||1;else if(k==='s'||k==='e')s[k]=Math.max(0,parseFloat(v)||0);else s[k]=v;});
    var c=CLIPS[s.clip];if(c){s.e=Math.min(s.e,c.dur);s.s=Math.min(s.s,Math.max(0,s.e-0.3));}if(s.e-s.s<0.3)s.e=s.s+0.3;});
}
function draftBody(){var asr={};(D.clips||[]).forEach(function(c,i){if(c&&c.asr)asr[i]=c.asr;});return {title:D.title,description:D.description,tags:D.tags,scenes:D.scenes.map(function(s){return {clip:s.clip,s:s.s,e:s.e,sp:s.sp||1,cap:s.cap,say:s.say};}),opts:D.opts,asr:asr};}
var saveT=null;function saveSoon(){clearTimeout(saveT);saveT=setTimeout(function(){readForm();api('/shorts/update',{id:D.id,draft:draftBody()});},1200);}
function bind(){
  document.querySelectorAll('#main input,#main textarea,#main select').forEach(function(x){if(x.type==='file')return;x.oninput=saveSoon;x.onchange=saveSoon;});
  document.querySelectorAll('.seg [data-a]').forEach(function(b){b.onclick=function(){readForm();var i=+b.closest('.seg').getAttribute('data-i'),a=b.getAttribute('data-a'),L=D.scenes;
    if(a==='pv')return preview(i);
    if(a==='rec')return recToggle(L[i]);
    if(a==='hear'){try{new Audio(L[i]._rec.url).play();}catch(e){}return;}
    if(a==='up'&&i>0){var t=L[i];L[i]=L[i-1];L[i-1]=t;}
    if(a==='dn'&&i<L.length-1){var t2=L[i];L[i]=L[i+1];L[i+1]=t2;}
    if(a==='dup'&&L.length<15){var cp=JSON.parse(JSON.stringify(L[i]));delete cp._narr;delete cp._rec;L.splice(i+1,0,cp);}
    if(a==='del'&&L.length>1)L.splice(i,1);
    editor();saveSoon();};});
  $('addSeg').onclick=function(){readForm();if(D.scenes.length>=15)return;var c=CLIPS.length-1;D.scenes.push({clip:c,s:0,e:Math.min(3,CLIPS[c].dur),sp:1,cap:'',say:''});editor();saveSoon();};
  document.querySelectorAll('[data-o]').forEach(function(b){b.onclick=function(){var k=b.getAttribute('data-o'),v=b.getAttribute('data-v');
    if(k==='fit'||k==='voice')D.opts[k]=v;else if(k==='orig'||k==='bgv')D.opts[k]=+v;else D.opts[k]=!D.opts[k];readForm();editor();saveSoon();};});
  $('bgmIn').onchange=function(){var f=this.files&&this.files[0];this.value='';if(!f)return;readForm();BGM={file:f,name:f.name.replace(/\.[^.]+$/,'').slice(0,30),buf:null};if(!D.opts.bgv)D.opts.bgv=0.12;editor();saveSoon();};
  if($('asrBtn'))$('asrBtn').onclick=makeAsr;
  $('renderBtn').onclick=function(){render(false);};
  $('pvAll').onclick=function(){render(true);};
  segThumbs();
}
async function segThumbs(){for(var i=0;i<D.scenes.length;i++){var s=D.scenes[i],c=CLIPS[s.clip];if(!c)continue;try{await seekTo(c.v,Math.min(c.dur-0.05,s.s+0.2));var g=grab(c.v,200,0.6),im=$('st'+i);if(g&&im)im.src=g;}catch(e){}}}
var pvT=null;
async function preview(i){var s=D.scenes[i],c=CLIPS[s.clip],pv=$('pv');if(!c)return;pv.style.display='block';pv.src=c.url;pv.muted=false;clearInterval(pvT);
  await waitEv(pv,'loadedmetadata',5000);pv.currentTime=s.s;pv.playbackRate=s.sp||1;try{await pv.play();}catch(e){}pv.scrollIntoView({block:'center',behavior:'smooth'});
  pvT=setInterval(function(){if(pv.currentTime>=s.e){pv.pause();clearInterval(pvT);}},100);}

// ---------- 영상 속 말 자막: 클립 소리 → 16kHz 모노 PCM → /shorts/asr ----------
async function clipPcm(c){
  if(c.file.size>300*1048576)throw new Error('파일이 너무 커요');
  var ab=await c.file.arrayBuffer(),ac=getAC(),buf=await decode(ac,ab);ab=null;
  var dur=Math.min(buf.duration,60),O=window.OfflineAudioContext||window.webkitOfflineAudioContext,oc=new O(1,Math.ceil(dur*16000),16000),src=oc.createBufferSource();
  src.buffer=buf;src.connect(oc.destination);src.start(0);
  var r=await new Promise(function(ok,no){oc.oncomplete=function(e){ok(e.renderedBuffer);};var p=oc.startRendering();if(p&&p.then)p.then(ok,no);});
  var f=r.getChannelData(0),out=new Uint8Array(f.length*2);
  for(var i=0;i<f.length;i++){var v=Math.max(-1,Math.min(1,f[i]))*32767|0;out[i*2]=v&255;out[i*2+1]=(v>>8)&255;}
  var bin='';for(var j=0;j<out.length;j+=32768)bin+=String.fromCharCode.apply(null,out.subarray(j,j+32768));
  return btoa(bin);
}
async function makeAsr(){
  readForm();var b=$('asrBtn'),p=$('asrP'),u=usedClips(),miss=u.filter(function(i){return !clipAsr(i);}),todo=miss.length?miss:u;b.disabled=true;
  if(!D.clips)D.clips=CLIPS.map(function(c){return {dur:c.dur,name:c.name};});
  for(var k=0;k<todo.length;k++){var i=todo[k],c=CLIPS[i];
    p.innerHTML='<span class="spin">🗣</span> 클립 '+(i+1)+' 소리 뽑는 중… ('+(k+1)+'/'+todo.length+')';
    try{var pcm=await clipPcm(c);}catch(e){toast('클립 '+(i+1)+' 소리를 뽑지 못했어요: '+(e.message||e));continue;}
    p.innerHTML='<span class="spin">🗣</span> 클립 '+(i+1)+' 받아 적고 번역하는 중…';
    var r=await api('/shorts/asr',{id:D.id,clip:i,pcm:pcm});
    if(!r.ok){toast('클립 '+(i+1)+': '+(r.detail||r.error));continue;}
    if(!D.clips[i])D.clips[i]={dur:c.dur,name:c.name};D.clips[i].asr=r.asr;
  }
  editor();var t=$('asrBtn');if(t)t.scrollIntoView({block:'center'});
}

// ---------- 직접 녹음 ----------
async function recToggle(s){
  if(RECING&&MREC){MREC.stop();return;}
  try{if(!MIC)MIC=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});}catch(e){toast('마이크 권한이 필요해요');return;}
  var mt=['audio/mp4','audio/webm;codecs=opus','audio/webm'].filter(function(m){return window.MediaRecorder&&MediaRecorder.isTypeSupported&&MediaRecorder.isTypeSupported(m);})[0]||'';
  var ch=[],t0=Date.now();MREC=new MediaRecorder(MIC,mt?{mimeType:mt}:{});RECING=s;
  MREC.ondataavailable=function(e){if(e.data&&e.data.size)ch.push(e.data);};
  MREC.onstop=function(){var blob=new Blob(ch,{type:(mt||'audio/mp4').split(';')[0]});s._rec={blob:blob,url:URL.createObjectURL(blob),dur:(Date.now()-t0)/1000};RECING=null;MREC=null;readForm();editor();};
  MREC.start();readForm();editor();
}
// ---------- 4) 소리: 한 번 만든 AudioContext·믹서를 계속 씀 ----------
//  (렌더마다 새 컨텍스트를 만들면 클립 소리가 이전 컨텍스트에 묶여 두 번째 렌더부터 원본 소리가 빠졌음)
function getAC(){
  if(!AC){var C=window.AudioContext||window.webkitAudioContext;AC=new C();}
  if(AC.resume)AC.resume();
  if(!BUS){
    var comp=AC.createDynamicsCompressor();comp.threshold.value=-20;comp.knee.value=10;comp.ratio.value=3.5;comp.attack.value=0.003;comp.release.value=0.25;
    var master=AC.createGain();master.gain.value=1.15;comp.connect(master);master.connect(AC.destination);
    BUS={comp:comp,master:master};
  }
  return AC;
}
function decode(ac,ab){return new Promise(function(ok,no){var p=ac.decodeAudioData(ab,ok,no);if(p&&p.then)p.then(ok,no);});}
async function ensureNarr(ac,prog){
  var out=[];
  for(var i=0;i<D.scenes.length;i++){
    var t=(D.scenes[i].say||'').trim();out[i]=null;if(!D.opts.narr)continue;if(!t&&!(D.opts.voice==='rec'&&D.scenes[i]._rec))continue;
    prog('🔊 내레이션 '+(i+1)+'/'+D.scenes.length);
    var sc=D.scenes[i],vo=D.opts.voice||'Cherry';
    if(vo==='rec'){if(!sc._rec)continue;try{out[i]=await decode(ac,await sc._rec.blob.arrayBuffer());}catch(e){toast('#'+(i+1)+' 녹음을 읽지 못했어요');}continue;}
    var key=vo+'|'+t,n=sc._narr;
    if(!n||n.key!==key){var r=await api('/shorts/asset',{id:D.id,n:i,kind:'say',text:t,voice:vo});if(!r.ok){toast('#'+(i+1)+' 내레이션 실패: '+(r.detail||r.error));continue;}n=sc._narr={key:key,url:r.url,buf:null};}
    if(!n.buf){try{n.buf=await decode(ac,await (await fetch(n.url+'&v='+Date.now())).arrayBuffer());}catch(e){n.buf=null;}}
    out[i]=n.buf;
  }
  return out;
}
async function ensureBgm(ac){if(!BGM||BGM.buf||!D.opts.bgv)return;try{BGM.buf=await decode(ac,await BGM.file.arrayBuffer());}catch(e){toast('배경음악 파일을 읽지 못했어요');BGM=null;}}

// ---------- 5) 렌더링 (미리보기 dry=true 는 녹화 없이 같은 화면·소리) ----------
// 재생 직후 실제 프레임이 나올 때까지 기다림(준비 안 된 프레임 = 검은 화면 방지)
function firstFrame(v){return new Promise(function(ok){var done=false;function fin(){if(!done){done=true;ok();}}
  if(v.requestVideoFrameCallback){v.requestVideoFrameCallback(function(){fin();});}
  else{(function chk(n){if(v.readyState>=3||n>20)return setTimeout(fin,40);setTimeout(function(){chk(n+1);},30);})(0);}
  setTimeout(fin,900);});}
// 내레이션을 자막 토막으로: 문장부호 뒤에서 끊고, 긴 토막은 띄어쓰기 기준으로 반씩
function sayChunks(t){t=String(t||'').trim();if(!t)return [];var parts=t.replace(/([,.!?…，。！？~]+)(?![0-9])\s*/g,'$1\n').split('\n').map(function(x){return x.trim();}).filter(Boolean),out=[];
  parts.forEach(function(x){while(x.length>18){var m=x.lastIndexOf(' ',Math.ceil(x.length/2)+3);if(m<6)m=x.indexOf(' ',6);if(m<0)break;out.push(x.slice(0,m));x=x.slice(m+1).trim();}if(x)out.push(x);});
  var tot=out.reduce(function(a,x){return a+x.length+2;},0);return out.map(function(x){return {t:x,w:(x.length+2)/tot};});}
function wrap(g,t,max){var out=[],cur='';for(var i=0;i<t.length;i++){var n=cur+t[i];if(g.measureText(n).width>max&&cur){out.push(cur);cur=t[i];}else cur=n;}if(cur)out.push(cur);return out;}
// 렌더 중 오류가 나도 버튼이 '멈추기'로 묶이지 않게
function render(dry){return render0(dry).catch(function(e){RUN=null;var b=$('renderBtn'),p=$('pvAll');if(b){b.disabled=false;b.textContent='🎬 영상 만들기';}if(p){p.disabled=false;p.textContent='▶ 전체 미리보기 (녹화 안 함)';}var o=$('out');if(o)o.insertAdjacentHTML('beforeend','<p class="err">오류: '+esc(e&&e.message||e)+'</p>');});}
async function render0(dry){
  readForm();
  if(RUN){RUN.stop=true;return;}
  var ac=getAC();
  CLIPS.forEach(function(c){try{c.v.muted=false;var p0=c.v.play();if(p0&&p0.then)p0.then(function(){c.v.pause();},function(){});}catch(e){}});
  if(!dry)api('/shorts/update',{id:D.id,draft:draftBody()});
  var out=$('out'),btn=$('renderBtn'),pb=$('pvAll'),me=dry?pb:btn,other=dry?btn:pb;
  var run=RUN={stop:false};other.disabled=true;me.textContent='■ 멈추기';
  var pv=$('pv');if(pv){pv.pause();pv.style.display='none';}
  var lock=null;try{if(navigator.wakeLock)lock=await navigator.wakeLock.request('screen');}catch(e){}
  function prog(t){out.innerHTML='<p class="prog">'+t+'</p>';}
  function finish(){RUN=null;try{if(lock)lock.release();}catch(e){}btn.disabled=false;pb.disabled=false;pb.textContent='▶ 전체 미리보기 (녹화 안 함)';btn.textContent=dry||!btn.getAttribute('data-done')?'🎬 영상 만들기':'🎬 다시 만들기';CLIPS.forEach(function(c){c.v.pause();c.v.playbackRate=1;});}
  var narr=await ensureNarr(ac,prog);await ensureBgm(ac);
  var tiny=document.createElement('canvas');tiny.width=24;tiny.height=42;var tg=tiny.getContext('2d');
  var sn=document.createElement('canvas');sn.width=720;sn.height=1280;var sgx=sn.getContext('2d'),hasSnap=false;
  var W=720,H=1280,cv=document.createElement('canvas');cv.width=W;cv.height=H;var g=cv.getContext('2d');
  if(!dry&&(!cv.captureStream||!window.MediaRecorder)){out.innerHTML='<p class="err">이 브라우저는 영상 녹화를 못 해요(iOS 최신 Safari 필요).</p>';finish();return;}
  var clipBus=ac.createGain();clipBus.connect(BUS.comp);
  CLIPS.forEach(function(c){if(!c.src){try{c.src=ac.createMediaElementSource(c.v);c.gain=ac.createGain();c.src.connect(c.gain);}catch(e){c.src=null;}}
    if(c.gain){try{c.gain.disconnect();}catch(e){}c.gain.connect(clipBus);c.gain.gain.value=0;}c.v.muted=!c.src||D.opts.orig===0;c.v.pause();});
  var dest=null,rec=null,chunks=[],mime='';
  if(!dry){
    dest=ac.createMediaStreamDestination();BUS.master.connect(dest);
    var vs=cv.captureStream(30);
    mime=['video/mp4;codecs=avc1','video/mp4','video/webm;codecs=vp9,opus','video/webm'].filter(function(m){return MediaRecorder.isTypeSupported&&MediaRecorder.isTypeSupported(m);})[0]||'';
    rec=new MediaRecorder(new MediaStream(vs.getVideoTracks().concat(dest.stream.getAudioTracks())),mime?{mimeType:mime,videoBitsPerSecond:6000000}:{});
    rec.ondataavailable=function(e){if(e.data&&e.data.size)chunks.push(e.data);};
  }
  out.innerHTML='<p class="prog" id="rp">'+(dry?'미리보기 중…':'녹화 중… 화면을 켜 두세요')+'</p><div class="bar"><i id="rb"></i></div>';out.appendChild(cv);cv.className='pv';
  if(dry)cv.scrollIntoView({block:'center',behavior:'smooth'});
  var END=D.opts.end?2:0;
  var plan=D.scenes.map(function(s,i){var nd=narr[i]?narr[i].duration+0.25:0;return {s:s,i:i,sp:s.sp||1,seg:segLen(s),nd:narr[i]?narr[i].duration:0,ck:sayChunks(s.say),len:Math.max(segLen(s),nd,0.8)};}),total=plan.reduce(function(a,p){return a+p.len;},0)+END,doneT=0,bgmPos=0;
  // 배경음악: 구간마다 이어지는 위치부터 짧게 페이드 인·아웃(녹화 일시정지 사이 끊김 없이 이어 붙음), 내레이션 땐 낮춤
  function bgm(at,len,duck,fadeOut){var lv=D.opts.bgv;if(!BGM||!BGM.buf||!lv)return;var s=ac.createBufferSource(),gn=ac.createGain();s.buffer=BGM.buf;s.loop=true;s.connect(gn);gn.connect(BUS.comp);
    var l=lv*(duck?0.4:1),fo=Math.min(len,fadeOut||0.04);gn.gain.setValueAtTime(0,at);gn.gain.linearRampToValueAtTime(l,at+0.03);gn.gain.setValueAtTime(l,at+Math.max(0.03,len-fo));gn.gain.linearRampToValueAtTime(0,at+len);
    s.start(at,bgmPos%BGM.buf.duration);s.stop(at+len+0.05);bgmPos+=len;}
  function stroke(txt,x,y,font,fill,lw){g.font=font;g.textAlign='center';g.lineJoin='round';g.lineWidth=lw;g.strokeStyle='rgba(0,0,0,.85)';g.strokeText(txt,x,y);g.fillStyle=fill;g.fillText(txt,x,y);}
  function bar(el,len){var b=$('rb');if(b)b.style.width=Math.min(100,(doneT+Math.min(el,len))/total*100)+'%';}
  function draw(v,sc,el,len,idx){
    var vw=v.videoWidth,vh=v.videoHeight,ready=vw&&vh&&v.readyState>=2;
    if(!ready){if(hasSnap)g.drawImage(sn,0,0);else{g.fillStyle='#000';g.fillRect(0,0,W,H);}}
    else{g.fillStyle='#000';g.fillRect(0,0,W,H);}
    if(ready){
      if(D.opts.fit==='full'){var bs=Math.max(W/vw,H/vh)*1.1;tg.drawImage(v,0,0,tiny.width,tiny.height);g.imageSmoothingEnabled=true;g.drawImage(tiny,(W-vw*bs)/2,(H-vh*bs)/2,vw*bs,vh*bs);g.fillStyle='rgba(0,0,0,.45)';g.fillRect(0,0,W,H);var fs2=Math.min(W/vw,H/vh);g.drawImage(v,(W-vw*fs2)/2,(H-vh*fs2)/2,vw*fs2,vh*fs2);}
      else{var cs=Math.max(W/vw,H/vh);g.drawImage(v,(W-vw*cs)/2,(H-vh*cs)/2,vw*cs,vh*cs);}
    }
    if(hasSnap&&ready&&el<0.25){g.globalAlpha=1-el/0.25;g.drawImage(sn,0,0);g.globalAlpha=1;}
    var gr=g.createLinearGradient(0,H*0.5,0,H);gr.addColorStop(0,'rgba(0,0,0,0)');gr.addColorStop(1,'rgba(0,0,0,.55)');g.fillStyle=gr;g.fillRect(0,H*0.5,W,H*0.5);
    if(sc.cap){var pop=Math.min(1,el/0.18),fs=Math.round(66*(0.85+0.15*pop)),fnt='900 '+fs+'px -apple-system,"Apple SD Gothic Neo",sans-serif';g.font=fnt;wrap(g,sc.cap,W-140).forEach(function(l,k){stroke(l,W/2,H*0.20+k*(fs+12),fnt,idx===0&&k===0?'#FFD84D':'#FFFFFF',14);});}
    // 내레이션 자막: 말하는 속도에 맞춰 한 토막씩(글자 수 비례로 시간 배분)
    var P=CUR,talking=P&&P.nd&&el>=0.05&&el<=P.nd+0.15,shown=false;
    if(D.opts.subs&&P&&P.ck.length){var span=P.nd||len,tt=(P.nd?el-0.05:el)/span,ci=-1,acc=0;
      if(tt>=0&&tt<=1.03){for(var q=0;q<P.ck.length;q++){acc+=P.ck[q].w;if(tt<=acc+1e-6){ci=q;break;}}if(ci<0)ci=P.ck.length-1;}
      if(ci>=0){var f2='800 44px -apple-system,"Apple SD Gothic Neo",sans-serif';g.font=f2;var sl=wrap(g,P.ck[ci].t,W-150).slice(0,2);sl.forEach(function(l,k){stroke(l,W/2-20,H*0.67+k*56-(sl.length-1)*28,f2,'#FFFFFF',10);});shown=true;}}
    // 영상 속 말 자막: 내레이션이 안 나올 때 그 순간 말한 문장(한국어 크게 + 원문 작게)
    var A=D.opts.osub&&clipAsr(sc.clip);
    if(A&&!talking&&!(shown&&!P.nd)){var mt=v.currentTime,row=null;for(var r=0;r<A.length;r++){if(A[r][3]&&mt>=A[r][0]-0.1&&mt<=A[r][1]+0.3){row=A[r];break;}}
      if(row){var f3='800 42px -apple-system,"Apple SD Gothic Neo",sans-serif';g.font=f3;var kl=wrap(g,row[3],W-150).slice(0,2),y0=H*0.70-(kl.length-1)*27;
        if(row[2]){var f4='600 26px -apple-system,"PingFang SC",sans-serif';g.font=f4;stroke(wrap(g,row[2],W-160)[0],W/2-20,y0-52,f4,'#FFD84D',7);}
        kl.forEach(function(l,k){stroke(l,W/2-20,y0+k*54,f3,'#FFFFFF',10);});}}
    if(D.opts.tag){g.font='600 22px -apple-system,sans-serif';g.textAlign='left';g.fillStyle='rgba(255,255,255,.75)';g.fillText(D.opts.tag,30,60);}
    bar(el,len);
  }
  function drawEnd(el){
    var a=Math.min(1,el/0.35);g.drawImage(sn,0,0);
    tg.drawImage(sn,0,0,tiny.width,tiny.height);g.globalAlpha=a;g.imageSmoothingEnabled=true;g.drawImage(tiny,-20,-20,W+40,H+40);g.fillStyle='rgba(10,20,35,.55)';g.fillRect(0,0,W,H);
    var y=H*0.42;stroke('끝까지 봐 주셔서 고마워요',W/2,y,'700 38px -apple-system,"Apple SD Gothic Neo",sans-serif','#FFFFFF',8);
    if(CH)stroke(CH,W/2,y+92,'900 64px -apple-system,"Apple SD Gothic Neo",sans-serif','#FFD84D',12);
    var pulse=1+0.05*Math.sin(el*7),bw=300*pulse,bh=96*pulse,bx=(W-bw)/2,by=y+150;
    g.fillStyle='#D21624';g.beginPath();var r=bh/2;g.moveTo(bx+r,by);g.lineTo(bx+bw-r,by);g.arc(bx+bw-r,by+r,r,-Math.PI/2,Math.PI/2);g.lineTo(bx+r,by+bh);g.arc(bx+r,by+r,r,Math.PI/2,Math.PI*1.5);g.closePath();g.fill();
    g.font='800 44px -apple-system,"Apple SD Gothic Neo",sans-serif';g.textAlign='center';g.fillStyle='#FFFFFF';g.fillText('🔔 구독',W/2,by+bh/2+15);
    g.globalAlpha=1;bar(el,END);
  }
  var started=false,stopped=false,CUR=null;
  for(var k=0;k<plan.length;k++){
    if(run.stop){stopped=true;break;}
    var p=plan[k],sc=p.s,c=CLIPS[sc.clip];if(!c)continue;CUR=p;
    $('rp').textContent=(dry?'미리보기 ':'녹화 중… ')+(k+1)+' / '+plan.length+' 구간';
    c.v.pause();await seekTo(c.v,sc.s);
    var v=c.v;v.playbackRate=p.sp;try{v.preservesPitch=true;v.webkitPreservesPitch=true;}catch(e){}
    try{var pr=v.play();if(pr&&pr.catch)pr.catch(function(){v.muted=true;var p2=v.play();if(p2&&p2.catch)p2.catch(function(){});});}catch(e){}
    await firstFrame(v);
    draw(v,sc,0,p.len,k);
    if(rec){if(!started){rec.start(500);started=true;}else{try{rec.resume();}catch(e){}}}
    var t0=ac.currentTime,hasN=!!narr[p.i],last=k===plan.length-1;
    // 원본 소리: 컷마다 60ms 페이드(툭 소리 방지), 내레이션 나올 땐 40%로 낮춤
    if(c.gain){var lv=D.opts.orig*(hasN?0.4:1),gg=c.gain.gain,se=Math.min(p.seg,p.len);gg.cancelScheduledValues(t0);gg.setValueAtTime(0,t0);gg.linearRampToValueAtTime(lv,t0+0.06);gg.setValueAtTime(lv,t0+Math.max(0.06,se-0.06));gg.linearRampToValueAtTime(0,t0+se);}
    if(hasN){var bs=ac.createBufferSource();bs.buffer=narr[p.i];bs.connect(BUS.comp);bs.start(t0+0.05);}
    bgm(t0,p.len,hasN,last&&!END?1.2:0.04);
    await new Promise(function(done){(function loop(){var el=ac.currentTime-t0;if(el>=p.len||run.stop){done();return;}if(v.currentTime>=sc.e-0.02&&!v.paused)v.pause();draw(v,sc,el,p.len,k);requestAnimationFrame(loop);})();});
    v.pause();v.playbackRate=1;if(c.gain){c.gain.gain.cancelScheduledValues(ac.currentTime);c.gain.gain.setValueAtTime(0,ac.currentTime);}
    doneT+=p.len;sgx.drawImage(cv,0,0);hasSnap=true;
    if(rec&&!last&&!run.stop){try{rec.pause();}catch(e){}}
  }
  if(!run.stop&&END&&hasSnap){var t1=ac.currentTime;bgm(t1,END,false,END);
    await new Promise(function(done){(function loop(){var el=ac.currentTime-t1;if(el>=END||run.stop){done();return;}drawEnd(el);requestAnimationFrame(loop);})();});}
  stopped=stopped||run.stop;
  if(rec&&started)await new Promise(function(ok){rec.onstop=ok;try{rec.stop();}catch(e){ok();}});
  if(dest){try{BUS.master.disconnect(dest);}catch(e){}}
  try{clipBus.disconnect();}catch(e){}
  finish();
  if(dry){$('rp').textContent=stopped?'미리보기 멈춤':'미리보기 끝 — 괜찮으면 🎬 영상 만들기';return;}
  if(stopped||!started){out.innerHTML='<p class="note">녹화를 멈췄어요.</p>';return;}
  btn.setAttribute('data-done','1');btn.textContent='🎬 다시 만들기';
  var type=(mime||'video/mp4').split(';')[0],blob=new Blob(chunks,{type:type}),url=URL.createObjectURL(blob),ext=type.indexOf('webm')>=0?'webm':'mp4';
  out.innerHTML='<video class="out" controls playsinline src="'+url+'"></video>'
   +'<p class="note" style="text-align:center">'+fmt(total)+'초 · '+(blob.size/1048576).toFixed(1)+'MB</p>'
   +'<div class="mini" style="justify-content:center"><button id="dl">📥 기기에 저장</button></div>'
   +'<p class="lbl">유튜브 공개 범위</p><div class="chips">'+[['private','비공개(확인 후 공개)'],['unlisted','일부 공개'],['public','바로 공개']].map(function(x,k){return '<button class="chip'+(k===0?' on':'')+'" data-pv="'+x[0]+'">'+x[1]+'</button>';}).join('')+'</div>'
   +'<button class="big red" id="ytUp">▶ 유튜브에 올리기</button><div class="bar" id="ubw" style="display:none;margin-top:8px"><i id="ub"></i></div><p class="note">AI 내레이션을 썼으면 AI 합성 콘텐츠로 표시돼요. 제목에 #Shorts 가 붙어요. 배경음악은 저작권 걱정 없는 곡만 쓰세요.</p><div class="err" id="ue"></div>';
  var PV='private';document.querySelectorAll('[data-pv]').forEach(function(c){c.onclick=function(){PV=c.getAttribute('data-pv');document.querySelectorAll('[data-pv]').forEach(function(x){x.classList.toggle('on',x===c);});};});
  $('dl').onclick=function(){var f=new File([blob],(D.title||'shorts').replace(/[\\/:*?"<>|#]/g,'').slice(0,40)+'.'+ext,{type:type});
    if(navigator.canShare&&navigator.canShare({files:[f]}))navigator.share({files:[f]}).catch(function(){});else{var a=document.createElement('a');a.href=url;a.download=f.name;a.click();}};
  $('ytUp').onclick=async function(){var b=this,ue=$('ue');b.disabled=true;ue.textContent='';
    try{var mb=(blob.size/1048576).toFixed(1);b.innerHTML='<span class="spin">⏫</span> 서버에 저장 중… 0% ('+mb+'MB)';$('ubw').style.display='block';
      var j=await upBlob(blob,type,function(f){b.innerHTML='<span class="spin">⏫</span> 서버에 저장 중… '+Math.round(f*100)+'% ('+mb+'MB)';$('ub').style.width=Math.round(f*100)+'%';});
      if(!j.ok)throw new Error(j.detail||j.error);
      b.innerHTML='<span class="spin">▶</span> 유튜브에 올리는 중…';readForm();
      var y=await api('/shorts/yt/upload',{id:D.id,privacy:PV,title:D.title,description:D.description,tags:D.tags,synthetic:!!(D.opts.narr&&D.opts.voice!=='rec'&&D.scenes.some(function(x){return (x.say||'').trim();}))});
      if(!y.ok)throw new Error(y.detail||y.error);
      b.textContent='✅ 올렸어요';ue.innerHTML='<a href="'+esc(y.yt.url)+'" target="_blank" style="color:var(--sky)">'+esc(y.yt.url)+'</a>';
    }catch(e){ue.textContent=e.message;b.disabled=false;b.textContent='▶ 다시 올리기';}
  };
}
function upBlob(blob,type,onp){return new Promise(function(ok,no){var x=new XMLHttpRequest();x.open('POST','/shorts/save?id='+D.id);x.setRequestHeader('content-type',type);x.setRequestHeader('x-code',CODE);
  x.upload.onprogress=function(e){if(e.lengthComputable)onp(e.loaded/e.total);};
  x.onload=function(){try{ok(JSON.parse(x.responseText));}catch(e){no(new Error('서버 응답 오류 '+x.status));}};x.onerror=function(){no(new Error('네트워크 오류 — 와이파이에서 다시 올려 보세요'));};x.send(blob);});}
start();
</script></body></html>`;
