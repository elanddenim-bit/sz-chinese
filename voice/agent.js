// =========================================================
// 박비서 — 음성 비서 (Qwen-Omni 실시간 + 함수 호출)
//  GET /        비서 화면(단일 HTML)
//  GET /agent   WebSocket. 서버가 session.update(도구·지시문)를 직접 보내고,
//               모델의 도구 호출(response.function_call_arguments.done)을 여기서 실행해 결과를 돌려준다.
//               앱은 마이크 오디오만 보낸다. 앱 → {type:'agent.gps', loc:'lng,lat'} 로 현재 위치(WGS84) 전달.
// 도구: 날씨(Open-Meteo) · 환율(ECB) · 디디 주소록 검색 · 방문 동선(디디→高德) · 스페인 여행 · 현재 시각
// 바인딩: DIDI(서비스 바인딩 → didi-address), 시크릿 DIDI_ACCESS_KEY
// =========================================================

const SPAIN = {
  depart: "2026-12-23T21:30:00+08:00",
  lines: [
    "12/23(수) 21:30 바이윈공항 T2 도착 → 12/24 00:20 CZ377 출발",
    "12/24(목) 08:00 마드리드 T4S 도착, 마드리드 1박",
    "12/25(금) 07:54 iryo 마드리드 아토차 → 세비야, 세비야 1박",
    "12/26(토) 오전 알카사르·대성당, 18:50 VY1391 세비야 → 바르셀로나",
    "12/27(일) 09:30 가우디 반일 투어, 15:45 사그라다 파밀리아",
    "12/28(월) 구엘 공원·그라시아 / 12/29(화) 몬세라트",
    "12/30(수) iryo 바르셀로나 → 마드리드",
    "12/31(목) 10:50 CZ378 마드리드 T4S 출발 → 1/1 06:30 광저우 도착",
  ],
};

export const AGENT_TOOLS = [
  fn("get_weather", "查询某个城市今天起三天的天气（最高/最低气温、降雨概率）。city 用中文或英文城市名。", { city: { type: "string", description: "城市名，例如 广州、深圳、Madrid、Seoul" } }, ["city"]),
  fn("convert_currency", "按欧洲央行当日汇率换算货币。", {
    amount: { type: "number", description: "金额" },
    from: { type: "string", description: "原币种 ISO 代码，例如 USD、CNY、KRW、EUR" },
    to: { type: "string", description: "目标币种 ISO 代码" },
  }, ["amount", "from", "to"]),
  fn("find_place", "在用户的滴滴地址簿里查找地点（工厂、办公室、酒店、餐厅、市场），返回中文名、地址、分类。", { query: { type: "string", description: "地点名称的一部分（中文或韩文）" } }, ["query"]),
  fn("plan_route", "为多个要去的地点排出开车时间最短的拜访顺序，返回各段时间和总时间。地点名称来自滴滴地址簿。", {
    start: { type: "string", description: "出发地：地址簿里的地点名称，或者 '当前位置'" },
    stops: { type: "array", items: { type: "string" }, description: "要去的地点名称列表（1~9个）" },
  }, ["start", "stops"]),
  fn("trip_info", "用户一家的西班牙旅行（2026年12月23日~2027年1月1日）日程和距离出发还有几天。", {}, []),
  fn("now", "现在的日期、星期和时间（广州时间）。", {}, []),
];
function fn(name, description, properties, required) {
  return { type: "function", function: { name, description, parameters: { type: "object", properties, required } } };
}

export const AGENT_PROMPT = [
  "你是用户的私人语音秘书，名字叫「박비서」。用户是住在广州的韩国人，E·LAND 广州深圳分公司负责人（朴总）。",
  "用户主要说韩语。你必须用韩语回答，口语、简短，一般一到两句；数字、时间、金额要说清楚。",
  "需要天气、汇率、地点、路线、旅行日程、当前时间这些信息时，一定先调用工具，不要猜，不要编造。",
  "工具返回失败或找不到时，直接告诉用户没找到，并建议换个说法。",
  "不要说你是AI模型，不要长篇解释。",
].join("\n");

