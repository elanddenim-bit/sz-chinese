// supabase/functions/call/index.ts
// 통화 모드(음성 롤플레이) — Supabase Edge Function `call`
// 대시보드 배포: Edge Functions > Deploy a new function > Via Editor, 이름 `call`, "Verify JWT" 끔(다른 함수와 동일)
//
// 앱은 {ai}/call/<동작> 으로 부른다. Supabase 가 /functions/v1/call/* 를 전부 이 함수로 넘긴다.
//  POST /call/ping   {code}                         → {ok, usage}
//  POST /call/say    {code, text, sc}               → {audio}            첫 대사 음성(STT 사용 없음)
//  POST /call/turn   {code, audio, sc, history, n}  → {heard, reply:{z,p,k}, hints[], end, audio, sec, usage}
//                    {code, stuck:true, sc, history} → 녹음 없이 상대가 더 쉽게 다시 묻기(STT 사용 없음)
//  sc.level 1 연습(협조·쉬운 말·힌트) / 2 보통 / 3 실전(원래 성격 그대로),  sc.kind life|work,  sc.me 사용자 신분
//  POST /call/review {code, sc, turns}              → {score, verdict, outcome, strategy[], lines[], phrases[]}
//  audio = 16kHz mono WAV base64 (pronounce 와 같은 형식)
//
// 시크릿: AZURE_SPEECH_KEY, AZURE_SPEECH_REGION(pronounce 와 공유), ANTHROPIC_API_KEY
// 선택: CALL_CAP_MIN(통화 STT 월 상한 분, 기본 240 → F0 300분 중 60분은 발음 평가 몫)
// 선택: CALL_DAY_TURNS(코드당 하루 턴 수, 기본 150), CALL_DAY_REVIEWS(코드당 하루 리뷰 수, 기본 20) — 코드 유출 시 Claude 비용 방어
// 테이블 call_usage(아래 SQL) — 월 STT 초·하루 호출 수를 기록. 없으면 추적·상한 검사를 모두 건너뛴다(권장: 반드시 생성).
//   create table if not exists call_usage (month text primary key, sec numeric not null default 0, updated_at timestamptz default now());
//   alter table call_usage enable row level security;   -- 정책 없음 = service role 만 접근

// 초대 코드: 저장소가 public 이므로 여기엔 넣지 않는다 → 시크릿 ALLOWED_CODES(쉼표 구분)에 등록.
// 이 파일은 수정 없이 그대로 대시보드에 붙여넣는다.
const ALLOWED: string[] = [
  // "초대코드",
];

const TURN_MODEL = "claude-haiku-4-5-20251001"; // 턴당 지연 최소화
const REVIEW_MODEL = "claude-sonnet-5";          // 리뷰는 품질 우선
const VOICES = ["zh-CN-YunyangNeural", "zh-CN-YunjianNeural", "zh-CN-XiaoxiaoNeural", "zh-CN-XiaoyiNeural"];
const DEFAULT_VOICE = "zh-CN-YunyangNeural";     // 앱 원어민 mp3 와 같은 목소리

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
function env(k: string) { return Deno.env.get(k) ?? ""; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  const action = path.slice(path.lastIndexOf("/") + 1); // .../call/turn → turn
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  if (!allowed(body?.code)) return json({ error: "not_allowed" }, 403);
  try {
    if (action === "ping") return json({ ok: true, usage: await usage() });
    if (action === "say") { const sc = cleanSc(body.sc); return json({ audio: await tts(String(body.text || "").slice(0, 120), sc.voice, sc.level) }); }
    if (action === "turn") return json(await turn(body));
    if (action === "review") return json(await review(body));
    return json({ error: "not_found" }, 404);
  } catch (e: any) {
    return json({ error: e?.code || "server", detail: String(e?.message || e).slice(0, 300) }, e?.status || 500);
  }
});

function allowed(code: unknown) {
  const c = String(code || "").trim();
  if (!c) return false;
  const extra = env("ALLOWED_CODES").split(",").map((s) => s.trim()).filter(Boolean);
  return ALLOWED.includes(c) || extra.includes(c);
}

