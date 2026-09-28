// sz-chinese 통화 모드 서버 (Cloudflare Worker)
// ---------------------------------------------------------------
// 두 가지로 쓸 수 있다.
//  1) 기존 AI 서버(/correct·/pronounce·/tts)에 합치기:
//     이 파일의 handleCall 을 가져와 fetch 맨 앞에서
//       const r = await handleCall(request, env); if (r) return r;
//     기존 서버의 초대 코드 검사 함수가 있으면 env.__allow = (code)=>bool 로 넘기면 된다.
//  2) 단독 Worker 로 배포: 아래 export default 그대로 사용 (wrangler.toml 은 server/wrangler.toml).
//
// 엔드포인트 (모두 POST JSON, CORS 허용)
//  /call/ping   {code}                                  → {ok, usage:{month, sec, cap}}
//  /call/say    {code, text, sc}                        → {audio}  (첫 대사 음성, STT 사용 없음)
//  /call/turn   {code, audio, sc, history, n}            → {heard, reply:{z,p,k}, end, audio, sec, usage}
//  /call/review {code, sc, turns}                        → {score, verdict, outcome, strategy[], lines[], phrases[]}
//
// 필요한 값 (Settings > Variables and Secrets)
//  AZURE_SPEECH_KEY, AZURE_SPEECH_REGION(예: eastasia), ANTHROPIC_API_KEY  — 시크릿
//  ALLOWED_CODES  — 단독 배포 시 허용 초대 코드 (쉼표 구분). 비어 있으면 전부 거부
//  CALL_CAP_MIN   — 통화 STT 월 상한(분). 기본 240 → F0 300분 중 60분은 발음 평가 몫
//  바인딩(선택): USAGE (KV) — 월별 사용 초 누적. 없으면 상한 검사 생략
//             RELAY (Durable Object, class Relay) — Anthropic 홍콩 403 우회
// ---------------------------------------------------------------

const TURN_MODEL = "claude-haiku-4-5-20251001"; // 턴당 지연 최소화
const REVIEW_MODEL = "claude-sonnet-5";          // 리뷰는 품질 우선
const VOICES = ["zh-CN-YunyangNeural", "zh-CN-YunjianNeural", "zh-CN-XiaoxiaoNeural", "zh-CN-XiaoyiNeural"];
const DEFAULT_VOICE = "zh-CN-YunyangNeural";     // 앱 원어민 mp3 와 같은 목소리

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", ...CORS } });
}

export async function handleCall(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/call/")) return null;
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (request.method !== "POST") return json({ error: "method" }, 405);
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad_json" }, 400); }
  if (!allowed(body.code, env)) return json({ error: "not_allowed" }, 403);
  try {
    if (url.pathname === "/call/ping") return json({ ok: true, usage: await usage(env) });
    if (url.pathname === "/call/turn") return json(await turn(body, env));
    if (url.pathname === "/call/say") return json({ audio: await tts(String(body.text || "").slice(0, 120), cleanSc(body.sc).voice, env) });
    if (url.pathname === "/call/review") return json(await review(body, env));
    return json({ error: "not_found" }, 404);
  } catch (e) {
    return json({ error: e.code || "server", detail: String(e.message || e).slice(0, 300) }, e.status || 500);
  }
}

export default {
  async fetch(request, env) {
    const r = await handleCall(request, env);
    return r || json({ error: "not_found" }, 404);
  },
};

