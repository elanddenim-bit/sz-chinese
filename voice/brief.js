// =========================================================
// 🧳 출장 전날 브리핑 — 다음 날 이동 일정이 있으면 전날 저녁(중국 18~21시 중 고른 시각) 아이폰 Bark 알림으로
//  GET  /brief               화면(박비서와 같은 초대 코드, localStorage pb-code, 주인 전용)
//  POST /brief/state {code}                    → {trips, bark(설정 여부), hour, log}
//  POST /brief/save  {code, trips?, bark?, hour?}
//  POST /brief/send  {code, d, dry?}           → 그 날짜 브리핑을 만들어 보냄(dry 면 만들기만)
//  POST /brief/ping  {code}                    → Bark 테스트 알림
//  POST /brief/parse {code, image?|text?}       → 예약 캡처·문자를 千问 VL 이 읽어 일정 후보로
// 당일 '지금 출발' 알림: 15분마다 크론 → 출발 5시간 전부터 집(GPS)·숙소 → 공항·역 차 시간(디디 주소록 /api/eta, 高德 지금 교통)으로 출발 시각 계산, 그 20분 전에 Bark
//  GET  /brief/v?h&d&s                         → 알림을 누르면 열리는 전체 브리핑(HMAC 서명)
// 숫자(기온·비 확률·광저우와 차이·권장 출발 시각)는 코드가 계산, 千问은 옷차림·챙길 것·미팅 체크·현지 한마디만 씀
// 저장: KV brief:<해시> {trips[], bark, hour, sent{날짜:시각}, log[]}, brief:out:<해시>:<날짜>(14일)
// [필수] AI 는 百炼(千问)만 — Anthropic 호출 없음
// =========================================================
import { logUse } from "./usage.js";

const cnNow = () => new Date(Date.now() + 8 * 3600e3);
const cnDay = (t = Date.now()) => new Date(t + 8 * 3600e3).toISOString().slice(0, 10);
const host = (env) => (env.DASHSCOPE_WS_HOST || "dashscope.aliyuncs.com").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
const berr = (message, status = 400) => Object.assign(new Error(message), { code: "brief", status });
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const HOW = { plane: "✈️", train: "🚄", car: "🚗", stay: "📍" };
const WD = ["일", "월", "화", "수", "목", "금", "토"];

async function hmac16(env, s) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode("bf|" + (env.ALLOWED_CODES || "") + (env.DASHSCOPE_API_KEY || "")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(s));
  return [...new Uint8Array(sig)].slice(0, 8).map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function owner(env, h) {
  let o = await env.KV.get("usage:owner");
  if (!o) { await env.KV.put("usage:owner", h); o = h; }
  if (o !== h) throw berr("출장 브리핑은 주인만 쓸 수 있어요.", 403);
}

// 처음 열 때 이번 주 출장(소유자가 말한 일정)을 채워 둠 — 시간·편명은 화면에서 입력
function seed() {
  return {
    hour: 21, bark: "", sent: {}, log: [],
    trips: [
      { id: "t1", d: "2026-10-13", from: "广州", to: "济南", how: "plane", t: "", no: "", stay: "", meet: "" },
      { id: "t2", d: "2026-10-14", from: "济南", to: "宁波", how: "plane", t: "", no: "", stay: "", meet: "" },
      { id: "t3", d: "2026-10-15", from: "宁波", to: "宁波", how: "stay", t: "", no: "", stay: "", meet: "돌아오는 편 확인" },
    ],
  };
}
const docKey = (h) => "brief:" + h;
async function load(env, h) { return (await env.KV.get(docKey(h), "json")) || seed(); }
async function store(env, h, d) { await env.KV.put(docKey(h), JSON.stringify(d)); }

function cleanTrips(a) {
  return (Array.isArray(a) ? a : []).slice(0, 40).map((x, i) => ({
    id: String(x.id || "t" + Date.now().toString(36) + i).slice(0, 20),
    d: /^\d{4}-\d{2}-\d{2}$/.test(x.d) ? x.d : "",
    from: String(x.from || "").trim().slice(0, 20), to: String(x.to || "").trim().slice(0, 20),
    how: HOW[x.how] ? x.how : "plane",
    t: /^\d{1,2}:\d{2}$/.test(x.t || "") ? x.t : "",
    no: String(x.no || "").trim().slice(0, 20), stay: String(x.stay || "").trim().slice(0, 60),
    arr: /^\d{1,2}:\d{2}$/.test(x.arr || "") ? x.arr : "",
    dep: String(x.dep || "").trim().slice(0, 40), seat: String(x.seat || "").trim().slice(0, 30),
    meet: String(x.meet || "").trim().slice(0, 400),
  })).filter((x) => x.d && (x.to || x.from)).sort((a, b) => (a.d + a.t).localeCompare(b.d + b.t));
}

