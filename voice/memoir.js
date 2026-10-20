// =========================================================
// 🎙 구술 자서전 — 매일 밤 박비서가 한 가지를 묻고(Qwen-Omni 실시간 음성), 대답을 千问이 한 편의 구술 글로 정리해 책처럼 쌓는다.
//  GET  /memoir                       화면(초대 코드 1회, localStorage pb-code) · 탭: 오늘 / 책 / 설정
//  WS   /memoir/ws?code&q             실시간 인터뷰 중계(worker.js realtime 에 memoirPrompt 지시문을 넘김, 도구 없음)
//  POST /memoir/state                 {doc 요약, cur 질문, entries 목록}
//  POST /memoir/next {fresh?}         오늘 질문 만들기(시기별 빈 곳·지난 이야기의 열린 실마리에서)
//  POST /memoir/save {qid, turns[]}   대화 → 千问이 1인칭 구술 글(제목·시기·본문·요약·사실·실마리) → KV
//  POST /memoir/entry {id} · /memoir/edit {id,title,text} · /memoir/del {id} · /memoir/say {id} → 내 목소리 조각 URL[]
//  POST /memoir/cfg {hour} · /memoir/export → markdown
//  GET  /memoir/a?h&id&n&s            읽어 주기 오디오(HMAC, R2 tts/memoir/<h>/<id>/<n>)
//  memoirCron: 15분 틱 — 주인(usage:owner)에게 정한 시각(기본 20시, 중국어 학습 알람 21시와 분리)에 오늘 질문 Bark(출장 브리핑의 bark 주소)
// KV memoir:<h> {cfg{hour}, cur{id,era,q,at,day}, entries[{id,at,era,title,summary,n}], facts[], threads[], sent, asked[]}
//    memoir:<h>:<id> {turns, title, era, text, summary, facts, threads, at}
// [필수] AI 는 百炼(千问·Omni·CosyVoice·qwen-tts)만 — Anthropic 호출 없음
// =========================================================
import { logUse } from "./usage.js";
import { barkPush } from "./brief.js";

const cnDay = (t = Date.now()) => new Date(t + 8 * 3600e3).toISOString().slice(0, 10);
const host = (env) => (env.DASHSCOPE_WS_HOST || "dashscope.aliyuncs.com").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
// qwen-tts: 업무공간 주소가 TTS 를 'url error'(400)로 거절하는 경우(2026-10-20) → 공용 주소로 한 번 더(같은 키)
async function ttsPost(env, body) {
  let r, j = {};
  for (const hh of [...new Set([host(env), "dashscope.aliyuncs.com"])]) {
    r = await fetch("https://" + hh + "/api/v1/services/aigc/multimodal-generation/generation", { method: "POST", headers: { authorization: "Bearer " + env.DASHSCOPE_API_KEY, "content-type": "application/json" }, body: JSON.stringify(body) });
    j = await r.json().catch(() => ({}));
    if (j.output && j.output.audio && j.output.audio.url) break;
  }
  return { r, j };
}
const merr = (message, status = 400) => Object.assign(new Error(message), { code: "memoir", status });
const ERAS = [["child", "어린 시절"], ["school", "학창 시절"], ["young", "청년·군대·첫 직장"], ["love", "연애·결혼"], ["work", "일과 회사"], ["china", "중국 부임과 생활"], ["family", "가족"], ["people", "사람들"], ["values", "생각과 가치관"], ["now", "요즘, 그리고 앞으로"]];
const ERA = Object.fromEntries(ERAS);

async function hmac16(env, s) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode("mm|" + (env.ALLOWED_CODES || "") + (env.DASHSCOPE_API_KEY || "")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(s));
  return [...new Uint8Array(sig)].slice(0, 8).map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function qwen(env, messages, opt = {}) {
  const models = [env.MEMOIR_MODEL, "qwen-plus", env.QUEST_MODEL || "qwen3.8-flash"].filter(Boolean);
  let last = "";
  for (const model of models) {
    const r = await fetch("https://" + host(env) + "/compatible-mode/v1/chat/completions", {
      method: "POST", headers: { authorization: "Bearer " + env.DASHSCOPE_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ model, messages, temperature: opt.temperature ?? 0.7, response_format: { type: "json_object" }, enable_thinking: false, max_tokens: 4000 }),
      signal: AbortSignal.timeout(70000),
    }).catch((e) => ({ ok: false, status: 0, text: async () => String(e.message || e) }));
    const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch {}
    if (!r.ok) { last = "千问 " + r.status + ": " + ((j.error && j.error.message) || t.slice(0, 160)); continue; }
    const c = String((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "").replace(/^```(?:json)?\s*|\s*```$/g, "");
    try { return JSON.parse(c); } catch { last = "千问 응답을 읽지 못했습니다"; continue; }
  }
  throw merr(last || "千问 실패", 502);
}
const dkey = (h) => "memoir:" + h;
async function load(env, h) { const d = (await env.KV.get(dkey(h), "json")) || {}; d.cfg = d.cfg || { hour: 20, set: 1 };
  // 2026-10-19: 중국어 학습 알람(21시)과 겹쳐 자서전 질문을 20시로 옮김 — 사용자가 직접 정한 적 없는 21시만 20시로
  if (d.cfg.hour === 21 && !d.cfg.set) { d.cfg.hour = 20; d.cfg.set = 1; } d.entries = d.entries || []; d.facts = d.facts || []; d.threads = d.threads || []; d.asked = d.asked || []; return d; }