function allowed(code, env) {
  code = String(code || "").trim();
  if (!code) return false;
  if (typeof env.__allow === "function") return !!env.__allow(code);
  const list = String(env.ALLOWED_CODES || "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.includes(code);
}

// ---------------- Azure 사용량 (월별, KV) ----------------
function monthKey() {
  const d = new Date(Date.now() + 8 * 3600e3); // 중국 시간 기준 월
  return d.toISOString().slice(0, 7);
}
async function usage(env) {
  const month = monthKey();
  const cap = (parseInt(env.CALL_CAP_MIN) || 240) * 60;
  let sec = 0;
  if (env.USAGE) sec = parseFloat(await env.USAGE.get("azure-call:" + month)) || 0;
  return { month, sec: Math.round(sec), cap, tracked: !!env.USAGE };
}
async function addUsage(env, add) {
  if (!env.USAGE || !add) return;
  const k = "azure-call:" + monthKey();
  const cur = parseFloat(await env.USAGE.get(k)) || 0;
  await env.USAGE.put(k, String(cur + add), { expirationTtl: 60 * 60 * 24 * 120 });
}

// ---------------- 통화 한 턴: STT → Claude → TTS ----------------
async function turn(b, env) {
  const sc = cleanSc(b.sc);
  const u0 = await usage(env);
  if (u0.tracked && u0.sec >= u0.cap) throw err("quota", "이번 달 통화용 음성 인식 한도를 다 썼습니다", 429);

  const wav = b64ToBytes(String(b.audio || ""));
  if (wav.length < 44 + 3200) throw err("short_audio", "녹음이 너무 짧습니다", 400);
  const sec = Math.round(((wav.length - 44) / 32000) * 100) / 100; // 16kHz 16bit mono
  if (sec > 30) throw err("long_audio", "한 번에 30초까지만 말할 수 있습니다", 400);

  const heard = await stt(wav, env);
  await addUsage(env, Math.ceil(sec)); // Azure 는 초 단위 올림 과금

  const history = (Array.isArray(b.history) ? b.history : []).slice(-16)
    .map((t) => ({ r: t.r === "me" ? "me" : "npc", z: String(t.z || "").slice(0, 200) }));
  const n = parseInt(b.n) || history.filter((t) => t.r === "me").length + 1;
  const reply = await npcReply(sc, history, heard, n, env);

  let audio = "";
  try { audio = await tts(reply.z, sc.voice, env); } catch { audio = ""; } // 음성 실패 시 앱이 /tts 로 재시도
  return { heard, reply: { z: reply.z, p: reply.p, k: reply.k }, end: !!reply.end, audio, sec, usage: await usage(env) };
}

function cleanSc(sc) {
  sc = sc || {};
  const s = (v, n) => String(v || "").slice(0, n);
  return {
    title: s(sc.title, 60), setting: s(sc.setting, 400), npc: s(sc.npc, 200), persona: s(sc.persona, 600),
    goal: s(sc.goal, 300), keys: (Array.isArray(sc.keys) ? sc.keys : []).slice(0, 6).map((k) => s(k, 80)),
    voice: VOICES.includes(sc.voice) ? sc.voice : DEFAULT_VOICE,
  };
}

async function stt(wav, env) {
  const region = env.AZURE_SPEECH_REGION || "eastasia";
  const u = `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=zh-CN&format=detailed&profanity=raw`;
  const r = await fetch(u, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": env.AZURE_SPEECH_KEY,
      "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
      Accept: "application/json",
    },
    body: wav,
  });
  if (r.status === 429) throw err("azure_busy", "음성 인식 서버가 바쁩니다", 429);
  if (!r.ok) throw err("stt", "음성 인식 실패 " + r.status, 502);
  const d = await r.json();
  if (d.RecognitionStatus !== "Success") return ""; // NoMatch·InitialSilenceTimeout → 못 알아들음
  const best = (d.NBest && d.NBest[0]) || {};
  return String(best.Display || d.DisplayText || "").trim();
}

async function tts(text, voice, env) {
  const region = env.AZURE_SPEECH_REGION || "eastasia";
  const esc = String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const ssml = `<speak version="1.0" xml:lang="zh-CN"><voice name="${voice}"><prosody rate="-5%">${esc}</prosody></voice></speak>`;
  const r = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": env.AZURE_SPEECH_KEY,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      "User-Agent": "sz-chinese-call",
    },
    body: ssml,
  });
  if (!r.ok) throw new Error("tts " + r.status);
  return bytesToB64(new Uint8Array(await r.arrayBuffer()));
}

async function npcReply(sc, history, heard, n, env) {
  const system = `你在一个中文口语训练App里扮演电话另一头的人。对方是韩国服装公司广州分公司的负责人"朴总"（韩国人，中文HSK4~5水平），这是一通真实感很强的电话。

【场景】${sc.title}：${sc.setting}
【你的身份】${sc.npc}
【你的性格与立场】${sc.persona}
【朴总的目标（你不要主动帮他达成）】${sc.goal}

规则：
- 只用口语化普通话，像广州/东莞工厂、市场里真实的人说话。每次只说1~2句，合计不超过40个字——这是电话，不是写信。
- 保持你的立场：会找理由、拖时间、反提条件；朴总说得有理有据、施压得当时才逐步让步。不要一下子全部答应。
- 朴总说得不清楚、中文有错误但能猜懂时，按你理解的意思自然回应，不要纠正他的中文。完全听不懂或内容为空时，像打电话那样说"喂？刚才没听清，您再说一遍？"之类。
- 他说韩语或英语时，用中文表示听不懂。
- 通话进行到第12轮左右，或者对方明显要结束（好的/就这样/拜拜），或者事情谈妥/谈崩时，用一句自然的话收尾并把 end 设为 true。
- 绝对不要跳出角色，不要解释你是AI。

只输出JSON，不要其他文字：{"z":"你说的中文","p":"带声调符号的拼音","k":"자연스러운 한국어 번역(존댓말)","end":false}`;

  const lines = history.map((t) => (t.r === "me" ? "朴总：" : "你：") + t.z).join("\n");
  const user = `【到目前为止的通话】\n${lines || "（你刚接通/拨通电话，已经说了开场白）"}\n\n【朴总刚才说（语音识别结果，可能有识别错误）】\n${heard || "（没有听清/空白）"}\n\n这是朴总的第${n}句。请回应。`;
  const out = await anthropic(env, TURN_MODEL, system, user, 300);
  const j = parseJSON(out);
  if (!j || !j.z) throw err("npc", "캐릭터 답변 생성 실패", 502);
  return { z: String(j.z), p: String(j.p || ""), k: String(j.k || ""), end: !!j.end };
}

