// =========================================================
// 🧭 주말 탐험 퀘스트 — 지금 위치 주변에서 오늘 가 볼 곳 3곳을 퀘스트로, 사진으로 인증
//  GET  /quest                 화면 (박비서와 같은 초대 코드, localStorage pb-code)
//  POST /quest/state  {code}                       → 현재 퀘스트·점수·배지·기록
//  POST /quest/new    {code, gps, radius, mood}    → 高德 주변 후보(디디 서버 /api/poi) + 날씨(Open-Meteo) → 千问이 3곳 골라 미션 작성
//  POST /quest/check  {code, qid, image}           → 千问 VL 이 사진이 미션에 맞는지 판정, 맞으면 점수·배지·R2 사진
//  POST /quest/honor  {code, qid, image?}          → 판정이 틀렸을 때 "그래도 인정"(점수 절반)
//  GET  /quest/img?k&s · /quest/map?loc&s · /quest/photo?u   인증 사진(서명) · 高德 지도(디디 서버 경유) · 高德 장소 사진 중계
// 저장: KV quest:<코드해시> 문서 하나, 사진 R2 quest/<코드해시>/<날짜>-<qid>.jpg
// [필수] AI 는 百炼(千问)만 — Anthropic 호출 없음
// =========================================================
import { logUse } from "./usage.js";

const MOODS = {
  mix: { label: "아무거나", kw: ["公园", "博物馆", "书店", "老街", "咖啡馆", "早茶", "创意园", "湿地公园"] },
  nature: { label: "자연·공원", kw: ["公园", "湿地公园", "绿道", "森林公园", "植物园", "江边"] },
  food: { label: "맛집·카페", kw: ["早茶", "咖啡馆", "茶馆", "甜品", "小吃", "糖水", "烧腊", "酒吧"] },
  culture: { label: "문화·전시", kw: ["博物馆", "美术馆", "书店", "图书馆", "寺", "纪念馆"] },
  street: { label: "골목·시장", kw: ["老街", "创意园", "夜市", "骑楼", "古村", "市场"] },
};
const KW_CAT = {};
for (const [cat, m] of Object.entries(MOODS)) if (cat !== "mix") for (const k of m.kw) KW_CAT[k] = KW_CAT[k] || cat;
const CAT_NAME = { nature: "자연", food: "맛집", culture: "문화", street: "골목" };

export const BADGES = [
  { k: "first", icon: "🥾", name: "첫 발걸음", desc: "첫 퀘스트 완료" },
  { k: "triple", icon: "🏆", name: "올클리어", desc: "하루에 3곳 모두" },
  { k: "nature5", icon: "🌳", name: "숲 탐험가", desc: "자연·공원 5곳" },
  { k: "food5", icon: "🥟", name: "먹방 원정대", desc: "맛집·간식 5곳" },
  { k: "culture5", icon: "🏛", name: "교양 탐험가", desc: "문화·전시 5곳" },
  { k: "street5", icon: "🏮", name: "골목 대장", desc: "골목·시장 5곳" },
  { k: "rain", icon: "☔", name: "비에도 간다", desc: "비 올 확률 50% 넘는 날 완료" },
  { k: "far", icon: "🚀", name: "원정", desc: "8km 넘는 곳 완료" },
  { k: "pts100", icon: "💯", name: "100점", desc: "누적 100점" },
  { k: "pts300", icon: "👑", name: "300점", desc: "누적 300점" },
  { k: "weeks4", icon: "📅", name: "4주 연속", desc: "4주 연속 주말 탐험" },
];

const cnDay = (t = Date.now()) => new Date(t + 8 * 3600e3).toISOString().slice(0, 10);
const host = (env) => (env.DASHSCOPE_WS_HOST || "dashscope.aliyuncs.com").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
const qerr = (message, status = 400) => Object.assign(new Error(message), { code: "quest", status });

async function hmac16(env, s) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode("quest|" + (env.ALLOWED_CODES || "") + (env.DASHSCOPE_API_KEY || "")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(s));
  return [...new Uint8Array(sig)].slice(0, 8).map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function load(env, h) {
  const d = (await env.KV.get("quest:" + h, "json")) || {};
  return { cur: d.cur || null, pts: d.pts || 0, badges: d.badges || [], hist: d.hist || [], cats: d.cats || {}, gen: d.gen || {}, weeks: d.weeks || [] };
}
const save = (env, h, d) => env.KV.put("quest:" + h, JSON.stringify(d));

