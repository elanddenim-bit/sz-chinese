// =========================================================
// 🌏 오늘의 중국 — 공개 페이지(초대 코드 없음). 매일 아침 한 판: 3문제 퀴즈 + 중국 SNS 화제 5개 + 환율
//  GET /daily        화면 (연속 기록·결과 공유는 기기 localStorage)
//  GET /daily/data   {day, ready, quiz, trend, fx} — 만들어 둔 것만 읽음(5분 캐시). 없으면 어제 판 + 뒤에서 만들기 시작(잠금)
//  크론 dailyCron: 중국 06시 틱에 오늘 화제(trend.js)·퀴즈·환율을 미리 만들어 둠
// 저장: KV daily:quiz:<날짜>(4일) · daily:fx:<날짜>(4일) · daily:lock:<날짜>(90초), 화제는 trend:<날짜> 공유
// 목적: DAU 실험(소유자 2026-10-20 '매일 유입되는 사이트') — 숏츠 채널 '살다보니 외국'과 서로 연결
// [필수] AI 는 百炼(千问)만 — Anthropic 호출 없음
// =========================================================
import { trendApi, trendRead } from "./trend.js";

const cnDay = (t = Date.now()) => new Date(t + 8 * 3600e3).toISOString().slice(0, 10);
const host = (env) => (env.DASHSCOPE_WS_HOST || "dashscope.aliyuncs.com").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
const TTL = 4 * 86400;

function rng(seed) { let h = 2166136261; for (const c of seed) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return () => { h ^= h << 13; h >>>= 0; h ^= h >> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; }; }

