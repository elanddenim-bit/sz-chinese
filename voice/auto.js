// =========================================================
// 🤖 자동 채널 — 매일 아침 알아서 영상 1개: 오늘의 중국 인터넷 → 千问 대본(한 캐릭터가 15초 안에 말하는 한 토막) → 장면 공장(万相 3.0, 내 캐릭터·내 목소리)
//    → 완성되면 Bark "오늘 영상 준비" → 화면에서 ✅ 승인(예약 발행 대기열) / ❌ 반려(이유는 다음 대본에 반영). 주인(usage:owner) 전용.
//  GET  /auto                       화면(설정·오늘·이력)
//  POST /auto/state · /auto/cfg {on,hour,sec,res,voice,series,roles,images[]|delRef} · /auto/run(지금 바로) · /auto/tick(화면 폴링 = 크론과 같은 진행) · /auto/approve {day,privacy} · /auto/reject {day,note} · /auto/retry {day}
//  autoCron(env, uh, synth): 15분 틱마다 — 오늘 문서가 없고 중국 시각 == cfg.hour 이면 기획+영상 맡김, rendering 이면 폴링, 끝나면 초안(kind 'auto')·final.mp4 만들고 Bark.
// KV auto:<해시> {on, hour 7, sec 15, res 480P, voice mine, series cnet, refs[R2 키], roles[], notes[최근 반려 이유 8], seen[주제 60], log[30]}  /  auto:<해시>:<날짜> {st planning|rendering|ready|approved|rejected|failed, topic, title, say, scene, description, tags, task, k, id, err, at, note}
// R2 shorts/<해시>/auto/ref<n>.jpg(캐릭터·배경), 영상은 장면 공장 sw3/ 에 생기고 초안 shorts/<해시>/<id>/final.mp4 로 복사. 비용: 영상 1개 = sec × (480P 0.3 | 720P 0.6)위안 + 千问·TTS 소액.
// =========================================================
import { trendApi } from "./trend.js";
import { barkPush } from "./brief.js";
import { logUse } from "./usage.js";
import { w3Make, w3Poll, ytQueueAdd, shortsQwen, draftKey, listKey, fileUrl, KR_RULES, TONE_RULES } from "./shorts.js";

const cnDay = (t = Date.now()) => new Date(t + 8 * 3600e3).toISOString().slice(0, 10);
const aerr = (message, status = 400) => Object.assign(new Error(message), { code: "auto", status });
const cfgKey = (h) => "auto:" + h, dayKey = (h, d) => "auto:" + h + ":" + d;
const SERIES = { cnet: "중국 인터넷 1분", life: "광저우 생활 한 토막", price: "광저우 물가" };
async function cfg(env, h) { const c = (await env.KV.get(cfgKey(h), "json")) || {}; c.hour = c.hour || 7; c.sec = c.sec || 15; c.res = c.res || "480P"; c.voice = c.voice || "mine"; c.series = SERIES[c.series] ? c.series : "cnet"; c.refs = c.refs || []; c.roles = c.roles || []; c.notes = c.notes || []; c.seen = c.seen || []; c.log = c.log || []; return c; }
const saveCfg = (env, h, c) => env.KV.put(cfgKey(h), JSON.stringify(c));
async function today(env, h, d = cnDay()) { return (await env.KV.get(dayKey(h, d), "json")) || null; }
const saveDay = (env, h, d, doc) => env.KV.put(dayKey(h, d), JSON.stringify(doc), { expirationTtl: 60 * 86400 });
async function unqueue(env, h, id) { if (!id) return; const q = await env.KV.get("shorts:q:" + h, "json"); if (q && q.items && q.items.some((x) => x.id === id)) { q.items = q.items.filter((x) => x.id !== id); await env.KV.put("shorts:q:" + h, JSON.stringify(q)); } }
async function bark(env, h, title, body, url) { const bd = await env.KV.get("brief:" + h, "json"); if (!bd || !bd.bark) return false; try { await barkPush(bd.bark, title, body, url); return true; } catch (e) { console.log("auto bark", e && e.message); return false; } }
function logAdd(c, line) { c.log.unshift({ at: Date.now(), t: String(line).slice(0, 160) }); c.log = c.log.slice(0, 30); }

