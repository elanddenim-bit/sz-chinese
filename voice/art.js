// =========================================================
// 🖼 명화 한 점 — 시카고 미술관(AIC)·클리블랜드 미술관(CMA, CC0) 공개 API 의 퍼블릭 도메인 그림을 한 점씩 화면 가득 + 千问 한국어 3줄 해설
//  GET /art              화면(초대 코드 없음 — 저장 없음, 좋아요·본 그림은 기기 localStorage)
//  GET /art/next         {id, title, artist, date, medium, place, img, w, h} 무작위 그림 한 점(그림만, 이미지 있는 것)
//  GET /art/note?id      {ko:{title, artist, lines[3], look}} 해설 — KV art:n:<id> 에 영구 캐시(같은 그림은 한 번만 생성), 하루 생성 ART_DAY_MAX(기본 200)
//  GET /art/today        오늘의 그림(날짜마다 모두 같은 그림) {d, today, ready, art, ko, script} · /art/week 최근 14일 · /art/d?d 1분 도슨트 음성(Cherry)
//  GET /art/img?i&w      그림 파일 중계(IIIF, Cloudflare 캐시 30일) — 해외 미술관 서버가 중국에서 느려서 캐시만 함(지역 제한 우회 아님)
// 소유자 2026-10-20 '스트레스 풀 때 — 명화 한 점, 1분 감상'. 액자 모드(3·10·30분 자동 넘김, 화면 켜짐 유지)
// [필수] AI 는 百炼(千问)만 — Anthropic 호출 없음
// =========================================================
import { logUse } from "./usage.js";

const host = (env) => (env.DASHSCOPE_WS_HOST || "dashscope.aliyuncs.com").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
const cnDay = (t = Date.now()) => new Date(t + 8 * 3600e3).toISOString().slice(0, 10);
const AIC = "https://api.artic.edu/api/v1";
const UA = { "AIC-User-Agent": "zhnote-art (personal viewer)", accept: "application/json" };
const FIELDS = "id,title,artist_display,artist_title,date_display,medium_display,place_of_origin,image_id,thumbnail,short_description,description,style_title,department_title";
const json = (o, status = 200, cache = "no-store") => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache } });
const strip = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function pick(a) {
  return { id: a.id, title: String(a.title || "").slice(0, 160), artist: String(a.artist_title || strip(a.artist_display).split("\n")[0] || "").slice(0, 120),
    artistFull: strip(a.artist_display).slice(0, 160), date: String(a.date_display || "").slice(0, 60), medium: String(a.medium_display || "").slice(0, 120),
    place: String(a.place_of_origin || "").slice(0, 60), img: a.image_id, w: (a.thumbnail && a.thumbnail.width) || 0, h: (a.thumbnail && a.thumbnail.height) || 0 };
}

// 클리블랜드 미술관 Open Access(CC0, 키 없음) — 시카고 미술관이 막히면(Worker 요청 거부 등) 여기서
const CMA = "https://openaccess-api.clevelandart.org/api/artworks/";
function pickCma(a) {
  const web = a.images && a.images.web && a.images.web.url || "";
  const m = web.match(/^https:\/\/openaccess-cdn\.clevelandart\.org\/([A-Za-z0-9._\-\/]+_web\.jpg)$/);
  if (!m) return null;
  const cr = (a.creators || [])[0] || {};
  return { id: "c" + a.id, title: String(a.title || "").slice(0, 160), artist: String((cr.description || "").split("(")[0] || "").trim().slice(0, 120),
    artistFull: String(cr.description || "").slice(0, 160), date: String(a.creation_date || "").slice(0, 60), medium: String(a.technique || "").slice(0, 120),
    place: String((a.culture || [])[0] || "").slice(0, 60), img: "c:" + m[1], w: (a.images.web.width | 0), h: (a.images.web.height | 0) };
}
async function nextCma(env, errs) {
  let total = Number(await env.KV.get("art:ctot")) || 0;
  for (let t = 0; t < 3; t++) {
    const skip = Math.floor(Math.random() * Math.max(1, total || 2000));
    const r = await fetch(CMA + "?cc0&has_image=1&type=Painting&limit=1&skip=" + skip, { headers: { accept: "application/json", "user-agent": "zhnote-art/1.0 (personal viewer)" } }).catch((e) => { errs.push("cma " + (e.message || e)); return null; });
    if (!r) continue;
    if (!r.ok) { errs.push("cma " + r.status); if (r.status >= 400 && r.status < 500 && total) { total = 0; } continue; }
    const j = await r.json().catch(() => ({}));
    const tt = j.info && j.info.total;
    if (tt && tt !== total) { total = tt; await env.KV.put("art:ctot", String(tt), { expirationTtl: 7 * 86400 }); }
    const a = j.data && j.data[0] && pickCma(j.data[0]);
    if (a) return a;
    errs.push("cma empty");
  }
  return null;
}
async function next(env) {
  const errs = [];
  const aicBad = await env.KV.get("art:bad:aic");
  if (Math.random() < 0.5 || aicBad) { const c = await nextCma(env, errs); if (c) return c; }
  const a = aicBad ? null : await nextAic(env, errs);
  if (a) return a;
  if (!aicBad && errs.length) await env.KV.put("art:bad:aic", "1", { expirationTtl: 3600 }); // 한 시간은 클리블랜드만
  const c = await nextCma(env, errs);
  if (c) return c;
  throw new Error("미술관 서버에서 그림을 못 받았어요 (" + errs.slice(-4).join(", ") + ")");
}
async function nextAic(env, errs) {
  // 퍼블릭 도메인 + 회화(Painting) + 이미지 있는 것 중 무작위 쪽. 검색 결과는 1000번째까지만 넘길 수 있음
  const q = { query: { bool: { must: [{ term: { is_public_domain: true } }, { term: { artwork_type_id: 1 } }, { exists: { field: "image_id" } }] } } };
  let total = Number(await env.KV.get("art:total")) || 0;
  for (let t = 0; t < 3; t++) {
    const page = 1 + Math.floor(Math.random() * Math.max(1, Math.min(total || 1000, 1000)));
    const u = AIC + "/artworks/search?limit=1&page=" + page + "&fields=" + FIELDS;
    let r = await fetch(u + "&params=" + encodeURIComponent(JSON.stringify(q)), { headers: UA }).catch((e) => { errs.push("aic " + (e.message || e)); return null; });
    if (r && !r.ok) { errs.push("aic " + r.status); r = await fetch(u, { method: "POST", headers: { ...UA, "content-type": "application/json" }, body: JSON.stringify(q) }).catch(() => null); }
    if (!r || !r.ok) { if (r) errs.push("aic post " + r.status); if (r && r.status === 403) return null; continue; }
    const j = await r.json().catch(() => ({}));
    if (j.pagination && j.pagination.total && j.pagination.total !== total) { total = j.pagination.total; await env.KV.put("art:total", String(total), { expirationTtl: 7 * 86400 }); }
    const a = j.data && j.data[0];
    if (a && a.image_id) return pick(a);
  }
  return null;
}