// ---------------- Azure 사용량 (월별, call_usage 테이블) ----------------
function monthKey() { return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7); } // 중국 시간 기준
// 새 비밀 키(SUPABASE_SECRET_KEYS, sb_secret_…) 우선, 없으면 레거시 service role 키
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
  if (legacy) h.Authorization = "Bearer " + key; // sb_secret_ 키는 JWT 가 아니므로 apikey 만 보낸다
  return h;
}
// call_usage 테이블을 범용 카운터로 쓴다: month 컬럼 = 키, sec 컬럼 = 값
//   "2026-09"                 → 그 달 통화 STT 초
//   "day:2026-09-28:t:<hash>" → 코드별 그날 턴 수,  "…:r:<hash>" → 리뷰 수
async function readCount(key: string): Promise<number | null> {
  const base = env("SUPABASE_URL");
  if (!base || !sbKey().key) return null;
  try {
    const r = await fetch(`${base}/rest/v1/call_usage?month=eq.${encodeURIComponent(key)}&select=sec`, { headers: sbHeaders() });
    if (!r.ok) return null; // 테이블 없음 → 추적 안 함
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
  } catch { /* 기록 실패는 통화를 막지 않는다 */ }
}
async function usage() {
  const month = monthKey();
  const cap = (parseInt(env("CALL_CAP_MIN")) || 240) * 60;
  const sec = await readCount(month);
  return { month, sec: Math.round(sec ?? 0), cap, tracked: sec !== null };
}
async function addUsage(add: number) { await addCount(monthKey(), add); }

// 코드별 하루 호출 상한 (중국 시간 기준 날짜)
async function codeHash(code: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return Array.from(new Uint8Array(d)).slice(0, 6).map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function dailyGate(code: string, kind: "t" | "r") {
  const day = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const key = `day:${day}:${kind}:${await codeHash(String(code || ""))}`;
  const cap = kind === "t" ? (parseInt(env("CALL_DAY_TURNS")) || 150) : (parseInt(env("CALL_DAY_REVIEWS")) || 20);
  const cur = await readCount(key);
  if (cur !== null && cur >= cap) {
    throw err("daily", kind === "t" ? `오늘 통화 턴 한도(${cap}회)를 다 썼습니다` : `오늘 리뷰 한도(${cap}회)를 다 썼습니다`, 429);
  }
  await addCount(key, 1, cur);
}

// ---------------- 통화 한 턴: STT → Claude → TTS ----------------
async function turn(b: any) {
  const sc = cleanSc(b.sc);
  const history = (Array.isArray(b.history) ? b.history : []).slice(-16)
    .map((t: any) => ({ r: t?.r === "me" ? "me" : "npc", z: String(t?.z || "").slice(0, 200) }));
  await dailyGate(b.code, "t");
  if (b.stuck === true) { // 막힘 도움: 오디오 없음 → Azure STT 사용량 0
    const reply = await npcReply(sc, history, "", history.filter((t: any) => t.r === "me").length, true);
    let audio = "";
    try { audio = await tts(reply.z, sc.voice, sc.level); } catch { audio = ""; }
    return { heard: "", reply: { z: reply.z, p: reply.p, k: reply.k }, hints: reply.hints, end: false, audio, sec: 0 };
  }
  const u0 = await usage();
  if (u0.tracked && u0.sec >= u0.cap) throw err("quota", "이번 달 통화용 음성 인식 한도를 다 썼습니다", 429);

  const wav = b64ToBytes(String(b.audio || ""));
  if (wav.length < 44 + 3200) throw err("short_audio", "녹음이 너무 짧습니다", 400);
  const sec = Math.round(((wav.length - 44) / 32000) * 100) / 100; // 16kHz 16bit mono
  if (sec > 30) throw err("long_audio", "한 번에 30초까지만 말할 수 있습니다", 400);

  const heard = await stt(wav);
  await addUsage(Math.ceil(sec)); // Azure 는 초 단위 올림 과금

  const n = parseInt(b.n) || history.filter((t: any) => t.r === "me").length + 1;
  const reply = await npcReply(sc, history, heard, n, false);

  let audio = "";
  try { audio = await tts(reply.z, sc.voice, sc.level); } catch { audio = ""; } // 음성 실패 시 앱이 /tts 로 재시도
  return { heard, reply: { z: reply.z, p: reply.p, k: reply.k }, hints: reply.hints, end: !!reply.end, audio, sec, usage: await usage() };
}

function cleanSc(sc: any) {
  sc = sc || {};
  const s = (v: unknown, n: number) => String(v || "").slice(0, n);
  return {
    title: s(sc.title, 60), setting: s(sc.setting, 400), npc: s(sc.npc, 200), persona: s(sc.persona, 600),
    goal: s(sc.goal, 300), keys: (Array.isArray(sc.keys) ? sc.keys : []).slice(0, 6).map((k: unknown) => s(k, 80)),
    voice: VOICES.includes(sc.voice) ? sc.voice : DEFAULT_VOICE,
    level: [1, 2, 3].includes(Number(sc.level)) ? Number(sc.level) : 1,
    kind: sc.kind === "life" ? "life" : "work",
    me: s(sc.me, 120) || "朴总（韩国服装公司广州分公司负责人，韩国人，中文HSK4~5水平）",
  };
}

async function stt(wav: Uint8Array) {
  const region = env("AZURE_SPEECH_REGION") || "eastasia";
  const u = `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=zh-CN&format=detailed&profanity=raw`;
  const r = await fetch(u, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": env("AZURE_SPEECH_KEY"),
      "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
      Accept: "application/json",
    },
    body: wav,
  });
  if (r.status === 429) throw err("azure_busy", "음성 인식 서버가 바쁩니다", 429);
  if (!r.ok) throw err("stt", "음성 인식 실패 " + r.status + " " + (await r.text()).slice(0, 200), 502);
  const d = await r.json();
  if (d.RecognitionStatus !== "Success") return ""; // NoMatch·InitialSilenceTimeout → 못 알아들음
  const best = d.NBest?.[0] ?? {};
  return String(best.Display || d.DisplayText || "").trim();
}

