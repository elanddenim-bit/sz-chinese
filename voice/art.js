// =========================================================
// 🖼 명화 한 점 — 시카고 미술관(AIC)·클리블랜드 미술관(CMA, CC0) 공개 API 의 퍼블릭 도메인 그림을 한 점씩 화면 가득 + 千问 한국어 3줄 해설
//  GET /art              화면(초대 코드 없음 — 저장 없음, 좋아요·본 그림은 기기 localStorage)
//  GET /art/next         {id, title, artist, date, medium, place, img, w, h} 무작위 그림 한 점(그림만, 이미지 있는 것)
//  GET /art/note?id      {ko:{title, artist, lines[3], look}} 해설 — KV art:n:<id> 에 영구 캐시(같은 그림은 한 번만 생성), 하루 생성 ART_DAY_MAX(기본 200)
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

async function note(env, id) {
  const k = "art:n:" + id;
  const hit = await env.KV.get(k, "json");
  if (hit) return hit;
  const dk = "art:day:" + cnDay(), used = Number(await env.KV.get(dk)) || 0;
  if (used >= (Number(env.ART_DAY_MAX) || 200)) throw new Error("오늘 해설은 다 썼어요. 내일 다시.");
  let info;
  if (String(id)[0] === "c") {
    const r = await fetch(CMA + String(id).slice(1), { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error("그림 정보를 못 받았어요 " + r.status);
    const a = ((await r.json()) || {}).data || {};
    info = { title: a.title, artist: ((a.creators || [])[0] || {}).description, date: a.creation_date, medium: a.technique, place: (a.culture || []).join(", "), dept: a.department,
      about: strip([a.description, a.did_you_know, a.wall_description].filter(Boolean).join(" ")).slice(0, 1800), museum: "Cleveland Museum of Art" };
  } else {
    const r = await fetch(AIC + "/artworks/" + id + "?fields=" + FIELDS, { headers: UA });
    if (!r.ok) throw new Error("그림 정보를 못 받았어요 " + r.status);
    const a = ((await r.json()) || {}).data || {};
    info = { title: a.title, artist: strip(a.artist_display), date: a.date_display, medium: a.medium_display, place: a.place_of_origin, style: a.style_title, dept: a.department_title,
      about: strip(a.description || a.short_description).slice(0, 1800), museum: "Art Institute of Chicago" };
  }
  await env.KV.put(dk, String(used + 1), { expirationTtl: 3 * 86400 });
  const sys = "너는 미술관 도슨트다. 지친 직장인이 1분 동안 그림 한 점을 보며 쉬도록 한국어로 짧게 안내한다. 미술사 강의 말고, 다정하고 담백한 구어체(~예요/~죠). " +
    "주어진 정보에 없는 사실(연도·사연·소장 경위)은 지어내지 마라. 작가가 유명하면 널리 알려진 사실 한 가지 정도는 괜찮다. " +
    'JSON 만: {"title":"한국어 제목(원제 뜻)","artist":"작가 한국어 표기 · 나라 · 생몰년(정보에 있으면)","lines":["무엇을 그렸는지 1문장","언제·어떤 배경에서 1문장","재미있는 점 1문장"],"look":"지금 그림에서 어디를 보면 좋은지 한 문장(예: 오른쪽 아래 물결에 비친 빛을 보세요)"}';
  let last = "";
  for (const model of [env.ART_MODEL, env.QUEST_MODEL || "qwen3.8-flash", "qwen-plus"].filter(Boolean)) {
    try {
      const q = await fetch("https://" + host(env) + "/compatible-mode/v1/chat/completions", {
        method: "POST", headers: { authorization: "Bearer " + env.DASHSCOPE_API_KEY, "content-type": "application/json" },
        body: JSON.stringify({ model, temperature: 0.5, enable_thinking: false, response_format: { type: "json_object" }, messages: [{ role: "system", content: sys }, { role: "user", content: JSON.stringify(info) }] }),
      });
      if (!q.ok) { last = model + " " + q.status; continue; }
      const c = String(((await q.json()).choices || [{}])[0].message.content || "");
      const o = JSON.parse(c.slice(c.indexOf("{"), c.lastIndexOf("}") + 1));
      const out = { ko: { title: String(o.title || "").slice(0, 80), artist: String(o.artist || "").slice(0, 80), lines: (Array.isArray(o.lines) ? o.lines : []).map((x) => String(x).slice(0, 160)).slice(0, 3), look: String(o.look || "").slice(0, 160) } };
      if (!out.ko.lines.length) { last = model + ": 빈 해설"; continue; }
      await env.KV.put(k, JSON.stringify(out));
      return out;
    } catch (e) { last = model + ": " + String(e.message || e).slice(0, 80); }
  }
  throw new Error("해설을 못 만들었어요(" + last + ")");
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
      const r = await fetch("https://" + host(env) + "/api/v1/services/aigc/multimodal-generation/generation", { method: "POST", headers: { authorization: "Bearer " + env.DASHSCOPE_API_KEY, "content-type": "application/json" },
        body: JSON.stringify({ model: env.SHORTS_TTS_MODEL || "qwen3-tts-flash", input: { text, voice: "Ethan", language_type: "Korean" } }) });
      const j = await r.json().catch(() => ({})), u = j.output && j.output.audio && j.output.audio.url;
      if (!u) throw new Error("음성 합성 실패: " + (j.message || r.status));
      const a = await fetch(u); if (!a.ok) throw new Error("오디오 받기 실패");
      audio = new Uint8Array(await a.arrayBuffer()); ext = ".wav";
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
  try {
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
.toast{position:fixed;left:50%;top:calc(env(safe-area-inset-top) + 56px);transform:translateX(-50%);background:rgba(0,0,0,.75);color:#fff;padding:8px 14px;border-radius:999px;font-size:13.5px;z-index:9}
</style></head><body>
<div id="stage"><img id="pic" alt=""><div class="wait" id="wait">그림 고르는 중…</div></div>
<div id="cap"><b id="ct"></b><small id="cs"></small></div>
<div id="top"><button id="bBreath">🫧 숨</button><button id="bFrame">🖼 액자</button><button id="bFav">♡</button></div>
<button class="btn" id="bInfo" aria-label="해설">ⓘ</button><button class="btn" id="bNext" aria-label="다음 그림">→</button>
<div id="breath"><i></i><span id="bt">들이쉬고…</span></div>
<div id="sheet"></div>
<script>
var PB='';try{PB=localStorage.getItem('pb-code')||'';}catch(e){}
var AU=null,SAY={};
var CUR=null,NOTE={},PRE=null,FRAME=0,FT=null,WL=null,CNT={open:1},T0=Date.now();
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
  $('ct').textContent=CUR.title;$('cs').textContent=[CUR.artist,CUR.date].filter(Boolean).join(' · ');
  favBtn();$('sheet').classList.remove('on');
  var h=lg('art-seen')||[];h.unshift({id:CUR.id,t:CUR.title,a:CUR.artist,i:CUR.img});lg('art-seen',h.slice(0,60));
  loadNote(CUR.id);PRE=fetchNext().catch(function(){return null;});
}
function next(){CNT.next=(CNT.next||0)+1;var p=PRE;PRE=null;(p||fetchNext()).then(function(x){if(x)show(x);else return fetchNext().then(show);}).catch(function(e){$('wait').style.display='block';$('wait').textContent=e.message||'네트워크를 확인해 주세요';});}
function loadNote(id){if(NOTE[id])return;NOTE[id]='…';fetch('/art/note?id='+id).then(function(r){return r.json();}).then(function(j){NOTE[id]=j.ko?j:{err:j.error||'해설 없음'};if($('sheet').classList.contains('on')&&CUR&&CUR.id===id)sheet();},function(){NOTE[id]={err:'네트워크'};});}
function sheet(){
  var n=NOTE[CUR.id],k=n&&n.ko,h='';
  h+='<h2>'+esc(k&&k.title||CUR.title)+'</h2><div class="en">'+esc(CUR.title)+'</div>';
  h+='<div class="who">'+esc(k&&k.artist||CUR.artistFull||CUR.artist)+'</div>';
  if(k){h+='<ol>'+k.lines.map(function(l){return '<li>'+esc(l)+'</li>';}).join('')+'</ol>';if(k.look)h+='<div class="look">👀 '+esc(k.look)+'</div>';}
  else h+='<p class="wait">'+(n&&n.err?esc(n.err):'해설 쓰는 중…')+'</p>';
  var cm=String(CUR.id).charAt(0)==='c';
  h+='<div class="meta">'+esc([CUR.date,CUR.medium,CUR.place].filter(Boolean).join(' · '))+'<br>'+(cm?'클리블랜드 미술관 소장 · CC0':'시카고 미술관 소장 · 퍼블릭 도메인')+' · 해설은 AI가 써서 틀릴 수 있어요</div>';
  if(k)h+='<div class="row"><button id="sSay" style="border-color:var(--sky);background:var(--sky)">🔊 내 목소리로 듣기</button></div>';
  h+='<div class="row"><button id="sClose">닫기</button><button id="sFavs">♥ 좋아한 그림 '+(lg('art-fav')||[]).length+'</button><a href="'+(cm?'https://www.clevelandart.org/art/'+esc(String(CUR.id).slice(1)):'https://www.artic.edu/artworks/'+CUR.id)+'" target="_blank" rel="noopener" style="color:var(--ink2);font-size:13px;align-self:center">미술관 페이지 ↗</a></div>';
  $('sheet').innerHTML=h;$('sheet').classList.add('on');CNT.info=(CNT.info||0)+1;
  $('sClose').onclick=function(){$('sheet').classList.remove('on');if(AU)AU.pause();};
  $('sFavs').onclick=favList;
  if($('sSay'))$('sSay').onclick=sayNote;
}
// 해설 읽어 주기: 박비서 초대 코드가 이 기기에 있어야 함(내 목소리 = 숏츠용 한국어 복제 목소리). iOS 는 탭 순간 Audio 를 깨워 둠
function sayNote(){
  var b=$('sSay');if(!CUR)return;
  if(AU&&!AU.paused&&AU._id===CUR.id){AU.pause();b.textContent='🔊 내 목소리로 듣기';return;}
  if(!PB){var c=prompt('박비서 초대 코드를 넣어 주세요 (내 목소리를 쓰려면 한 번만)');if(!c)return;PB=c.trim();try{localStorage.setItem('pb-code',PB);}catch(e){}}
  if(!AU)AU=new Audio();AU.src='data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';try{AU.play().catch(function(){});}catch(e){}
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
fetchNext().then(show).catch(function(e){$('wait').textContent=e.message||'불러오지 못했어요';});
</script></body></html>`;
