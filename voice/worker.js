// =========================================================
// sz-voice — 실전 중국어 음성 서버 (Cloudflare Worker)
//  GET  /rt?code=…            WebSocket 중계 → 百炼 Qwen-Omni 실시간(음성↔음성). 브라우저는 키 헤더를 못 붙이므로 여기서 붙인다.
//                              메시지는 해석하지 않고 그대로 넘긴다(CPU 최소). 코드당 하루 RT_DAY_MIN 분, 한 통화 최대 10분.
//  POST /voice/enroll         {code, audio(base64), mime} → 내 목소리 등록(CosyVoice 음성 복제). 녹음은 百炼 임시 저장소(oss://)로 올려 넘김
//  POST /voice/status         {code} → {voice, status}
//  POST /voice/tts            {code, text} → audio/mpeg (내 목소리로 읽기, R2 캐시)
//  GET  /ping                 상태 확인
// 시크릿: DASHSCOPE_API_KEY, DASHSCOPE_WS_HOST, ALLOWED_CODES
// [필수] Anthropic 호출 없음 — 百炼(알리바바)만 사용
// =========================================================

const ORIGINS = ["https://elanddenim-bit.github.io"];
const RT_MAX_SEC = 600;

const cors = (req) => {
  const o = req.headers.get("origin") || "";
  return {
    "access-control-allow-origin": ORIGINS.includes(o) || /^http:\/\/localhost(:\d+)?$/.test(o) ? o : ORIGINS[0],
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "origin",
  };
};
const json = (req, o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors(req), "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

const host = (env) => (env.DASHSCOPE_WS_HOST || "dashscope.aliyuncs.com").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
const allowed = (env, code) => {
  const c = String(code || "").trim();
  return !!c && String(env.ALLOWED_CODES || "").split(",").map((s) => s.trim()).filter(Boolean).includes(c);
};
async function hash(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].slice(0, 6).map((x) => x.toString(16).padStart(2, "0")).join("");
}
const cnDay = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
    try {
      if (url.pathname === "/ping") return json(req, { ok: true, host: host(env).replace(/^ws-[a-z0-9]{4}/, "ws-…"), key: !!env.DASHSCOPE_API_KEY });
      if (url.pathname === "/rt") return await realtime(req, env, ctx, url);
      if (req.method !== "POST") return json(req, { error: "not_found" }, 404);
      let b;
      try { b = await req.json(); } catch { return json(req, { error: "bad_json" }, 400); }
      if (!allowed(env, b.code)) return json(req, { error: "not_allowed" }, 403);
      if (!env.DASHSCOPE_API_KEY) return json(req, { error: "config", detail: "DASHSCOPE_API_KEY 시크릿 없음" }, 500);
      const h = await hash(String(b.code).trim());
      if (url.pathname === "/voice/enroll") return json(req, await enroll(env, h, b));
      if (url.pathname === "/voice/status") return json(req, await vstatus(env, h));
      if (url.pathname === "/voice/tts") return await tts(req, env, h, b);
      return json(req, { error: "not_found" }, 404);
    } catch (e) {
      return json(req, { error: e.code || "server", detail: String(e.message || e).slice(0, 300) }, e.status || 500);
    }
  },
};
const err = (code, message, status = 502) => Object.assign(new Error(message), { code, status });