async function tts(text: string, voice: string, level = 3) {
  const rate = level === 1 ? "-20%" : level === 2 ? "-10%" : "-5%"; // 연습일수록 천천히
  const region = env("AZURE_SPEECH_REGION") || "eastasia";
  const esc = String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const ssml = `<speak version="1.0" xml:lang="zh-CN"><voice name="${voice}"><prosody rate="${rate}">${esc}</prosody></voice></speak>`;
  const r = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": env("AZURE_SPEECH_KEY"),
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      "User-Agent": "sz-chinese-call",
    },
    body: ssml,
  });
  if (!r.ok) throw new Error("tts " + r.status);
  return bytesToB64(new Uint8Array(await r.arrayBuffer()));
}

const LEVEL_RULES: Record<number, string> = {
  1: `【难度：练习】对方中文不太好，说话慢，常常找不到词。
- 你要非常配合、友好、有耐心。你的性格设定里的刁难点先不要用，最多提一个很小、很好解决的问题。
- 每次只说一句，不超过20个字，只用最常用的词（HSK3水平），不用成语和方言。
- 多用选择问句（"A还是B？"）或是非问句，让对方容易回答。
- 对方说错了但能猜懂，就按猜到的意思继续，并用正确的说法自然地重复一遍关键词（比如"哦，放丰巢柜是吧？"）。`,
  2: `【难度：普通】对方中文中等。
- 你基本配合，但会按性格设定提出一两个现实的问题（时间冲突、规定不允许、要加钱等），需要对方想办法解决。
- 每次1~2句，合计不超过30个字，用日常口语。`,
  3: `【难度：实战】按真实情况说话。
- 完全按性格设定：会找理由、拖时间、反提条件；对方说得有理有据、施压得当时才逐步让步，不要一下子全部答应。
- 每次只说1~2句，合计不超过40个字——这是电话，不是写信。`,
};