async function getInfo(id) {
  if (String(id)[0] === "c") {
    const r = await fetch(CMA + String(id).slice(1), { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error("그림 정보를 못 받았어요 " + r.status);
    const a = ((await r.json()) || {}).data || {};
    return { title: a.title, artist: ((a.creators || [])[0] || {}).description, date: a.creation_date, medium: a.technique, place: (a.culture || []).join(", "), dept: a.department,
      about: strip([a.description, a.did_you_know, a.wall_description].filter(Boolean).join(" ")).slice(0, 1800), museum: "Cleveland Museum of Art" };
  }
  const r = await fetch(AIC + "/artworks/" + id + "?fields=" + FIELDS, { headers: UA });
  if (!r.ok) throw new Error("그림 정보를 못 받았어요 " + r.status);
  const a = ((await r.json()) || {}).data || {};
  return { title: a.title, artist: strip(a.artist_display), date: a.date_display, medium: a.medium_display, place: a.place_of_origin, style: a.style_title, dept: a.department_title,
    about: strip(a.description || a.short_description).slice(0, 1800), museum: "Art Institute of Chicago" };
}
// 千问 JSON 한 번(모델 순서대로 시도)
async function qwenJson(env, sys, user, temp = 0.5) {
  let last = "";
  for (const model of [env.ART_MODEL, env.QUEST_MODEL || "qwen3.8-flash", "qwen-plus"].filter(Boolean)) {
    try {
      const q = await fetch("https://" + host(env) + "/compatible-mode/v1/chat/completions", {
        method: "POST", headers: { authorization: "Bearer " + env.DASHSCOPE_API_KEY, "content-type": "application/json" },
        body: JSON.stringify({ model, temperature: temp, enable_thinking: false, response_format: { type: "json_object" }, messages: [{ role: "system", content: sys }, { role: "user", content: user }] }),
      });
      if (!q.ok) { last = model + " " + q.status; continue; }
      const c = String(((await q.json()).choices || [{}])[0].message.content || "");
      return JSON.parse(c.slice(c.indexOf("{"), c.lastIndexOf("}") + 1));
    } catch (e) { last = model + ": " + String(e.message || e).slice(0, 80); }
  }
  throw new Error("AI 응답 없음(" + last + ")");
}
const NOTE_SYS = "너는 미술관 도슨트다. 지친 직장인이 1분 동안 그림 한 점을 보며 쉬도록 한국어로 짧게 안내한다. 미술사 강의 말고, 다정하고 담백한 구어체(~예요/~죠). " +
  "주어진 정보에 없는 사실(연도·사연·소장 경위)은 지어내지 마라. 작가가 유명하면 널리 알려진 사실 한 가지 정도는 괜찮다. " +
  'JSON 만: {"title":"한국어 제목(원제 뜻)","artist":"작가 한국어 표기 · 나라 · 생몰년(정보에 있으면)","lines":["무엇을 그렸는지 1문장","언제·어떤 배경에서 1문장","재미있는 점 1문장"],"look":"지금 그림에서 어디를 보면 좋은지 한 문장(예: 오른쪽 아래 물결에 비친 빛을 보세요)"}';

async function note(env, id, info) {
  const k = "art:n:" + id;
  const hit = await env.KV.get(k, "json");
  if (hit) return hit;
  const dk = "art:day:" + cnDay(), used = Number(await env.KV.get(dk)) || 0;
  if (used >= (Number(env.ART_DAY_MAX) || 200)) throw new Error("오늘 해설은 다 썼어요. 내일 다시.");
  info = info || await getInfo(id);
  await env.KV.put(dk, String(used + 1), { expirationTtl: 3 * 86400 });
  const o = await qwenJson(env, NOTE_SYS, JSON.stringify(info));
  const out = { ko: { title: String(o.title || "").slice(0, 80), artist: String(o.artist || "").slice(0, 80), lines: (Array.isArray(o.lines) ? o.lines : []).map((x) => String(x).slice(0, 160)).slice(0, 3), look: String(o.look || "").slice(0, 160) } };
  if (!out.ko.lines.length) throw new Error("해설을 못 만들었어요(빈 해설)");
  await env.KV.put(k, JSON.stringify(out));
  return out;
}

// ── 🗓 오늘의 그림(2026-10-20 공개용): 날짜마다 모두 같은 그림 한 점 + 1분 오디오 도슨트(AI 기본 목소리 Cherry)
//   KV art:today:<날짜> {d, art, ko, script, at} (영구 — 지난 그림 모아 보기에 씀), 잠금 art:tlock:<날짜> 120초
//   중국 06시 크론(artCron)이 미리 만들고, 없으면 첫 방문이 만듦(그동안은 어제 그림)
const SCRIPT_SYS = "너는 미술관 오디오 도슨트다. 한 사람이 휴대폰으로 그림을 보며 이어폰으로 1분 동안 듣는 대본을 쓴다. 한국어 구어체(~예요/~죠), 270~330자. " +
  "순서: 가볍게 인사하고 그림 이름 → 먼저 전체를 보게 하고 → 눈을 옮길 곳 두 군데를 위치(왼쪽 위, 가운데 아래 등)로 짚어 주고 → 그린 배경 한두 문장 → 숨 한 번 쉬고 끝맺는 한 문장. " +
  "주어진 정보·해설에 없는 사실은 지어내지 마라. 연도 숫자는 그대로, 영어·한자 이름은 한글 표기로. 이모지·괄호 금지. " +
  'JSON 만: {"script":"대본"}';
async function buildToday(env, d) {
  const lk = "art:tlock:" + d;
  if (await env.KV.get(lk)) return null;
  await env.KV.put(lk, "1", { expirationTtl: 120 });
  try {
    const seen = (await env.KV.get("art:thist", "json")) || [];
    let art = null, info = null;
    for (let t = 0; t < 4 && !art; t++) {
      const a = await next(env);
      if (seen.includes(a.id)) continue;
      const i = await getInfo(a.id).catch(() => null);
      if (!i) continue;
      if (!art || (i.about || "").length > 120) { art = a; info = i; }
      if ((i.about || "").length > 120) break; // 설명이 있는 그림을 우선(대본이 덜 비어 보이게)
    }
    if (!art) throw new Error("그림을 못 골랐어요");
    const n = await note(env, art.id, info);
    let script = "";
    try { script = String((await qwenJson(env, SCRIPT_SYS, JSON.stringify({ info, note: n.ko }), 0.6)).script || "").replace(/\s+/g, " ").trim().slice(0, 420); } catch { script = ""; }
    if (!script) script = [n.ko.title + ".", ...n.ko.lines, n.ko.look].join(" ");
    const doc = { d, art, ko: n.ko, script, at: Date.now() };
    await env.KV.put("art:today:" + d, JSON.stringify(doc));
    await env.KV.put("art:thist", JSON.stringify([art.id, ...seen].slice(0, 120)));
    return doc;
  } finally { await env.KV.delete(lk).catch(() => {}); }
}
const prevDay = (d, n = 1) => new Date(Date.parse(d + "T00:00:00Z") - n * 86400e3).toISOString().slice(0, 10);
async function today(env, ctx) {
  const d = cnDay();
  const doc = await env.KV.get("art:today:" + d, "json");
  if (doc) return { ...doc, today: d, ready: true };
  // 지난 그림이 하나도 없으면(처음) 기다려서 만들고, 있으면 어제 것을 보여 주고 뒤에서 만듦
  let old = null;
  for (let i = 1; i <= 3 && !old; i++) old = await env.KV.get("art:today:" + prevDay(d, i), "json");
  if (!old) { const x = await buildToday(env, d); if (x) return { ...x, today: d, ready: true }; throw new Error("오늘의 그림을 준비 중이에요. 잠시 뒤 다시."); }
  ctx.waitUntil(buildToday(env, d).then((x) => x && docent(env, d)).catch((e) => console.log("art today", e && e.message)));
  return { ...old, today: d, ready: false };
}
// 음성이 아직 없으면 바로 202 {pending} 를 돌려주고 뒤에서 만듦(화면은 3초마다 다시 물음). 실패 이유는 KV art:verr:<k> 10분
async function voiceLater(env, ctx, k, make) {
  const ek = "art:verr:" + k, err = await env.KV.get(ek);
  if (err) return json({ error: err }, 503);
  const rk = "art:vrun:" + k;
  if (!(await env.KV.get(rk))) {
    await env.KV.put(rk, "1", { expirationTtl: 75 });
    ctx.waitUntil(make().catch((e) => { const m = String(e.message || e).slice(0, 200); return /만드는 중/.test(m) ? null : env.KV.put(ek, m, { expirationTtl: 600 }); }).finally(() => env.KV.delete(rk).catch(() => {})));
  }
  return json({ pending: true }, 202);
}
export async function artCron(env, ctx, uh, um) {
  if (uh !== 22 || um >= 15 || !env.DASHSCOPE_API_KEY) return; // 중국 06시
  const d = cnDay(Date.now() + 3600e3); // 06시 틱이면 이미 그날
  if (!(await env.KV.get("art:today:" + d))) await buildToday(env, d);
  if (!(await env.R2.head("tts/art/day/" + d + ".wav"))) await docent(env, d).catch((e) => console.log("art docent", e && e.message)); // 아침에 미리 — 누르면 바로 재생
}
async function week(env) {
  const d = cnDay(), keys = Array.from({ length: 14 }, (_, i) => prevDay(d, i));
  const docs = await Promise.all(keys.map((k) => env.KV.get("art:today:" + k, "json").catch(() => null)));
  return { items: docs.filter(Boolean).map((x) => ({ d: x.d, art: x.art, ko: x.ko, script: x.script })) };
}
// qwen-tts 한국어: 짧게 나눠(≤170자) 모델 두 가지·언어 지정 있이/없이 순서로(2026-10-16 qwen3-tts-flash 400 빈 응답 사례) → wav 이어 붙임
function splitText(t, n = 170) {
  const out = []; let cur = "";
  for (const s of String(t).match(/[^.!?。！？]+[.!?。！？]*\s*/g) || [String(t)]) {
    if ((cur + s).length > n && cur) { out.push(cur.trim()); cur = ""; }
    if (s.length > n) { for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n).trim()); } else cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}
function wavParts(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); let fmt = null, data = null;
  for (let o = 12; o + 8 <= u8.length;) { const id = String.fromCharCode(...u8.subarray(o, o + 4)); let sz = dv.getUint32(o + 4, true);
    if (id === "fmt ") fmt = u8.slice(o + 8, o + 8 + sz);
    if (id === "data") { if (!sz || o + 8 + sz > u8.length) sz = u8.length - o - 8; data = u8.subarray(o + 8, o + 8 + sz); break; }
    o += 8 + sz + (sz & 1); }
  if (!fmt || !data) throw new Error("wav 형식");
  return { fmt, data };
}
function wavJoin(list) {
  const ps = list.map(wavParts), fmt = ps[0].fmt, len = ps.reduce((a, p) => a + p.data.length, 0);
  const out = new Uint8Array(12 + 8 + fmt.length + 8 + len), dv = new DataView(out.buffer), w = (o, t) => { for (let i = 0; i < 4; i++) out[o + i] = t.charCodeAt(i); };
  w(0, "RIFF"); dv.setUint32(4, out.length - 8, true); w(8, "WAVE"); w(12, "fmt "); dv.setUint32(16, fmt.length, true); out.set(fmt, 20);
  let o = 20 + fmt.length; w(o, "data"); dv.setUint32(o + 4, len, true); o += 8;
  for (const p of ps) { out.set(p.data, o); o += p.data.length; }
  return out;
}
async function ttsOne(env, text, voice) {
  const why = [];
  // 업무공간 주소가 'url error'(400)로 TTS 를 거절하는 경우(2026-10-20 실사용) → 공용 주소로도 시도
  const hosts = [...new Set(["dashscope.aliyuncs.com", host(env)])]; // 공용 주소 먼저(업무공간 주소는 TTS 를 거절 — 2026-10-20 확인)
  for (const hh of hosts) for (const model of [env.SHORTS_TTS_MODEL || "qwen3-tts-flash", "qwen-audio-3.0-tts-flash"]) for (const lt of [true, false]) {
    if (hh !== hosts[0] && !lt) continue;
    try {
      const r = await fetch("https://" + hh + "/api/v1/services/aigc/multimodal-generation/generation", { method: "POST", headers: { authorization: "Bearer " + env.DASHSCOPE_API_KEY, "content-type": "application/json" },
        body: JSON.stringify({ model, input: { text, voice, ...(lt ? { language_type: "Korean" } : {}) } }) });
      const j = await r.json().catch(() => ({})), u = j.output && j.output.audio && j.output.audio.url;
      if (!u) { why.push((hh === "dashscope.aliyuncs.com" ? "" : "업무공간 ") + model + " " + r.status + " " + String(j.message || j.code || "").slice(0, 40)); continue; }
      const a = await fetch(u); if (!a.ok) { why.push(model + " 받기 " + a.status); continue; }
      return new Uint8Array(await a.arrayBuffer());
    } catch (e) { why.push(model + ": " + String(e.message || e).slice(0, 60)); }
  }
  throw new Error("음성 합성 실패 — " + why.slice(-4).join(" / "));
}
async function qwenTts(env, text, voice) {
  const parts = await Promise.all(splitText(text).map((t) => ttsOne(env, t, voice))); // 조각을 한꺼번에(차례로 하면 1분 넘음)
  return parts.length === 1 ? parts[0] : wavJoin(parts);
}