// ---------------- 실시간 통화 중계 ----------------
async function realtime(req, env, ctx, url) {
  if (req.headers.get("upgrade") !== "websocket") return new Response("websocket only", { status: 426 });
  const pair = new WebSocketPair();
  const client = pair[0], server = pair[1];
  server.accept();
  const fail = (code, message) => {
    try { server.send(JSON.stringify({ type: "error", error: { code, message } })); } catch {}
    try { server.close(1008, code); } catch {}
    return new Response(null, { status: 101, webSocket: client });
  };
  const code = url.searchParams.get("code") || "";
  if (!allowed(env, code)) return fail("not_allowed", "이 초대 코드는 실시간 통화를 쓸 수 없습니다.");
  if (!env.DASHSCOPE_API_KEY) return fail("config", "서버에 DASHSCOPE_API_KEY 가 없습니다.");
  const dayKey = "rt:" + cnDay() + ":" + (await hash(code));
  const used = Number(await env.KV.get(dayKey)) || 0;
  const cap = (Number(env.RT_DAY_MIN) || 30) * 60;
  if (used >= cap) return fail("daily_cap", "오늘 실시간 통화 한도(" + Math.round(cap / 60) + "분)를 다 썼습니다.");

  const model = env.RT_MODEL || "qwen3.8-omni-flash-realtime";
  let up;
  try {
    up = await fetch("https://" + host(env) + "/api-ws/v1/realtime?model=" + encodeURIComponent(model), {
      headers: { Upgrade: "websocket", Authorization: "Bearer " + env.DASHSCOPE_API_KEY },
    });
  } catch (e) { return fail("upstream", "百炼 연결 실패: " + String(e.message || e).slice(0, 120)); }
  const ws = up.webSocket;
  if (!ws) return fail("upstream", "百炼 연결 거부 " + up.status + ": " + (await up.text().catch(() => "")).slice(0, 160));
  ws.accept();

  const t0 = Date.now();
  let closed = false, done;
  const finished = new Promise((r) => (done = r));
  const limit = Math.min(RT_MAX_SEC, cap - used);
  const end = (why) => {
    if (closed) return;
    closed = true;
    try { server.send(JSON.stringify({ type: "relay.closed", reason: why })); } catch {}
    try { ws.close(1000, "end"); } catch {}
    try { server.close(1000, "end"); } catch {}
    const sec = Math.ceil((Date.now() - t0) / 1000);
    done(env.KV.put(dayKey, String(used + sec), { expirationTtl: 3 * 86400 }).catch(() => {}));
  };
  const timer = setTimeout(() => end("time_limit"), limit * 1000);
  server.addEventListener("message", (e) => { try { ws.send(e.data); } catch { end("upstream_send"); } });
  ws.addEventListener("message", (e) => { try { server.send(e.data); } catch { end("client_send"); } });
  server.addEventListener("close", () => { clearTimeout(timer); end("client_close"); });
  ws.addEventListener("close", (e) => { clearTimeout(timer); end("upstream_close " + (e.code || "") + " " + (e.reason || "")); });
  server.addEventListener("error", () => end("client_error"));
  ws.addEventListener("error", () => end("upstream_error"));
  ctx.waitUntil(finished.then((p) => p));
  try { server.send(JSON.stringify({ type: "relay.ready", model, limit_sec: limit })); } catch {}
  return new Response(null, { status: 101, webSocket: client });
}

