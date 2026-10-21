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
// 오늘의 그림 날짜 = 한국 자정 기준(2026-10-21 소유자). ART_TZ_H 로 바꿀 수 있음(시간 단위, 기본 9)
const artDay = (env, t = Date.now()) => new Date(t + (Number(env && env.ART_TZ_H) || 9) * 3600e3).toISOString().slice(0, 10);
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
  if (String(id)[0] === "m") {
    const a = await metObj(String(id).slice(1));
    if (!a) throw new Error("그림 정보를 못 받았어요");
    return { title: a.title, artist: [a.artistDisplayName, a.artistDisplayBio].filter(Boolean).join(", "), date: a.objectDate, medium: a.medium, place: [a.culture, a.country].filter(Boolean).join(", "), dept: a.department,
      about: "", museum: "The Metropolitan Museum of Art" };
  }
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

// ── 🗓 오늘의 명작 큐레이션(V2 Phase 2, 2026-10-21): 무작위 대신 고른 30점을 날짜마다 차례로. 모두에게 같은 그림, 한국 자정에 바뀜
//   작품마다 {m 미술관 aic|met|cma, id 번호 힌트, q 검색어, a 작가 열쇠말, t 제목 열쇠말[], g famous|hidden|asia}
//   서버가 미술관 API 로 찾아 '제목·작가 일치 + 퍼블릭 도메인/CC0 + 이미지 있음'일 때만 씀(KV art:cur:r:<번호> 30일 — 실패는 6시간 뒤 다시)
//   시카고 미술관은 Worker 요청을 거부한 적이 있어(2026-10-20) 한 번 더 시도하고, 작품 정보·IIIF 그림 둘 다 받아져야 씀. 안 되면 6시간 동안 건너뛰고 다른 미술관 작품으로
//   날짜를 직접 정하려면 KV art:pin:<YYYY-MM-DD> = 큐레이션 번호(숫자)
const CUR = [
  { m: "aic", id: 28560, q: "The Bedroom van Gogh", a: "gogh", t: ["bedroom"], g: "famous" },
  { m: "met", id: 436535, q: "Wheat Field with Cypresses", a: "gogh", t: ["cypress"], g: "famous" },
  { m: "met", id: 45434, q: "Under the Wave off Kanagawa Hokusai", a: "hokusai", t: ["wave", "kanagawa"], g: "asia" },
  { m: "aic", id: 27992, q: "A Sunday on La Grande Jatte", a: "seurat", t: ["jatte"], g: "famous" },
  { m: "met", id: 437881, q: "Young Woman with a Water Pitcher", a: "vermeer", t: ["pitcher"], g: "famous" },
  { m: "cma", q: "Burning of the Houses of Lords and Commons", a: "turner", t: ["burning"], g: "famous" },
  { m: "aic", id: 20684, q: "Paris Street Rainy Day", a: "caillebotte", t: ["rainy"], g: "famous" },
  { m: "met", id: 435809, q: "The Harvesters Bruegel", a: "bruegel", t: ["harvesters"], g: "famous" },
  { m: "met", q: "The Gulf Stream Winslow Homer", a: "homer", t: ["gulf stream"], g: "hidden" },
  { m: "aic", id: 16568, q: "Water Lilies Monet", a: "monet", t: ["water lilies"], g: "famous" },
  { m: "met", id: 437394, q: "Aristotle with a Bust of Homer", a: "rembrandt", t: ["aristotle"], g: "famous" },
  { m: "cma", q: "Twilight in the Wilderness", a: "church", t: ["twilight"], g: "hidden" },
  { m: "aic", id: 14655, q: "Two Sisters On the Terrace Renoir", a: "renoir", t: ["two sisters"], g: "famous" },
  { m: "met", id: 11417, q: "Washington Crossing the Delaware", a: "leutze", t: ["washington crossing"], g: "famous" },
  { m: "met", q: "Sudden Shower over Shin-Ohashi Bridge Hiroshige", a: "hiroshige", t: ["shower", "ohashi", "ōhashi"], g: "asia" },
  { m: "aic", id: 111442, q: "The Child's Bath Cassatt", a: "cassatt", t: ["bath"], g: "famous" },
  { m: "met", id: 437127, q: "Bridge over a Pond of Water Lilies", a: "monet", t: ["bridge"], g: "famous" },
  { m: "aic", q: "Nocturne Blue and Gold Southampton Water", a: "whistler", t: ["nocturne"], g: "hidden" },
  { m: "aic", id: 61128, q: "At the Moulin Rouge Toulouse-Lautrec", a: "toulouse", t: ["moulin rouge"], g: "famous" },
  { m: "met", id: 438817, q: "The Dance Class Degas", a: "degas", t: ["dance class"], g: "famous" },
  { m: "cma", q: "Crucifixion of Saint Andrew Caravaggio", a: "caravaggio", t: ["andrew"], g: "famous" },
  { m: "met", id: 12127, q: "Madame X Madame Pierre Gautreau", a: "sargent", t: ["madame x", "gautreau"], g: "famous" },
  { m: "met", q: "View of Toledo El Greco", a: "greco", t: ["toledo"], g: "hidden" },
  { m: "met", id: 435868, q: "The Card Players Cezanne", a: "cezanne", t: ["card players"], g: "famous" },
  { m: "met", q: "Night-Shining White Han Gan", a: "han gan", t: ["night-shining", "night shining"], g: "asia" },
  { m: "met", id: 436532, q: "Self-Portrait with a Straw Hat van Gogh", a: "gogh", t: ["straw hat"], g: "famous" },
  { m: "met", q: "Max Schmitt in a Single Scull", a: "eakins", t: ["schmitt"], g: "hidden" },
  { m: "met", id: 436105, q: "The Death of Socrates David", a: "david", t: ["socrates"], g: "famous" },
  { m: "aic", q: "The Herring Net Winslow Homer", a: "homer", t: ["herring net"], g: "hidden" },
  { m: "aic", id: 64818, q: "Stacks of Wheat End of Summer Monet", a: "monet", t: ["stacks of wheat", "wheat"], g: "famous" },
];
const CUR_START = "2026-10-21";
const nrm = (x) => String(x || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const okArt = (c, title, artist) => nrm(artist).includes(nrm(c.a)) && c.t.some((t) => nrm(title).includes(nrm(t)));
const UAH = { accept: "application/json", "user-agent": "zhnote-art/1.0 (personal viewer)" };
const MET = "https://collectionapi.metmuseum.org/public/collection/v1";
async function metObj(n) { const r = await fetch(MET + "/objects/" + n, { headers: UAH }).catch(() => null); if (!r || !r.ok) return null; return r.json().catch(() => null); }
function pickMet(a) {
  const u = String(a.primaryImageSmall || a.primaryImage || ""), m = u.match(/^https:\/\/images\.metmuseum\.org\/CRDImages\/([A-Za-z0-9._\-\/]+\.jpe?g)$/i);
  if (!m || !a.isPublicDomain) return null;
  return { id: "m" + a.objectID, title: String(a.title || "").slice(0, 160), artist: String(a.artistDisplayName || "").slice(0, 120), artistFull: [a.artistDisplayName, a.artistDisplayBio].filter(Boolean).join(", ").slice(0, 160),
    date: String(a.objectDate || "").slice(0, 60), medium: String(a.medium || "").slice(0, 120), place: String(a.culture || a.country || "").slice(0, 60), img: "m:" + m[1], w: 0, h: 0 };
}
// 미술관별 찾기: 번호 힌트 먼저 확인, 아니면 검색 상위에서 제목·작가가 맞는 것
async function findMet(c, why) {
  const tryIds = async (ids) => {
    for (const n of ids) {
      const a = await metObj(n); if (!a) { why.push("met " + n + " 못 받음"); continue; }
      if (!okArt(c, a.title, a.artistDisplayName)) { why.push("met " + n + " 제목·작가 다름"); continue; }
      const p = pickMet(a); if (p) return p; why.push("met " + n + " 이미지·퍼블릭 도메인 아님");
    }
    return null;
  };
  if (c.id) { const p = await tryIds([c.id]); if (p) return p; }
  const r = await fetch(MET + "/search?hasImages=true&q=" + encodeURIComponent(c.q), { headers: UAH }).catch(() => null);
  const j = r && r.ok ? await r.json().catch(() => ({})) : {};
  if (!r || !r.ok) why.push("met 검색 " + (r ? r.status : "연결 실패"));
  return tryIds((j.objectIDs || []).filter((n) => n !== c.id).slice(0, 4)); // 요청 하나의 외부 호출 상한 때문에 4개까지
}
async function findAic(env, c, why) {
  if (await env.KV.get("art:bad:aic2")) { why.push("시카고 미술관 잠시 건너뜀"); return null; }
  const flds = FIELDS + ",is_public_domain";
  let hits = [];
  if (c.id) { const r = await fetch(AIC + "/artworks/" + c.id + "?fields=" + flds, { headers: UA }).catch(() => null); if (r && r.ok) { const j = await r.json().catch(() => ({})); if (j.data) hits.push(j.data); } else why.push("aic " + c.id + " " + (r ? r.status : "연결 실패")); }
  if (!hits.some((a) => okArt(c, a.title, a.artist_title || a.artist_display))) {
    const r = await fetch(AIC + "/artworks/search?q=" + encodeURIComponent(c.q) + "&limit=8&fields=" + flds, { headers: UA }).catch(() => null);
    if (r && r.ok) hits = hits.concat(((await r.json().catch(() => ({}))).data) || []); else why.push("aic 검색 " + (r ? r.status : "연결 실패"));
  }
  if (!hits.length) { await env.KV.put("art:bad:aic2", "1", { expirationTtl: 6 * 3600 }); return null; } // 시카고 미술관이 막혀 있음 → 6시간 다른 미술관
  for (const a of hits) {
    if (!a.image_id || !a.is_public_domain || !okArt(c, a.title, a.artist_title || a.artist_display)) continue;
    const t = await fetch("https://www.artic.edu/iiif/2/" + a.image_id + "/full/200,/0/default.jpg", { headers: { "AIC-User-Agent": UA["AIC-User-Agent"] } }).catch(() => null);
    if (!t || !t.ok) { why.push("aic 그림 서버 " + (t ? t.status : "연결 실패")); await env.KV.put("art:bad:aic2", "1", { expirationTtl: 6 * 3600 }); return null; }
    return pick(a);
  }
  why.push("aic 제목·작가·퍼블릭 도메인 맞는 작품 없음");
  return null;
}
async function findCma(c, why) {
  const r = await fetch(CMA + "?cc0&has_image=1&limit=8&q=" + encodeURIComponent(c.q), { headers: UAH }).catch(() => null);
  if (!r || !r.ok) { why.push("cma 검색 " + (r ? r.status : "연결 실패")); return null; }
  for (const a of ((await r.json().catch(() => ({}))).data || [])) {
    if (!okArt(c, a.title, ((a.creators || [])[0] || {}).description)) continue;
    const p = pickCma(a); if (p) return p;
  }
  why.push("cma 제목·작가 맞는 CC0 작품 없음");
  return null;
}
async function resolveCur(env, n) {
  const k = "art:cur:r:" + n, hit = await env.KV.get(k, "json");
  if (hit) return hit.art ? hit : null;
  const c = CUR[n], why = [];
  let art = null;
  try { art = c.m === "met" ? await findMet(c, why) : c.m === "aic" ? await findAic(env, c, why) : await findCma(c, why); } catch (e) { why.push(String(e.message || e).slice(0, 80)); }
  const doc = { n, m: c.m, g: c.g, art, why: why.slice(-4), at: Date.now() };
  // 시카고 미술관이 막혀서 못 찾은 건 6시간 뒤 다시, 정말 없는 작품은 30일
  await env.KV.put(k, JSON.stringify(doc), { expirationTtl: art ? 30 * 86400 : (why.some((w) => /건너뜀|연결 실패|그림 서버|못 받음| 5\d\d| 4(03|29)/.test(w)) ? 6 * 3600 : 30 * 86400) });
  return art ? doc : null;
}
const dIdx = (d) => Math.round((Date.parse(d + "T00:00:00Z") - Date.parse(CUR_START + "T00:00:00Z")) / 86400e3);
// 그날 작품 고르기: 지정(art:pin) → 날짜 순번부터 차례로, 최근 20일에 나온 것은 건너뜀. 찾기는 요청 하나에 6곳까지(외부 호출 상한)
async function pickCur(env, d) {
  const seen = (await env.KV.get("art:thist", "json")) || [], recent = seen.slice(0, 20);
  const pin = await env.KV.get("art:pin:" + d);
  const order = [];
  if (pin != null && CUR[Number(pin)]) order.push(Number(pin));
  const base = ((dIdx(d) % CUR.length) + CUR.length) % CUR.length;
  for (let i = 0; i < CUR.length; i++) order.push((base + i) % CUR.length);
  let tries = 0;
  for (const n of order) {
    const k = await env.KV.get("art:cur:r:" + n, "json");
    if (k && !k.art) continue; // 이미 못 찾은 것
    if (!k && ++tries > 2) break; // 새로 찾는 건 요청 하나에 2점까지(외부 호출 상한) — 나머지는 크론이 미리 찾아 둠
    const r = k || (await resolveCur(env, n));
    if (r && r.art && (!recent.includes(r.art.id) || order[0] === n && pin != null)) return r;
  }
  return null;
}
// 도슨트: 작품 그림을 직접 보는 千问 VL 이 해설·감상 포인트·1분 대본을 한 번에(그림에 보이는 것만 위치로 말함). 실패하면 글자만으로 쓰되 위치·색 묘사는 금지
const DOCENT_SYS = "너는 미술관의 오디오 도슨트다. 한 사람이 휴대폰으로 이 작품을 보며 이어폰으로 1분 동안 듣는다. 한국어 구어체(~예요/~죠), 차분하고 담백하게. " +
  "지킬 것: 주어진 작품 정보와 널리 알려진 미술사 사실만 말한다. 출처 없는 일화·작가의 속마음을 사실처럼 단정하지 않는다(해석이 갈리면 '~로 보기도 해요'). 제작 시기와 나중의 소장·기록 시기를 섞지 않는다. 종교·문화 유물은 그 맥락을 존중한다. 모르면 생략한다. " +
  "IMG " +
  "연도 숫자는 그대로, 외국 이름은 한글 표기. 이모지·괄호·영문 금지. " +
  'JSON 만: {"title":"한국어 제목","artist":"작가 한국어 표기 · 나라 · 생몰년(정보에 있으면)","lines":["무엇을 그렸는지 1문장","언제·어떤 배경에서 1문장","눈여겨볼 점 1문장"],"look":"지금 그림에서 다시 볼 곳 한 문장","script":"1분 대본 340~420자. 0~10초 호기심을 끄는 질문이나 관찰로 시작 → 작가와 시대 배경, 그림의 특별한 표현, 이해의 핵심 → 마지막 10여 초는 그림의 한 부분을 다시 바라보게 하며 끝맺기"}';
const IMG_YES = "함께 보내는 그림을 직접 보고, 그림에 실제로 보이는 것만 위치(왼쪽 위, 가운데 아래 등)와 색으로 말한다. 그림에 없는 것을 말하지 않는다.";
const IMG_NO = "그림을 볼 수 없으니 위치·색·구도를 지어내지 말고, 'look' 과 대본 끝은 '그림 전체를 천천히 다시 보세요'처럼 일반적으로 쓴다.";
function b64(u8) { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
async function smallImg(art) {
  const i = art.img;
  const u = /^c:/.test(i) ? "https://openaccess-cdn.clevelandart.org/" + i.slice(2) : /^m:/.test(i) ? "https://images.metmuseum.org/CRDImages/" + i.slice(2) : "https://www.artic.edu/iiif/2/" + i + "/full/843,/0/default.jpg";
  const r = await fetch(u, /^c:|^m:/.test(i) ? {} : { headers: { "AIC-User-Agent": UA["AIC-User-Agent"] } }).catch(() => null);
  if (!r || !r.ok) return null;
  const b = new Uint8Array(await r.arrayBuffer());
  return b.length > 4.5e6 ? null : "data:image/jpeg;base64," + b64(b);
}
async function docentText(env, art, info) {
  const img = await smallImg(art).catch(() => null);
  const msgUser = JSON.stringify({ ...info, title: info.title || art.title, artist: info.artist || art.artistFull });
  const tries = [];
  if (img) for (const model of [env.ART_VL_MODEL, env.QUEST_VL_MODEL || "qwen3-vl-plus"].filter(Boolean)) tries.push({ model, img });
  for (const model of [env.ART_MODEL, env.QUEST_MODEL || "qwen3.8-flash", "qwen-plus"].filter(Boolean)) tries.push({ model });
  let last = "";
  for (const t of tries) {
    try {
      const sys = DOCENT_SYS.replace("IMG ", (t.img ? IMG_YES : IMG_NO) + " ");
      const content = t.img ? [{ type: "image_url", image_url: { url: t.img } }, { type: "text", text: msgUser }] : msgUser;
      const q = await fetch("https://" + host(env) + "/compatible-mode/v1/chat/completions", { method: "POST", headers: { authorization: "Bearer " + env.DASHSCOPE_API_KEY, "content-type": "application/json" },
        body: JSON.stringify({ model: t.model, temperature: 0.5, enable_thinking: false, ...(t.img ? {} : { response_format: { type: "json_object" } }), messages: [{ role: "system", content: sys }, { role: "user", content }] }) });
      if (!q.ok) { last = t.model + " " + q.status; continue; }
      const c = String(((await q.json()).choices || [{}])[0].message.content || "");
      const o = JSON.parse(c.slice(c.indexOf("{"), c.lastIndexOf("}") + 1));
      const ko = { title: String(o.title || "").slice(0, 80), artist: String(o.artist || "").slice(0, 80), lines: (Array.isArray(o.lines) ? o.lines : []).map((x) => String(x).slice(0, 180)).slice(0, 3), look: String(o.look || "").slice(0, 180) };
      const script = String(o.script || "").replace(/\s+/g, " ").trim().slice(0, 520);
      if (!ko.lines.length || script.length < 120) { last = t.model + ": 짧은 답"; continue; }
      return { ko, script, vis: !!t.img, model: t.model };
    } catch (e) { last = t.model + ": " + String(e.message || e).slice(0, 80); }
  }
  throw new Error("도슨트 원고를 못 만들었어요(" + last + ")");
}
async function buildToday(env, d) {
  const lk = "art:tlock:" + d;
  if (await env.KV.get(lk)) return null;
  await env.KV.put(lk, "1", { expirationTtl: 150 });
  try {
    const seen = (await env.KV.get("art:thist", "json")) || [];
    const r = await pickCur(env, d);
    let art = r && r.art, info = null, cur = r ? { n: r.n, m: r.m, g: r.g } : null;
    if (art) info = await getInfo(art.id).catch(() => null);
    if (!art || !info) { // 큐레이션을 하나도 못 쓰면 예전처럼 무작위(설명 있는 것 우선)
      cur = null; art = null;
      for (let t = 0; t < 4 && !art; t++) { const a = await next(env); if (seen.includes(a.id)) continue; const i = await getInfo(a.id).catch(() => null); if (i) { art = a; info = i; } }
    }
    if (!art) throw new Error("그림을 못 골랐어요");
    const dt = await docentText(env, art, info);
    const out = { ko: dt.ko };
    await env.KV.put("art:n:" + art.id, JSON.stringify(out)); // 해설 화면도 같은 글
    const doc = { d, art, ko: dt.ko, script: dt.script, cur, v2: 1, vis: dt.vis, at: Date.now() };
    await env.KV.put("art:today:" + d, JSON.stringify(doc));
    await env.KV.put("art:thist", JSON.stringify([art.id, ...seen.filter((x) => x !== art.id)].slice(0, 120)));
    return doc;
  } finally { await env.KV.delete(lk).catch(() => {}); }
}
const prevDay = (d, n = 1) => new Date(Date.parse(d + "T00:00:00Z") - n * 86400e3).toISOString().slice(0, 10);
async function today(env, ctx) {
  const d = artDay(env);
  const doc = await env.KV.get("art:today:" + d, "json");
  // 큐레이션 전(무작위)으로 만든 오늘 그림은 한 번만 큐레이션 작품으로 다시 만듦(2026-10-21 도입일)
  if (doc && !doc.cur && !doc.v2 && d >= CUR_START && !(await env.KV.get("art:recur:" + d))) {
    await env.KV.put("art:recur:" + d, "1", { expirationTtl: 2 * 86400 });
    ctx.waitUntil(buildToday(env, d).catch((e) => console.log("art recur", e && e.message))); // 덮어쓰기(지우지 않음 — 실패하면 기존 그림 유지), 음성은 누를 때 새 그림 것으로
    return { ...doc, today: d, ready: false };
  }
  if (doc) return { ...doc, today: d, ready: true };
  // 지난 그림이 하나도 없으면(처음) 기다려서 만들고, 있으면 어제 것을 보여 주고 뒤에서 만듦
  let old = null;
  for (let i = 1; i <= 3 && !old; i++) old = await env.KV.get("art:today:" + prevDay(d, i), "json");
  if (!old) { const x = await buildToday(env, d); if (x) return { ...x, today: d, ready: true }; throw new Error("오늘의 그림을 준비 중이에요. 잠시 뒤 다시."); }
  ctx.waitUntil(buildToday(env, d).catch((e) => console.log("art today", e && e.message)));
  return { ...old, today: d, ready: false };
}
// 같은 날짜를 다시 만들었으면 예전 음성 대신 새 대본으로(덮어쓰기)
const docentFresh = (env, d) => docent(env, d, true).catch((e) => console.log("art docent", e && e.message));
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
  if (!env.DASHSCOPE_API_KEY) return;
  const tz = Number(env.ART_TZ_H) || 9, h0 = (24 - tz) % 24; // 한국 자정 = UTC 15시
  if (uh === h0 && um < 15) {
    const d = artDay(env, Date.now() + 3600e3); // 자정 틱이면 이미 그날
    if (!(await env.KV.get("art:today:" + d))) await buildToday(env, d);
    const doc = await env.KV.get("art:today:" + d, "json");
    if (doc && !(await goodWav(env, dayWav(doc)))) await docentFresh(env, d); // 미리 — 누르면 바로 재생
    return;
  }
  // 다른 틱: 아직 찾지 않은 큐레이션 작품을 2점씩 미리 찾아 둠(첫 방문이 느려지지 않게)
  let n = 0;
  for (let i = 0; i < CUR.length && n < 2; i++) if (!(await env.KV.get("art:cur:r:" + i))) { await resolveCur(env, i).catch(() => null); n++; }
}
async function week(env) {
  const d = artDay(env), keys = Array.from({ length: 14 }, (_, i) => prevDay(d, i));
  const docs = await Promise.all(keys.map((k) => env.KV.get("art:today:" + k, "json").catch(() => null)));
  return { items: docs.filter(Boolean).map((x) => ({ d: x.d, art: x.art, ko: x.ko, script: x.script })) };
}
// 큐레이션 점검표(공개, 읽기만): 작품마다 찾았는지·어느 미술관 작품인지·못 찾은 이유. ?try=1 이면 아직 안 찾은 것 3점을 지금 찾아 봄
async function curCheck(env, url) {
  if (url.searchParams.get("try")) { let n = 0; for (let i = 0; i < CUR.length && n < 3; i++) if (!(await env.KV.get("art:cur:r:" + i))) { await resolveCur(env, i).catch(() => null); n++; } }
  const rows = await Promise.all(CUR.map(async (c, i) => { const r = await env.KV.get("art:cur:r:" + i, "json"); return { n: i, m: c.m, g: c.g, q: c.q, ok: !!(r && r.art), id: r && r.art && r.art.id, title: r && r.art && r.art.title, artist: r && r.art && r.art.artist, why: r && !r.art ? r.why : undefined, pending: !r }; }));
  const aic = await env.KV.get("art:bad:aic2");
  return { today: artDay(env), aic: aic ? "막힘(6시간 건너뜀)" : "시도 가능", found: rows.filter((r) => r.ok).length, total: CUR.length, rows };
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
const isWav = (b) => b && b.length > 2000 && String.fromCharCode(...b.subarray(0, 4)) === "RIFF" && String.fromCharCode(...b.subarray(8, 12)) === "WAVE";
// R2 에 있는 음성이 정상 wav 인지(머리 12바이트) — 깨진 파일이면 없는 셈 치고 다시 만듦(덮어쓰기)
async function goodWav(env, key) {
  const o = await env.R2.get(key, { range: { offset: 0, length: 12 } }).catch(() => null);
  if (!o) return false;
  const b = new Uint8Array(await o.arrayBuffer());
  return o.size > 2000 && String.fromCharCode(...b.subarray(0, 4)) === "RIFF" && String.fromCharCode(...b.subarray(8, 12)) === "WAVE";
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
      const b = new Uint8Array(await a.arrayBuffer());
      if (!isWav(b)) { why.push(model + " wav 아님(" + b.length + "B " + String.fromCharCode(...b.subarray(0, 4)).replace(/[^ -~]/g, "?") + ")"); continue; }
      return b;
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
async function noteVoice(env, id, force) {
  const key = "tts/art/ai/" + id + ".wav";
  if (!force && (await env.R2.head(key))) return key;
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
// 음성 파일 이름에 그림 번호를 넣어(큐레이션 이후) 같은 날 그림이 바뀌어도 예전 음성이 나오지 않게. 그 전 날짜는 예전 이름 그대로
const dayWav = (doc) => "tts/art/day/" + doc.d + (doc.cur || doc.v2 ? "-" + doc.art.id : "") + ".wav";
async function docent(env, d, force) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error("날짜");
  const doc = await env.KV.get("art:today:" + d, "json");
  if (!doc) throw new Error("그날 그림이 없어요");
  const key = dayWav(doc);
  if (!force && (await env.R2.head(key))) return key;
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
  const met = /^m:[A-Za-z0-9._\-\/]+\.jpe?g$/i.test(i) && !i.includes("..");
  if (!cma && !met && !/^[0-9a-f-]{36}$/.test(i)) return new Response("bad", { status: 400 });
  const big = cma && w > 900;
  const cache = caches.default, key = new Request("https://art-cache/" + encodeURIComponent(i) + "/" + (cma ? (big ? "print" : "web") : met ? "met" : w));
  const hit = await cache.match(key);
  if (hit) return hit;
  let r;
  if (cma) {
    const base = "https://openaccess-cdn.clevelandart.org/" + i.slice(2);
    r = big ? await fetch(base.replace(/_web\.jpg$/, "_print.jpg")) : null;
    if (!r || !r.ok) r = await fetch(base);
  } else if (met) r = await fetch("https://images.metmuseum.org/CRDImages/" + i.slice(2));
  else r = await fetch("https://www.artic.edu/iiif/2/" + i + "/full/" + w + ",/0/default.jpg", { headers: { "AIC-User-Agent": UA["AIC-User-Agent"] } });
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
  if (!/^[cm]?\d{1,9}$/.test(id)) throw new Error("id");
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
    if (!/^[0-9a-f]{12}$/.test(h) || !/^[cm]?\d{1,9}$/.test(id) || url.searchParams.get("s") !== (await hmac16(env, h + "|" + id))) return new Response("forbidden", { status: 403 });
    const o = await env.R2.get("tts/art/" + h + "/" + id + "." + x);
    if (!o) return new Response("not found", { status: 404 });
    return new Response(o.body, { headers: { "content-type": x === "mp3" ? "audio/mpeg" : "audio/wav", "cache-control": "private, max-age=86400" } });
  }
  if (p === "/art/v") { // 아무 그림이나 3줄 해설을 AI 목소리로(공개, 그림마다 한 번 만들어 R2 캐시)
    const id = String(url.searchParams.get("id") || "");
    if (!/^[cm]?\d{1,9}$/.test(id)) return json({ error: "id" }, 400);
    const key = "tts/art/ai/" + id + ".wav";
    if (!(await goodWav(env, key))) return voiceLater(env, ctx, "v:" + id, () => noteVoice(env, id, true));
    const o = await env.R2.get(key);
    if (!o) return new Response("not found", { status: 404 });
    return new Response(o.body, { headers: { "content-type": "audio/wav", "cache-control": "public, max-age=86400", "content-length": String(o.size) } });
  }
  if (p === "/art/d") {
    const d = String(url.searchParams.get("d") || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return json({ error: "날짜" }, 400);
    const doc = await env.KV.get("art:today:" + d, "json");
    if (!doc) return json({ error: "그날 그림이 없어요" }, 404);
    const wk = dayWav(doc);
    if (!(await goodWav(env, wk))) return voiceLater(env, ctx, "d:" + wk, () => docent(env, d, true));
    const o = await env.R2.get(wk, { range: req.headers.has("range") ? req.headers : undefined });
    if (!o) return new Response("not found", { status: 404 });
    const hd = { "content-type": "audio/wav", "cache-control": "public, max-age=86400", "accept-ranges": "bytes" };
    if (o.range && req.headers.has("range")) { const st = o.range.offset || 0, ln = o.range.length != null ? o.range.length : o.size - st; hd["content-range"] = "bytes " + st + "-" + (st + ln - 1) + "/" + o.size; hd["content-length"] = String(ln); return new Response(o.body, { status: 206, headers: hd }); }
    hd["content-length"] = String(o.size);
    return new Response(o.body, { headers: hd });
  }
  try {
    if (p === "/art/today") { if (!env.DASHSCOPE_API_KEY) return json({ error: "AI 키 없음" }, 500); const t = await today(env, ctx); return json(t, 200, t.ready ? "public, max-age=300" : "no-store"); }
    if (p === "/art/week") return json(await week(env), 200, "public, max-age=300");
    if (p === "/art/check") return json(await curCheck(env, url));
    if (p === "/art/next") { ctx.waitUntil(logUse(env, "art", { next: 1 }, 0).catch(() => {})); return json(await next(env)); }
    if (p === "/art/note") {
      const id = String(url.searchParams.get("id") || "");
      if (!/^[cm]?\d{1,9}$/.test(id)) return json({ error: "id" }, 400);
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
:root{--bg:#0E0E10;--ink:#EDE6DA;--ink2:#A7A29A;--ink3:#77736C;--sky:#1664B0;--red:#D21624;--sheet:rgba(20,20,24,.9);--line:rgba(255,255,255,.16);--glass:rgba(255,255,255,.07);--dock:150px}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;height:100%;background:var(--bg);color:var(--ink);font:15.5px/1.6 Pre,-apple-system,"Apple SD Gothic Neo",system-ui,sans-serif;overflow:hidden;-webkit-text-size-adjust:100%}
button{font:inherit;color:inherit;cursor:pointer}
/* 감상 영역: 작품이 가장 크게, 원본 비율(contain), 확대·이동은 #zw 에만 */
#stage{position:fixed;inset:0;padding:calc(env(safe-area-inset-top) + 64px) max(18px,env(safe-area-inset-right)) calc(env(safe-area-inset-bottom) + var(--dock)) max(18px,env(safe-area-inset-left));touch-action:none;overflow:hidden}
#zw{width:100%;height:100%;display:flex;align-items:center;justify-content:center;transform-origin:50% 50%;will-change:transform}
#pic{max-width:100%;max-height:100%;object-fit:contain;box-shadow:0 18px 60px rgba(0,0,0,.6);opacity:0;transform:scale(.985);transition:opacity 1.2s ease,transform 6s ease,filter .6s ease;-webkit-user-select:none;user-select:none;-webkit-user-drag:none;-webkit-touch-callout:none}
#pic.on{opacity:1;transform:scale(1)}
#pic.lo{filter:blur(6px)}
.wait{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--ink2);font-size:14px;text-align:center;padding:0 30px;pointer-events:none}
#zhint{position:fixed;left:50%;top:calc(env(safe-area-inset-top) + 64px);transform:translateX(-50%);font-size:12.5px;color:var(--ink2);background:rgba(0,0,0,.55);padding:5px 12px;border-radius:999px;display:none;z-index:3}
#zhint.on{display:block}
/* 위: 날짜 칩 · 숨 · 액자 · ♡ */
#chip{position:fixed;top:calc(env(safe-area-inset-top) + 10px);left:max(12px,env(safe-area-inset-left));min-height:44px;border:1px solid var(--line);background:var(--glass);border-radius:999px;padding:0 14px;font-size:13.5px;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);max-width:46vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;z-index:2}
#chip.back{background:var(--sky);border-color:var(--sky)}
#top{position:fixed;top:calc(env(safe-area-inset-top) + 10px);right:max(12px,env(safe-area-inset-right));display:flex;gap:8px;z-index:2}
#top button{min-width:44px;min-height:44px;border:1px solid var(--line);background:var(--glass);border-radius:999px;padding:0 13px;font-size:13.5px;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
#top button.on{background:var(--sky);border-color:var(--sky)}
/* 아래: 도슨트 플레이어 + 작품명·작가·연도·미술관 + ⓘ / → */
#dock{position:fixed;left:0;right:0;bottom:0;padding:0 max(14px,env(safe-area-inset-right)) calc(env(safe-area-inset-bottom) + 12px) max(14px,env(safe-area-inset-left));z-index:2;pointer-events:none}
#dock>*{pointer-events:auto}
.pl{display:flex;align-items:center;gap:10px;max-width:520px;margin:0 auto 10px;padding:6px 8px 6px 6px;border:1px solid var(--line);background:rgba(20,20,24,.62);border-radius:999px;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
.pl[hidden]{display:none}
.pl .pb{flex:none;width:40px;height:40px;border-radius:50%;border:0;background:var(--red);color:#fff;font-size:15px;display:flex;align-items:center;justify-content:center}
.pl .pb.busy{background:#5a2a2e}
.pl .pm{flex:1;min-width:0}
.pl .pn{font-size:12.5px;color:var(--ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.3}
.pl .bar{position:relative;height:18px;display:flex;align-items:center;cursor:pointer}
.pl .bar:before{content:"";position:absolute;left:0;right:0;height:3px;border-radius:2px;background:rgba(255,255,255,.18)}
.pl .bar i{position:absolute;left:0;height:3px;border-radius:2px;background:var(--red);width:0}
.pl .pt{flex:none;font-size:12px;color:var(--ink2);font-variant-numeric:tabular-nums;min-width:74px;text-align:right}
.pl .ps{flex:none;min-height:36px;border:1px solid var(--line);background:transparent;border-radius:999px;padding:0 12px;font-size:12.5px}
#capRow{display:flex;align-items:center;gap:10px}
#cap{flex:1;min-width:0;text-align:center;line-height:1.35}
#cap b{display:block;font-size:16px;letter-spacing:-.2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#cap small{display:block;color:var(--ink2);font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#cap small+small{color:var(--ink3);font-size:11.5px}
.btn{flex:none;width:52px;height:52px;border-radius:50%;border:1px solid var(--line);background:var(--glass);font-size:20px;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
/* 상세 시트: 본문 폭 760px 가운데 */
#sheet{position:fixed;left:0;right:0;bottom:0;max-height:78vh;max-height:78dvh;overflow:auto;-webkit-overflow-scrolling:touch;background:var(--sheet);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border-radius:18px 18px 0 0;padding:20px max(20px,env(safe-area-inset-right)) calc(env(safe-area-inset-bottom) + 24px) max(20px,env(safe-area-inset-left));transform:translateY(105%);transition:transform .35s ease;z-index:5}
#sheet.on{transform:none}
#sheet .in{max-width:760px;margin:0 auto}
#sheet .tag{color:var(--red);font-size:13px;font-weight:700}#sheet .tag.old{color:var(--ink2);font-weight:400}
#sheet h2{margin:2px 0 0;font-size:21px;line-height:1.35;word-break:keep-all;overflow-wrap:anywhere}
#sheet .en{color:var(--ink2);font-size:13px;margin-top:3px;overflow-wrap:anywhere}
#sheet .who{margin:12px 0 0;font-size:15px}
#sheet .when{color:var(--ink2);font-size:13.5px}
#sheet h3{margin:22px 0 6px;font-size:13px;letter-spacing:.4px;color:var(--ink2);font-weight:700}
#sheet .story p{margin:0 0 10px;font-size:15.5px;line-height:1.75}
#sheet ol{margin:0;padding-left:20px}#sheet li{margin:6px 0;line-height:1.65}
#sheet .look{border-left:3px solid var(--red);padding:6px 0 6px 12px;font-size:15.5px;line-height:1.65}
#sheet .ai{margin-top:8px;font-size:12px;color:var(--ink3)}
#sheet details{margin-top:4px;border-top:1px solid var(--line);padding-top:10px}
#sheet summary{cursor:pointer;color:var(--ink2);font-size:13.5px;min-height:36px;display:flex;align-items:center}
#sheet dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 14px;margin:8px 0 0;font-size:13px;color:var(--ink2)}
#sheet dt{color:var(--ink3)}#sheet dd{margin:0;overflow-wrap:anywhere}
#sheet .src{font-size:12.5px;color:var(--ink2);line-height:1.6}
#sheet .src a{color:var(--ink)}
#sheet .row{display:flex;gap:8px;margin-top:16px;flex-wrap:wrap;align-items:center}
#sheet .row button,#sheet .row a.b{min-height:44px;border:1px solid rgba(255,255,255,.22);background:transparent;color:var(--ink);border-radius:999px;padding:0 15px;font-size:14px;text-decoration:none;display:inline-flex;align-items:center}
#sheet .pri{border-color:var(--red)!important;background:var(--red)!important;color:#fff!important;font-weight:700}
#sheet .pl{margin:16px 0 0;max-width:none}
#sheet .script{margin-top:12px;font-size:15.5px;line-height:1.8;display:none;white-space:pre-line}
#sheet .script.on{display:block}
#breath{position:fixed;inset:0;display:none;align-items:center;justify-content:center;flex-direction:column;background:rgba(0,0,0,.35);z-index:4;pointer-events:none}
#breath.on{display:flex}
#breath i{width:120px;height:120px;border-radius:50%;border:2px solid rgba(255,255,255,.7);animation:br 10s ease-in-out infinite}
#breath span{margin-top:18px;font-size:16px;letter-spacing:.5px}
#breath.quiet span{display:none}#breath.quiet{background:rgba(0,0,0,.18)}
@keyframes br{0%,100%{transform:scale(.6);opacity:.5}40%,55%{transform:scale(1.15);opacity:1}}
.wk{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;margin-top:14px}.wk div{cursor:pointer}.wk img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;background:#1b1b1f}.wk span{display:block;font-size:11.5px;color:var(--ink2);margin-top:3px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.wk .now img{outline:2px solid var(--red);outline-offset:1px}
#card{width:100%;max-width:420px;border-radius:10px;margin:12px auto 0;display:block}
.toast{position:fixed;left:50%;top:calc(env(safe-area-inset-top) + 62px);transform:translateX(-50%);background:rgba(0,0,0,.8);color:#fff;padding:8px 14px;border-radius:14px;font-size:13.5px;z-index:9;max-width:90vw;text-align:center}
/* 액자 모드: 작품만. 화면을 탭하면 5초 동안 버튼이 다시 보임 */
body.fr #chip,body.fr #top,body.fr #dock{opacity:0;pointer-events:none;transition:opacity .6s}
body.fr #dock>*{pointer-events:none}
body.fr.peek #chip,body.fr.peek #top,body.fr.peek #dock{opacity:1;pointer-events:auto}
body.fr.peek #dock>*{pointer-events:auto}
body.fr #stage{padding-top:calc(env(safe-area-inset-top) + 24px);padding-bottom:calc(env(safe-area-inset-bottom) + 24px)}
@media (max-width:520px){#top button{padding:0 11px}.pl .pt{min-width:64px}}
/* 가로로 눕힌 폰: 아래 막대를 한 줄로 낮춰 그림 자리를 넓힘 */
@media (max-height:500px){#stage{padding-top:calc(env(safe-area-inset-top) + 58px)}#dock{display:flex;align-items:center;gap:10px;padding-bottom:calc(env(safe-area-inset-bottom) + 8px)}#dock .pl{order:2;margin:0;flex:0 1 360px}#capRow{flex:1;min-width:0}#cap small+small{display:none}.btn{width:44px;height:44px;font-size:18px}#chip,#top button{min-height:40px}}
@media (prefers-reduced-motion:reduce){#pic{transition:opacity .3s}#pic,#pic.on{transform:none}#breath i{animation:none;transform:scale(.9);opacity:.8}#sheet{transition:none}}
</style></head><body>
<div id="stage"><div id="zw"><img id="pic" alt="" draggable="false"></div><div class="wait" id="wait">그림 고르는 중…</div></div>
<div id="zhint">두 번 탭하거나 오므리면 원래 크기로</div>
<button id="chip">🗓 오늘의 그림</button>
<div id="top"><button id="bBreath" aria-label="숨 고르기">🫧 숨</button><button id="bFrame" aria-label="액자 모드">🖼 액자</button><button id="bFav" aria-label="좋아요">♡</button></div>
<div id="dock">
  <div class="pl" id="pl" hidden><button class="pb" data-pl="b" aria-label="재생">▶</button><div class="pm"><div class="pn" data-pl="n">1분 도슨트</div><div class="bar" data-pl="bar"><i data-pl="i"></i></div></div><span class="pt" data-pl="t">—</span><button class="ps" data-pl="s">대본</button></div>
  <div id="capRow"><button class="btn" id="bInfo" aria-label="작품 정보">ⓘ</button><div id="cap"><b id="ct"></b><small id="cs"></small><small id="cm"></small></div><button class="btn" id="bNext" aria-label="다음 그림">→</button></div>
</div>
<div id="breath"><i></i><span id="bt">들이쉬고…</span></div>
<div id="sheet"></div>
<script>
var PB='';try{PB=localStorage.getItem('pb-code')||'';}catch(e){}
var AU=null,SAY={};
// iOS 소리 깨우기: 실제 샘플이 든 0.05초 무음 wav(빈 wav 는 재생이 실패해 깨워지지 않음)
var SIL=(function(){var n=400,b=new Uint8Array(44+n),d=new DataView(b.buffer),w=function(o,t){for(var i=0;i<4;i++)b[o+i]=t.charCodeAt(i);};w(0,'RIFF');d.setUint32(4,36+n,true);w(8,'WAVE');w(12,'fmt ');d.setUint32(16,16,true);d.setUint16(20,1,true);d.setUint16(22,1,true);d.setUint32(24,8000,true);d.setUint32(28,8000,true);d.setUint16(32,1,true);d.setUint16(34,8,true);w(36,'data');d.setUint32(40,n,true);for(var i=0;i<n;i++)b[44+i]=128;return URL.createObjectURL(new Blob([b],{type:'audio/wav'}));})();
function wakeAu(a){a.src=SIL;try{var p=a.play();if(p&&p.catch)p.catch(function(){});}catch(e){}}
var CUR=null,NOTE={},PRE=null,FRAME=0,FT=null,WL=null,CNT={open:1},T0=Date.now();
var TD=null,MODE='today',DAY=null; // TD = 오늘의 그림 문서, DAY = 지금 보는 날짜 문서(모아 보기에서 고른 것 포함)
function $(i){return document.getElementById(i);}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function toast(t){var d=document.createElement('div');d.className='toast';d.textContent=t;document.body.appendChild(d);setTimeout(function(){d.remove();},2600);}
function lg(k,v){try{if(v===undefined){var x=localStorage.getItem(k);return x?JSON.parse(x):null;}localStorage.setItem(k,JSON.stringify(v));}catch(e){return null;}}
function imgW(){return Math.min(2400,Math.round(Math.max(window.innerWidth,window.innerHeight)*(window.devicePixelRatio||1)/200)*200)||1686;}
function srcW(a,w){return '/art/img?i='+encodeURIComponent(a.img)+'&w='+w;}
function src(a){return srcW(a,imgW());}
function isCm(a){return String(a&&a.id).charAt(0)==='c';}
function mk(a){var c=String(a&&a.id).charAt(0);return c==='c'?'cma':c==='m'?'met':'aic';}
var MUS={cma:{n:'클리블랜드 미술관',en:'Cleveland Museum of Art',lic:'이미지 CC0(Open Access)',u:function(i){return 'https://www.clevelandart.org/art/'+i.slice(1);}},
  met:{n:'메트로폴리탄 미술관',en:'The Metropolitan Museum of Art',lic:'퍼블릭 도메인(Open Access)',u:function(i){return 'https://www.metmuseum.org/art/collection/search/'+i.slice(1);}},
  aic:{n:'시카고 미술관',en:'Art Institute of Chicago',lic:'퍼블릭 도메인',u:function(i){return 'https://www.artic.edu/artworks/'+i;}}};
function museum(a){return MUS[mk(a)].n;}
function dayOf(){return DAY&&CUR&&DAY.art.id===CUR.id?DAY:null;}
function fetchNext(){return fetch('/art/next').then(function(r){return r.json();}).then(function(a){if(a.error)throw new Error(a.error);var im=new Image();im.src=src(a);return {a:a,im:im};});}

// ── 작품 보여 주기: 작은 그림(600px)을 먼저 흐리게 → 큰 그림이 오면 교체(레이아웃은 같은 비율이라 안 움직임)
function show(p){
  if(AU)AU.pause();pStop();zReset(false);
  CUR=p.a;var pic=$('pic'),me=CUR;pic.classList.remove('on');pic.classList.remove('lo');$('wait').style.display='none';
  var done=false,full=function(){if(CUR!==me||done)return;done=true;pic.src=p.im.src;pic.classList.remove('lo');requestAnimationFrame(function(){pic.classList.add('on');});};
  if(p.im.complete&&p.im.naturalWidth)setTimeout(full,250);
  else{
    var lo=new Image();lo.onload=function(){if(CUR!==me||done)return;pic.src=lo.src;pic.classList.add('lo');requestAnimationFrame(function(){pic.classList.add('on');});};lo.src=srcW(CUR,600);
    p.im.onload=full;p.im.onerror=function(){if(CUR!==me)return;if(lo.complete&&lo.naturalWidth){done=true;pic.classList.remove('lo');toast('큰 그림을 못 받아 작은 그림으로 보여 드려요');}else{$('wait').style.display='flex';$('wait').textContent='그림을 불러오지 못했어요. → 로 다른 그림을 보세요';}};
  }
  capFill();favBtn();$('sheet').classList.remove('on');chip();
  var h=lg('art-seen')||[];h.unshift({id:CUR.id,t:CUR.title,a:CUR.artist,i:CUR.img});lg('art-seen',h.slice(0,60));
  loadNote(CUR.id);pSet();if(MODE==='more'&&!PRE)PRE=fetchNext().catch(function(){return null;});
}
function capFill(){var dd=dayOf(),k=(dd&&dd.ko)||((NOTE[CUR.id]||{}).ko)||null;
  $('ct').textContent=k&&k.title||CUR.title||'제목 미상';
  $('cs').textContent=[(k&&k.artist)||CUR.artist||'작가 미상',k&&k.artist?'':CUR.date].filter(Boolean).join(' · ');
  $('cm').textContent=museum(CUR);}
function next(){if(MODE!=='more'){MODE='more';DAY=null;}CNT.next=(CNT.next||0)+1;var p=PRE;PRE=null;(p||fetchNext()).then(function(x){if(x)show(x);else return fetchNext().then(show);}).catch(function(e){$('wait').style.display='flex';$('wait').textContent=e.message||'네트워크를 확인해 주세요';});}
function loadNote(id){if(NOTE[id])return;NOTE[id]='…';fetch('/art/note?id='+id).then(function(r){return r.json();}).then(function(j){NOTE[id]=j.ko?j:{err:j.error||'해설 없음'};if(CUR&&CUR.id===id){capFill();pSet();if($('sheet').classList.contains('on')&&$('sheet')._k==='info')sheet();}},function(){NOTE[id]={err:'네트워크를 확인해 주세요'};});}

// ── 도슨트 플레이어(아래 막대와 상세 시트가 같은 상태를 씀)
// 오늘의 그림 = 1분 도슨트(/art/d), 그 밖 = 3줄 해설 읽기(/art/v). 자동재생 없음, 작품을 바꾸면 정지·처음으로
// 재생은 <audio>(받은 파일 objectURL) → 실패하면 WebAudio 로 해독해 재생(아이패드에서 wav 재생 실패 사례 대응)
var P={k:null};
function pDef(){if(!CUR)return null;var dd=dayOf();if(dd)return {k:'d:'+dd.d,u:'/art/d?d='+dd.d,n:'1분 도슨트',script:dd.script||''};
  var n=NOTE[CUR.id];if(n&&n.ko)return {k:'v:'+CUR.id,u:'/art/v?id='+CUR.id,n:'해설 듣기',script:''};return null;}
function pSet(){var d=pDef();$('pl').hidden=!d;if(d&&P.k!==d.k){pStop();P={k:d.k,u:d.u,n:d.n,st:'idle'};}pUi();fitDock();}
function pStop(){try{if(P.a){P.a.pause();P.a.removeAttribute('src');}}catch(e){}try{if(P.node)P.node.stop();}catch(e){}clearInterval(P.tm);clearInterval(P.wt);P={k:null};pUi();}
function fmt(s){if(!isFinite(s)||s<0)return '—';s=Math.round(s);return Math.floor(s/60)+':'+('0'+s%60).slice(-2);}
function pCur(){if(P.ac&&P.buf)return P.on?Math.min(P.buf.duration,P.off+P.ac.currentTime-P.at):P.off;return P.a?P.a.currentTime:0;}
function pDur(){if(P.buf)return P.buf.duration;return P.a&&isFinite(P.a.duration)?P.a.duration:NaN;}
function pUi(){var d=pDef(),st=P.st||'idle';
  var lab=st==='load'?'🎧 목소리 준비 중'+(P.sec?' '+P.sec+'초':'…'):(d?d.n:'');
  document.querySelectorAll('[data-pl=b]').forEach(function(b){b.textContent=st==='play'?'❚❚':st==='load'?'…':'▶';b.classList.toggle('busy',st==='load');b.setAttribute('aria-label',st==='play'?'일시정지':'재생');});
  document.querySelectorAll('[data-pl=n]').forEach(function(x){x.textContent=lab;});
  var c=pCur(),du=pDur();
  document.querySelectorAll('[data-pl=t]').forEach(function(x){x.textContent=(st==='idle'&&!P.ok)?(d&&d.k.charAt(0)==='d'?'약 1분':'—'):fmt(c)+' / '+fmt(du);});
  document.querySelectorAll('[data-pl=i]').forEach(function(x){x.style.width=(du>0?Math.min(100,c/du*100):0)+'%';});
  document.querySelectorAll('[data-pl=s]').forEach(function(x){x.style.display=d&&d.script?'':'none';});}
function pTick(){clearInterval(P.tm);P.tm=setInterval(function(){pUi();if(P.buf&&P.on&&pCur()>=P.buf.duration-0.05){P.on=false;P.off=0;P.st='idle';P.ended=1;clearInterval(P.tm);pUi();}},250);}
function pToggle(){var d=pDef();if(!d)return;if(AU)AU.pause();
  if(P.k!==d.k)P={k:d.k,u:d.u,n:d.n,st:'idle'};
  if(P.st==='load')return;
  if(P.ok){ if(P.st==='play'){pPause();}else{pPlay();} return; }
  pLoad(d);}
function pPlay(){if(P.buf){try{if(P.ac.state==='suspended')P.ac.resume();}catch(e){}var s=P.ac.createBufferSource();s.buffer=P.buf;s.connect(P.ac.destination);if(P.off>=P.buf.duration-0.1)P.off=0;s.start(0,P.off);P.node=s;P.at=P.ac.currentTime;P.on=true;P.st='play';pTick();pUi();return;}
  var q=P.a.play();P.st='play';if(q&&q.catch)q.catch(function(){P.st='paused';pUi();toast('▶ 를 한 번 더 눌러 주세요');});pTick();pUi();}
function pPause(){if(P.buf){P.off=pCur();try{P.node.stop();}catch(e){}P.on=false;}else if(P.a)P.a.pause();P.st='paused';clearInterval(P.tm);pUi();}
function pSeek(f){if(!P.ok)return;var du=pDur();if(!(du>0))return;var t=Math.max(0,Math.min(du-0.2,f*du));if(P.buf){var was=P.on;if(was){try{P.node.stop();}catch(e){}P.on=false;}P.off=t;if(was)pPlay();else pUi();}else{P.a.currentTime=t;pUi();}}
function pLoad(d){
  var me=P;me.st='load';me.sec=0;CNT.docent=(CNT.docent||0)+1;
  var a=new Audio();a.preload='auto';me.a=a;wakeAu(a); // 탭 안에서 깨움(iOS)
  try{var AC=window.AudioContext||window.webkitAudioContext;if(AC){me.ac=new AC();if(me.ac.state==='suspended')me.ac.resume();}}catch(e){}
  var t0=Date.now();me.wt=setInterval(function(){if(P!==me)return clearInterval(me.wt);me.sec=Math.round((Date.now()-t0)/1000);pUi();},1000);
  var tries=0,fail=function(m){clearInterval(me.wt);if(P!==me)return;me.st='idle';pUi();toast(m);};
  var viaWebAudio=function(ab,why){if(!me.ac)return fail('이 기기에서 음성을 재생하지 못했어요('+why+')');
    var cp=ab.slice(0);var ok=function(buf){if(P!==me)return;me.buf=buf;me.off=0;me.ok=1;me.a=null;pPlay();};
    var no=function(){fail('이 기기에서 음성을 재생하지 못했어요('+why+' · 해독 실패 · '+Math.round(ab.byteLength/1024)+'KB)');};
    try{var pr=me.ac.decodeAudioData(cp,ok,no);if(pr&&pr.catch)pr.catch(no);}catch(e){no();}};
  var go=function(){fetch(d.u).then(function(r){if(P!==me)return;
    if(r.status===202){if(tries++<40){setTimeout(go,3000);return;}return fail('음성이 너무 오래 걸려요. 잠시 뒤 다시 눌러 주세요');}
    if(!r.ok)return r.json().then(function(j){fail('음성을 만들지 못했어요: '+(j.error||r.status));},function(){fail('음성을 만들지 못했어요: '+r.status);});
    return r.arrayBuffer().then(function(ab){if(P!==me)return;clearInterval(me.wt);
      var bu=URL.createObjectURL(new Blob([ab],{type:'audio/wav'}));me._cur=bu;
      a.onerror=function(){if(P!==me||me.buf||a.src.indexOf(me._cur)<0)return;viaWebAudio(ab,'코드 '+(a.error&&a.error.code));}; // 깨우기 무음의 오류는 무시
      a.onended=function(){if(P!==me)return;me.st='idle';me.ended=1;clearInterval(me.tm);a.currentTime=0;pUi();};
      a.onpause=function(){if(P===me&&me.st==='play'&&!a.ended){me.st='paused';pUi();}};
      a.src=bu;me.ok=1;
      var q=a.play();me.st='play';pTick();pUi();
      if(q&&q.catch)q.catch(function(e){if(P!==me||me.buf)return;if(e&&e.name==='NotAllowedError'){me.st='paused';pUi();toast('▶ 를 한 번 더 눌러 주세요');}else viaWebAudio(ab,e&&e.name||'재생 거부');});
    });
  }).catch(function(){fail('네트워크를 확인해 주세요');});};
  go();pUi();
}
document.addEventListener('click',function(e){var t=e.target.closest&&e.target.closest('[data-pl]');if(!t)return;var k=t.getAttribute('data-pl');
  if(k==='b')pToggle();else if(k==='s'){sheet();setTimeout(function(){var s=$('dScr');if(s){s.classList.add('on');s.scrollIntoView({block:'start',behavior:'smooth'});}},60);}
  else if(k==='bar'||k==='i'){var bar=k==='bar'?t:t.parentNode,r=bar.getBoundingClientRect();pSeek((e.clientX-r.left)/r.width);}});
function fitDock(){var h=$('dock').offsetHeight;document.documentElement.style.setProperty('--dock',(h+16)+'px');}
window.addEventListener('resize',function(){fitDock();zReset(false);});

// ── 상세 시트: 작품명·원제 → 작가 → 연도 → 미술관 → 플레이어 → 작품 이야기 → 감상 포인트 → 세부 정보 → 출처·라이선스 → 저장·공유
function sheet(){
  var n=NOTE[CUR.id],dd=dayOf(),k=(dd&&dd.ko)||(n&&n.ko),cm=isCm(CUR),h='<div class="in">';
  if(dd)h+=dd.d===(TD&&TD.today)?'<div class="tag">🗓 오늘의 그림 · '+fmtD(dd.d)+'</div>':'<div class="tag old">🗓 '+fmtD(dd.d)+'의 그림</div>';
  h+='<h2>'+esc(k&&k.title||CUR.title)+'</h2>'+(k&&k.title&&k.title!==CUR.title?'<div class="en">'+esc(CUR.title)+'</div>':'');
  h+='<div class="who">'+esc(k&&k.artist||CUR.artistFull||CUR.artist||'작가 미상')+'</div>';
  h+='<div class="when">'+esc([CUR.date,museum(CUR)].filter(Boolean).join(' · '))+'</div>';
  if(pDef())h+='<div class="pl"><button class="pb" data-pl="b">▶</button><div class="pm"><div class="pn" data-pl="n"></div><div class="bar" data-pl="bar"><i data-pl="i"></i></div></div><span class="pt" data-pl="t">—</span><button class="ps" data-pl="s">대본</button></div>';
  if(dd&&dd.script)h+='<div class="script" id="dScr">'+esc(dd.script)+'</div>';
  if(k){h+='<h3>작품 이야기</h3><ol>'+k.lines.map(function(l){return '<li>'+esc(l)+'</li>';}).join('')+'</ol>';
    if(k.look)h+='<h3>오늘의 감상 포인트</h3><div class="look">'+esc(k.look)+'</div>';
    h+='<div class="ai">AI가 미술관 자료로 쓴 해설이에요 · 아직 검수 전이라 틀릴 수 있어요</div>';}
  else h+='<p class="wait" style="position:static;display:block;padding:16px 0">'+(n&&n.err?esc(n.err):'해설 쓰는 중…')+'</p>';
  var dl=[['원제',CUR.title],['작가(원문)',CUR.artistFull||CUR.artist],['제작',CUR.date],['재료·기법',CUR.medium],['지역·문화권',CUR.place],['작품 번호',String(CUR.id).replace(/^[cm]/,'')]].filter(function(x){return x[1];});
  h+='<h3>작품 세부 정보</h3><details><summary>미술관 원문 정보 펼치기</summary><dl>'+dl.map(function(x){return '<dt>'+esc(x[0])+'</dt><dd>'+esc(x[1])+'</dd>';}).join('')+'</dl></details>';
  var M=MUS[mk(CUR)],url=esc(M.u(String(CUR.id)));
  h+='<h3>출처 · 라이선스</h3><div class="src">'+M.n+'('+M.en+') 소장 · '+M.lic+(dd&&dd.cur?' · 오늘의 명작 큐레이션':'')+'<br>이미지는 미술관 공개 서버에서 받아 그대로 보여 드려요 · <a href="'+url+'" target="_blank" rel="noopener">미술관 원본 페이지 ↗</a></div>';
  h+='<div class="row"><button id="sFav">'+(isFav()?'♥ 저장됨':'♡ 저장')+'</button>'+(k?'<button id="sCard">📮 공유 카드</button>':'')+(PB&&k?'<button id="sSay" style="border-color:var(--sky);background:var(--sky)">🔊 내 목소리로 듣기</button>':'')+'</div>';
  h+='<div class="row"><button id="sClose">닫기</button><button id="sFavs">♥ 나의 컬렉션 '+(lg('art-fav')||[]).length+'</button></div></div>';
  var S=$('sheet');S.innerHTML=h;S._k='info';S.classList.add('on');S.scrollTop=0;CNT.info=(CNT.info||0)+1;
  $('sClose').onclick=function(){S.classList.remove('on');if(AU)AU.pause();};
  $('sFavs').onclick=favList;$('sFav').onclick=function(){$('bFav').onclick();$('sFav').textContent=isFav()?'♥ 저장됨':'♡ 저장';};
  if($('sSay'))$('sSay').onclick=sayNote;
  if($('sCard'))$('sCard').onclick=makeCard;
  pUi();
}
function fmtD(d){var p=String(d).split('-');return (+p[1])+'월 '+(+p[2])+'일';}
// 🗓 오늘의 그림 칩: 오늘 보는 중이면 날짜·연속 일수, 다른 그림 보는 중이면 '오늘의 그림으로'
function chip(){var c=$('chip');if(!TD){c.style.display='none';return;}c.style.display='';
  var on=DAY&&CUR&&DAY.art.id===CUR.id&&DAY.d===TD.today;c.classList.toggle('back',!on);
  if(on){var st=lg('art-st')||{};c.textContent='🗓 '+fmtD(TD.today)+(st.n>1?' · '+st.n+'일째':'');}else c.textContent='← 오늘의 그림';}
$('chip').onclick=function(){if(!TD)return;var on=DAY&&CUR&&DAY.art.id===CUR.id&&DAY.d===TD.today;if(on)weekList();else showDay(TD);};
function showDay(doc){MODE='today';DAY=doc;NOTE[doc.art.id]={ko:doc.ko};var im=new Image();im.src=src(doc.art);show({a:doc.art,im:im});}
function streak(d){var st=lg('art-st')||{};if(st.d===d)return;var y=new Date(Date.parse(d+'T00:00:00Z')-864e5).toISOString().slice(0,10);st.n=st.d===y?(st.n||1)+1:1;st.d=d;lg('art-st',st);}
// 🗓 지난 그림 모아 보기(최근 14일, 모두에게 같은 목록)
function weekList(){CNT.week=(CNT.week||0)+1;var S=$('sheet');S._k='week';S.innerHTML='<div class="in"><h2>🗓 지난 오늘의 그림</h2><p class="wait" style="position:static;display:block">불러오는 중…</p></div>';S.classList.add('on');
  fetch('/art/week').then(function(r){return r.json();}).then(function(j){var it=j.items||[];var st=lg('art-st')||{};
    S.innerHTML='<div class="in"><h2>🗓 지난 오늘의 그림</h2><div class="en">'+(st.n>1?st.n+'일째 이어서 보는 중 · ':'')+'날마다 한 점씩 · 모두에게 같은 그림</div><div class="wk">'+it.map(function(x,i){return '<div data-w="'+i+'"'+(x.d===TD.today?' class="now"':'')+'><img loading="lazy" src="/art/img?i='+encodeURIComponent(x.art.img)+'&w=400" alt=""><span>'+fmtD(x.d)+' · '+esc(x.ko.title)+'</span></div>';}).join('')+'</div><div class="row"><button id="sClose">닫기</button><button id="sMore">무작위로 더 보기 →</button></div></div>';
    $('sClose').onclick=function(){S.classList.remove('on');};$('sMore').onclick=function(){S.classList.remove('on');next();};
    document.querySelectorAll('[data-w]').forEach(function(d){d.onclick=function(){var x=it[+d.getAttribute('data-w')];if(x.d===TD.today)return showDay(TD);showDay({d:x.d,art:x.art,ko:x.ko,script:x.script||''});};});
  },function(){S.innerHTML='<div class="in"><p class="wait" style="position:static;display:block">네트워크를 확인해 주세요</p><div class="row"><button id="sClose">닫기</button></div></div>';$('sClose').onclick=function(){S.classList.remove('on');};});}
// 📮 공유 카드: 1080×1920 세로(인스타 스토리·카톡). 그림은 같은 도메인 /art/img 라 캔버스가 오염되지 않음
function wrap(c,t,x,y,w,lh,max){var ws=String(t).split(' '),line='',n=0;for(var i=0;i<ws.length;i++){var tt=line?line+' '+ws[i]:ws[i];if(c.measureText(tt).width>w&&line){c.fillText(line,x,y);y+=lh;line=ws[i];if(++n>=max-1){line=ws.slice(i).join(' ');while(c.measureText(line+'…').width>w&&line.length>1)line=line.slice(0,-1);if(i<ws.length-1||c.measureText(ws.slice(i).join(' ')).width>w)line+='…';break;}}else line=tt;}c.fillText(line,x,y);return y+lh;}
function makeCard(){
  if(!CUR)return;CNT.card=(CNT.card||0)+1;var dd=dayOf(),k=(dd&&dd.ko)||(NOTE[CUR.id]||{}).ko||{};
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
    c.fillStyle='#6E6A64';c.font='400 28px Pre,-apple-system,sans-serif';c.fillText(museum(CUR)+' 소장 · 명화 한 점 · voice.zhnote.net/art',W/2,H-90);
    cv.toBlob(function(bl){
      var url=URL.createObjectURL(bl),fn='오늘의그림_'+(dd?dd.d:'art')+'.jpg',f=null;try{f=new File([bl],fn,{type:'image/jpeg'});}catch(e){}
      var can=f&&navigator.canShare&&navigator.canShare({files:[f]}),S=$('sheet');S._k='card';
      S.innerHTML='<div class="in"><h2>📮 공유 카드</h2><div class="en">'+(can?'공유를 누르거나 ':'')+'그림을 길게 눌러 저장할 수 있어요</div><img id="card" src="'+url+'" alt=""><div class="row">'+(can?'<button id="cShare" class="pri">공유하기</button>':'')+'<a class="b" id="cSave" href="'+url+'" download="'+fn+'">저장</a><button id="sBack">← 작품 정보</button><button id="sClose">닫기</button></div></div>';
      $('sClose').onclick=function(){S.classList.remove('on');};$('sBack').onclick=sheet;
      if(can)$('cShare').onclick=function(){navigator.share({files:[f],text:(k.title||CUR.title)+' — 명화 한 점 https://voice.zhnote.net/art'}).catch(function(){});};
    },'image/jpeg',0.9);
  });};
  im.onerror=function(){b.textContent='📮 공유 카드';toast('그림을 못 받았어요');};
  im.src='/art/img?i='+encodeURIComponent(CUR.img)+'&w=1200';
}
// 해설 읽어 주기: 박비서 초대 코드가 이 기기에 있어야 함(내 목소리 = 숏츠용 한국어 복제 목소리). iOS 는 탭 순간 Audio 를 깨워 둠
function sayNote(){
  var b=$('sSay');if(!CUR)return;pPause&&P.ok&&P.st==='play'&&pPause();
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
// ♥ 나의 컬렉션(이 기기의 브라우저에만 저장 — 다른 기기와 자동으로 맞춰지지 않음). 저장 형식 art-fav [{id,t,a,i}] 그대로
function favList(){var f=lg('art-fav')||[],S=$('sheet');S._k='fav';
  S.innerHTML='<div class="in"><h2>♥ 나의 컬렉션</h2><div class="en">이 기기에만 저장돼요 · '+f.length+'점</div>'+(f.length?'<div class="wk">'+f.map(function(x,i){return '<div data-f="'+i+'"><img loading="lazy" src="/art/img?i='+encodeURIComponent(x.i)+'&w=400" alt=""><span>'+esc(x.t)+'</span></div>';}).join('')+'</div>':'<p class="wait" style="position:static;display:block;padding:14px 0">아직 없어요. ♡ 를 눌러 모아 보세요</p>')+'<div class="row"><button id="sClose">닫기</button></div></div>';
  S.classList.add('on');$('sClose').onclick=function(){S.classList.remove('on');};
  document.querySelectorAll('[data-f]').forEach(function(d){d.onclick=function(){var x=f[+d.getAttribute('data-f')];var im=new Image();im.src='/art/img?i='+encodeURIComponent(x.i)+'&w='+imgW();MODE='more';DAY=null;show({a:{id:x.id,title:x.t,artist:x.a,img:x.i,date:'',medium:'',place:'',artistFull:x.a},im:im});};});}
function isFav(){return (lg('art-fav')||[]).some(function(x){return CUR&&x.id===CUR.id;});}
function favBtn(){$('bFav').textContent=isFav()?'♥':'♡';$('bFav').classList.toggle('on',isFav());}
$('bFav').onclick=function(){if(!CUR)return;var f=lg('art-fav')||[];if(isFav())f=f.filter(function(x){return x.id!==CUR.id;});else{f.unshift({id:CUR.id,t:CUR.title,a:CUR.artist,i:CUR.img});CNT.fav=(CNT.fav||0)+1;toast('♥ 나의 컬렉션에 저장했어요');}
  if(lg('art-fav',f.slice(0,200))===null&&!(lg('art-fav')||[]).length&&f.length)toast('이 브라우저는 저장이 막혀 있어요');favBtn();};
$('bNext').onclick=next;$('bInfo').onclick=function(){if(!CUR)return;var S=$('sheet');if(S.classList.contains('on'))S.classList.remove('on');else sheet();};

// ── 확대·이동: 두 손가락 오므리기/벌리기, 두 번 탭(2.5배 ↔ 원래), 확대 중 한 손가락 끌기, 컴퓨터는 휠·더블클릭·끌기
var Z={s:1,x:0,y:0},G=null,lastTap=0,tapT=null,zhT=null;
function zApply(anim){var w=$('zw');w.style.transition=anim?'transform .25s ease':'none';w.style.transform=Z.s===1?'':'translate('+Z.x+'px,'+Z.y+'px) scale('+Z.s+')';$('zhint').classList.toggle('on',Z.s>1);clearTimeout(zhT);if(Z.s>1)zhT=setTimeout(function(){$('zhint').classList.remove('on');},2200);}
function zClamp(){var w=$('zw').getBoundingClientRect(),p=$('pic'),iw=p.offsetWidth,ih=p.offsetHeight,bw=$('zw').offsetWidth,bh=$('zw').offsetHeight;
  var mx=Math.max(0,(iw*Z.s-bw)/2)+bw*0.15,my=Math.max(0,(ih*Z.s-bh)/2)+bh*0.15;Z.x=Math.max(-mx,Math.min(mx,Z.x));Z.y=Math.max(-my,Math.min(my,Z.y));}
function zReset(anim){Z={s:1,x:0,y:0};zApply(anim);}
function zCenter(){var r=$('zw').getBoundingClientRect();return {x:r.left+r.width/2-Z.x,y:r.top+r.height/2-Z.y};} // 변환 전 중심
function zAt(px,py,s){var w=$('zw'),r0={x:w.offsetLeft,y:w.offsetTop},st=$('stage').getBoundingClientRect();var cx=st.left+r0.x+w.offsetWidth/2,cy=st.top+r0.y+w.offsetHeight/2;
  var qx=(px-cx-Z.x)/Z.s,qy=(py-cy-Z.y)/Z.s;Z.s=s;Z.x=px-cx-qx*s;Z.y=py-cy-qy*s;if(Z.s<=1.02){Z={s:1,x:0,y:0};}else zClamp();}
function tapSingle(){if(Z.s>1)return;var S=$('sheet');if(S.classList.contains('on'))S.classList.remove('on');else if(CUR)sheet();}
function peek(){if(!document.body.classList.contains('fr'))return;document.body.classList.add('peek');clearTimeout(peek.t);peek.t=setTimeout(function(){document.body.classList.remove('peek');},5000);}
var st=$('stage');
st.addEventListener('touchstart',function(e){var t=e.touches;
  if(t.length===2){var a=t[0],b=t[1];G={pinch:1,d0:Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY),s0:Z.s,mx:(a.clientX+b.clientX)/2,my:(a.clientY+b.clientY)/2,moved:1};}
  else if(t.length===1){G={x0:t[0].clientX,y0:t[0].clientY,zx:Z.x,zy:Z.y,t0:Date.now(),moved:0};}},{passive:true});
st.addEventListener('touchmove',function(e){if(!G)return;var t=e.touches;
  if(G.pinch&&t.length===2){var a=t[0],b=t[1],d=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY),mx=(a.clientX+b.clientX)/2,my=(a.clientY+b.clientY)/2;
    var s=Math.max(1,Math.min(5,G.s0*d/G.d0));zAt(G.mx,G.my,s);Z.x+=mx-G.mx;Z.y+=my-G.my;G.mx=mx;G.my=my;if(Z.s>1)zClamp();zApply(false);return;}
  if(!G.pinch&&t.length===1){var dx=t[0].clientX-G.x0,dy=t[0].clientY-G.y0;if(Math.abs(dx)+Math.abs(dy)>8)G.moved=1;
    if(Z.s>1){Z.x=G.zx+dx;Z.y=G.zy+dy;zClamp();zApply(false);}}},{passive:true});
st.addEventListener('touchend',function(e){if(!G)return;var g=G;if(e.touches.length)return;G=null;
  if(g.pinch){if(Z.s<=1.05)zReset(true);return;}
  var c=e.changedTouches[0],dx=c.clientX-g.x0,dy=c.clientY-g.y0;
  if(!g.moved&&Date.now()-g.t0<350){var now=Date.now();
    if(now-lastTap<300){clearTimeout(tapT);lastTap=0;if(Z.s>1)zReset(true);else{zAt(c.clientX,c.clientY,2.5);zApply(true);}return;}
    lastTap=now;clearTimeout(tapT);tapT=setTimeout(function(){if(document.body.classList.contains('fr')&&!document.body.classList.contains('peek'))peek();else tapSingle();},300);return;}
  if(Z.s===1&&dx<-60&&Math.abs(dx)>Math.abs(dy)*1.3&&!$('sheet').classList.contains('on'))next(); // 왼쪽으로 밀면 다음 그림
},{passive:true});
// 컴퓨터: 클릭 = 정보, 더블클릭 = 확대, 휠 = 확대·축소, 확대 중 끌기
var md=null,lastTouch=0;st.addEventListener('touchstart',function(){lastTouch=Date.now();},{passive:true});
st.addEventListener('mousedown',function(e){if(Date.now()-lastTouch<800)return;md={x:e.clientX,y:e.clientY,zx:Z.x,zy:Z.y,m:0};});
window.addEventListener('mousemove',function(e){if(!md)return;var dx=e.clientX-md.x,dy=e.clientY-md.y;if(Math.abs(dx)+Math.abs(dy)>4)md.m=1;if(Z.s>1&&md.m){Z.x=md.zx+dx;Z.y=md.zy+dy;zClamp();zApply(false);}});
window.addEventListener('mouseup',function(e){if(!md)return;var m=md;md=null;if(m.m||Date.now()-lastTouch<800)return;clearTimeout(tapT);tapT=setTimeout(function(){if(document.body.classList.contains('fr')&&!document.body.classList.contains('peek'))peek();else tapSingle();},260);});
st.addEventListener('dblclick',function(e){if(Date.now()-lastTouch<800)return;clearTimeout(tapT);if(Z.s>1)zReset(true);else{zAt(e.clientX,e.clientY,2.5);zApply(true);}});
st.addEventListener('wheel',function(e){e.preventDefault();var s=Math.max(1,Math.min(5,Z.s*Math.exp(-e.deltaY*0.0022)));zAt(e.clientX,e.clientY,s);zApply(false);},{passive:false});
// 사파리의 페이지 확대(제스처)는 막고 그림만 확대
document.addEventListener('gesturestart',function(e){e.preventDefault();});

// 액자 모드: 끔 → 3분 → 10분 → 30분, 화면 켜짐 유지, 버튼은 숨기고 탭하면 5초 동안 보임
var FR=[0,3,10,30];
function wake(on){try{if(on&&navigator.wakeLock&&!WL)navigator.wakeLock.request('screen').then(function(w){WL=w;w.addEventListener('release',function(){WL=null;});}).catch(function(){});if(!on&&WL){WL.release();WL=null;}}catch(e){}}
$('bFrame').onclick=function(){FRAME=(FRAME+1)%FR.length;clearInterval(FT);var m=FR[FRAME];$('bFrame').textContent=m?'🖼 '+m+'분':'🖼 액자';$('bFrame').classList.toggle('on',!!m);
  document.body.classList.toggle('fr',!!m);$('sheet').classList.remove('on');
  if(m){FT=setInterval(next,m*60000);wake(true);toast(m+'분마다 다음 그림 · 화면 켜 둠 · 화면을 탭하면 버튼이 보여요');CNT.frame=1;peek();}else{wake(false);document.body.classList.remove('peek');toast('액자 모드 끔');}};
document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible'&&FR[FRAME])wake(true);
  if(document.visibilityState==='hidden'){if(P.st==='play')pPause();try{navigator.sendBeacon('/u',JSON.stringify({app:'art',c:CNT,sec:Math.round((Date.now()-T0)/1000)}));}catch(e){}CNT={};T0=Date.now();}});
// 숨 고르기: 4초 들이쉬고 · 2초 멈추고 · 4초 내쉬기(10초 주기) × 6번 = 1분. 도슨트를 듣는 중이면 안내 글자는 숨기고 원만
var BT=null;$('bBreath').onclick=function(){var b=$('breath');if(b.classList.contains('on')){b.classList.remove('on');clearInterval(BT);$('bBreath').classList.remove('on');return;}
  b.classList.add('on');$('bBreath').classList.add('on');CNT.breath=(CNT.breath||0)+1;var t=0;var step=function(){var s=t%10;b.classList.toggle('quiet',P.st==='play'||(AU&&!AU.paused));$('bt').textContent=s<4?'들이쉬고…':s<6?'잠깐 멈추고…':'천천히 내쉬고…';t++;if(t>=60){b.classList.remove('on');clearInterval(BT);$('bBreath').classList.remove('on');toast('1분 쉬었어요');}};step();BT=setInterval(step,1000);};
// 캡션·아래 막대 위에서도 왼쪽으로 밀면 다음 그림(기존 동작 유지)
var sx=0,sy=0;$('dock').addEventListener('touchstart',function(e){sx=e.touches[0].clientX;sy=e.touches[0].clientY;},{passive:true});
$('dock').addEventListener('touchend',function(e){var dx=e.changedTouches[0].clientX-sx,dy=e.changedTouches[0].clientY-sy;if(dx<-60&&Math.abs(dx)>Math.abs(dy)*1.3&&!e.target.closest('.bar'))next();},{passive:true});
document.addEventListener('keydown',function(e){if(e.target&&/INPUT|TEXTAREA/.test(e.target.tagName))return;if(e.key==='ArrowRight')next();if(e.key===' '){e.preventDefault();pToggle();}if(e.key==='i')$('bInfo').onclick();if(e.key==='Escape'){$('sheet').classList.remove('on');zReset(true);}});
fitDock();
fetch('/art/today').then(function(r){return r.json();}).then(function(j){if(j.error||!j.art)throw new Error(j.error||'');TD=j;streak(j.today);CNT.today=1;
  if(!j.ready){TD.today=j.d;} // 오늘 판이 아직이면 가장 최근 그림을 오늘로 보여 줌
  showDay(TD);}).catch(function(){MODE='more';chip();fetchNext().then(show).catch(function(e){$('wait').style.display='flex';$('wait').textContent=e.message||'불러오지 못했어요. 잠시 뒤 새로고침해 주세요';});});
</script></body></html>`;
