// =========================================================
// 🎨 공감툰 — GPT 로 뽑은 캐릭터 그림 1~4장에 자막·말풍선 글자·효과음·배경음악을 얹어 세로 영상으로 (주인 전용)
//  그림은 폰 밖으로 안 나감: 폰 캔버스에서 렌더 → 완성본만 /shorts/save → /shorts/yt/upload (숏츠 공방과 같은 채널 연결)
//  AI(千问)는 /shorts/toon/idea 로 POV 자막·중국어 한마디·GPT 장면 프롬프트만 제안. 효과음은 WebAudio 로 직접 합성(저작권 없음)
// =========================================================
export const TOON_HTML = String.raw`<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#1664B0">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="공감툰">
<link rel="apple-touch-icon" href="/shorts-180.png"><link rel="icon" href="/shorts-192.png">
<title>공감툰</title>
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
</style></head><body>
<header><a class="back" href="/shorts" aria-label="숏츠 공방">‹</a><h1>🎨 공감툰</h1></header>
<main id="main"></main>
<script>
var CODE='';try{CODE=localStorage.getItem('pb-code')||'';}catch(e){}
var T={topic:'',idea:null,bgv:0.12,id:null},CARDS=[],AC=null,BUS=null,BGM=null,RUN=null;
try{var sv=JSON.parse(localStorage.getItem('toon-cur')||'null');if(sv){T.topic=sv.topic||'';T.idea=sv.idea||null;T.bgv=sv.bgv!=null?sv.bgv:0.12;}}catch(e){}
function keep(){try{localStorage.setItem('toon-cur',JSON.stringify({topic:T.topic,idea:T.idea,bgv:T.bgv}));}catch(e){}}
var SFX=[['','없음'],['ding','띵'],['pop','뿅'],['whoosh','휙'],['thud','쿵'],['beep','삐-'],['msg','알림×3'],['fail','빠밤(허무)']];
var SETUP='Use the attached character sheet as the fixed main character for a series of illustrations. Always keep him exactly the same: chibi proportions, big messy brown hair, black square sunglasses (always on), plain white oversized T-shirt, black wide pants, white sneakers, black smartwatch, thick clean outlines, flat soft colors, simple cute webtoon style.\n\nRules for every image I ask for:\n- Vertical 9:16\n- Leave the top 25% fairly empty (simple background only) so I can add a caption there\n- No text, letters, numbers or speech bubbles with words inside the image\n- Other people: simple, round, friendly side characters in the same style, never realistic faces\n- Settings are Guangzhou, China\nReply "OK" and wait for my scene.';
function $(i){return document.getElementById(i);}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function toast(t){var d=document.createElement('div');d.className='toast';d.textContent=t;document.body.appendChild(d);setTimeout(function(){d.remove();},2800);}
function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}
function api(p,b,tries){b=b||{};b.code=CODE;tries=tries==null?2:tries;
  return fetch(p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json().catch(function(){return {error:'서버 응답 오류 '+r.status};});},
    function(e){if(tries>0)return sleep(1500).then(function(){return api(p,b,tries-1);});return {error:'network',detail:'네트워크가 끊겼어요. 다시 눌러 주세요.'};});}
function copy(t){var ok=function(){toast('복사했어요 — GPT 에 붙여 넣기');};
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(t).then(ok,function(){fallback();});else fallback();
  function fallback(){var a=document.createElement('textarea');a.value=t;document.body.appendChild(a);a.select();try{document.execCommand('copy');ok();}catch(e){prompt('복사하세요',t);}a.remove();}}

// ---------- 화면 ----------
function start(){
  if(!CODE){$('main').innerHTML='<div class="gate"><p>초대 코드를 넣어 주세요</p><input type="text" id="cd" style="max-width:220px"> <button class="chip on" id="go">열기</button></div>';$('go').onclick=function(){CODE=$('cd').value.trim();try{localStorage.setItem('pb-code',CODE);}catch(e){}start();};return;}
  $('main').innerHTML=
    '<div class="card"><h2>① 아이디어</h2><input type="text" id="topic" placeholder="예: 중국 동료의 考虑一下, 위챗 음성 메시지 폭탄" value="'+esc(T.topic)+'">'
    +'<div class="mini" style="margin-top:8px"><button id="ideaBtn">💡 자막·장면 프롬프트 받기</button><button id="setupBtn">📋 캐릭터 고정 프롬프트(GPT 처음 한 번)</button></div><div id="idea"></div><div class="err" id="e1"></div></div>'
    +'<div class="card"><h2>② 그림 넣기 <small style="font-weight:400;color:var(--ink2)">GPT 로 뽑은 그림 1~4장</small></h2><div class="mini" style="margin-bottom:8px"><button id="refill">↻ 아이디어로 자막 다시 채우기</button></div><label class="pick"><input type="file" accept="image/*" multiple id="imgs"><b>🖼 그림 고르기</b>사진 앱에서 순서대로</label><div id="cards"></div></div>'
    +'<div class="card"><h2>③ 소리</h2><p class="lbl">효과음 미리 듣기</p><div class="chips">'+SFX.slice(1).map(function(x){return '<button class="chip" data-try="'+x[0]+'">'+x[1]+'</button>';}).join('')+'</div>'
    +'<p class="lbl">배경음악 (폰 파일 · 저작권 걱정 없는 곡)</p><label class="chip" style="display:inline-block">🎵 <span id="bgmName">'+(BGM?esc(BGM.name):'고르기')+'</span><input type="file" accept=".mp3,.m4a,.aac,.wav,audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/aac" id="bgm" hidden></label>'
    +'<div class="chips" style="margin-top:6px">'+[[0,'끔'],[0.07,'작게'],[0.12,'보통'],[0.22,'크게']].map(function(x){return '<button class="chip'+(x[0]===T.bgv?' on':'')+'" data-bgv="'+x[0]+'">'+x[1]+'</button>';}).join('')+'</div></div>'
    +'<div class="card" id="outCard" style="display:none"><h2>④ 완성</h2><div id="out"></div></div>'
    +'<div class="dock"><button class="big ghost" id="pvBtn">▶ 미리보기</button><button class="big" id="renderBtn">🎬 영상 만들기</button></div>';
  $('topic').oninput=function(){T.topic=this.value;keep();};
  $('setupBtn').onclick=function(){copy(SETUP);};
  $('ideaBtn').onclick=getIdea;
  $('imgs').onchange=addImages;
  $('refill').onclick=function(){if(!T.idea){toast('먼저 ① 에서 💡 를 눌러 주세요');return;}if(!CARDS.length){toast('그림을 먼저 넣어 주세요');return;}if(CARDS.length>2&&!T.idea.extra){toast('3번째 장면 자막을 새로 받는 중…');if(!$('topic').value.trim())$('topic').value=T.topic;getIdea();return;}autoFill(true);toast('그림 '+CARDS.length+'장에 맞게 채웠어요');};
  document.querySelectorAll('[data-try]').forEach(function(b){b.onclick=function(){var ac=getAC();playSfx(ac,b.getAttribute('data-try'),ac.currentTime+0.05,BUS.sfx);};});
  document.querySelectorAll('[data-bgv]').forEach(function(b){b.onclick=function(){T.bgv=+b.getAttribute('data-bgv');keep();document.querySelectorAll('[data-bgv]').forEach(function(x){x.classList.toggle('on',x===b);});};});
  $('bgm').onchange=function(){var f=this.files&&this.files[0];if(!f)return;BGM={file:f,name:f.name,buf:null};$('bgmName').textContent=f.name;if(!T.bgv){T.bgv=0.12;keep();document.querySelectorAll('[data-bgv]').forEach(function(x){x.classList.toggle('on',+x.getAttribute('data-bgv')===0.12);});}};
  $('pvBtn').onclick=function(){render(true);};$('renderBtn').onclick=function(){render(false);};
  showIdea();drawCards();
}
function getIdea(){var t=$('topic').value.trim();if(!t){$('e1').textContent='주제를 적어 주세요';return;}var b=$('ideaBtn');b.disabled=true;b.innerHTML='<span class="spin">💡</span> 쓰는 중…';$('e1').textContent='';
  api('/shorts/toon/idea',{topic:t}).then(function(r){b.disabled=false;b.textContent='💡 다시 받기';if(!r.ok){$('e1').textContent=r.detail||r.error;return;}T.idea=r.idea;T.id=null;keep();showIdea();if(CARDS.length)autoFill(true);});}
function showIdea(){var x=T.idea,el=$('idea');if(!el)return;if(!x){el.innerHTML='';return;}
  el.innerHTML='<div class="idea"><b>'+esc(x.pov)+'</b><br>→ '+esc(x.punch)+(x.bubble?'<br>💬 '+esc(x.bubble):'')+(x.zh?'<br><span style="color:var(--ink2)">'+esc(x.zh)+' · '+esc(x.py)+' · '+esc(x.ko)+'</span>':'')
    +x.scenes.map(function(s,i){return '<p class="lbl">GPT 장면 '+(i+1)+(s.beat==='punch'?' (반전)':'')+'</p><div class="pr">'+esc(s.prompt)+'</div><div class="mini"><button data-cp="'+i+'">📋 복사</button></div>';}).join('')
    +'<p class="note">그림을 넣으면 자막이 자동으로 채워져요. 고쳐도 돼요.</p></div>';
  el.querySelectorAll('[data-cp]').forEach(function(b){b.onclick=function(){copy(x.scenes[+b.getAttribute('data-cp')].prompt);};});}

// ---------- 그림 카드 ----------
function addImages(){var fs=[].slice.call(this.files||[]);this.value='';if(!fs.length)return;
  var room=4-CARDS.length;if(room<=0){toast('4장까지예요');return;}fs=fs.slice(0,room);
  Promise.all(fs.map(function(f){return new Promise(function(ok){var u=URL.createObjectURL(f),im=new Image();im.onload=function(){ok({url:u,img:im});};im.onerror=function(){ok(null);};im.src=u;});})).then(function(list){
    var was=CARDS.length;list.forEach(function(x){if(x)CARDS.push({url:x.url,img:x.img,dur:3,cap1:'',cap2:'',at2:0.5,sub:'',bubble:'',bx:0.5,by:0.32,zoom:'in',sfx1:'',sfx2:''});});
    // 처음 넣었을 때, 또는 1장용으로 자동 채운 그대로(손대지 않음)인데 그림이 늘었으면 장 수에 맞게 다시 나눔
    var x=T.idea,c0=CARDS[0];if(!was||(was===1&&x&&c0.cap1===x.pov&&c0.cap2===x.punch&&CARDS.slice(1).every(function(c){return !c.cap1&&!c.cap2;})))autoFill(false);drawCards();});}
function autoFill(force){var x=T.idea;if(!x||!CARDS.length)return;var c0=CARDS[0];
  var sub=x.zh?x.zh+'  '+x.py+' · '+x.ko:'';
  if(CARDS.length===1){c0.cap1=x.pov;c0.cap2=x.punch;c0.at2=0.5;c0.sub=sub;c0.bubble=x.bubble;c0.dur=5;c0.sfx1=x.sfx[0]||'';c0.sfx2=x.sfx[1]||'';c0.zoom='punch';}
  else{c0.cap1=x.pov;c0.cap2='';c0.sub=sub;c0.dur=2.5;c0.sfx1=x.sfx[0]||'';c0.zoom='in';var c1=CARDS[1];c1.cap1=x.punch;c1.cap2='';c1.sub='';c1.bubble=x.bubble;c1.dur=CARDS.length>2?3:3.5;c1.sfx1=x.sfx[1]||'';c1.zoom='in';
    if(CARDS.length>2){var c2=CARDS[2],e=x.extra||{};c2.cap1=e.cap||'';c2.cap2='';c2.sub=e.zh?e.zh+'  '+e.py+' · '+e.ko:'';c2.bubble='';c2.dur=3.5;c2.sfx1='ding';c2.zoom='in';}}
  if(force)drawCards();}
function chipRow(name,i,list,val){return '<div class="row"><span>'+name+'</span>'+list.map(function(x){return '<button class="chip'+(String(x[0])===String(val)?' on':'')+'" data-k="'+i+'" data-f="'+x[2]+'" data-v="'+x[0]+'">'+x[1]+'</button>';}).join('')+'</div>';}
function drawCards(){var el=$('cards');if(!el)return;
  el.innerHTML=CARDS.map(function(c,i){
    return '<div class="sc"><div><div class="th" data-th="'+i+'"><img src="'+c.url+'">'+(c.bubble?'<i style="left:'+(c.bx*100)+'%;top:'+(c.by*100)+'%"></i>':'')+'</div><p class="note" style="font-size:11px">그림을 누르면 말풍선 글자 위치</p></div><div>'
      +'<div class="hd"><b>#'+(i+1)+'</b><span class="mini"><button data-mv="'+i+'|-1">↑</button><button data-mv="'+i+'|1">↓</button><button data-rm="'+i+'">삭제</button></span></div>'
      +'<input type="text" data-i="'+i+'" data-t="cap1" placeholder="위 자막 (예: POV: …)" value="'+esc(c.cap1)+'">'
      +'<input type="text" data-i="'+i+'" data-t="cap2" placeholder="중간에 바뀌는 자막 (선택)" value="'+esc(c.cap2)+'">'
      +'<input type="text" data-i="'+i+'" data-t="sub" placeholder="작은 줄 (중국어 한마디·병음·뜻, 선택)" value="'+esc(c.sub)+'">'
      +'<input type="text" data-i="'+i+'" data-t="bubble" placeholder="말풍선 안 글자 (선택)" value="'+esc(c.bubble)+'">'
      +chipRow('길이',i,[[2,'2초',"dur"],[2.5,'2.5',"dur"],[3,'3',"dur"],[3.5,'3.5',"dur"],[4,'4',"dur"],[5,'5',"dur"],[6,'6',"dur"],[7,'7',"dur"],[8,'8',"dur"]],c.dur)
      +(c.cap2?chipRow('바뀜',i,[[0.4,'40%',"at2"],[0.5,'절반',"at2"],[0.6,'60%',"at2"]],c.at2):'')
      +chipRow('움직임',i,[['in','천천히 확대',"zoom"],['punch','반전 때 확 당김',"zoom"],['none','그대로',"zoom"]],c.zoom)
      +chipRow('시작음',i,SFX.map(function(x){return [x[0],x[1],'sfx1'];}),c.sfx1)
      +(c.cap2?chipRow('바뀔 때',i,SFX.map(function(x){return [x[0],x[1],'sfx2'];}),c.sfx2):'')
      +'</div></div>';}).join('')+(CARDS.length?'<p class="note">전체 '+total().toFixed(1)+'초</p>':'');
  el.querySelectorAll('input[data-t]').forEach(function(inp){inp.oninput=function(){var c=CARDS[+inp.getAttribute('data-i')],f=inp.getAttribute('data-t'),had=!!c.cap2;c[f]=inp.value;if(f==='cap2'&&had!==!!c.cap2)drawCards();};});
  el.querySelectorAll('[data-f]').forEach(function(b){b.onclick=function(){var c=CARDS[+b.getAttribute('data-k')],f=b.getAttribute('data-f'),v=b.getAttribute('data-v');c[f]=(f==='dur'||f==='at2')?+v:v;
    if(f.indexOf('sfx')===0&&v){var ac=getAC();playSfx(ac,v,ac.currentTime+0.03,BUS.sfx);}drawCards();};});
  el.querySelectorAll('[data-th]').forEach(function(d){d.onclick=function(e){var r=d.getBoundingClientRect(),c=CARDS[+d.getAttribute('data-th')];c.bx=Math.max(0.1,Math.min(0.9,(e.clientX-r.left)/r.width));c.by=Math.max(0.08,Math.min(0.92,(e.clientY-r.top)/r.height));if(!c.bubble)toast('말풍선 글자를 먼저 적어 주세요');drawCards();};});
  el.querySelectorAll('[data-mv]').forEach(function(b){b.onclick=function(){var p=b.getAttribute('data-mv').split('|'),i=+p[0],j=i+(+p[1]);if(j<0||j>=CARDS.length)return;var t=CARDS[i];CARDS[i]=CARDS[j];CARDS[j]=t;drawCards();};});
  el.querySelectorAll('[data-rm]').forEach(function(b){b.onclick=function(){CARDS.splice(+b.getAttribute('data-rm'),1);drawCards();};});
}
function total(){return CARDS.reduce(function(a,c){return a+c.dur;},0);}

// ---------- 소리 ----------
function getAC(){
  if(!AC){var C=window.AudioContext||window.webkitAudioContext;AC=new C();
    var comp=AC.createDynamicsCompressor();comp.threshold.value=-16;comp.ratio.value=3;var master=AC.createGain();master.gain.value=1;comp.connect(master);master.connect(AC.destination);
    var sfx=AC.createGain();sfx.gain.value=0.9;sfx.connect(comp);BUS={comp:comp,master:master,sfx:sfx};}
  if(AC.resume)AC.resume();return AC;}
function env(ac,g,t,a,peak,d){g.gain.setValueAtTime(0.0001,t);g.gain.exponentialRampToValueAtTime(peak,t+a);g.gain.exponentialRampToValueAtTime(0.0001,t+a+d);}
function tone(ac,out,type,f0,f1,t,a,peak,d){var o=ac.createOscillator(),g=ac.createGain();o.type=type;o.frequency.setValueAtTime(f0,t);if(f1&&f1!==f0)o.frequency.exponentialRampToValueAtTime(f1,t+a+d);env(ac,g,t,a,peak,d);o.connect(g);g.connect(out);o.start(t);o.stop(t+a+d+0.05);}
function noise(ac,out,t,dur,peak,f0,f1){var n=Math.floor(ac.sampleRate*dur),b=ac.createBuffer(1,n,ac.sampleRate),d=b.getChannelData(0);for(var i=0;i<n;i++)d[i]=Math.random()*2-1;
  var s=ac.createBufferSource();s.buffer=b;var bp=ac.createBiquadFilter();bp.type='bandpass';bp.Q.value=1.2;bp.frequency.setValueAtTime(f0,t);bp.frequency.exponentialRampToValueAtTime(f1,t+dur);
  var g=ac.createGain();g.gain.setValueAtTime(0.0001,t);g.gain.exponentialRampToValueAtTime(peak,t+dur*0.45);g.gain.exponentialRampToValueAtTime(0.0001,t+dur);s.connect(bp);bp.connect(g);g.connect(out);s.start(t);s.stop(t+dur+0.02);}
function playSfx(ac,k,t,out){
  if(k==='ding'){tone(ac,out,'sine',1318,1318,t,0.005,0.45,0.7);tone(ac,out,'sine',2637,2637,t,0.005,0.12,0.4);}
  else if(k==='pop'){tone(ac,out,'sine',900,240,t,0.004,0.6,0.12);}
  else if(k==='whoosh'){noise(ac,out,t,0.45,0.5,350,3200);}
  else if(k==='thud'){tone(ac,out,'sine',140,42,t,0.003,0.95,0.38);noise(ac,out,t,0.06,0.25,900,300);}
  else if(k==='beep'){tone(ac,out,'square',1000,1000,t,0.01,0.12,0.55);}
  else if(k==='msg'){[0,0.17,0.34].forEach(function(dt){tone(ac,out,'sine',1568,1568,t+dt,0.004,0.35,0.16);tone(ac,out,'sine',2093,2093,t+dt+0.05,0.004,0.22,0.12);});}
  else if(k==='fail'){var lp=ac.createBiquadFilter();lp.type='lowpass';lp.frequency.value=1600;lp.connect(out);
    [[392,0,0.28],[370,0.3,0.28],[349,0.6,0.28],[330,0.9,0.9]].forEach(function(n){var o=ac.createOscillator(),g=ac.createGain();o.type='sawtooth';o.frequency.setValueAtTime(n[0],t+n[1]);
      if(n[2]>0.5){var lfo=ac.createOscillator(),lg=ac.createGain();lfo.frequency.value=6;lg.gain.value=7;lfo.connect(lg);lg.connect(o.frequency);lfo.start(t+n[1]);lfo.stop(t+n[1]+n[2]+0.05);}
      g.gain.setValueAtTime(0.0001,t+n[1]);g.gain.exponentialRampToValueAtTime(0.16,t+n[1]+0.03);g.gain.setValueAtTime(0.16,t+n[1]+n[2]-0.08);g.gain.exponentialRampToValueAtTime(0.0001,t+n[1]+n[2]);
      o.connect(g);g.connect(lp);o.start(t+n[1]);o.stop(t+n[1]+n[2]+0.05);});}
}
function decode(ac,ab){return new Promise(function(ok,no){var p=ac.decodeAudioData(ab,ok,no);if(p&&p.then)p.then(ok,no);});}

// ---------- 그리기 ----------
var FONT='-apple-system,"Apple SD Gothic Neo","PingFang SC",sans-serif';
function wrap(g,t,max){t=String(t||'');var out=[],cur='';function fits(x){return g.measureText(x).width<=max;}
  t.split(/ +/).forEach(function(w){if(!w)return;var n=cur?cur+' '+w:w;if(fits(n)){cur=n;return;}if(cur)out.push(cur);cur='';
    if(fits(w)){cur=w;return;}for(var i=0;i<w.length;i++){var m=cur+w[i];if(!fits(m)&&cur){out.push(cur);cur=w[i];}else cur=m;}});
  if(cur)out.push(cur);return out;}
function stroke(g,txt,x,y,font,fill,lw){g.font=font;g.textAlign='center';g.textBaseline='alphabetic';g.lineJoin='round';if(lw){g.lineWidth=lw;g.strokeStyle='rgba(0,0,0,.9)';g.strokeText(txt,x,y);}g.fillStyle=fill;g.fillText(txt,x,y);}
function frameAt(g,W,H,tt){
  var s=0,k=0;for(;k<CARDS.length;k++){if(tt<s+CARDS[k].dur||k===CARDS.length-1)break;s+=CARDS[k].dur;}
  var c=CARDS[k],el=Math.max(0,tt-s),p=Math.min(1,el/c.dur),t2=c.cap2?c.dur*c.at2:1e9,after=el>=t2;
  g.fillStyle='#000';g.fillRect(0,0,W,H);
  var z=1;if(c.zoom==='in')z=1+0.07*p;else if(c.zoom==='punch'){var q=after?Math.min(1,(el-t2)/0.18):0;z=1.01+0.13*(1-Math.pow(1-q,3));}
  var im=c.img,sc=Math.max(W/im.width,H/im.height)*z,w=im.width*sc,h=im.height*sc,cx=c.zoom==='punch'&&c.bubble?(0.5-c.bx)*0.25:0,cy=c.zoom==='punch'?(0.55-(c.bubble?c.by:0.55))*0.25:0;
  g.drawImage(im,(W-w)/2+cx*w*(z-1)*4,(H-h)/2+cy*h*(z-1)*4,w,h);
  // 위 자막
  var cap=after?c.cap2:c.cap1,since=after?el-t2:el;
  if(cap){var pop=Math.min(1,since/0.16),fs=Math.round(58*(0.86+0.14*pop)),fnt='900 '+fs+'px '+FONT;g.font=fnt;var ls=wrap(g,cap,W-110).slice(0,3);
    ls.forEach(function(l,i){stroke(g,l,W/2,H*0.10+fs+i*(fs+12),fnt,'#FFFFFF',13);});
    var y=H*0.10+fs+ls.length*(fs+12);
    if(c.sub&&!after){var f2='700 30px '+FONT;g.font=f2;wrap(g,c.sub,W-120).slice(0,2).forEach(function(l,i){stroke(g,l,W/2,y+6+i*40,f2,'#FFE14D',7);});}}
  else if(c.sub){var f3='700 30px '+FONT;stroke(g,c.sub,W/2,H*0.14,f3,'#FFE14D',7);}
  // 말풍선 안 글자(그림의 빈 말풍선 위치)
  if(c.bubble){var f4='800 40px '+FONT;g.font=f4;var bl=wrap(g,c.bubble,W*0.42).slice(0,2);bl.forEach(function(l,i){stroke(g,l,W*c.bx,H*c.by+14+(i-(bl.length-1)/2)*46,f4,'#1A2330',0);});}
  return {k:k,s:s};
}

// ---------- 렌더 (dry=미리보기, 녹화 안 함) ----------
async function render(dry){
  if(RUN){RUN.stop=true;return;}
  if(!CARDS.length){toast('그림을 먼저 넣어 주세요');return;}
  var ac=getAC(),W=720,H=1280,TOT=total(),END=0.7,full=TOT+END;
  var btn=dry?$('pvBtn'):$('renderBtn'),other=dry?$('renderBtn'):$('pvBtn'),label=btn.textContent;other.disabled=true;btn.textContent='■ 멈추기';
  var run=RUN={stop:false};
  $('outCard').style.display='block';var out=$('out');out.innerHTML='<p class="prog" id="rp">'+(dry?'미리보기 중…':'녹화 중… 화면을 켜 두세요')+'</p><div class="bar"><i id="rb"></i></div>';
  var cv=document.createElement('canvas');cv.width=W;cv.height=H;cv.className='pv';out.appendChild(cv);var g=cv.getContext('2d');
  out.scrollIntoView({block:'center'});
  var lock=null;try{if(navigator.wakeLock)lock=await navigator.wakeLock.request('screen');}catch(e){}
  try{
    if(BGM&&!BGM.buf&&T.bgv){try{BGM.buf=await decode(ac,await BGM.file.arrayBuffer());}catch(e){toast('배경음악 파일을 읽지 못했어요');BGM=null;}}
    var dest=null,rec=null,chunks=[],mime='';
    if(!dry){
      if(!cv.captureStream||!window.MediaRecorder)throw new Error('이 브라우저는 영상 녹화를 못 해요(iOS 최신 Safari 필요).');
      dest=ac.createMediaStreamDestination();BUS.comp.connect(dest);
      mime=['video/mp4;codecs=avc1','video/mp4','video/webm;codecs=vp9,opus','video/webm'].filter(function(m){return MediaRecorder.isTypeSupported&&MediaRecorder.isTypeSupported(m);})[0]||'';
      rec=new MediaRecorder(new MediaStream(cv.captureStream(30).getVideoTracks().concat(dest.stream.getAudioTracks())),mime?{mimeType:mime,videoBitsPerSecond:5000000}:{});
      rec.ondataavailable=function(e){if(e.data&&e.data.size)chunks.push(e.data);};
    }
    frameAt(g,W,H,0);
    if(rec)rec.start(500);
    var t0=ac.currentTime+0.25,srcs=[];
    // 효과음·배경음악 예약
    var s=0;CARDS.forEach(function(c){if(c.sfx1)playSfx(ac,c.sfx1,t0+s+0.04,BUS.sfx);if(c.cap2&&c.sfx2)playSfx(ac,c.sfx2,t0+s+c.dur*c.at2,BUS.sfx);s+=c.dur;});
    if(BGM&&BGM.buf&&T.bgv){var b=ac.createBufferSource(),bg=ac.createGain();b.buffer=BGM.buf;b.loop=BGM.buf.duration<full;bg.gain.setValueAtTime(0.0001,t0);bg.gain.exponentialRampToValueAtTime(T.bgv,t0+0.3);bg.gain.setValueAtTime(T.bgv,t0+full-0.8);bg.gain.exponentialRampToValueAtTime(0.0001,t0+full);
      b.connect(bg);bg.connect(BUS.comp);b.start(t0);b.stop(t0+full+0.05);srcs.push(b);}
    await new Promise(function(done){(function loop(){var tt=ac.currentTime-t0;if(tt>=full||run.stop){done();return;}frameAt(g,W,H,Math.max(0,Math.min(TOT-0.001,tt)));var bb=$('rb');if(bb)bb.style.width=Math.min(100,tt/full*100)+'%';requestAnimationFrame(loop);})();});
    if(run.stop)srcs.forEach(function(x){try{x.stop();}catch(e){}});
    if(rec){if(!run.stop)await sleep(600);await new Promise(function(ok){rec.onstop=ok;try{rec.stop();}catch(e){ok();}});}
    if(dest)try{BUS.comp.disconnect(dest);}catch(e){}
    if(dry||run.stop){$('rp').textContent=run.stop?'멈췄어요':'미리보기 끝 — 괜찮으면 🎬 영상 만들기';return;}
    var type=(mime||'video/mp4').split(';')[0],blob=new Blob(chunks,{type:type});done(blob,type);
  }catch(e){out.insertAdjacentHTML('beforeend','<p class="err">'+esc(e.message||e)+'</p>');}
  finally{RUN=null;btn.textContent=label;other.disabled=false;try{if(lock)lock.release();}catch(e){}}
}
function done(blob,type){
  var url=URL.createObjectURL(blob),ext=type.indexOf('webm')>=0?'webm':'mp4',x=T.idea||{};
  var title=x.title||(CARDS[0]&&CARDS[0].cap1)||'공감툰';
  $('out').innerHTML='<video class="out" controls playsinline src="'+url+'"></video>'
   +'<p class="note" style="text-align:center">'+(total()+0.7).toFixed(1)+'초 · '+(blob.size/1048576).toFixed(1)+'MB</p>'
   +'<button class="big ok" id="dl">📥 기기에 저장 · 인스타에 올리기</button>'
   +'<p class="lbl">유튜브 제목</p><input type="text" id="yt" value="'+esc(title)+'">'
   +'<p class="lbl">공개 범위</p><div class="chips">'+[['private','비공개'],['unlisted','일부 공개'],['public','바로 공개']].map(function(p,k){return '<button class="chip'+(k===0?' on':'')+'" data-pv="'+p[0]+'">'+p[1]+'</button>';}).join('')+'</div>'
   +'<button class="big red" id="ytUp">▶ 유튜브에 올리기</button><div class="bar" id="ubw" style="display:none;margin-top:8px"><i id="ub"></i></div><p class="note">AI 로 만든 그림이라 AI 합성 콘텐츠로 표시돼요. 제목에 #Shorts 가 붙어요.</p><div class="err" id="ue"></div>';
  var PV='private';document.querySelectorAll('[data-pv]').forEach(function(c){c.onclick=function(){PV=c.getAttribute('data-pv');document.querySelectorAll('[data-pv]').forEach(function(z){z.classList.toggle('on',z===c);});};});
  $('dl').onclick=function(){var f=new File([blob],($('yt').value||'toon').replace(/[\\/:*?"<>|#]/g,'').slice(0,40)+'.'+ext,{type:type});
    if(navigator.canShare&&navigator.canShare({files:[f]}))navigator.share({files:[f]}).catch(function(){});else{var a=document.createElement('a');a.href=url;a.download=f.name;a.click();}};
  $('ytUp').onclick=async function(){var b=this,ue=$('ue');b.disabled=true;ue.textContent='';
    try{var tt=$('yt').value.trim()||title;
      if(!T.id){var n=await api('/shorts/toon/new',{topic:T.topic,title:tt,description:x.description||'',tags:x.tags||[]});if(!n.ok)throw new Error(n.detail||n.error);T.id=n.id;}
      var mb=(blob.size/1048576).toFixed(1);$('ubw').style.display='block';
      var j=await new Promise(function(ok,no){var q=new XMLHttpRequest();q.open('POST','/shorts/save?id='+T.id);q.setRequestHeader('content-type',type);q.setRequestHeader('x-code',CODE);
        q.upload.onprogress=function(e){if(e.lengthComputable){var f=e.loaded/e.total;b.innerHTML='<span class="spin">⏫</span> 저장 중… '+Math.round(f*100)+'% ('+mb+'MB)';$('ub').style.width=Math.round(f*100)+'%';}};
        q.onload=function(){try{ok(JSON.parse(q.responseText));}catch(e){no(new Error('서버 응답 오류 '+q.status));}};q.onerror=function(){no(new Error('네트워크 오류 — 다시 눌러 주세요'));};q.send(blob);});
      if(!j.ok)throw new Error(j.detail||j.error);
      b.innerHTML='<span class="spin">▶</span> 유튜브에 올리는 중…';
      var y=await api('/shorts/yt/upload',{id:T.id,privacy:PV,title:tt,description:x.description||'',tags:(x.tags||[]).concat(['공감툰','해외살이','광저우']),synthetic:true});
      if(!y.ok)throw new Error(y.detail||y.error);
      b.textContent='✅ 올렸어요';ue.innerHTML='<a href="'+esc(y.yt.url)+'" target="_blank" style="color:var(--sky)">'+esc(y.yt.url)+'</a>';
    }catch(e){ue.textContent=e.message;b.disabled=false;b.textContent='▶ 다시 올리기';}};
}
start();
</script></body></html>`;