async function save(env, h, d) { await env.KV.put(dkey(h), JSON.stringify(d)); }
function coverage(d) { const c = {}; ERAS.forEach(([k]) => (c[k] = 0)); d.entries.forEach((e) => { if (c[e.era] != null) c[e.era]++; }); return c; }

// 오늘 질문 — 비어 있는 시기 우선 + 지난 이야기의 열린 실마리를 섞어 千问이 구체적인 한 장면을 묻게
async function nextQuestion(env, d) {
  const cov = coverage(d), recent = d.entries.slice(-5).map((e) => "- [" + ERA[e.era] + "] " + e.title + ": " + e.summary);
  const least = ERAS.slice().sort((a, b) => cov[a[0]] - cov[b[0]]).slice(0, 4).map(([k, n]) => n + "(" + cov[k] + "편)");
  const out = await qwen(env, [{ role: "user", content: "너는 한 사람의 구술 자서전을 만드는 인터뷰어다. 주인공: 중국 광저우에서 일하는 한국인 40대 가장(의류 생산 관리 일, 아내·딸과 함께 산다). 매일 밤 5분, 질문 하나로 그날 이야기를 듣는다.\n" +
    "지금까지 적게 다룬 시기: " + least.join(", ") + "\n최근 이야기:\n" + (recent.join("\n") || "(아직 없음 — 첫날)") + "\n열린 실마리(지난 대화에서 더 묻고 싶었던 것): " + (d.threads.slice(-8).join(" / ") || "없음") + "\n이미 물은 질문(피할 것): " + (d.asked.slice(-30).join(" / ") || "없음") + "\n" +
    "오늘 질문 하나를 만들어라. 규칙: 추상적 질문('가치관은?') 말고 구체적인 한 장면을 떠올리게 하는 질문(예: '처음 공장에 혼자 간 날, 문 앞에서 무슨 생각이 들었어요?'). 1~2문장, 존댓말, 따뜻하지만 담백. 열린 실마리가 있으면 10번에 4번 정도는 그걸 잇고, 아니면 적게 다룬 시기에서. era 는 " + ERAS.map(([k, n]) => k + "=" + n).join(", ") + " 중 하나. why 는 이 질문을 고른 이유 한 줄(화면에 작게 표시).\nJSON: {\"era\":\"\",\"q\":\"\",\"why\":\"\"}" }], { temperature: 0.9 });
  const era = ERA[out.era] ? out.era : least[0] ? ERAS.find(([, n]) => least[0].startsWith(n))[0] : "now";
  return { id: "q" + Date.now().toString(36), era, q: String(out.q || "").slice(0, 200), why: String(out.why || "").slice(0, 100), at: Date.now(), day: cnDay() };
}

// 실시간 인터뷰 지시문(worker.js 가 세션에 넣음)
export async function memoirPrompt(env, h, qid) {
  const d = await load(env, h);
  const cur = d.cur && (!qid || d.cur.id === qid) ? d.cur : null;
  const q = cur ? cur.q : "오늘 하루 중에 제일 기억에 남는 순간 하나만 들려주세요.";
  return "너는 '구술 자서전' 인터뷰어다. 상대는 중국 광저우에서 일하는 한국인 가장이고, 매일 밤 5분씩 자기 인생 이야기를 들려준다. 너의 일은 잘 듣고, 더 구체적으로 묻는 것.\n" +
    "오늘의 질문: \"" + q + "\"\n" +
    "진행: 처음에 한 문장으로 짧게 인사하고 오늘의 질문을 그대로 묻는다. 대답을 들으면 1문장으로 받아 주고(평가·요약·칭찬 남발 금지), 바로 꼬리 질문 하나 — 그때 장면·거기 있던 사람·오간 말·그때 느낌·지금 돌아보면 어떤지 중 하나를 구체적으로. 한 번에 질문은 하나. 상대가 길게 말하면 끊지 말고 기다린다. 대답이 짧으면 '조금만 더요' 식으로 한 번 더 판다. 꼬리 질문은 3~5개.\n" +
    "마무리: 상대가 '그만'·'오늘은 여기까지'라고 하거나 대화가 6분쯤 되면 '오늘 이야기는 자서전에 잘 넣어 둘게요. 내일 또 여쭐게요.'라고 말하고 끝낸다(이 문장은 그대로 써라).\n" +
    "말투: 한국어 존댓말, 따뜻하지만 담백하게. 감탄사·'정말요?'·'대단하세요' 같은 리액션 반복 금지. 네 말은 짧게(2문장 이내). 상대 말을 네 생각으로 바꿔 말하지 말 것.\n" +
    (d.facts.length ? "알고 있는 배경(상대가 전에 말한 것, 맞춰서 묻되 다시 설명하게 하지 말 것): " + d.facts.slice(-12).join(" / ") + "\n" : "") +
    (d.entries.length ? "지난 이야기 제목: " + d.entries.slice(-5).map((e) => e.title).join(", ") + "\n" : "");
}

