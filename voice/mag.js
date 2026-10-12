// =========================================================
// 📰 기내 잡지 — 비행기 타기 전에 한 번 열어 두면 오프라인에서 읽는 '오늘 내 것들' 묶음 (주인 전용)
//  GET  /mag/                      화면(서비스워커 범위라 끝에 / 필요, /mag 는 여기로 리다이렉트)
//  GET  /mag/sw.js                 서비스워커(화면·음성 캐시 → 오프라인)
//  GET  /mag/say?id&s              읽어 주기(중국어 CosyVoice 기본 음성 / 한국어 내 목소리→qwen-tts, R2 tts/mag/<id>.mp3 캐시)
//  POST /mag/today {code, fresh?}  → 오늘 묶음(중국 날짜 기준 KV mag:<해시>:<날짜> 1일, fresh 면 다시 만듦 — 하루 6번)
//  magCron: */15 틱에서 오늘 비행기·고속철 출발 2시간 전(±8분)이면 묶음을 만들어 Bark '기내 잡지 준비됨'
// 내용(전부 이미 있는 KV 기록 — 새 AI 호출은 오늘의 중국 인터넷이 아직 없을 때뿐):
//   출장 브리핑(오늘·내일) · 오늘의 중국 인터넷(음성) · 경쟁 채널 레이더 결론·훅·주제 · 댓글 질문 상위 · 이번 주말 숏츠 기획 · 내 채널 숫자 · 연재 소설 최신 화(내 목소리 오디오북) · 주말 탐험·간판 최근
// [필수] AI 는 百炼(千问·CosyVoice·qwen-tts)만 — Anthropic 호출 없음
// =========================================================
import { logUse } from "./usage.js";
import { trendApi } from "./trend.js";
import { build as briefBuild, barkPush } from "./brief.js";

const cnDay = (t = Date.now()) => new Date(t + 8 * 3600e3).toISOString().slice(0, 10);
const host = (env) => (env.DASHSCOPE_WS_HOST || "dashscope.aliyuncs.com").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
const merr = (message, status = 400) => Object.assign(new Error(message), { code: "mag", status });
async function hmac16(env, s) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode("mg|" + (env.ALLOWED_CODES || "") + (env.DASHSCOPE_API_KEY || "")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(s));
  return [...new Uint8Array(sig)].slice(0, 8).map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function owner(env, h) {
  let o = await env.KV.get("usage:owner");
  if (!o) { await env.KV.put("usage:owner", h); o = h; }
  if (o !== h) throw merr("기내 잡지는 주인만 쓸 수 있어요.", 403);
}

// 읽어 주기 항목 등록: 글은 KV 에 두고(주소에 긴 글을 넣지 않음) 서명된 짧은 주소만 화면에
async function sayReg(env, text, lang) {
  const t = String(text || "").trim().slice(0, 1500);
  if (!t) return "";
  const id = await hmac16(env, "t|" + lang + "|" + t);
  await env.KV.put("mag:say:" + id, JSON.stringify({ t, lang }), { expirationTtl: 10 * 86400 });
  return "/mag/say?id=" + id + "&s=" + (await hmac16(env, "s|" + id));
}
// 소설처럼 긴 글은 문단 단위로 400자 안팎씩 나눠 여러 조각(각 조각 mp3)으로
function chunks(text, max = 420) {
  const out = []; let cur = "";
  for (const p of String(text).split(/\n+/)) {
    const s = p.trim(); if (!s) continue;
    if ((cur + "\n" + s).length > max && cur) { out.push(cur); cur = s; } else cur = cur ? cur + "\n" + s : s;
  }
  if (cur) out.push(cur);
  return out.slice(0, 8);
}

async function makeBundle(env, h) {
  const day = cnDay(), tom = cnDay(Date.now() + 86400e3);
  const out = { day, at: Date.now(), parts: {} };
  // 🧳 출장(오늘·내일) — 이미 만든 브리핑이 있으면 그것, 없으면 지금 만듦
  try {
    const doc = await env.KV.get("brief:" + h, "json");
    if (doc && doc.trips) {
      const trips = [];
      for (const d of [day, tom]) {
        let b = await env.KV.get("brief:out:" + h + ":" + d, "json");
        if (!b && doc.trips.some((x) => x.d === d)) { b = await briefBuild(env, doc, d); if (b) await env.KV.put("brief:out:" + h + ":" + d, JSON.stringify(b), { expirationTtl: 14 * 86400 }); }
        if (b) trips.push({ d, title: b.title, route: b.route, wline: b.wline, wear: b.wear, pack: b.pack, meet: b.meet, tip: b.tip, zh: b.zh ? { ...b.zh, say: await sayReg(env, b.zh.z, "zh") } : null });
      }
      const later = doc.trips.filter((x) => x.d > tom).sort((a, c) => a.d.localeCompare(c.d)).slice(0, 4).map((x) => ({ d: x.d, from: x.from, to: x.to, how: x.how, t: x.t, no: x.no, stay: x.stay }));
      out.parts.trip = { trips, later };
    }
  } catch (e) { out.parts.trip = { err: String(e.message || e).slice(0, 120) }; }
  // 🔥 오늘의 중국 인터넷 (오늘 판이 없으면 만들어 둠 — 30초쯤)
  try {
    const t = await trendApi(env, { waitUntil() {} }, "/trend/today", {}, h);
    const items = [];
    for (const x of (t.items || [])) items.push({ emo: x.emo, ko: x.ko, zh: x.zh, what: x.what, why: x.why, src: x.src, word: x.word ? { z: x.word.z, p: x.word.p, k: x.word.k, say: await sayReg(env, x.word.z, "zh") } : null });
    out.parts.trend = { items, office: t.office ? { z: t.office.z, p: t.office.p, k: t.office.k, say: await sayReg(env, t.office.z, "zh") } : null };
  } catch (e) { out.parts.trend = { err: String(e.message || e).slice(0, 120) }; }
  // 📡 레이더 · 💬 댓글 · 🗓 주간 기획 · 📈 채널 (있는 것만)
  const rd = await env.KV.get("shorts:radar:" + h, "json");
  if (rd && rd.ai && !rd.ai.error) out.parts.radar = { at: rd.at, n: rd.n, oneline: rd.ai.oneline || "", patterns: (rd.ai.patterns || []).slice(0, 5), hooks: (rd.ai.hooks || []).slice(0, 3), topics: (rd.ai.topics || []).slice(0, 5), avoid: (rd.ai.avoid || []).slice(0, 2), sleepers: (rd.sleepers || []).slice(0, 4).map((x) => ({ t: x.t, d: x.d, r: x.r, subs: x.subs })) };
  const cm = await env.KV.get("shorts:cmt:" + h, "json");
  if (cm && cm.groups) out.parts.cmt = { at: cm.at, groups: cm.groups.filter((g) => g.can).slice(0, 8).map((g) => ({ q: g.q, n: g.n, topic: g.topic, hook: g.hook, film: g.film })), mine: (cm.mine || []).filter((x) => !x.rep).slice(0, 5).map((x) => x.t) };
  const wk = await env.KV.get("shorts:week:" + h, "json");
  if (wk && wk.items) out.parts.week = { at: wk.at, items: wk.items.slice(0, 3).map((x) => ({ title: x.title, kind: x.kind, where: x.where, hook: x.hook, why: x.why, shots: (x.shots || []).slice(0, 7) })) };
  const st = await env.KV.get("yt:stats:" + h, "json");
  if (st && st.items) out.parts.yt = { at: st.at, subs: st.subs, n: st.items.length, views: st.items.reduce((a, x) => a + (x.views || 0), 0), top: st.items.filter((x) => x.privacy === "public").sort((a, c) => c.views - a.views).slice(0, 5).map((x) => ({ t: x.title, v: x.views, l: x.likes, c: x.comments })) };
  // 📖 연재 소설 최신 화 — 내 목소리 오디오북(조각)
  const nv = await env.KV.get("nv:" + h, "json");
  const ch = nv && nv.chapters && nv.chapters[nv.chapters.length - 1];
  if (ch) { const parts = []; for (const c of chunks(ch.text)) parts.push(await sayReg(env, c, "ko")); out.parts.novel = { n: ch.n, title: ch.title, text: ch.text, audio: parts }; }
  // 🧭 주말 탐험 · 🪧 간판 최근(글만 — 사진은 오프라인에 안 담음)
  const q = await env.KV.get("quest:" + h, "json");
  if (q && q.hist && q.hist.length) out.parts.quest = { pts: q.pts || 0, hist: q.hist.slice(0, 4).map((x) => ({ date: x.date, name: x.name, area: x.area, title: x.title, pts: x.pts, comment: x.comment })) };
  const sg = await env.KV.get("sg:" + h, "json");
  if (sg && sg.items && sg.items.length) out.parts.signs = { pts: sg.pts || 0, items: sg.items.slice(0, 4).map((x) => ({ zh: x.zh, literal: x.literal, real: x.real, fun: x.fun })) };
  return out;
}