// 千问 (OpenAI 호환, 업무공간 주소)
async function qwen(env, model, messages) {
  const r = await fetch("https://" + host(env) + "/compatible-mode/v1/chat/completions", {
    method: "POST",
    headers: { authorization: "Bearer " + env.DASHSCOPE_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ model, messages, temperature: 0.8, response_format: { type: "json_object" }, enable_thinking: false }),
  });
  const t = await r.text();
  let j = {};
  try { j = JSON.parse(t); } catch {}
  if (!r.ok) throw qerr("千问 " + r.status + ": " + ((j.error && j.error.message) || t.slice(0, 160)), 502);
  const c = String((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "").replace(/^```(?:json)?\s*|\s*```$/g, "");
  try { return JSON.parse(c); } catch { throw qerr("千问 응답을 읽지 못했습니다", 502); }
}

async function weather(lat, lon) {
  try {
    const r = await fetch("https://api.open-meteo.com/v1/forecast?latitude=" + lat + "&longitude=" + lon +
      "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,uv_index_max&forecast_days=1&timezone=Asia%2FShanghai");
    const d = (await r.json()).daily || {};
    return { hi: Math.round(d.temperature_2m_max[0]), lo: Math.round(d.temperature_2m_min[0]), rain: d.precipitation_probability_max[0] || 0, code: d.weather_code[0], uv: Math.round(d.uv_index_max[0] || 0) };
  } catch { return null; }
}
const wxText = (w) => !w ? "" : (w.code === 0 ? "맑음" : w.code <= 3 ? "구름" : w.code >= 95 ? "뇌우" : w.code >= 51 ? "비" : "흐림") + " " + w.lo + "~" + w.hi + "° · 비 " + w.rain + "%" + (w.uv >= 8 ? " · 자외선 강함" : "");

async function signCur(env, d) {
  if (d.cur) for (const q of d.cur.items) if (q.img) q.imgUrl = "/quest/img?k=" + encodeURIComponent(q.img) + "&s=" + (await hmac16(env, q.img));
  for (const x of d.hist.slice(0, 40)) if (x.img) x.imgUrl = "/quest/img?k=" + encodeURIComponent(x.img) + "&s=" + (await hmac16(env, x.img));
  return d;
}
const view = async (env, d) => {
  const v = await signCur(env, JSON.parse(JSON.stringify(d)));
  return { ok: true, today: cnDay(), cur: v.cur, pts: v.pts, badges: v.badges, hist: v.hist.slice(0, 40), cats: v.cats, all: BADGES, moods: Object.fromEntries(Object.entries(MOODS).map(([k, m]) => [k, m.label])) };
};

export async function questApi(env, ctx, path, b, h) {
  if (path === "/quest/state") return view(env, await load(env, h));
  if (path === "/quest/new") return newQuest(env, ctx, b, h);
  if (path === "/quest/check") return check(env, ctx, b, h, false);
  if (path === "/quest/honor") return check(env, ctx, b, h, true);
  throw qerr("not_found", 404);
}