// ---------------- 도구 실행 ----------------
export async function runTool(env, sess, name, args) {
  try {
    if (name === "now") return nowText();
    if (name === "trip_info") return tripText();
    if (name === "get_weather") return await weather(String(args.city || ""));
    if (name === "convert_currency") return await fx(Number(args.amount), String(args.from || ""), String(args.to || ""));
    if (name === "find_place") return await findPlace(env, sess, String(args.query || ""));
    if (name === "plan_route") return await route(env, sess, args);
    return "未知工具 " + name;
  } catch (e) {
    return "工具出错：" + String(e.message || e).slice(0, 160);
  }
}
function nowText() {
  const d = new Date(Date.now() + 8 * 3600e3);
  const w = "日一二三四五六"[d.getUTCDay()];
  return "广州时间 " + d.toISOString().slice(0, 16).replace("T", " ") + "，星期" + w;
}
function tripText() {
  const days = Math.ceil((new Date(SPAIN.depart) - Date.now()) / 86400e3);
  return (days > 0 ? "出发还有 " + days + " 天。" : days > -9 ? "现在正在旅行中。" : "旅行已结束。") + "\n日程（韩语）：\n" + SPAIN.lines.join("\n");
}
async function getJ(u, init) {
  const r = await fetch(u, init);
  if (!r.ok) throw new Error(u.split("?")[0] + " " + r.status);
  return r.json();
}
async function weather(city) {
  if (!city) return "没有城市名";
  const g = await getJ("https://geocoding-api.open-meteo.com/v1/search?count=1&language=zh&name=" + encodeURIComponent(city));
  const p = (g.results || [])[0];
  if (!p) return "找不到城市：" + city;
  const f = await getJ("https://api.open-meteo.com/v1/forecast?latitude=" + p.latitude + "&longitude=" + p.longitude +
    "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&current=temperature_2m&forecast_days=3&timezone=auto");
  const d = f.daily || {};
  const names = ["今天", "明天", "后天"];
  const rows = (d.time || []).map((t, i) => names[i] + "(" + t.slice(5) + ") 最高" + Math.round(d.temperature_2m_max[i]) + "° 最低" + Math.round(d.temperature_2m_min[i]) + "° 降雨概率" + d.precipitation_probability_max[i] + "% " + wcode(d.weather_code[i]));
  return p.name + (p.country ? "（" + p.country + "）" : "") + " 现在 " + Math.round(f.current?.temperature_2m) + "°。" + rows.join("；");
}
function wcode(c) {
  if (c === 0) return "晴";
  if (c <= 3) return "多云";
  if (c === 45 || c === 48) return "雾";
  if (c >= 95) return "雷雨";
  if (c >= 80) return "阵雨";
  if (c >= 71 && c <= 77) return "雪";
  if (c >= 51) return "雨";
  return "";
}
async function fx(amount, from, to) {
  from = from.toUpperCase(); to = to.toUpperCase();
  if (!(amount > 0) || !/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) return "金额或币种不对";
  if (from === to) return amount + " " + from;
  const j = await getJ("https://api.frankfurter.dev/v1/latest?base=" + from + "&symbols=" + to);
  const r = j.rates && j.rates[to];
  if (!r) return "没有这个币种的汇率";
  const v = amount * r;
  return amount + " " + from + " = " + (v >= 100 ? Math.round(v).toLocaleString("en-US") : v.toFixed(2)) + " " + to + "（" + j.date + " 欧洲央行汇率，1 " + from + " = " + r + " " + to + "）";
}

