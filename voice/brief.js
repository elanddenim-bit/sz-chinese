// =========================================================
// 🧳 출장 전날 브리핑 — 다음 날 이동 일정이 있으면 전날 저녁(중국 18~21시 중 고른 시각) 아이폰 Bark 알림으로
//  GET  /brief               화면(박비서와 같은 초대 코드, localStorage pb-code, 주인 전용)
//  POST /brief/state {code}                    → {trips, bark(설정 여부), hour, log}
//  POST /brief/save  {code, trips?, bark?, hour?}
//  POST /brief/send  {code, d, dry?}           → 그 날짜 브리핑을 만들어 보냄(dry 면 만들기만)
//  POST /brief/ping  {code}                    → Bark 테스트 알림
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

async function qwen(env, sys, user) {
  const call = async (fmt) => {
    const r = await fetch("https://" + host(env) + "/compatible-mode/v1/chat/completions", {
      method: "POST", headers: { authorization: "Bearer " + env.DASHSCOPE_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ model: env.BRIEF_MODEL || env.QUEST_MODEL || "qwen3.8-flash", temperature: 0.4, enable_thinking: false, ...(fmt ? { response_format: { type: "json_object" } } : {}),
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
  const route = legs.map((x) => x.how === "stay" ? "📍 " + x.to + " 현지" : HOW[x.how] + " " + [x.t, x.no].filter(Boolean).join(" ") + " " + x.from + "→" + x.to + (x.leave ? " · " + x.leave + " 출발 권장" : ""));
  const wline = dest ? "🌡 " + dest.city + " " + dest.lo + "~" + dest.hi + "° " + dest.w + (dest.rain != null ? " · 강수 " + dest.rain + "%" : "") +
    (diff != null && Math.abs(diff) >= 2 ? " (광저우보다 " + Math.abs(diff) + "° " + (diff < 0 ? "낮음" : "높음") + ")" : "") : "🌡 날씨 정보 없음";
  const title = "내일(" + facts.weekday + ") " + (String(ai.title || "").slice(0, 26) || legs.map((x) => x.to).join("·") + " 일정");
  const body = [...route, wline, ai.wear ? "👔 " + String(ai.wear).slice(0, 40) : "", pack.length ? "🎒 " + pack.join(", ") : ""].filter(Boolean).join("\n");
  return { d, at: Date.now(), title, body, route, wline, ws, wear: ai.wear || "", pack, meet, tip: ai.tip || "", zh: ai.zh && ai.zh.z ? ai.zh : null, legs, err: ai.err || "" };
}

async function sendFor(env, h, doc, d, dry) {
  const out = await build(env, doc, d);
  if (!out) throw berr(d + " 에 등록된 일정이 없어요.");
  await env.KV.put("brief:out:" + h + ":" + d, JSON.stringify(out), { expirationTtl: 14 * 86400 });
  const link = "https://voice.zhnote.net/brief/v?h=" + h + "&d=" + d + "&s=" + (await hmac16(env, h + "|" + d));
  if (!dry) {
    await barkPush(doc.bark, out.title, out.body, link);
    doc.sent = doc.sent || {};
    doc.sent[d] = Date.now();
    doc.log = [{ d, at: Date.now(), ok: true }, ...(doc.log || [])].slice(0, 20);
    await store(env, h, doc);
  }
  return { ok: true, sent: !dry, link, brief: out };
}

export async function briefApi(env, ctx, path, b, h) {
  await owner(env, h);
  const doc = await load(env, h);
  const view = () => ({ ok: true, trips: doc.trips, bark: !!barkOf(doc.bark), hour: doc.hour || 21, log: (doc.log || []).slice(0, 8), sent: doc.sent || {} });
  if (path === "/brief/state") return view();
  if (path === "/brief/save") {
    if (b.trips) doc.trips = cleanTrips(b.trips);
    if (typeof b.bark === "string") {
      if (b.bark && !barkOf(b.bark)) throw berr("Bark 주소 형식이 아니에요. 앱에서 복사한 https://api.day.app/… 주소를 그대로 붙여 넣어 주세요.");
      const k = barkOf(b.bark);
      doc.bark = k ? k.origin + "/" + k.key : "";
    }
    if (b.hour) doc.hour = Math.min(21, Math.max(18, Number(b.hour) || 21));
    await store(env, h, doc);
    return view();
  }
  if (path === "/brief/ping") {
    await barkPush(doc.bark, "출장 브리핑 연결됨 ✅", "출장 전날 " + (doc.hour || 21) + "시에 이렇게 알려 드려요.", "https://voice.zhnote.net/brief");
    return { ok: true };
  }
  if (path === "/brief/send") {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(b.d || "") ? b.d : cnDay(Date.now() + 86400e3);
    const r = await sendFor(env, h, doc, d, !!b.dry);
    ctx.waitUntil(logUse(env, "brief", { [b.dry ? "preview" : "send"]: 1 }, 0, h).catch(() => {}));
    return r;
  }
  throw berr("not_found", 404);
}

// 크론(중국 18~21시 매시): 주인 문서에서 내일 일정이 있고 아직 안 보냈으면 정한 시각에 보냄
export async function briefCron(env) {
  const h = await env.KV.get("usage:owner");
  if (!h) return;
  const doc = await env.KV.get(docKey(h), "json");
  if (!doc || !barkOf(doc.bark)) return;
  if (cnNow().getUTCHours() !== (doc.hour || 21)) return;
  const d = cnDay(Date.now() + 86400e3);
  if ((doc.sent || {})[d] || !doc.trips.some((x) => x.d === d)) return;
  try { await sendFor(env, h, doc, d, false); await logUse(env, "brief", { auto: 1 }, 0, h).catch(() => {}); }
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
function tripHtml(x,i){var past=x.d&&x.d<today();
  return '<div class="trip'+(past?' past':'')+'" data-i="'+i+'"><div class="th"><span>'+(x.d?esc(x.d.slice(5))+'('+wd(x.d)+')':'새 일정')+(S.sent[x.d]?' <span class="ok">✓ 보냄</span>':'')+'</span><button class="del" data-del="'+i+'">삭제</button></div>'+
  '<div class="row row3"><input type="date" data-k="d" value="'+esc(x.d)+'"><select data-k="how">'+
  [['plane','✈️ 비행기'],['train','🚄 고속철'],['car','🚗 차'],['stay','📍 현지 일정']].map(function(o){return '<option value="'+o[0]+'"'+(x.how===o[0]?' selected':'')+'>'+o[1]+'</option>';}).join('')+
  '</select><input type="time" data-k="t" value="'+esc(x.t)+'" placeholder="출발"></div>'+
  '<div class="row row3"><input data-k="from" value="'+esc(x.from)+'" placeholder="출발 도시(중문)"><input data-k="to" value="'+esc(x.to)+'" placeholder="도착 도시"><input data-k="no" value="'+esc(x.no)+'" placeholder="편명 CZ3xxx"></div>'+
  '<input data-k="stay" value="'+esc(x.stay)+'" placeholder="숙소(선택)" style="margin-bottom:8px">'+
  '<textarea data-k="meet" placeholder="미팅·공장 메모(선택) — 예: 오후 2시 OO공장 샘플 확인, 단가 재협상">'+esc(x.meet)+'</textarea></div>';}
function draw(){
  var tom=today(1), has=S.trips.some(function(x){return x.d===tom;});
  var h='<div class="card"><h2>알림 받을 곳 · Bark</h2>'+(S.bark?'<p class="ok">✓ 연결됨 — 출장 전날 '+S.hour+'시에 알림</p>':'<ol class="muted"><li>앱스토어에서 <b>Bark</b> 설치(무료)·알림 허용</li><li>앱 첫 화면 주소(https://api.day.app/…) 복사</li><li>아래에 붙여 넣고 저장</li></ol>')+
    '<input id="bark" placeholder="'+(S.bark?'바꿀 때만 새 주소 붙여 넣기':'https://api.day.app/…')+'">'+
    '<div class="row" style="margin-top:8px"><select id="hour">'+[18,19,20,21].map(function(n){return '<option'+(S.hour==n?' selected':'')+'>'+n+'</option>';}).join('')+'</select><span class="muted" style="align-self:center">시에 보내기(전날, 중국 시간)</span></div>'+
    '<div class="btns"><button id="sb">저장</button>'+(S.bark?'<button class="ghost" id="ping">테스트 알림</button>':'')+'</div></div>';
  h+='<div class="card"><h2>출장 일정</h2>'+S.trips.map(tripHtml).join('')+'<div class="btns"><button class="ghost" id="add">+ 일정 추가</button><button id="st">일정 저장</button></div></div>';
  h+='<div class="card"><h2>미리 보기 · 바로 보내기</h2><div class="row"><input type="date" id="pd" value="'+tom+'"><span class="muted" style="align-self:center">'+(has?'내일 일정 있음 — 오늘 '+S.hour+'시 자동 발송':'내일 일정 없음')+'</span></div>'+
    '<div class="btns"><button class="ghost" id="pv">미리 보기</button><button id="sn">지금 보내기</button></div><div id="out"></div></div>';
  if(S.log&&S.log.length)h+='<div class="card"><h2>보낸 기록</h2>'+S.log.map(function(l){return '<div class="muted">'+esc(l.d)+' · '+new Date(l.at).toLocaleString('ko-KR',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})+' · '+(l.ok?'✓':'✕ '+esc(l.err||''))+'</div>';}).join('')+'</div>';
  $('m').innerHTML=h;
  $('sb').onclick=function(){var b={hour:$('hour').value};var v=$('bark').value.trim();if(v)b.bark=v;api('/brief/save',b).then(function(r){if(r.error)return toast(r.detail||r.error);S=r;draw();toast('저장했어요');});};
  if($('ping'))$('ping').onclick=function(){api('/brief/ping').then(function(r){toast(r.error?(r.detail||r.error):'보냈어요. 폰을 확인해 보세요');});};
  $('add').onclick=function(){S.trips=collect();var last=S.trips[S.trips.length-1];S.trips.push({id:'',d:today(1),from:last?last.to:'广州',to:'',how:'plane',t:'',no:'',stay:'',meet:''});draw();};
  $('st').onclick=saveTrips;
  Array.prototype.forEach.call(document.querySelectorAll('[data-del]'),function(b){b.onclick=function(){S.trips=collect();S.trips.splice(+b.getAttribute('data-del'),1);saveTrips();};});
  $('pv').onclick=function(){send(true);};$('sn').onclick=function(){send(false);};
}
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