async function newQuest(env, ctx, b, h) {
  const gps = String(b.gps || "");
  if (!/^-?\d+\.\d+,-?\d+\.\d+$/.test(gps)) throw qerr("현재 위치가 필요해요. 위치 권한을 허용해 주세요.");
  if (!env.DIDI || !env.DIDI_ACCESS_KEY) throw qerr("장소 검색 서버(디디 주소록) 연결이 없습니다", 500);
  const d = await load(env, h);
  const day = cnDay(), max = Number(env.QUEST_DAY_MAX) || 6;
  if ((d.gen[day] || 0) >= max) throw qerr("오늘은 퀘스트를 " + max + "번 받았어요. 내일 다시!", 429);
  const mood = MOODS[b.mood] ? b.mood : "mix";
  const radius = [3000, 5000, 10000, 20000].includes(Number(b.radius)) ? Number(b.radius) : 5000;
  const [lon, lat] = gps.split(",").map(Number);
  const [poiRes, wx] = await Promise.all([
    env.DIDI.fetch("https://didi/api/poi", { method: "POST", headers: { "x-access-key": env.DIDI_ACCESS_KEY, "content-type": "application/json" }, body: JSON.stringify({ gps, radius, kw: MOODS[mood].kw }) }).then((r) => r.json()),
    weather(lat.toFixed(3), lon.toFixed(3)),
  ]);
  if (!poiRes.ok) throw qerr("주변 장소를 못 찾았어요: " + (poiRes.error || ""), 502);
  const visited = new Set(d.hist.map((x) => x.pid));
  let cands = (poiRes.pois || []).filter((p) => !visited.has(p.id));
  cands.sort((a, b2) => (b2.rating || 3) - (a.rating || 3) || a.dist - b2.dist);
  cands = cands.slice(0, 32);
  if (cands.length < 3) throw qerr("반경 안에 후보가 부족해요. 반경을 넓혀 보세요.");
  const list = cands.map((p, i) => ({ i, name: p.name, kw: p.kw, type: p.type, area: p.area, km: +(p.dist / 1000).toFixed(1), rating: p.rating || null, cost: p.cost || null }));
  const who = b.who === "solo" ? "一个人（韩国中年男性，住在广州）" : "一对韩国中年夫妻（住在广州，两个人一起去，没有孩子同行）";
  const sys = "你是周末探险游戏设计师，玩家是" + who + "。从候选地点里选3个今天去的地方，做成大人觉得有意思的拍照任务（不要儿童化、不要幼稚）。" +
    "任务风格：'散步、发现小细节、尝当地味道、找有故事的老建筑或招牌'这类适合大人的；如果是夫妻，可以有一个需要两个人配合的任务（例如互相拍、找到两样东西），但不要求拍游客或陌生人。" +
    "要求：3个地点类别尽量不同，远近搭配；下雨概率≥60%时优先室内；任务必须是一张照片就能证明的具体画面（例如\"拍到园内的拱桥和水面倒影\"、\"拍到招牌上的店名和你点的那道甜品\"），不能要求拍陌生人的脸，不能危险，不能违反场所规定；" +
    "mission、title、why 用韩语，口语、轻松有趣；phrase 是在那里用得上的一句简单中文（z 汉字, p 带声调拼音, k 韩语意思）；pts 按距离和难度给 10、20 或 30。" +
    '只输出 JSON：{"intro":"韩语一句话","quests":[{"i":候选编号,"title":"","mission":"","why":"","phrase":{"z":"","p":"","k":""},"pts":10}]}';
  const user = "今天天气：" + (wx ? JSON.stringify(wx) : "未知") + "\n心情：" + MOODS[mood].label + "\n候选：" + JSON.stringify(list);
  const out = await qwen(env, env.QUEST_MODEL || "qwen3.8-flash", [{ role: "system", content: sys }, { role: "user", content: user }]);
  const used = new Set();
  const items = (Array.isArray(out.quests) ? out.quests : []).filter((q) => Number.isInteger(q.i) && cands[q.i] && !used.has(q.i) && used.add(q.i)).slice(0, 3).map((q, n) => {
    const p = cands[q.i];
    return {
      qid: "q" + Date.now().toString(36) + n, cat: KW_CAT[p.kw] || "street",
      poi: { id: p.id, name: p.name, addr: p.addr, area: p.area, loc: p.loc, ms: p.ms, dist: p.dist, rating: p.rating, cost: p.cost, type: p.type, photo: p.photo ? "/quest/photo?u=" + encodeURIComponent(p.photo) : "" },
      title: String(q.title || p.name).slice(0, 60), mission: String(q.mission || "").slice(0, 160), why: String(q.why || "").slice(0, 160),
      phrase: q.phrase && q.phrase.z ? { z: String(q.phrase.z).slice(0, 40), p: String(q.phrase.p || "").slice(0, 80), k: String(q.phrase.k || "").slice(0, 60) } : null,
      pts: [10, 20, 30].includes(Number(q.pts)) ? Number(q.pts) : 20, done: false,
    };
  });
  if (items.length < 1) throw qerr("퀘스트를 만들지 못했어요. 다시 눌러 주세요.", 502);
  d.cur = { date: day, made: Date.now(), mood, radius, who: b.who === "solo" ? "solo" : "duo", wx, wxText: wxText(wx), intro: String(out.intro || "").slice(0, 120), items };
  d.gen = { [day]: (d.gen[day] || 0) + 1 };
  await save(env, h, d);
  ctx.waitUntil(logUse(env, "quest", { new: 1 }, 0, h).catch(() => {}));
  return view(env, d);
}