// Bark: https://api.day.app/<key>[/...] 형태의 주소(자체 서버도 됨) → {origin, key}
function barkOf(s) {
  try {
    const m = String(s || "").match(/https:\/\/[^\s'"]+/); // curl 명령 통째로 붙여 넣어도 주소만 뽑음
    if (!m) return null;
    const u = new URL(m[0]);
    const key = u.pathname.split("/").filter(Boolean)[0];
    if (u.protocol !== "https:" || !key) return null;
    return { origin: u.origin, key };
  } catch { return null; }
}
async function barkPush(bark, title, body, url) {
  const b = barkOf(bark);
  if (!b) throw berr("Bark 주소를 먼저 넣어 주세요.");
  const r = await fetch(b.origin + "/push", {
    method: "POST", headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ device_key: b.key, title, body, url, group: "출장 브리핑", icon: "https://voice.zhnote.net/icon-192.png", level: "timeSensitive" }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || (j.code && j.code !== 200)) throw berr("Bark 전송 실패: " + (j.message || r.status), 502);
}

// ---------- 날씨(Open-Meteo, 키 불필요) ----------
const WC = (c) => c === 0 ? "맑음" : c <= 3 ? "구름" : c <= 48 ? "안개" : c <= 57 ? "이슬비" : c <= 67 ? "비" : c <= 77 ? "눈" : c <= 82 ? "소나기" : c <= 86 ? "눈" : "뇌우";
async function wx(city, d) {
  try {
    const g = await (await fetch("https://geocoding-api.open-meteo.com/v1/search?count=1&language=zh&name=" + encodeURIComponent(city))).json();
    const p = (g.results || [])[0];
    if (!p) return null;
    const f = await (await fetch("https://api.open-meteo.com/v1/forecast?latitude=" + p.latitude + "&longitude=" + p.longitude +
      "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,wind_speed_10m_max&timezone=Asia%2FShanghai&start_date=" + d + "&end_date=" + d)).json();
    const x = f.daily;
    if (!x || !x.time || !x.time.length) return null;
    return { city, hi: Math.round(x.temperature_2m_max[0]), lo: Math.round(x.temperature_2m_min[0]), rain: x.precipitation_probability_max[0] ?? null, w: WC(x.weather_code[0]), wind: Math.round(x.wind_speed_10m_max[0] || 0) };
  } catch { return null; }
}

// 권장 출발: 비행기 이륙 2시간 반(광저우 바이윈 집 기준)/2시간 전, 고속철 1시간 반/1시간 전 — 대략
function leaveAt(tr) {
  if (!tr.t || tr.how === "stay") return "";
  const [H, M] = tr.t.split(":").map(Number);
  const gz = /广州|광저우/.test(tr.from);
  const back = tr.how === "plane" ? (gz ? 150 : 120) : tr.how === "train" ? (gz ? 90 : 60) : 0;
  if (!back) return "";
  let m = H * 60 + M - back;
  if (m < 0) m += 1440;
  return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
}

async function qwen(env, sys, user, model) {
  const call = async (fmt) => {
    const r = await fetch("https://" + host(env) + "/compatible-mode/v1/chat/completions", {
      method: "POST", headers: { authorization: "Bearer " + env.DASHSCOPE_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ model: model || env.BRIEF_MODEL || env.QUEST_MODEL || "qwen3.8-flash", temperature: 0.4, enable_thinking: false, ...(fmt ? { response_format: { type: "json_object" } } : {}),
        messages: [{ role: "system", content: sys }, { role: "user", content: user }] }),
    });
    if (r.status === 400 && fmt) return call(false);
    const j = await r.json();
    if (!r.ok) throw berr("千问 오류: " + ((j.error && j.error.message) || r.status), 502);
    const s = String(j.choices[0].message.content);
    return JSON.parse(s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1));
  };
  return call(true);
}

async function build(env, doc, d) {
  const trips = doc.trips.filter((x) => x.d === d);
  if (!trips.length) return null;
  const cities = [...new Set(trips.flatMap((x) => [x.how === "stay" ? "" : x.from, x.to]).filter(Boolean))];
  const ws = (await Promise.all(cities.map((c) => wx(c, d)))).filter(Boolean);
  const gz = /广州/.test(cities.join()) ? ws.find((w) => /广州/.test(w.city)) : await wx("广州", d);
  const dest = ws.find((w) => w.city === trips[trips.length - 1].to) || ws[ws.length - 1] || null;
  const diff = dest && gz && dest !== gz ? dest.hi - gz.hi : null;
  const legs = trips.map((x) => ({ ...x, leave: leaveAt(x) }));
  const facts = {
    date: d, weekday: WD[new Date(d + "T00:00:00Z").getUTCDay()],
    legs: legs.map((x) => ({ how: x.how, from: x.from, to: x.to, time: x.t, no: x.no, leave: x.leave, stay: x.stay, meet: x.meet })),
    weather: ws, guangzhou: gz, destHiMinusGuangzhou: diff,
  };
  const sys = "너는 광저우에 사는 한국인 회사원(의류 OEM 지사장)의 출장 비서다. 내일 일정과 날씨 숫자를 받아 전날 밤 볼 짧은 브리핑을 한국어로 쓴다. " +
    "숫자(기온·비 확률·시각)는 주어진 값만 쓰고 새로 지어내지 마라. 일정에 없는 사실(항공편 지연, 행사 등) 지어내기 금지. 존댓말 말고 짧은 메모체(~하기, ~챙김). " +
    "외국인이라 비행기·고속철 모두 여권 필요. " +
    'JSON 만: {"title":"알림 제목 22자 이내(예: 제남 출장 · 광저우보다 9° 추움)","wear":"옷차림 한 줄 30자 이내","pack":["챙길 것 3~5개, 각 12자 이내"],' +
    '"meet":["미팅 메모가 있으면 내일 확인할 체크 2~4개, 각 30자 이내, 없으면 빈 배열"],"tip":"도착 도시에서 쓸 만한 생활 팁 한 줄 40자 이내(음식·교통·날씨 중)","zh":{"z":"그 도시에서 바로 쓸 중국어 한 마디","p":"성조 병음","k":"뜻"}}';
  let ai = {};
  try { ai = await qwen(env, sys, JSON.stringify(facts)); } catch (e) { ai = { title: "", err: String(e.message || e).slice(0, 120) }; }
  const pack = (Array.isArray(ai.pack) ? ai.pack : []).map(String).slice(0, 5);
  const meet = (Array.isArray(ai.meet) ? ai.meet : []).map(String).slice(0, 4);
  const route = legs.map((x) => x.how === "stay" ? "📍 " + x.to + " 현지" : HOW[x.how] + " " + [x.t, x.no].filter(Boolean).join(" ") + " " + x.from + "→" + x.to + (x.arr ? "(" + x.arr + " 도착)" : "") +
    (x.dep ? " · " + x.dep : "") + (x.seat ? " · " + x.seat : "") + (x.leave ? " · " + x.leave + " 출발 예상(아침에 교통 보고 다시 알림)" : ""));
  const wline = dest ? "🌡 " + dest.city + " " + dest.lo + "~" + dest.hi + "° " + dest.w + (dest.rain != null ? " · 강수 " + dest.rain + "%" : "") +
    (diff != null && Math.abs(diff) >= 2 ? " (광저우보다 " + Math.abs(diff) + "° " + (diff < 0 ? "낮음" : "높음") + ")" : "") : "🌡 날씨 정보 없음";
  const title = "내일(" + facts.weekday + ") " + (String(ai.title || "").slice(0, 26) || legs.map((x) => x.to).join("·") + " 일정");
  const body = [...route, wline, ai.wear ? "👔 " + String(ai.wear).slice(0, 40) : "", pack.length ? "🎒 " + pack.join(", ") : ""].filter(Boolean).join("\n");
  return { d, at: Date.now(), title, body, route, wline, ws, wear: ai.wear || "", pack, meet, tip: ai.tip || "", zh: ai.zh && ai.zh.z ? ai.zh : null, legs, err: ai.err || "" };
}

