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
          body: JSON.stringify({ model, messages, temperature, response_format: { type: "json_object" }, enable_thinking: false, max_tokens: 6000 }), signal: AbortSignal.timeout(Number(env.AIR_QWEN_MS) || 75000) });
      } catch (e) { last = model + ": " + String(e.name === "TimeoutError" ? "응답 시간 초과" : e.message || e); break; }
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
  const left = c.kind === "book" ? Object.values(c.nodes).filter((n) => !n.text).length : c.suspects.filter((x) => !x.rounds || x.rounds.length < 2).length;
  const base = { id: c.id, kind: c.kind || "case", made: c.made, genre: c.genre, title: c.title, intro: c.intro, imgs, pending: c.imgs.filter((x) => x.task).length, failed: c.imgs.filter((x) => !x.task && !x.key).length, nimg: c.imgs.length || (c.kind === "book" ? Math.min(Number(env.AIR_BOOK_IMG) || 12, Object.keys(c.nodes).length) : 8), left };
  if (c.kind === "book") return { ...base, start: c.start, nodes: c.nodes, ends: c.ends };
  return { ...base, suspects: c.suspects.map(({ secret, ...x }) => x), places: c.places, truth: c.truth };
}
async function view(env, d) {
  const cases = [];
  for (const id of Object.keys(d.cases).sort()) cases.push(await viewCase(env, d.cases[id]));
  return { ok: true, cases, hist: d.hist.slice(0, 30), total: d.total, genres: Object.fromEntries(Object.entries(GENRES).map(([k, g]) => [k, g.label])) };
}

