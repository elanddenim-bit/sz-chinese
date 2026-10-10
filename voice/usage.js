// =========================================================
// 앱 사용량판 — 내 앱들이 보내는 사용 기록을 모아 주인만 보는 화면으로
//  POST /u            비콘 {app, c:{기능:횟수}, sec, w?} (본문은 text/plain JSON — 브라우저 sendBeacon, 응답 무시)
//  GET  /usage        사용량판 화면 (박비서와 같은 초대 코드, 처음 연 코드가 주인)
//  POST /usage/data   {code, days} → 집계
// 저장: KV 키 u:<날짜>:<앱>:<임의> , 값 없음, 메타데이터 {c, s, w} (list 한 번으로 읽기 — get 없음), 120일 보관
// [필수] 외부 AI 호출 없음
// =========================================================

export const APPS = {
  szcn: { name: "실전 중국어", icon: "🀄", f: { tab_ph: "홈", tab_p0: "회화", tab_p1: "퀴즈", tab_p2: "HSK 단어", tab_p3: "복습", tab_p6: "발음", tab_p5: "현장", tab_p4: "진척", rp: "롤플레이", call: "통화 모드", video: "영상 섀도잉", paste: "대화 붙여넣기", pron: "발음 평가", mv: "내 목소리 듣기", field: "현장 AI" } },
  rt: { name: "실시간 통화", icon: "⚡", f: { session: "통화" } },
  pb: { name: "박비서", icon: "🎙", f: { session: "대화", get_weather: "날씨", convert_currency: "환율", find_place: "주소록 검색", plan_route: "동선", trip_info: "스페인 일정", now: "시각" } },
  didi: { name: "디디 주소록", icon: "🚕", f: { copy_name: "이름 복사·디디 열기", copy_addr: "주소 복사", driver: "기사님 화면", route: "방문 동선", map: "지도 열기", save: "저장·편집", search: "검색" } },
  threepark: { name: "삼박네", icon: "🏡", f: { pg_home: "홈", pg_plan: "일정표", pg_photos: "사진 기록", pg_movie: "다큐", paint: "그림엽서", movie_make: "다큐 만들기", upload: "사진 올리기" } },
  spain: { name: "스페인 일정", icon: "🇪🇸", f: { pg_home: "일정 보기" } },
  shorts: { name: "숏츠 공방", icon: "🎬", f: { ideas: "주제 추천", script: "대본", plan: "편집실 AI 계획", asr: "영상 속 말 자막", upload: "유튜브 업로드" } },
  quest: { name: "주말 탐험", icon: "🧭", f: { new: "퀘스트 받기", done: "사진 인증 성공", fail: "인증 실패", honor: "그래도 인정" } },
  mystery: { name: "광저우 미스터리", icon: "🕵️", f: { new: "사건 받기", clue: "현장 사진 단서", fail: "사진 불통과", skip: "못 가요", solve: "사건 해결", wrong: "오답" } },
};
const OWNER_SCOPED = new Set(["szcn", "rt", "pb", "quest", "shorts", "mystery"]); // 초대 코드별 앱 — 주인 것만 따로 보여 줌

const cnDay = (t = Date.now()) => new Date(t + 8 * 3600e3).toISOString().slice(0, 10);
const ipHits = new Map();

// 서버·클라이언트 공통 기록
export async function logUse(env, app, counts, sec, who) {
  if (!APPS[app] || !env.KV) return;
  const c = {};
  let n = 0;
  for (const [k, v] of Object.entries(counts || {})) {
    if (!/^[a-z0-9_]{1,24}$/.test(k)) continue;
    const x = Math.max(0, Math.min(10000, Math.round(Number(v) || 0)));
    if (!x) continue;
    c[k] = x;
    if (++n >= 30) break;
  }
  const s = Math.max(0, Math.min(86400, Math.round(Number(sec) || 0)));
  if (!n && !s) return;
  const meta = { c, s };
  if (who && /^[0-9a-f]{12}$/.test(who)) meta.w = who;
  const key = "u:" + cnDay() + ":" + app + ":" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  await env.KV.put(key, "", { metadata: meta, expirationTtl: 120 * 86400 });
}