// 디디 주소록 (서비스 바인딩)
async function places(env, sess) {
  if (sess.places) return sess.places;
  if (!env.DIDI || !env.DIDI_ACCESS_KEY) throw new Error("地址簿没有连接（DIDI 绑定或 DIDI_ACCESS_KEY）");
  const r = await env.DIDI.fetch("https://didi/api/places", { headers: { "x-access-key": env.DIDI_ACCESS_KEY } });
  if (!r.ok) throw new Error("地址簿 " + r.status);
  sess.places = (await r.json()).items || [];
  return sess.places;
}
const norm = (s) => String(s || "").toLowerCase().replace(/[\s·・\-_（）()]/g, "");
function match(list, q) {
  const n = norm(q);
  if (!n) return [];
  return list.map((p) => {
    const a = norm(p.nameCn), b = norm(p.nameKo), m = norm(p.memo), d = norm(p.addr);
    let s = 0;
    if (a === n || b === n) s = 100;
    else if (a.includes(n) || b.includes(n)) s = 80;
    else if (n.includes(a) && a.length >= 2) s = 70;
    else if (b && n.includes(b) && b.length >= 2) s = 70;
    else if (m.includes(n)) s = 50;
    else if (d.includes(n)) s = 30;
    else {
      const ch = [...new Set([...n])].filter((c) => (a + b).includes(c)).length;
      if (ch >= Math.max(2, Math.ceil(n.length * 0.6))) s = 20 + ch;
    }
    return { p, s };
  }).filter((x) => x.s > 0).sort((x, y) => y.s - x.s).map((x) => x.p);
}
const CAT = { office: "办公室", factory: "工厂", hotel: "酒店", food: "餐厅", market: "市场", transit: "机场/车站", etc: "其他" };
async function findPlace(env, sess, q) {
  const hits = match(await places(env, sess), q).slice(0, 5);
  if (!hits.length) return "地址簿里没有找到「" + q + "」";
  return hits.map((p) => (p.nameKo ? p.nameKo + " / " : "") + p.nameCn + "（" + (CAT[p.cat] || "") + "）：" + p.addr + (p.memo ? "，备注 " + p.memo : "")).join("\n");
}
async function route(env, sess, args) {
  const list = await places(env, sess);
  const stops = (Array.isArray(args.stops) ? args.stops : []).slice(0, 9);
  const ids = [], missing = [];
  for (const s of stops) {
    const h = match(list, s).filter((p) => p.loc)[0];
    if (h) { if (!ids.includes(h.id)) ids.push(h.id); } else missing.push(s);
  }
  if (!ids.length) return "地址簿里找不到这些地点（或者没有坐标）：" + missing.join("、");
  let start;
  const sq = String(args.start || "");
  if (/当前|现在|現在|여기|현재/.test(sq) || !sq) {
    if (!sess.gps) return "不知道当前位置。请用户允许定位，或者说出发地名称。";
    start = { gps: sess.gps };
  } else {
    const h = match(list, sq).filter((p) => p.loc)[0];
    if (!h) return "找不到出发地「" + sq + "」";
    start = { id: h.id };
  }
  const r = await env.DIDI.fetch("https://didi/api/route", {
    method: "POST",
    headers: { "x-access-key": env.DIDI_ACCESS_KEY, "content-type": "application/json" },
    body: JSON.stringify({ start, ids }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return "路线计算失败：" + (j.error || r.status);
  const min = (s) => Math.max(1, Math.round(s / 60));
  sess.lastRoute = j;
  return "出发：" + j.start.name + "\n" + j.legs.map((l, i) => (i + 1) + ". " + l.name + "（+" + min(l.sec) + "分钟，" + (l.m / 1000).toFixed(1) + "公里）").join("\n") +
    "\n合计约 " + min(j.totalSec) + " 分钟，" + (j.totalM / 1000).toFixed(1) + " 公里（不含实时路况）" + (missing.length ? "\n没找到：" + missing.join("、") : "");
}

// ---------------- 화면 ----------------
export const AGENT_HTML = String.raw`<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="박비서">
<meta name="theme-color" content="#1664B0">
<link rel="apple-touch-icon" sizes="180x180" href="/icon-180.png">
<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">
<link rel="manifest" href="/manifest.webmanifest">
<title>박비서</title>
<style>
:root{--sky:#1664B0;--bg:#EFE8DE;--ink:#1A2330;--grey:#857E74;--hair:#E2D9CB;--red:#D21624}
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{background:var(--bg);color:var(--ink);font-family:-apple-system,"Apple SD Gothic Neo","PingFang SC",system-ui,sans-serif;display:flex;flex-direction:column;
  padding:calc(14px + env(safe-area-inset-top)) 16px calc(16px + env(safe-area-inset-bottom))}
header{display:flex;align-items:center;gap:10px}
header b{font-size:20px;font-weight:900}header span{font-size:12px;color:var(--grey)}
#log{flex:1;overflow-y:auto;margin:14px 0;display:flex;flex-direction:column;gap:8px}
.m{max-width:86%;padding:10px 13px;border-radius:14px;font-size:15px;line-height:1.55;white-space:pre-wrap}
.me{align-self:flex-end;background:var(--sky);color:#fff;border-bottom-right-radius:4px}
.ai{align-self:flex-start;background:#fff;border:1px solid var(--hair);border-bottom-left-radius:4px}
.tool{align-self:flex-start;font-size:12px;color:var(--grey);background:#E6DCCB;border-radius:999px;padding:4px 10px}
.hint{color:var(--grey);font-size:13px;line-height:1.8;text-align:center;margin:auto 0}
#st{text-align:center;font-size:13px;color:var(--grey);min-height:20px;margin-bottom:10px}
#mic{width:96px;height:96px;border-radius:50%;border:0;background:var(--sky);color:#fff;font-size:38px;align-self:center;box-shadow:0 10px 30px rgba(22,100,176,.35)}
#mic.on{background:var(--red);animation:p 1.6s infinite}
@keyframes p{0%{box-shadow:0 0 0 0 rgba(210,22,36,.45)}70%{box-shadow:0 0 0 22px rgba(210,22,36,0)}100%{box-shadow:0 0 0 0 rgba(210,22,36,0)}}
.opt{display:flex;justify-content:center;gap:14px;font-size:12.5px;color:var(--grey);margin-top:12px}
#code{display:none;flex-direction:column;gap:8px;margin:auto 0}
#code input{font-size:16px;padding:12px;border-radius:10px;border:1px solid var(--hair)}
#code button{font-size:16px;padding:12px;border-radius:10px;border:0;background:var(--sky);color:#fff;font-weight:800}
</style></head><body>
<header><b>🎙 박비서</b><span>날씨 · 환율 · 디디 주소록 · 방문 동선 · 스페인 여행</span><a href="/shorts" aria-label="숏츠 공방" style="margin-left:auto;text-decoration:none;font-size:22px">🎬</a><a href="/quest" aria-label="주말 탐험" style="text-decoration:none;font-size:22px">🧭</a><a href="/usage" aria-label="앱 사용량" style="text-decoration:none;font-size:22px">📊</a></header>
<div id="code"><div style="font-size:14px">실전 중국어 초대 코드를 입력하세요(이 기기에 한 번만).</div><input id="ci" autocomplete="off"><button id="cs">확인</button></div>
<div id="log"><div class="hint">버튼을 누르고 말해 보세요.<br>"내일 광저우 비 와?"<br>"500달러 위안화로 얼마야?"<br>"사무실에서 출발해서 샘플니트랑 원단시장 동선 짜줘"<br>"스페인 출발 며칠 남았어?"</div></div>
<div id="st"></div>
<button id="mic">🎙</button>
<div class="opt"><label><input type="checkbox" id="barge"> 말 끊고 끼어들기(이어폰)</label></div>
<script>
(function(){
var CODE=localStorage.getItem('pb-code')||'', S=null;
var log=document.getElementById('log'), st=document.getElementById('st'), mic=document.getElementById('mic');
if(!CODE){document.getElementById('code').style.display='flex';log.style.display='none';mic.style.display='none';}
document.getElementById('cs').onclick=function(){var v=document.getElementById('ci').value.trim();if(!v)return;localStorage.setItem('pb-code',v);location.reload();};
function add(cls,t){var hint=log.querySelector('.hint');if(hint)hint.remove();var d=document.createElement('div');d.className='m '+cls;if(cls==='tool')d.className='tool';d.textContent=t;log.appendChild(d);log.scrollTop=log.scrollHeight;return d;}
function say(t){st.textContent=t||'';}
function b64(i16){var u=new Uint8Array(i16.buffer),s='';for(var i=0;i<u.length;i+=0x8000)s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000));return btoa(s);}
function down(f,sr){var r=sr/16000,n=Math.floor(f.length/r),o=new Int16Array(n);for(var i=0;i<n;i++){var a=Math.floor(i*r),b=Math.min(f.length,Math.floor((i+1)*r)),x=0;for(var j=a;j<b;j++)x+=f[j];var v=Math.max(-1,Math.min(1,x/Math.max(1,b-a)));o[i]=v<0?v*0x8000:v*0x7fff;}return o;}
// 24k PCM16 재생: 조각마다 따로 재생하면 기기(48k)로 바뀔 때 경계마다 지지직 → 한 줄 버퍼에 이어 붙여 마이크 처리 노드에서 직접 보간 출력
function mkPcm(sr){return {buf:new Float32Array(48000),r:0,w:0,on:false,g:0,left:null,done:false,rate:24000/sr};}
function pcmPush(P,d){var bin=atob(d),L=bin.length+(P.left!=null?1:0),a=new Uint8Array(L),o=0;
  if(P.left!=null){a[0]=P.left;o=1;P.left=null;}for(var k=0;k<bin.length;k++)a[o+k]=bin.charCodeAt(k);
  if(L%2){P.left=a[L-1];L--;}var n=L>>1;if(!n)return;
  var r0=Math.floor(P.r),keep=P.w-r0;
  if(P.w+n>P.buf.length){var nb=new Float32Array(Math.max(48000,2*(keep+n)));nb.set(P.buf.subarray(r0,P.w));P.buf=nb;P.r-=r0;P.w=keep;}
  for(var i=0;i<n;i++){var v=a[2*i]|(a[2*i+1]<<8);if(v>=0x8000)v-=0x10000;P.buf[P.w++]=v/0x8000;}}
function pcmPull(P,out){var N=out.length,i=0;
  if(!P||!P.on){if(P&&(P.w-P.r>=3600||(P.done&&P.w-P.r>1))){P.on=true;P.g=0;}else{out.fill(0);return;}}
  for(;i<N;i++){var x=Math.floor(P.r);if(x+1>=P.w){P.on=false;break;}var f=P.r-x,s=P.buf[x]+(P.buf[x+1]-P.buf[x])*f;
    if(P.g<1)P.g=Math.min(1,P.g+1/240);out[i]=s*P.g;P.r+=P.rate;}
  var last=i?out[i-1]:0;for(;i<N;i++){last*=0.97;out[i]=last;}
  if(!P.on&&P.w-P.r<=1){P.r=0;P.w=0;}}
function pcmStop(P){if(!P)return;P.r=0;P.w=0;P.on=false;P.left=null;}
function pcmBusy(P){return !!P&&(P.on||P.w-P.r>1);}
function pcmLeftMs(P){return P?Math.max(0,(P.w-P.r)/24000*1000):0;}
function play(d){pcmPush(S.pl,d);}
function stopPlay(){pcmStop(S.pl);}
function speaking(){return pcmBusy(S.pl);}
function send(o){if(S&&S.ws&&S.ws.readyState===1)S.ws.send(JSON.stringify(o));}
function ev(e){
  var t=e.type;
  if(t==='relay.ready'){say('연결 중…');return;}
  if(t==='session.updated'){S.ready=true;say('말씀하세요');return;}
  if(t==='input_audio_buffer.speech_started'){if(S.resp&&S.barge){stopPlay();send({type:'response.cancel'});}say('듣는 중…');return;}
  if(t==='input_audio_buffer.speech_stopped'){S.me=add('me','…');say('생각하는 중…');return;}
  if(t==='conversation.item.input_audio_transcription.completed'){if(S.me){S.me.textContent=e.transcript||'(인식 안 됨)';S.me=null;}else add('me',e.transcript||'');return;}
  if(t==='agent.tool'){add('tool','🔧 '+e.label);say('찾아보는 중…');return;}
  if(t==='response.created'){S.resp=true;S.cur=null;S.pl.left=null;S.pl.done=false;return;}
  if(t==='response.audio_transcript.delta'){if(!S.cur)S.cur=add('ai','');S.cur.textContent+=e.delta||'';log.scrollTop=log.scrollHeight;return;}
  if(t==='response.audio_transcript.done'){if(S.cur&&e.transcript)S.cur.textContent=e.transcript;return;}
  if(t==='response.audio.delta'){if(e.delta)play(e.delta);say('🔊');return;}
  if(t==='response.done'){S.resp=false;S.pl.done=true;setTimeout(function(){if(S&&!S.resp)say('말씀하세요');},pcmLeftMs(S.pl)+250);return;}
  if(t==='error'){add('tool','⚠ '+((e.error&&(e.error.message||e.error.code))||'오류'));return;}
  if(t==='relay.closed'){end();}
}
async function start(){
  var Ctx=window.AudioContext||window.webkitAudioContext,ctx=new Ctx();if(ctx.resume)ctx.resume();
  var stream;try{stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1}});}
  catch(e){say('마이크 권한이 필요합니다');ctx.close();return;}
  S={ctx:ctx,stream:stream,pl:mkPcm(ctx.sampleRate),ready:false,resp:false,barge:document.getElementById('barge').checked};
  var src=ctx.createMediaStreamSource(stream),pr=ctx.createScriptProcessor(4096,1,1);
  pr.onaudioprocess=function(e){pcmPull(S&&S.pl,e.outputBuffer.getChannelData(0));if(!S||!S.ready)return;if(!S.barge&&(S.resp||speaking()))return;
    send({type:'input_audio_buffer.append',audio:b64(down(e.inputBuffer.getChannelData(0),ctx.sampleRate))});};
  src.connect(pr);pr.connect(ctx.destination);S.pr=pr;S.src=src;
  var ws=new WebSocket(location.origin.replace(/^http/,'ws')+'/agent?code='+encodeURIComponent(CODE));S.ws=ws;
  ws.onmessage=function(m){var e;try{e=JSON.parse(m.data)}catch(_){return}ev(e);};
  ws.onerror=function(){say('서버 연결 실패');};
  ws.onclose=function(){if(S)end();};
  if(navigator.geolocation)navigator.geolocation.getCurrentPosition(function(p){var g=p.coords.longitude.toFixed(6)+','+p.coords.latitude.toFixed(6);var k=setInterval(function(){if(ws.readyState===1){ws.send(JSON.stringify({type:'agent.gps',loc:g}));clearInterval(k);}},300);},function(){}, {timeout:8000,maximumAge:120000});
  mic.classList.add('on');mic.textContent='■';say('연결 중…');
}
function end(){if(!S)return;var s=S;S=null;try{s.ws.close()}catch(e){}try{s.pr.disconnect();s.src.disconnect()}catch(e){}
  try{s.stream.getTracks().forEach(function(t){t.stop()})}catch(e){}try{s.ctx.close()}catch(e){}
  mic.classList.remove('on');mic.textContent='🎙';say('');}
mic.onclick=function(){S?end():start();};
document.getElementById('barge').onchange=function(){if(S)S.barge=this.checked;};
})();
</script></body></html>`;
