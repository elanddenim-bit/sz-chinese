// =========================================================
// 박비서 — 음성 비서 (Qwen-Omni 실시간 + 함수 호출)
//  GET /        비서 화면(단일 HTML)
//  GET /agent   WebSocket. 서버가 session.update(도구·지시문)를 직접 보내고,
//               모델의 도구 호출(response.function_call_arguments.done)을 여기서 실행해 결과를 돌려준다.
//               앱은 마이크 오디오만 보낸다. 앱 → {type:'agent.gps', loc:'lng,lat'} 로 현재 위치(WGS84) 전달.
// 도구: 날씨(Open-Meteo) · 환율(ECB) · 디디 주소록 검색 · 방문 동선(디디→高德) · 스페인 여행 · 현재 시각
// 바인딩: DIDI(서비스 바인딩 → didi-address), SPAIN(→ threepark-spain /api/trip), 시크릿 DIDI_ACCESS_KEY
// =========================================================

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
  fn("biz_trips", "用户自己的出差日程（出差简报里登记的：日期、飞机/高铁/车/当地、出发到达城市、时间、航班车次、出发机场车站、座位、酒店、会议备注）。问出差、明天去哪、几点的飞机、住哪里时调用。", { date: { type: "string", description: "要查的日期 YYYY-MM-DD；不给则返回今天起14天内的全部日程" } }, []),
  fn("trip_info", "用户一家的西班牙旅行（2026年12月23日~2027年1月1日）日程和距离出发还有几天。", {}, []),
  fn("now", "现在的日期、星期和时间（广州时间）。", {}, []),
];
function fn(name, description, properties, required) {
  return { type: "function", function: { name, description, parameters: { type: "object", properties, required } } };
}

export const AGENT_PROMPT = [
  "你是用户的私人语音秘书，名字叫「박비서」。用户是住在广州的韩国人，E·LAND 广州深圳分公司负责人（朴总）。",
  "用户主要说韩语。你必须用韩语回答，口语、简短，一般一到两句；数字、时间、金额要说清楚。",
  "需要天气、汇率、地点、路线、出差日程、西班牙旅行日程、当前时间这些信息时，一定先调用工具，不要猜，不要编造。",
  "用户说「出差」「明天去哪」「几点的飞机」等指的是 biz_trips（用户在박비서出差简报里登记的日程），不是西班牙家庭旅行（trip_info）。说到「明天」「后天」先用 now 确认日期。",
  "用户常去中国城市出差（宁波、济南、深圳等）。语音识别可能把中国城市听成外国城市（例如 닝보→리스본），城市名和对话不符时先看 biz_trips 或向用户确认，再查天气。",
  "工具返回失败或找不到时，直接告诉用户没找到，并建议换个说法。",
  "不要说你是AI模型，不要长篇解释。",
].join("\n");

