// supabase/functions/video/index.ts
// 영상 섀도잉 — Supabase Edge Function `video`
// 대시보드 배포: Edge Functions > Deploy a new function > Via Editor, 이름 `video`, "Verify JWT" 끔(다른 함수와 동일)
// 이 파일은 수정 없이 그대로 붙여넣는다(초대 코드·키 없음).
//
// 흐름: 앱이 영상 업로드 URL을 받아 R2에 직접 PUT → start(百炼 음성인식 비동기 작업) → poll(완료 시 千问으로 병음·번역·표현 정리)
//  POST /video/upload {code, type, size, name}  → {key, put}             R2 서명 PUT URL(1시간)
//  POST /video/start  {code, key}                → {task}                 百炼 파일 전사 작업 제출
//  POST /video/poll   {code, task, known?[], kind?:'work'|'life'}     → {status:'RUNNING'} | {status:'SUCCEEDED', dur, sents:[{t0,t1,z,p,k}], words:[{z,p,k,ex}]}
//  POST /video/url    {code, key}                → {url}                  재생용 서명 GET URL(6시간)
//  POST /video/ping   {code}                     → {ok, usage}
//
// 시크릿(필수): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY  + 기존 DASHSCOPE_API_KEY, QWEN_BASE, ALLOWED_CODES
// 시크릿(선택): VIDEO_ASR_MODEL(기본 fun-asr), DASHSCOPE_API_BASE(기본: QWEN_BASE 의 /compatible-mode/v1 → /api/v1),
//               QWEN_TEXT_MODEL(기본 qwen3.8-flash), VIDEO_CAP_MIN(월 전사 상한 분, 기본 120), VIDEO_DAY_MAX(코드당 하루 전사 수, 기본 15)
// 버킷: sz-chinese-video (APAC). 객체 키 = <초대코드 해시>/<시각>-<랜덤>.<확장자> — 초대 코드 원문은 URL에 넣지 않는다.
// 사용량: call 함수와 같은 call_usage 테이블. "vid:YYYY-MM" = 그 달 전사 초, "vday:YYYY-MM-DD:<hash>" = 그날 전사 수, "vtask:<id>" = 집계 완료 표시
// AI: 百炼(음성인식) + 千问(정리) — 중국·홍콩발 Anthropic 요청 금지 규칙에 따라 Anthropic 호출 없음

const BUCKET = "sz-chinese-video";
const MAX_BYTES = 200 * 1024 * 1024;      // 영상 1개 최대 200MB (앱은 5분 이하만 올림)
const MAX_SENTS = 90;                      // 정리할 문장 수 상한(5분 분량 여유)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
function env(k: string) { return Deno.env.get(k) ?? ""; }
function err(code: string, message: string, status: number) {
  const e: any = new Error(message); e.code = code; e.status = status; return e;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  const action = path.slice(path.lastIndexOf("/") + 1);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  if (!allowed(body?.code)) return json({ error: "not_allowed" }, 403);
  try {
    const h = await codeHash(String(body.code).trim());
    if (action === "ping") return json({ ok: true, usage: await usage() });
    if (action === "upload") return json(await upload(body, h));
    if (action === "start") return json(await start(body, h));
    if (action === "poll") return json(await poll(body));
    if (action === "url") {
      const key = ownKey(body.key, h);
      return json({ url: await presign("GET", key, 6 * 3600) });
    }
    return json({ error: "not_found" }, 404);
  } catch (e: any) {
    return json({ error: e?.code || "server", detail: String(e?.message || e).slice(0, 300) }, e?.status || 500);
  }
});

function allowed(code: unknown) {
  const c = String(code || "").trim();
  if (!c) return false;
  return env("ALLOWED_CODES").split(",").map((s) => s.trim()).filter(Boolean).includes(c);
}
async function codeHash(code: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return Array.from(new Uint8Array(d)).slice(0, 6).map((x) => x.toString(16).padStart(2, "0")).join("");
}
// 다른 초대 코드의 영상에는 접근하지 못하게 키 앞부분을 확인
function ownKey(key: unknown, h: string) {
  const k = String(key || "");
  if (!new RegExp("^" + h + "/[0-9]+-[a-z0-9]+\\.(mp4|mov|m4v|webm)$").test(k)) throw err("bad_key", "영상 키가 올바르지 않습니다.", 400);
  return k;
}