async function sendFor(env, h, doc, d, dry, auto) {
  const out = await build(env, doc, d);
  if (!out) throw berr(d + " 에 등록된 일정이 없어요.");
  await env.KV.put("brief:out:" + h + ":" + d, JSON.stringify(out), { expirationTtl: 14 * 86400 });
  const link = "https://voice.zhnote.net/brief/v?h=" + h + "&d=" + d + "&s=" + (await hmac16(env, h + "|" + d));
  if (!dry) {
    await barkPush(doc.bark, out.title, out.body, link);
    doc.sent = doc.sent || {};
    doc.sent[d] = Date.now();
    if (auto) { doc.auto = doc.auto || {}; doc.auto[d] = Date.now(); }
    doc.log = [{ d, at: Date.now(), ok: true, how: auto ? "자동" : "직접" }, ...(doc.log || [])].slice(0, 20);
    await store(env, h, doc);
  }
  return { ok: true, sent: !dry, link, brief: out };
}

export async function briefApi(env, ctx, path, b, h) {
  await owner(env, h);
  const doc = await load(env, h);
  const view = () => ({ ok: true, trips: doc.trips, bark: !!barkOf(doc.bark), hour: doc.hour || 21, log: (doc.log || []).slice(0, 8), sent: doc.sent || {},
    home: !!(doc.home && doc.home.gps), morning: doc.morning !== false, msent: doc.msent || {} });
  if (path === "/brief/state") return view();
  if (path === "/brief/save") {
    if (b.trips) doc.trips = cleanTrips(b.trips);
    if (typeof b.bark === "string") {
      if (b.bark && !barkOf(b.bark)) throw berr("Bark 주소 형식이 아니에요. 앱에서 복사한 https://api.day.app/… 주소를 그대로 붙여 넣어 주세요.");
      const k = barkOf(b.bark);
      doc.bark = k ? k.origin + "/" + k.key : "";
    }
    if (b.hour) doc.hour = Math.min(21, Math.max(18, Number(b.hour) || 21));
    if (b.home && /^-?\d+\.\d+,-?\d+\.\d+$/.test(String(b.home.gps || ""))) doc.home = { gps: String(b.home.gps), at: Date.now() };
    if (typeof b.morning === "boolean") doc.morning = b.morning;
    await store(env, h, doc);
    return view();
  }
  if (path === "/brief/ping") {
    await barkPush(doc.bark, "출장 브리핑 연결됨 ✅", "출장 전날 " + (doc.hour || 21) + "시에 이렇게 알려 드려요.", "https://voice.zhnote.net/brief");
    return { ok: true };
  }
  if (path === "/brief/parse") return { ok: true, trips: await parseBooking(env, b) };
  if (path === "/brief/send") {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(b.d || "") ? b.d : cnDay(Date.now() + 86400e3);
    const r = await sendFor(env, h, doc, d, !!b.dry);
    ctx.waitUntil(logUse(env, "brief", { [b.dry ? "preview" : "send"]: 1 }, 0, h).catch(() => {}));
    return r;
  }
  throw berr("not_found", 404);
}