// ---------------- 글자 한 번 묻기(시리 단축어용) ----------------
// POST /agent/ask {code, text, gps?} → {reply} — 실시간 통화 대신 千问 chat completions + 같은 도구(함수 호출 최대 4바퀴). 시리 '박비서' 단축어가 받아쓰기 → 여기 → 읽어 줌.
export async function agentAsk(env, b, h) {
  const text = String(b.text || "").trim().slice(0, 500);
  if (!text) return { ok: false, error: "empty", reply: "무엇을 도와드릴까요?" };
  const host = (env.DASHSCOPE_WS_HOST || "dashscope.aliyuncs.com").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const sess = { h, gps: /^-?\d+\.\d+,-?\d+\.\d+$/.test(String(b.gps || "")) ? String(b.gps) : "", tools: {} };
  const messages = [{ role: "system", content: AGENT_PROMPT + "\n这是文字问答（Siri 快捷指令），回答会被朗读：只用纯文本，不用 markdown、列表、表情符号，两句以内。" }, { role: "user", content: text }];
  const model = env.AGENT_TEXT_MODEL || env.QUEST_MODEL || "qwen3.8-flash";
  let reply = "";
  for (let round = 0; round < 4; round++) {
    const r = await fetch("https://" + host + "/compatible-mode/v1/chat/completions", { method: "POST", headers: { authorization: "Bearer " + env.DASHSCOPE_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ model, messages, tools: AGENT_TOOLS, temperature: 0.4, enable_thinking: false }), signal: AbortSignal.timeout(40000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: "qwen", reply: "지금은 답을 못 가져왔어요. 잠시 뒤 다시 말씀해 주세요." };
    const m = (j.choices && j.choices[0] && j.choices[0].message) || {};
    if (Array.isArray(m.tool_calls) && m.tool_calls.length) {
      messages.push({ role: "assistant", content: m.content || "", tool_calls: m.tool_calls });
      for (const tc of m.tool_calls) {
        let args = {}; try { args = JSON.parse(tc.function.arguments || "{}"); } catch {}
        const out = await runTool(env, sess, tc.function.name, args);
        sess.tools[tc.function.name] = (sess.tools[tc.function.name] || 0) + 1;
        messages.push({ role: "tool", tool_call_id: tc.id, content: String(out).slice(0, 4000) });
      }
      continue;
    }
    reply = String(m.content || "").trim();
    break;
  }
  if (!reply) reply = "답을 정리하지 못했어요. 다시 한 번 말씀해 주세요.";
  reply = reply.replace(/[*_#`>]+/g, "").replace(/\s+/g, " ").slice(0, 600);
  return { ok: true, reply, tools: sess.tools };
}

// ---------------- 도구 실행 ----------------
export async function runTool(env, sess, name, args) {
  try {
    if (name === "now") return nowText();
    if (name === "biz_trips") return await bizTrips(env, sess, String(args.date || ""));
    if (name === "trip_info") return await tripText(env);
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
// 출장 일정: 출장 브리핑(brief.js)에 넣은 일정을 그대로 읽음(KV brief:<코드 해시>) — 2026-10-28 소유자 '박비서가 출장 스케줄을 모름'
const HOWK = { plane: "비행기", train: "고속철", car: "차", stay: "현지" };
async function bizTrips(env, sess, date) {
  if (!sess.h) return "无法识别用户（缺少邀请码），读不到出差日程。";
  const doc = await env.KV.get("brief:" + sess.h, "json").catch(() => null);
  const all = (doc && Array.isArray(doc.trips)) ? doc.trips : [];
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const end = new Date(Date.parse(today) + 14 * 86400e3).toISOString().slice(0, 10);
  const list = /^\d{4}-\d{2}-\d{2}$/.test(date) ? all.filter((x) => x.d === date) : all.filter((x) => x.d >= today && x.d <= end);
  if (!list.length) return (date ? date + " 没有登记的出差日程。" : "今天起14天内没有登记的出差日程。") + "（今天 " + today + "）";
  return "今天 " + today + "。出差日程（按此回答，不要编造）：\n" + list.map((x) => [
    x.d, HOWK[x.how] || x.how, x.how === "stay" ? (x.to || x.from) : (x.from || "") + "→" + (x.to || ""),
    x.t ? "출발 " + x.t : "", x.arr ? "도착 " + x.arr : "", x.no, x.dep ? "출발지 " + x.dep : "", x.seat ? "좌석 " + x.seat : "",
    x.go ? "집 출발 " + x.go : "", x.stay ? "숙소 " + x.stay : "", x.meet ? "메모 " + x.meet.slice(0, 120) : "",
  ].filter(Boolean).join(" · ")).join("\n");
}
// 스페인 일정: 사본을 들고 있지 않고 threepark-spain 의 /api/trip 을 서비스 바인딩(SPAIN)으로 읽음(2026-10-19)
// 못 읽으면 KV trip:spain(마지막 성공 응답), 그것도 없으면 못 불러왔다고 답함
async function tripLoad(env) {
  try {
    if (!env.SPAIN) throw new Error("no binding");
    const r = await env.SPAIN.fetch("https://threepark-spain/api/trip");
    if (!r.ok) throw new Error("trip " + r.status);
    const j = await r.json();
    if (!j || !j.depart || !Array.isArray(j.days) || !j.days.length) throw new Error("trip empty");
    try { await env.KV.put("trip:spain", JSON.stringify({ at: Date.now(), d: j })); } catch (_) {}
    return { d: j, old: 0 };
  } catch (e) {
    console.log("trip_info", e && e.message);
    const c = await env.KV.get("trip:spain", "json").catch(() => null);
    return c && c.d ? { d: c.d, old: c.at || 1 } : null;
  }
}
async function tripText(env) {
  const t = await tripLoad(env);
  if (!t) return "西班牙旅行日程暂时无法读取。请用韩语告诉用户：일정을 못 불러왔어요. 잠시 뒤 다시 물어봐 주세요。不要猜测日程。";
  const { d } = t, days = Math.ceil((new Date(d.depart) - Date.now()) / 86400e3);
  const lines = d.days.map((x) => {
    const sl = (x.slots || []).map((s) => [s.t, s.what, s.note ? "(" + s.note + ")" : ""].filter(Boolean).join(" ")).join(" · ");
    return x.date + (x.dow ? "(" + x.dow + ")" : "") + " " + (x.city || "") + ": " + (sl || "자유 일정") + (x.stay ? " / 숙소 " + x.stay : "");
  });
  return (days > 0 ? "出发还有 " + days + " 天（出发 " + d.depart + "）。" : days > -10 ? "现在正在旅行中。" : "旅行已结束。")
    + (t.old ? "（实时日程读取失败，以下是 " + new Date(t.old + 8 * 3600e3).toISOString().slice(0, 16).replace("T", " ") + " 保存的副本）" : "")
    + "\n日程（韩语，按时间回答，不要编造）：\n" + lines.join("\n");
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
header b{font-size:20px;font-weight:900}header span{font-size:12px;color:var(--grey)}@media (max-width:480px){header span{display:none}header{gap:8px}}
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
<header><b>🎙 박비서</b><span>날씨 · 환율 · 디디 주소록 · 방문 동선 · 스페인 여행</span><a href="/hub" aria-label="도구함" style="margin-left:auto;text-decoration:none;font-size:15px;font-weight:700;color:inherit;border:1px solid currentColor;border-radius:999px;padding:4px 12px;white-space:nowrap">🧰 도구함</a></header>
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
// 2026-10-28 소유자 '여전히 지지직': 재생을 마이크 처리 노드(메인 스레드)에서 빼서 AudioWorklet(오디오 스레드)로 — 화면 갱신·base64 처리로 메인이 밀리면 출력이 끊겨 지지직.
// 선버퍼 250ms, 중간에 바닥나면 다음부터 100ms씩 늘림(최대 600ms). AudioWorklet 없는 브라우저는 예전 방식(pcmPull).
var WK=['class P extends AudioWorkletProcessor{constructor(o){super();this.rate=o.processorOptions.rate;this.N=24000*90;this.b=new Float32Array(this.N);this.r=0;this.w=0;this.on=false;this.g=0;this.done=false;this.pre=6000;this.last=0;this.gen=0;this.k=0;',
'this.port.onmessage=e=>{const m=e.data;if(m.t==="p"){const d=m.d,N=this.N;if(this.w+d.length-this.r>N-2)return;for(let i=0;i<d.length;i++)this.b[(this.w+i)%N]=d[i];this.w+=d.length;}else if(m.t==="s"){this.r=0;this.w=0;this.on=false;this.gen=m.g;}else if(m.t==="d"){this.done=m.v;}};}',
'process(_,outs){const o=outs[0][0],L=o.length,N=this.N;let i=0;',
'if(!this.on){const a=this.w-this.r;if(a>=this.pre||(this.done&&a>1)){this.on=true;this.g=0;}}',
'if(this.on){for(;i<L;i++){const x=Math.floor(this.r);if(x+1>=this.w){this.on=false;if(!this.done)this.pre=Math.min(14400,this.pre+2400);break;}const f=this.r-x,a=this.b[x%N],c=this.b[(x+1)%N];if(this.g<1)this.g=Math.min(1,this.g+1/240);o[i]=(a+(c-a)*f)*this.g;this.r+=this.rate;}if(i)this.last=o[i-1];}',
'for(;i<L;i++){this.last*=0.97;o[i]=this.last;}',
'if(!this.on&&this.w-this.r<=1&&this.w>0){this.r=0;this.w=0;}',
'if(++this.k%8===0)this.port.postMessage({g:this.gen,left:Math.max(0,this.w-this.r),on:this.on});return true;}}',
'registerProcessor("pb-out",P);'].join('\n');
async function mkOut(ctx){try{if(!ctx.audioWorklet||!window.AudioWorkletNode)return null;var u=URL.createObjectURL(new Blob([WK],{type:'application/javascript'}));await ctx.audioWorklet.addModule(u);
  var n=new AudioWorkletNode(ctx,'pb-out',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1],processorOptions:{rate:24000/ctx.sampleRate}});
  var O={n:n,gen:0,left:0,on:false,pend:0,left1:null};n.port.onmessage=function(e){var m=e.data;if(m.g!==O.gen)return;O.left=m.left;O.on=m.on;O.pend=0;};n.connect(ctx.destination);return O;}catch(e){return null;}}
function wPush(O,d){var bin=atob(d),L=bin.length+(O.left1!=null?1:0),a=new Uint8Array(L),o=0;if(O.left1!=null){a[0]=O.left1;o=1;O.left1=null;}for(var k=0;k<bin.length;k++)a[o+k]=bin.charCodeAt(k);
  if(L%2){O.left1=a[L-1];L--;}var n=L>>1;if(!n)return;var f=new Float32Array(n);for(var i=0;i<n;i++){var v=a[2*i]|(a[2*i+1]<<8);if(v>=0x8000)v-=0x10000;f[i]=v/0x8000;}
  O.pend+=n;O.n.port.postMessage({t:'p',d:f},[f.buffer]);}
function play(d){if(S.out)wPush(S.out,d);else pcmPush(S.pl,d);}
function stopPlay(){if(S.out){var O=S.out;O.gen++;O.left=0;O.on=false;O.pend=0;O.left1=null;O.n.port.postMessage({t:'s',g:O.gen});}else pcmStop(S.pl);}
function speaking(){if(S&&S.out)return S.out.on||S.out.left>1||S.out.pend>0;return pcmBusy(S&&S.pl);}
function leftMs(){if(S&&S.out)return (S.out.left+S.out.pend)/24;return pcmLeftMs(S&&S.pl);}
function setDone(v){if(S.out){S.out.n.port.postMessage({t:'d',v:v});if(!v)S.out.left1=null;}else{S.pl.done=v;if(!v)S.pl.left=null;}}
function send(o){if(S&&S.ws&&S.ws.readyState===1)S.ws.send(JSON.stringify(o));}
function ev(e){
  var t=e.type;
  if(t==='relay.ready'){say('연결 중…');return;}
  if(t==='session.updated'){S.ready=true;say('말씀하세요');return;}
  if(t==='input_audio_buffer.speech_started'){if(S.resp&&S.barge){stopPlay();send({type:'response.cancel'});}say('듣는 중…');return;}
  if(t==='input_audio_buffer.speech_stopped'){S.me=add('me','…');say('생각하는 중…');return;}
  if(t==='conversation.item.input_audio_transcription.completed'){if(S.me){S.me.textContent=e.transcript||'(인식 안 됨)';S.me=null;}else add('me',e.transcript||'');return;}
  if(t==='agent.tool'){add('tool','🔧 '+e.label);say('찾아보는 중…');return;}
  if(t==='response.created'){S.resp=true;S.cur=null;setDone(false);return;}
  if(t==='response.audio_transcript.delta'){if(!S.cur)S.cur=add('ai','');S.cur.textContent+=e.delta||'';log.scrollTop=log.scrollHeight;return;}
  if(t==='response.audio_transcript.done'){if(S.cur&&e.transcript)S.cur.textContent=e.transcript;return;}
  if(t==='response.audio.delta'){if(e.delta)play(e.delta);say('🔊');return;}
  if(t==='response.done'){S.resp=false;setDone(true);setTimeout(function(){if(S&&!S.resp)say('말씀하세요');},leftMs()+400);return;}
  if(t==='error'){add('tool','⚠ '+((e.error&&(e.error.message||e.error.code))||'오류'));return;}
  if(t==='relay.closed'){end();}
}
async function start(){
  var Ctx=window.AudioContext||window.webkitAudioContext,ctx=new Ctx();if(ctx.resume)ctx.resume();
  var stream;try{stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1}});}
  catch(e){say('마이크 권한이 필요합니다');ctx.close();return;}
  S={ctx:ctx,stream:stream,pl:mkPcm(ctx.sampleRate),ready:false,resp:false,barge:document.getElementById('barge').checked};
  var src=ctx.createMediaStreamSource(stream),pr=ctx.createScriptProcessor(4096,1,1);
  pr.onaudioprocess=function(e){var ob=e.outputBuffer.getChannelData(0);if(S&&S.out)ob.fill(0);else pcmPull(S&&S.pl,ob);if(!S||!S.ready)return;if(!S.barge&&(S.resp||speaking()))return;
    send({type:'input_audio_buffer.append',audio:b64(down(e.inputBuffer.getChannelData(0),ctx.sampleRate))});};
  src.connect(pr);pr.connect(ctx.destination);S.pr=pr;S.src=src;
  S.out=await mkOut(ctx);if(!S)return;
  var ws=new WebSocket(location.origin.replace(/^http/,'ws')+'/agent?code='+encodeURIComponent(CODE));S.ws=ws;
  ws.onmessage=function(m){var e;try{e=JSON.parse(m.data)}catch(_){return}ev(e);};
  ws.onerror=function(){say('서버 연결 실패');};
  ws.onclose=function(){if(S)end();};
  if(navigator.geolocation)navigator.geolocation.getCurrentPosition(function(p){var g=p.coords.longitude.toFixed(6)+','+p.coords.latitude.toFixed(6);var k=setInterval(function(){if(ws.readyState===1){ws.send(JSON.stringify({type:'agent.gps',loc:g}));clearInterval(k);}},300);},function(){}, {timeout:8000,maximumAge:120000});
  mic.classList.add('on');mic.textContent='■';say('연결 중…');
}
function end(){if(!S)return;var s=S;S=null;try{s.ws.close()}catch(e){}try{s.pr.disconnect();s.src.disconnect()}catch(e){}try{s.out&&s.out.n.disconnect()}catch(e){}
  try{s.stream.getTracks().forEach(function(t){t.stop()})}catch(e){}try{s.ctx.close()}catch(e){}
  mic.classList.remove('on');mic.textContent='🎙';say('');}
mic.onclick=function(){S?end():start();};
document.getElementById('barge').onchange=function(){if(S)S.barge=this.checked;};
})();
</script></body></html>`;
