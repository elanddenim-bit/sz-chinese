// =========================================================
// 📋 촬영 모드 (주인 전용, 숏츠 공방 '만들기' 버튼) — 대본 한 줄 = 컷 하나인 촬영 계획을 현장에서 보며 체크
//  폰 localStorage 'sh-shoot' 가 먼저(상가·매장 안 신호 약함), 서버 POST /shorts/shoot/* 로 동기화(upd 큰 쪽).
//  [__] 빈칸은 현장에서 숫자 채우기 → '편집실로' 가 채운 대본을 대본 모드에 넣고 컷 설명을 배치 힌트로 넘김(ed-shoot)
// =========================================================
export const SHOOT_HTML = String.raw`<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#1664B0">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="촬영 모드">
<link rel="apple-touch-icon" href="/shorts-180.png"><link rel="icon" href="/shorts-192.png">
<title>촬영 모드</title>
<style>
:root{--sky:#1664B0;--bg:#EFE8DE;--card:#F7F2EA;--ink:#1A2330;--ink2:#5E6672;--line:#D9CEBD;--red:#D21624;--soft:#E6DCCB;--ok:#1F7A4D}
@media (prefers-color-scheme:dark){:root{--bg:#141A22;--card:#1C2430;--ink:#EDE6DA;--ink2:#9AA3AE;--line:#2C3644;--soft:#253041;--ok:#5CC08C}}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 -apple-system,"Apple SD Gothic Neo","PingFang SC",system-ui,sans-serif;-webkit-text-size-adjust:100%}
header{background:var(--sky);color:#fff;padding:calc(env(safe-area-inset-top) + 12px) 16px 12px;border-bottom:3px solid var(--red);display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:5}
header h1{margin:0;font-size:18px;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}header a,header button{color:#fff;text-decoration:none;font-size:15px;background:none;border:0;font-family:inherit;padding:4px}
header .pg{font-weight:700;font-size:15px}
.bar{height:5px;background:var(--line)}.bar i{display:block;height:100%;background:#FFD84D;width:0;transition:width .3s}
main{max-width:640px;margin:0 auto;padding:14px 16px calc(120px + env(safe-area-inset-bottom))}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:12px}
.card h2{margin:0 0 8px;font-size:16px}.note{font-size:13px;color:var(--ink2);margin:6px 0 0}.err{color:var(--red);font-size:14px;margin-top:8px;white-space:pre-wrap}
input[type=text],textarea{width:100%;font:inherit;font-size:16px;padding:9px 10px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink)}
textarea{min-height:90px;resize:vertical}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}.chip{border:1px solid var(--line);background:transparent;color:var(--ink);border-radius:999px;padding:6px 12px;font:inherit;font-size:14px}.chip.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.big{display:block;width:100%;border:0;border-radius:12px;background:var(--sky);color:#fff;font:inherit;font-weight:700;font-size:17px;padding:15px;margin-top:10px;text-align:center;text-decoration:none}.big:disabled{opacity:.5}
.big.ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}.big.red{background:var(--red)}.big.ok{background:var(--ok)}
.plan{display:flex;align-items:center;gap:10px;padding:12px 0;border-top:1px solid var(--line)}.plan:first-of-type{border-top:0}
.plan .t{flex:1;min-width:0}.plan b{display:block;font-size:16px}.plan small{color:var(--ink2);font-size:13px}.plan .n{font-weight:700;color:var(--sky);font-size:15px;white-space:nowrap}
.mini{display:flex;gap:6px;flex-wrap:wrap}.mini button{border:1px solid var(--line);background:transparent;color:var(--ink);border-radius:9px;padding:6px 10px;font:inherit;font-size:13px}
.it{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 14px;margin-bottom:10px}
.it .hd{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink2);flex-wrap:wrap}.it .hd b{color:var(--sky);font-size:14px}
.it .how{background:var(--soft);border-radius:6px;padding:1px 7px;color:var(--ink)}.it .st{margin-left:auto;color:var(--ok);font-weight:700}
.it .what{font-size:16px;font-weight:600;margin:4px 0 2px}.it .say{font-size:14px;color:var(--ink2)}
.it.done{opacity:.55;padding:8px 14px}.it.done .say,.it.done .what{font-size:14px}.it.done .what{font-weight:500}
.it.cur{border:2px solid var(--red);opacity:1;padding:16px;box-shadow:0 4px 18px rgba(0,0,0,.08)}
.it.cur .what{font-size:22px;line-height:1.35;margin:8px 0 6px}.it.cur .how{font-size:15px;padding:3px 9px}.it.cur .say{font-size:16px;color:var(--ink);margin:8px 0}
.say input.f{display:inline-block;width:auto;min-width:64px;max-width:9em;font-size:15px;padding:2px 6px;margin:0 2px;border:0;border-bottom:2px solid var(--red);border-radius:4px 4px 0 0;background:var(--soft)}
.say input.f.has{border-bottom-color:var(--ok)}
.it .act{display:flex;gap:8px;margin-top:10px}.it .act .big{margin:0}.it .act .ghost{flex:0 0 auto;width:auto;padding:15px 14px;font-size:14px}
.ed input{margin:4px 0;font-size:15px}.ed .mini{margin-top:4px}
.tips{font-size:14px;margin:0;padding-left:18px}.tips li{margin:3px 0}
.dock{position:fixed;left:0;right:0;bottom:0;background:var(--bg);border-top:1px solid var(--line);padding:8px 16px calc(8px + env(safe-area-inset-bottom));z-index:4}
.dock .in{max-width:640px;margin:0 auto;display:flex;gap:8px}.dock .big{margin:0}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#9AA3AE;margin-left:4px;vertical-align:middle}.dot.ok{background:#5CC08C}.dot.bad{background:#FFB020}
.toast{position:fixed;left:50%;bottom:110px;transform:translateX(-50%);background:var(--ink);color:var(--bg);padding:10px 16px;border-radius:12px;font-size:14px;z-index:9;max-width:88%;text-align:center}
.gate{text-align:center;padding:40px 10px;color:var(--ink2)}
</style></head><body>
<header id="hd"><a href="/shorts">←</a><h1 id="ttl">📋 촬영 모드</h1><span class="pg" id="pg"></span><span class="dot" id="sy"></span></header>
<div class="bar" id="barw" style="display:none"><i id="bar"></i></div>
<main id="main"></main>
<div class="dock" id="dock" style="display:none"><div class="in"><button class="big ghost" id="edBtn" style="flex:0 0 auto;width:auto;padding:15px 14px">✏️</button><button class="big red" id="goEdit">🎥 편집실로</button></div></div>
<script>
var CODE='';try{CODE=localStorage.getItem('pb-code')||'';}catch(e){}
var S={plans:[],gone:[]};try{var _s=JSON.parse(localStorage.getItem('sh-shoot')||'null');if(_s&&Array.isArray(_s.plans))S=_s;S.gone=S.gone||[];}catch(e){}
var CUR='',EDIT=false,SEC=45,T={},WL=null;
function $(i){return document.getElementById(i);}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function toast(t){var d=document.createElement('div');d.className='toast';d.textContent=t;document.body.appendChild(d);setTimeout(function(){d.remove();},2600);}
function api(p,b){b=b||{};b.code=CODE;return fetch(p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json().catch(function(){return {error:'서버 응답 오류 '+r.status};});},function(e){return {error:'network',detail:'네트워크가 약해요. 폰에는 저장돼 있어요.'};});}
function hm(t){var d=new Date(t);return ('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2);}
function local(){try{localStorage.setItem('sh-shoot',JSON.stringify(S));}catch(e){}}
function plan(id){for(var i=0;i<S.plans.length;i++)if(S.plans[i].id===id)return S.plans[i];return null;}
function sy(c){$('sy').className='dot'+(c?' '+c:'');}
// 바꿀 때마다 폰에 바로 저장 → 1.2초 뒤 서버로(실패해도 폰 저장본으로 계속)
function save(p){p.upd=Date.now();local();clearTimeout(T[p.id]);T[p.id]=setTimeout(function(){api('/shorts/shoot/save',{plan:p}).then(function(r){sy(r&&r.ok?'ok':'bad');});},1200);}
function sync(){api('/shorts/shoot/list',{}).then(function(r){if(!r||!r.ok){sy('bad');return;}sy('ok');
  (r.gone||[]).forEach(function(id){if(S.gone.indexOf(id)<0)S.gone.push(id);});
  S.plans=S.plans.filter(function(p){return S.gone.indexOf(p.id)<0;});
  (r.plans||[]).forEach(function(sp){var lp=plan(sp.id);if(!lp)S.plans.push(sp);else if(sp.upd>lp.upd){S.plans[S.plans.indexOf(lp)]=sp;}else if(lp.upd>sp.upd)save(lp);});
  S.plans.forEach(function(p){if(!(r.plans||[]).some(function(x){return x.id===p.id;}))save(p);});
  local();CUR?(plan(CUR)?view():list()):list();});}

// ---- 미리 넣어 둔 계획(2026-10-31 선전) ----
function mk(a){return a.map(function(x){return {say:x[0],what:x[1],how:x[2],done:0,memo:'',fill:{}};});}
var PRESETS=[
 {id:'p-musinsa',title:'선전 무신사 오픈 첫날',topic:'선전 卓悦中心(One Avenue) 무신사 스탠다드·무신사 스토어 오픈 첫날, 한국 가격과 비교',series:'price',
  tips:['비교할 제품 3개(기본 티·슬랙스·아우터)는 가격표 + 한국 앱 가격을 세트로','가격표는 손에 들고 3초 이상, 매장 안 촬영은 짧게','줄·손님은 뒷모습으로'],
  items:mk([
  ['한국 무신사 스탠다드, 중국에선 더 쌀까요?','가격표를 손에 들고 보여 주기','인서트·아이레벨·고정'],
  ['오늘 선전에 무신사 매장이 문을 열어서 와 봤어요','卓悦中心 외관 또는 매장 간판','와이드·로우앵글·고정'],
  ['스탠다드랑 무신사 스토어가 한 건물에 같이 열었어요','두 매장 입구가 한 화면에','와이드·아이레벨·팬'],
  ['오픈 첫날이라 줄이 [이 정도] 서 있네요','줄 선 사람들 뒷모습·머릿수','와이드·하이앵글·고정'],
  ['제일 궁금했던 가격부터 볼게요','매장 안으로 걸어 들어가기(내 시점)','미디엄·아이레벨·트래킹'],
  ['이 기본 티가 [__]위안, 우리 돈 약 [__]원이에요','기본 티 가격표(제품명+가격) 3초','인서트·고정'],
  ['한국 앱에선 같은 제품이 [__]원이고요','한국 무신사 앱에서 같은 제품 화면','폰 화면 녹화'],
  ['슬랙스는 [__]위안, 한국보다 [__]원 [비싸요/싸요]','슬랙스 가격표 → 걸린 모습','인서트 → 미디엄'],
  ['선전 날씨에 맞춰 옷을 골랐다는데, 실제로 [얇은 옷이 많아요]','반팔·얇은 옷 행거 전체','미디엄·팬'],
  ['중국 손님들은 [__] 코너에 제일 많이 모여 있어요','손님 몰린 코너, 뒷모습으로','와이드·고정'],
  ['결론은 [한국에서 사 오는 게 낫겠어요]','쇼핑백 또는 계산대','클로즈업·고정'],
  ['여러분이라면 어디서 사실래요?','쇼핑백 들고 나가는 내 뒷모습','미디엄·트래킹']])},
 {id:'p-hqb',title:'화창베이 100위안 챌린지',topic:'선전 화창베이(华强北) 전자상가에서 100위안으로 살 수 있는 것',series:'price',
  tips:['상인 얼굴·가게 정면은 피하고 물건과 손 위주','짝퉁 제품은 찍지도 사지도 않기','흥정했으면 처음 부른 값 → 산 값을 메모에'],
  items:mk([
  ['100위안 들고 세계 최대 전자상가에 왔어요','100위안 지폐를 손에 들기','인서트·고정'],
  ['여기가 선전 화창베이, 건물 하나가 통째로 전자상가예요','赛格广场·거리 올려다보기','와이드·로우앵글·틸트'],
  ['요즘은 가게 절반이 AI 제품이에요','상가 통로 걸어가기(가게 정면 피하기)','미디엄·트래킹'],
  ['첫 번째, [고속 충전기]가 [__]위안','첫 물건 가격표·계산기 → 손에 쥔 모습','인서트'],
  ['한국에선 비슷한 게 [__]원 정도죠','쿠팡·네이버 비슷한 제품 화면','폰 화면 녹화'],
  ['두 번째, [__]는 [__]위안이에요','두 번째 물건','인서트'],
  ['보조배터리 살 땐 3C 마크부터 확인하세요','보조배터리를 마크 쪽으로 돌리기','클로즈업'],
  ['이 마크 없으면 중국 국내선에 못 들고 타요','3C 마크 초근접','익스트림 클로즈업·고정'],
  ['남은 돈은 [__]위안, 마지막은 [__]로 할게요','남은 돈 세는 손','탑뷰·고정'],
  ['100위안으로 산 건 이렇게 [__]개예요','산 물건 전부 테이블에 펼치기','탑뷰·고정'],
  ['한국 돈으로 치면 [__]원어치 아낀 셈이에요','물건 하나씩 집어 드는 손','클로즈업'],
  ['여러분이라면 100위안으로 뭘 사실래요?','봉지 들고 걸어 나가는 뒷모습','미디엄·트래킹']])}];

// ---- 빈칸 [..] ----
function parts(say){return String(say||'').split(/\[([^\]]*)\]/);}
function filled(it){var ps=parts(it.say),o='';for(var i=0;i<ps.length;i++){if(i%2===0)o+=ps[i];else{var k=(i-1)/2,v=(it.fill||{})[k];o+=(v&&v.trim())?v.trim():'['+ps[i]+']';}}return o;}
function sayHtml(it,i,inp){var ps=parts(it.say),o='';for(var j=0;j<ps.length;j++){if(j%2===0)o+=esc(ps[j]);else{var k=(j-1)/2,v=(it.fill||{})[k]||'';
  o+=inp?'<input class="f'+(v?' has':'')+'" data-i="'+i+'" data-k="'+k+'" value="'+esc(v)+'" placeholder="'+esc(ps[j]||'__')+'" inputmode="'+(/__/.test(ps[j])?'decimal':'text')+'">':'<u>'+esc(v||'['+ps[j]+']')+'</u>';}}return o;}
function blanks(p){var n=0;p.items.forEach(function(it){var ps=parts(it.say);for(var j=1;j<ps.length;j+=2)if(!((it.fill||{})[(j-1)/2]||'').trim())n++;});return n;}
function curIdx(p){if(p.items[p.cur]&&!p.items[p.cur].done)return p.cur;for(var i=0;i<p.items.length;i++)if(!p.items[i].done)return i;return -1;}

// ---- 목록 ----
function list(){CUR='';EDIT=false;releaseWL();$('ttl').textContent='📋 촬영 모드';$('pg').textContent='';$('barw').style.display='none';$('dock').style.display='none';
  if(!CODE){$('main').innerHTML='<div class="gate">숏츠 공방에서 초대 코드를 먼저 넣어 주세요.<br><a class="big" href="/shorts">숏츠 공방으로</a></div>';return;}
  var h='';
  var miss=PRESETS.filter(function(p){return !plan(p.id)&&S.gone.indexOf(p.id)<0;});
  if(miss.length)h+='<div class="card"><h2>📦 10/31 선전 촬영 계획</h2><p class="note" style="margin:0 0 4px">'+miss.map(function(p){return esc(p.title);}).join(' · ')+' — 대본·컷 리스트가 다 들어 있어요.</p><button class="big ok" id="preset">불러오기</button></div>';
  h+='<div class="card"><h2>내 촬영 계획</h2>'+(S.plans.length?S.plans.slice().sort(function(a,b){return b.upd-a.upd;}).map(function(p){var d=p.items.filter(function(x){return x.done;}).length;
    return '<div class="plan" data-open="'+esc(p.id)+'"><div class="t"><b>'+esc(p.title)+'</b><small>컷 '+p.items.length+'개'+(blanks(p)?' · 빈칸 '+blanks(p)+'개':'')+'</small></div><span class="n">'+d+'/'+p.items.length+'</span></div>';}).join(''):'<p class="note">아직 없어요. 아래에서 만들어 보세요.</p>')+'</div>';
  h+='<div class="card"><h2>＋ 새 촬영 계획</h2><input type="text" id="topic" placeholder="어디서 뭘 찍나요? 예: 广州 早茶 집 가격"><div class="chips">'+[30,45,60].map(function(s){return '<button class="chip'+(s===SEC?' on':'')+'" data-sec="'+s+'">'+s+'초</button>';}).join('')+'</div>'
    +'<textarea id="lines" placeholder="대본이 있으면 붙여 넣기 (한 줄 = 한 컷, 비우면 AI가 대본도 씀)"></textarea>'
    +'<button class="big" id="aiNew">🤖 AI로 컷 리스트 만들기</button><button class="big ghost" id="manNew">대본만으로 만들기(AI 없이)</button><div class="err" id="ne"></div></div>';
  $('main').innerHTML=h;
  if($('preset'))$('preset').onclick=function(){miss.forEach(function(p){var c=JSON.parse(JSON.stringify(p));c.made=Date.now();c.cur=0;S.plans.push(c);save(c);});list();toast('불러왔어요');};
  document.querySelectorAll('[data-open]').forEach(function(el){el.onclick=function(){CUR=el.getAttribute('data-open');view();};});
  document.querySelectorAll('[data-sec]').forEach(function(b){b.onclick=function(){SEC=+b.getAttribute('data-sec');document.querySelectorAll('[data-sec]').forEach(function(x){x.classList.toggle('on',x===b);});};});
  $('aiNew').onclick=aiNew;$('manNew').onclick=function(){var L=getLines();if(L.length<2){$('ne').textContent='대본을 두 줄 이상 적어 주세요.';return;}
    newPlan(($('topic').value||'').trim()||'촬영 계획',L.map(function(s){return {say:s,what:'',how:''};}),[]);};
}
function getLines(){return ($('lines').value||'').split(/\n/).map(function(x){return x.trim();}).filter(Boolean);}
function newPlan(title,items,tips){var p={id:'s'+Date.now().toString(36),title:title.slice(0,60),topic:($('topic')&&$('topic').value||'').trim(),series:/가격|얼마|위안|물가/.test(title+JSON.stringify(items))?'price':'',tips:tips||[],made:Date.now(),cur:0,
  items:items.map(function(x){return {say:x.say||'',what:x.what||'',how:x.how||'',done:0,memo:'',fill:{}};})};S.plans.push(p);save(p);CUR=p.id;view();}
async function aiNew(){var b=$('aiNew'),t=($('topic').value||'').trim(),L=getLines();if(!t&&!L.length){$('ne').textContent='주제나 대본을 적어 주세요.';return;}
  b.disabled=true;b.textContent='🤖 만드는 중… (10~20초)';$('ne').textContent='';
  var r=await api('/shorts/shoot/ai',{topic:t,lines:L,sec:SEC});b.disabled=false;b.textContent='🤖 AI로 컷 리스트 만들기';
  if(!r||!r.ok){$('ne').textContent=(r&&(r.detail||r.error))||'실패';return;}newPlan(r.title,r.items,r.tips);}

// ---- 촬영 화면 ----
function view(){var p=plan(CUR);if(!p)return list();
  var ci=curIdx(p),d=p.items.filter(function(x){return x.done;}).length;
  $('ttl').textContent=p.title;$('pg').textContent=d+'/'+p.items.length;$('barw').style.display='';$('bar').style.width=(100*d/Math.max(1,p.items.length))+'%';$('dock').style.display='';
  $('edBtn').textContent=EDIT?'✓':'✏️';
  var h='';
  if(!EDIT&&p.tips&&p.tips.length)h+='<details class="card"><summary style="font-weight:600">💡 현장 팁 '+p.tips.length+'</summary><ul class="tips">'+p.tips.map(function(x){return '<li>'+esc(x)+'</li>';}).join('')+'</ul></details>';
  if(!EDIT&&ci<0)h+='<div class="card" style="border-color:var(--ok)"><h2>🎉 다 찍었어요</h2><p class="note" style="margin:0">'+(blanks(p)?'빈칸 '+blanks(p)+'개가 남았어요 — 숫자를 채우고 ':'')+'편집실로 넘기면 대본 모드에 대본이 들어가요.</p></div>';
  h+=p.items.map(function(it,i){
    if(EDIT)return '<div class="it ed"><div class="hd"><b>컷 '+(i+1)+'</b></div><input type="text" data-e="what" data-i="'+i+'" value="'+esc(it.what)+'" placeholder="무엇을 찍나"><input type="text" data-e="how" data-i="'+i+'" value="'+esc(it.how)+'" placeholder="샷 크기·각도·움직임"><input type="text" data-e="say" data-i="'+i+'" value="'+esc(it.say)+'" placeholder="대본 한 줄 (빈칸은 [__])"><div class="mini"><button data-up="'+i+'">↑</button><button data-dn="'+i+'">↓</button><button data-del="'+i+'">삭제</button></div></div>';
    var cur=i===ci,cls='it'+(cur?' cur':it.done?' done':'');
    return '<div class="'+cls+'" data-i="'+i+'"><div class="hd"><b>컷 '+(i+1)+'</b>'+(it.how?'<span class="how">'+esc(it.how)+'</span>':'')+(it.done?'<span class="st">✓ '+hm(it.done)+'</span>':'')+'</div>'
      +'<div class="what">'+esc(it.what||'(무엇을 찍을지 비어 있음)')+'</div><div class="say">🎙 '+sayHtml(it,i,cur||!!it.done||parts(it.say).length>1)+'</div>'
      +(it.memo&&!cur?'<div class="note">📝 '+esc(it.memo)+'</div>':'')
      +(cur?'<input type="text" class="memo" data-m="'+i+'" value="'+esc(it.memo||'')+'" placeholder="📝 메모 (흥정 값·제품명 등)" style="margin-top:4px"><div class="act"><button class="big ghost" data-skip="'+i+'">건너뛰기</button><button class="big ok" data-shot="'+i+'">✓ 찍었어요</button></div>':'')
      +(it.done?'<div class="mini" style="margin-top:6px"><button data-redo="'+i+'">다시 찍기</button></div>':'')+'</div>';}).join('');
  if(EDIT)h+='<button class="big ghost" id="addIt">＋ 컷 추가</button><button class="big ghost" id="ren">이름 바꾸기</button><button class="big ghost" id="reset">체크 전부 풀기</button><button class="big ghost" id="delP" style="color:var(--red)">이 계획 삭제</button>';
  else h+='<button class="big ghost" id="back">← 계획 목록</button>';
  $('main').innerHTML=h;bind(p);if(!EDIT)keepAwake();
}
function bind(p){
  document.querySelectorAll('input.f').forEach(function(el){el.oninput=function(){var it=p.items[+el.getAttribute('data-i')];it.fill=it.fill||{};it.fill[el.getAttribute('data-k')]=el.value;el.classList.toggle('has',!!el.value);save(p);};el.onclick=function(e){e.stopPropagation();};});
  document.querySelectorAll('[data-m]').forEach(function(el){el.oninput=function(){p.items[+el.getAttribute('data-m')].memo=el.value;save(p);};});
  document.querySelectorAll('[data-shot]').forEach(function(b){b.onclick=function(e){e.stopPropagation();var i=+b.getAttribute('data-shot');p.items[i].done=Date.now();p.cur=nextOpen(p,i);save(p);view();scrollCur();};});
  document.querySelectorAll('[data-skip]').forEach(function(b){b.onclick=function(e){e.stopPropagation();var i=+b.getAttribute('data-skip');p.cur=nextOpen(p,i);save(p);view();scrollCur();};});
  document.querySelectorAll('[data-redo]').forEach(function(b){b.onclick=function(e){e.stopPropagation();var i=+b.getAttribute('data-redo');p.items[i].done=0;p.cur=i;save(p);view();scrollCur();};});
  document.querySelectorAll('.it[data-i]').forEach(function(el){el.onclick=function(){var i=+el.getAttribute('data-i');if(p.items[i].done||curIdx(p)===i)return;p.cur=i;save(p);view();scrollCur();};});
  document.querySelectorAll('[data-e]').forEach(function(el){el.oninput=function(){p.items[+el.getAttribute('data-i')][el.getAttribute('data-e')]=el.value;save(p);};});
  document.querySelectorAll('[data-up]').forEach(function(b){b.onclick=function(){mv(p,+b.getAttribute('data-up'),-1);};});
  document.querySelectorAll('[data-dn]').forEach(function(b){b.onclick=function(){mv(p,+b.getAttribute('data-dn'),1);};});
  document.querySelectorAll('[data-del]').forEach(function(b){b.onclick=function(){p.items.splice(+b.getAttribute('data-del'),1);save(p);view();};});
  if($('addIt'))$('addIt').onclick=function(){p.items.push({say:'',what:'',how:'',done:0,memo:'',fill:{}});save(p);view();};
  if($('ren'))$('ren').onclick=function(){var n=prompt('계획 이름',p.title);if(n&&n.trim()){p.title=n.trim().slice(0,60);save(p);view();}};
  if($('reset'))$('reset').onclick=function(){p.items.forEach(function(x){x.done=0;});p.cur=0;save(p);toast('체크를 풀었어요');view();};
  if($('delP'))$('delP').onclick=function(){if(!confirm('"'+p.title+'" 계획을 지울까요?'))return;S.plans=S.plans.filter(function(x){return x.id!==p.id;});if(S.gone.indexOf(p.id)<0)S.gone.push(p.id);local();api('/shorts/shoot/del',{id:p.id});list();};
  if($('back'))$('back').onclick=list;
}
function nextOpen(p,i){for(var k=1;k<=p.items.length;k++){var j=(i+k)%p.items.length;if(!p.items[j].done)return j;}return 0;}
function mv(p,i,d){var j=i+d;if(j<0||j>=p.items.length)return;var t=p.items[i];p.items[i]=p.items[j];p.items[j]=t;save(p);view();}
function scrollCur(){setTimeout(function(){var el=document.querySelector('.it.cur');if(el)el.scrollIntoView({behavior:'smooth',block:'center'});},30);}
// 촬영 중엔 화면이 꺼지지 않게
function keepAwake(){if(WL||!navigator.wakeLock)return;navigator.wakeLock.request('screen').then(function(w){WL=w;w.addEventListener('release',function(){WL=null;});}).catch(function(){});}
function releaseWL(){if(WL){try{WL.release();}catch(e){}WL=null;}}
document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible'&&CUR&&!EDIT)keepAwake();});
$('edBtn').onclick=function(){EDIT=!EDIT;view();};
$('goEdit').onclick=function(){var p=plan(CUR);if(!p)return;var its=p.items.filter(function(x){return (x.say||'').trim();});
  if(its.length<2){toast('대본 줄이 두 개 이상 있어야 해요');return;}
  var n=blanks(p);if(n&&!confirm('빈칸 '+n+'개가 남았어요. 그대로 넘길까요? (편집실에서 고쳐도 돼요)'))return;
  try{localStorage.setItem('ed-lines',its.map(filled).join('\n'));localStorage.setItem('ed-mode','script');localStorage.setItem('ed-ser',p.series||'');
    localStorage.setItem('ed-shoot',JSON.stringify({id:p.id,title:p.title,topic:p.topic||p.title,shots:its.map(function(x){return [x.what,x.how].filter(Boolean).join(' · ');})}));}catch(e){}
  location.href='/edit?shoot='+encodeURIComponent(p.id);};
var QO=(location.search.match(/[?&]open=([^&]+)/)||[])[1];if(QO&&plan(decodeURIComponent(QO)))CUR=decodeURIComponent(QO);
CUR?view():list();if(CODE)sync();
</script></body></html>`;