// 1분 도슨트 음성: qwen3-tts-flash Cherry(공개용 — 소유자 복제 목소리 아님) → R2 tts/art/day/<날짜>.wav, 날짜마다 한 번
// ▶ 해설 듣기(2026-10-20 소유자 '다음 그림엔 목소리가 없네'): 오늘의 그림이 아닌 그림도 3줄 해설을 AI 목소리(Cherry)로
//   R2 tts/art/ai/<id>.wav 그림마다 한 번, 새로 만드는 건 하루 ART_VOICE_DAY(기본 150)개까지(KV art:vday:<날짜>)
async function noteVoice(env, id) {
  const key = "tts/art/ai/" + id + ".wav";
  if (await env.R2.head(key)) return key;
  const n = await env.KV.get("art:n:" + id, "json");
  if (!n || !n.ko) throw new Error("해설을 먼저 열어 주세요");
  const dk = "art:vday:" + cnDay(), used = Number(await env.KV.get(dk)) || 0;
  if (used >= (Number(env.ART_VOICE_DAY) || 150)) throw new Error("오늘 만들 수 있는 해설 음성을 다 썼어요. 내일 다시.");
  const lk = "art:vlock:" + id;
  if (await env.KV.get(lk)) throw new Error("목소리 만드는 중이에요. 몇 초 뒤 다시 눌러 주세요.");
  await env.KV.put(lk, "1", { expirationTtl: 90 });
  try {
    const k = n.ko, text = [k.title + ".", k.artist ? k.artist.replace(/·/g, ",") + "." : "", ...(k.lines || []), k.look ? "지금 볼 곳. " + k.look : ""].filter(Boolean).join(" ").slice(0, 600);
    const audio = await qwenTts(env, text, env.ART_VOICE || "Cherry");
    await env.R2.put(key, audio, { httpMetadata: { contentType: "audio/wav" } });
    await env.KV.put(dk, String(used + 1), { expirationTtl: 3 * 86400 });
    return key;
  } finally { await env.KV.delete(lk).catch(() => {}); }
}
async function docent(env, d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error("날짜");
  const key = "tts/art/day/" + d + ".wav";
  if (await env.R2.head(key)) return key;
  const doc = await env.KV.get("art:today:" + d, "json");
  if (!doc) throw new Error("그날 그림이 없어요");
  const lk = "art:alock:" + d;
  if (await env.KV.get(lk)) throw new Error("목소리 만드는 중이에요. 몇 초 뒤 다시 눌러 주세요.");
  await env.KV.put(lk, "1", { expirationTtl: 90 });
  try {
    const audio = await qwenTts(env, doc.script.slice(0, 500), env.ART_VOICE || "Cherry");
    await env.R2.put(key, audio, { httpMetadata: { contentType: "audio/wav" } });
    return key;
  } finally { await env.KV.delete(lk).catch(() => {}); }
}