export async function beacon(req, env, ctx) {
  const ip = req.headers.get("cf-connecting-ip") || "";
  const m = Math.floor(Date.now() / 60000);
  const k = ip + ":" + m, hits = (ipHits.get(k) || 0) + 1;
  ipHits.set(k, hits);
  if (ipHits.size > 2000) ipHits.clear();
  const ok = new Response(null, { status: 204, headers: { "access-control-allow-origin": "*" } });
  if (hits > 30) return ok;
  const t = await req.text().catch(() => "");
  if (!t || t.length > 3000) return ok;
  let b; try { b = JSON.parse(t); } catch { return ok; }
  ctx.waitUntil(logUse(env, String(b.app || ""), b.c, b.sec, b.w).catch(() => {}));
  return ok;
}

async function hash(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].slice(0, 6).map((x) => x.toString(16).padStart(2, "0")).join("");
}

// 실전 중국어 학습 기록(Supabase, 앱과 같은 공개키)
const SB_URL = "https://qmxcfsozzrcdakkiozts.supabase.co";
const SB_KEY = "sb_publishable_fTwyVCtEqz7HhSBJ74X9HQ_OjaVZam8";
async function study(code) {
  try {
    const r = await fetch(SB_URL + "/rest/v1/trainer?id=eq." + encodeURIComponent(code) + "&select=data", { headers: { apikey: SB_KEY, authorization: "Bearer " + SB_KEY } });
    if (!r.ok) return null;
    const j = await r.json();
    const days = (j && j[0] && j[0].data && j[0].data.stats && j[0].data.stats.days) || {};
    const out = {};
    for (const [d, v] of Object.entries(days)) out[d] = { n: v.n || 0, c: v.c || 0, min: Math.round(v.min || 0) };
    return out;
  } catch { return null; }
}

export async function usageData(env, b) {
  const code = String(b.code || "").trim();
  const h = await hash(code);
  let owner = await env.KV.get("usage:owner");
  if (!owner) { await env.KV.put("usage:owner", h); owner = h; }
  if (owner !== h) return { error: "not_owner" };
  const days = Math.max(7, Math.min(90, Number(b.days) || 30));
  const since = cnDay(Date.now() - (days - 1) * 86400e3);
  const rows = [];
  let cursor;
  for (let i = 0; i < 20; i++) {
    const r = await env.KV.list({ prefix: "u:", cursor, limit: 1000 });
    for (const k of r.keys) {
      const [, d, app] = k.name.split(":");
      if (d < since || !k.metadata) continue;
      const mine = !OWNER_SCOPED.has(app) || k.metadata.w === h;
      rows.push({ d, a: app, c: k.metadata.c || {}, s: k.metadata.s || 0, m: mine ? 1 : 0, w: k.metadata.w || "" });
    }
    if (r.list_complete) break;
    cursor = r.cursor;
  }
  // 다른 베타 사용자 수(실전 중국어) — 누구인지는 안 보냄
  const others = new Set(rows.filter((r) => !r.m && r.w).map((r) => r.w)).size;
  const slim = rows.map(({ w, ...r }) => r);
  const first = (await env.KV.get("usage:first")) || null;
  if (!first && rows.length) await env.KV.put("usage:first", rows.map((r) => r.d).sort()[0]);
  return { ok: true, today: cnDay(), since, days, apps: APPS, rows: slim, others, study: await study(code), first: first || (rows.length ? rows.map((r) => r.d).sort()[0] : null) };
}