// 예약 캡처(여행앱·항공사·12306 화면)나 문자를 읽어 일정 후보로 — 화면이 기존 일정과 합침
async function parseBooking(env, b) {
  const img = /^data:image\/(jpeg|png|webp);base64,/.test(String(b.image || "")) && String(b.image).length < 6e6 ? String(b.image) : "";
  const text = String(b.text || "").slice(0, 3000);
  if (!img && !text.trim()) throw berr("캡처나 예약 문자를 넣어 주세요.");
  const sys = "你是行程单识别助手。从机票/火车票/酒店的预订截图或短信中提取每一段行程。今天是 " + cnDay() + "（年份缺省时取今天之后最近的日期）。" +
    "只提取图里/文字里确实有的信息，没有的留空，不要猜。城市用简体城市名（如 广州、济南、宁波），不要带机场名。" +
    'dep 是出发机场+航站楼或出发火车站（如 广州白云国际机场T2、广州南站），seat 是座位/舱位/车厢座号。how: plane|train。只输出 JSON：' +
    '{"trips":[{"d":"YYYY-MM-DD","how":"plane","t":"HH:MM 出发时间","arr":"HH:MM 到达时间","no":"航班号/车次","from":"","to":"","dep":"","seat":""}],"stay":{"city":"","name":"酒店名"}}';
  const content = img ? [{ type: "image_url", image_url: { url: img } }, { type: "text", text: text || "识别这张预订截图" }] : text;
  const o = await qwen(env, sys, content, img ? (env.BRIEF_VL_MODEL || env.QUEST_VL_MODEL || "qwen3-vl-plus") : null);
  const trips = cleanTrips((o.trips || []).map((x) => ({ ...x, how: x.how === "train" ? "train" : "plane" })));
  if (o.stay && o.stay.name) trips.push({ stayOnly: true, city: String(o.stay.city || "").slice(0, 20), name: String(o.stay.name).slice(0, 60) });
  if (!trips.length) throw berr("일정을 찾지 못했어요. 편명·날짜가 보이게 다시 찍어 주세요.");
  return trips;
}