export async function airApi(env, ctx, path, b, h) {
  if (path === "/air/state") return view(env, await load(env, h));
  if (path === "/air/new") return b.kind === "book" ? newBook(env, ctx, b, h) : newCase(env, ctx, b, h);
  if (path === "/air/poll") return poll(env, b, h);
  if (path === "/air/fill") return fill(env, ctx, b, h);
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
  const poiRes = await env.DIDI.fetch("https://didi/api/poi", { method: "POST", headers: { "x-access-key": env.DIDI_ACCESS_KEY, "content-type": "application/json" }, body: JSON.stringify({ gps, radius: 15000, kw: KW }), signal: AbortSignal.timeout(12000) }).then((r) => r.json()).catch((e) => ({ error: String(e.message || e) }));
  if (!poiRes.ok) throw aerr("무대로 쓸 장소를 못 찾았어요(주소록 서버): " + (poiRes.error || ""), 502);
  const used = new Set(d.hist.flatMap((x) => x.pids || []).concat(Object.values(d.cases).flatMap((c) => c.pids || [])));
  const byKw = {};
  for (const p of (poiRes.pois || []).filter((p) => !used.has(p.id)).sort((a, c) => (c.rating || 3) - (a.rating || 3))) (byKw[p.kw] = byKw[p.kw] || []).push(p);
  const cands = Object.values(byKw).flatMap((l) => l.slice(0, 3)).slice(0, 36);
  if (cands.length < 4) throw aerr("무대로 쓸 장소가 부족해요.");
  const list = cands.map((p, i) => ({ i, name: p.name, type: p.type, kw: p.kw, area: p.area }));
  const sys = "你是互动推理游戏的编剧。玩家是住在广州的韩国中年男性，在飞机上离线玩：读案情、到4个地点'调查'、审问4个嫌疑人（每轮只能选一个问题问，问了就不能问另外的）、最后指认一人。题材：" + GENRES[genre].d + "。\n" +
    "规则：1) 从候选真实地点选4个当舞台（类型不同），真实地点只当背景，所有人物、事件都是虚构的，不要暗示真实店铺有负面行为。2) 不能有凶杀、血腥、暴力、色情、政治。" +
    "3) 4个嫌疑人：虚构中文名（korean 字段写韩语读法），职业、性格、外貌各不同、有记忆点；其中1人是真相（culprit 0~3）。secret 字段写这个人真正做了什么/隐瞒了什么(给后续审问编剧用，玩家看不到)。" +
    "4) 线索要公平：地点调查4条线索合起来加上审问能推理出唯一答案，也要有1~2条误导；单条不够。" +
    "5) 全部用韩语写，第二人称'당신'，有画面感。look 是给绘图模型的中文人物外貌描述(40字内：年龄、性别、发型、服装、表情、职业感)，不要真实名人。scene 是地点插画的中文描述(40字内：时间、天气、氛围)。" +
    "6) ending 揭晓真相(5~8句，逐条说明线索怎么指向真相)，wrong 猜错结局(2~3句，不剧透)，hints 2条(每条一句，越来越直接)。\n" +
    '只输出 JSON（title 用韩语写，6~14字，像推理小说书名）：{"title":"","intro":"3~5句开场，案件是什么、玩家为什么卷入","suspects":[{"name":"","korean":"","role":"","desc":"2句性格外貌","alibi":"本人声称的不在场说明1句","look":"","secret":""}],' +
    '"places":[{"i":候选编号,"title":"章节标题","story":"到达时的描写3~4句","scene":"","search":"调查后发现的东西2~3句","clue":"这条线索一句话"}],"culprit":0,"hints":["",""],"ending":"","wrong":""}';
  const out = await qwen(env, [env.AIR_MODEL, env.QUEST_MODEL || "qwen3.8-flash", "qwen-plus"], [{ role: "system", content: sys }, { role: "user", content: "候选地点：" + JSON.stringify(list) }]);
  const S = (x, n) => String(x == null ? "" : x).slice(0, n);
  const seen = new Set();
  const places = (Array.isArray(out.places) ? out.places : []).filter((x) => cands[Number(x.i)] && !seen.has(Number(x.i)) && seen.add(Number(x.i))).slice(0, 4).map((x, k) => {
    const p = cands[Number(x.i)];
    return { k: "p" + k, name: p.name, area: p.area, title: S(x.title || p.name, 40), story: S(x.story, 600), scene: S(x.scene, 80), search: S(x.search, 500), clue: S(x.clue, 240), pid: p.id };
  });
  const suspects = [];
  for (const [k, s] of (Array.isArray(out.suspects) ? out.suspects : []).slice(0, 4).entries()) {
    suspects.push({ k: "s" + k, name: S(s.name, 20), korean: S(s.korean, 20), role: S(s.role, 40), desc: S(s.desc, 240), alibi: S(s.alibi, 200), look: S(s.look, 80), secret: S(s.secret, 300), rounds: [] });
  }
  const culprit = Number(out.culprit);
  if (places.length < 3 || suspects.length < 3 || !(culprit >= 0 && culprit < suspects.length)) throw aerr("사건 설계가 엉성하게 나왔어요. 다시 눌러 주세요.", 502);
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

// ---------- 📚 만화 게임북: 선택지로 갈라지는 추리 — 잘못 고르면 추리가 막히거나 엉뚱한 사람을 잡는 실패 결말 ----------
async function newBook(env, ctx, b, h) {
  const d = await load(env, h);
  if (Object.keys(d.cases).length >= 4) throw aerr("담아 둔 사건이 4개예요. 하나 풀거나 지우고 다시 만들어요.");
  const day = cnDay(), max = Number(env.AIR_DAY_MAX) || 3;
  if ((d.gen[day] || 0) >= max) throw aerr("오늘은 사건을 " + max + "건 만들었어요. 내일 다시!", 429);
  const genre = GENRES[b.genre] ? b.genre : "classic";
  let places = [];
  try {
    if (env.DIDI && env.DIDI_ACCESS_KEY) {
      const gps = /^-?\d+\.\d+,-?\d+\.\d+$/.test(String(b.gps || "")) ? String(b.gps) : "113.2644,23.1291";
      const r = await env.DIDI.fetch("https://didi/api/poi", { method: "POST", headers: { "x-access-key": env.DIDI_ACCESS_KEY, "content-type": "application/json" }, body: JSON.stringify({ gps, radius: 15000, kw: KW }), signal: AbortSignal.timeout(12000) }).then((x) => x.json());
      const used = new Set(d.hist.flatMap((x) => x.pids || []).concat(Object.values(d.cases).flatMap((c) => c.pids || [])));
      const byKw = {}; for (const p of (r.pois || []).filter((p) => !used.has(p.id)).sort((a, c) => (c.rating || 3) - (a.rating || 3))) (byKw[p.kw] = byKw[p.kw] || []).push(p);
      places = Object.values(byKw).flatMap((l) => l.slice(0, 1)).slice(0, 8);
    }
  } catch {}
  const sys = "你是'漫画推理游戏书'(gamebook)的编剧。玩家是住在广州的韩国中年男性，在飞机上离线翻页玩：每页一幅漫画分镜+几句叙述+2~3个选择，选择决定剧情走向。题材：" + GENRES[genre].d + "。\n" +
    "结构要求：1) 共 22~28 页(节点)，起点 id 为 n1。2) 剧情是真正分支的：至少 3 条不同的调查路线，路线之间可以汇合。3) 至少 5 个结局：1 个'真相'结局(good，推理完全正确)、1~2 个'半对'结局(half，抓到人但动机/手法弄错或证据不足)、2~3 个'失败'结局(bad：被误导抓错人、证据被销毁、嫌疑人跑了、自己被套路 等)，失败结局要写得有趣、有点反转，让玩家想重来。" +
    "4) 关键在于选择有后果：早期一个看似合理的选择可能让后面少看到一条线索而走向失败；有的选择是陷阱(太冲动、太信某个人)。不要有'明显正确'的选择，每个选项都要像有道理。" +
    "5) 这一步只写大纲：每页 s 是这一页发生什么的1~2句韩语摘要(正文下一步再写)，选项文字 t 是韩语。" +
    "6) 真实地点(候选)只当背景舞台，人物、事件全部虚构，不能有凶杀、血腥、暴力、色情、政治。" +
    "7) 结局页 end 字段: good|half|bad，结局页没有 choices。所有 choices.to 必须是存在的 id，不能有循环，不能有到不了的页。\n" +
    '只输出 JSON（title 用韩语写，6~14字，像漫画书名）：{"title":"","nodes":[{"id":"n1","s":"","choices":[{"t":"选项文字(韩语)","to":"n2"}]},{"id":"n9","s":"","end":"bad"}]}';
  const out = await qwen(env, [env.AIR_MODEL, env.QUEST_MODEL || "qwen3.8-flash", "qwen-plus"], [{ role: "system", content: sys }, { role: "user", content: "候选地点(可用作舞台)：" + JSON.stringify(places.map((p) => ({ name: p.name, type: p.type, area: p.area }))) }], 0.95);
  const S = (x, n) => String(x == null ? "" : x).slice(0, n);
  const raw = (Array.isArray(out.nodes) ? out.nodes : []).slice(0, 36);
  const ids = new Set(raw.map((x) => String(x.id)));
  if (!ids.has("n1")) throw aerr("게임북 구조가 이상하게 나왔어요(시작 페이지 없음). 다시 눌러 주세요.", 502);
  const nodes = {};
  for (const x of raw) {
    const id = String(x.id);
    const n = { id, s: S(x.s, 200), text: "", img: "" };
    if (x.end && /^(good|half|bad)$/.test(String(x.end))) { n.end = String(x.end); n.verdict = ""; }
    else {
      n.choices = (Array.isArray(x.choices) ? x.choices : []).filter((c) => ids.has(String(c.to)) && String(c.to) !== id).slice(0, 3).map((c) => ({ t: S(c.t, 80), to: String(c.to) }));
      if (!n.choices.length) { n.end = "bad"; n.verdict = "여기서 이야기가 끊겼어요. 다른 길을 찾아보세요."; }
    }
    nodes[id] = n;
  }
  // 닿을 수 있는 페이지만 남김(순환은 방문 집합으로 끊음)
  const reach = new Set(); const stack = ["n1"];
  while (stack.length) { const id = stack.pop(); if (reach.has(id) || !nodes[id]) continue; reach.add(id); for (const c of nodes[id].choices || []) stack.push(c.to); }
  for (const id of Object.keys(nodes)) if (!reach.has(id)) delete nodes[id];
  const ends = Object.values(nodes).filter((n) => n.end);
  if (Object.keys(nodes).length < 10 || !ends.some((n) => n.end === "good") || !ends.some((n) => n.end === "bad")) throw aerr("게임북이 너무 짧거나 결말이 부족하게 나왔어요. 다시 눌러 주세요.", 502);
  const id = "a" + Date.now().toString(36);
  // 본문·그림은 /air/fill 이 6쪽씩 채움(그림은 본문이 다 된 뒤 시작·결말·분기 순 최대 AIR_BOOK_IMG 장)
  const imgs = [];
  d.cases[id] = { id, kind: "book", made: Date.now(), genre, title: S(out.title || "광저우 게임북", 50), intro: "", start: "n1", nodes, ends: ends.map((n) => ({ id: n.id, end: n.end })), imgs, pids: places.map((p) => p.id) };
  d.gen = { [day]: (d.gen[day] || 0) + 1 };
  await save(env, h, d);
  ctx.waitUntil(logUse(env, "air", { book: 1 }, 0, h).catch(() => {}));
  return { ...(await view(env, d)), made: id };
}

// ---------- 2단계: 긴 생성은 요청 하나로 못 끝냄(폰·엣지 시간 제한) → 화면이 /air/fill 을 반복 호출해 조금씩 채움 ----------
async function fill(env, ctx, b, h) {
  const d = await load(env, h), c = d.cases[String(b.id || "")];
  if (!c) throw aerr("사건을 찾지 못했어요.", 404);
  const S = (x, n) => String(x == null ? "" : x).slice(0, n);
  const models = [env.AIR_MODEL, env.QUEST_MODEL || "qwen3.8-flash", "qwen-plus"];
  if (c.kind === "book") {
    const todo = Object.values(c.nodes).filter((n) => !n.text).slice(0, 6);
    if (todo.length) {
      const outline = Object.values(c.nodes).map((n) => ({ id: n.id, s: n.s, choices: (n.choices || []).map((x) => x.t + "→" + x.to), end: n.end || "" }));
      const sys = "你是'漫画推理游戏书'的编剧。下面是整本书的分支大纲(每页摘要、选项、结局类型)。请把指定的几页写成正文：text 3~5句韩语，第二人称'당신'，像漫画旁白+对话(对话用 「」)，有画面感，和前后页衔接；img 是绘图用中文分镜描述(40字内：场景、人物动作、情绪、镜头)，主角统一描述为'戴黑框眼镜、穿深蓝夹克的中年男人'；结局页另写 verdict(1句：这条路为什么对/错)。" +
        "真实地点只当背景，人物事件虚构，不能有凶杀、血腥、暴力、色情、政治。" + '只输出 JSON：{"pages":[{"id":"","text":"","img":"","verdict":""}]}';
      const out = await qwen(env, models, [{ role: "system", content: sys }, { role: "user", content: "书名：" + c.title + "\n大纲：" + JSON.stringify(outline) + "\n这次要写的页：" + JSON.stringify(todo.map((n) => n.id)) }], 0.85);
      for (const pg of (Array.isArray(out.pages) ? out.pages : [])) { const n = c.nodes[String(pg.id)]; if (n && !n.text) { n.text = S(pg.text, 700) || "…"; n.img = S(pg.img, 100); if (n.end) n.verdict = S(pg.verdict, 200) || n.verdict || ""; } }
      for (const n of todo) if (!n.text) n.text = "(이 쪽은 쓰지 못했어요) " + (n.s || "");
    }
    const left = Object.values(c.nodes).filter((n) => !n.text).length;
    if (!left && !c.imgs.length && !c.imgDone) {
      const ends = Object.values(c.nodes).filter((n) => n.end), limit = Number(env.AIR_BOOK_IMG) || 12;
      const order = ["n1", ...ends.map((n) => n.id), ...Object.keys(c.nodes).filter((k) => k !== "n1" && !c.nodes[k].end)];
      for (const k of [...new Set(order)].slice(0, limit)) c.imgs.push({ k, task: await t2i(env, "漫画分镜，" + c.nodes[k].img + "，日式推理漫画风格，清晰线稿加淡彩，电影感构图，画面里没有文字", "1024*768"), key: "" });
      c.imgDone = true;
    }
    await save(env, h, d);
    return { ok: true, left, case: await viewCase(env, c) };
  }
  // 심문 추리: 용의자 한 명씩 3라운드×질문 3개
  const sidx = c.suspects.findIndex((x) => !x.rounds || x.rounds.length < 2);
  if (sidx >= 0) {
    const s = c.suspects[sidx], truth = JSON.parse(decodeURIComponent(escape(atob(c.truth))));
    const isC = truth.culprit === sidx;
    const sys = "你是互动推理游戏的编剧，现在只写一个嫌疑人的审问台词。案情和所有嫌疑人、地点线索如下。玩家每轮只能从3个问题里问1个(问了就不能问另外的)，共3轮。" +
      "要求：回答要有人味(回避、生气、撒谎、无意说漏嘴)，有的问题问了才会露出线索(clue 字段写一句韩语线索，大多数留空串)，至少2个问题带线索且分散在不同轮。" +
      (isC ? "这个人是真相人物：他会撒谎，但谎言必须和某条地点线索矛盾，细心的玩家能发现；不要直接认罪。" : "这个人不是真相人物：他可能隐瞒别的小事(secret)而显得可疑，造成误导，但诚实的部分要和线索一致。") +
      "全部用韩语写；每个回答另给一句中文口语 az(10~20字，像真人说话)，问题也给中文 qz。不能有凶杀、血腥、暴力、色情、政治。" +
      '只输出 JSON：{"rounds":[[{"q":"","qz":"","a":"2~3句","az":"","clue":""},{...},{...}],[...],[...]]}';
    const ctxTxt = "案情：" + c.intro + "\n嫌疑人：" + JSON.stringify(c.suspects.map((x, i) => ({ i, name: x.name, role: x.role, desc: x.desc, alibi: x.alibi, secret: x.secret }))) + "\n地点线索：" + JSON.stringify(c.places.map((p) => ({ place: p.title, clue: p.clue, found: p.search }))) + "\n真相：" + truth.ending + "\n这次写的嫌疑人编号：" + sidx + "(" + s.name + ")";
    const out = await qwen(env, models, [{ role: "system", content: sys }, { role: "user", content: ctxTxt }], 0.85);
    const rounds = [];
    for (const r of (Array.isArray(out.rounds) ? out.rounds : []).slice(0, 3)) {
      const opts = [];
      for (const o of (Array.isArray(r) ? r : []).slice(0, 3)) opts.push({ q: S(o.q, 120), qz: S(o.qz, 60), a: S(o.a, 400), az: S(o.az, 60), clue: S(o.clue, 200), say: await sayReg(env, S(o.az, 60)) });
      if (opts.length >= 2) rounds.push(opts);
    }
    if (rounds.length < 2) throw aerr(s.name + " 심문 대본이 엉성하게 나왔어요. 다시 눌러 주세요.", 502);
    s.rounds = rounds;
    await save(env, h, d);
  }
  const left = c.suspects.filter((x) => !x.rounds || x.rounds.length < 2).length;
  return { ok: true, left, case: await viewCase(env, c) };
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
    d.hist.unshift({ id, title: c.title, kind: c.kind || "case", genre: c.genre, date: cnDay(), ok, score, who: String(b.who || "").slice(0, 20), pids: c.pids });
    d.hist = d.hist.slice(0, 60); d.total += score;
    if (!b.keep) await removeCase(env, h, d, id); // 게임북은 다른 결말도 보게 남겨 둠(지우기는 직접)
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
    if (!/^air\/[0-9a-f]{12}\/a[0-9a-z]+\/[a-z]\d{1,2}\.png$/.test(k) || url.searchParams.get("s") !== (await hmac16(env, k))) return new Response("forbidden", { status: 403 });
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
function api(p,b){b=b||{};b.code=CODE;return fetch(p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json().catch(function(){return {error:'서버 응답 오류 '+r.status};});},function(e){return {error:'network',detail:'연결이 끊겼어요(응답이 너무 오래 걸렸을 수 있어요). 다시 눌러 주세요.'};});}
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
function ready(c){var n=Object.keys(c.imgs||{}).length;return n+'/'+(c.nimg||8);}
var FILLING={};
function fillCase(c){if(FILLING[c.id]||!navigator.onLine||!c.left)return;FILLING[c.id]=true;api('/air/fill',{id:c.id}).then(function(j){FILLING[c.id]=false;if(!j.ok){toast('이어 쓰기 실패: '+(j.detail||j.error)+' — 10초 뒤 다시');setTimeout(function(){fillCase(c);},10000);return;}var i=S.cases.findIndex(function(x){return x.id===c.id;});if(i>=0)S.cases[i]=j['case'];ls('air-cases',S);if(!CUR)home();if(j.left)fillCase(j['case']);else pollAll();}).catch(function(){FILLING[c.id]=false;});}
function home(){
  CUR=null;$('ttl').textContent='🕵️ 미스터리 기내편';$('back').setAttribute('href','/hub');$('back').onclick=null;$('pts').textContent='누적 '+(S.total||0)+'점';
  var h='<div class="st"><span class="dot'+(navigator.onLine?'':' off')+'"></span>'+(navigator.onLine?'온라인':'오프라인 · 저장본')+' · 사건은 폰에 저장돼 비행기 모드에서도 돼요</div>';
  if(!S.cases.length)h+='<div class="card muted">담아 둔 사건이 없어요. 아래에서 만들어 두세요(사건 하나에 1분쯤, 그림 8장은 2~3분 더).</div>';
  S.cases.forEach(function(c){var p=ls('air-play:'+c.id)||{};var im=c.imgs&&(c.kind==='book'?c.imgs.n1:c.imgs.s0);
    h+='<div class="card"><div class="cs">'+(im?'<img src="'+esc(im)+'" alt="">':'<div class="ph"></div>')+'<div style="flex:1"><b>'+(c.kind==='book'?'📚 ':'🕵️ ')+esc(c.title)+'</b><div class="muted">'+esc(S.genres[c.genre]||'')+(c.kind==='book'?' · 게임북 '+Object.keys(c.nodes).length+'쪽 · 결말 발견 '+((p.seen||[]).length)+'/'+c.ends.length:'')+(c.left?' · <span class="spin">✍️</span> '+(c.kind==='book'?'본문 쓰는 중 '+(Object.keys(c.nodes).length-c.left)+'/'+Object.keys(c.nodes).length+'쪽':'심문 대본 '+(c.suspects.length-c.left)+'/'+c.suspects.length+'명')+'':' · 그림 '+ready(c))+(c.pending?' <span class="spin">⏳</span>':'')+(c.kind==='book'?(p.good?' · ✅ 진상 도달':''):(p.done?' · '+(p.ok?'✅ 해결 '+p.score+'점':'❌ 오답'):p.started?' · 진행 중':''))+'</div>'
      +'<div class="chips" style="margin-top:8px">'+(c.left?'<button class="chip" disabled>준비 중…</button>':'<button class="chip on" data-play="'+c.id+'">'+(p.started?'이어서':'시작')+'</button>')+'<button class="chip" data-drop="'+c.id+'">지우기</button></div></div></div></div>';});
  var KD=ls('air-kind')||'case';h+='<div class="card"><h2>새 사건 만들기</h2><div class="chips" style="margin-bottom:8px"><button class="chip'+(KD==='case'?' on':'')+'" data-k="case">🕵️ 심문 추리</button><button class="chip'+(KD==='book'?' on':'')+'" data-k="book">📚 만화 게임북</button></div><p class="muted">'+(KD==='book'?'한 쪽마다 만화 컷+선택지. 선택에 따라 추리 방향이 갈리고, 잘못 고르면 엉뚱한 사람을 잡거나 단서를 놓치는 실패 결말(결말 5개 이상). 그림 12장.':'광저우 실제 장소 4곳이 무대, 용의자 4명 심문(라운드마다 질문 하나만!), 그림 8장.')+' 인터넷 될 때만.</p><div class="chips" id="gn">'+Object.keys(S.genres).map(function(k){return '<button class="chip'+(k===(ls('air-genre')||'classic')?' on':'')+'" data-g="'+k+'">'+esc(S.genres[k])+'</button>';}).join('')+'</div><button class="big" id="mk"'+(navigator.onLine?'':' disabled')+'>🕵️ 사건 만들기</button></div>';
  if(S.hist&&S.hist.length)h+='<div class="card"><h2>지난 사건</h2>'+S.hist.slice(0,10).map(function(x){return '<div class="muted">'+esc(x.date)+' · '+esc(x.title)+' · '+(x.kind==='book'?'📚 결말 '+(x.who||'')+(x.ok?' ✅':''):(x.ok?'✅ '+x.score+'점':'❌'))+'</div>';}).join('')+'</div>';
  $('main').innerHTML=h;
  document.querySelectorAll('[data-play]').forEach(function(b){b.onclick=function(){play(b.getAttribute('data-play'));};});
  document.querySelectorAll('[data-drop]').forEach(function(b){b.onclick=function(){if(!b.getAttribute('data-sure')){b.setAttribute('data-sure','1');b.textContent='정말 지우기';return;}drop(b.getAttribute('data-drop'));};});
  document.querySelectorAll('[data-g]').forEach(function(b){b.onclick=function(){ls('air-genre',b.getAttribute('data-g'));home();};});
  document.querySelectorAll('[data-k]').forEach(function(b){b.onclick=function(){ls('air-kind',b.getAttribute('data-k'));home();};});
  $('mk').onclick=make;
  S.cases.forEach(function(c){if(c.left)fillCase(c);});
}
var MKT=null;
function make(){var b=$('mk');b.disabled=true;var t0=Date.now();b.textContent='✍️ 사건 뼈대 쓰는 중… 0초';clearInterval(MKT);MKT=setInterval(function(){var e=$('mk');if(e)e.textContent='✍️ 사건 뼈대 쓰는 중… '+Math.round((Date.now()-t0)/1000)+'초 (보통 30~60초)';},1000);
  var go=function(gps){api('/air/new',{genre:ls('air-genre')||'classic',kind:ls('air-kind')||'case',gps:gps||''}).then(function(j){clearInterval(MKT);var sec=Math.round((Date.now()-t0)/1000);
    if(!j.ok){toast((j.detail||j.error)+' ('+sec+'초 만에)');
      // 연결이 끊겼어도 서버는 끝냈을 수 있음 → 잠시 뒤 목록 다시 확인
      if(j.error==='network')setTimeout(function(){api('/air/state').then(function(k){if(k.ok){S=k;ls('air-cases',S);home();if(S.cases.length)toast('서버에는 사건이 만들어져 있었어요.');}});},4000);else home();return;}
    S=j;ls('air-cases',S);home();toast('뼈대가 왔어요('+sec+'초). 본문·심문 대본을 이어서 쓰고(1~2분), 그림은 그 뒤 2~3분 더.');});};
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
function prefetch(){var us=[];S.cases.forEach(function(c){Object.keys(c.imgs||{}).forEach(function(k){us.push(c.imgs[k]);});(c.suspects||[]).forEach(function(s){s.rounds.forEach(function(r){r.forEach(function(o){if(o.say)us.push(o.say);});});});});
  (function next(i){if(i>=us.length)return;var u=us[i];if(PF[u])return next(i+1);fetch(u).then(function(r){PF[u]=r.ok;}).catch(function(){}).then(function(){next(i+1);});})(0);}
function syncPending(){var q=ls('air-done')||[];if(!q.length)return;(function next(){var x=q.shift();if(!x){ls('air-done',[]);return;}api('/air/done',x).then(function(j){if(j.ok){S=j;ls('air-cases',S);}ls('air-done',q);next();});})();}
// ---------- 플레이 ----------
function play(id){CUR=S.cases.find(function(c){return c.id===id;});if(!CUR)return;if(CUR.kind==='book')return playBook();P=ls('air-play:'+id)||{started:true,score:100,found:[],asked:{},searched:[],hints:0,done:false};P.started=true;ls('air-play:'+id,P);TAB=P.done?'accuse':'case';
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
// ---------- 📚 게임북 ----------
var B=null;
function playBook(){B=ls('air-play:'+CUR.id)||{started:true,at:'n1',path:['n1'],seen:[],tries:0,good:false};B.started=true;ls('air-play:'+CUR.id,B);
  $('ttl').textContent='📚 '+CUR.title;$('back').setAttribute('href','#');$('back').onclick=function(e){e.preventDefault();home();};drawBook();}
function saveBook(){ls('air-play:'+CUR.id,B);}
function drawBook(){
  var n=CUR.nodes[B.at]||CUR.nodes.n1;var pg=B.path.length;
  $('pts').innerHTML='<span class="score">'+pg+'쪽 · 결말 발견 '+B.seen.length+'/'+CUR.ends.length+'</span>';
  var im=(CUR.imgs||{})[n.id];
  var h='<div class="card" style="padding:0;overflow:hidden">'+(im?'<img class="scene" src="'+esc(im)+'" alt="" style="border-radius:0;margin:0;aspect-ratio:4/3">':'')+'<div style="padding:14px"><p class="story" style="margin:0">'+esc(n.text)+'</p></div></div>';
  if(n.end){var E={good:['✅ 진상에 도달했다','end'],half:['🟡 반쯤 맞았다','end'],bad:['❌ 추리 실패','end']}[n.end];
    h+='<div class="card end"><h2>'+E[0]+'</h2>'+(n.verdict?'<p>'+esc(n.verdict)+'</p>':'')+'<p class="muted">'+pg+'쪽 만에 결말 · 이 사건 결말 '+B.seen.length+'/'+CUR.ends.length+' 발견'+(B.tries?' · 다시 읽기 '+B.tries+'번':'')+'</p>'
      +(B.path.length>1?'<button class="big ghost" id="undo">⟲ 직전 선택으로 돌아가기</button>':'')+'<button class="big ghost" id="restart">처음부터</button><button class="big" id="homeBtn">목록으로</button></div>';}
  else h+='<div class="card"><div class="lbl">어떻게 할까?</div>'+n.choices.map(function(c,i){return '<button class="opt" data-go="'+esc(c.to)+'">'+(i+1)+'. '+esc(c.t)+'</button>';}).join('')+(B.path.length>1?'<p class="muted" style="margin:10px 0 0"><button class="chip" id="undo">⟲ 직전 선택 취소</button></p>':'')+'</div>';
  $('main').innerHTML=h;window.scrollTo(0,0);
  document.querySelectorAll('[data-go]').forEach(function(b){b.onclick=function(){var to=b.getAttribute('data-go');if(!CUR.nodes[to])return;B.at=to;B.path.push(to);var nn=CUR.nodes[to];if(nn.end){if(B.seen.indexOf(to)<0)B.seen.push(to);if(nn.end==='good'&&!B.good){B.good=true;var q=ls('air-done')||[];q.push({id:CUR.id,ok:true,who:'good',score:Math.max(40,100-B.tries*15),keep:true});ls('air-done',q);}}saveBook();drawBook();};});
  var u=$('undo');if(u)u.onclick=function(){if(B.path.length<2)return;B.path.pop();B.at=B.path[B.path.length-1];B.tries++;saveBook();drawBook();};
  var r=$('restart');if(r)r.onclick=function(){B.at='n1';B.path=['n1'];B.tries++;saveBook();drawBook();};
  var hm=$('homeBtn');if(hm)hm.onclick=function(){if(navigator.onLine){syncPending();load();}else home();};
}

function say(u){if(!u)return;try{if(AU)AU.pause();AU=new Audio(u);var p=AU.play();if(p&&p.catch)p.catch(function(){});}catch(e){}}
window.addEventListener('online',function(){if(!CUR)load();});
load();
</script></body></html>`;
