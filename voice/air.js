// =========================================================
// 🕵️ 미스터리 기내편 — 그림이 있는 오프라인 추리 게임 (주인·초대 코드 공용, 비행기 모드에서 플레이)
//  GET  /air/                        화면(서비스워커 범위, /air → 302)
//  GET  /air/sw.js                   서비스워커(화면·그림·음성 캐시)
//  GET  /air/img?k&s                 그림(R2 air/<해시>/<사건>/<k>.png, 서명)
//  GET  /air/say?id&s                용의자 중국어 대사 읽어 주기(CosyVoice, R2 tts/air/<id>.mp3)
//  POST /air/state {code}            → {cases[], hist, total, genres}
//  POST /air/new   {code, genre, gps?} → 디디 /api/poi 로 광저우 실제 장소 4곳 → 千问이 사건 전체(용의자 4·심문 분기 3라운드·장소 조사·단서·진상)
//                                       → 通义万相 그림 8장(용의자 초상 4·장소 삽화 4) 비동기 시작. 하루 AIR_DAY_MAX(기본 3)건
//  POST /air/poll  {code, id}        → 그림 작업 확인·R2 저장 → {imgs:{k:url}, pending}
//  POST /air/done  {code, id, ok, who, score} → 기록·점수, 사건·그림 삭제
//  POST /air/drop  {code, id}
// 플레이는 전부 폰 안(localStorage air-cases·air-play:<id>): 장소 조사 → 단서, 용의자 심문(라운드마다 질문 하나만 고를 수 있음 — 다 못 물음), 힌트 -15, 지목 1번.
// 진상은 base64 로 보내 화면이 지목 때만 풀어 봄. 실제 장소는 무대만, 범인·악역은 가상, 살인·폭력 없음(기존 미스터리와 같은 규칙).
// [필수] AI 는 百炼(千问·通义万相·CosyVoice)만 — Anthropic 호출 없음
// =========================================================
import { logUse } from "./usage.js";

const KW = ["老街", "骑楼", "公园", "博物馆", "书店", "茶楼", "寺", "码头", "市场", "咖啡馆", "创意园", "图书馆", "美术馆", "古村"];
const GENRES = {
  classic: { label: "🕵️ 정통 추리", d: "经典本格推理：一件神秘的失窃/调包/失踪案（不是凶杀），线索公平，玩家能推理出唯一真相" },
  ghost: { label: "🏮 괴담(안 무서움)", d: "岭南民间怪谈风格：看似灵异的怪事，最后真相是人为的、温暖或有点好笑，不血腥不恐怖" },
  biz: { label: "🏭 공장 사건", d: "服装外贸行业的商业谜案：样品失踪、报价泄露、面料被调包之类（虚构工厂与人物），带一点行业内幕的趣味" },
};
const cnDay = (t = Date.now()) => new Date(t + 8 * 3600e3).toISOString().slice(0, 10);
const host = (env) => (env.DASHSCOPE_WS_HOST || "dashscope.aliyuncs.com").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
const aerr = (message, status = 400) => Object.assign(new Error(message), { code: "air", status });
async function hmac16(env, s) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode("ar|" + (env.ALLOWED_CODES || "") + (env.DASHSCOPE_API_KEY || "")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(s));
  return [...new Uint8Array(sig)].slice(0, 8).map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function load(env, h) { const d = (await env.KV.get("air:" + h, "json")) || {}; return { cases: d.cases || {}, hist: d.hist || [], total: d.total || 0, gen: d.gen || {} }; }
const save = (env, h, d) => env.KV.put("air:" + h, JSON.stringify(d));
const b64u = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o))));