async function npcReply(sc: ReturnType<typeof cleanSc>, history: { r: string; z: string }[], heard: string, n: number, stuck: boolean) {
  const wantHints = sc.level < 3;
  const system = `你在一个中文口语训练App里扮演电话另一头的人，和对方打一通真实感很强的电话。

【场景】${sc.title}：${sc.setting}
【你的身份】${sc.npc}
【你的性格与立场】${sc.persona}
【对方】${sc.me}
【对方想达成的目标（你不要主动替他完成）】${sc.goal}

${LEVEL_RULES[sc.level]}

通用规则：
- 只用口语化普通话，像广州本地的真实的人说话。
- 对方中文有错误但能猜懂时，按你理解的意思自然回应，不要纠正他的中文、不要教他。完全听不懂或内容为空时，像打电话那样说"喂？刚才没听清，您再说一遍？"之类。
- 他说韩语或英语时，用中文表示听不懂。
- 通话进行到第12轮左右，或者对方明显要结束（好的/就这样/拜拜），或者事情办完/谈崩时，用一句自然的话收尾并把 end 设为 true。
- 绝对不要跳出角色，不要解释你是AI。
${wantHints ? `- hints：写出对方下一句最可能、最自然的2~3种回答（考虑他的目标），每句不超过18个字，用HSK3~4的简单词，彼此意思不同（例如：答应/提出另一个方案/问一个问题）。` : ""}

只输出JSON，不要其他文字：{"z":"你说的中文","p":"带声调符号的拼音","k":"자연스러운 한국어 번역(존댓말)","end":false${wantHints ? ',"hints":[{"z":"对方可以说的话","p":"拼音","k":"한국어 뜻"}]' : ""}}`;

  const lines = history.map((t) => (t.r === "me" ? "对方：" : "你：") + t.z).join("\n");
  const last = stuck
    ? `【对方沉默了好几秒，好像不知道怎么说】\n请用更简单、更短的话重新问一次，最好给他两个选项让他选（例如"放门口还是放快递柜？"）。`
    : `【对方刚才说（语音识别结果，可能有识别错误）】\n${heard || "（没有听清/空白）"}\n\n这是对方的第${n}句。请回应。`;
  const user = `【到目前为止的通话】\n${lines || "（刚接通电话，你已经说了开场白）"}\n\n${last}`;
  const j = parseJSON(await anthropic(TURN_MODEL, system, user, wantHints ? 600 : 300));
  if (!j || !j.z) throw err("npc", "캐릭터 답변 생성 실패", 502);
  const hints = wantHints && Array.isArray(j.hints)
    ? j.hints.slice(0, 3).filter((h: any) => h && h.z).map((h: any) => ({ z: String(h.z), p: String(h.p || ""), k: String(h.k || "") }))
    : [];
  return { z: String(j.z), p: String(j.p || ""), k: String(j.k || ""), end: !!j.end && !stuck, hints };
}