async function writeEntry(env, d, turns, cur) {
  const log = turns.map((t) => (t.r === "me" ? "주인공: " : "인터뷰어: ") + t.t).join("\n");
  const out = await qwen(env, [{ role: "user", content: "아래는 구술 자서전 인터뷰 녹취다. 주인공의 말만으로 한 편의 구술 글을 써라.\n규칙: 1인칭('나'), 주인공의 말투·단어·문장 호흡을 최대한 살린 구술체(인터뷰어의 질문은 빼고, 답을 이어 붙여 자연스럽게). 녹취에 없는 사실·감정·수식을 보태지 말 것. 음성 인식 오타·중복은 바로잡기. 길이는 녹취 분량에 비례(300~1100자), 2~5문단. title 은 10~20자(그 이야기의 한 장면), era 는 " + ERAS.map(([k, n]) => k + "=" + n).join(", ") + " 중 하나, summary 는 한 줄(40자), facts 는 다음 인터뷰에서 알고 있어야 할 사실(이름·장소·연도·관계) 최대 6개(짧게), threads 는 더 묻고 싶은 실마리 최대 3개(질문 형태).\n" +
    (cur ? "오늘 질문: " + cur.q + "\n" : "") + "녹취:\n" + log.slice(0, 12000) + "\nJSON: {\"title\":\"\",\"era\":\"\",\"text\":\"\",\"summary\":\"\",\"facts\":[],\"threads\":[]}" }], { temperature: 0.4 });
  return { title: String(out.title || "오늘 이야기").slice(0, 40), era: ERA[out.era] ? out.era : (cur ? cur.era : "now"), text: String(out.text || "").slice(0, 4000), summary: String(out.summary || "").slice(0, 80),
    facts: (Array.isArray(out.facts) ? out.facts : []).map((x) => String(x).slice(0, 60)).slice(0, 6), threads: (Array.isArray(out.threads) ? out.threads : []).map((x) => String(x).slice(0, 80)).slice(0, 3) };
}

function chunks(text) { const ps = text.split(/\n+/).map((x) => x.trim()).filter(Boolean), out = []; let cur = ""; for (const p of ps) { if ((cur + "\n" + p).length > 420 && cur) { out.push(cur); cur = p; } else cur = cur ? cur + "\n" + p : p; } if (cur) out.push(cur); return out.slice(0, 8); }
async function sayPiece(env, h, id, n, text, synth) {
  const key = "tts/memoir/" + h + "/" + id + "/" + n;
  for (const ext of [".mp3", ".wav"]) { const head = await env.R2.head(key + ext); if (head) return key + ext; }
  const kr = await env.KV.get("voice:kr:" + h);
  let mp3 = null, ext = ".mp3";
  if (kr) { try { mp3 = await synth(env, kr, text, null, { language_hints: ["ko"], rate: 1.0, volume: 100 }); } catch { mp3 = null; } }
  if (!mp3) {
    const { r, j } = await ttsPost(env, { model: env.SHORTS_TTS_MODEL || "qwen3-tts-flash", input: { text, voice: "Ethan", language_type: "Korean" } });
    const u = j.output && j.output.audio && j.output.audio.url;
    if (!u) throw merr("음성 합성 실패: " + (j.message || r.status), 502);
    const a = await fetch(u); if (!a.ok) throw merr("오디오 받기 실패", 502); mp3 = new Uint8Array(await a.arrayBuffer()); ext = ".wav";
  }
  await env.R2.put(key + ext, mp3, { httpMetadata: { contentType: ext === ".mp3" ? "audio/mpeg" : "audio/wav" } });
  return key + ext;
}