// ---------------- 업로드 URL ----------------
async function upload(b: any, h: string) {
  const size = Number(b.size) || 0;
  if (size > MAX_BYTES) throw err("too_big", "영상이 너무 큽니다(200MB 이하).", 413);
  const type = String(b.type || "").toLowerCase();
  const name = String(b.name || "").toLowerCase();
  const ext = /quicktime|\.mov$/.test(type + name) ? "mov" : /webm/.test(type + name) ? "webm" : /m4v/.test(name) ? "m4v" : "mp4";
  const key = `${h}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  return { key, put: await presign("PUT", key, 3600) };
}

// ---------------- 百炼 파일 전사 ----------------
function dsBase() {
  const o = env("DASHSCOPE_API_BASE");
  if (o) return o.replace(/\/$/, "");
  const q = env("QWEN_BASE").replace(/\/$/, "");
  if (!q) throw err("config", "QWEN_BASE / DASHSCOPE_API_BASE 미설정", 500);
  return q.replace(/\/compatible-mode\/v1$/, "/api/v1");
}
function dsHeaders(async = false): Record<string, string> {
  if (!env("DASHSCOPE_API_KEY")) throw err("config", "DASHSCOPE_API_KEY 미설정", 500);
  const h: Record<string, string> = { "content-type": "application/json", authorization: "Bearer " + env("DASHSCOPE_API_KEY") };
  if (async) h["X-DashScope-Async"] = "enable";
  return h;
}
async function start(b: any, h: string) {
  const key = ownKey(b.key, h);
  const u = await usage();
  if (u.tracked && u.sec >= u.cap) throw err("monthly", `이번 달 영상 전사 한도(${Math.round(u.cap / 60)}분)를 다 썼습니다.`, 429);
  const dayKey = `vday:${cnDate().slice(0, 10)}:${h}`;
  const n = await readCount(dayKey);
  const dayMax = parseInt(env("VIDEO_DAY_MAX")) || 15;
  if (n !== null && n >= dayMax) throw err("daily", `오늘 영상 전사 한도(${dayMax}개)를 다 썼습니다.`, 429);

  const fileUrl = await presign("GET", key, 3 * 3600);
  const model = env("VIDEO_ASR_MODEL") || "fun-asr";
  const r = await fetch(dsBase() + "/services/audio/asr/transcription", {
    method: "POST",
    headers: dsHeaders(true),
    body: JSON.stringify({ model, input: { file_urls: [fileUrl] }, parameters: { language_hints: ["zh"] } }),
  });
  const raw = await r.text();
  if (!r.ok) throw err("asr", "음성인식 작업 제출 실패 " + r.status + " " + raw.slice(0, 200), 502);
  const task = JSON.parse(raw)?.output?.task_id;
  if (!task) throw err("asr", "음성인식 작업 ID 없음 " + raw.slice(0, 200), 502);
  await addCount(dayKey, 1, n);
  return { task };
}

async function poll(b: any) {
  const task = String(b.task || "");
  if (!/^[0-9a-zA-Z-]{8,80}$/.test(task)) throw err("bad_task", "작업 ID가 올바르지 않습니다.", 400);
  const r = await fetch(dsBase() + "/tasks/" + task, { headers: dsHeaders() });
  const raw = await r.text();
  if (!r.ok) throw err("asr", "음성인식 상태 조회 실패 " + r.status + " " + raw.slice(0, 200), 502);
  const out = JSON.parse(raw)?.output || {};
  const st = String(out.task_status || "");
  if (st === "PENDING" || st === "RUNNING") return { status: "RUNNING" };
  // fun-asr: output.results[0].transcription_url / qwen3-asr-filetrans: output.result.transcription_url
  const res0 = Array.isArray(out.results) ? out.results[0] : out.result;
  if (st !== "SUCCEEDED" || !res0?.transcription_url || (res0.subtask_status && res0.subtask_status !== "SUCCEEDED")) {
    const why = res0?.message || out.message || st || "unknown";
    throw err("asr_failed", "음성인식 실패: " + String(why).slice(0, 160), 502);
  }
  const tr = await (await fetch(res0.transcription_url)).json();
  const durMs = Number(tr?.properties?.original_duration_in_milliseconds) || 0;
  const raws: any[] = [];
  for (const t of (tr?.transcripts || [])) for (const s of (t.sentences || [])) raws.push(s);
  raws.sort((a, b) => (a.begin_time || 0) - (b.begin_time || 0));
  const sents = raws
    .map((s) => ({ t0: Math.max(0, Number(s.begin_time) || 0) / 1000, t1: (Number(s.end_time) || 0) / 1000, z: String(s.text || "").trim() }))
    .filter((s) => s.z && s.t1 > s.t0)
    .slice(0, MAX_SENTS);

  // 이번 달 전사 초 집계 (같은 작업을 두 번 세지 않게 vtask 표시)
  const dur = durMs / 1000 || (sents.length ? sents[sents.length - 1].t1 : 0);
  const mark = "vtask:" + task;
  const seen = await readCount(mark);
  if (seen === 0) { await addCount(mark, 1, 0); await addCount("vid:" + cnDate().slice(0, 7), Math.ceil(dur)); }

  if (!sents.length) return { status: "SUCCEEDED", dur, sents: [], words: [], note: "말소리를 찾지 못했습니다(보통화 대사가 있는 영상인지 확인)." };
  const known = Array.isArray(b.known) ? b.known.slice(0, 150).map((x: unknown) => String(x).slice(0, 12)) : [];
  const kind = b.kind === "life" ? "life" : "work";
  const ann = await annotate(sents.map((s) => s.z), known, kind);
  return {
    status: "SUCCEEDED",
    dur,
    sents: sents.map((s, i) => ({ t0: +s.t0.toFixed(2), t1: +s.t1.toFixed(2), z: s.z, p: ann.lines[i]?.p || "", k: ann.lines[i]?.k || "" })),
    words: ann.words,
  };
}

// ---------------- 千问 정리 (병음·한국어·현장 표현) ----------------
const SYSTEM = "당신은 중국어 영상 자막을 학습용 JSON으로 정리하는 변환기입니다. 설명, 인사말, 코드펜스 없이 JSON 객체 하나만 출력합니다.";
// kind: work = 공장·원단 등 업무 영상 / life = 드라마·애니·생활 영상 (표현 고르는 기준과 예문 상황이 다름)
const WORDS_WORK = `2. words: 실무자가 외워 두면 공장·원단시장·위챗에서 바로 쓸 표현 8~12개.
   - 자막에 실제로 나온 단어·구(2~10자)를 우선. 你好·谢谢 같은 기초어, 사람·회사·브랜드 이름, 금액·날짜는 제외.
   - 이미 아는 표현(아래 목록)은 제외.
   - 각 항목 {"z","p","k","ex":{"z","p","k"}}. k는 20자 이내. 예문은 자막 문장을 옮기지 말고 광저우 현장 상황으로 새로 만듭니다(한자 8~18자).`;
const WORDS_LIFE = `2. words: 이 영상은 드라마·애니·생활 영상입니다. 중국에 사는 성인이 일상 대화(가족·식당·택시·이웃·친구·전화)에서 바로 쓸 구어 표현 8~12개를 고릅니다.
   - 자막에 실제로 나온 표현을 우선. 감정 반응·맞장구·되묻기·부탁·거절처럼 대화에서 자주 쓰는 말을 우선합니다(예: 凭什么, 别闹了, 你什么意思).
   - 고어·문언문 구절, 극 중 사람 이름, 판타지·궁중 전용 용어, 你好·谢谢 같은 기초어는 제외. 이미 아는 표현(아래 목록)도 제외.
   - 각 항목 {"z","p","k","ex":{"z","p","k"}}. k는 20자 이내. 예문은 자막 문장을 옮기지 말고 광저우 일상 생활 상황(식당·택시·택배·이웃·가족)으로 새로 만듭니다(한자 8~18자). 의류·공장 상황으로 억지로 만들지 않습니다.`;
function rules(n: number, known: string[], kind: string) {
  const intro = kind === "life"
    ? "아래는 광저우에 사는 한국인 실무자가 생활 중국어를 익히려고 고른 드라마·애니·생활 영상의 자동 자막(음성인식 결과)입니다."
    : "아래는 광저우 의류 소싱 실무자가 공부하려고 고른 중국어 영상의 자동 자막(음성인식 결과)입니다.";
  return `${intro} 번호마다 한 문장입니다.

할 일
1. lines: 모든 번호(0~${n - 1})에 대해 순서대로 {"i":번호,"p":병음,"k":한국어 뜻}을 만듭니다. 빠뜨리지 않습니다.
   - 병음은 성조 부호(숫자 표기 금지), 문장 첫 글자만 대문자.
   - 한국어 뜻은 자연스러운 존댓말 구어, 40자 이내. 음성인식 오타로 보이는 글자는 문맥상 맞는 뜻으로 옮깁니다(중문 원문은 고치지 않음).
${kind === "life" ? WORDS_LIFE : WORDS_WORK}

이미 아는 표현: ${known.length ? known.join(", ") : "(없음)"}

출력 형식 (이 JSON 객체 하나만):
{"lines":[{"i":0,"p":"Zhège miànliào shǒugǎn hěn hǎo.","k":"이 원단 촉감이 좋네요."}],"words":[{"z":"手感","p":"shǒugǎn","k":"촉감","ex":{"z":"这块布手感有点硬。","p":"Zhè kuài bù shǒugǎn yǒudiǎn yìng.","k":"이 원단은 촉감이 좀 뻣뻣해요."}}]}`;
}
async function annotate(lines: string[], known: string[], kind: string) {
  const base = env("QWEN_BASE").replace(/\/$/, "");
  if (!base) throw err("config", "QWEN_BASE 미설정", 500);
  const user = rules(lines.length, known, kind) + "\n\n자막:\n" + lines.map((z, i) => `${i}. ${z}`).join("\n");
  const r = await fetch(base + "/chat/completions", {
    method: "POST",
    headers: dsHeaders(),
    body: JSON.stringify({
      model: env("QWEN_TEXT_MODEL") || "qwen3.8-flash",
      max_tokens: 8000,
      enable_thinking: false,
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }],
    }),
  });
  const raw = await r.text();
  if (!r.ok) throw err("llm", "Qwen " + r.status + " " + raw.slice(0, 160), 502);
  const c = JSON.parse(raw).choices?.[0]?.message?.content ?? "";
  const d = parseJSON(Array.isArray(c) ? c.map((x: any) => x.text || "").join("\n") : String(c)) || {};
  const out: { p: string; k: string }[] = [];
  for (const l of (Array.isArray(d.lines) ? d.lines : [])) {
    const i = Number(l?.i);
    if (Number.isInteger(i) && i >= 0 && i < lines.length) out[i] = { p: clean(l.p, 200), k: clean(l.k, 80) };
  }
  const words = (Array.isArray(d.words) ? d.words : []).slice(0, 15)
    .filter((w: any) => w && w.z)
    .map((w: any) => ({
      z: clean(w.z, 20), p: clean(w.p, 60), k: clean(w.k, 40),
      ex: w.ex && w.ex.z ? { z: clean(w.ex.z, 40), p: clean(w.ex.p, 120), k: clean(w.ex.k, 60) } : null,
    }));
  return { lines: out, words };
}
function clean(s: unknown, max: number) { return String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max); }
function parseJSON(text: string): any {
  try {
    const t = String(text).replace(/```json|```/g, "").trim();
    return JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
  } catch { return null; }
}

// ---------------- R2 서명 URL (S3 SigV4 쿼리 서명, 외부 라이브러리 없음) ----------------
function rfc3986(s: string) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}
function hex(buf: ArrayBuffer) { return Array.from(new Uint8Array(buf)).map((x) => x.toString(16).padStart(2, "0")).join(""); }
async function sha256hex(s: string) { return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))); }
async function hmac(key: ArrayBuffer | Uint8Array, msg: string) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
}
// 범용 서명기 — 테스트 벡터 검증용으로 host·경로·리전·시각을 인자로 받는다
export async function sigv4Presign(o: {
  method: string; host: string; path: string; region: string; akid: string; secret: string; expires: number; now: Date;
}) {
  const amzDate = o.now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); // YYYYMMDDTHHMMSSZ
  const date = amzDate.slice(0, 8);
  const scope = `${date}/${o.region}/s3/aws4_request`;
  const q: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${o.akid}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(o.expires),
    "X-Amz-SignedHeaders": "host",
  };
  const query = Object.keys(q).sort().map((k) => rfc3986(k) + "=" + rfc3986(q[k])).join("&");
  const canon = [o.method, o.path, query, `host:${o.host}`, "", "host", "UNSIGNED-PAYLOAD"].join("\n");
  const sts = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256hex(canon)].join("\n");
  let k = await hmac(new TextEncoder().encode("AWS4" + o.secret), date);
  k = await hmac(k, o.region); k = await hmac(k, "s3"); k = await hmac(k, "aws4_request");
  const sig = hex(await hmac(k, sts));
  return `https://${o.host}${o.path}?${query}&X-Amz-Signature=${sig}`;
}
async function presign(method: "GET" | "PUT", key: string, expires: number) {
  const acct = env("R2_ACCOUNT_ID"), akid = env("R2_ACCESS_KEY_ID"), secret = env("R2_SECRET_ACCESS_KEY");
  if (!acct || !akid || !secret) throw err("config", "R2 시크릿(R2_ACCOUNT_ID·R2_ACCESS_KEY_ID·R2_SECRET_ACCESS_KEY) 미설정", 500);
  const path = "/" + BUCKET + "/" + key.split("/").map(rfc3986).join("/");
  return await sigv4Presign({ method, host: `${acct}.r2.cloudflarestorage.com`, path, region: "auto", akid, secret, expires, now: new Date() });
}