async function makeQuiz(env, day, trend) {
  const words = ((trend && trend.items) || []).map((x) => x.word).filter((w) => w && w.z).slice(0, 5);
  const sys = "너는 중국에 살거나 여행하는 한국 사람을 위한 '하루 3문제' 중국어 퀴즈 출제자다. 재미있고, 실제로 써먹을 수 있어야 한다. 정치·민감 주제 금지.\n" +
    "문제 3개: 1번 kind 'trend' = 아래 '오늘 화제 유행어' 중 하나의 뜻 고르기(목록이 비면 요즘 중국 인터넷 유행어 아무거나), 2번 kind 'idiom' = 일상에서 자주 쓰는 성어·관용구 뜻 고르기, 3번 kind 'life' = 중국 생활·여행 상황(식당·택시·쇼핑·배달·위챗 등)에서 이럴 때 중국어로 뭐라고 하는지 고르기.\n" +
    "각 문제: zh(문제의 중국어, 3번은 빈 문자열 가능), p(zh 의 성조 병음), ask(한국어 질문 한 줄), choices(보기 4개 — 1·2번은 한국어 뜻, 3번은 '중국어 (병음)' 형식), ans(정답 번호 0~3), ex(한국어 해설 1~2문장, 쓰는 상황 포함). 오답 보기도 그럴듯하게.\n" +
    'JSON 만: {"q":[{"kind":"trend","zh":"","p":"","ask":"","choices":["","","",""],"ans":0,"ex":""}]}';
  const user = "날짜 " + day + "\n오늘 화제 유행어: " + (words.length ? words.map((w) => w.z + "(" + w.p + ", " + w.k + ")").join(" / ") : "(없음)");
  let last = "";
  for (const model of [env.DAILY_MODEL, env.QUEST_MODEL || "qwen3.8-flash", "qwen-plus"].filter(Boolean)) {
    try {
      const r = await fetch("https://" + host(env) + "/compatible-mode/v1/chat/completions", {
        method: "POST", headers: { authorization: "Bearer " + env.DASHSCOPE_API_KEY, "content-type": "application/json" },
        body: JSON.stringify({ model, temperature: 0.7, enable_thinking: false, response_format: { type: "json_object" }, messages: [{ role: "system", content: sys }, { role: "user", content: user }] }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { last = model + " " + r.status; continue; }
      const c = String(j.choices[0].message.content || "");
      const o = JSON.parse(c.slice(c.indexOf("{"), c.lastIndexOf("}") + 1));
      const R = rng("daily|" + day);
      const q = (o.q || []).map((x) => {
        const ch = (Array.isArray(x.choices) ? x.choices : []).map((v) => String(v || "").slice(0, 60)).filter(Boolean);
        const a = Math.round(Number(x.ans));
        if (ch.length !== 4 || !(a >= 0 && a < 4) || new Set(ch).size !== 4) return null;
        const right = ch[a], mix = ch.map((v) => [R(), v]).sort((u, w) => u[0] - w[0]).map((u) => u[1]); // 정답 위치 섞기(모델이 0번에 몰아 둠)
        return { kind: String(x.kind || "").slice(0, 8), zh: String(x.zh || "").slice(0, 40), p: String(x.p || "").slice(0, 80), ask: String(x.ask || "").slice(0, 80), choices: mix, ans: mix.indexOf(right), ex: String(x.ex || "").slice(0, 200) };
      }).filter((x) => x && x.ask).slice(0, 3);
      if (q.length < 3) { last = model + ": 문제 부족"; continue; }
      return { day, made: Date.now(), q };
    } catch (e) { last = model + ": " + String(e.message || e).slice(0, 80); }
  }
  throw new Error("퀴즈 생성 실패 " + last);
}

async function fx(env, day) {
  const k = "daily:fx:" + day;
  const hit = await env.KV.get(k, "json");
  if (hit) return hit;
  try {
    const r = await fetch("https://api.frankfurter.app/latest?from=CNY&to=KRW,USD");
    const j = await r.json();
    if (!j.rates || !j.rates.KRW) return null;
    const o = { date: j.date, KRW: j.rates.KRW, USD: j.rates.USD };
    await env.KV.put(k, JSON.stringify(o), { expirationTtl: TTL });
    return o;
  } catch { return null; }
}

// 오늘 판 만들기(크론·첫 방문) — 동시에 여러 번 만들지 않게 90초 잠금
async function build(env, ctx, day) {
  const lk = "daily:lock:" + day;
  if (await env.KV.get(lk)) return;
  await env.KV.put(lk, "1", { expirationTtl: 90 });
  // 빠른 것 먼저(첫 방문으로 만들 땐 응답 뒤 30초 안에 끝나야 함): 퀴즈(오늘 화제 없으면 어제 유행어로) → 환율 → 화제(검색, 오래 걸림)
  const trend = (await env.KV.get("trend:" + day, "json")) || (await env.KV.get("trend:" + cnDay(Date.now() - 86400e3), "json"));
  if (!(await env.KV.get("daily:quiz:" + day))) {
    try { await env.KV.put("daily:quiz:" + day, JSON.stringify(await makeQuiz(env, day, trend)), { expirationTtl: TTL }); } catch (e) { console.log("daily quiz", e && e.message); }
  }
  await fx(env, day);
  if (!(await env.KV.get("trend:" + day))) { try { await trendApi(env, ctx, "/trend/today", {}, ""); } catch (e) { console.log("daily trend", e && e.message); } }
}

export async function dailyCron(env, ctx, uh, um) {
  if (uh === 22 && um < 15) await build(env, ctx, cnDay()); // 중국 06시
}

export async function dailyGet(req, env, ctx, url) {
  if (url.pathname === "/daily" || url.pathname === "/daily/") return new Response(DAILY_HTML, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
  if (url.pathname !== "/daily/data") return new Response("not found", { status: 404 });
  const day = cnDay(), yday = cnDay(Date.now() - 86400e3);
  let quiz = await env.KV.get("daily:quiz:" + day, "json"), trend = await trendRead(env, day), useDay = day;
  const ready = !!(quiz && trend);
  if (!ready && env.DASHSCOPE_API_KEY) ctx.waitUntil(build(env, ctx, day).catch(() => {}));
  if (!quiz) { quiz = await env.KV.get("daily:quiz:" + yday, "json"); if (quiz) useDay = yday; }
  if (!trend) trend = await trendRead(env, yday);
  const out = { day: useDay, today: day, ready, quiz, trend: trend ? { day: trend.day, items: trend.items, office: trend.office, sources: (trend.sources || []).slice(0, 6) } : null, fx: await fx(env, day) };
  return new Response(JSON.stringify(out), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": ready ? "public, max-age=300" : "no-store" } });
}

export const DAILY_HTML = String.raw`<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#1664B0">
<title>오늘의 중국 — 하루 3문제 + 중국 SNS 화제</title>
<meta name="description" content="매일 아침 바뀌는 중국어 3문제, 웨이보·더우인에서 지금 뜨는 이야기 5개, 위안화 환율. 중국 사는 한국 사람이 매일 만듭니다.">
<meta property="og:title" content="오늘의 중국 — 하루 3문제">
<meta property="og:description" content="중국어 3문제 + 지금 중국 SNS에서 뜨는 이야기 5개, 매일 아침 새로.">
<meta property="og:type" content="website">
<style>
@font-face{font-family:Pre;src:url(/fonts/pretendard-400.woff2) format("woff2");font-weight:400;font-display:swap}
@font-face{font-family:Pre;src:url(/fonts/pretendard-700.woff2) format("woff2");font-weight:700;font-display:swap}
:root{--sky:#1664B0;--bg:#EFE8DE;--card:#F7F2EA;--ink:#1A2330;--ink2:#5E6672;--line:#D9CEBD;--red:#D21624;--soft:#E6DCCB;--ok:#2E7D5B}
@media (prefers-color-scheme:dark){:root{--bg:#141A22;--card:#1C2430;--ink:#EDE6DA;--ink2:#9AA3AE;--line:#2C3644;--soft:#253041;--ok:#5FBF8F}}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:15.5px/1.55 Pre,-apple-system,"Apple SD Gothic Neo","PingFang SC",system-ui,sans-serif;-webkit-text-size-adjust:100%}
header{background:var(--sky);color:#fff;padding:calc(env(safe-area-inset-top) + 16px) 16px 14px;border-bottom:3px solid var(--red)}
header .in{max-width:640px;margin:0 auto;display:flex;align-items:flex-end;gap:10px}
header h1{margin:0;font-size:22px;font-weight:700;letter-spacing:-.3px}header small{margin-left:auto;font-size:12.5px;opacity:.9;text-align:right}
main{max-width:640px;margin:0 auto;padding:14px 16px 50px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:15px;margin-bottom:12px}
h2.sec{font-size:15px;margin:22px 2px 10px;color:var(--ink2);font-weight:700}
.qz .top{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink2)}.qz .top b{color:var(--red)}
.dots{display:flex;gap:5px;margin-left:auto}.dots i{width:22px;height:8px;border-radius:4px;background:var(--soft)}.dots i.on{background:var(--sky)}.dots i.o{background:var(--ok)}.dots i.x{background:var(--red)}
.qz .zh{font-size:30px;font-weight:700;margin:14px 0 0;line-height:1.3}.qz .py{color:var(--ink2);font-size:14px}
.qz .ask{font-size:17px;font-weight:700;margin:12px 0}
.ch{display:block;width:100%;text-align:left;font:inherit;font-size:16px;color:var(--ink);background:var(--bg);border:1.5px solid var(--line);border-radius:12px;padding:12px 14px;margin:8px 0}
.ch.ok{border-color:var(--ok);background:rgba(46,125,91,.12);font-weight:700}.ch.ng{border-color:var(--red);background:rgba(210,22,36,.1)}
.ex{background:var(--soft);border-radius:10px;padding:10px 12px;font-size:14.5px;margin-top:6px}
.btn{display:inline-block;border:0;border-radius:999px;padding:11px 18px;font:inherit;font-weight:700;font-size:15px;background:var(--sky);color:#fff}
.btn.g{background:transparent;color:var(--ink);border:1px solid var(--line)}
.res{text-align:center}.res .big{font-size:34px;letter-spacing:4px;margin:4px 0}.res .st{font-size:15px}.res .st b{color:var(--red);font-size:20px}
.it .hd{display:flex;gap:10px}.it .e{font-size:24px;flex:none}.it h3{margin:0;font-size:16.5px;line-height:1.35}.it .zh{font-size:12.5px;color:var(--ink2)}
.it p{margin:7px 0 0;font-size:14.5px}.it .why{color:var(--ink2)}
.word{display:flex;align-items:center;gap:10px;margin-top:9px;background:var(--soft);border-radius:10px;padding:8px 10px}.word b{font-size:16.5px}.word small{display:block;color:var(--ink2);font-size:12.5px}
.say{margin-left:auto;border:0;background:var(--sky);color:#fff;border-radius:50%;width:36px;height:36px;font-size:15px;flex:none}
.fx{display:flex;gap:10px;flex-wrap:wrap}.fx div{flex:1 1 120px;background:var(--soft);border-radius:10px;padding:9px 11px}.fx b{font-size:18px;display:block}.fx small{color:var(--ink2);font-size:12px}
.calc{display:flex;gap:8px;align-items:center;margin-top:10px;font-size:15px}.calc input{width:110px;font:inherit;font-size:16px;padding:8px 10px;border:1px solid var(--line);border-radius:9px;background:var(--bg);color:var(--ink)}
.note{font-size:12.5px;color:var(--ink2)}.src a{display:block;font-size:12.5px;color:var(--ink2);padding:2px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.yt{display:flex;align-items:center;gap:12px;text-decoration:none;color:var(--ink)}.yt i{font-style:normal;font-size:26px}.yt small{display:block;color:var(--ink2)}
.toast{position:fixed;left:50%;bottom:calc(22px + env(safe-area-inset-bottom));transform:translateX(-50%);background:var(--ink);color:var(--bg);padding:10px 16px;border-radius:999px;font-size:14px;z-index:9;max-width:90vw;text-align:center}
.wait{padding:30px 0;text-align:center;color:var(--ink2)}
</style></head><body>
<header><div class="in"><h1>🌏 오늘의 중국</h1><small id="dt"></small></div></header>
<main id="main"><div class="wait">오늘 판 불러오는 중…</div></main>
<script>
var D=null,AU=null,CNT={open:1},T0=Date.now(),ST={};
function $(i){return document.getElementById(i);}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function toast(t){var d=document.createElement('div');d.className='toast';d.textContent=t;document.body.appendChild(d);setTimeout(function(){d.remove();},2600);}
function lg(k,v){try{if(v===undefined){var x=localStorage.getItem(k);return x?JSON.parse(x):null;}localStorage.setItem(k,JSON.stringify(v));}catch(e){return null;}}
function md(d){var a=String(d||'').split('-');return a.length===3?(+a[1])+'/'+(+a[2]):d;}
function prevDay(d){var t=new Date(d+'T00:00:00Z');t.setUTCDate(t.getUTCDate()-1);return t.toISOString().slice(0,10);}
function load(){
  fetch('/daily/data').then(function(r){return r.json();}).then(function(j){D=j;ST=lg('dl-r:'+j.day)||{p:[],done:false};render();
    if(!j.ready&&!ST.done){$('dt').textContent+=' · 오늘 판 준비 중';}
  },function(){$('main').innerHTML='<div class="wait">불러오지 못했어요. 인터넷을 확인하고 <a href="" style="color:var(--sky)">다시</a> 열어 주세요.</div>';});
}
function streak(){return lg('dl-st')||{last:'',n:0,best:0};}
function render(){
  $('dt').textContent=md(D.day)+(D.day!==D.today?' (어제 판)':'');
  var h='';
  if(D.quiz){h+='<div class="card qz" id="qz"></div>';}
  else h+='<div class="card wait">오늘 문제를 만드는 중이에요. 잠시 뒤 다시 열어 주세요.</div>';
  if(D.trend&&D.trend.items){
    h+='<h2 class="sec">🔥 지금 중국 SNS에서 뜨는 이야기</h2>';
    h+=D.trend.items.map(function(x){return '<div class="card it"><div class="hd"><div class="e">'+esc(x.emo)+'</div><div><h3>'+esc(x.ko)+'</h3><div class="zh">'+esc(x.zh)+(x.src?' · '+esc(x.src):'')+'</div></div></div><p>'+esc(x.what)+'</p><p class="why">💡 '+esc(x.why)+'</p>'+word(x.word)+'</div>';}).join('');
    if(D.trend.office)h+='<div class="card"><b>💬 중국 친구·동료에게 오늘 한마디</b>'+word(D.trend.office)+'</div>';
    if(D.trend.sources&&D.trend.sources.length)h+='<div class="card"><details><summary class="note">📎 근거로 쓴 검색 결과</summary><div class="src">'+D.trend.sources.map(function(s){return '<a href="'+esc(s.u)+'" target="_blank" rel="noopener">'+esc(s.t||s.u)+'</a>';}).join('')+'</div></details></div>';
  }
  if(D.fx){var k=D.fx.KRW;h+='<h2 class="sec">💱 위안화 환율 <span class="note">'+esc(D.fx.date)+' 유럽중앙은행 기준</span></h2><div class="card"><div class="fx"><div><small>1위안</small><b>'+k.toFixed(1)+'원</b></div><div><small>100위안</small><b>'+Math.round(k*100).toLocaleString()+'원</b></div><div><small>1만원</small><b>'+(10000/k).toFixed(1)+'위안</b></div></div>'
    +'<div class="calc"><input id="cny" type="number" inputmode="decimal" placeholder="위안"><span>위안 =</span><b id="krw">—</b></div></div>';}
  h+='<a class="card yt" href="https://www.youtube.com/@gzthreepark" target="_blank" rel="noopener"><i>▶️</i><div><b>살다보니 외국</b><small>광저우에서 사는 한국 사람의 물가·생활 숏츠</small></div></a>';
  h+='<p class="note" style="text-align:center">매일 아침 7시(한국 시간)에 새 판이 나와요. 화제와 문제는 AI가 중국 SNS 검색 결과로 만든 거라 틀릴 수 있어요.<br>정치·사건 이야기는 일부러 뺐어요.</p>';
  $('main').innerHTML=h;
  if(D.quiz)quiz();
  var c=$('cny');if(c)c.oninput=function(){var v=parseFloat(c.value);$('krw').textContent=v>0?Math.round(v*D.fx.KRW).toLocaleString()+'원':'—';};
  document.querySelectorAll('[data-say]').forEach(function(b){b.onclick=function(){var u=b.getAttribute('data-say');if(!u)return;CNT.say=(CNT.say||0)+1;try{if(AU)AU.pause();AU=new Audio(u);var p=AU.play();if(p&&p.catch)p.catch(function(){toast('소리를 재생하지 못했어요');});}catch(e){}};});
}
function word(w){return w&&w.z?'<div class="word"><div><b>'+esc(w.z)+'</b><small>'+esc(w.p)+' · '+esc(w.k)+'</small></div>'+(w.say?'<button class="say" data-say="'+esc(w.say)+'" aria-label="듣기">🔊</button>':'')+'</div>':'';}
function dots(){return '<div class="dots">'+D.quiz.q.map(function(q,i){var p=ST.p[i];return '<i class="'+(p==null?(i===ST.p.length?'on':''):(p===q.ans?'o':'x'))+'"></i>';}).join('')+'</div>';}
function quiz(){
  var Q=D.quiz.q,i=ST.p.length,box=$('qz');
  if(ST.done||i>=Q.length){return result();}
  var q=Q[i];
  box.innerHTML='<div class="top">오늘의 문제 <b>'+(i+1)+'</b>/'+Q.length+dots()+'</div>'+(q.zh?'<div class="zh">'+esc(q.zh)+'</div><div class="py">'+esc(q.p)+'</div>':'')+'<div class="ask">'+esc(q.ask)+'</div>'
    +q.choices.map(function(c,k){return '<button class="ch" data-k="'+k+'">'+esc(c)+'</button>';}).join('')+'<div id="exb"></div>';
  box.querySelectorAll('.ch').forEach(function(b){b.onclick=function(){
    if(box.getAttribute('data-a'))return;box.setAttribute('data-a','1');
    var k=+b.getAttribute('data-k');ST.p.push(k);lg('dl-r:'+D.day,ST);
    box.querySelectorAll('.ch').forEach(function(x){var n=+x.getAttribute('data-k');if(n===q.ans)x.classList.add('ok');else if(n===k)x.classList.add('ng');});
    $('exb').innerHTML='<div class="ex">'+(k===q.ans?'✅ 정답! ':'❌ 아쉬워요. ')+esc(q.ex)+'</div><p style="text-align:right;margin:12px 0 0"><button class="btn" id="nx">'+(ST.p.length<Q.length?'다음 문제 →':'결과 보기')+'</button></p>';
    $('nx').onclick=function(){box.removeAttribute('data-a');if(ST.p.length>=Q.length)finish();quiz();box.scrollIntoView({block:'start',behavior:'smooth'});};
  };});
}
function finish(){
  ST.done=true;lg('dl-r:'+D.day,ST);CNT.quiz=1;
  var s=streak();if(s.last!==D.day){s.n=(s.last===prevDay(D.day))?s.n+1:1;s.last=D.day;s.best=Math.max(s.best||0,s.n);lg('dl-st',s);}
}
function grid(){return D.quiz.q.map(function(q,i){return ST.p[i]===q.ans?'🟩':'🟥';}).join('');}
function result(){
  var Q=D.quiz.q,n=Q.filter(function(q,i){return ST.p[i]===q.ans;}).length,s=streak();
  var h='<div class="res"><div class="note">오늘의 문제 '+md(D.day)+'</div><div class="big">'+grid()+'</div><div class="st">'+n+'/'+Q.length+' 정답 · 🔥 <b>'+(s.last===D.day?s.n:0)+'</b>일 연속'+(s.best>1?' <span class="note">(최고 '+s.best+'일)</span>':'')+'</div>'
    +'<p><button class="btn" id="sh">결과 공유하기</button></p><p class="note">내일 아침 7시(한국 시간)에 새 문제가 나와요.</p></div>'
    +'<details><summary class="note">오늘 문제 다시 보기</summary>'+Q.map(function(q,i){return '<div class="ex" style="margin-top:8px">'+(ST.p[i]===q.ans?'🟩':'🟥')+' <b>'+esc(q.zh||q.ask)+'</b>'+(q.p?' <span class="note">'+esc(q.p)+'</span>':'')+'<br>'+esc(q.choices[q.ans])+' — '+esc(q.ex)+'</div>';}).join('')+'</details>';
  $('qz').innerHTML=h;
  $('sh').onclick=function(){CNT.share=(CNT.share||0)+1;var t='오늘의 중국 '+md(D.day)+'\n'+grid()+' '+n+'/'+Q.length+(s.n>1&&s.last===D.day?' · 🔥'+s.n+'일 연속':'')+'\n'+location.origin+'/daily';
    if(navigator.share){navigator.share({text:t}).catch(function(){});}
    else if(navigator.clipboard){navigator.clipboard.writeText(t).then(function(){toast('복사했어요. 카톡에 붙여 넣으세요');},function(){prompt('복사해서 보내세요',t);});}
    else prompt('복사해서 보내세요',t);};
}
document.addEventListener('visibilitychange',function(){if(document.visibilityState!=='hidden')return;try{navigator.sendBeacon('/u',JSON.stringify({app:'daily',c:CNT,sec:Math.round((Date.now()-T0)/1000)}));}catch(e){}CNT={};T0=Date.now();});
load();
</script></body></html>`;