async function qwen(env, models, messages, temperature = 0.9) {
  let last = "";
  for (const model of models.filter(Boolean)) {
    for (let k = 0; k < 2; k++) {
      let r;
      try {
        r = await fetch("https://" + host(env) + "/compatible-mode/v1/chat/completions", { method: "POST", headers: { authorization: "Bearer " + env.DASHSCOPE_API_KEY, "content-type": "application/json" },
          body: JSON.stringify({ model, messages, temperature, response_format: { type: "json_object" }, enable_thinking: false, max_tokens: 8000 }) });
      } catch (e) { last = String(e.message || e); continue; }
      const t = await r.text();
      let j = {}; try { j = JSON.parse(t); } catch {}
      if (!r.ok) { last = model + " " + r.status + ": " + ((j.error && j.error.message) || t.slice(0, 120)); if (r.status >= 500 || r.status === 429) { await new Promise((ok) => setTimeout(ok, 1500)); continue; } break; }
      const c = String((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "").replace(/^```(?:json)?\s*|\s*```$/g, "");
      try { return JSON.parse(c); } catch {}
      const a = c.indexOf("{"), z = c.lastIndexOf("}");
      if (a >= 0 && z > a) try { return JSON.parse(c.slice(a, z + 1)); } catch {}
      last = model + ": JSON 아님";
    }
  }
  throw aerr("千问 오류: " + last + " — 잠시 뒤 다시 눌러 주세요.", 502);
}
async function t2i(env, prompt, size) {
  try {
    const r = await fetch("https://" + host(env) + "/api/v1/services/aigc/text2image/image-synthesis", {
      method: "POST", headers: { authorization: "Bearer " + env.DASHSCOPE_API_KEY, "content-type": "application/json", "X-DashScope-Async": "enable" },
      body: JSON.stringify({ model: env.AIR_T2I_MODEL || env.SHORTS_T2I_MODEL || "wan2.5-t2i-preview", input: { prompt: prompt.slice(0, 500), negative_prompt: "文字，字幕，水印，logo，低质量，畸形的手，多余的手指，血腥" }, parameters: { size, n: 1, prompt_extend: true, watermark: false } }),
    });
    const j = await r.json().catch(() => ({}));
    return (j.output && j.output.task_id) || "";
  } catch { return ""; }
}
async function sayReg(env, text) {
  const t = String(text || "").trim().slice(0, 120);
  if (!t) return "";
  const id = await hmac16(env, "t|" + t);
  await env.KV.put("air:say:" + id, t, { expirationTtl: 30 * 86400 });
  return "/air/say?id=" + id + "&s=" + (await hmac16(env, "s|" + id));
}
const imgUrl = async (env, k) => "/air/img?k=" + encodeURIComponent(k) + "&s=" + (await hmac16(env, k));

async function viewCase(env, c) {
  const imgs = {};
  for (const im of c.imgs) if (im.key) imgs[im.k] = await imgUrl(env, im.key);
  return { id: c.id, made: c.made, genre: c.genre, title: c.title, intro: c.intro, suspects: c.suspects, places: c.places, imgs, pending: c.imgs.filter((x) => x.task).length, failed: c.imgs.filter((x) => !x.task && !x.key).length, truth: c.truth };
}
async function view(env, d) {
  const cases = [];
  for (const id of Object.keys(d.cases).sort()) cases.push(await viewCase(env, d.cases[id]));
  return { ok: true, cases, hist: d.hist.slice(0, 30), total: d.total, genres: Object.fromEntries(Object.entries(GENRES).map(([k, g]) => [k, g.label])) };
}

export async function airApi(env, ctx, path, b, h) {
  if (path === "/air/state") return view(env, await load(env, h));
  if (path === "/air/new") return newCase(env, ctx, b, h);
  if (path === "/air/poll") return poll(env, b, h);
  if (path === "/air/done") return done(env, ctx, b, h);
  if (path === "/air/drop") { const d = await load(env, h); await removeCase(env, h, d, String(b.id || "")); await save(env, h, d); return view(env, d); }
  throw aerr("not_found", 404);
}

async function newCase(env, ctx, b, h) {
  const d = await load(env, h);
  if (Object.keys(d.cases).length >= 4) throw aerr("담아 둔 사건이 4개예요. 하나 풀거나 지우고 다시 만들어요.");
  const day = cnDay(), max = Number(env.AIR_DAY_MAX) || 3;
  if ((d.gen[day] || 0) >= max) throw aerr("오늘은 사건을 " + max + "건 만들었어요. 내일 다시!", 429);
  if (!env.DIDI || !env.DIDI_ACCESS_KEY) throw aerr("장소 검색 서버(디디 주소록) 연결이 없습니다", 500);
  const genre = GENRES[b.genre] ? b.genre : "classic";
  const gps = /^-?\d+\.\d+,-?\d+\.\d+$/.test(String(b.gps || "")) ? String(b.gps) : "113.2644,23.1291"; // 기본 광저우 시내
  const poiRes = await env.DIDI.fetch("https://didi/api/poi", { method: "POST", headers: { "x-access-key": env.DIDI_ACCESS_KEY, "content-type": "application/json" }, body: JSON.stringify({ gps, radius: 15000, kw: KW }) }).then((r) => r.json());
  if (!poiRes.ok) throw aerr("무대로 쓸 장소를 못 찾았어요: " + (poiRes.error || ""), 502);
  const used = new Set(d.hist.flatMap((x) => x.pids || []).concat(Object.values(d.cases).flatMap((c) => c.pids || [])));
  const byKw = {};
  for (const p of (poiRes.pois || []).filter((p) => !used.has(p.id)).sort((a, c) => (c.rating || 3) - (a.rating || 3))) (byKw[p.kw] = byKw[p.kw] || []).push(p);
  const cands = Object.values(byKw).flatMap((l) => l.slice(0, 3)).slice(0, 36);
  if (cands.length < 4) throw aerr("무대로 쓸 장소가 부족해요.");
  const list = cands.map((p, i) => ({ i, name: p.name, type: p.type, kw: p.kw, area: p.area }));
  const sys = "你是互动推理游戏的编剧。玩家是住在广州的韩国中年男性，在飞机上离线玩：读案情、到4个地点'调查'、审问4个嫌疑人（每轮只能选一个问题问，问了就不能问另外的）、最后指认一人。题材：" + GENRES[genre].d + "。\n" +
    "规则：1) 从候选真实地点选4个当舞台（类型不同），真实地点只当背景，所有人物、事件都是虚构的，不要暗示真实店铺有负面行为。2) 不能有凶杀、血腥、暴力、色情、政治。" +
    "3) 4个嫌疑人：虚构中文名（korean 字段写韩语读法），职业、性格、外貌各不同、有记忆点；其中1人是真相（culprit 0~3）。每人3轮审问，每轮3个可选问题，每个问题有回答。回答要有人味（回避、生气、撒谎、无意说漏嘴），真相人物的谎言必须能被某条线索戳穿。" +
    "4) 线索要公平：地点调查4条 + 审问里藏的线索(clue 字段，没线索就留空串)合起来能推理出唯一答案，也要有1~2条误导；单条不够。玩家每轮只能问一个问题，所以关键线索要在不同轮、不同人物之间分散并有冗余（至少两条路能到真相）。" +
    "5) 全部用韩语写，第二人称'당신'，有画面感。嫌疑人的每个回答另给一句中文口语 az（10~20字，像真人说话）和它的韩语 a；问题也给中文 qz。look 是给绘图模型的中文人物外貌描述(40字内：年龄、性别、发型、服装、表情、职业感)，不要真实名人。scene 是地点插画的中文描述(40字内：时间、天气、氛围)。" +
    "6) ending 揭晓真相(5~8句，逐条说明线索怎么指向真相)，wrong 猜错结局(2~3句，不剧透)，hints 2条(每条一句，越来越直接)。\n" +
    '只输出 JSON：{"title":"","intro":"3~5句开场，案件是什么、玩家为什么卷入","suspects":[{"name":"","korean":"","role":"","desc":"2句性格外貌","alibi":"本人声称的不在场说明1句","look":"","rounds":[[{"q":"","qz":"","a":"","az":"","clue":""},{...},{...}],[...],[...]]}],' +
    '"places":[{"i":候选编号,"title":"章节标题","story":"到达时的描写3~4句","scene":"","search":"调查后发现的东西2~3句","clue":"这条线索一句话"}],"culprit":0,"hints":["",""],"ending":"","wrong":""}';
  const out = await qwen(env, [env.AIR_MODEL, env.MYST_MODEL, "qwen-plus", env.QUEST_MODEL || "qwen3.8-flash"], [{ role: "system", content: sys }, { role: "user", content: "候选地点：" + JSON.stringify(list) }]);
  const S = (x, n) => String(x == null ? "" : x).slice(0, n);
  const seen = new Set();
  const places = (Array.isArray(out.places) ? out.places : []).filter((x) => cands[Number(x.i)] && !seen.has(Number(x.i)) && seen.add(Number(x.i))).slice(0, 4).map((x, k) => {
    const p = cands[Number(x.i)];
    return { k: "p" + k, name: p.name, area: p.area, title: S(x.title || p.name, 40), story: S(x.story, 600), scene: S(x.scene, 80), search: S(x.search, 500), clue: S(x.clue, 240), pid: p.id };
  });
  const suspects = [];
  for (const [k, s] of (Array.isArray(out.suspects) ? out.suspects : []).slice(0, 4).entries()) {
    const rounds = [];
    for (const r of (Array.isArray(s.rounds) ? s.rounds : []).slice(0, 3)) {
      const opts = [];
      for (const o of (Array.isArray(r) ? r : []).slice(0, 3)) opts.push({ q: S(o.q, 120), qz: S(o.qz, 60), a: S(o.a, 400), az: S(o.az, 60), clue: S(o.clue, 200), say: await sayReg(env, S(o.az, 60)) });
      if (opts.length >= 2) rounds.push(opts);
    }
    suspects.push({ k: "s" + k, name: S(s.name, 20), korean: S(s.korean, 20), role: S(s.role, 40), desc: S(s.desc, 240), alibi: S(s.alibi, 200), look: S(s.look, 80), rounds });
  }
  const culprit = Number(out.culprit);
  if (places.length < 3 || suspects.length < 3 || suspects.some((s) => s.rounds.length < 2) || !(culprit >= 0 && culprit < suspects.length)) throw aerr("사건 설계가 엉성하게 나왔어요. 다시 눌러 주세요.", 502);
  const id = "a" + Date.now().toString(36);
  // 그림 8장 비동기 시작(초상 4·장소 4). 실패한 작업은 그림 없이 진행
  const imgs = [];
  for (const s of suspects) imgs.push({ k: s.k, task: await t2i(env, "半身人物插画，" + s.look + "，侦探小说风格，电影感柔和光线，简洁背景，正视镜头", "768*1024"), key: "" });
  for (const p of places) imgs.push({ k: p.k, task: await t2i(env, "广州 " + p.name + "，" + p.scene + "，电影感插画，氛围光，没有人物正脸", "1024*768"), key: "" });
  d.cases[id] = { id, made: Date.now(), genre, title: S(out.title || "광저우 미스터리", 50), intro: S(out.intro, 700), suspects, places, imgs, pids: places.map((p) => p.pid),
    truth: b64u({ culprit, hints: (Array.isArray(out.hints) ? out.hints : []).map((x) => S(x, 200)).slice(0, 2), ending: S(out.ending, 1200), wrong: S(out.wrong, 400) }) };
  d.gen = { [day]: (d.gen[day] || 0) + 1 };
  await save(env, h, d);
  ctx.waitUntil(logUse(env, "air", { new: 1 }, 0, h).catch(() => {}));
  return { ...(await view(env, d)), made: id };
}

async function poll(env, b, h) {
  const d = await load(env, h), c = d.cases[String(b.id || "")];
  if (!c) throw aerr("사건을 찾지 못했어요.", 404);
  let changed = false;
  for (const im of c.imgs) {
    if (!im.task) continue;
    const r = await fetch("https://" + host(env) + "/api/v1/tasks/" + im.task, { headers: { authorization: "Bearer " + env.DASHSCOPE_API_KEY } });
    const j = await r.json().catch(() => ({}));
    const st = (j.output && j.output.task_status) || "UNKNOWN";
    if (st === "PENDING" || st === "RUNNING") continue;
    const hit = ((j.output && j.output.results) || []).find((x) => x && x.url);
    if (st === "SUCCEEDED" && hit) {
      const r2 = await fetch(hit.url);
      if (r2.ok) { im.key = "air/" + h + "/" + c.id + "/" + im.k + ".png"; await env.R2.put(im.key, r2.body, { httpMetadata: { contentType: "image/png" } }); }
    }
    im.task = ""; changed = true;
  }
  if (changed) await save(env, h, d);
  return { ok: true, case: await viewCase(env, c) };
}

async function removeCase(env, h, d, id) {
  const c = d.cases[id];
  if (!c) return;
  const keys = c.imgs.map((x) => x.key).filter(Boolean);
  if (keys.length) await env.R2.delete(keys).catch(() => {});
  delete d.cases[id];
}
async function done(env, ctx, b, h) {
  const d = await load(env, h), id = String(b.id || ""), c = d.cases[id];
  const ok = !!b.ok, score = ok ? Math.max(0, Math.min(100, Number(b.score) || 0)) : 0;
  if (c && !d.hist.some((x) => x.id === id)) {
    d.hist.unshift({ id, title: c.title, genre: c.genre, date: cnDay(), ok, score, who: String(b.who || "").slice(0, 20), pids: c.pids });
    d.hist = d.hist.slice(0, 60); d.total += score;
    await removeCase(env, h, d, id);
    await save(env, h, d);
    ctx.waitUntil(logUse(env, "air", { [ok ? "solve" : "wrong"]: 1 }, 0, h).catch(() => {}));
  }
  return view(env, d);
}

export async function airGet(req, env, url, synth) {
  if (url.pathname === "/air") return Response.redirect(new URL("/air/", url).toString(), 302);
  if (url.pathname === "/air/") return new Response(AIR_HTML, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
  if (url.pathname === "/air/sw.js") return new Response(AIR_SW, { headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-cache" } });
  if (url.pathname === "/air/img") {
    const k = url.searchParams.get("k") || "";
    if (!/^air\/[0-9a-f]{12}\/a[0-9a-z]+\/[sp]\d\.png$/.test(k) || url.searchParams.get("s") !== (await hmac16(env, k))) return new Response("forbidden", { status: 403 });
    const o = await env.R2.get(k);
    if (!o) return new Response("not found", { status: 404 });
    return new Response(o.body, { headers: { "content-type": "image/png", "cache-control": "private, max-age=31536000" } });
  }
  if (url.pathname === "/air/say") {
    const id = String(url.searchParams.get("id") || "");
    if (!/^[0-9a-f]{16}$/.test(id) || url.searchParams.get("s") !== (await hmac16(env, "s|" + id))) return new Response("forbidden", { status: 403 });
    const key = "tts/air/" + id + ".mp3", head = { "content-type": "audio/mpeg", "cache-control": "private, max-age=31536000" };
    const hit = await env.R2.get(key);
    if (hit) return new Response(hit.body, { headers: head });
    const t = await env.KV.get("air:say:" + id);
    if (!t) return new Response("expired", { status: 404 });
    let mp3;
    try { mp3 = await synth(env, env.AIR_VOICE || env.QUEST_VOICE || "longxiaochun_v2", t, env.QUEST_TTS_MODEL || "cosyvoice-v2"); } catch (e) { return new Response("tts: " + String(e.message || e).slice(0, 160), { status: 502 }); }
    await env.R2.put(key, mp3, { httpMetadata: { contentType: "audio/mpeg" } });
    return new Response(mp3, { headers: head });
  }
  return new Response("not found", { status: 404 });
}

const AIR_SW = `const C='air-v1';
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.add('/air/')).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('air-')&&k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET')return;
  if(u.pathname==='/air/img'||u.pathname==='/air/say'){e.respondWith(caches.open(C).then(async c=>{const hit=await c.match(e.request);if(hit)return hit;const r=await fetch(e.request);if(r.ok)c.put(e.request,r.clone());return r;}));return;}
  if(u.pathname==='/air/'||u.pathname==='/air'){e.respondWith(fetch(e.request).then(r=>{if(r.ok)caches.open(C).then(c=>c.put('/air/',r.clone()));return r;}).catch(()=>caches.match('/air/')));return;}
});`;

export const AIR_HTML = String.raw`<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#1A2330">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="미스터리 기내편">
<link rel="apple-touch-icon" href="/icon-180.png">
<title>미스터리 기내편</title>
<style>
@font-face{font-family:Pretendard;font-weight:400;font-display:swap;src:url(/fonts/pretendard-400.woff2) format("woff2")}
@font-face{font-family:Pretendard;font-weight:700;font-display:swap;src:url(/fonts/pretendard-700.woff2) format("woff2")}
:root{--bg:#141A22;--card:#1C2430;--ink:#EDE6DA;--ink2:#9AA3AE;--line:#2C3644;--red:#D21624;--sky:#4A8FD8;--soft:#253041;--gold:#E0B25A}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 Pretendard,-apple-system,"Apple SD Gothic Neo","PingFang SC",system-ui,sans-serif;-webkit-text-size-adjust:100%}
header{background:#0F141B;padding:calc(env(safe-area-inset-top) + 12px) 16px 10px;border-bottom:2px solid var(--red);display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:5}
header h1{margin:0;font-size:18px;flex:1}a.back,button.back{color:var(--ink);text-decoration:none;font-size:22px;background:none;border:0;padding:0 4px}header small{font-size:12.5px;color:var(--ink2)}
main{max-width:640px;margin:0 auto;padding:12px 14px 80px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:12px}
.card h2{margin:0 0 6px;font-size:18px}.muted{color:var(--ink2);font-size:13.5px}.lbl{font-size:12.5px;color:var(--ink2);margin:10px 0 4px;font-weight:700}
.chips{display:flex;gap:6px;flex-wrap:wrap}.chip{font:inherit;font-size:13.5px;border:1px solid var(--line);border-radius:999px;padding:6px 12px;background:transparent;color:var(--ink)}.chip.on{background:var(--sky);color:#fff;border-color:var(--sky)}
button.big{display:block;width:100%;font:inherit;font-weight:700;font-size:16px;border:0;border-radius:12px;padding:13px;background:var(--red);color:#fff;margin-top:10px}button.big:disabled{opacity:.5}button.ghost{background:transparent;border:1px solid var(--line);color:var(--ink)}
.cs{display:flex;gap:12px;align-items:center}.cs img,.cs .ph{width:72px;height:96px;object-fit:cover;border-radius:10px;background:var(--soft);flex:none}.cs b{font-size:16px}
.tabs{display:flex;gap:4px;margin:6px 0 12px;position:sticky;top:calc(env(safe-area-inset-top) + 50px);background:var(--bg);padding:6px 0;z-index:4}.tabs button{flex:1;font:inherit;font-size:13.5px;border:1px solid var(--line);background:transparent;color:var(--ink2);border-radius:10px;padding:8px 2px}.tabs button.on{background:var(--soft);color:var(--ink);border-color:var(--sky)}
.scene{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:12px;background:var(--soft);display:block;margin-bottom:10px}
.por{width:110px;height:146px;object-fit:cover;border-radius:12px;background:var(--soft);float:left;margin:0 12px 6px 0}
.clr{clear:both}
.opt{display:block;width:100%;text-align:left;font:inherit;border:1px solid var(--line);background:var(--soft);color:var(--ink);border-radius:10px;padding:10px 12px;margin:6px 0}.opt small{display:block;color:var(--ink2);font-size:12.5px}
.ans{background:#0F141B;border-left:3px solid var(--gold);padding:10px 12px;border-radius:0 10px 10px 0;margin:8px 0}.ans .zh{font-size:17px;color:var(--gold)}.ans .q{color:var(--ink2);font-size:13.5px}
.clue{background:#2A2418;border:1px solid #5A4A22;border-radius:10px;padding:8px 10px;margin:6px 0;font-size:14.5px}.clue b{color:var(--gold)}
button.say{border:0;background:var(--sky);color:#fff;border-radius:50%;width:32px;height:32px;font-size:14px;vertical-align:middle;margin-left:6px}
.story{white-space:pre-wrap}.sus{display:flex;gap:10px;align-items:center;border:1px solid var(--line);border-radius:12px;padding:10px;margin:8px 0;cursor:pointer}.sus img,.sus .ph{width:56px;height:72px;object-fit:cover;border-radius:8px;background:var(--soft);flex:none}.sus.pick{border-color:var(--red);background:#2A1A1C}
.score{font-size:13px;color:var(--gold)}.gate{padding:40px 0;text-align:center}.err{color:#F08080}.spin{display:inline-block;animation:sp 1.2s linear infinite}@keyframes sp{to{transform:rotate(360deg)}}
.toast{position:fixed;left:50%;bottom:calc(20px + env(safe-area-inset-bottom));transform:translateX(-50%);background:var(--ink);color:var(--bg);padding:10px 16px;border-radius:999px;font-size:14px;z-index:9;max-width:90vw;text-align:center}
.st{font-size:13px;color:var(--ink2);margin-bottom:8px}.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:#2E7D5B;margin-right:4px}.dot.off{background:var(--red)}
.end{border-color:var(--gold)}.end h2{color:var(--gold)}
</style></head><body>
<header><a class="back" id="back" href="/hub" aria-label="뒤로">‹</a><h1 id="ttl">🕵️ 미스터리 기내편</h1><small id="pts"></small></header>
<main id="main"><div class="gate"><span class="spin">🕵️</span> 사건 파일 여는 중…</div></main>
<script>
var CODE='';try{CODE=localStorage.getItem('pb-code')||'';}catch(e){}
var S=null,CUR=null,P=null,TAB='case',AU=null,ON=navigator.onLine;
function $(i){return document.getElementById(i);}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function toast(t){var d=document.createElement('div');d.className='toast';d.textContent=t;document.body.appendChild(d);setTimeout(function(){d.remove();},3200);}
function api(p,b){b=b||{};b.code=CODE;return fetch(p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json().catch(function(){return {error:'서버 응답 오류 '+r.status};});},function(){return {error:'network'};});}
function gate(m){$('main').innerHTML='<div class="gate"><p>'+esc(m||'박비서 초대 코드를 넣어 주세요')+'</p><input id="cd" placeholder="초대 코드" style="font:inherit;padding:8px;border-radius:8px;border:1px solid var(--line);background:var(--soft);color:var(--ink)"> <button id="go" class="chip">열기</button></div>';$('go').onclick=function(){CODE=$('cd').value.trim();try{localStorage.setItem('pb-code',CODE);}catch(e){}load();};}
if('serviceWorker' in navigator){navigator.serviceWorker.register('/air/sw.js',{scope:'/air/'}).catch(function(){});}
function ls(k,v){try{if(v===undefined)return JSON.parse(localStorage.getItem(k)||'null');localStorage.setItem(k,JSON.stringify(v));}catch(e){}return v;}
function trueth(c){try{return JSON.parse(decodeURIComponent(escape(atob(c.truth))));}catch(e){return {culprit:0,hints:[],ending:'',wrong:''};}}
// ---------- 목록 ----------
function load(){
  var c=ls('air-cases');
  if(!navigator.onLine){if(c){S=c;home();}else $('main').innerHTML='<div class="gate err">오프라인이고 저장된 사건이 없어요.<br>인터넷이 될 때 사건을 만들어 두세요.</div>';return;}
  if(!CODE)return gate();
  api('/air/state').then(function(j){if(j.error==='not_allowed')return gate('초대 코드가 맞지 않아요');if(!j.ok){if(c){S=c;home();}else $('main').innerHTML='<div class="gate err">'+esc(j.detail||j.error)+'</div>';return;}
    S=j;ls('air-cases',S);syncPending();home();pollAll();});
}
function imgOf(c,k){return c.imgs&&c.imgs[k]?'<img src="'+esc(c.imgs[k])+'" alt="">':'<div class="ph"></div>';}
function ready(c){var n=Object.keys(c.imgs||{}).length;return n+'/'+(c.suspects.length+c.places.length);}
function home(){
  CUR=null;$('ttl').textContent='🕵️ 미스터리 기내편';$('back').setAttribute('href','/hub');$('back').onclick=null;$('pts').textContent='누적 '+(S.total||0)+'점';
  var h='<div class="st"><span class="dot'+(navigator.onLine?'':' off')+'"></span>'+(navigator.onLine?'온라인':'오프라인 · 저장본')+' · 사건은 폰에 저장돼 비행기 모드에서도 돼요</div>';
  if(!S.cases.length)h+='<div class="card muted">담아 둔 사건이 없어요. 아래에서 만들어 두세요(사건 하나에 1분쯤, 그림 8장은 2~3분 더).</div>';
  S.cases.forEach(function(c){var p=ls('air-play:'+c.id)||{};var im=c.imgs&&c.imgs.s0;
    h+='<div class="card"><div class="cs">'+(im?'<img src="'+esc(im)+'" alt="">':'<div class="ph"></div>')+'<div style="flex:1"><b>'+esc(c.title)+'</b><div class="muted">'+esc(S.genres[c.genre]||'')+' · 그림 '+ready(c)+(c.pending?' <span class="spin">⏳</span>':'')+(p.done?' · '+(p.ok?'✅ 해결 '+p.score+'점':'❌ 오답'):p.started?' · 진행 중':'')+'</div>'
      +'<div class="chips" style="margin-top:8px"><button class="chip on" data-play="'+c.id+'">'+(p.started?'이어서':'시작')+'</button><button class="chip" data-drop="'+c.id+'">지우기</button></div></div></div></div>';});
  h+='<div class="card"><h2>새 사건 만들기</h2><p class="muted">인터넷 될 때만. 광저우 실제 장소 4곳이 무대, 용의자 4명 심문(라운드마다 질문 하나만!), 그림 8장.</p><div class="chips" id="gn">'+Object.keys(S.genres).map(function(k){return '<button class="chip'+(k===(ls('air-genre')||'classic')?' on':'')+'" data-g="'+k+'">'+esc(S.genres[k])+'</button>';}).join('')+'</div><button class="big" id="mk"'+(navigator.onLine?'':' disabled')+'>🕵️ 사건 만들기</button></div>';
  if(S.hist&&S.hist.length)h+='<div class="card"><h2>지난 사건</h2>'+S.hist.slice(0,10).map(function(x){return '<div class="muted">'+esc(x.date)+' · '+esc(x.title)+' · '+(x.ok?'✅ '+x.score+'점':'❌')+'</div>';}).join('')+'</div>';
  $('main').innerHTML=h;
  document.querySelectorAll('[data-play]').forEach(function(b){b.onclick=function(){play(b.getAttribute('data-play'));};});
  document.querySelectorAll('[data-drop]').forEach(function(b){b.onclick=function(){if(!b.getAttribute('data-sure')){b.setAttribute('data-sure','1');b.textContent='정말 지우기';return;}drop(b.getAttribute('data-drop'));};});
  document.querySelectorAll('[data-g]').forEach(function(b){b.onclick=function(){ls('air-genre',b.getAttribute('data-g'));home();};});
  $('mk').onclick=make;
}
function make(){var b=$('mk');b.disabled=true;b.textContent='✍️ 사건 쓰는 중… (1분쯤)';
  var go=function(gps){api('/air/new',{genre:ls('air-genre')||'classic',gps:gps||''}).then(function(j){if(!j.ok){toast(j.detail||j.error);home();return;}S=j;ls('air-cases',S);home();toast('사건이 왔어요. 그림은 뒤에서 2~3분 더 만들어요.');pollAll();});};
  if(navigator.geolocation)navigator.geolocation.getCurrentPosition(function(p){go(p.coords.longitude.toFixed(6)+','+p.coords.latitude.toFixed(6));},function(){go('');},{timeout:4000});else go('');
}
function drop(id){api('/air/drop',{id:id}).then(function(j){if(j.ok){S=j;ls('air-cases',S);try{localStorage.removeItem('air-play:'+id);}catch(e){}home();}else toast(j.detail||j.error);});}
// 그림 작업 확인 → 다 되면 그림·음성을 미리 받아 서비스워커 캐시에
var POLLT=null;
function pollAll(){clearTimeout(POLLT);if(!navigator.onLine||!S)return;var pend=S.cases.filter(function(c){return c.pending;});
  var jobs=S.cases.map(function(c){return c.pending?api('/air/poll',{id:c.id}).then(function(j){if(j.ok&&j['case']){var i=S.cases.findIndex(function(x){return x.id===c.id;});if(i>=0)S.cases[i]=j['case'];}}):Promise.resolve();});
  Promise.all(jobs).then(function(){ls('air-cases',S);prefetch();if(!CUR)home();if(S.cases.some(function(c){return c.pending;}))POLLT=setTimeout(pollAll,12000);});
}
var PF={};
function prefetch(){var us=[];S.cases.forEach(function(c){Object.keys(c.imgs||{}).forEach(function(k){us.push(c.imgs[k]);});c.suspects.forEach(function(s){s.rounds.forEach(function(r){r.forEach(function(o){if(o.say)us.push(o.say);});});});});
  (function next(i){if(i>=us.length)return;var u=us[i];if(PF[u])return next(i+1);fetch(u).then(function(r){PF[u]=r.ok;}).catch(function(){}).then(function(){next(i+1);});})(0);}
function syncPending(){var q=ls('air-done')||[];if(!q.length)return;(function next(){var x=q.shift();if(!x){ls('air-done',[]);return;}api('/air/done',x).then(function(j){if(j.ok){S=j;ls('air-cases',S);}ls('air-done',q);next();});})();}
// ---------- 플레이 ----------
function play(id){CUR=S.cases.find(function(c){return c.id===id;});if(!CUR)return;P=ls('air-play:'+id)||{started:true,score:100,found:[],asked:{},searched:[],hints:0,done:false};P.started=true;ls('air-play:'+id,P);TAB=P.done?'accuse':'case';
  $('ttl').textContent=CUR.title;$('back').setAttribute('href','#');$('back').onclick=function(e){e.preventDefault();home();};draw();}
function savePlay(){ls('air-play:'+CUR.id,P);}
function clue(text,from){if(!text)return;if(P.found.some(function(f){return f.t===text;}))return;P.found.push({t:text,from:from});savePlay();toast('📒 단서 추가: '+text.slice(0,30)+'…');}
function tabs(){var T=[['case','📜 사건'],['place','📍 장소'],['sus','👤 용의자'],['note','📒 단서 '+P.found.length],['accuse','⚖️ 지목']];return '<div class="tabs">'+T.map(function(t){return '<button class="'+(TAB===t[0]?'on':'')+'" data-t="'+t[0]+'">'+t[1]+'</button>';}).join('')+'</div>';}
function draw(){
  $('pts').innerHTML='<span class="score">점수 '+P.score+'</span>';
  var h=tabs();
  if(TAB==='case')h+='<div class="card"><h2>'+esc(CUR.title)+'</h2><p class="story">'+esc(CUR.intro)+'</p><p class="muted">장소 4곳을 조사하고 용의자 4명을 심문하세요. 심문은 라운드마다 질문 하나만 고를 수 있어요(고르지 않은 질문은 영영 못 물어요). 힌트는 -15점, 지목은 한 번.</p></div>'
    +CUR.suspects.map(function(s){return '<div class="sus" data-s="'+s.k+'">'+imgOf(CUR,s.k)+'<div><b>'+esc(s.name)+'</b> <span class="muted">'+esc(s.korean)+' · '+esc(s.role)+'</span><div class="muted">'+esc(s.desc)+'</div></div></div>';}).join('');
  if(TAB==='place')h+=CUR.places.map(function(p,i){var did=P.searched.indexOf(p.k)>=0;return '<div class="card"><img class="scene" src="'+esc((CUR.imgs||{})[p.k]||'')+'" alt=""><h2>'+(i+1)+'장 · '+esc(p.title)+'</h2><div class="muted">📍 '+esc(p.name)+(p.area?' · '+esc(p.area):'')+'</div><p class="story">'+esc(p.story)+'</p>'
      +(did?'<div class="ans"><div class="q">🔍 조사 결과</div>'+esc(p.search)+'</div><div class="clue"><b>단서</b> '+esc(p.clue)+'</div>':'<button class="big ghost" data-search="'+p.k+'">🔍 이곳을 조사한다</button>')+'</div>';}).join('');
  if(TAB==='sus')h+=CUR.suspects.map(function(s){var ak=P.asked[s.k]||[];var r=ak.length;var h2='<div class="card"><img class="por" src="'+esc((CUR.imgs||{})[s.k]||'')+'" alt=""><h2>'+esc(s.name)+'</h2><div class="muted">'+esc(s.korean)+' · '+esc(s.role)+'</div><p>'+esc(s.desc)+'</p><p class="muted">🗣 본인 주장: '+esc(s.alibi)+'</p><div class="clr"></div>';
      ak.forEach(function(oi,ri){var o=s.rounds[ri][oi];h2+='<div class="ans"><div class="q">Q'+(ri+1)+'. '+esc(o.q)+' <span class="muted">'+esc(o.qz)+'</span></div><div class="zh">'+esc(o.az)+(o.say?'<button class="say" data-say="'+esc(o.say)+'">🔊</button>':'')+'</div><div>'+esc(o.a)+'</div></div>'+(o.clue?'<div class="clue"><b>단서</b> '+esc(o.clue)+'</div>':'');});
      if(r<s.rounds.length&&!P.done){h2+='<div class="lbl">'+(r+1)+'라운드 — 하나만 물을 수 있어요</div>'+s.rounds[r].map(function(o,oi){return '<button class="opt" data-ask="'+s.k+'|'+oi+'">'+esc(o.q)+'<small>'+esc(o.qz)+'</small></button>';}).join('');}
      else if(r>=s.rounds.length)h2+='<div class="muted">심문 끝. 더 물을 수 없어요.</div>';
      return h2+'</div>';}).join('');
  if(TAB==='note'){h+='<div class="card"><h2>📒 단서 노트</h2>'+(P.found.length?P.found.map(function(f){return '<div class="clue"><b>'+esc(f.from)+'</b> '+esc(f.t)+'</div>';}).join(''):'<p class="muted">아직 없어요. 장소를 조사하고 용의자를 심문하세요.</p>')+'</div>';
    var tr=trueth(CUR);h+='<div class="card"><h2>💡 힌트</h2>'+tr.hints.slice(0,P.hints).map(function(x){return '<div class="ans">'+esc(x)+'</div>';}).join('')+(P.hints<tr.hints.length&&!P.done?'<button class="big ghost" id="hint">힌트 보기 (-15점)</button>':'')+'</div>';}
  if(TAB==='accuse'){if(P.done){var t2=trueth(CUR),cul=CUR.suspects[t2.culprit];h+='<div class="card end"><h2>'+(P.ok?'✅ 사건 해결 · '+P.score+'점':'❌ 틀렸어요')+'</h2>'+(P.ok?'':'<p>'+esc(t2.wrong)+'</p>')+'<p class="muted">당신의 지목: '+esc((CUR.suspects.find(function(s){return s.k===P.who;})||{}).name||'')+'</p>'+(P.ok||P.reveal?'<div class="sus pick">'+imgOf(CUR,cul.k)+'<div><b>진범 '+esc(cul.name)+'</b><div class="muted">'+esc(cul.role)+'</div></div></div><p class="story">'+esc(t2.ending)+'</p>':'<button class="big ghost" id="reveal">진상 보기</button>')+'<button class="big" id="homeBtn">목록으로</button></div>';}
    else h+='<div class="card"><h2>⚖️ 범인을 지목하세요</h2><p class="muted">한 번뿐이에요. 단서 '+P.found.length+'개 모음 · 현재 '+P.score+'점.</p>'+CUR.suspects.map(function(s){return '<div class="sus'+(P.pick===s.k?' pick':'')+'" data-pick="'+s.k+'">'+imgOf(CUR,s.k)+'<div><b>'+esc(s.name)+'</b><div class="muted">'+esc(s.role)+'</div></div></div>';}).join('')+'<button class="big" id="acc"'+(P.pick?'':' disabled')+'>이 사람이 범인이다</button></div>';}
  $('main').innerHTML=h;window.scrollTo(0,0);
  document.querySelectorAll('[data-t]').forEach(function(b){b.onclick=function(){TAB=b.getAttribute('data-t');draw();};});
  document.querySelectorAll('[data-s]').forEach(function(b){b.onclick=function(){TAB='sus';draw();};});
  document.querySelectorAll('[data-search]').forEach(function(b){b.onclick=function(){var k=b.getAttribute('data-search'),p=CUR.places.find(function(x){return x.k===k;});P.searched.push(k);clue(p.clue,'📍 '+p.title);draw();};});
  document.querySelectorAll('[data-ask]').forEach(function(b){b.onclick=function(){var a=b.getAttribute('data-ask').split('|'),s=CUR.suspects.find(function(x){return x.k===a[0];});P.asked[s.k]=P.asked[s.k]||[];var ri=P.asked[s.k].length,o=s.rounds[ri][+a[1]];P.asked[s.k].push(+a[1]);savePlay();if(o.clue)clue(o.clue,'👤 '+s.name);draw();if(o.say)say(o.say);};});
  document.querySelectorAll('[data-say]').forEach(function(b){b.onclick=function(){say(b.getAttribute('data-say'));};});
  document.querySelectorAll('[data-pick]').forEach(function(b){b.onclick=function(){P.pick=b.getAttribute('data-pick');savePlay();draw();};});
  var hb=$('hint');if(hb)hb.onclick=function(){P.hints++;P.score=Math.max(0,P.score-15);savePlay();draw();};
  var ac=$('acc');if(ac)ac.onclick=function(){if(!ac.getAttribute('data-sure')){ac.setAttribute('data-sure','1');ac.textContent='정말요? 한 번 더 누르면 확정';return;}var t=trueth(CUR);P.done=true;P.who=P.pick;P.ok=(CUR.suspects[t.culprit]||{}).k===P.pick;if(!P.ok)P.score=0;savePlay();
    var rec={id:CUR.id,ok:P.ok,who:P.pick,score:P.score};var q=ls('air-done')||[];q.push(rec);ls('air-done',q);if(navigator.onLine)syncPending();draw();};
  var rv=$('reveal');if(rv)rv.onclick=function(){P.reveal=true;savePlay();draw();};
  var hm=$('homeBtn');if(hm)hm.onclick=function(){if(navigator.onLine){load();}else home();};
}
function say(u){if(!u)return;try{if(AU)AU.pause();AU=new Audio(u);var p=AU.play();if(p&&p.catch)p.catch(function(){});}catch(e){}}
window.addEventListener('online',function(){if(!CUR)load();});
load();
</script></body></html>`;