export async function memoirApi(env, ctx, path, b, h, synth) {
  const d = await load(env, h);
  if (path === "/memoir/state") {
    if (!d.cur || d.cur.day !== cnDay()) { try { d.cur = await nextQuestion(env, d); d.asked.push(d.cur.q); d.asked = d.asked.slice(-60); await save(env, h, d); } catch (e) { d.curErr = String(e.message || e); } }
    return { ok: true, today: cnDay(), cur: d.cur, curErr: d.curErr, cfg: d.cfg, eras: ERAS, entries: d.entries.slice().reverse(), n: d.entries.length, cov: coverage(d) };
  }
  if (path === "/memoir/next") {
    const day = cnDay(), nk = "memoir:next:" + day + ":" + h, n = Number(await env.KV.get(nk)) || 0;
    if (n >= 6) throw merr("오늘은 질문을 더 바꿀 수 없어요(6번).", 429);
    d.cur = await nextQuestion(env, d); d.asked.push(d.cur.q); d.asked = d.asked.slice(-60); await save(env, h, d);
    await env.KV.put(nk, String(n + 1), { expirationTtl: 86400 });
    return { ok: true, cur: d.cur };
  }
  if (path === "/memoir/save") {
    const turns = (Array.isArray(b.turns) ? b.turns : []).map((t) => ({ r: t.r === "me" ? "me" : "ai", t: String(t.t || "").trim().slice(0, 2000) })).filter((t) => t.t);
    const mine = turns.filter((t) => t.r === "me").map((t) => t.t).join(" ");
    if (mine.length < 40) throw merr("이야기가 너무 짧아서 글로 만들기 어려워요(40자 이상). 다음에 조금만 더 들려주세요.");
    const cur = d.cur && d.cur.id === b.qid ? d.cur : d.cur;
    const e = await writeEntry(env, d, turns, cur);
    const id = "m" + Date.now().toString(36);
    await env.KV.put(dkey(h) + ":" + id, JSON.stringify({ ...e, turns, at: Date.now(), q: cur ? cur.q : "" }));
    d.entries.push({ id, at: Date.now(), era: e.era, title: e.title, summary: e.summary, n: e.text.length });
    e.facts.forEach((f) => { if (!d.facts.includes(f)) d.facts.push(f); }); d.facts = d.facts.slice(-80);
    d.threads = d.threads.concat(e.threads).slice(-30);
    await save(env, h, d);
    ctx.waitUntil(logUse(env, "memoir", { save: 1 }, 0, h).catch(() => {}));
    return { ok: true, id, entry: e, n: d.entries.length };
  }
  if (path === "/memoir/entry") { const e = await env.KV.get(dkey(h) + ":" + String(b.id || ""), "json"); if (!e) throw merr("없는 글이에요.", 404); return { ok: true, id: b.id, entry: e }; }
  if (path === "/memoir/edit") {
    const id = String(b.id || ""), e = await env.KV.get(dkey(h) + ":" + id, "json"); if (!e) throw merr("없는 글이에요.", 404);
    if (typeof b.title === "string") e.title = b.title.trim().slice(0, 40); if (typeof b.text === "string") e.text = b.text.trim().slice(0, 4000); if (ERA[b.era]) e.era = b.era;
    await env.KV.put(dkey(h) + ":" + id, JSON.stringify(e));
    const m = d.entries.find((x) => x.id === id); if (m) { m.title = e.title; m.era = e.era; m.n = e.text.length; }
    await save(env, h, d);
    // 본문이 바뀌었으면 읽어 주기 캐시 삭제
    for (let n = 0; n < 8; n++) for (const ext of [".mp3", ".wav"]) ctx.waitUntil(env.R2.delete("tts/memoir/" + h + "/" + id + "/" + n + ext).catch(() => {}));
    return { ok: true };
  }
  if (path === "/memoir/del") {
    const id = String(b.id || ""); d.entries = d.entries.filter((x) => x.id !== id); await save(env, h, d); await env.KV.delete(dkey(h) + ":" + id);
    for (let n = 0; n < 8; n++) for (const ext of [".mp3", ".wav"]) ctx.waitUntil(env.R2.delete("tts/memoir/" + h + "/" + id + "/" + n + ext).catch(() => {}));
    return { ok: true };
  }
  if (path === "/memoir/say") {
    const id = String(b.id || ""), e = await env.KV.get(dkey(h) + ":" + id, "json"); if (!e) throw merr("없는 글이에요.", 404);
    const cs = chunks(e.text), urls = [];
    for (let n = 0; n < cs.length; n++) { const key = await sayPiece(env, h, id, n, cs[n], synth); urls.push("/memoir/a?h=" + h + "&id=" + id + "&n=" + n + "&x=" + key.slice(-3) + "&s=" + (await hmac16(env, h + "|" + id + "|" + n))); }
    return { ok: true, urls, pieces: cs.length };
  }
  if (path === "/memoir/cfg") { const hr = Math.round(Number(b.hour)); if (hr >= 6 && hr <= 23) { d.cfg.hour = hr; d.cfg.set = 1; } if (b.bark === "") d.cfg.noBark = true; else if (b.bark === "on") d.cfg.noBark = false; await save(env, h, d); return { ok: true, cfg: d.cfg }; }
  if (path === "/memoir/export") {
    const by = {}; for (const m of d.entries) { const e = await env.KV.get(dkey(h) + ":" + m.id, "json"); if (!e) continue; (by[m.era] = by[m.era] || []).push({ ...e, id: m.id, at: m.at }); }
    let md = "# 구술 자서전\n\n" + d.entries.length + "편 · " + cnDay() + " 내보냄\n\n";
    for (const [k, n] of ERAS) { if (!by[k]) continue; md += "## " + n + "\n\n"; for (const e of by[k]) md += "### " + e.title + "\n_" + cnDay(e.at) + "_\n\n" + e.text + "\n\n"; }
    return { ok: true, md };
  }
  throw merr("unknown", 404);
}

export async function memoirCron(env, uh) {
  const h = await env.KV.get("usage:owner"); if (!h) return;
  const d = await load(env, h), day = cnDay(), ch = (uh + 8) % 24;
  if (d.cfg.noBark || ch !== (d.cfg.hour || 20) || d.sent === day) return;
  const bd = await env.KV.get("brief:" + h, "json"); if (!bd || !bd.bark) return;
  if (!d.cur || d.cur.day !== day) { d.cur = await nextQuestion(env, d); d.asked.push(d.cur.q); d.asked = d.asked.slice(-60); }
  d.sent = day; await save(env, h, d);
  try { await barkPush(bd.bark, "🎙 오늘의 질문 (" + ERA[d.cur.era] + ")", d.cur.q, "https://voice.zhnote.net/memoir?open=1"); } catch (e) { console.log("memoirCron bark", e && e.message); }
}