async function img(req, url, ctx) {
  const i = String(url.searchParams.get("i") || "");
  const w = Math.min(2400, Math.max(200, Math.round(Number(url.searchParams.get("w")) || 1686)));
  const cma = /^c:[A-Za-z0-9._\-\/]+_web\.jpg$/.test(i) && !i.includes("..");
  if (!cma && !/^[0-9a-f-]{36}$/.test(i)) return new Response("bad", { status: 400 });
  const big = cma && w > 900;
  const cache = caches.default, key = new Request("https://art-cache/" + encodeURIComponent(i) + "/" + (cma ? (big ? "print" : "web") : w));
  const hit = await cache.match(key);
  if (hit) return hit;
  let r;
  if (cma) {
    const base = "https://openaccess-cdn.clevelandart.org/" + i.slice(2);
    r = big ? await fetch(base.replace(/_web\.jpg$/, "_print.jpg")) : null;
    if (!r || !r.ok) r = await fetch(base);
  } else r = await fetch("https://www.artic.edu/iiif/2/" + i + "/full/" + w + ",/0/default.jpg", { headers: { "AIC-User-Agent": UA["AIC-User-Agent"] } });
  if (!r.ok) return new Response("image " + r.status, { status: 502 });
  const res = new Response(r.body, { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=2592000" } });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

// 🔊 해설을 내 목소리로(2026-10-20 소유자 요청): 박비서 초대 코드(pb-code)의 숏츠용 한국어 복제 목소리 voice:kr:<해시> → 없으면 qwen3-tts Ethan
async function hmac16(env, s) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode("art|" + (env.ALLOWED_CODES || "") + (env.DASHSCOPE_API_KEY || "")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(s)))].slice(0, 8).map((x) => x.toString(16).padStart(2, "0")).join("");
}
export async function artSay(env, b, h, synth) {
  const id = String(b.id || "");
  if (!/^c?\d{1,9}$/.test(id)) throw new Error("id");
  const n = await env.KV.get("art:n:" + id, "json");
  if (!n || !n.ko) throw new Error("해설을 먼저 열어 주세요");
  const k = n.ko, text = [k.title + ".", k.artist ? k.artist.replace(/·/g, ",") + "." : "", ...(k.lines || []), k.look ? "지금 볼 곳. " + k.look : ""].filter(Boolean).join(" ").slice(0, 600);
  const key = "tts/art/" + h + "/" + id;
  let ext = null;
  for (const e of [".mp3", ".wav"]) if (await env.R2.head(key + e)) { ext = e; break; }
  let mine = false;
  if (!ext) {
    const kr = await env.KV.get("voice:kr:" + h);
    let audio = null; ext = ".mp3";
    if (kr) { try { audio = await synth(env, kr, text, null, { language_hints: ["ko"], rate: 1.0, volume: 100 }); mine = true; } catch { audio = null; } }
    if (!audio) {
      audio = await qwenTts(env, text, "Ethan"); ext = ".wav";
    }
    await env.R2.put(key + ext, audio, { httpMetadata: { contentType: ext === ".mp3" ? "audio/mpeg" : "audio/wav" } });
  } else mine = ext === ".mp3";
  return { ok: true, mine, url: "/art/a?h=" + h + "&id=" + id + "&x=" + ext.slice(1) + "&s=" + (await hmac16(env, h + "|" + id)) };
}
export async function artGet(req, env, ctx, url) {
  const p = url.pathname;
  if (p === "/art" || p === "/art/") return new Response(ART_HTML, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
  if (p === "/art/img") return img(req, url, ctx);
  if (p === "/art/a") {
    const h = String(url.searchParams.get("h") || ""), id = String(url.searchParams.get("id") || ""), x = url.searchParams.get("x") === "wav" ? "wav" : "mp3";
    if (!/^[0-9a-f]{12}$/.test(h) || !/^c?\d{1,9}$/.test(id) || url.searchParams.get("s") !== (await hmac16(env, h + "|" + id))) return new Response("forbidden", { status: 403 });
    const o = await env.R2.get("tts/art/" + h + "/" + id + "." + x);
    if (!o) return new Response("not found", { status: 404 });
    return new Response(o.body, { headers: { "content-type": x === "mp3" ? "audio/mpeg" : "audio/wav", "cache-control": "private, max-age=86400" } });
  }
  if (p === "/art/v") { // 아무 그림이나 3줄 해설을 AI 목소리로(공개, 그림마다 한 번 만들어 R2 캐시)
    const id = String(url.searchParams.get("id") || "");
    if (!/^c?\d{1,9}$/.test(id)) return json({ error: "id" }, 400);
    const key = "tts/art/ai/" + id + ".wav";
    if (!(await env.R2.head(key))) return voiceLater(env, ctx, "v:" + id, () => noteVoice(env, id));
    const o = await env.R2.get(key);
    if (!o) return new Response("not found", { status: 404 });
    return new Response(o.body, { headers: { "content-type": "audio/wav", "cache-control": "public, max-age=86400", "content-length": String(o.size) } });
  }
  if (p === "/art/d") {
    const d = String(url.searchParams.get("d") || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return json({ error: "날짜" }, 400);
    if (!(await env.R2.head("tts/art/day/" + d + ".wav"))) return voiceLater(env, ctx, "d:" + d, () => docent(env, d));
    const o = await env.R2.get("tts/art/day/" + d + ".wav", { range: req.headers.has("range") ? req.headers : undefined });
    if (!o) return new Response("not found", { status: 404 });
    const hd = { "content-type": "audio/wav", "cache-control": "public, max-age=86400", "accept-ranges": "bytes" };
    if (o.range && req.headers.has("range")) { const st = o.range.offset || 0, ln = o.range.length != null ? o.range.length : o.size - st; hd["content-range"] = "bytes " + st + "-" + (st + ln - 1) + "/" + o.size; hd["content-length"] = String(ln); return new Response(o.body, { status: 206, headers: hd }); }
    hd["content-length"] = String(o.size);
    return new Response(o.body, { headers: hd });
  }
  try {
    if (p === "/art/today") { if (!env.DASHSCOPE_API_KEY) return json({ error: "AI 키 없음" }, 500); const t = await today(env, ctx); return json(t, 200, t.ready ? "public, max-age=300" : "no-store"); }
    if (p === "/art/week") return json(await week(env), 200, "public, max-age=300");
    if (p === "/art/next") { ctx.waitUntil(logUse(env, "art", { next: 1 }, 0).catch(() => {})); return json(await next(env)); }
    if (p === "/art/note") {
      const id = String(url.searchParams.get("id") || "");
      if (!/^c?\d{1,9}$/.test(id)) return json({ error: "id" }, 400);
      if (!env.DASHSCOPE_API_KEY) return json({ error: "AI 키 없음" }, 500);
      return json(await note(env, id), 200, "public, max-age=86400");
    }
  } catch (e) { return json({ error: String(e.message || e).slice(0, 200) }, 502); }
  return new Response("not found", { status: 404 });
}

export const ART_HTML = String.raw`<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0E0E10">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="명화 한 점">
<title>명화 한 점</title>
<style>
@font-face{font-family:Pre;src:url(/fonts/pretendard-400.woff2) format("woff2");font-weight:400;font-display:swap}
@font-face{font-family:Pre;src:url(/fonts/pretendard-700.woff2) format("woff2");font-weight:700;font-display:swap}
:root{--bg:#0E0E10;--ink:#EDE6DA;--ink2:#A7A29A;--sky:#1664B0;--red:#D21624;--sheet:rgba(20,20,24,.86)}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;height:100%;background:var(--bg);color:var(--ink);font:15.5px/1.6 Pre,-apple-system,"Apple SD Gothic Neo",system-ui,sans-serif;overflow:hidden}
#stage{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:calc(env(safe-area-inset-top) + 58px) 18px calc(env(safe-area-inset-bottom) + 86px)}
#pic{max-width:100%;max-height:100%;object-fit:contain;box-shadow:0 18px 60px rgba(0,0,0,.6);opacity:0;transform:scale(.985);transition:opacity 1.4s ease,transform 6s ease}
#pic.on{opacity:1;transform:scale(1)}
#cap{position:fixed;left:0;right:0;bottom:calc(env(safe-area-inset-bottom) + 18px);text-align:center;padding:0 80px;pointer-events:none}
#cap b{display:block;font-size:16px;letter-spacing:-.2px}#cap small{color:var(--ink2);font-size:12.5px}
.btn{position:fixed;bottom:calc(env(safe-area-inset-bottom) + 18px);width:52px;height:52px;border-radius:50%;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.07);color:var(--ink);font-size:20px;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
#bInfo{left:16px}#bNext{right:16px}
#top{position:fixed;top:calc(env(safe-area-inset-top) + 10px);right:12px;display:flex;gap:8px}
#top button{border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.07);color:var(--ink);border-radius:999px;padding:6px 12px;font:inherit;font-size:13px;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
#top button.on{background:var(--sky);border-color:var(--sky)}
#sheet{position:fixed;left:0;right:0;bottom:0;max-height:72vh;overflow:auto;background:var(--sheet);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border-radius:18px 18px 0 0;padding:20px 20px calc(env(safe-area-inset-bottom) + 24px);transform:translateY(105%);transition:transform .35s ease;z-index:5}
#sheet.on{transform:none}
#sheet h2{margin:0;font-size:20px;line-height:1.35}#sheet .en{color:var(--ink2);font-size:13px;margin-top:2px}
#sheet .who{margin:10px 0 0;font-size:14.5px}
#sheet ol{margin:14px 0 0;padding-left:20px}#sheet li{margin:6px 0}
#sheet .look{margin-top:14px;border-left:3px solid var(--red);padding:6px 0 6px 12px;font-size:15px}
#sheet .meta{margin-top:14px;color:var(--ink2);font-size:12.5px}
#sheet .row{display:flex;gap:8px;margin-top:16px;flex-wrap:wrap}
#sheet .row button{border:1px solid rgba(255,255,255,.2);background:transparent;color:var(--ink);border-radius:999px;padding:8px 14px;font:inherit;font-size:14px}
#breath{position:fixed;inset:0;display:none;align-items:center;justify-content:center;flex-direction:column;background:rgba(0,0,0,.35);z-index:4;pointer-events:none}
#breath.on{display:flex}
#breath i{width:120px;height:120px;border-radius:50%;border:2px solid rgba(255,255,255,.7);animation:br 10s ease-in-out infinite}
#breath span{margin-top:18px;font-size:16px;letter-spacing:.5px}
@keyframes br{0%,100%{transform:scale(.6);opacity:.5}40%,55%{transform:scale(1.15);opacity:1}}
.wait{color:var(--ink2);font-size:14px}
#chip{position:fixed;top:calc(env(safe-area-inset-top) + 10px);left:12px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.07);color:var(--ink);border-radius:999px;padding:6px 12px;font:inherit;font-size:13px;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);max-width:46vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#chip.back{background:var(--sky);border-color:var(--sky)}
#sheet .pri{border-color:var(--red)!important;background:var(--red)!important;color:#fff!important;font-weight:700}
#sheet .script{margin-top:12px;font-size:14.5px;color:var(--ink);opacity:.92;display:none}
#sheet .script.on{display:block}
.prog{height:3px;background:rgba(255,255,255,.15);border-radius:2px;margin-top:10px;overflow:hidden;display:none}.prog.on{display:block}.prog i{display:block;height:100%;width:0;background:var(--red)}
.wk{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px}.wk div{cursor:pointer}.wk img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px}.wk span{display:block;font-size:11.5px;color:var(--ink2);margin-top:3px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.wk .now img{outline:2px solid var(--red);outline-offset:1px}
#card{width:100%;border-radius:10px;margin-top:12px;display:block}
.toast{position:fixed;left:50%;top:calc(env(safe-area-inset-top) + 56px);transform:translateX(-50%);background:rgba(0,0,0,.75);color:#fff;padding:8px 14px;border-radius:999px;font-size:13.5px;z-index:9}
</style></head><body>
<div id="stage"><img id="pic" alt=""><div class="wait" id="wait">그림 고르는 중…</div></div>
<div id="cap"><b id="ct"></b><small id="cs"></small></div>
<button id="chip">🗓 오늘의 그림</button>
<div id="top"><button id="bBreath">🫧 숨</button><button id="bFrame">🖼 액자</button><button id="bFav">♡</button></div>
<button class="btn" id="bInfo" aria-label="해설">ⓘ</button><button class="btn" id="bNext" aria-label="다음 그림">→</button>
<div id="breath"><i></i><span id="bt">들이쉬고…</span></div>
<div id="sheet"></div>
<script>
var PB='';try{PB=localStorage.getItem('pb-code')||'';}catch(e){}
var AU=null,SAY={};
// iOS 소리 깨우기: 실제 샘플이 든 0.05초 무음 wav(빈 wav 는 재생이 실패해 깨워지지 않음)
var SIL=(function(){var n=400,b=new Uint8Array(44+n),d=new DataView(b.buffer),w=function(o,t){for(var i=0;i<4;i++)b[o+i]=t.charCodeAt(i);};w(0,'RIFF');d.setUint32(4,36+n,true);w(8,'WAVE');w(12,'fmt ');d.setUint32(16,16,true);d.setUint16(20,1,true);d.setUint16(22,1,true);d.setUint32(24,8000,true);d.setUint32(28,8000,true);d.setUint16(32,1,true);d.setUint16(34,8,true);w(36,'data');d.setUint32(40,n,true);for(var i=0;i<n;i++)b[44+i]=128;return URL.createObjectURL(new Blob([b],{type:'audio/wav'}));})();
function wakeAu(a){a.src=SIL;try{var p=a.play();if(p&&p.catch)p.catch(function(){});}catch(e){}}
var CUR=null,NOTE={},PRE=null,FRAME=0,FT=null,WL=null,CNT={open:1},T0=Date.now();
var TD=null,MODE='today',DAY=null,DA=null; // TD = 오늘의 그림 문서, DAY = 지금 보는 날짜 문서(모아 보기에서 고른 것 포함)
function $(i){return document.getElementById(i);}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function toast(t){var d=document.createElement('div');d.className='toast';d.textContent=t;document.body.appendChild(d);setTimeout(function(){d.remove();},2200);}
function lg(k,v){try{if(v===undefined){var x=localStorage.getItem(k);return x?JSON.parse(x):null;}localStorage.setItem(k,JSON.stringify(v));}catch(e){return null;}}
function imgW(){return Math.min(2400,Math.round(Math.max(window.innerWidth,window.innerHeight)*(window.devicePixelRatio||1)/200)*200)||1686;}
function src(a){return '/art/img?i='+encodeURIComponent(a.img)+'&w='+imgW();}
function fetchNext(){return fetch('/art/next').then(function(r){return r.json();}).then(function(a){if(a.error)throw new Error(a.error);var im=new Image();im.src=src(a);return {a:a,im:im};});}
function show(p){
  if(AU)AU.pause();
  CUR=p.a;var pic=$('pic');pic.classList.remove('on');$('wait').style.display='none';
  var go=function(){pic.src=p.im.src;requestAnimationFrame(function(){pic.classList.add('on');});};
  if(p.im.complete&&p.im.naturalWidth)setTimeout(go,350);else{p.im.onload=function(){setTimeout(go,100);};p.im.onerror=function(){next();};}
  var dk=DAY&&DAY.art.id===CUR.id?DAY.ko:null;
  $('ct').textContent=dk&&dk.title||CUR.title;$('cs').textContent=dk?(dk.artist||CUR.artist):[CUR.artist,CUR.date].filter(Boolean).join(' · ');
  favBtn();$('sheet').classList.remove('on');chip();
  var h=lg('art-seen')||[];h.unshift({id:CUR.id,t:CUR.title,a:CUR.artist,i:CUR.img});lg('art-seen',h.slice(0,60));
  loadNote(CUR.id);if(MODE==='more'&&!PRE)PRE=fetchNext().catch(function(){return null;});
}
function next(){if(MODE!=='more'){MODE='more';DAY=null;}CNT.next=(CNT.next||0)+1;var p=PRE;PRE=null;(p||fetchNext()).then(function(x){if(x)show(x);else return fetchNext().then(show);}).catch(function(e){$('wait').style.display='block';$('wait').textContent=e.message||'네트워크를 확인해 주세요';});}
function loadNote(id){if(NOTE[id])return;NOTE[id]='…';fetch('/art/note?id='+id).then(function(r){return r.json();}).then(function(j){NOTE[id]=j.ko?j:{err:j.error||'해설 없음'};if($('sheet').classList.contains('on')&&CUR&&CUR.id===id)sheet();},function(){NOTE[id]={err:'네트워크'};});}
function sheet(){
  var n=NOTE[CUR.id],k=n&&n.ko,h='';
  h+='<h2>'+esc(k&&k.title||CUR.title)+'</h2><div class="en">'+esc(CUR.title)+'</div>';
  h+='<div class="who">'+esc(k&&k.artist||CUR.artistFull||CUR.artist)+'</div>';
  var dd=DAY&&DAY.art.id===CUR.id?DAY:null;
  if(dd)h=(dd.d===(TD&&TD.today)?'<div class="en" style="color:var(--red);font-weight:700">🗓 오늘의 그림 · '+fmtD(dd.d)+'</div>':'<div class="en">🗓 '+fmtD(dd.d)+'의 그림</div>')+h;
  if(dd)h+='<div class="row"><button id="sDoc" class="pri">▶ 1분 도슨트 듣기</button><button id="sScr">대본 보기</button></div><div class="prog" id="dProg"><i></i></div><div class="script" id="dScr">'+esc(dd.script)+'</div>';
  else if(k)h+='<div class="row"><button id="sDoc" class="pri">▶ 해설 듣기</button></div><div class="prog" id="dProg"><i></i></div>';
  if(k){h+='<ol>'+k.lines.map(function(l){return '<li>'+esc(l)+'</li>';}).join('')+'</ol>';if(k.look)h+='<div class="look">👀 '+esc(k.look)+'</div>';}
  else h+='<p class="wait">'+(n&&n.err?esc(n.err):'해설 쓰는 중…')+'</p>';
  var cm=String(CUR.id).charAt(0)==='c';
  h+='<div class="meta">'+esc([CUR.date,CUR.medium,CUR.place].filter(Boolean).join(' · '))+'<br>'+(cm?'클리블랜드 미술관 소장 · CC0':'시카고 미술관 소장 · 퍼블릭 도메인')+' · 해설은 AI가 써서 틀릴 수 있어요</div>';
  if(k)h+='<div class="row"><button id="sCard">📮 공유 카드 만들기</button>'+(PB?'<button id="sSay" style="border-color:var(--sky);background:var(--sky)">🔊 내 목소리로 듣기</button>':'')+'</div>';
  h+='<div class="row"><button id="sClose">닫기</button><button id="sFavs">♥ 좋아한 그림 '+(lg('art-fav')||[]).length+'</button><a href="'+(cm?'https://www.clevelandart.org/art/'+esc(String(CUR.id).slice(1)):'https://www.artic.edu/artworks/'+CUR.id)+'" target="_blank" rel="noopener" style="color:var(--ink2);font-size:13px;align-self:center">미술관 페이지 ↗</a></div>';
  $('sheet').innerHTML=h;$('sheet').classList.add('on');CNT.info=(CNT.info||0)+1;
  $('sClose').onclick=function(){$('sheet').classList.remove('on');if(AU)AU.pause();};
  $('sFavs').onclick=favList;
  if($('sSay'))$('sSay').onclick=sayNote;
  if($('sCard'))$('sCard').onclick=makeCard;
  var pd=dd?{d:dd.d,u:'/art/d?d='+dd.d,l:'▶ 1분 도슨트 듣기'}:{d:'id:'+CUR.id,u:'/art/v?id='+CUR.id,l:'▶ 해설 듣기'};
  if($('sDoc')){$('sDoc').onclick=function(){playDoc(pd);};if($('sScr'))$('sScr').onclick=function(){$('dScr').classList.toggle('on');};docUi(pd);}
}
function fmtD(d){var p=String(d).split('-');return (+p[1])+'월 '+(+p[2])+'일';}
// 🗓 오늘의 그림 칩: 오늘 보는 중이면 날짜·연속 일수, 다른 그림 보는 중이면 '오늘의 그림으로'
function chip(){var c=$('chip');if(!TD){c.style.display='none';return;}c.style.display='';
  var on=DAY&&CUR&&DAY.art.id===CUR.id&&DAY.d===TD.today;c.classList.toggle('back',!on);
  if(on){var st=lg('art-st')||{};c.textContent='🗓 '+fmtD(TD.today)+(st.n>1?' · '+st.n+'일째':'');}else c.textContent='← 오늘의 그림';}
$('chip').onclick=function(){if(!TD)return;var on=DAY&&CUR&&DAY.art.id===CUR.id&&DAY.d===TD.today;if(on)weekList();else showDay(TD);};
function showDay(doc){MODE='today';DAY=doc;NOTE[doc.art.id]={ko:doc.ko};var im=new Image();im.src=src(doc.art);show({a:doc.art,im:im});}
function streak(d){var st=lg('art-st')||{};if(st.d===d)return;var y=new Date(Date.parse(d+'T00:00:00Z')-864e5).toISOString().slice(0,10);st.n=st.d===y?(st.n||1)+1:1;st.d=d;lg('art-st',st);}
// ▶ 1분 도슨트: 날짜마다 서버가 한 번 만든 AI 목소리(Cherry). 탭 순간 무음으로 Audio 를 깨워 둠(iOS)
function docUi(dd){var b=$('sDoc');if(!b)return;var on=DA&&DA._d===dd.d&&!DA.paused;b.textContent=on?'⏸ 멈추기':(DA&&DA._d===dd.d&&DA.currentTime>1&&!DA.ended?'▶ 이어 듣기':dd.l);$('dProg').classList.toggle('on',!!(DA&&DA._d===dd.d));}
function playDoc(dd){
  if(AU)AU.pause();
  if(DA&&DA._d===dd.d){if(!DA._ok)return;if(DA.paused)DA.play();else DA.pause();return;}
  if(DA)DA.pause();DA=new Audio();DA._d=dd.d;CNT.docent=(CNT.docent||0)+1;wakeAu(DA);
  var b=$('sDoc'),t0=Date.now(),tm=setInterval(function(){if($('sDoc')&&DA&&DA._d===dd.d&&!DA._ok)$('sDoc').textContent='🎧 목소리 준비 중… '+Math.round((Date.now()-t0)/1000)+'초';},1000);
  b.textContent='🎧 목소리 준비 중…';var tries=0,me=DA;
  var fail=function(m){clearInterval(tm);if(DA===me)DA=null;if($('sDoc'))$('sDoc').textContent=dd.l;toast(m);};
  // 파일을 통째로 받은 뒤 재생(iOS 가 긴 wav 를 조각 요청하다 멈추는 경우 방지)
  var go=function(){fetch(dd.u).then(function(r){
    if(r.status===202){if(tries++<40){setTimeout(go,3000);return;}return fail('음성이 너무 오래 걸려요. 잠시 뒤 다시 눌러 주세요');}
    if(r.status===503)return r.json().then(function(j){fail('음성 실패: '+(j.error||503));});
    if(!r.ok)return r.json().then(function(j){fail('음성 실패: '+(j.error||r.status));},function(){fail('음성 실패: '+r.status);});
    return r.blob().then(function(bl){if(DA!==me)return;clearInterval(tm);me._ok=1;
      me.src=URL.createObjectURL(bl);me.ontimeupdate=function(){var p=$('dProg');if(p&&me.duration)p.firstChild.style.width=(me.currentTime/me.duration*100)+'%';};
      me.onplay=me.onpause=me.onended=function(){if($('sDoc'))docUi(dd);};
      me.onerror=function(){fail('이 기기에서 음성을 재생하지 못했어요');};
      var p=me.play();if(p&&p.catch)p.catch(function(){if($('sDoc'))$('sDoc').textContent='▶ 한 번 더 누르세요';});});
  }).catch(function(){fail('네트워크를 확인해 주세요');});};
  go();
}
// 🗓 지난 그림 모아 보기(최근 14일, 모두에게 같은 목록)
function weekList(){CNT.week=(CNT.week||0)+1;$('sheet').innerHTML='<h2>🗓 지난 오늘의 그림</h2><p class="wait">불러오는 중…</p>';$('sheet').classList.add('on');
  fetch('/art/week').then(function(r){return r.json();}).then(function(j){var it=j.items||[];var st=lg('art-st')||{};
    $('sheet').innerHTML='<h2>🗓 지난 오늘의 그림</h2><div class="en">'+(st.n>1?st.n+'일째 이어서 보는 중 · ':'')+'날마다 아침 6시(중국)에 한 점씩</div><div class="wk">'+it.map(function(x,i){return '<div data-w="'+i+'"'+(x.d===TD.today?' class="now"':'')+'><img src="/art/img?i='+encodeURIComponent(x.art.img)+'&w=400"><span>'+fmtD(x.d)+' · '+esc(x.ko.title)+'</span></div>';}).join('')+'</div><div class="row"><button id="sClose">닫기</button><button id="sMore">무작위로 더 보기 →</button></div>';
    $('sClose').onclick=function(){$('sheet').classList.remove('on');};$('sMore').onclick=function(){$('sheet').classList.remove('on');next();};
    document.querySelectorAll('[data-w]').forEach(function(d){d.onclick=function(){var x=it[+d.getAttribute('data-w')];if(x.d===TD.today)return showDay(TD);showDay({d:x.d,art:x.art,ko:x.ko,script:x.script||''});};});
  },function(){$('sheet').innerHTML='<p class="wait">네트워크를 확인해 주세요</p>';});}
// 📮 공유 카드: 1080×1920 세로(인스타 스토리·카톡). 그림은 같은 도메인 /art/img 라 캔버스가 오염되지 않음
function wrap(c,t,x,y,w,lh,max){var ws=String(t).split(' '),line='',n=0;for(var i=0;i<ws.length;i++){var tt=line?line+' '+ws[i]:ws[i];if(c.measureText(tt).width>w&&line){c.fillText(line,x,y);y+=lh;line=ws[i];if(++n>=max-1){line=ws.slice(i).join(' ');while(c.measureText(line+'…').width>w&&line.length>1)line=line.slice(0,-1);if(i<ws.length-1||c.measureText(ws.slice(i).join(' ')).width>w)line+='…';break;}}else line=tt;}c.fillText(line,x,y);return y+lh;}
function makeCard(){
  if(!CUR)return;CNT.card=(CNT.card||0)+1;var k=(NOTE[CUR.id]||{}).ko||{},dd=DAY&&DAY.art.id===CUR.id?DAY:null;
  var b=$('sCard');b.textContent='📮 만드는 중…';
  var im=new Image();im.onload=function(){(document.fonts&&document.fonts.load?Promise.all([document.fonts.load('700 56px Pre'),document.fonts.load('400 34px Pre')]):Promise.resolve()).catch(function(){}).then(function(){
    var W=1080,H=1920,cv=document.createElement('canvas');cv.width=W;cv.height=H;var c=cv.getContext('2d');
    c.fillStyle='#0E0E10';c.fillRect(0,0,W,H);
    var bw=920,bh=1080,s=Math.min(bw/im.naturalWidth,bh/im.naturalHeight),iw=im.naturalWidth*s,ih=im.naturalHeight*s,ix=(W-iw)/2,iy=170+(bh-ih)/2;
    c.save();c.shadowColor='rgba(0,0,0,.6)';c.shadowBlur=60;c.shadowOffsetY=18;c.drawImage(im,ix,iy,iw,ih);c.restore();
    c.textAlign='center';c.fillStyle='#A7A29A';c.font='400 30px Pre,-apple-system,sans-serif';
    c.fillText(dd?'오늘의 그림 · '+dd.d.replace(/-/g,'.'):'명화 한 점',W/2,110);
    var y=1330;c.fillStyle='#EDE6DA';c.font='700 56px Pre,-apple-system,sans-serif';y=wrap(c,k.title||CUR.title,W/2,y,940,70,2);
    c.fillStyle='#A7A29A';c.font='400 32px Pre,-apple-system,sans-serif';y=wrap(c,k.artist||CUR.artist||'',W/2,y+4,940,42,1);
    if(k.look){y+=40;c.fillStyle='#D21624';c.fillRect(W/2-30,y-30,60,4);y+=34;c.fillStyle='#EDE6DA';c.font='400 38px Pre,-apple-system,sans-serif';wrap(c,'👀 '+k.look,W/2,y,900,56,4);}
    c.fillStyle='#6E6A64';c.font='400 28px Pre,-apple-system,sans-serif';c.fillText('명화 한 점 · voice.zhnote.net/art',W/2,H-90);
    cv.toBlob(function(bl){
      var url=URL.createObjectURL(bl),fn='오늘의그림_'+(dd?dd.d:'art')+'.jpg',f=null;try{f=new File([bl],fn,{type:'image/jpeg'});}catch(e){}
      var can=f&&navigator.canShare&&navigator.canShare({files:[f]});
      $('sheet').innerHTML='<h2>📮 공유 카드</h2><div class="en">'+(can?'공유를 누르거나 ':'')+'그림을 길게 눌러 저장할 수 있어요</div><img id="card" src="'+url+'"><div class="row">'+(can?'<button id="cShare" class="pri">공유하기</button>':'')+'<a id="cSave" href="'+url+'" download="'+fn+'" style="color:var(--ink);border:1px solid rgba(255,255,255,.2);border-radius:999px;padding:8px 14px;font-size:14px;text-decoration:none">저장</a><button id="sClose">닫기</button></div>';
      $('sClose').onclick=function(){$('sheet').classList.remove('on');};
      if(can)$('cShare').onclick=function(){navigator.share({files:[f],text:(k.title||CUR.title)+' — 명화 한 점 https://voice.zhnote.net/art'}).catch(function(){});};
    },'image/jpeg',0.9);
  });};
  im.onerror=function(){b.textContent='📮 공유 카드 만들기';toast('그림을 못 받았어요');};
  im.src='/art/img?i='+encodeURIComponent(CUR.img)+'&w=1200';
}
// 해설 읽어 주기: 박비서 초대 코드가 이 기기에 있어야 함(내 목소리 = 숏츠용 한국어 복제 목소리). iOS 는 탭 순간 Audio 를 깨워 둠
function sayNote(){
  var b=$('sSay');if(!CUR)return;
  if(AU&&!AU.paused&&AU._id===CUR.id){AU.pause();b.textContent='🔊 내 목소리로 듣기';return;}
  if(!PB){var c=prompt('박비서 초대 코드를 넣어 주세요 (내 목소리를 쓰려면 한 번만)');if(!c)return;PB=c.trim();try{localStorage.setItem('pb-code',PB);}catch(e){}}
  if(!AU)AU=new Audio();wakeAu(AU);
  var id=CUR.id;AU._id=id;b.textContent='🔊 목소리 만드는 중…';CNT.say=(CNT.say||0)+1;
  var go=function(u,mine){if(!CUR||CUR.id!==id)return;AU.src=u;AU.onended=function(){b.textContent='🔊 다시 듣기';};var p=AU.play();if(p&&p.catch)p.catch(function(){b.textContent='▶ 한 번 더 누르세요';SAY[id]={u:u,m:mine};});b.textContent=(mine?'⏸ 내 목소리':'⏸ AI 목소리(내 목소리 미등록)');};
  if(SAY[id])return go(SAY[id].u,SAY[id].m);
  fetch('/art/say',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:PB,id:id})}).then(function(r){return r.json();}).then(function(j){
    if(j.error==='not_allowed'){PB='';try{localStorage.removeItem('pb-code');}catch(e){}b.textContent='🔊 내 목소리로 듣기';toast('초대 코드가 맞지 않아요');return;}
    if(!j.ok){b.textContent='🔊 내 목소리로 듣기';toast(j.detail||j.error||'실패');return;}
    SAY[id]={u:j.url,m:j.mine};go(j.url,j.mine);
  },function(){b.textContent='🔊 내 목소리로 듣기';toast('네트워크를 확인해 주세요');});
}
function favList(){var f=lg('art-fav')||[];if(!f.length){toast('아직 없어요. ♡ 를 눌러 모아 보세요');return;}
  $('sheet').innerHTML='<h2>♥ 좋아한 그림</h2><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px">'+f.map(function(x,i){return '<div data-f="'+i+'" style="cursor:pointer"><img src="/art/img?i='+encodeURIComponent(x.i)+'&w=400" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px"><div style="font-size:11.5px;color:var(--ink2);margin-top:3px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">'+esc(x.t)+'</div></div>';}).join('')+'</div><div class="row"><button id="sClose">닫기</button></div>';
  $('sClose').onclick=function(){$('sheet').classList.remove('on');};
  document.querySelectorAll('[data-f]').forEach(function(d){d.onclick=function(){var x=f[+d.getAttribute('data-f')];var im=new Image();im.src='/art/img?i='+encodeURIComponent(x.i)+'&w='+imgW();show({a:{id:x.id,title:x.t,artist:x.a,img:x.i,date:'',medium:'',place:'',artistFull:x.a},im:im});};});}
function isFav(){return (lg('art-fav')||[]).some(function(x){return CUR&&x.id===CUR.id;});}
function favBtn(){$('bFav').textContent=isFav()?'♥':'♡';$('bFav').classList.toggle('on',isFav());}
$('bFav').onclick=function(){if(!CUR)return;var f=lg('art-fav')||[];if(isFav())f=f.filter(function(x){return x.id!==CUR.id;});else{f.unshift({id:CUR.id,t:CUR.title,a:CUR.artist,i:CUR.img});CNT.fav=(CNT.fav||0)+1;toast('♥ 모아 뒀어요');}lg('art-fav',f.slice(0,200));favBtn();};
$('bNext').onclick=next;$('bInfo').onclick=function(){if(!CUR)return;if($('sheet').classList.contains('on'))$('sheet').classList.remove('on');else sheet();};
$('pic').onclick=function(){if($('sheet').classList.contains('on'))$('sheet').classList.remove('on');else sheet();};
// 액자 모드: 끔 → 3분 → 10분 → 30분, 화면 켜짐 유지
var FR=[0,3,10,30];
function wake(on){try{if(on&&navigator.wakeLock&&!WL)navigator.wakeLock.request('screen').then(function(w){WL=w;w.addEventListener('release',function(){WL=null;});});if(!on&&WL){WL.release();WL=null;}}catch(e){}}
$('bFrame').onclick=function(){FRAME=(FRAME+1)%FR.length;clearInterval(FT);var m=FR[FRAME];$('bFrame').textContent=m?'🖼 '+m+'분':'🖼 액자';$('bFrame').classList.toggle('on',!!m);
  if(m){FT=setInterval(next,m*60000);wake(true);toast(m+'분마다 다음 그림 · 화면 켜 둠');CNT.frame=1;}else{wake(false);toast('액자 모드 끔');}};
document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible'&&FR[FRAME])wake(true);
  if(document.visibilityState==='hidden'){try{navigator.sendBeacon('/u',JSON.stringify({app:'art',c:CNT,sec:Math.round((Date.now()-T0)/1000)}));}catch(e){}CNT={};T0=Date.now();}});
// 숨 고르기: 4초 들이쉬고 · 2초 멈추고 · 4초 내쉬기(10초 주기) × 6번 = 1분
var BT=null;$('bBreath').onclick=function(){var b=$('breath');if(b.classList.contains('on')){b.classList.remove('on');clearInterval(BT);$('bBreath').classList.remove('on');return;}
  b.classList.add('on');$('bBreath').classList.add('on');CNT.breath=(CNT.breath||0)+1;var t=0;var step=function(){var s=t%10;$('bt').textContent=s<4?'들이쉬고…':s<6?'잠깐 멈추고…':'천천히 내쉬고…';t++;if(t>=60){b.classList.remove('on');clearInterval(BT);$('bBreath').classList.remove('on');toast('1분 쉬었어요');}};step();BT=setInterval(step,1000);};
var sx=0;document.addEventListener('touchstart',function(e){sx=e.touches[0].clientX;},{passive:true});
document.addEventListener('touchend',function(e){var dx=e.changedTouches[0].clientX-sx;if(dx<-60&&!$('sheet').classList.contains('on'))next();},{passive:true});
document.addEventListener('keydown',function(e){if(e.key==='ArrowRight'||e.key===' ')next();if(e.key==='i')$('bInfo').onclick();});
fetch('/art/today').then(function(r){return r.json();}).then(function(j){if(j.error||!j.art)throw new Error(j.error||'');TD=j;streak(j.today);CNT.today=1;
  if(!j.ready){TD.today=j.d;} // 오늘 판이 아직이면 가장 최근 그림을 오늘로 보여 줌
  showDay(TD);}).catch(function(){MODE='more';chip();fetchNext().then(show).catch(function(e){$('wait').textContent=e.message||'불러오지 못했어요';});});
</script></body></html>`;