// ---------------- 통화 리뷰 ----------------
async function review(b, env) {
  const sc = cleanSc(b.sc);
  const turns = (Array.isArray(b.turns) ? b.turns : []).slice(0, 60)
    .map((t) => ({ r: t.r === "me" ? "me" : "npc", z: String(t.z || "").slice(0, 300) }));
  const mine = turns.filter((t) => t.r === "me" && t.z);
  if (!mine.length) throw err("empty", "교정할 발화가 없습니다", 400);

  const system = `당신은 광저우에서 의류 OEM 공장을 상대하는 한국인 지사장의 중국어·협상 코치입니다. 방금 끝난 롤플레이 전화 통화(음성 인식 전사본)를 리뷰합니다.

교정 원칙:
- 문법·어휘·어순 오류를 고치고, 공장 실무에서 실제로 쓰는 자연스러운 구어로 바꿉니다.
- 음성 인식 오류로 보이는 글자(동음이의어 등)는 문법 오류로 잡지 말고, 의도한 말로 해석해 교정합니다.
- 협상 전략까지 봅니다: 앵커링 시점, 모호한 답("可能/尽量")을 확정 날짜·숫자로 바꾸게 했는지, 서면(위챗) 확인 요구, 본사 압박 프레이밍(上面压得比较紧/我要跟韩国汇报), 대안 제시, 감정 조절.
- 자주 틀리는 패턴(把 구문, 不够+형용사, 了 위치, 양사, 可能 vs 단정)은 pattern 키로 묶습니다. pattern 은 영문 소문자 짧은 키(예: ba-construction, le-position, measure-word, vague-commitment).
- 설명은 한국어 존댓말로 짧게. 병음은 성조 기호.

JSON 만 출력:
{"score":0~100,"verdict":"한 줄 총평","outcome":"목표 달성 여부와 이유 한두 문장",
"strategy":[{"point":"전략 포인트 제목","why":"무엇이 좋았고/아쉬웠는지","z":"그 순간에 쓸 더 나은 한 마디","p":"병음","k":"뜻"}],
"lines":[{"i":발화번호(1부터),"my":"원래 발화","ok":true/false,"z":"교정문","p":"병음","k":"뜻","issues":[{"wrong":"틀린 부분","right":"고친 부분","why":"이유","pattern":"키","label":"한국어 이름"}],"tactic":"이 발화의 협상 관점 코멘트(없으면 빈 문자열)"}],
"phrases":[{"z":"다음 통화에서 바로 쓸 핵심 표현","p":"병음","k":"뜻"}]}
lines 는 나의 발화 전부를 순서대로 포함. strategy 2~4개, phrases 3~5개.`;

  let i = 0;
  const script = turns.map((t) => (t.r === "me" ? `[나 #${++i}] ` : "[상대] ") + t.z).join("\n");
  const user = `상황: ${sc.title} — ${sc.setting}\n상대: ${sc.npc}\n나의 목표: ${sc.goal}\n참고 핵심 표현: ${sc.keys.join(" / ")}\n\n통화 전사본:\n${script}`;
  const out = await anthropic(env, REVIEW_MODEL, system, user, 4000);
  const j = parseJSON(out);
  if (!j || !Array.isArray(j.lines)) throw err("review", "리뷰 생성 실패", 502);
  return j;
}

// ---------------- Anthropic (홍콩 403 우회 Relay 지원) ----------------
export class Relay {
  constructor(state, env) { this.env = env; }
  async fetch(request) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": this.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: await request.text(),
    });
    return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
  }
}
async function anthropic(env, model, system, user, max_tokens) {
  const payload = JSON.stringify({ model, max_tokens, system, messages: [{ role: "user", content: user }] });
  let r;
  if (env.RELAY) {
    const stub = env.RELAY.get(env.RELAY.idFromName("us"), { locationHint: "wnam" });
    r = await stub.fetch("https://relay/v1/messages", { method: "POST", headers: { "content-type": "application/json" }, body: payload });
  } else {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: payload,
    });
  }
  const raw = await r.text();
  if (!r.ok) throw err("claude", "Claude " + r.status + " " + raw.slice(0, 160), 502);
  const d = JSON.parse(raw);
  return d.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
}

// ---------------- 유틸 ----------------
function err(code, message, status) { const e = new Error(message); e.code = code; e.status = status; return e; }
function parseJSON(text) {
  try {
    const clean = String(text).replace(/```json|```/g, "").trim();
    return JSON.parse(clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1));
  } catch { return null; }
}
function b64ToBytes(b64) {
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return new Uint8Array(0); }
}
function bytesToB64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