// 당일 '지금 출발' — 15분마다(중국 5~23시) 오늘 일정 중 비행기·고속철만
const STATION_MIN = { plane: 90, train: 30 };
async function eta(env, doc, tr) {
  if (!env.DIDI || !env.DIDI_ACCESS_KEY) return null;
  const gz = /广州|광저우/.test(tr.from);
  const from = gz && doc.home && doc.home.gps ? { gps: doc.home.gps, name: "집" } : tr.stay0 ? { kw: tr.stay0, city: tr.from } : null;
  if (!from) return null;
  const to = { kw: tr.dep || tr.from + (tr.how === "plane" ? "机场" : "站"), city: tr.from };
  try {
    const r = await env.DIDI.fetch("https://didi/api/eta", { method: "POST", headers: { "x-access-key": env.DIDI_ACCESS_KEY, "content-type": "application/json" }, body: JSON.stringify({ from, to }) });
    const j = await r.json();
    return j && j.ok && j.sec ? j : null;
  } catch { return null; }
}
const hm = (m) => { m = ((m % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); };
export async function briefMorning(env) {
  const h = await env.KV.get("usage:owner");
  if (!h) return;
  const doc = await env.KV.get(docKey(h), "json");
  if (!doc || doc.morning === false || !barkOf(doc.bark)) return;
  const now = cnNow(), day = now.toISOString().slice(0, 10), nm = now.getUTCHours() * 60 + now.getUTCMinutes();
  doc.msent = doc.msent || {};
  let dirty = false;
  for (const tr of doc.trips) {
    if (tr.d !== day || !tr.t || !STATION_MIN[tr.how] || doc.msent[tr.id + day]) continue;
    const [H, M] = tr.t.split(":").map(Number), tm = H * 60 + M;
    if (nm < tm - 300 || nm > tm - 20) continue;
    // 숙소: 이 일정 출발 도시에 머문 전날 일정의 숙소
    const prev = doc.trips.filter((x) => x.d < day && x.to === tr.from && x.stay).pop();
    const e = await eta(env, doc, { ...tr, stay0: tr.stay0 || (prev && prev.stay) || "" });
    const drive = e ? Math.ceil(e.sec / 60) : (/广州/.test(tr.from) ? 60 : 40);
    const leave = tm - STATION_MIN[tr.how] - drive - 10;
    if (nm < leave - 20) continue;
    const late = nm > leave;
    const title = (late ? "⚠️ 서둘러야 해요 — " : "🚕 ") + hm(leave) + " 출발 " + (tr.how === "plane" ? "(이륙 " : "(발차 ") + tr.t + ")";
    const body = [HOW[tr.how] + " " + [tr.no, tr.from + "→" + tr.to].filter(Boolean).join(" ") + (tr.seat ? " · " + tr.seat : ""),
      "📍 " + (e ? e.to.name : (tr.dep || tr.from)) + "까지 차로 " + drive + "분" + (e ? "(지금 교통)" : "(교통 정보 없음, 대략)"),
      (tr.how === "plane" ? "공항 도착 목표 " : "역 도착 목표 ") + hm(tm - STATION_MIN[tr.how]) + " · 여권 챙기기"].join("\n");
    const link = e ? "https://uri.amap.com/navigation?to=" + e.to.loc + "," + encodeURIComponent(e.to.name) + "&mode=car&callnative=1" : "https://voice.zhnote.net/brief";
    try {
      await barkPush(doc.bark, title, body, link);
      doc.msent[tr.id + day] = Date.now();
      doc.log = [{ d: day, at: Date.now(), ok: true, m: 1 }, ...(doc.log || [])].slice(0, 20);
      await logUse(env, "brief", { morning: 1 }, 0, h).catch(() => {});
    } catch (er) {
      doc.msent[tr.id + day] = Date.now();
      doc.log = [{ d: day, at: Date.now(), ok: false, err: "아침 알림: " + String(er.message || er).slice(0, 100) }, ...(doc.log || [])].slice(0, 20);
    }
    dirty = true;
  }
  if (dirty) {
    for (const k of Object.keys(doc.msent)) if (Date.now() - doc.msent[k] > 7 * 86400e3) delete doc.msent[k];
    await store(env, h, doc);
  }
}

// 크론(중국 18~21시 매시): 주인 문서에서 내일 일정이 있고 아직 안 보냈으면 정한 시각에 보냄
export async function briefCron(env) {
  const h = await env.KV.get("usage:owner");
  if (!h) return;
  const doc = await env.KV.get(docKey(h), "json");
  if (!doc || !barkOf(doc.bark)) return;
  if (cnNow().getUTCHours() !== (doc.hour || 21)) return;
  const d = cnDay(Date.now() + 86400e3);
  // 직접 보내기(시험)와 상관없이 정한 시각엔 최신 일정으로 한 번 보냄
  if ((doc.auto || {})[d] || !doc.trips.some((x) => x.d === d)) return;
  try { await sendFor(env, h, doc, d, false, true); await logUse(env, "brief", { auto: 1 }, 0, h).catch(() => {}); }
  catch (e) {
    doc.log = [{ d, at: Date.now(), ok: false, err: String(e.message || e).slice(0, 120) }, ...(doc.log || [])].slice(0, 20);
    await store(env, h, doc);
  }
}

// 알림을 누르면 열리는 전체 브리핑
export async function briefGet(req, env, url) {
  if (url.pathname !== "/brief/v") return new Response("not found", { status: 404 });
  const h = url.searchParams.get("h") || "", d = url.searchParams.get("d") || "";
  if (!/^[0-9a-f]{12}$/.test(h) || !/^\d{4}-\d{2}-\d{2}$/.test(d) || url.searchParams.get("s") !== (await hmac16(env, h + "|" + d))) return new Response("링크가 올바르지 않아요.", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
  const o = await env.KV.get("brief:out:" + h + ":" + d, "json");
  if (!o) return new Response("브리핑이 만료됐어요(14일).", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  const li = (a) => a.map((x) => "<li>" + esc(x) + "</li>").join("");
  const legs = o.legs.map((x) => '<div class="leg"><b>' + (HOW[x.how] || "") + " " + esc(x.how === "stay" ? x.to + " 현지" : x.from + " → " + x.to) + "</b>" +
    (x.t || x.no ? "<span>" + esc([x.t, x.no].filter(Boolean).join(" · ")) + "</span>" : "") +
    (x.leave ? '<span class="lv">' + esc(x.leave) + " 출발 권장(대략)</span>" : "") +
    (x.stay ? "<span>🏨 " + esc(x.stay) + "</span>" : "") + (x.meet ? '<p class="m">' + esc(x.meet) + "</p>" : "") + "</div>").join("");
  const wx = (o.ws || []).map((w) => "<tr><td>" + esc(w.city) + "</td><td>" + w.lo + "~" + w.hi + "°</td><td>" + esc(w.w) + "</td><td>" + (w.rain == null ? "-" : w.rain + "%") + "</td><td>" + w.wind + "km/h</td></tr>").join("");
  const html = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#1664B0"><title>' + esc(o.title) + '</title><style>' + VCSS + '</style></head><body>' +
    '<header><a href="/brief">‹</a><div><small>' + esc(d) + ' 출장 브리핑</small><h1>' + esc(o.title) + "</h1></div></header><main>" +
    '<section><h2>이동</h2>' + legs + "</section>" +
    "<section><h2>날씨</h2><p class=\"big\">" + esc(o.wline) + "</p><table><tr><th>도시</th><th>기온</th><th>하늘</th><th>강수</th><th>바람</th></tr>" + wx + "</table>" + (o.wear ? "<p>👔 " + esc(o.wear) + "</p>" : "") + "</section>" +
    (o.pack.length ? "<section><h2>챙길 것</h2><ul>" + li(o.pack) + "</ul></section>" : "") +
    (o.meet.length ? "<section><h2>미팅 체크</h2><ul>" + li(o.meet) + "</ul></section>" : "") +
    (o.tip ? "<section><h2>현지 팁</h2><p>" + esc(o.tip) + "</p></section>" : "") +
    (o.zh ? '<section><h2>한 마디</h2><p class="zh">' + esc(o.zh.z) + "</p><p class=\"py\">" + esc(o.zh.p) + "</p><p>" + esc(o.zh.k) + "</p></section>" : "") +
    (o.err ? '<p class="err">AI 정리 실패: ' + esc(o.err) + "</p>" : "") +
    "</main></body></html>";
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

const VCSS = ":root{--sky:#1664B0;--bg:#EFE8DE;--card:#F7F2EA;--ink:#1A2330;--ink2:#5E6672;--line:#D9CEBD;--red:#D21624}" +
  "@media (prefers-color-scheme:dark){:root{--bg:#141A22;--card:#1C2430;--ink:#EDE6DA;--ink2:#9AA3AE;--line:#2C3644}}" +
  "*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 -apple-system,'Apple SD Gothic Neo',system-ui,sans-serif}" +
  "header{background:var(--sky);color:#fff;padding:calc(env(safe-area-inset-top) + 14px) 16px 14px;border-bottom:3px solid var(--red);display:flex;gap:12px;align-items:center}" +
  "header a{color:#fff;text-decoration:none;font-size:22px}header h1{margin:0;font-size:19px}header small{opacity:.8}" +
  "main{max-width:640px;margin:0 auto;padding:12px 16px 48px}section{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 14px;margin:10px 0}" +
  "h2{font-size:13px;color:var(--ink2);margin:0 0 6px}.leg{padding:6px 0;border-bottom:1px dashed var(--line)}.leg:last-child{border:0}.leg b{display:block}.leg span{display:inline-block;margin-right:10px;color:var(--ink2);font-size:14px}" +
  ".leg .lv{color:var(--red);font-weight:600}.m{margin:4px 0 0;font-size:14px;white-space:pre-wrap}.big{font-weight:600}table{width:100%;border-collapse:collapse;font-size:14px}td,th{padding:4px;text-align:left;border-bottom:1px solid var(--line)}" +
  "ul{margin:0;padding-left:20px}.zh{font-size:22px;margin:0;font-family:'PingFang SC',system-ui}.py{color:var(--ink2);margin:0}.err{color:var(--red);font-size:13px}";

export const BRIEF_HTML = String.raw`<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#1664B0">
<meta name="apple-mobile-web-app-capable" content="yes">
<link rel="apple-touch-icon" href="/icon-180.png">
<title>출장 브리핑</title>
<style>
:root{--sky:#1664B0;--bg:#EFE8DE;--card:#F7F2EA;--ink:#1A2330;--ink2:#5E6672;--line:#D9CEBD;--red:#D21624}
@media (prefers-color-scheme:dark){:root{--bg:#141A22;--card:#1C2430;--ink:#EDE6DA;--ink2:#9AA3AE;--line:#2C3644}}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,"Apple SD Gothic Neo",system-ui,sans-serif}
header{background:var(--sky);color:#fff;padding:calc(env(safe-area-inset-top) + 14px) 16px 14px;border-bottom:3px solid var(--red);display:flex;align-items:center;gap:12px}
header h1{margin:0;font-size:19px}a.back{color:#fff;text-decoration:none;font-size:22px}
main{max-width:640px;margin:0 auto;padding:12px 16px 60px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 14px;margin:10px 0}
h2{font-size:13px;color:var(--ink2);margin:0 0 8px;font-weight:600}
input,select,textarea{font:inherit;color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:9px;padding:8px;width:100%}
textarea{min-height:56px;resize:vertical}
.row{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}.row3{grid-template-columns:1.2fr 1fr 1fr}
.row>*{min-width:0}input[type=date],input[type=time]{-webkit-appearance:none;appearance:none;min-width:0;display:block;min-height:40px;text-align:left}
.lbl{display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:8px;font-size:11.5px;color:var(--ink2);margin:0 0 2px 2px}
.warn{color:var(--red);font-size:13px;margin:-4px 0 8px}
button{font:inherit;border:0;border-radius:10px;padding:10px 14px;background:var(--sky);color:#fff;font-weight:600}
button.ghost{background:transparent;color:var(--sky);border:1px solid var(--sky)}button.del{background:transparent;color:var(--red);padding:6px 8px}
.btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
.trip{border-top:1px solid var(--line);padding-top:10px;margin-top:10px}.trip:first-of-type{border:0;margin:0;padding:0}
.th{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-weight:600}
.past{opacity:.5}.ok{color:#2E7D5B;font-size:13px}.muted{color:var(--ink2);font-size:13px}
#toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--ink);color:var(--bg);padding:10px 16px;border-radius:12px;display:none;max-width:90%;z-index:9}
pre{white-space:pre-wrap;font:14px/1.5 -apple-system,system-ui;margin:6px 0 0}
ol{margin:4px 0 0;padding-left:20px}
</style></head><body>
<header><a class="back" href="/hub" aria-label="도구함">‹</a><h1>🧳 출장 브리핑</h1></header>
<main id="m"><p class="muted">불러오는 중…</p></main>
<div id="toast"></div>
<script>
var CODE='';try{CODE=localStorage.getItem('pb-code')||'';}catch(e){}
var S=null;
function $(id){return document.getElementById(id);}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function toast(t){var e=$('toast');e.textContent=t;e.style.display='block';clearTimeout(toast.t);toast.t=setTimeout(function(){e.style.display='none';},3500);}
function api(p,b){b=b||{};b.code=CODE;return fetch(p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json();}).catch(function(){return {error:'네트워크가 끊겼어요.'};});}
function today(o){return new Date(Date.now()+8*3600e3+(o||0)*86400e3).toISOString().slice(0,10);}
var WD=['일','월','화','수','목','금','토'];
function wd(d){return WD[new Date(d+'T00:00:00Z').getUTCDay()];}
function ask(){ $('m').innerHTML='<div class="card"><h2>초대 코드</h2><input id="cd" placeholder="박비서와 같은 코드"><div class="btns"><button id="go">확인</button></div></div>';
  $('go').onclick=function(){CODE=$('cd').value.trim();try{localStorage.setItem('pb-code',CODE);}catch(e){}load();};}
function load(){ if(!CODE)return ask(); api('/brief/state').then(function(r){ if(r.error){ if(r.error==='not_allowed')return ask(); $('m').innerHTML='<div class="card">'+esc(r.detail||r.error)+'</div>';return;} S=r; draw(); }); }
// 광저우 밖에서 비행기·고속철로 떠나는데 전날 숙소가 없으면 아침 알림이 대략 시간으로만 계산됨
function noStay(x){if(!x.t||(x.how!=='plane'&&x.how!=='train')||/广州/.test(x.from))return '';
  var p=S.trips.filter(function(y){return y.d<x.d&&y.to===x.from&&y.stay&&y.stay!=='미정';});
  return p.length?'':'<p class="warn">⚠️ '+esc(x.from)+' 숙소가 비어 있어 이날 아침 출발 알림은 대략 시간(차 40분)으로 계산돼요. 전날 일정에 호텔 이름을 넣어 주세요.</p>';}
function tripHtml(x,i){var past=x.d&&x.d<today();
  return '<div class="trip'+(past?' past':'')+'" data-i="'+i+'"><div class="th"><span>'+(x.d?esc(x.d.slice(5))+'('+wd(x.d)+')':'새 일정')+(S.sent[x.d]?' <span class="ok">✓ 보냄</span>':'')+'</span><button class="del" data-del="'+i+'">삭제</button></div>'+
  '<div class="lbl"><span>날짜</span><span>수단</span><span>출발 시각</span></div><div class="row row3"><input type="date" data-k="d" value="'+esc(x.d)+'"><select data-k="how">'+
  [['plane','✈️ 비행기'],['train','🚄 고속철'],['car','🚗 차'],['stay','📍 현지 일정']].map(function(o){return '<option value="'+o[0]+'"'+(x.how===o[0]?' selected':'')+'>'+o[1]+'</option>';}).join('')+
  '</select><input type="time" data-k="t" value="'+esc(x.t)+'" placeholder="출발"></div>'+
  '<div class="lbl"><span>출발 도시</span><span>도착 도시</span><span>편명·열차</span></div><div class="row row3"><input data-k="from" value="'+esc(x.from)+'" placeholder="출발 도시(중문)"><input data-k="to" value="'+esc(x.to)+'" placeholder="도착 도시"><input data-k="no" value="'+esc(x.no)+'" placeholder="편명 CZ3xxx"></div>'+
  '<div class="lbl"><span>출발 공항·역</span><span>도착 시각</span><span>좌석</span></div><div class="row row3"><input data-k="dep" value="'+esc(x.dep||'')+'" placeholder="출발 공항·역(T2)"><input type="time" data-k="arr" value="'+esc(x.arr||'')+'" placeholder="도착"><input data-k="seat" value="'+esc(x.seat||'')+'" placeholder="좌석"></div>'+
  noStay(x)+'<div class="lbl" style="grid-template-columns:1fr"><span>'+esc(x.to||'도착 도시')+' 숙소</span></div><input data-k="stay" value="'+esc(x.stay)+'" placeholder="호텔 이름 — 다음 날 아침 출발 계산에 씀" style="margin-bottom:8px">'+
  '<textarea data-k="meet" placeholder="미팅·공장 메모(선택) — 예: 오후 2시 OO공장 샘플 확인, 단가 재협상">'+esc(x.meet)+'</textarea></div>';}
function draw(){
  var tom=today(1), has=S.trips.some(function(x){return x.d===tom;});
  var h='<div class="card"><h2>알림 받을 곳 · Bark</h2>'+(S.bark?'<p class="ok">✓ 연결됨 — 출장 전날 '+S.hour+'시에 알림</p>':'<ol class="muted"><li>앱스토어에서 <b>Bark</b> 설치(무료)·알림 허용</li><li>앱 첫 화면 주소(https://api.day.app/…) 복사</li><li>아래에 붙여 넣고 저장</li></ol>')+
    '<input id="bark" placeholder="'+(S.bark?'바꿀 때만 새 주소 붙여 넣기':'https://api.day.app/…')+'">'+
    '<div class="row" style="margin-top:8px"><select id="hour">'+[18,19,20,21].map(function(n){return '<option'+(S.hour==n?' selected':'')+'>'+n+'</option>';}).join('')+'</select><span class="muted" style="align-self:center">시에 보내기(전날, 중국 시간)</span></div>'+
    '<div class="btns"><button id="sb">저장</button>'+(S.bark?'<button class="ghost" id="ping">테스트 알림</button>':'')+'</div></div>';
  h+='<div class="card"><h2>📋 예약 캡처로 채우기</h2><p class="muted">여행앱·항공사·12306 예약 화면 캡처나 예약 문자를 넣으면 날짜·시각·편명·공항·좌석을 읽어 일정에 채워요.</p>'+
    '<input type="file" id="pf" accept="image/*" style="margin-bottom:8px"><textarea id="pt" placeholder="또는 예약 문자·메일 내용 붙여 넣기"></textarea><div class="btns"><button id="pp">읽어서 채우기</button></div><div id="pout"></div></div>';
  h+='<div class="card"><h2>🚕 당일 아침 출발 알림</h2><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="mo" style="width:auto"'+(S.morning?' checked':'')+'> 출발 당일, 지금 교통 기준으로 나갈 시각 20분 전에 알림</label>'+
    '<p class="muted">광저우 출발은 집에서, 다른 도시는 전날 숙소에서 공항·역까지 차 시간을 高德로 계산해요. 알림을 누르면 高德 길안내.</p>'+
    '<p class="'+(S.home?'ok':'muted')+'">'+(S.home?'✓ 집 위치 저장됨':'집 위치가 없어요 — 집에서 아래 버튼을 눌러 주세요')+'</p><div class="btns"><button class="ghost" id="hm">📍 지금 위치를 집으로 저장</button></div></div>';
  h+='<div class="card"><h2>출장 일정</h2>'+S.trips.map(tripHtml).join('')+'<div class="btns"><button class="ghost" id="add">+ 일정 추가</button><button id="st">일정 저장</button></div></div>';
  h+='<div class="card"><h2>미리 보기 · 바로 보내기</h2><div class="row"><input type="date" id="pd" value="'+tom+'"><span class="muted" style="align-self:center">'+(has?'내일 일정 있음 — 오늘 '+S.hour+'시 자동 발송':'내일 일정 없음')+'</span></div>'+
    '<div class="btns"><button class="ghost" id="pv">미리 보기</button><button id="sn">지금 보내기</button></div><div id="out"></div></div>';
  if(S.log&&S.log.length)h+='<div class="card"><h2>보낸 기록</h2>'+S.log.map(function(l){return '<div class="muted">'+esc(l.d)+' · '+new Date(l.at).toLocaleString('ko-KR',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})+' · '+(l.ok?'✓ '+(l.m?'아침 출발':(l.how||'')):'✕ '+esc(l.err||''))+'</div>';}).join('')+'</div>';
  $('m').innerHTML=h;
  $('sb').onclick=function(){var b={hour:$('hour').value};var v=$('bark').value.trim();if(v)b.bark=v;api('/brief/save',b).then(function(r){if(r.error)return toast(r.detail||r.error);S=r;draw();toast('저장했어요');});};
  if($('ping'))$('ping').onclick=function(){api('/brief/ping').then(function(r){toast(r.error?(r.detail||r.error):'보냈어요. 폰을 확인해 보세요');});};
  $('add').onclick=function(){S.trips=collect();var last=S.trips[S.trips.length-1];S.trips.push({id:'',d:today(1),from:last?last.to:'广州',to:'',how:'plane',t:'',no:'',stay:'',meet:''});draw();};
  $('st').onclick=saveTrips;
  Array.prototype.forEach.call(document.querySelectorAll('[data-del]'),function(b){b.onclick=function(){S.trips=collect();S.trips.splice(+b.getAttribute('data-del'),1);saveTrips();};});
  $('pv').onclick=function(){send(true);};$('sn').onclick=function(){send(false);};
  $('mo').onchange=function(){api('/brief/save',{morning:$('mo').checked}).then(function(r){if(!r.error){S=r;toast(S.morning?'아침 알림 켬':'아침 알림 끔');}});};
  $('hm').onclick=function(){if(!navigator.geolocation)return toast('위치를 쓸 수 없어요');toast('위치 확인 중…');
    navigator.geolocation.getCurrentPosition(function(p){api('/brief/save',{trips:collect(),home:{gps:p.coords.longitude.toFixed(6)+','+p.coords.latitude.toFixed(6)}}).then(function(r){if(r.error)return toast(r.detail||r.error);S=r;draw();toast('집 위치 저장');});},
      function(){toast('위치 권한을 허용해 주세요');},{enableHighAccuracy:true,timeout:15000});};
  $('pp').onclick=parse;
}
function shrink(f){return new Promise(function(ok,no){var im=new Image();im.onload=function(){var k=Math.min(1,1600/Math.max(im.width,im.height)),c=document.createElement('canvas');c.width=Math.round(im.width*k);c.height=Math.round(im.height*k);
  c.getContext('2d').drawImage(im,0,0,c.width,c.height);URL.revokeObjectURL(im.src);ok(c.toDataURL('image/jpeg',0.85));};im.onerror=no;im.src=URL.createObjectURL(f);});}
function same(a,b){return a&&b&&(a===b||a.indexOf(b)>=0||b.indexOf(a)>=0);}
function parse(){var f=$('pf').files[0],t=$('pt').value.trim();if(!f&&!t)return toast('캡처나 문자를 넣어 주세요');
  $('pout').innerHTML='<p class="muted">읽는 중… (10~20초)</p>';
  (f?shrink(f):Promise.resolve('')).then(function(img){return api('/brief/parse',{image:img,text:t});}).then(function(r){
    if(r.error){$('pout').innerHTML='<p style="color:var(--red)">'+esc(r.detail||r.error)+'</p>';return;}
    S.trips=collect();var add=0,upd=0,stay=null;
    r.trips.forEach(function(p){if(p.stayOnly){stay=p;return;}
      var x=S.trips.filter(function(y){return y.d===p.d&&(same(y.to,p.to)||same(y.from,p.from));})[0];
      if(x){['how','t','arr','no','from','to','dep','seat'].forEach(function(k){if(p[k])x[k]=p[k];});if(x.meet==='돌아오는 편 확인')x.meet='';upd++;}else{p.id='';p.stay=p.stay||'';p.meet='';S.trips.push(p);add++;}});
    if(stay){var s2=S.trips.filter(function(y){return same(y.to,stay.city);});if(s2.length){s2[s2.length-1].stay=stay.name;upd++;}}
    S.trips.sort(function(a,b){return (a.d+a.t).localeCompare(b.d+b.t);});
    api('/brief/save',{trips:S.trips}).then(function(s){if(s.error)return toast(s.detail||s.error);S=s;draw();
      $('pout').innerHTML='<p class="ok">✓ 일정 '+upd+'개 채움 · '+add+'개 추가'+(stay?' · 숙소 '+esc(stay.name):'')+' — 아래에서 확인해 주세요</p>';});
  });}
function collect(){return Array.prototype.map.call(document.querySelectorAll('.trip'),function(el){var o={id:(S.trips[+el.getAttribute('data-i')]||{}).id||''};
  Array.prototype.forEach.call(el.querySelectorAll('[data-k]'),function(f){o[f.getAttribute('data-k')]=f.value.trim();});return o;});}
function saveTrips(){api('/brief/save',{trips:collect()}).then(function(r){if(r.error)return toast(r.detail||r.error);S=r;draw();toast('일정 저장');});}
function send(dry){var d=$('pd').value;$('out').innerHTML='<p class="muted">'+(dry?'만드는 중…':'만들어 보내는 중…')+'</p>';
  api('/brief/save',{trips:collect()}).then(function(){return api('/brief/send',{d:d,dry:dry});}).then(function(r){
    if(r.error){$('out').innerHTML='<p style="color:var(--red)">'+esc(r.detail||r.error)+'</p>';return;}
    var b=r.brief;$('out').innerHTML='<p><b>'+esc(b.title)+'</b></p><pre>'+esc(b.body)+'</pre><div class="btns"><a href="'+esc(r.link)+'"><button class="ghost">전체 브리핑 열기</button></a></div>'+(r.sent?'<p class="ok">✓ 폰으로 보냈어요</p>':'');
    if(r.sent){S.sent[d]=Date.now();}
  });}
load();
</script></body></html>`;