// ---------------- 사용량 (call 함수와 같은 call_usage 테이블) ----------------
function cnDate() { return new Date(Date.now() + 8 * 3600e3).toISOString(); } // 중국 시간
function sbKey(): { key: string; legacy: boolean } {
  try {
    const d = JSON.parse(env("SUPABASE_SECRET_KEYS") || "{}");
    const k = d.default || Object.values(d)[0];
    if (k) return { key: String(k), legacy: false };
  } catch { /* 무시 */ }
  return { key: env("SUPABASE_SERVICE_ROLE_KEY"), legacy: true };
}
function sbHeaders(): Record<string, string> {
  const { key, legacy } = sbKey();
  const h: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  if (legacy) h.Authorization = "Bearer " + key;
  return h;
}
async function readCount(key: string): Promise<number | null> {
  const base = env("SUPABASE_URL");
  if (!base || !sbKey().key) return null;
  try {
    const r = await fetch(`${base}/rest/v1/call_usage?month=eq.${encodeURIComponent(key)}&select=sec`, { headers: sbHeaders() });
    if (!r.ok) return null;
    const rows = await r.json();
    return rows.length ? Number(rows[0].sec) || 0 : 0;
  } catch { return null; }
}
async function addCount(key: string, add: number, cur?: number | null) {
  if (!add) return;
  if (cur === undefined) cur = await readCount(key);
  if (cur === null) return;
  try {
    await fetch(`${env("SUPABASE_URL")}/rest/v1/call_usage`, {
      method: "POST",
      headers: { ...sbHeaders(), Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify([{ month: key, sec: cur + add, updated_at: new Date().toISOString() }]),
    });
  } catch { /* 기록 실패는 막지 않는다 */ }
}
async function usage() {
  const cap = (parseInt(env("VIDEO_CAP_MIN")) || 120) * 60;
  const sec = await readCount("vid:" + cnDate().slice(0, 7));
  return { sec: Math.round(sec ?? 0), cap, tracked: sec !== null };
}