export async function memoirGet(req, env, url) {
  if (url.pathname === "/memoir") return new Response(MEMOIR_HTML, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
  if (url.pathname === "/memoir/a") {
    const h = url.searchParams.get("h") || "", id = url.searchParams.get("id") || "", n = url.searchParams.get("n") || "0", x = url.searchParams.get("x") || "mp3";
    if (!/^[a-f0-9]{8,64}$/.test(h) || !/^m[a-z0-9]{4,12}$/.test(id) || !/^\d$/.test(n)) return new Response("bad", { status: 400 });
    if ((url.searchParams.get("s") || "") !== (await hmac16(env, h + "|" + id + "|" + n))) return new Response("forbidden", { status: 403 });
    const key = "tts/memoir/" + h + "/" + id + "/" + n + (x === "wav" ? ".wav" : ".mp3");
    const o = await env.R2.get(key); if (!o) return new Response("not found", { status: 404 });
    return new Response(o.body, { headers: { "content-type": o.httpMetadata?.contentType || "audio/mpeg", "cache-control": "private, max-age=86400" } });
  }
  return new Response("not found", { status: 404 });
}

export const MEMOIR_HTML = String.raw`<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#1664B0">
<meta name="apple-mobile-web-app-capable" content="yes">
<link rel="apple-touch-icon" href="/icon-180.png">
<title>구술 자서전</title>
<style>
:root{--sky:#1664B0;--bg:#EFE8DE;--card:#F7F2EA;--ink:#1A2330;--ink2:#5E6672;--line:#D9CEBD;--red:#D21624;--ok:#1E7D46}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 -apple-system,"Apple SD Gothic Neo",system-ui,sans-serif}
header{background:var(--sky);color:#fff;padding:calc(env(safe-area-inset-top) + 14px) 16px 12px;border-bottom:3px solid var(--red);display:flex;align-items:center;gap:12px}
header h1{margin:0;font-size:19px;flex:1}a.back{color:#fff;text-decoration:none;font-size:20px}
.tabs{display:flex;gap:6px;padding:10px 16px 0;max-width:640px;margin:0 auto}.tab{flex:1;padding:8px;border-radius:999px;border:1px solid var(--line);background:#fff;font-weight:700;font-size:14px;text-align:center;cursor:pointer}.tab.on{background:var(--sky);color:#fff;border-color:var(--sky)}
main{max-width:640px;margin:0 auto;padding:10px 16px 60px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin-top:12px}
.era{display:inline-block;font-size:11.5px;font-weight:800;letter-spacing:.04em;color:var(--sky);border:1px solid var(--sky);border-radius:999px;padding:1px 8px}
.q{font-size:21px;font-weight:800;line-height:1.45;margin:8px 0 4px}.why{font-size:12.5px;color:var(--ink2)}
.m{font-size:13px;color:var(--ink2)}
button,textarea,input,select{font:inherit}button{cursor:pointer}
.big{width:100%;padding:16px;border:0;border-radius:14px;background:var(--red);color:#fff;font-size:18px;font-weight:800;margin-top:12px}.big.on{background:var(--ink)}.big:disabled{opacity:.5}
.b2{background:#fff;border:1px solid var(--line);color:var(--sky);border-radius:9px;padding:7px 12px;font-weight:700;font-size:13px}.b2.red{color:var(--red)}
.st{font-size:13px;color:var(--ink2);text-align:center;margin-top:8px;min-height:1.3em}
.log{margin-top:10px;display:flex;flex-direction:column;gap:6px}.log .me,.log .ai{padding:8px 12px;border-radius:12px;font-size:14.5px;max-width:92%}.log .me{align-self:flex-end;background:var(--sky);color:#fff}.log .ai{align-self:flex-start;background:#fff;border:1px solid var(--line)}
.entry{white-space:pre-wrap;font-size:16px;line-height:1.75}.entry.serif{font-family:"Apple Myungjo","Nanum Myeongjo",serif}
.row{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;align-items:center}
.list .it{padding:10px 0;border-top:1px solid var(--line);cursor:pointer}.list .it:first-child{border-top:0}.list b{font-size:15px}.list small{display:block;color:var(--ink2);font-size:12.5px}
h2{font-size:15px;margin:0 0 6px}.cov{display:grid;grid-template-columns:repeat(2,1fr);gap:4px 12px;font-size:13px}.cov i{font-style:normal;color:var(--ink2)}
textarea{width:100%;min-height:200px;padding:10px;border:1px solid var(--line);border-radius:10px;background:#fff;line-height:1.7}input[type=text]{width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:9px;background:#fff}
.gate{padding:30px 0;text-align:center}.gate input{padding:10px;border:1px solid var(--line);border-radius:9px;font-size:16px}
.toast{position:fixed;left:50%;bottom:30px;transform:translateX(-50%);background:var(--ink);color:#fff;padding:8px 14px;border-radius:999px;font-size:13px;opacity:0;transition:.2s;pointer-events:none;max-width:90%}.toast.on{opacity:1}
</style></head><body>
<header><a class="back" href="/hub" aria-label="도구함">‹</a><h1>🎙 구술 자서전</h1><span id="cnt" style="font-size:13px;opacity:.9"></span></header>
<div class="tabs"><div class="tab on" data-t="today">오늘</div><div class="tab" data-t="book">책</div><div class="tab" data-t="set">설정</div></div>
<main id="main"></main>
<div class="toast" id="toast"></div>
<script>
(function(){
var $=function(i){return document.getElementById(i)};var CODE='';try{CODE=localStorage.getItem('pb-code')||'';}catch(e){}
var ST=null,TAB='today',S=null,TURNS=[],VIEW=null,AUD=null;
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function toast(t){var e=$('toast');e.textContent=t;e.classList.add('on');setTimeout(function(){e.classList.remove('on')},2200)}
function api(p,b){b=b||{};b.code=CODE;return fetch(p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json()}).catch(function(e){return {ok:false,error:'network',detail:String(e&&e.message||e)}})}
function day(ms){var d=new Date(ms+8*3600e3);return d.toISOString().slice(0,10)}
function eraName(k){var e=(ST&&ST.eras||[]).filter(function(x){return x[0]===k})[0];return e?e[1]:k}
function gate(){$('main').innerHTML='<div class="gate"><p>박비서 초대 코드를 넣어 주세요</p><input id="ci" placeholder="초대 코드"> <button class="b2" id="go">열기</button></div>';$('go').onclick=function(){CODE=$('ci').value.trim();try{localStorage.setItem('pb-code',CODE);}catch(e){}load();}}
function load(){if(!CODE)return gate();$('main').innerHTML='<p class="m" style="margin-top:14px">불러오는 중…</p>';api('/memoir/state').then(function(r){if(!r.ok){if(r.error==='not_allowed')return gate();$('main').innerHTML='<p class="m">'+esc(r.detail||r.error)+'</p>';return}ST=r;$('cnt').textContent=r.n+'편';render()})}
document.querySelectorAll('.tab').forEach(function(t){t.onclick=function(){if(S)return toast('인터뷰를 먼저 끝내 주세요');TAB=t.dataset.t;document.querySelectorAll('.tab').forEach(function(x){x.classList.toggle('on',x===t)});VIEW=null;render()}});
function render(){if(TAB==='today')today();else if(TAB==='book')book();else setting()}
// ---------- 오늘 ----------
function today(){var c=ST.cur;
  var h='<div class="card">'+(c?'<span class="era">'+esc(eraName(c.era))+'</span><div class="q">'+esc(c.q)+'</div><div class="why">'+esc(c.why||'')+'</div>':'<p class="m">'+esc(ST.curErr||'질문을 만들지 못했어요')+'</p>')
    +'<div class="row"><button class="b2" id="nq">🔄 다른 질문</button><button class="b2" id="rq">🔊 질문 듣기</button></div>'
    +'<button class="big" id="mic">🎙 이야기 시작</button><div class="st" id="st">마이크 버튼을 누르면 인터뷰어가 먼저 인사하고 묻습니다. 편하게 말하고, 끝낼 땐 "오늘은 여기까지"라고 하거나 ■ 를 누르세요.</div><div class="log" id="log"></div></div><div id="out"></div>';
  $('main').innerHTML=h;
  $('nq').onclick=function(){var b=this;b.disabled=true;api('/memoir/next').then(function(r){b.disabled=false;if(!r.ok)return toast(r.detail||r.error);ST.cur=r.cur;today()})};
  $('rq').onclick=function(){try{var u=new SpeechSynthesisUtterance(ST.cur.q);u.lang='ko-KR';speechSynthesis.speak(u)}catch(e){}};
  $('mic').onclick=function(){S?end(true):start()};
}
// ---------- 실시간 인터뷰(박비서와 같은 오디오 처리) ----------
function say(t){var e=$('st');if(e)e.textContent=t||''}
function add(cls,t){var log=$('log');if(!log)return null;var d=document.createElement('div');d.className=cls;d.textContent=t;log.appendChild(d);d.scrollIntoView({block:'nearest'});return d}
function b64(i16){var u=new Uint8Array(i16.buffer),s='';for(var i=0;i<u.length;i+=0x8000)s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000));return btoa(s)}
function down(f,sr){var r=sr/16000,n=Math.floor(f.length/r),o=new Int16Array(n);for(var i=0;i<n;i++){var a=Math.floor(i*r),b=Math.min(f.length,Math.floor((i+1)*r)),x=0;for(var j=a;j<b;j++)x+=f[j];var v=Math.max(-1,Math.min(1,x/Math.max(1,b-a)));o[i]=v<0?v*0x8000:v*0x7fff}return o}
function mkPcm(sr){return {buf:new Float32Array(48000),r:0,w:0,on:false,g:0,left:null,done:false,rate:24000/sr}}
function pcmPush(P,d){var bin=atob(d),L=bin.length+(P.left!=null?1:0),a=new Uint8Array(L),o=0;if(P.left!=null){a[0]=P.left;o=1;P.left=null}for(var k=0;k<bin.length;k++)a[o+k]=bin.charCodeAt(k);if(L%2){P.left=a[L-1];L--}var n=L>>1;if(!n)return;var r0=Math.floor(P.r),keep=P.w-r0;if(P.w+n>P.buf.length){var nb=new Float32Array(Math.max(48000,2*(keep+n)));nb.set(P.buf.subarray(r0,P.w));P.buf=nb;P.r-=r0;P.w=keep}for(var i=0;i<n;i++){var v=a[2*i]|(a[2*i+1]<<8);if(v>=0x8000)v-=0x10000;P.buf[P.w++]=v/0x8000}}
function pcmPull(P,out){var N=out.length,i=0;if(!P||!P.on){if(P&&(P.w-P.r>=3600||(P.done&&P.w-P.r>1))){P.on=true;P.g=0}else{out.fill(0);return}}for(;i<N;i++){var x=Math.floor(P.r);if(x+1>=P.w){P.on=false;break}var f=P.r-x,s=P.buf[x]+(P.buf[x+1]-P.buf[x])*f;if(P.g<1)P.g=Math.min(1,P.g+1/240);out[i]=s*P.g;P.r+=P.rate}var last=i?out[i-1]:0;for(;i<N;i++){last*=0.97;out[i]=last}if(!P.on&&P.w-P.r<=1){P.r=0;P.w=0}}
function pcmBusy(P){return !!P&&(P.on||P.w-P.r>1)}function pcmLeftMs(P){return P?Math.max(0,(P.w-P.r)/24000*1000):0}
function send(o){if(S&&S.ws&&S.ws.readyState===1)S.ws.send(JSON.stringify(o))}
function ev(e){var t=e.type;
  if(t==='session.updated'){S.ready=true;say('인터뷰어가 인사할게요…');send({type:'response.create'});return}
  if(t==='input_audio_buffer.speech_started'){say('듣는 중…');return}
  if(t==='input_audio_buffer.speech_stopped'){S.me=add('me','…');say('…');return}
  if(t==='conversation.item.input_audio_transcription.completed'){var tx=e.transcript||'';if(S.me){S.me.textContent=tx||'(인식 안 됨)';S.me=null}else add('me',tx);if(tx)TURNS.push({r:'me',t:tx});return}
  if(t==='response.created'){S.resp=true;S.cur=null;S.pl.left=null;S.pl.done=false;return}
  if(t==='response.audio_transcript.delta'){if(!S.cur)S.cur=add('ai','');S.cur.textContent+=e.delta||'';return}
  if(t==='response.audio_transcript.done'){var tt=e.transcript||'';if(S.cur&&tt)S.cur.textContent=tt;if(tt)TURNS.push({r:'ai',t:tt});if(/자서전에 잘 넣어/.test(tt))S.closing=true;return}
  if(t==='response.audio.delta'){if(e.delta)pcmPush(S.pl,e.delta);say('🔊');return}
  if(t==='response.done'){S.resp=false;S.pl.done=true;var w=pcmLeftMs(S.pl)+300;setTimeout(function(){if(!S)return;if(S.closing)end(true);else if(!S.resp)say('말씀하세요')},w);return}
  if(t==='error'){add('ai','⚠ '+((e.error&&(e.error.message||e.error.code))||'오류'));return}
  if(t==='relay.closed'){end(true)}
}
async function start(){
  var Ctx=window.AudioContext||window.webkitAudioContext,ctx=new Ctx();if(ctx.resume)ctx.resume();
  var stream;try{stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1}})}catch(e){say('마이크 권한이 필요합니다');ctx.close();return}
  TURNS=[];S={ctx:ctx,stream:stream,pl:mkPcm(ctx.sampleRate),ready:false,resp:false,t0:Date.now()};
  var src=ctx.createMediaStreamSource(stream),pr=ctx.createScriptProcessor(4096,1,1);
  pr.onaudioprocess=function(e){pcmPull(S&&S.pl,e.outputBuffer.getChannelData(0));if(!S||!S.ready)return;if(S.resp||pcmBusy(S.pl))return;send({type:'input_audio_buffer.append',audio:b64(down(e.inputBuffer.getChannelData(0),ctx.sampleRate))})};
  src.connect(pr);pr.connect(ctx.destination);S.pr=pr;S.src=src;
  var ws=new WebSocket(location.origin.replace(/^http/,'ws')+'/memoir/ws?code='+encodeURIComponent(CODE)+'&q='+encodeURIComponent(ST.cur?ST.cur.id:''));S.ws=ws;
  ws.onmessage=function(m){var e;try{e=JSON.parse(m.data)}catch(_){return}ev(e)};ws.onerror=function(){say('서버 연결 실패')};ws.onclose=function(){if(S)end(true)};
  $('mic').textContent='■ 오늘은 여기까지';$('mic').classList.add('on');say('연결 중…');$('log').innerHTML='';
}
function end(saveIt){if(!S)return;var s=S;S=null;try{s.ws.close()}catch(e){}try{s.pr.disconnect();s.src.disconnect()}catch(e){}try{s.stream.getTracks().forEach(function(t){t.stop()})}catch(e){}try{s.ctx.close()}catch(e){}
  var m=$('mic');if(m){m.textContent='🎙 이야기 시작';m.classList.remove('on')}say('');
  if(saveIt&&TURNS.some(function(t){return t.r==='me'}))saveTurns()}
function saveTurns(){var out=$('out');out.innerHTML='<div class="card"><p class="m">✍️ 오늘 이야기를 글로 정리하는 중… (20~40초)</p></div>';
  api('/memoir/save',{qid:ST.cur&&ST.cur.id,turns:TURNS}).then(function(r){if(!r.ok){out.innerHTML='<div class="card"><p class="m">'+esc(r.detail||r.error)+'</p><button class="b2" id="retry">다시 정리</button></div>';$('retry').onclick=saveTurns;return}
    ST.n=r.n;$('cnt').textContent=r.n+'편';ST.entries.unshift({id:r.id,at:Date.now(),era:r.entry.era,title:r.entry.title,summary:r.entry.summary,n:r.entry.text.length});
    out.innerHTML='<div class="card"><span class="era">'+esc(eraName(r.entry.era))+'</span><h2 style="margin-top:6px;font-size:19px">'+esc(r.entry.title)+'</h2><div class="entry serif">'+esc(r.entry.text)+'</div><div class="row"><button class="b2" data-say="'+r.id+'">🔊 내 목소리로 듣기</button><button class="b2" data-open="'+r.id+'">✏️ 고치기</button></div><p class="m" style="margin-top:8px">'+r.n+'번째 이야기가 책에 들어갔어요. 내일 밤 다음 질문을 보낼게요.</p></div>';
    bindEntry(out)})}
// ---------- 책 ----------
function book(){var es=ST.entries||[];if(VIEW)return viewEntry(VIEW);
  var cov=ST.cov||{},h='<div class="card"><h2>시기별</h2><div class="cov">'+(ST.eras||[]).map(function(e){return '<div>'+esc(e[1])+' <i>'+(cov[e[0]]||0)+'편</i></div>'}).join('')+'</div></div>';
  h+='<div class="card list">'+(es.length?es.map(function(e){return '<div class="it" data-open="'+e.id+'"><b>'+esc(e.title)+'</b><small>'+esc(eraName(e.era))+' · '+day(e.at)+' · '+e.n+'자 — '+esc(e.summary)+'</small></div>'}).join(''):'<p class="m">아직 이야기가 없어요. 오늘 탭에서 첫 질문에 답해 보세요.</p>')+'</div>';
  $('main').innerHTML=h;bindEntry($('main'))}
function bindEntry(root){root.querySelectorAll('[data-open]').forEach(function(x){x.onclick=function(){TAB='book';document.querySelectorAll('.tab').forEach(function(t){t.classList.toggle('on',t.dataset.t==='book')});viewEntry(x.dataset.open)}});
  root.querySelectorAll('[data-say]').forEach(function(x){x.onclick=function(){playEntry(x.dataset.say,x)}})}
function viewEntry(id){VIEW=id;$('main').innerHTML='<p class="m" style="margin-top:14px">불러오는 중…</p>';api('/memoir/entry',{id:id}).then(function(r){if(!r.ok){VIEW=null;toast(r.detail||r.error);return book()}var e=r.entry;
  $('main').innerHTML='<div class="card"><button class="b2" id="bk">‹ 목록</button><div style="margin-top:10px"><span class="era">'+esc(eraName(e.era))+'</span> <small class="m">'+day(e.at)+(e.q?' · 질문: '+esc(e.q):'')+'</small></div><h2 style="margin-top:6px;font-size:20px" id="ttl">'+esc(e.title)+'</h2><div class="entry serif" id="body">'+esc(e.text)+'</div>'
    +'<div class="row"><button class="b2" data-say="'+id+'">🔊 내 목소리로 듣기</button><button class="b2" id="ed">✏️ 고치기</button><button class="b2 red" id="dl">🗑 지우기</button></div><div id="edbox"></div></div>';
  $('bk').onclick=function(){VIEW=null;book()};bindEntry($('main'));
  $('dl').onclick=function(){if(!confirm('이 이야기를 지울까요?'))return;api('/memoir/del',{id:id}).then(function(){ST.entries=ST.entries.filter(function(x){return x.id!==id});ST.n=ST.entries.length;$('cnt').textContent=ST.n+'편';VIEW=null;book()})};
  $('ed').onclick=function(){$('edbox').innerHTML='<input type="text" id="et" value="'+esc(e.title)+'" style="margin-top:10px"><select id="ee" style="margin-top:6px;padding:6px;border:1px solid var(--line);border-radius:8px;background:#fff">'+(ST.eras||[]).map(function(x){return '<option value="'+x[0]+'"'+(x[0]===e.era?' selected':'')+'>'+esc(x[1])+'</option>'}).join('')+'</select><textarea id="ex" style="margin-top:6px">'+esc(e.text)+'</textarea><div class="row"><button class="b2" id="sv">저장</button></div>';
    $('sv').onclick=function(){var b=this;b.disabled=true;api('/memoir/edit',{id:id,title:$('et').value,text:$('ex').value,era:$('ee').value}).then(function(r){b.disabled=false;if(!r.ok)return toast(r.detail||r.error);var m=ST.entries.filter(function(x){return x.id===id})[0];if(m){m.title=$('et').value;m.era=$('ee').value;m.n=$('ex').value.length}toast('고쳤어요');viewEntry(id)})}}})}
function playEntry(id,btn){if(AUD){try{AUD.pause()}catch(e){}AUD=null;document.querySelectorAll('[data-say]').forEach(function(b){b.textContent='🔊 내 목소리로 듣기'});return}
  btn.textContent='⏳ 음성 만드는 중…';api('/memoir/say',{id:id}).then(function(r){if(!r.ok){btn.textContent='🔊 내 목소리로 듣기';return toast(r.detail||r.error)}var i=0;
    function nx(){if(i>=r.urls.length){AUD=null;btn.textContent='🔊 내 목소리로 듣기';return}var a=new Audio(r.urls[i++]);AUD=a;a.onended=nx;a.onerror=function(){toast('재생 실패');nx()};a.play().catch(function(){toast('재생 실패 — 다시 눌러 주세요');AUD=null;btn.textContent='🔊 내 목소리로 듣기'})}
    btn.textContent='■ 멈추기';nx()})}
// ---------- 설정 ----------
function setting(){var c=ST.cfg||{};
  $('main').innerHTML='<div class="card"><h2>밤 질문 알림</h2><p class="m">매일 이 시각(중국)에 오늘 질문을 아이폰 알림(Bark)으로 보내요. Bark 주소는 출장 브리핑 화면에 넣은 것을 그대로 씁니다.</p><div class="row"><select id="hr" style="padding:7px;border:1px solid var(--line);border-radius:8px;background:#fff">'+[18,19,20,21,22,23].map(function(x){return '<option value="'+x+'"'+(x===(c.hour||20)?' selected':'')+'>'+x+':00</option>'}).join('')+'</select><label style="font-size:13px"><input type="checkbox" id="nb"'+(c.noBark?'':' checked')+'> 알림 켜기</label><button class="b2" id="svc">저장</button></div></div>'
    +'<div class="card"><h2>내보내기</h2><p class="m">시기별로 묶은 글(markdown)을 받아요. 책으로 만들 때 쓰세요.</p><button class="b2" id="ex">📄 markdown 내보내기</button></div>'
    +'<div class="card"><h2>어떻게 되나요</h2><p class="m">밤마다 질문 하나 → 5분 대화(박비서 실시간 음성) → 千问이 내 말투 그대로 1인칭 글로 정리 → 책 탭에 쌓임. 다음 질문은 비어 있는 시기와 지난 이야기의 실마리에서 골라요. 내 목소리(숏츠용 한국어 목소리)가 등록돼 있으면 그 목소리로 읽어 줍니다.</p></div>';
  $('svc').onclick=function(){api('/memoir/cfg',{hour:+$('hr').value,bark:$('nb').checked?'on':''}).then(function(r){if(r.ok){ST.cfg=r.cfg;toast('저장했어요')}else toast(r.detail||r.error)})};
  $('ex').onclick=function(){api('/memoir/export').then(function(r){if(!r.ok)return toast(r.detail||r.error);var a=document.createElement('a');a.href='data:text/markdown;charset=utf-8,'+encodeURIComponent(r.md);a.download='구술자서전_'+ST.today+'.md';a.click()})};
}
load();
})();
</script></body></html>`;