export const USAGE_HTML = String.raw`<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#1664B0">
<meta name="apple-mobile-web-app-capable" content="yes">
<link rel="apple-touch-icon" href="/icon-180.png">
<title>앱 사용량</title>
<style>
:root{--sky:#1664B0;--bg:#EFE8DE;--card:#F7F2EA;--ink:#1A2330;--ink2:#5E6672;--line:#D9CEBD;--red:#D21624;--soft:#E6DCCB}
@media (prefers-color-scheme:dark){:root{--bg:#141A22;--card:#1C2430;--ink:#EDE6DA;--ink2:#9AA3AE;--line:#2C3644;--soft:#253041}}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,"Apple SD Gothic Neo","PingFang SC",system-ui,sans-serif;-webkit-text-size-adjust:100%}
header{background:var(--sky);color:#fff;padding:calc(env(safe-area-inset-top) + 14px) 16px 14px;border-bottom:3px solid var(--red)}
header h1{margin:0;font-size:19px;font-weight:700}header p{margin:2px 0 0;font-size:12.5px;opacity:.85}
main{max-width:640px;margin:0 auto;padding:14px 16px 40px}
.seg{display:flex;gap:6px;margin:0 0 12px}.seg button{flex:1;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:9px;padding:7px 0;font:inherit;font-size:13.5px}
.seg button.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px}
.kpi b{display:block;font-size:22px;font-variant-numeric:tabular-nums;line-height:1.2}.kpi span{font-size:12px;color:var(--ink2)}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 14px;margin-bottom:12px}
.card h2{margin:0 0 8px;font-size:15px;display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.card h2 small{font-weight:400;font-size:12px;color:var(--ink2)}
.app{display:grid;grid-template-columns:1fr auto;gap:2px 10px;padding:9px 0;border-top:1px solid var(--line)}.app:first-of-type{border-top:0}
.app .nm{font-weight:600}.app .num{text-align:right;font-variant-numeric:tabular-nums}.app .sub{font-size:12px;color:var(--ink2)}
.up{color:var(--sky)}.dn{color:var(--red)}
svg.spark{grid-column:1/-1;width:100%;height:30px;display:block;margin-top:4px}
svg.spark rect{fill:var(--sky)}svg.spark rect.z{fill:var(--line)}
.bar{display:grid;grid-template-columns:8.5em 1fr 2.6em;gap:8px;align-items:center;font-size:13.5px;padding:3px 0}
.bar i{display:block;height:8px;border-radius:4px;background:var(--sky)}.bar em{font-style:normal;text-align:right;color:var(--ink2);font-variant-numeric:tabular-nums}
.bar .lb{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{background:var(--soft);border-radius:999px;padding:4px 10px;font-size:13px}
.chip.r{background:transparent;border:1px dashed var(--red);color:var(--red)}
.note{font-size:12.5px;color:var(--ink2);margin:6px 0 0}
.gate{padding:40px 0;text-align:center}.gate input{font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:10px;width:220px;background:var(--card);color:var(--ink)}
.gate button,.btn{font:inherit;padding:10px 16px;border:0;border-radius:10px;background:var(--sky);color:#fff;margin-left:6px}
a{color:var(--sky)}
</style></head><body>
<header><h1>📊 내 앱 사용량</h1><p id="sub">만든 것을 실제로 쓰고 있는지</p></header>
<main id="main"><div class="gate">불러오는 중…</div></main>
<script>
var CODE='';try{CODE=localStorage.getItem('pb-code')||'';}catch(e){}
var DAYS=30,D=null;
function esc(s){return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function gate(msg){document.getElementById('main').innerHTML='<div class="gate"><p>'+esc(msg||'초대 코드를 넣어 주세요')+'</p><input id="cd" type="password" placeholder="초대 코드"><button id="go">열기</button></div>';
  document.getElementById('go').onclick=function(){CODE=document.getElementById('cd').value.trim();try{localStorage.setItem('pb-code',CODE);}catch(e){}load();};}
function load(){if(!CODE)return gate();
  fetch('/usage/data',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:CODE,days:DAYS})})
  .then(function(r){return r.json();}).then(function(j){
    if(j.error==='not_allowed')return gate('초대 코드가 맞지 않아요');
    if(j.error==='not_owner'){document.getElementById('main').innerHTML='<div class="gate">주인만 볼 수 있는 화면이에요.</div>';return;}
    if(!j.ok)return gate('불러오지 못했어요: '+(j.error||''));
    D=j;render();}).catch(function(){gate('서버에 연결하지 못했어요');});}
function dayList(n,today){var out=[],t=new Date(today+'T00:00:00Z').getTime();for(var i=n-1;i>=0;i--)out.push(new Date(t-i*864e5).toISOString().slice(0,10));return out;}
function sum(o){var s=0;for(var k in o)s+=o[k];return s;}
function fmtMin(sec){if(sec<60)return sec?'1분 미만':'0분';var m=Math.round(sec/60);return m<60?m+'분':(Math.floor(m/60)+'시간 '+(m%60)+'분');}
function spark(vals){var mx=Math.max.apply(null,vals.concat([1])),w=100/vals.length,h='';
  for(var i=0;i<vals.length;i++){var v=vals[i],bh=v?Math.max(3,v/mx*28):2;h+='<rect class="'+(v?'':'z')+'" x="'+(i*w+w*0.15).toFixed(2)+'" y="'+(30-bh).toFixed(1)+'" width="'+(w*0.7).toFixed(2)+'" height="'+bh.toFixed(1)+'" rx="1"/>';}
  return '<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none">'+h+'</svg>';}
function render(){
  var j=D,days=dayList(j.days,j.today),last7=days.slice(-7),prev7=days.slice(-14,-7),mine=j.rows.filter(function(r){return r.m;});
  var per={},feat={},lastUse={};
  Object.keys(j.apps).forEach(function(a){per[a]={byDay:{},sec:0,cnt7:0,cntP:0,sec7:0};feat[a]={};});
  mine.forEach(function(r){var p=per[r.a];if(!p)return;var n=r.c.open||r.c.session||sum(r.c)||0;
    p.byDay[r.d]=(p.byDay[r.d]||0)+n;
    if(last7.indexOf(r.d)>=0){p.cnt7+=n;p.sec7+=r.s;for(var k in r.c){feat[r.a][k]=(feat[r.a][k]||0)+r.c[k];}}
    if(prev7.indexOf(r.d)>=0)p.cntP+=n;
    for(var k2 in r.c){var key=r.a+'.'+k2;if(!lastUse[key]||lastUse[key]<r.d)lastUse[key]=r.d;}});
  var st=j.study||{},stMin7=0,stN7=0;last7.forEach(function(d){if(st[d]){stMin7+=st[d].min;stN7+=st[d].n;}});
  var act7=0,tot7=0;Object.keys(per).forEach(function(a){tot7+=per[a].sec7;});
  last7.forEach(function(d){if(mine.some(function(r){return r.d===d;}))act7++;});
  var h='<div class="seg">'+[7,30,90].map(function(n){return '<button data-n="'+n+'" class="'+(n===DAYS?'on':'')+'">'+n+'일</button>';}).join('')+'</div>';
  h+='<div class="kpis"><div class="kpi"><b>'+act7+'<small style="font-size:13px">/7</small></b><span>앱 쓴 날(최근 7일)</span></div>'
   +'<div class="kpi"><b>'+fmtMin(tot7)+'</b><span>앱 켜 둔 시간</span></div>'
   +'<div class="kpi"><b>'+stMin7+'분</b><span>중국어 학습('+stN7+'문제)</span></div></div>';
  // 앱별
  h+='<div class="card"><h2>앱별 사용 <small>최근 7일 · 막대는 '+j.days+'일</small></h2>';
  Object.keys(j.apps).map(function(a){return [a,per[a]];}).sort(function(x,y){return y[1].cnt7-x[1].cnt7;}).forEach(function(e){
    var a=e[0],p=e[1],A=j.apps[a],d=p.cnt7-p.cntP,dt=p.cntP||p.cnt7?(d>0?'<span class="up">▲'+d+'</span>':d<0?'<span class="dn">▼'+(-d)+'</span>':'–'):'';
    var unit=(a==='rt'||a==='pb')?'번 통화':a==='quest'?'번 활동':'번 열기';
    h+='<div class="app"><div class="nm">'+A.icon+' '+esc(A.name)+'</div><div class="num">'+p.cnt7+unit.replace('번',' 번')+' '+dt+'</div>'
     +'<div class="sub">'+(p.sec7?fmtMin(p.sec7)+' 사용':'')+'</div><div class="sub num">'+(p.cntP?'지난주 '+p.cntP:'')+'</div>'
     +spark(days.map(function(d){return p.byDay[d]||0;}))+'</div>';});
  h+='</div>';
  // 많이 쓴 기능
  var all=[];Object.keys(feat).forEach(function(a){for(var k in feat[a]){if(k==='open'||(k==='session'&&a!=='rt'&&a!=='pb'))continue;var lb=(j.apps[a].f[k]||k);all.push([j.apps[a].icon+' '+lb,feat[a][k]]);}});
  all.sort(function(x,y){return y[1]-x[1];});
  var mx=all.length?all[0][1]:1;
  h+='<div class="card"><h2>많이 쓴 기능 <small>최근 7일</small></h2>'+(all.length?all.slice(0,10).map(function(x){return '<div class="bar"><span class="lb">'+esc(x[0])+'</span><i style="width:'+Math.max(4,x[1]/mx*100)+'%"></i><em>'+x[1]+'</em></div>';}).join(''):'<p class="note">아직 기록이 없어요. 앱을 쓰면 여기에 쌓여요.</p>')+'</div>';
  // 안 쓰는 기능
  var cut=days.slice(-14)[0],idle=[];
  Object.keys(j.apps).forEach(function(a){var f=j.apps[a].f;for(var k in f){var lu=lastUse[a+'.'+k];if(!lu||lu<cut)idle.push(j.apps[a].icon+' '+f[k]);}});
  var young=!j.first||j.first>cut;
  h+='<div class="card"><h2>2주째 안 쓴 기능 <small>'+idle.length+'개</small></h2><div class="chips">'+idle.slice(0,40).map(function(x){return '<span class="chip r">'+esc(x)+'</span>';}).join('')+'</div>'
   +(young?'<p class="note">기록은 '+(j.first||'오늘')+'부터예요. 2주가 지나야 진짜 "안 쓰는 기능"이 보여요.</p>':'<p class="note">계속 안 쓰면 고치거나 빼는 후보예요.</p>')+'</div>';
  // 학습
  var sv=days.map(function(d){return st[d]?st[d].min:0;});
  h+='<div class="card"><h2>🀄 중국어 학습 <small>'+j.days+'일 · 분</small></h2>'+spark(sv)+'<p class="note">'+j.days+'일 합계 '+sv.reduce(function(a,b){return a+b;},0)+'분 · 공부한 날 '+sv.filter(function(x){return x>0;}).length+'일'+(j.others?' · 다른 베타 사용자 '+j.others+'명 활동':'')+'</p></div>';
  h+='<p class="note">기록 시작 '+(j.first||'오늘')+' · 실전 중국어·실시간 통화·박비서는 내 초대 코드 것만, 디디 주소록은 지사원 사용 포함</p>';
  document.getElementById('main').innerHTML=h;
  document.getElementById('sub').textContent='오늘 '+j.today+' · 최근 '+j.days+'일';
  document.querySelectorAll('.seg button').forEach(function(b){b.onclick=function(){DAYS=+b.getAttribute('data-n');load();};});
}
load();
</script></body></html>`;