// ---------------- 내 목소리 (CosyVoice 음성 복제) ----------------
const ttsModel = (env) => env.TTS_MODEL || "cosyvoice-v3.5-plus";
async function ds(env, path, body, extra = {}) {
  const r = await fetch("https://" + host(env) + "/api/v1" + path, {
    method: body ? "POST" : "GET",
    headers: { authorization: "Bearer " + env.DASHSCOPE_API_KEY, "content-type": "application/json", ...extra },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let j = {};
  try { j = JSON.parse(t); } catch {}
  if (!r.ok) throw err("dashscope", "百炼 " + r.status + ": " + (j.message || j.code || t.slice(0, 160)));
  return j;
}
// 百炼 임시 저장소(48시간)에 올리고 oss:// 주소를 받는다 — 베이징 서버가 외부 주소를 못 가져오는 문제를 피함
async function tempUpload(env, model, bytes, name, mime) {
  const p = (await ds(env, "/uploads?action=getPolicy&model=" + encodeURIComponent(model))).data || {};
  if (!p.upload_host || !p.upload_dir) throw err("upload", "임시 저장소 정책을 받지 못했습니다.");
  const key = p.upload_dir + "/" + name;
  const f = new FormData();
  f.append("OSSAccessKeyId", p.oss_access_key_id);
  f.append("Signature", p.signature);
  f.append("policy", p.policy);
  f.append("x-oss-object-acl", p.x_oss_object_acl);
  f.append("x-oss-forbid-overwrite", p.x_oss_forbid_overwrite);
  f.append("key", key);
  f.append("success_action_status", "200");
  f.append("file", new Blob([bytes], { type: mime }), name);
  const r = await fetch(p.upload_host, { method: "POST", body: f });
  if (!r.ok) throw err("upload", "임시 저장소 업로드 실패 " + r.status + ": " + (await r.text()).slice(0, 160));
  return "oss://" + key;
}
function b64bytes(b64) {
  const bin = atob(String(b64 || "").replace(/^data:[^,]+,/, ""));
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
async function enroll(env, h, b) {
  const bytes = b64bytes(b.audio);
  if (bytes.length < 20000) throw err("too_short", "녹음이 너무 짧습니다(10초 이상).", 400);
  if (bytes.length > 9 * 1024 * 1024) throw err("too_big", "녹음 파일이 너무 큽니다.", 400);
  const mime = /mp4|m4a|aac/.test(b.mime || "") ? "audio/mp4" : /wav/.test(b.mime || "") ? "audio/wav" : /mpeg|mp3/.test(b.mime || "") ? "audio/mpeg" : "audio/mp4";
  const ext = mime === "audio/wav" ? "wav" : mime === "audio/mpeg" ? "mp3" : "m4a";
  const ossUrl = await tempUpload(env, "voice-enrollment", bytes, "myvoice-" + h + "-" + Date.now() + "." + ext, mime);
  // 이전 목소리는 지운다(계정당 개수 제한)
  const old = await env.KV.get("voice:" + h);
  if (old) { try { await ds(env, "/services/audio/tts/customization", { model: "voice-enrollment", input: { action: "delete_voice", voice_id: old } }); } catch {} }
  const j = await ds(env, "/services/audio/tts/customization",
    { model: "voice-enrollment", input: { action: "create_voice", target_model: ttsModel(env), prefix: "sz" + h.slice(0, 6), url: ossUrl } },
    { "X-DashScope-OssResourceResolve": "enable" });
  const voice = j.output && j.output.voice_id;
  if (!voice) throw err("enroll", "목소리 ID를 받지 못했습니다: " + JSON.stringify(j).slice(0, 160));
  await env.KV.put("voice:" + h, voice);
  return { ok: true, voice, model: ttsModel(env) };
}
async function vstatus(env, h) {
  const voice = await env.KV.get("voice:" + h);
  if (!voice) return { voice: null };
  try {
    const j = await ds(env, "/services/audio/tts/customization", { model: "voice-enrollment", input: { action: "query_voice", voice_id: voice } });
    return { voice, status: (j.output && j.output.status) || "UNKNOWN" };
  } catch (e) { return { voice, status: "UNKNOWN", detail: String(e.message).slice(0, 120) }; }
}

// CosyVoice 합성 — WebSocket run-task 프로토콜(서버 안에서만 연결, 결과 mp3 를 R2 에 캐시)
function fnv(s) {
  let h = 0x811c9dc5;
  for (const c of new TextEncoder().encode(s)) { h ^= c; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}
async function tts(req, env, h, b) {
  const text = String(b.text || "").trim().slice(0, 200);
  if (!text) return json(req, { error: "no_text" }, 400);
  const voice = await env.KV.get("voice:" + h);
  if (!voice) return json(req, { error: "no_voice", detail: "아직 내 목소리를 등록하지 않았습니다." }, 404);
  const key = "tts/" + voice + "/" + fnv(text) + ".mp3";
  const hit = await env.R2.get(key);
  const head = { ...cors(req), "content-type": "audio/mpeg", "cache-control": "private, max-age=31536000" };
  if (hit) return new Response(hit.body, { headers: head });
  const mp3 = await synth(env, voice, text);
  await env.R2.put(key, mp3, { httpMetadata: { contentType: "audio/mpeg" } });
  return new Response(mp3, { headers: head });
}
async function synth(env, voice, text) {
  const up = await fetch("https://" + host(env) + "/api-ws/v1/inference", {
    headers: { Upgrade: "websocket", Authorization: "Bearer " + env.DASHSCOPE_API_KEY },
  });
  const ws = up.webSocket;
  if (!ws) throw err("tts", "합성 서버 연결 거부 " + up.status);
  ws.accept();
  const task = crypto.randomUUID().replace(/-/g, "");
  const chunks = [];
  const msg = (action, payload) => JSON.stringify({ header: { action, task_id: task, streaming: "duplex" }, payload });
  return await new Promise((res, rej) => {
    const to = setTimeout(() => { try { ws.close(); } catch {} rej(err("tts", "합성 시간 초과")); }, 25000);
    ws.addEventListener("message", (ev) => {
      if (typeof ev.data !== "string") { chunks.push(new Uint8Array(ev.data)); return; }
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      const e = m.header && m.header.event;
      if (e === "task-started") {
        ws.send(msg("continue-task", { input: { text } }));
        ws.send(msg("finish-task", { input: {} }));
      } else if (e === "task-finished") {
        clearTimeout(to); try { ws.close(); } catch {}
        const n = chunks.reduce((a, c) => a + c.length, 0), out = new Uint8Array(n);
        let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
        n ? res(out) : rej(err("tts", "합성 결과가 비었습니다"));
      } else if (e === "task-failed") {
        clearTimeout(to); try { ws.close(); } catch {}
        rej(err("tts", "합성 실패: " + (m.header.error_message || m.header.error_code || "unknown")));
      }
    });
    ws.addEventListener("close", () => clearTimeout(to));
    ws.send(msg("run-task", {
      task_group: "audio", task: "tts", function: "SpeechSynthesizer", model: ttsModel(env),
      parameters: { text_type: "PlainText", voice, format: "mp3", sample_rate: 24000, volume: 50, rate: 0.95, pitch: 1 },
      input: {},
    }));
  });
}