// ① 기획: 오늘의 화제 중 안 쓴 것 하나 → 캐릭터가 15초 안에 말하는 대본
async function plan(env, h, c, manualTopic) {
  let topics = [];
  if (!manualTopic) {
    try { const tr = await trendApi(env, { waitUntil() {} }, "/trend/today", {}, h); topics = (tr.items || tr.list || []).map((x) => ({ ko: x.ko || x.zh, what: x.what || "", why: x.why || "", word: x.word })); } catch (e) { throw aerr("오늘의 중국 인터넷을 못 받았어요: " + String(e.message || e).slice(0, 120), 502); }
    topics = topics.filter((t) => t.ko && !c.seen.includes(t.ko));
    if (!topics.length) throw aerr("오늘 화제 중 안 쓴 게 없어요.");
  }
  const maxSay = Math.min(64, Math.round(c.sec * 3.8)); // 15초 → 57자(말하기 ~13초, 음성 15초 상한)
  const o = await shortsQwen(env, [
    { role: "system", content: "너는 한국 시청자용 유튜브 숏츠 채널의 자동 기획자다. 채널: 광저우 사는 한국인 40대 가장이 운영, 얼굴 대신 '치비 일러스트 캐릭터'가 진행자. " + KR_RULES + " " + TONE_RULES +
      " 오늘은 " + c.sec + "초짜리 한 토막: 캐릭터가 카메라를 보고 한 호흡으로 말한다. 시리즈 '" + SERIES[c.series] + "'. " +
      "규칙: say 는 캐릭터의 대사 한 덩어리, " + maxSay + "자 이내(15초 안에 말해야 함), 첫 문장이 훅(숫자·질문·반전), 마지막은 댓글 유도 한 마디 또는 여운. 주제에 적힌 사실 밖은 말하지 않는다(지어내기 금지). scene 은 한국어 장면 지시: '2D 치비 일러스트 캐릭터(성인 남성, 선글라스) 그림체 그대로, 실사로 바꾸지 말 것'을 반드시 첫 문장에 쓰고(아이·어린이 같은 단어는 쓰지 말 것), 캐릭터가 어디(광저우 느낌 배경)에서 어떤 소품·제스처로 말하는지, 카메라 1~2컷, 글자·로고 없음, 실존 인물 묘사 금지. title 은 유튜브 제목 8~18자(번호 없이), description 2~3문장, tags 8~12개." +
      (c.notes.length ? " 주인의 최근 반려 이유(반드시 반영): " + c.notes.slice(-5).join(" / ") : "") +
      ' JSON: {"pick":번호(1부터) 또는 0,"topic":"고른 화제 한 줄","title":"","say":"","scene":"","description":"","tags":[]}' },
    { role: "user", content: manualTopic ? "주제(직접 지정): " + manualTopic : "오늘의 화제 후보:\n" + topics.map((t, i) => (i + 1) + ". " + t.ko + (t.what ? " — " + t.what : "") + (t.why ? " (왜 뜨나: " + t.why + ")" : "") + (t.word && t.word.z ? " [유행어 " + t.word.z + " " + (t.word.k || "") + "]" : "")).join("\n") + "\n가장 한국 시청자가 멈출 만한 것 하나를 골라라." },
  ], { temperature: 0.8 });
  let say = String(o.say || "").trim();
  if (say.length < 15) throw aerr("대본이 너무 짧아요.");
  // 길면 잘라내지 말고 완결된 문장으로 다시 줄임(2026-10-16 첫 편 '원인 알고 보니 조명'에서 끊김)
  if (say.length > maxSay + 4) {
    try { const s2 = await shortsQwen(env, [{ role: "user", content: "다음 대사를 " + maxSay + "자 이내로 줄여라. 규칙: 문장은 반드시 끝까지 완결(마지막 글자는 마침표·물음표·느낌표·'요'·'죠'·'다'), 첫 문장 훅과 마지막 댓글 유도는 살리고 가운데 설명을 줄인다. 같은 말투. JSON {\"say\":\"\"}\n대사: " + say }], { temperature: 0.3 }); const t = String(s2.say || "").trim(); if (t.length >= 15 && t.length <= maxSay + 6) say = t; } catch {}
    if (say.length > maxSay + 6) { const cut = say.slice(0, maxSay + 6), m = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("?"), cut.lastIndexOf("!"), cut.lastIndexOf("요 "), cut.lastIndexOf("죠 ")); say = m > 15 ? cut.slice(0, m + 1).trim() : cut; }
  }
  if (!/[.?!…요죠다]["”']?$/.test(say)) say += ".";
  const topic = manualTopic || (topics[(Number(o.pick) || 1) - 1] || topics[0]).ko;
  return { topic: String(o.topic || topic).slice(0, 80), title: String(o.title || topic).slice(0, 40), say, scene: String(o.scene || "").slice(0, 500), description: String(o.description || "").slice(0, 600), tags: (Array.isArray(o.tags) ? o.tags : []).map((x) => String(x).slice(0, 20)).slice(0, 12) };
}

// ② 시작: 기획 → 장면 공장에 맡김
async function start(env, h, synth, manualTopic) {
  const c = await cfg(env, h), day = cnDay();
  if (!c.refs.length) throw aerr("캐릭터 그림을 먼저 넣어 주세요(설정).");
  const p = await plan(env, h, c, manualTopic);
  const doc = { st: "planning", ...p, at: Date.now(), day };
  await saveDay(env, h, day, doc);
  let r;
  try { r = await w3Make(env, { refKeys: c.refs, roles: c.roles, scene: p.scene, say: p.say, voice: c.voice, sec: c.sec, res: c.res, ratio: "9:16" }, h, synth); }
  catch (e) { doc.st = "failed"; doc.err = String(e.message || e).slice(0, 200); await saveDay(env, h, day, doc); logAdd(c, "실패(맡기기): " + doc.err); await saveCfg(env, h, c); throw e; }
  doc.st = "rendering"; doc.task = r.task; doc.zh = r.zh; await saveDay(env, h, day, doc);
  c.seen.push(p.topic); c.seen = c.seen.slice(-60); logAdd(c, "맡김: " + p.title); await saveCfg(env, h, c);
  return doc;
}

// ③ 진행 확인: 렌더링 끝나면 초안(kind auto) + final.mp4 + Bark
async function tick(env, h, day = cnDay()) {
  const doc = await today(env, h, day);
  if (!doc || doc.st !== "rendering") return doc;
  const r = await w3Poll(env, { task: doc.task }, h);
  if (r.status === "done") {
    const c = await cfg(env, h);
    const id = "auto-" + day.replace(/-/g, "") + "-" + Date.now().toString(36).slice(-3);
    // 장면 공장 결과 → 초안 final.mp4 (유튜브 업로드 경로가 보는 위치)
    const w3 = (await env.KV.get("shorts:w3:" + h, "json")) || { list: [] };
    const made = w3.list.find((x) => x.zh === doc.zh) || w3.list[0];
    if (!made) { doc.st = "failed"; doc.err = "결과 영상을 못 찾음"; await saveDay(env, h, day, doc); return doc; }
    const o = await env.R2.get(made.k);
    await env.R2.put("shorts/" + h + "/" + id + "/final.mp4", o.body, { httpMetadata: { contentType: "video/mp4" } });
    const draft = { id, kind: "auto", title: doc.title, description: doc.description, tags: doc.tags, say: doc.say, scene: doc.scene, series: c.series, at: Date.now(), src: made.k };
    await env.KV.put(draftKey(h, id), JSON.stringify(draft), { expirationTtl: 120 * 86400 });
    const l = (await env.KV.get(listKey(h), "json")) || [];
    l.unshift({ id, title: doc.title, kind: "auto", at: Date.now(), sec: c.sec }); await env.KV.put(listKey(h), JSON.stringify(l.slice(0, 40)));
    doc.st = "ready"; doc.id = id; doc.k = made.k; doc.readyAt = Date.now(); await saveDay(env, h, day, doc);
    logAdd(c, "준비됨: " + doc.title); await saveCfg(env, h, c);
    await bark(env, h, "🤖 오늘 영상 준비됐어요", doc.title + " — 보고 승인하면 저녁에 올라가요", "https://voice.zhnote.net/auto");
    logUse(env, "shorts", { auto: 1 }, 0, h).catch(() => {});
  } else if (r.status === "failed") {
    doc.st = "failed"; doc.err = r.detail || "실패"; await saveDay(env, h, day, doc);
    const c = await cfg(env, h); logAdd(c, "실패(영상): " + doc.err); await saveCfg(env, h, c);
    await bark(env, h, "🤖 오늘 영상 실패", doc.err, "https://voice.zhnote.net/auto");
  }
  return doc;
}

export async function autoCron(env, uh, synth) {
  const h = await env.KV.get("usage:owner"); if (!h) return;
  const c = await cfg(env, h); if (!c.on || !c.refs.length) return;
  const day = cnDay(), ch = (uh + 8) % 24, doc = await today(env, h, day);
  if (!doc) { if (ch === c.hour) { try { await start(env, h, synth); } catch (e) { console.log("autoCron start", e && e.message); } } return; }
  if (doc.st === "rendering") await tick(env, h, day);
}

export async function autoApi(env, ctx, path, b, h, synth) {
  const owner = await env.KV.get("usage:owner");
  if (owner && owner !== h) throw aerr("not_owner", 403);
  if (!owner) await env.KV.put("usage:owner", h);
  const c = await cfg(env, h), day = cnDay();
  const view = async () => {
    const doc = await today(env, h, day), days = [];
    for (let i = 1; i <= 7; i++) { const d = cnDay(Date.now() - i * 86400e3), x = await today(env, h, d); if (x) days.push({ day: d, st: x.st, title: x.title, id: x.id, err: x.err, note: x.note }); }
    const refs = await Promise.all(c.refs.map(async (k, i) => ({ k, url: await fileUrl(env, k), role: c.roles[i] || "" })));
    return { ok: true, day, cfg: { on: !!c.on, hour: c.hour, sec: c.sec, res: c.res, voice: c.voice, series: c.series, notes: c.notes, bark: !!(await env.KV.get("brief:" + h, "json"))?.bark }, series: SERIES, refs, today: doc ? { ...doc, url: doc.k ? await fileUrl(env, doc.k) : "" } : null, days, log: c.log.slice(0, 12), voiceMine: !!(await env.KV.get("voice:kr:" + h)) };
  };
  if (path === "/auto/state") return view();
  if (path === "/auto/tick") { await tick(env, h, day); return view(); }
  if (path === "/auto/cfg") {
    if (typeof b.on === "boolean") c.on = b.on;
    if (b.hour >= 5 && b.hour <= 22) c.hour = Math.round(b.hour);
    if ([10, 15, 20].includes(Number(b.sec))) c.sec = Number(b.sec);
    if (["480P", "720P"].includes(b.res)) c.res = b.res;
    if (["mine", "Ethan", "Cherry"].includes(b.voice)) c.voice = b.voice;
    if (SERIES[b.series]) c.series = b.series;
    if (Array.isArray(b.roles)) c.roles = b.roles.map((x) => String(x || "").slice(0, 40));
    if (b.delRef) { const i = c.refs.indexOf(String(b.delRef)); if (i >= 0) { await env.R2.delete(c.refs[i]).catch(() => {}); c.refs.splice(i, 1); c.roles.splice(i, 1); } }
    for (const u of (Array.isArray(b.images) ? b.images : []).slice(0, 4)) {
      const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(String(u || "")); if (!m || c.refs.length >= 4) continue;
      const bytes = Uint8Array.from(atob(m[2]), (ch) => ch.charCodeAt(0)), k = "shorts/" + h + "/auto/ref" + Date.now().toString(36) + "." + (m[1] === "png" ? "png" : m[1] === "webp" ? "webp" : "jpg");
      await env.R2.put(k, bytes, { httpMetadata: { contentType: "image/" + m[1] } }); c.refs.push(k); c.roles.push(c.refs.length === 1 ? "주인공 캐릭터(2D 치비 일러스트 — 화풍·성인 남성·선글라스 그대로, 실사 금지)" : "장소·배경");
    }
    if (b.clearNotes) c.notes = [];
    await saveCfg(env, h, c); return view();
  }
  if (path === "/auto/run") {
    const doc = await today(env, h, day);
    if (doc && (doc.st === "planning" || doc.st === "rendering")) throw aerr("오늘 영상을 이미 만드는 중이에요.");
    if (doc && doc.st === "ready") throw aerr("오늘 영상이 이미 준비돼 있어요. 반려하면 다시 만들 수 있어요.");
    await start(env, h, synth, String(b.topic || "").trim().slice(0, 200) || undefined); return view();
  }
  if (path === "/auto/retry") { const d = String(b.day || day), doc = await today(env, h, d); if (!doc) throw aerr("없는 날이에요."); await unqueue(env, h, doc.id); await env.KV.delete(dayKey(h, d)); if (d === day) await start(env, h, synth, b.topic ? String(b.topic).slice(0, 200) : doc.topic); return view(); }
  if (path === "/auto/approve") {
    const d = String(b.day || day), doc = await today(env, h, d);
    if (!doc || doc.st !== "ready" || !doc.id) throw aerr("승인할 영상이 없어요.");
    const r = await ytQueueAdd(env, { id: doc.id, privacy: ["public", "unlisted", "private"].includes(b.privacy) ? b.privacy : "public", title: doc.title, description: doc.description, tags: doc.tags, synthetic: true }, h);
    doc.st = "approved"; doc.approvedAt = Date.now(); await saveDay(env, h, d, doc);
    logAdd(c, "승인: " + doc.title); await saveCfg(env, h, c);
    return { ...(await view()), msg: r.msg };
  }
  if (path === "/auto/reject") {
    const d = String(b.day || day), doc = await today(env, h, d); if (!doc) throw aerr("없는 날이에요.");
    const note = String(b.note || "").trim().slice(0, 120);
    await unqueue(env, h, doc.id); // 승인 뒤 반려하면 예약 발행도 빼 줌
    doc.st = "rejected"; doc.note = note; await saveDay(env, h, d, doc);
    if (note) { c.notes.push(note); c.notes = c.notes.slice(-8); } logAdd(c, "반려: " + doc.title + (note ? " — " + note : "")); await saveCfg(env, h, c);
    return view();
  }
  throw aerr("unknown", 404);
}

export const AUTO_HTML = String.raw`<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#1664B0">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="자동 채널">
<link rel="apple-touch-icon" href="/shorts-180.png"><link rel="icon" href="/shorts-192.png">
<title>자동 채널</title>
<style>
:root{--sky:#1664B0;--bg:#EFE8DE;--card:#F7F2EA;--ink:#1A2330;--ink2:#5E6672;--line:#D9CEBD;--red:#D21624;--soft:#E6DCCB;--ok:#1F7A4D}
@media (prefers-color-scheme:dark){:root{--bg:#141A22;--card:#1C2430;--ink:#EDE6DA;--ink2:#9AA3AE;--line:#2C3644;--soft:#253041;--ok:#5CC08C}}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,"Apple SD Gothic Neo","PingFang SC",system-ui,sans-serif}
header{background:var(--sky);color:#fff;padding:calc(env(safe-area-inset-top) + 14px) 16px 14px;border-bottom:3px solid var(--red);display:flex;align-items:center;gap:12px}
header h1{margin:0;font-size:19px;flex:1}a.back{color:#fff;text-decoration:none;font-size:20px}
.sw{width:52px;height:30px;border-radius:999px;background:rgba(255,255,255,.3);position:relative;border:0;padding:0}.sw.on{background:#2ECC71}.sw i{position:absolute;top:3px;left:3px;width:24px;height:24px;border-radius:50%;background:#fff;transition:.2s}.sw.on i{left:25px}
main{max-width:640px;margin:0 auto;padding:14px 16px 60px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:12px}.card h2{margin:0 0 8px;font-size:15.5px}
.lbl{font-size:12.5px;color:var(--ink2);margin:10px 0 4px}.note{font-size:12.5px;color:var(--ink2);margin:6px 0 0}.err{color:var(--red);font-size:13.5px;margin-top:8px;white-space:pre-wrap}
.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{border:1px solid var(--line);background:transparent;color:var(--ink);border-radius:999px;padding:5px 11px;font:inherit;font-size:13px}.chip.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.big{display:block;width:100%;border:0;border-radius:12px;background:var(--sky);color:#fff;font:inherit;font-weight:700;font-size:16px;padding:14px;margin-top:10px;text-align:center}.big:disabled{opacity:.5}.big.red{background:var(--red)}.big.ok{background:var(--ok)}.big.ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}
.row{display:flex;gap:8px}.row .big{flex:1}
input[type=text],textarea{width:100%;font:inherit;font-size:16px;padding:9px 10px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink)}
.refs{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.ref{position:relative;aspect-ratio:3/4;border:2px dashed var(--line);border-radius:10px;overflow:hidden;background:var(--soft);display:flex;align-items:center;justify-content:center;color:var(--ink2);font-size:12px}
.ref img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.ref input[type=file]{position:absolute;inset:0;opacity:0;width:100%;height:100%}.ref .x{position:absolute;top:2px;right:2px;background:rgba(0,0,0,.6);color:#fff;border:0;border-radius:50%;width:22px;height:22px;font-size:12px;z-index:2}
.ref .tag{position:absolute;left:0;right:0;bottom:0;background:rgba(0,0,0,.55);color:#fff;font-size:10.5px;padding:2px 4px;border:0;text-align:center}
video{width:70%;max-width:300px;display:block;margin:10px auto;border-radius:10px;background:#000}
.st{display:inline-block;font-size:12px;font-weight:800;border-radius:999px;padding:2px 9px;background:var(--soft)}.st.ready{background:#DDF3E4;color:var(--ok)}.st.rendering,.st.planning{background:#FFF1C2;color:#8A5B00}.st.failed,.st.rejected{background:#F9D9DB;color:var(--red)}.st.approved{background:#DCE8F7;color:var(--sky)}
.say{background:var(--soft);border-radius:10px;padding:10px;font-size:15px;margin-top:8px}.hist .it{display:flex;gap:8px;align-items:center;padding:7px 0;border-top:1px solid var(--line);font-size:13.5px}.hist .it:first-child{border-top:0}.hist small{color:var(--ink2)}
.log{font-size:12px;color:var(--ink2);line-height:1.6}
.toast{position:fixed;left:50%;bottom:30px;transform:translateX(-50%);background:var(--ink);color:var(--bg);padding:10px 16px;border-radius:999px;font-size:14px;z-index:9;max-width:90vw;text-align:center}
.spin{display:inline-block;animation:sp 1.2s linear infinite}@keyframes sp{to{transform:rotate(360deg)}}.gate{padding:40px 0;text-align:center}
</style></head><body>
<header><a class="back" href="/shorts" aria-label="숏츠 공방">‹</a><h1>🤖 자동 채널</h1><button class="sw" id="sw" aria-label="켜기"><i></i></button></header>
<main id="main"></main>
<script>
var CODE='';try{CODE=localStorage.getItem('pb-code')||'';}catch(e){}
var ST=null,T=null;
function $(i){return document.getElementById(i);}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function toast(t){var d=document.createElement('div');d.className='toast';d.textContent=t;document.body.appendChild(d);setTimeout(function(){d.remove();},3000);}
function api(p,b){return fetch(p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.assign({code:CODE},b||{}))}).then(function(r){return r.json().catch(function(){return {ok:false,error:'서버 응답 오류 '+r.status};});}).catch(function(){return {ok:false,error:'네트워크 오류'};});}
function chips(arr,cur,attr){return '<div class="chips">'+arr.map(function(a){return '<button class="chip'+(String(a[0])===String(cur)?' on':'')+'" data-'+attr+'="'+a[0]+'">'+a[1]+'</button>';}).join('')+'</div>';}
function bind(attr,fn){document.querySelectorAll('[data-'+attr+']').forEach(function(b){b.onclick=function(){fn(b.getAttribute('data-'+attr));};});}
function shrink(file){return new Promise(function(ok,no){var u=URL.createObjectURL(file),im=new Image();im.onload=function(){var w=im.naturalWidth,h=im.naturalHeight,k=Math.min(1,1280/Math.max(w,h));var c=document.createElement('canvas');c.width=Math.round(w*k);c.height=Math.round(h*k);var x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);x.drawImage(im,0,0,c.width,c.height);URL.revokeObjectURL(u);ok(c.toDataURL('image/jpeg',0.9));};im.onerror=function(){no(new Error('그림을 열지 못했어요'));};im.src=u;});}
function set(r){if(!r.ok){toast(r.detail||r.error);return false;}ST=r;draw();return true;}
function cfg(b){return api('/auto/cfg',b).then(set);}
var STN={planning:'기획 중',rendering:'영상 만드는 중',ready:'승인 대기',approved:'승인됨 → 예약 발행',rejected:'반려',failed:'실패'};
function start(){
  if(!CODE){$('main').innerHTML='<div class="gate">숏츠 공방에서 초대 코드를 먼저 넣어 주세요.<br><a class="big" href="/shorts">숏츠 공방으로</a></div>';return;}
  api('/auto/state').then(function(r){if(r.error==='not_owner'){$('main').innerHTML='<div class="gate">주인만 쓸 수 있는 화면이에요.</div>';return;}if(!set(r))$('main').innerHTML='<div class="gate">'+esc(r.detail||r.error)+'</div>';});
  $('sw').onclick=function(){if(!ST)return;if(!ST.cfg.on&&!ST.refs.length)return toast('캐릭터 그림을 먼저 넣어 주세요');cfg({on:!ST.cfg.on});};
}
function draw(){
  var c=ST.cfg,t=ST.today;$('sw').classList.toggle('on',c.on);
  var h='';
  // 오늘
  h+='<div class="card"><h2>오늘 '+esc(ST.day)+'</h2>';
  if(!t)h+='<p class="note">'+(c.on?'아침 '+c.hour+'시(중국)에 자동으로 시작해요.':'자동 채널이 꺼져 있어요. 오른쪽 위 스위치로 켜거나 아래 버튼으로 지금 한 번 만들어 보세요.')+'</p><input type="text" id="tp" placeholder="주제 직접 지정 (비우면 오늘의 중국 인터넷에서 고름)"><button class="big red" id="run">▶ 지금 바로 만들기</button>';
  else{h+='<span class="st '+esc(t.st)+'">'+esc(STN[t.st]||t.st)+'</span> <b style="font-size:16px">'+esc(t.title||'')+'</b><p class="note">화제: '+esc(t.topic||'')+'</p>';
    if(t.say)h+='<div class="say">🗣 '+esc(t.say)+'</div>';
    if(t.st==='rendering'||t.st==='planning')h+='<p class="note"><span class="spin">⏳</span> 만드는 중… 1~5분. 끝나면 Bark 알림이 와요'+(c.bark?'':' (Bark 주소 없음 — 출장 브리핑 화면에서 넣기)')+'</p>';
    if(t.url)h+='<video src="'+esc(t.url)+'" controls playsinline preload="metadata"></video>';
    if(t.err)h+='<div class="err">'+esc(t.err)+'</div>';
    if(t.st==='ready')h+='<div class="row"><button class="big ok" id="ap">✅ 승인 → 저녁에 공개</button><button class="big ghost" id="apu">비공개로</button></div><input type="text" id="rn" placeholder="반려 이유 (다음 대본에 반영돼요)" style="margin-top:8px"><button class="big ghost" id="rj">❌ 반려</button>';
    if(t.st==='approved')h+='<p class="note">예약 발행 대기열에 들어갔어요(저녁 6~9시). 마음이 바뀌면 아래 반려 — 예약도 같이 빠져요.</p><input type="text" id="rn" placeholder="반려 이유 (다음 대본에 반영돼요)" style="margin-top:8px"><button class="big ghost" id="rj">❌ 반려 (예약 취소)</button>';
    if(t.st==='failed'||t.st==='rejected')h+='<input type="text" id="tp" placeholder="주제 (비우면 같은 화제로)" style="margin-top:8px"><button class="big" id="rt">↻ 다시 만들기</button>';
    if(t.zh)h+='<details style="margin-top:8px"><summary style="font-size:12px;color:var(--ink2)">AI 연출 보기</summary><span style="font-size:11px;white-space:pre-wrap">'+esc(t.zh)+'</span></details>';}
  h+='</div>';
  // 설정
  h+='<div class="card"><h2>캐릭터 · 설정</h2><div class="refs" id="refs"></div><p class="note">1번 = 진행자 캐릭터(공감툰 치비). 2~4번은 광저우 배경 사진(선택). 그림 밑 이름표는 AI가 역할로 씀.</p>'
    +'<p class="lbl">아침 시작 시각(중국)</p>'+chips([[6,'6시'],[7,'7시'],[8,'8시'],[9,'9시'],[12,'12시']],c.hour,'hour')
    +'<p class="lbl">길이 · 화질</p>'+chips([[10,'10초'],[15,'15초'],[20,'20초']],c.sec,'sec')+'<div style="height:6px"></div>'+chips([['480P','480P ('+(c.sec*0.3).toFixed(1)+'위안/일)'],['720P','720P ('+(c.sec*0.6).toFixed(1)+'위안/일)']],c.res,'res')
    +'<p class="lbl">목소리</p>'+chips([['mine','🎙 내 목소리'+(ST.voiceMine?'':' (미등록)')],['Ethan','Ethan'],['Cherry','Cherry']],c.voice,'voice')
    +'<p class="lbl">시리즈</p>'+chips(Object.keys(ST.series).map(function(k){return [k,ST.series[k]];}),c.series,'series')
    +(c.notes.length?'<p class="lbl">반려 메모(다음 대본에 반영 중)</p><div class="say" style="font-size:13px">'+c.notes.map(esc).join('<br>')+'</div><button class="chip" id="cn" style="margin-top:6px">메모 비우기</button>':'')
    +'<p class="note" style="margin-top:10px">흐름: 아침 → 오늘의 중국 인터넷에서 화제 1개 → 千问 대본(15초 안에 말하는 한 토막) → 장면 공장(万相 3.0, 캐릭터가 내 목소리로 말함) → Bark 알림 → 여기서 승인하면 저녁 6~9시 예약 발행. 반려 이유는 다음 날 대본에 반영.</p></div>';
  // 이력
  h+='<div class="card hist"><h2>지난 7일</h2>'+(ST.days.length?ST.days.map(function(d){return '<div class="it"><small>'+esc(d.day.slice(5))+'</small><span class="st '+esc(d.st)+'">'+esc(STN[d.st]||d.st)+'</span><span style="flex:1">'+esc(d.title||d.err||'')+'</span></div>';}).join(''):'<p class="note">아직 없어요.</p>')+'</div>';
  h+='<div class="card"><h2>기록</h2><div class="log">'+(ST.log||[]).map(function(x){return new Date(x.at).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit'})+' · '+esc(x.t);}).join('<br>')+'</div></div>';
  $('main').innerHTML=h;refs();
  bind('hour',function(v){cfg({hour:+v});});bind('sec',function(v){cfg({sec:+v});});bind('res',function(v){cfg({res:v});});bind('voice',function(v){cfg({voice:v});});bind('series',function(v){cfg({series:v});});
  if($('cn'))$('cn').onclick=function(){cfg({clearNotes:true});};
  if($('run'))$('run').onclick=function(){var b=this;b.disabled=true;b.innerHTML='<span class="spin">🎬</span> 기획하고 맡기는 중… (30~60초)';api('/auto/run',{topic:$('tp').value}).then(function(r){if(!set(r)){b.disabled=false;b.textContent='▶ 지금 바로 만들기';}});};
  if($('rt'))$('rt').onclick=function(){var b=this;b.disabled=true;b.innerHTML='<span class="spin">🎬</span> 다시 맡기는 중…';api('/auto/retry',{day:ST.day,topic:$('tp').value}).then(function(r){if(!set(r)){b.disabled=false;b.textContent='↻ 다시 만들기';}});};
  if($('ap'))$('ap').onclick=function(){api('/auto/approve',{day:ST.day,privacy:'public'}).then(function(r){if(set(r)&&r.msg)toast(r.msg);});};
  if($('apu'))$('apu').onclick=function(){api('/auto/approve',{day:ST.day,privacy:'private'}).then(function(r){if(set(r)&&r.msg)toast(r.msg);});};
  if($('rj'))$('rj').onclick=function(){api('/auto/reject',{day:ST.day,note:$('rn').value}).then(set);};
  clearTimeout(T);if(t&&(t.st==='rendering'||t.st==='planning'))T=setTimeout(function(){api('/auto/tick').then(set);},12000);
}
function refs(){var box=$('refs');if(!box)return;var r=ST.refs;box.innerHTML=[0,1,2,3].map(function(i){var x=r[i];return '<div class="ref">'+(x?'<img src="'+esc(x.url)+'"><button class="x" data-x="'+esc(x.k)+'">✕</button><input class="tag" type="text" data-r="'+i+'" value="'+esc(x.role)+'">':(i===r.length?'<span>+ '+(i===0?'캐릭터':'배경 '+i)+'</span><input type="file" accept="image/*" id="rf">':'<span style="opacity:.4">'+(i+1)+'</span>'))+'</div>';}).join('');
  var f=$('rf');if(f)f.onchange=function(){var fl=f.files&&f.files[0];if(!fl)return;shrink(fl).then(function(d){cfg({images:[d]});}).catch(function(e){toast(e.message);});};
  box.querySelectorAll('[data-x]').forEach(function(b){b.onclick=function(){if(confirm('이 그림을 뺄까요?'))cfg({delRef:b.getAttribute('data-x')});};});
  box.querySelectorAll('[data-r]').forEach(function(t){t.onchange=function(){var roles=ST.refs.map(function(x){return x.role;});roles[+t.getAttribute('data-r')]=t.value;cfg({roles:roles});};});}
start();
</script></body></html>`;