// ---------------- 통화 리뷰 ----------------
async function review(b: any) {
  const sc = cleanSc(b.sc);
  const turns = (Array.isArray(b.turns) ? b.turns : []).slice(0, 60)
    .map((t: any) => ({ r: t?.r === "me" ? "me" : "npc", z: String(t?.z || "").slice(0, 300) }));
  if (!turns.some((t: any) => t.r === "me" && t.z)) throw err("empty", "교정할 발화가 없습니다", 400);
  await dailyGate(b.code, "r");

  const life = sc.kind === "life";
  const lvName = ["", "연습(힌트 보고 말하기 허용)", "보통", "실전"][sc.level];
  const system = `당신은 광저우에 사는 한국인 지사장(중국어 HSK4~5, 말하기가 약함)의 중국어 말하기 코치입니다. 방금 끝난 롤플레이 전화 통화(음성 인식 전사본, 난이도 ${lvName})를 리뷰합니다.
${life ? "이 통화는 생활 상황입니다. 협상보다 '짧고 분명하게 필요한 걸 전달했는지'(위치·시간·요청을 정확히 말하기, 되묻기, 확인하기)를 봅니다." : "이 통화는 공장 업무 상황입니다. 협상 전략까지 봅니다."}
말하기가 약한 학습자이므로, 틀린 것만 나열하지 말고 "이 정도면 통한다"는 것은 ok:true 로 인정하고, 더 자연스러운 한 마디를 짧게 제시합니다.

교정 원칙:
- 문법·어휘·어순 오류를 고치고, ${life ? "광저우 일상에서" : "공장 실무에서"} 실제로 쓰는 자연스러운 구어로 바꿉니다.
- 음성 인식 오류로 보이는 글자(동음이의어 등)는 문법 오류로 잡지 말고, 의도한 말로 해석해 교정합니다.
- ${life ? "전달 전략까지 봅니다: 위치를 랜드마크로 설명, 시간을 숫자로 확정, 못 알아들으면 되묻기(您说什么？/能再说一遍吗？), 마지막에 확인하기(那就……，对吧？)." : "협상 전략까지 봅니다: 앵커링 시점, 모호한 답(\"可能/尽量\")을 확정 날짜·숫자로 바꾸게 했는지, 서면(위챗) 확인 요구, 본사 압박 프레이밍(上面压得比较紧/我要跟韩国汇报), 대안 제시, 감정 조절."}
- 자주 틀리는 패턴(把 구문, 不够+형용사, 了 위치, 양사, 可能 vs 단정)은 pattern 키로 묶습니다. pattern 은 영문 소문자 짧은 키(예: ba-construction, le-position, measure-word, vague-commitment).
- 설명은 한국어 존댓말로 짧게. 병음은 성조 기호.

JSON 만 출력:
{"score":0~100,"verdict":"한 줄 총평","outcome":"목표 달성 여부와 이유 한두 문장",
"strategy":[{"point":"${life ? "소통" : "협상"} 포인트 제목","why":"무엇이 좋았고/아쉬웠는지","z":"그 순간에 쓸 더 나은 한 마디","p":"병음","k":"뜻"}],
"lines":[{"i":발화번호(1부터),"my":"원래 발화","ok":true/false,"z":"교정문","p":"병음","k":"뜻","issues":[{"wrong":"틀린 부분","right":"고친 부분","why":"이유","pattern":"키","label":"한국어 이름"}],"tactic":"이 발화의 ${life ? "소통" : "협상"} 관점 코멘트(없으면 빈 문자열)"}],
"phrases":[{"z":"다음 통화에서 바로 쓸 핵심 표현","p":"병음","k":"뜻"}]}
lines 는 나의 발화 전부를 순서대로 포함. 통하는 발화(ok:true)는 issues 를 빈 배열로, z 는 더 자연스러운 표현이 있을 때만 쓰고 없으면 빈 문자열로 둡니다(출력 길이 절약). strategy 2~4개, phrases 3~5개.`;

  let i = 0;
  const script = turns.map((t: any) => (t.r === "me" ? `[나 #${++i}] ` : "[상대] ") + t.z).join("\n");
  const user = `상황: ${sc.title} — ${sc.setting}\n상대: ${sc.npc}\n나의 목표: ${sc.goal}\n참고 핵심 표현: ${sc.keys.join(" / ")}\n\n통화 전사본:\n${script}`;
  const j = parseJSON(await anthropic(REVIEW_MODEL, system, user, 10000));
  if (!j || !Array.isArray(j.lines)) throw err("review", "리뷰 생성 실패", 502);
  return j;
}

// ---------------- Anthropic ----------------
async function anthropic(model: string, system: string, user: string, max_tokens: number) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens, system, messages: [{ role: "user", content: user }] }),
  });
  const raw = await r.text();
  if (!r.ok) throw err("claude", "Claude " + r.status + " " + raw.slice(0, 160), 502);
  const d = JSON.parse(raw);
  return (d.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
}

// ---------------- 유틸 ----------------
function err(code: string, message: string, status: number) {
  const e: any = new Error(message); e.code = code; e.status = status; return e;
}
function parseJSON(text: string): any {
  try {
    const clean = String(text).replace(/```json|```/g, "").trim();
    return JSON.parse(clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1));
  } catch { return null; }
}
function b64ToBytes(b64: string) {
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return new Uint8Array(0); }
}
function bytesToB64(bytes: Uint8Array) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