// ---------- 📻 라디오 드라마: 연재 소설 한 화를 대본(내레이션·남편·아내·그 외)으로 바꿔 줄마다 음성 → 화면이 효과음과 함께 이어 재생 ----------
// 무료 플랜 요청당 외부 호출 50회 제한 → 대본은 한 번에, 음성은 화면이 줄마다 /mag/radio/line 로 하나씩 받아 둠(R2 tts/radio/<해시>/<n>/<i>)
const RADIO_SFX = ["door", "rain", "street", "phone", "steps", "market", "night", "none"];
async function qwenJson(env, sys, user, model) {
  const r = await fetch("https://" + host(env) + "/compatible-mode/v1/chat/completions", { method: "POST", headers: { authorization: "Bearer " + env.DASHSCOPE_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ model, temperature: 0.7, enable_thinking: false, response_format: { type: "json_object" }, max_tokens: 6000, messages: [{ role: "system", content: sys }, { role: "user", content: user }] }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw merr("千问 " + r.status + ": " + ((j.error && j.error.message) || "").slice(0, 120), 502);
  const c = String(j.choices[0].message.content).replace(/^```(?:json)?\s*|\s*```$/g, "");
  try { return JSON.parse(c); } catch { const a = c.indexOf("{"), z = c.lastIndexOf("}"); return JSON.parse(c.slice(a, z + 1)); }
}
async function radioMake(env, ctx, b, h) {
  const nv = await env.KV.get("nv:" + h, "json");
  const chs = (nv && nv.chapters) || [];
  if (!chs.length) throw merr("연재 소설이 아직 없어요. 도구함 → 우리 연재 소설에서 한 화 써 두세요.");
  const ch = (b.n ? chs.find((x) => x.n === Number(b.n)) : null) || chs[chs.length - 1];
  const key = "radio:" + h + ":" + ch.n;
  let sc = b.fresh ? null : await env.KV.get(key, "json");
  if (!sc) {
    const names = (nv.names || ["남편", "아내"]);
    const sys = "너는 라디오 드라마 각색 작가다. 아래 소설 한 화를 15분 안팎 오디오 드라마 대본으로 바꿔라. 화자 who: nar(내레이션, 소설의 지문을 1인칭 남편 시점이 아니라 3인칭 해설로 짧게), h(남편 '" + names[0] + "'의 대사), w(아내 '" + names[1] + "'의 대사), x(그 외 인물 — 가게 주인·행인 등, 중국어 한마디가 있으면 한글로 읽히게 '니하오' 식으로 적되 짧게). " +
      "원작 문장과 사건 순서를 지키고 새 사건을 만들지 마라. 대사는 실제로 입으로 말하는 구어체, 내레이션은 그림이 떠오르게. 줄은 50~90개, 한 줄 120자 이내. 장면이 바뀌는 줄에는 sfx 를 " + RADIO_SFX.join("|") + " 중 하나로(없으면 none). 첫 줄은 nar 로 제목과 '몇 화'를 말한다. " +
      '읽을 때 어색한 한자·영어는 한글 발음으로. JSON만: {"title":"","lines":[{"who":"nar|h|w|x","t":"","sfx":"none"}]}';
    let out;
    try { out = await qwenJson(env, sys, ch.n + "화 '" + ch.title + "'\n" + ch.text, env.RADIO_MODEL || "qwen-plus"); }
    catch { out = await qwenJson(env, sys, ch.n + "화 '" + ch.title + "'\n" + ch.text, env.QUEST_MODEL || "qwen3.8-flash"); }
    const lines = (Array.isArray(out.lines) ? out.lines : []).map((l) => ({ who: /^(nar|h|w|x)$/.test(l.who) ? l.who : "nar", t: String(l.t || "").trim().slice(0, 160), sfx: RADIO_SFX.includes(l.sfx) ? l.sfx : "none" })).filter((l) => l.t).slice(0, 110);
    if (lines.length < 12) throw merr("대본이 너무 짧게 나왔어요. 다시 눌러 주세요.", 502);
    const kr = await env.KV.get("voice:kr:" + h);
    sc = { n: ch.n, title: String(out.title || ch.title).slice(0, 60), names, mine: !!kr, lines, made: Date.now() };
    await env.KV.put(key, JSON.stringify(sc), { expirationTtl: 60 * 86400 });
    if (ctx) ctx.waitUntil(logUse(env, "mag", { radio: 1 }, 0, h).catch(() => {}));
  }
  const urls = [];
  for (let i = 0; i < sc.lines.length; i++) urls.push(await radioUrl(env, h, ch.n, i));
  return { ok: true, radio: { ...sc, urls, chapters: chs.map((x) => ({ n: x.n, title: x.title })) } };
}
const radioUrl = async (env, h, n, i) => "/mag/radio/a?h=" + h + "&n=" + n + "&i=" + i + "&s=" + (await hmac16(env, "r|" + h + "|" + n + "|" + i));
// 줄 하나 합성(이미 있으면 바로) — 화면이 순서대로 부름
async function radioLine(env, b, h, synth) {
  const n = Number(b.n), i = Number(b.i);
  const sc = await env.KV.get("radio:" + h + ":" + n, "json");
  if (!sc || !sc.lines[i]) throw merr("대본 줄이 없어요.", 404);
  const pre = "tts/radio/" + h + "/" + n + "/" + i;
  const hit = (await env.R2.head(pre + ".mp3")) || (await env.R2.head(pre + ".wav"));
  if (hit) return { ok: true, i, url: await radioUrl(env, h, n, i), cached: true };
  const l = sc.lines[i];
  let bytes = null, ext = "wav", ct = "audio/wav";
  // 내레이션은 내 목소리(한국어 복제), 남편 Ethan, 아내 Cherry, 그 외 Serena — 내 목소리가 없으면 내레이션은 Chelsie
  const kr = await env.KV.get("voice:kr:" + h);
  if (l.who === "nar" && kr) { try { bytes = await synth(env, kr, l.t, null, { language_hints: ["ko"], rate: 1.0, volume: 100 }); ext = "mp3"; ct = "audio/mpeg"; } catch { bytes = null; } }
  if (!bytes) {
    const voice = l.who === "h" ? "Ethan" : l.who === "w" ? "Cherry" : l.who === "x" ? "Serena" : "Chelsie";
    const r = await fetch("https://" + host(env) + "/api/v1/services/aigc/multimodal-generation/generation", { method: "POST", headers: { authorization: "Bearer " + env.DASHSCOPE_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ model: env.SHORTS_TTS_MODEL || "qwen3-tts-flash", input: { text: l.t, voice, language_type: "Korean" } }) });
    const j = await r.json().catch(() => ({}));
    const u = j.output && j.output.audio && j.output.audio.url;
    if (!u) throw merr("음성 합성 실패(" + (j.message || r.status) + ")", 502);
    const a = await fetch(u); if (!a.ok) throw merr("오디오 받기 실패", 502);
    bytes = new Uint8Array(await a.arrayBuffer());
  }
  await env.R2.put(pre + "." + ext, bytes, { httpMetadata: { contentType: ct } });
  return { ok: true, i, url: await radioUrl(env, h, n, i) };
}

export async function magApi(env, ctx, path, b, h, synth) {
  await owner(env, h);
  if (path === "/mag/radio/make") return radioMake(env, ctx, b, h);
  if (path === "/mag/radio/line") return radioLine(env, b, h, synth);
  if (path !== "/mag/today") throw merr("not_found", 404);
  const key = "mag:" + h + ":" + cnDay();
  let d = await env.KV.get(key, "json");
  if (d && b.fresh) {
    const rk = "mag:re:" + h + ":" + cnDay(), n = Number(await env.KV.get(rk)) || 0;
    if (n >= 6) throw merr("오늘 다시 만들기는 여기까지예요(6번).", 429);
    await env.KV.put(rk, String(n + 1), { expirationTtl: 2 * 86400 });
    d = null;
  }
  if (!d) { d = await makeBundle(env, h); await env.KV.put(key, JSON.stringify(d), { expirationTtl: 2 * 86400 }); if (ctx) ctx.waitUntil(logUse(env, "mag", { make: 1 }, 0, h).catch(() => {})); }
  else if (ctx) ctx.waitUntil(logUse(env, "mag", { open: 1 }, 0, h).catch(() => {}));
  return { ok: true, mag: d };
}

// 출발 2시간 전(±8분 틱)에 묶음을 만들어 두고 Bark. 일정당 1번(KV mag:sent:<해시>:<날짜>:<id>)
export async function magCron(env) {
  const h = await env.KV.get("usage:owner");
  if (!h) return;
  const doc = await env.KV.get("brief:" + h, "json");
  if (!doc || !doc.bark || !doc.trips) return;
  const day = cnDay(), nowM = (() => { const t = new Date(Date.now() + 8 * 3600e3); return t.getUTCHours() * 60 + t.getUTCMinutes(); })();
  for (const tr of doc.trips) {
    if (tr.d !== day || !/^(plane|train)$/.test(tr.how) || !/^\d{1,2}:\d{2}$/.test(tr.t || "")) continue;
    const [hh, mm] = tr.t.split(":").map(Number), dep = hh * 60 + mm, diff = dep - nowM;
    if (diff > 128 || diff < 112) continue; // 출발 2시간 전 틱 하나
    const sk = "mag:sent:" + h + ":" + day + ":" + tr.id;
    if (await env.KV.get(sk)) continue;
    await env.KV.put(sk, "1", { expirationTtl: 2 * 86400 });
    const d = await makeBundle(env, h);
    await env.KV.put("mag:" + h + ":" + day, JSON.stringify(d), { expirationTtl: 2 * 86400 });
    const n = Object.keys(d.parts).length;
    try {
      await barkPush(doc.bark, "📰 기내 잡지 준비됨 · " + tr.from + "→" + tr.to, "탑승 전에 한 번 열어 두면 비행기에서도 읽혀요. 오늘 " + n + "꼭지" + (d.parts.novel ? " · 소설 오디오북 포함" : ""), "https://voice.zhnote.net/mag/");
      await logUse(env, "mag", { bark: 1 }, 0, h).catch(() => {});
    } catch (e) { console.log("magCron bark", e && e.message); }
  }
}

export async function magGet(req, env, url, synth) {
  if (url.pathname === "/mag") return Response.redirect(new URL("/mag/", url).toString(), 302);
  if (url.pathname === "/mag/") return new Response(MAG_HTML, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
  if (url.pathname === "/mag/sw.js") return new Response(MAG_SW, { headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-cache" } });
  if (url.pathname === "/mag/radio/a") {
    const h = String(url.searchParams.get("h") || ""), n = String(url.searchParams.get("n") || ""), i = String(url.searchParams.get("i") || "");
    if (!/^[0-9a-f]{12}$/.test(h) || !/^\d+$/.test(n) || !/^\d+$/.test(i) || url.searchParams.get("s") !== (await hmac16(env, "r|" + h + "|" + n + "|" + i))) return new Response("forbidden", { status: 403 });
    const pre = "tts/radio/" + h + "/" + n + "/" + i;
    const o = (await env.R2.get(pre + ".mp3")) || (await env.R2.get(pre + ".wav"));
    if (!o) return new Response("not yet", { status: 404 });
    return new Response(o.body, { headers: { "content-type": o.httpMetadata?.contentType || "audio/mpeg", "cache-control": "private, max-age=31536000" } });
  }
  if (url.pathname === "/mag/say") {
    const id = String(url.searchParams.get("id") || "");
    if (!/^[0-9a-f]{16}$/.test(id) || url.searchParams.get("s") !== (await hmac16(env, "s|" + id))) return new Response("forbidden", { status: 403 });
    const key = "tts/mag/" + id + ".mp3", head = { "content-type": "audio/mpeg", "cache-control": "private, max-age=31536000" };
    const hit = await env.R2.get(key);
    if (hit) return new Response(hit.body, { headers: head });
    const it = await env.KV.get("mag:say:" + id, "json");
    if (!it) return new Response("expired", { status: 404 });
    let mp3 = null;
    try {
      if (it.lang === "ko") {
        const h = await env.KV.get("usage:owner");
        const kr = h && (await env.KV.get("voice:kr:" + h));
        if (kr) { try { mp3 = await synth(env, kr, it.t, null, { language_hints: ["ko"], rate: 1.0, volume: 100 }); } catch { mp3 = null; } }
        if (!mp3) { // 내 목소리가 없거나 실패하면 qwen-tts 한국어
          const r = await fetch("https://" + host(env) + "/api/v1/services/aigc/multimodal-generation/generation", { method: "POST", headers: { authorization: "Bearer " + env.DASHSCOPE_API_KEY, "content-type": "application/json" },
            body: JSON.stringify({ model: env.SHORTS_TTS_MODEL || "qwen3-tts-flash", input: { text: it.t, voice: "Cherry", language_type: "Korean" } }) });
          const j = await r.json().catch(() => ({}));
          const u = j.output && j.output.audio && j.output.audio.url;
          if (!u) throw new Error("qwen-tts 결과 없음 " + (j.message || r.status));
          const a = await fetch(u); if (!a.ok) throw new Error("오디오 받기 실패"); mp3 = new Uint8Array(await a.arrayBuffer());
          head["content-type"] = "audio/wav";
        }
      } else mp3 = await synth(env, env.QUEST_VOICE || "longxiaochun_v2", it.t, env.QUEST_TTS_MODEL || "cosyvoice-v2");
    } catch (e) { return new Response("tts: " + String(e.message || e).slice(0, 160), { status: 502 }); }
    await env.R2.put(key, mp3, { httpMetadata: { contentType: head["content-type"] } });
    return new Response(mp3, { headers: head });
  }
  return new Response("not found", { status: 404 });
}

// 서비스워커: 화면은 네트워크 우선·실패 시 캐시, 음성은 캐시 우선. 범위 /mag/ 만.
const MAG_SW = `const C='mag-v2';
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.add('/mag/')).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('mag-')&&k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET')return;
  if(u.pathname==='/mag/say'||u.pathname==='/mag/radio/a'){e.respondWith(caches.open(C).then(async c=>{const hit=await c.match(e.request);if(hit)return hit;const r=await fetch(e.request);if(r.ok)c.put(e.request,r.clone());return r;}));return;}
  if(u.pathname==='/mag/'||u.pathname==='/mag'){e.respondWith(fetch(e.request).then(r=>{if(r.ok)caches.open(C).then(c=>c.put('/mag/',r.clone()));return r;}).catch(()=>caches.match('/mag/')));return;}
});`;

export const MAG_HTML = String.raw`<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#1664B0">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="기내 잡지">
<link rel="apple-touch-icon" href="/icon-180.png">
<title>기내 잡지</title>
<style>
@font-face{font-family:Pretendard;font-weight:400;font-display:swap;src:url(/fonts/pretendard-400.woff2) format("woff2")}
@font-face{font-family:Pretendard;font-weight:700;font-display:swap;src:url(/fonts/pretendard-700.woff2) format("woff2")}
:root{--sky:#1664B0;--bg:#EFE8DE;--card:#F7F2EA;--ink:#1A2330;--ink2:#5E6672;--line:#D9CEBD;--red:#D21624;--soft:#E6DCCB}
@media (prefers-color-scheme:dark){:root{--bg:#141A22;--card:#1C2430;--ink:#EDE6DA;--ink2:#9AA3AE;--line:#2C3644;--soft:#253041}}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 Pretendard,-apple-system,"Apple SD Gothic Neo","PingFang SC",system-ui,sans-serif;-webkit-text-size-adjust:100%}
html[data-s=l]{zoom:1.12}html[data-s=xl]{zoom:1.25}
header{background:var(--sky);color:#fff;padding:calc(env(safe-area-inset-top) + 14px) 16px 12px;border-bottom:3px solid var(--red);display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:5}
header h1{margin:0;font-size:19px}a.back{color:#fff;text-decoration:none;font-size:20px}header small{margin-left:auto;font-size:12.5px;opacity:.9;white-space:nowrap}
main{max-width:640px;margin:0 auto;padding:12px 16px 70px}
.st{font-size:13px;color:var(--ink2);display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:4px 0 10px}.st b{color:var(--ink)}.dot{width:9px;height:9px;border-radius:50%;background:#aaa;display:inline-block}.dot.ok{background:#2E7D5B}.dot.off{background:var(--red)}
.toc{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}.toc a{font-size:13px;border:1px solid var(--line);border-radius:999px;padding:4px 10px;color:var(--ink);text-decoration:none;background:var(--card)}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:12px}
.card h2{margin:0 0 8px;font-size:17px}.card h3{margin:12px 0 4px;font-size:14.5px;color:var(--ink2)}
.muted{color:var(--ink2);font-size:13.5px}.lbl{font-size:12.5px;color:var(--ink2);margin:10px 0 4px;font-weight:700}
.it{border-top:1px solid var(--line);padding:10px 0}.it:first-of-type{border-top:0;padding-top:0}.it b{font-size:15.5px}.it .zh{font-size:13px;color:var(--ink2)}
.word{display:flex;align-items:center;gap:10px;margin-top:8px;background:var(--soft);border-radius:10px;padding:8px 10px}.word b{font-size:17px}.word small{display:block;color:var(--ink2);font-size:12.5px}
button.say{margin-left:auto;border:0;background:var(--sky);color:#fff;border-radius:50%;width:36px;height:36px;font-size:16px;flex:none}
.route div{padding:2px 0}.pill{display:inline-block;font-size:12px;border:1px solid var(--line);border-radius:999px;padding:0 8px;margin-right:4px;color:var(--ink2)}
.novel p{margin:0 0 10px;white-space:pre-wrap}.ab{display:flex;gap:8px;align-items:center;margin:8px 0 12px;flex-wrap:wrap}.ab button{font:inherit;border:1px solid var(--line);background:var(--card);border-radius:999px;padding:6px 14px}.ab button.on{background:var(--sky);color:#fff;border-color:var(--sky)}
.chips{display:flex;gap:6px;flex-wrap:wrap}.chip{font:inherit;font-size:13px;border:1px solid var(--line);border-radius:999px;padding:4px 10px;background:transparent;color:var(--ink)}.chip.on{background:var(--sky);color:#fff;border-color:var(--sky)}
.re{border:1px solid var(--line);background:transparent;color:var(--ink);border-radius:999px;padding:6px 12px;font:inherit;font-size:13px}
.gate{padding:40px 0;text-align:center}.err{color:var(--red)}.spin{display:inline-block;animation:sp 1.2s linear infinite}@keyframes sp{to{transform:rotate(360deg)}}
.toast{position:fixed;left:50%;bottom:calc(20px + env(safe-area-inset-bottom));transform:translateX(-50%);background:var(--ink);color:var(--bg);padding:10px 16px;border-radius:999px;font-size:14px;z-index:9;max-width:90vw;text-align:center}
</style></head><body>
<header><a class="back" href="/hub" aria-label="도구함">‹</a><h1>📰 기내 잡지</h1><small id="day"></small></header>
<main id="main"><div class="gate"><span class="spin">📰</span> 오늘 묶음 꺼내는 중…</div></main>
<script>
var CODE='';try{CODE=localStorage.getItem('pb-code')||'';}catch(e){}
try{document.documentElement.setAttribute('data-s',localStorage.getItem('mag-size')||'');}catch(e){}
var S=null,AU=null,SAVED=0,TOTAL=0,FAIL=0;
function $(i){return document.getElementById(i);}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function toast(t){var d=document.createElement('div');d.className='toast';d.textContent=t;document.body.appendChild(d);setTimeout(function(){d.remove();},3200);}
function api(p,b){b=b||{};b.code=CODE;return fetch(p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json().catch(function(){return {error:'서버 응답 오류 '+r.status};});},function(){return {error:'network'};});}
function gate(m){$('main').innerHTML='<div class="gate"><p>'+esc(m||'박비서 초대 코드를 넣어 주세요')+'</p><input id="cd" placeholder="초대 코드" style="font:inherit;padding:8px;border-radius:8px;border:1px solid var(--line)"> <button id="go" class="re">열기</button></div>';$('go').onclick=function(){CODE=$('cd').value.trim();try{localStorage.setItem('pb-code',CODE);}catch(e){}load(false);};}
if('serviceWorker' in navigator){navigator.serviceWorker.register('/mag/sw.js',{scope:'/mag/'}).catch(function(){});}
function cached(){try{return JSON.parse(localStorage.getItem('mag-cur')||'null');}catch(e){return null;}}
function load(fresh){
  var c=cached();
  if(!navigator.onLine){if(c){S=c;render(true);}else $('main').innerHTML='<div class="gate err">오프라인이고 저장된 잡지가 없어요.<br>인터넷이 될 때 한 번 열어 두세요.</div>';return;}
  if(!CODE)return gate();
  if(fresh)$('main').innerHTML='<div class="gate"><span class="spin">📰</span> 다시 만드는 중… (1분쯤)</div>';
  api('/mag/today',{fresh:fresh}).then(function(j){
    if(j.error==='not_allowed')return gate('초대 코드가 맞지 않아요');
    if(!j.ok){if(c){S=c;render(true);toast(j.detail||j.error);}else $('main').innerHTML='<div class="gate err">'+esc(j.detail||j.error)+'<br><br><button class="re" onclick="load(false)">다시</button></div>';return;}
    S=j.mag;try{localStorage.setItem('mag-cur',JSON.stringify(S));}catch(e){}
    render(false);prefetch();
  });
}
// 음성 전부 미리 받아 서비스워커 캐시에(오프라인에서도 🔊)
function prefetch(){var us=[];document.querySelectorAll('[data-say]').forEach(function(b){var u=b.getAttribute('data-say');if(u&&us.indexOf(u)<0)us.push(u);});TOTAL=us.length;SAVED=0;FAIL=0;stat();
  (function next(i){if(i>=us.length)return stat();fetch(us[i]).then(function(r){if(r.ok)SAVED++;else FAIL++;}).catch(function(){FAIL++;}).then(function(){stat();next(i+1);});})(0);}
function stat(){var e=$('st');if(!e)return;var off=!navigator.onLine;
  e.innerHTML='<span class="dot '+(off?'off':'ok')+'"></span>'+(off?'오프라인 · 저장본':'온라인')+(TOTAL?' · 🔊 음성 '+SAVED+'/'+TOTAL+(FAIL?' (실패 '+FAIL+')':'')+(SAVED+FAIL>=TOTAL&&!FAIL?' <b>✓ 오프라인 준비 끝</b>':''):'')+' · 만든 시각 '+new Date(S.at).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});}
function say(u,btn){if(!u)return;try{if(AU){AU.pause();}AU=new Audio(u);var p=AU.play();if(p&&p.catch)p.catch(function(){toast('소리를 재생하지 못했어요'+(navigator.onLine?'':' (오프라인·미리 저장 안 됨)'));});}catch(e){}}
function wordHtml(w){return w?'<div class="word"><div><b>'+esc(w.z)+'</b><small>'+esc(w.p)+' · '+esc(w.k)+'</small></div><button class="say" data-say="'+esc(w.say||'')+'" aria-label="듣기">🔊</button></div>':'';}
var KIND={record:'📍 다녀온 곳',new:'🆕 새 장소',trend:'🔥 화제'};
function render(offline){
  var P=S.parts,h='',toc=[];
  $('day').textContent=S.day;
  h+='<div class="st" id="st"></div><div class="toc" id="toc"></div>';
  if(P.trip&&P.trip.trips&&P.trip.trips.length){toc.push(['trip','🧳 출장']);h+='<div class="card" id="trip"><h2>🧳 출장</h2>'+P.trip.trips.map(function(b){return '<h3>'+esc(b.title)+'</h3><div class="route">'+b.route.map(function(r){return '<div>'+esc(r)+'</div>';}).join('')+'<div>'+esc(b.wline)+'</div></div>'
    +(b.wear?'<div class="lbl">👔 옷차림</div><div>'+esc(b.wear)+'</div>':'')+(b.pack&&b.pack.length?'<div class="lbl">🎒 챙길 것</div><div>'+b.pack.map(esc).join(' · ')+'</div>':'')
    +(b.meet&&b.meet.length?'<div class="lbl">✅ 미팅 체크</div><div>'+b.meet.map(function(m){return '☐ '+esc(m);}).join('<br>')+'</div>':'')+(b.tip?'<div class="lbl">💡 현지 팁</div><div>'+esc(b.tip)+'</div>':'')+wordHtml(b.zh);}).join('')
    +(P.trip.later&&P.trip.later.length?'<div class="lbl">다음 일정</div><div class="muted">'+P.trip.later.map(function(x){return esc(x.d.slice(5))+' '+esc(x.from)+'→'+esc(x.to)+(x.t?' '+esc(x.t):'')+(x.no?' '+esc(x.no):'');}).join('<br>')+'</div>':'')+'</div>';}
  if(P.trend&&P.trend.items){toc.push(['trend','🔥 중국 인터넷']);h+='<div class="card" id="trend"><h2>🔥 오늘의 중국 인터넷</h2>'+P.trend.items.map(function(x,i){return '<div class="it"><b>'+(i+1)+'. '+esc(x.emo)+' '+esc(x.ko)+'</b><div class="zh">'+esc(x.zh)+(x.src?' <span class="pill">'+esc(x.src)+'</span>':'')+'</div><div>'+esc(x.what)+'</div><div class="muted">💡 '+esc(x.why)+'</div>'+wordHtml(x.word)+'</div>';}).join('')
    +(P.trend.office?'<div class="lbl">🏢 회사에서 한마디</div>'+wordHtml(P.trend.office):'')+'</div>';}
  if(P.radar){toc.push(['radar','📡 레이더']);var r=P.radar;h+='<div class="card" id="radar"><h2>📡 경쟁 채널 레이더</h2><div class="muted">'+esc(r.n)+'편 실측 · '+new Date(r.at).toLocaleDateString('ko-KR')+'</div>'+(r.oneline?'<div style="margin:8px 0;font-weight:700">'+esc(r.oneline)+'</div>':'')
    +(r.patterns.length?'<div class="lbl">잘 되는 패턴</div>'+r.patterns.map(function(p){return '<div class="it"><b>'+esc(p.name)+'</b><div class="muted">📊 '+esc(p.evidence)+'</div><div>👉 '+esc(p.apply)+'</div></div>';}).join(''):'')
    +(r.hooks.length?'<div class="lbl">첫 2초 훅 틀</div>'+r.hooks.map(function(x){return '<div>“'+esc(x)+'”</div>';}).join(''):'')
    +(r.topics.length?'<div class="lbl">해볼 주제</div>'+r.topics.map(function(x){return '<div class="it"><b>'+esc(x.topic)+'</b><div class="muted">첫마디 “'+esc(x.hook)+'” · '+esc(x.from)+'</div></div>';}).join(''):'')
    +(r.avoid.length?'<div class="lbl">피할 것</div>'+r.avoid.map(function(x){return '<div>✕ '+esc(x)+'</div>';}).join(''):'')
    +(r.sleepers&&r.sleepers.length?'<div class="lbl">🌱 작은 채널인데 터진 영상</div>'+r.sleepers.map(function(x){return '<div class="muted">'+esc(x.t)+' <span class="pill">'+esc(x.d)+'/일 · 구독 '+esc(x.subs)+'</span></div>';}).join(''):'')+'</div>';}
  if(P.cmt&&P.cmt.groups){toc.push(['cmt','💬 댓글']);h+='<div class="card" id="cmt"><h2>💬 사람들이 묻는 것</h2>'+P.cmt.groups.map(function(g){return '<div class="it"><b>'+esc(g.q)+'</b> <span class="pill">'+esc(g.n)+'명</span><div class="muted">🎬 '+esc(g.topic)+' · “'+esc(g.hook)+'”</div>'+(g.film?'<div class="muted">📷 '+esc(g.film)+'</div>':'')+'</div>';}).join('')
    +(P.cmt.mine&&P.cmt.mine.length?'<div class="lbl">우리 영상에 달린 질문(아직 답 없음)</div>'+P.cmt.mine.map(function(t){return '<div class="muted">“'+esc(t)+'”</div>';}).join(''):'')+'</div>';}
  if(P.week&&P.week.items){toc.push(['week','🗓 기획']);h+='<div class="card" id="week"><h2>🗓 이번에 찍을 숏츠</h2>'+P.week.items.map(function(x){return '<div class="it"><b>'+esc(KIND[x.kind]||'')+' '+esc(x.title)+'</b><div class="muted">📍 '+esc(x.where)+' · 첫마디 “'+esc(x.hook)+'”</div><div class="muted">'+esc(x.why)+'</div>'+(x.shots||[]).map(function(s,i){return '<div>'+(i+1)+'. '+esc(s.what)+' <span class="muted">— '+esc(s.how)+' ('+esc(s.sec)+'초)</span></div>';}).join('')+'</div>';}).join('')+'</div>';}
  if(P.yt){toc.push(['yt','📈 채널']);h+='<div class="card" id="yt"><h2>📈 내 채널</h2><div>구독 <b>'+esc(P.yt.subs)+'</b> · 영상 '+esc(P.yt.n)+'개 · 누적 조회 '+esc(P.yt.views)+'</div>'+(P.yt.top||[]).map(function(x){return '<div class="muted">'+esc(x.t)+' <span class="pill">'+esc(x.v)+'회 · 👍'+esc(x.l)+' · 💬'+esc(x.c)+'</span></div>';}).join('')+'</div>';}
  if(P.novel){toc.push(['novel','📖 소설']);var nv=P.novel;h+='<div class="card novel" id="novel"><h2>📖 '+esc(nv.n)+'화 · '+esc(nv.title)+'</h2><div class="ab"><button id="abPlay">▶ 오디오북 듣기</button><span class="muted" id="abSt">'+nv.audio.length+'조각 · 내 목소리</span></div>'+radioHtml(nv.n)+nv.text.split(/\n+/).map(function(p){return '<p>'+esc(p)+'</p>';}).join('')+'</div>';}
  if(!P.novel)h+='<div class="card" id="novel"><h2>📖 소설 · 📻 라디오 드라마</h2><p class="muted">아직 연재 소설이 없어요. 소설 한 화가 있어야 오디오북·라디오 드라마를 만들 수 있어요.</p><p><a class="re" href="/novel" style="text-decoration:none;display:inline-block">📖 소설 한 화 쓰러 가기 (1분)</a> <span class="muted">→ 쓰고 나서 여기 아래 🔄 다시 만들기</span></p></div>';
  if(P.quest){toc.push(['quest','🧭 탐험']);h+='<div class="card" id="quest"><h2>🧭 주말 탐험 · '+esc(P.quest.pts)+'점</h2>'+P.quest.hist.map(function(x){return '<div class="it"><b>'+esc(x.name)+'</b> <span class="pill">'+esc(x.date)+' · +'+esc(x.pts)+'</span><div class="muted">'+esc(x.title)+(x.comment?' — '+esc(x.comment):'')+'</div></div>';}).join('')+'</div>';}
  if(P.signs){toc.push(['signs','🪧 간판']);h+='<div class="card" id="signs"><h2>🪧 간판 사냥 · '+esc(P.signs.pts)+'점</h2>'+P.signs.items.map(function(x){return '<div class="it"><b>'+esc(x.zh)+'</b> '+'★'.repeat(x.fun||0)+'<div>직역: '+esc(x.literal)+'</div><div class="muted">진짜 뜻: '+esc(x.real)+'</div></div>';}).join('')+'</div>';}
  if(!toc.length)h+='<div class="card muted">아직 담을 게 없어요. 출장 브리핑·레이더·소설 같은 걸 한 번 만들어 두면 여기 모여요.</div>';
  h+='<div class="card"><div class="lbl">글자 크기</div><div class="chips">'+[['','보통'],['l','크게'],['xl','아주 크게']].map(function(z){return '<button class="chip'+((document.documentElement.getAttribute('data-s')||'')===z[0]?' on':'')+'" data-z="'+z[0]+'">'+z[1]+'</button>';}).join('')+'</div>'
    +'<p class="muted" style="margin:12px 0 0">비행기 모드에서도 이 화면·🔊 전부 돼요(한 번 온라인에서 열어 둔 뒤). 기록이 바뀌었으면 <button class="re" id="re"'+(offline?' disabled':'')+'>🔄 다시 만들기</button></p></div>';
  $('main').innerHTML=h;
  $('toc').innerHTML=toc.map(function(t){return '<a href="#'+t[0]+'">'+t[1]+'</a>';}).join('');
  stat();
  document.querySelectorAll('[data-say]').forEach(function(b){b.onclick=function(){say(b.getAttribute('data-say'),b);};});
  document.querySelectorAll('[data-z]').forEach(function(b){b.onclick=function(){var z=b.getAttribute('data-z');document.documentElement.setAttribute('data-s',z);try{localStorage.setItem('mag-size',z);}catch(e){}render(offline);};});
  var re=$('re');if(re)re.onclick=function(){load(true);};
  var ab=$('abPlay');if(ab)ab.onclick=function(){playBook(P.novel.audio);};
  radioBind();
}
var BOOK=null;
function playBook(list){var b=$('abPlay'),st=$('abSt');
  if(BOOK){BOOK.pause();BOOK=null;b.textContent='▶ 오디오북 듣기';b.classList.remove('on');st.textContent=list.length+'조각 · 내 목소리';return;}
  if(AU)AU.pause();var i=0;b.textContent='■ 멈추기';b.classList.add('on');
  (function next(){if(i>=list.length){BOOK=null;b.textContent='▶ 오디오북 듣기';b.classList.remove('on');st.textContent='끝';return;}
    st.textContent=(i+1)+'/'+list.length+' 재생 중';BOOK=new Audio(list[i]);BOOK.onended=function(){i++;next();};BOOK.onerror=function(){st.textContent=(i+1)+'번 조각을 못 받았어요'+(navigator.onLine?'':' (오프라인)');i++;next();};
    var p=BOOK.play();if(p&&p.catch)p.catch(function(){st.textContent='재생 실패';});})();
}

// ---------- 📻 라디오 드라마 ----------
var RD=null,RDP=null,RDAC=null;
function rdCache(){try{return JSON.parse(localStorage.getItem('mag-radio')||'null');}catch(e){return null;}}
function radioHtml(n){var r=rdCache();var ready=r&&r.n===n&&r.done>=r.lines.length;
  return '<div class="ab" style="border-top:1px solid var(--line);padding-top:10px"><button id="rdBtn">'+(ready?'📻 라디오 드라마 듣기':'📻 라디오 드라마 만들기')+'</button><span class="muted" id="rdSt">'+(r&&r.n===n?(ready?r.lines.length+'줄 · 오프라인 준비 끝':'준비 '+r.done+'/'+r.lines.length):'소설을 성우 셋이 연기 · 15분쯤')+'</span></div><div id="rdBox"></div>';}
function radioBind(){var b=$('rdBtn');if(!b)return;b.onclick=function(){var r=rdCache(),n=S.parts.novel.n;if(r&&r.n===n&&r.done>=r.lines.length)return rdPlay(r);if(!navigator.onLine)return toast('대본과 음성은 온라인에서 먼저 받아야 해요');rdMake(n,r&&r.n===n?r:null);};}
function rdMake(n,prev){var b=$('rdBtn'),st=$('rdSt');b.disabled=true;
  var go=function(r){RD=r;r.done=r.done||0;localStorage.setItem('mag-radio',JSON.stringify(r));
    (function next(){if(r.done>=r.lines.length){localStorage.setItem('mag-radio',JSON.stringify(r));b.disabled=false;b.textContent='📻 라디오 드라마 듣기';st.textContent=r.lines.length+'줄 · 오프라인 준비 끝';return;}
      st.textContent='🎙 음성 준비 '+(r.done+1)+'/'+r.lines.length+(r.lines[r.done].who==='nar'?' (내레이션)':'');
      api('/mag/radio/line',{n:r.n,i:r.done}).then(function(j){if(!j.ok){st.textContent='실패: '+(j.detail||j.error)+' — 다시 누르면 이어서';b.disabled=false;b.textContent='📻 이어서 준비';return;}
        return fetch(j.url).then(function(){r.done++;localStorage.setItem('mag-radio',JSON.stringify(r));next();});}).catch(function(){st.textContent='네트워크 오류 — 다시 누르면 이어서';b.disabled=false;});})();};
  if(prev&&prev.lines){st.textContent='이어서 준비…';return go(prev);}
  st.textContent='✍️ 대본 쓰는 중… (40초쯤)';
  api('/mag/radio/make',{n:n}).then(function(j){if(!j.ok){st.textContent=j.detail||j.error;b.disabled=false;return;}go({n:j.radio.n,title:j.radio.title,names:j.radio.names,lines:j.radio.lines,urls:j.radio.urls,done:0});});
}
function getAC(){if(!RDAC){var A=window.AudioContext||window.webkitAudioContext;RDAC=new A();}if(RDAC.state==='suspended')RDAC.resume();return RDAC;}
// 효과음은 전부 WebAudio 합성(저작권 없음): 비·거리 소음·문·발소리·전화·시장·밤
function sfx(kind){if(kind==='none'||!kind)return 0;try{var ac=getAC(),t=ac.currentTime,g=ac.createGain();g.connect(ac.destination);
  function noise(sec,vol,lp){var n=ac.createBufferSource(),b=ac.createBuffer(1,ac.sampleRate*sec,ac.sampleRate),d=b.getChannelData(0);for(var i=0;i<d.length;i++)d[i]=Math.random()*2-1;n.buffer=b;var f=ac.createBiquadFilter();f.type='lowpass';f.frequency.value=lp;n.connect(f);f.connect(g);g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(vol,t+0.3);g.gain.setValueAtTime(vol,t+sec-0.6);g.gain.linearRampToValueAtTime(0,t+sec);n.start(t);n.stop(t+sec);}
  function tone(f0,at,dur,vol,type){var o=ac.createOscillator(),gg=ac.createGain();o.type=type||'sine';o.frequency.value=f0;o.connect(gg);gg.connect(g);gg.gain.setValueAtTime(0,t+at);gg.gain.linearRampToValueAtTime(vol,t+at+0.01);gg.gain.exponentialRampToValueAtTime(0.001,t+at+dur);o.start(t+at);o.stop(t+at+dur);}
  g.gain.value=1;
  if(kind==='rain'){noise(2.6,0.22,1800);return 2.4;}
  if(kind==='street'||kind==='market'){noise(2.4,0.12,900);for(var i=0;i<6;i++)tone(300+Math.random()*500,0.2+i*0.35,0.12,0.05,'triangle');return 2.2;}
  if(kind==='night'){noise(2.4,0.05,400);for(var k=0;k<5;k++)tone(3800,0.3+k*0.4,0.08,0.03);return 2.2;}
  if(kind==='door'){tone(120,0,0.12,0.5,'square');tone(90,0.16,0.12,0.5,'square');return 0.6;}
  if(kind==='steps'){for(var j=0;j<4;j++)tone(80,j*0.42,0.08,0.4,'triangle');return 1.8;}
  if(kind==='phone'){for(var m=0;m<2;m++){tone(880,m*1.0,0.18,0.15);tone(880,m*1.0+0.25,0.18,0.15);}return 2.0;}
  }catch(e){}return 0;}
var RDI=0,RDON=false;
function rdPlay(r){var box=$('rdBox'),b=$('rdBtn');if(RDON){RDON=false;if(RDP)RDP.pause();b.textContent='📻 라디오 드라마 듣기';box.innerHTML='';return;}
  if(AU)AU.pause();if(BOOK){BOOK.pause();BOOK=null;}RDON=true;RDI=0;b.textContent='■ 멈추기';getAC();
  var W={nar:'🎙',h:'👨 '+(r.names?r.names[0]:'남편'),w:'👩 '+(r.names?r.names[1]:'아내'),x:'🗣'};
  (function next(){if(!RDON)return;if(RDI>=r.lines.length){RDON=false;b.textContent='📻 라디오 드라마 듣기';box.innerHTML='<p class="muted">끝 — '+esc(r.title)+'</p>';return;}
    var l=r.lines[RDI];box.innerHTML='<div class="muted" style="margin-bottom:4px">'+(RDI+1)+'/'+r.lines.length+' · '+esc(r.title)+'</div><div style="font-size:17px"><b>'+esc(W[l.who]||'')+'</b> '+esc(l.t)+'</div>';
    var wait=sfx(l.sfx)*1000;
    setTimeout(function(){if(!RDON)return;RDP=new Audio(r.urls[RDI]);RDP.onended=function(){RDI++;setTimeout(next,l.who==='nar'?250:120);};RDP.onerror=function(){RDI++;next();};var p=RDP.play();if(p&&p.catch)p.catch(function(){RDI++;next();});},wait);})();
}
window.addEventListener('online',stat);window.addEventListener('offline',stat);
load(false);
</script></body></html>`;