function b64bytes(b64) {
  const s = atob(String(b64).replace(/^data:[^,]+,/, ""));
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}
const weekKey = (day) => { const t = new Date(day + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };

async function check(env, ctx, b, h, honor) {
  const d = await load(env, h);
  const q = d.cur && d.cur.items.find((x) => x.qid === b.qid);
  if (!q) throw qerr("퀘스트를 찾지 못했어요. 새로고침해 주세요.");
  if (q.done) return { ...(await view(env, d)), result: { ok: true, comment: "이미 완료한 퀘스트예요." } };
  const img = String(b.image || "");
  if (img && img.length > 4_000_000) throw qerr("사진이 너무 커요.");
  let verdict;
  if (honor) verdict = { ok: true, comment: "인정! 다음엔 사진으로도 증명해 봐요 😉" };
  else {
    if (!img) throw qerr("사진이 필요해요.");
    const prompt = "这是周末探险游戏的拍照任务验证。地点：" + q.poi.name + "（" + q.poi.type + "）。任务（韩语）：" + q.mission +
      "\n请判断这张照片是否大致完成了任务（不用太严格：在那类地方、有任务里说的主要东西就算通过；明显无关、截图、屏幕翻拍不算）。" +
      '只输出 JSON：{"ok":true或false,"comment":"用韩语1~2句，像游戏主持人一样有趣地评价照片；不通过时说缺了什么"}';
    verdict = await qwen(env, env.QUEST_VL_MODEL || "qwen3-vl-plus", [{ role: "user", content: [{ type: "image_url", image_url: { url: img.startsWith("data:") ? img : "data:image/jpeg;base64," + img } }, { type: "text", text: prompt }] }]);
    verdict = { ok: verdict.ok === true || verdict.ok === "true", comment: String(verdict.comment || "").slice(0, 200) };
  }
  if (!verdict.ok) {
    ctx.waitUntil(logUse(env, "quest", { fail: 1 }, 0, h).catch(() => {}));
    return { ...(await view(env, d)), result: verdict };
  }
  const day = cnDay();
  let key = "";
  if (img && env.R2) {
    key = "quest/" + h + "/" + day + "-" + q.qid + ".jpg";
    await env.R2.put(key, b64bytes(img), { httpMetadata: { contentType: "image/jpeg" } });
  }
  const pts = honor ? Math.round(q.pts / 2) : q.pts;
  Object.assign(q, { done: true, img: key, comment: verdict.comment, got: pts, at: Date.now(), honor: !!honor });
  d.pts += pts;
  d.cats[q.cat] = (d.cats[q.cat] || 0) + 1;
  d.hist.unshift({ date: day, pid: q.poi.id, name: q.poi.name, area: q.poi.area, title: q.title, cat: q.cat, pts, img: key, comment: verdict.comment });
  d.hist = d.hist.slice(0, 200);
  const wk = weekKey(day);
  if (!d.weeks.includes(wk)) d.weeks = [wk, ...d.weeks].slice(0, 60);
  // 배지
  const has = new Set(d.badges.map((x) => x.k)), got = [];
  const give = (k) => { if (!has.has(k)) { has.add(k); d.badges.push({ k, at: day }); got.push(k); } };
  give("first");
  if (d.cur.items.length >= 3 && d.cur.items.every((x) => x.done)) give("triple");
  for (const c of ["nature", "food", "culture", "street"]) if ((d.cats[c] || 0) >= 5) give(c + "5");
  if (d.cur.wx && d.cur.wx.rain >= 50) give("rain");
  if (q.poi.dist >= 8000) give("far");
  if (d.pts >= 100) give("pts100");
  if (d.pts >= 300) give("pts300");
  let run = 0;
  for (let i = 0; i < d.weeks.length; i++) { if (d.weeks[i] === weekKey(cnDay(Date.now() - i * 7 * 86400e3))) run++; else break; }
  if (run >= 4) give("weeks4");
  await save(env, h, d);
  ctx.waitUntil(logUse(env, "quest", { [honor ? "honor" : "done"]: 1 }, 0, h).catch(() => {}));
  return { ...(await view(env, d)), result: { ...verdict, pts, badges: got } };
}

// GET: 인증 사진·지도·장소 사진
export async function questGet(req, env, url) {
  if (url.pathname === "/quest/img") {
    const k = url.searchParams.get("k") || "";
    if (!/^quest\/[0-9a-f]{12}\/[\w.-]+\.jpg$/.test(k) || url.searchParams.get("s") !== (await hmac16(env, k))) return new Response("forbidden", { status: 403 });
    const o = await env.R2.get(k);
    if (!o) return new Response("not found", { status: 404 });
    return new Response(o.body, { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=31536000" } });
  }
  if (url.pathname === "/quest/map") {
    if (!env.DIDI) return new Response("no map", { status: 404 });
    const r = await env.DIDI.fetch("https://didi/api/map?loc=" + encodeURIComponent(url.searchParams.get("loc") || "") + "&s=" + encodeURIComponent(url.searchParams.get("s") || "") + "&big=1&z=14");
    return new Response(r.body, { status: r.status, headers: { "content-type": r.headers.get("content-type") || "image/png", "cache-control": "public, max-age=2592000" } });
  }
  if (url.pathname === "/quest/photo") {
    let u;
    try { u = new URL(url.searchParams.get("u") || ""); } catch { return new Response("bad", { status: 400 }); }
    if (!/(^|\.)(autonavi\.com|amap\.com|alicdn\.com)$/.test(u.hostname)) return new Response("forbidden", { status: 403 });
    const cache = caches.default, ck = new Request("https://quest-photo.cache/" + encodeURIComponent(u.toString()));
    const hit = await cache.match(ck);
    if (hit) return hit;
    const r = await fetch(u.toString());
    if (!r.ok) return new Response("not found", { status: 404 });
    const res = new Response(r.body, { headers: { "content-type": r.headers.get("content-type") || "image/jpeg", "cache-control": "public, max-age=2592000" } });
    await cache.put(ck, res.clone());
    return res;
  }
  return new Response("not found", { status: 404 });
}

export const QUEST_HTML = String.raw`<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#1664B0">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="주말 탐험">
<link rel="apple-touch-icon" href="/icon-180.png">
<title>주말 탐험</title>
<style>
:root{--sky:#1664B0;--bg:#EFE8DE;--card:#F7F2EA;--ink:#1A2330;--ink2:#5E6672;--line:#D9CEBD;--red:#D21624;--soft:#E6DCCB;--ok:#1F7A4D}
@media (prefers-color-scheme:dark){:root{--bg:#141A22;--card:#1C2430;--ink:#EDE6DA;--ink2:#9AA3AE;--line:#2C3644;--soft:#253041;--ok:#5CC08C}}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,"Apple SD Gothic Neo","PingFang SC",system-ui,sans-serif;-webkit-text-size-adjust:100%}
header{background:var(--sky);color:#fff;padding:calc(env(safe-area-inset-top) + 14px) 16px 14px;border-bottom:3px solid var(--red);display:flex;align-items:center;gap:12px}
header h1{margin:0;font-size:19px}header .pt{margin-left:auto;text-align:right;font-size:12px;opacity:.9}header .pt b{display:block;font-size:22px;line-height:1.1;font-variant-numeric:tabular-nums}
main{max-width:640px;margin:0 auto;padding:14px 16px 48px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:12px}
.lbl{font-size:12.5px;color:var(--ink2);margin:0 0 6px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
.chip{border:1px solid var(--line);background:transparent;color:var(--ink);border-radius:999px;padding:6px 12px;font:inherit;font-size:13.5px}
.chip.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.big{display:block;width:100%;border:0;border-radius:12px;background:var(--sky);color:#fff;font:inherit;font-weight:700;font-size:16px;padding:14px;margin-top:4px}
.big:disabled{opacity:.55}.ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}
.wx{font-size:13.5px;color:var(--ink2);margin:0 0 4px}.intro{font-weight:600;margin:0 0 4px}
.q{padding:0;overflow:hidden}.q .hd{padding:12px 14px 0;display:flex;gap:10px;align-items:flex-start}
.q .n{flex:0 0 30px;height:30px;border-radius:50%;background:var(--sky);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800}
.q.done .n{background:var(--ok)}
.q h2{margin:0;font-size:16.5px;line-height:1.35}.q .pl{font-size:13px;color:var(--ink2)}.q .pl b{color:var(--ink);font-weight:600}
.q .pts{margin-left:auto;font-weight:800;color:var(--red);white-space:nowrap}
.q .imgs{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin:10px 0 0}.q .imgs img{width:100%;height:120px;object-fit:cover;display:block;background:var(--soft)}
.q .imgs.one{grid-template-columns:1fr}
.q .body{padding:10px 14px 14px}
.ms{background:var(--soft);border-radius:10px;padding:10px 12px;margin:0 0 8px}.ms b{display:block;font-size:12px;color:var(--ink2);font-weight:600}
.why{font-size:13.5px;color:var(--ink2);margin:0 0 8px}
.ph{display:flex;gap:8px;align-items:center;font-size:14px;margin:0 0 10px;padding:8px 10px;border:1px dashed var(--line);border-radius:10px}
.ph .z{font-size:17px}.ph .p{font-size:12px;color:var(--ink2)}.ph button{margin-left:auto;border:0;background:transparent;font-size:20px}
.acts{display:grid;grid-template-columns:1fr 1fr;gap:6px}.acts a,.acts button,.acts label{display:flex;align-items:center;justify-content:center;gap:4px;border:1px solid var(--line);border-radius:10px;padding:10px 6px;font:inherit;font-size:14px;color:var(--ink);background:transparent;text-decoration:none;text-align:center}
.acts .cam{grid-column:1/-1;background:var(--sky);border-color:var(--sky);color:#fff;font-weight:700}.acts input{display:none}
.res{margin-top:8px;font-size:14px;padding:10px 12px;border-radius:10px}.res.ok{background:rgba(31,122,77,.12);color:var(--ok)}.res.no{background:rgba(210,22,36,.08);color:var(--red)}
.res .mini{display:flex;gap:6px;margin-top:8px}.res .mini button{flex:1;border:1px solid currentColor;background:transparent;color:inherit;border-radius:8px;padding:8px;font:inherit;font-size:13px}
.doneimg{width:100%;border-radius:10px;display:block;margin-bottom:8px}
.badges{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.bd{text-align:center;font-size:11.5px;color:var(--ink2)}.bd i{display:block;font-style:normal;font-size:28px;filter:grayscale(1);opacity:.3}.bd.on i{filter:none;opacity:1}.bd.on{color:var(--ink)}
.hist{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.hist figure{margin:0;font-size:11.5px;color:var(--ink2)}.hist img,.hist .noimg{width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;display:block;background:var(--soft)}
.hist .noimg{display:flex;align-items:center;justify-content:center;font-size:26px}
.wait{text-align:center;padding:30px 0;color:var(--ink2)}.spin{display:inline-block;animation:sp 1.2s linear infinite}@keyframes sp{to{transform:rotate(360deg)}}
.toast{position:fixed;left:50%;bottom:calc(20px + env(safe-area-inset-bottom));transform:translateX(-50%);background:var(--ink);color:var(--bg);padding:10px 16px;border-radius:999px;font-size:14px;z-index:9;max-width:90vw;text-align:center}
.err{color:var(--red);font-size:13.5px;margin-top:8px}
.gate{padding:40px 0;text-align:center}.gate input{font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:10px;width:220px;background:var(--card);color:var(--ink)}
a.back{color:#fff;text-decoration:none;font-size:20px}
</style></head><body>
<header><a class="back" href="/" aria-label="박비서">‹</a><h1>🧭 주말 탐험</h1><div class="pt"><b id="pts">0</b>점</div></header>
<main id="main"><div class="wait">불러오는 중…</div></main>
<script>
var CODE='';try{CODE=localStorage.getItem('pb-code')||'';}catch(e){}
var S=null,MOOD='mix',RAD=5000,WHO='duo',BUSY=false;try{MOOD=localStorage.getItem('qs-mood')||'mix';RAD=+(localStorage.getItem('qs-rad')||5000);WHO=localStorage.getItem('qs-who')||'duo';}catch(e){}
var CATN={nature:'자연',food:'맛집',culture:'문화',street:'골목'},CATI={nature:'🌳',food:'🥟',culture:'🏛',street:'🏮'};
function $(id){return document.getElementById(id);}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function toast(t){var d=document.createElement('div');d.className='toast';d.textContent=t;document.body.appendChild(d);setTimeout(function(){d.remove();},2600);}
function api(path,body){body=body||{};body.code=CODE;return fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json();});}
function gate(msg){$('main').innerHTML='<div class="gate"><p>'+esc(msg||'초대 코드를 넣어 주세요')+'</p><input id="cd" type="password" placeholder="초대 코드"> <button class="chip on" id="go">열기</button></div>';
  $('go').onclick=function(){CODE=$('cd').value.trim();try{localStorage.setItem('pb-code',CODE);}catch(e){}load();};}
function load(){if(!CODE)return gate();api('/quest/state').then(function(j){if(j.error==='not_allowed')return gate('초대 코드가 맞지 않아요');if(!j.ok)return gate(j.detail||j.error||'불러오지 못했어요');S=j;render();}).catch(function(){gate('서버에 연결하지 못했어요');});}
function kmT(m){return m<1000?m+'m':(m/1000).toFixed(1)+'km';}
function pickHtml(fresh){
  var h='<div class="card"><p class="lbl">누구랑</p><div class="chips">'+[['duo','👫 둘이'],['solo','🚶 혼자']].map(function(w){return '<button class="chip'+(w[0]===WHO?' on':'')+'" data-who="'+w[0]+'">'+w[1]+'</button>';}).join('')+'</div><p class="lbl">오늘 기분</p><div class="chips">';
  for(var k in S.moods)h+='<button class="chip'+(k===MOOD?' on':'')+'" data-mood="'+k+'">'+esc(S.moods[k])+'</button>';
  h+='</div><p class="lbl">얼마나 멀리</p><div class="chips">';
  [[3000,'3km'],[5000,'5km'],[10000,'10km'],[20000,'20km']].forEach(function(r){h+='<button class="chip'+(r[0]===RAD?' on':'')+'" data-rad="'+r[0]+'">'+r[1]+'</button>';});
  h+='</div><button class="big" id="gen">📍 '+(fresh?'오늘의 퀘스트 받기':'새 퀘스트 받기')+'</button><div class="err" id="gerr"></div></div>';
  return h;
}
function qHtml(q,i){
  var p=q.poi,h='<div class="card q'+(q.done?' done':'')+'" id="'+q.qid+'"><div class="hd"><div class="n">'+(q.done?'✓':(i+1))+'</div><div><h2>'+esc(q.title)+'</h2>'
   +'<div class="pl"><b>'+esc(p.name)+'</b> · '+esc(p.area||'')+' · '+kmT(p.dist)+(p.rating?' · ★'+p.rating:'')+(p.cost?' · ¥'+Math.round(p.cost):'')+' · '+(CATI[q.cat]||'')+esc(CATN[q.cat]||'')+'</div></div><div class="pts">+'+(q.done?q.got:q.pts)+'</div></div>';
  if(q.done&&q.imgUrl)h+='<div class="body"><img class="doneimg" src="'+esc(q.imgUrl)+'" alt="" onerror="this.style.display=\'none\'"><div class="res ok">'+esc(q.comment||'완료!')+'</div></div></div>';
  else if(q.done)h+='<div class="body"><div class="res ok">'+esc(q.comment||'완료!')+'</div></div></div>';
  else{
    var imgs=[];if(p.photo)imgs.push(p.photo);if(p.ms)imgs.push('/quest/map?loc='+encodeURIComponent(p.loc)+'&s='+p.ms);
    if(imgs.length)h+='<div class="imgs'+(imgs.length===1?' one':'')+'">'+imgs.map(function(u){return '<img loading="lazy" src="'+esc(u)+'" alt="" onerror="this.style.display=\'none\'">';}).join('')+'</div>';
    h+='<div class="body"><div class="ms"><b>📸 사진 미션</b>'+esc(q.mission)+'</div>'+(q.why?'<p class="why">'+esc(q.why)+'</p>':'');
    if(q.phrase)h+='<div class="ph"><div><div class="z">'+esc(q.phrase.z)+'</div><div class="p">'+esc(q.phrase.p)+' · '+esc(q.phrase.k)+'</div></div><button data-say="'+esc(q.phrase.z)+'" aria-label="듣기">🔊</button></div>';
    var lng=p.loc.split(',')[0],lat=p.loc.split(',')[1];
    h+='<div class="acts"><a href="https://uri.amap.com/navigation?to='+lng+','+lat+','+encodeURIComponent(p.name)+'&mode=car&coordinate=gaode&callnative=1">🗺 高德 길찾기</a>'
     +'<button data-copy="'+esc(p.name)+'">🚕 이름 복사(디디)</button>'
     +'<label class="cam">📸 사진으로 인증하기<input type="file" accept="image/*" capture="environment" data-q="'+q.qid+'"></label></div><div id="r-'+q.qid+'"></div></div></div>';
  }
  return h;
}
function render(){
  $('pts').textContent=S.pts||0;
  var c=S.cur,today=S.today,h='';
  var live=c&&c.date===today,allDone=live&&c.items.every(function(x){return x.done;});
  if(!live)h+=pickHtml(true);
  if(live){
    h+='<div class="card"><p class="wx">'+esc(c.wxText||'')+'</p><p class="intro">'+esc(c.intro||'오늘의 퀘스트')+'</p><p class="lbl" style="margin:0">'+c.items.filter(function(x){return x.done;}).length+' / '+c.items.length+' 완료</p></div>';
    c.items.forEach(function(q,i){h+=qHtml(q,i);});
    h+=allDone?'<div class="card" style="text-align:center"><b>🏆 오늘 퀘스트 올클리어!</b></div>'+pickHtml(false):'<details class="card"><summary>다른 퀘스트로 바꾸기</summary>'+pickHtml(false)+'</details>';
  }
  // 배지
  var have={};(S.badges||[]).forEach(function(b){have[b.k]=b.at;});
  h+='<div class="card"><p class="lbl">배지 '+Object.keys(have).length+' / '+S.all.length+'</p><div class="badges">'+S.all.map(function(b){return '<div class="bd'+(have[b.k]?' on':'')+'" title="'+esc(b.desc)+'"><i>'+b.icon+'</i>'+esc(b.name)+'</div>';}).join('')+'</div></div>';
  if(S.hist&&S.hist.length){h+='<div class="card"><p class="lbl">탐험 기록 '+S.hist.length+'곳</p><div class="hist">'+S.hist.map(function(x){return '<figure>'+(x.imgUrl?'<img loading="lazy" src="'+esc(x.imgUrl)+'" alt="" onerror="this.style.visibility=\'hidden\'">':'<div class="noimg">'+(CATI[x.cat]||'📍')+'</div>')+esc(x.name)+'<br>'+esc(x.date.slice(5))+' · +'+x.pts+'</figure>';}).join('')+'</div></div>';}
  $('main').innerHTML=h;bind();
}
function bind(){
  document.querySelectorAll('[data-mood]').forEach(function(b){b.onclick=function(){MOOD=b.getAttribute('data-mood');try{localStorage.setItem('qs-mood',MOOD);}catch(e){}document.querySelectorAll('[data-mood]').forEach(function(x){x.classList.toggle('on',x===b||x.getAttribute('data-mood')===MOOD);});};});
  document.querySelectorAll('[data-who]').forEach(function(b){b.onclick=function(){WHO=b.getAttribute('data-who');try{localStorage.setItem('qs-who',WHO);}catch(e){}document.querySelectorAll('[data-who]').forEach(function(x){x.classList.toggle('on',x.getAttribute('data-who')===WHO);});};});
  document.querySelectorAll('[data-rad]').forEach(function(b){b.onclick=function(){RAD=+b.getAttribute('data-rad');try{localStorage.setItem('qs-rad',RAD);}catch(e){}document.querySelectorAll('[data-rad]').forEach(function(x){x.classList.toggle('on',+x.getAttribute('data-rad')===RAD);});};});
  document.querySelectorAll('#gen').forEach(function(b){b.onclick=gen;});
  document.querySelectorAll('[data-say]').forEach(function(b){b.onclick=function(){try{var u=new SpeechSynthesisUtterance(b.getAttribute('data-say'));u.lang='zh-CN';u.rate=.85;speechSynthesis.cancel();speechSynthesis.speak(u);}catch(e){}};});
  document.querySelectorAll('[data-copy]').forEach(function(b){b.onclick=function(){var t=b.getAttribute('data-copy');(navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(function(){toast('복사됨 · 디디 목적지에 붙여넣기');},function(){prompt('복사해 주세요',t);});};});
  document.querySelectorAll('input[data-q]').forEach(function(inp){inp.onchange=function(){if(inp.files&&inp.files[0])shoot(inp.getAttribute('data-q'),inp.files[0]);inp.value='';};});
}
function gen(){
  if(BUSY)return;var btns=document.querySelectorAll('#gen'),er=document.querySelectorAll('#gerr');
  if(!navigator.geolocation){er.forEach(function(e){e.textContent='이 기기에서 위치를 쓸 수 없어요';});return;}
  BUSY=true;btns.forEach(function(b){b.disabled=true;b.innerHTML='<span class="spin">🧭</span> 위치 확인 중…';});
  navigator.geolocation.getCurrentPosition(function(pos){
    btns.forEach(function(b){b.innerHTML='<span class="spin">🧭</span> 주변을 둘러보는 중… (10초쯤)';});
    var g=pos.coords.longitude.toFixed(6)+','+pos.coords.latitude.toFixed(6);
    api('/quest/new',{gps:g,radius:RAD,mood:MOOD,who:WHO}).then(function(j){BUSY=false;if(!j.ok){btns.forEach(function(b){b.disabled=false;b.textContent='📍 다시 받기';});er.forEach(function(e){e.textContent=j.detail||j.error||'실패';});return;}S=j;render();window.scrollTo(0,0);})
    .catch(function(){BUSY=false;btns.forEach(function(b){b.disabled=false;b.textContent='📍 다시 받기';});er.forEach(function(e){e.textContent='서버 연결 실패';});});
  },function(){BUSY=false;btns.forEach(function(b){b.disabled=false;b.textContent='📍 다시 받기';});er.forEach(function(e){e.textContent='위치 권한을 허용해 주세요 (설정 → Safari → 위치)';});},{enableHighAccuracy:true,timeout:15000,maximumAge:60000});
}
function shrink(file){return new Promise(function(ok,no){var u=URL.createObjectURL(file),im=new Image();im.onload=function(){var M=1280,w=im.naturalWidth,h=im.naturalHeight,s=Math.min(1,M/Math.max(w,h));var c=document.createElement('canvas');c.width=Math.round(w*s);c.height=Math.round(h*s);c.getContext('2d').drawImage(im,0,0,c.width,c.height);URL.revokeObjectURL(u);ok(c.toDataURL('image/jpeg',.82));};im.onerror=function(){no();};im.src=u;});}
var LAST={};
function shoot(qid,file){
  var box=$('r-'+qid);box.innerHTML='<div class="res"><span class="spin">🔍</span> 사진 확인 중…</div>';
  shrink(file).then(function(d){LAST[qid]=d;return api('/quest/check',{qid:qid,image:d});}).then(function(j){showRes(qid,j);}).catch(function(){box.innerHTML='<div class="res no">사진을 보내지 못했어요. 다시 찍어 주세요.</div>';});
}
function showRes(qid,j){
  var box=$('r-'+qid);
  if(!j.ok){box.innerHTML='<div class="res no">'+esc(j.detail||j.error||'실패')+'</div>';return;}
  var r=j.result||{};
  if(r.ok){S=j;var msg='+'+r.pts+'점!';if(r.badges&&r.badges.length){var nm=S.all.filter(function(b){return r.badges.indexOf(b.k)>=0;}).map(function(b){return b.icon+' '+b.name;}).join(', ');msg+=' 새 배지: '+nm;}toast(msg);render();var el=$(qid);if(el)el.scrollIntoView({behavior:'smooth',block:'center'});return;}
  box.innerHTML='<div class="res no">'+esc(r.comment||'미션과 조금 달라요')+'<div class="mini"><button data-re="'+qid+'">📸 다시 찍기</button><button data-honor="'+qid+'">그래도 인정 (점수 절반)</button></div></div>';
  box.querySelector('[data-re]').onclick=function(){var i=document.querySelector('input[data-q="'+qid+'"]');if(i)i.click();};
  box.querySelector('[data-honor]').onclick=function(){box.innerHTML='<div class="res">저장 중…</div>';api('/quest/honor',{qid:qid,image:LAST[qid]||''}).then(function(j2){showRes(qid,j2);});};
}
load();
</script></body></html>`;
