// =========================================================
// 🎬 숏츠 공방 — 광저우 생활 유튜브 숏츠를 AI 로 만들고 자동 업로드 (주인 전용)
//  GET  /shorts                          화면
//  POST /shorts/ideas  {code}            千问(인터넷 검색)이 주제 5개 추천 — 주말 탐험 기록도 참고
//  POST /shorts/script {code,topic,sec}  千问 대본 {title,description,tags,scenes[{cap,say,img,move}]}
//  POST /shorts/list · /shorts/load {code,id}                 초안 목록 · 초안+만들어 둔 소재
//  POST /shorts/asset  {code,id,n,kind:img|vid|say,text}      img=通义万相 문생도(비동기) · vid=사진→영상(비동기) · say=qwen3-tts 한국어(즉시)
//  POST /shorts/poll   {code,id,n,kind,task}                  완료되면 R2 shorts/<코드해시>/<id>/<n>.jpg|mp4 로 옮김
//  POST /shorts/save?id  (헤더 x-code, 본문=완성 영상)         R2 shorts/<코드해시>/<id>/final.mp4
//  GET  /shorts/file?k&s                 R2 파일(서명, Range 지원 — iOS 동영상 재생에 필요)
//  POST /shorts/yt/start · GET /shorts/yt/cb · POST /shorts/yt/status · POST /shorts/yt/upload   유튜브 연결·업로드
// 비용 상한: 하루 그림 SHORTS_IMG_DAY(기본 40장) · 영상 클립 SHORTS_VID_DAY(기본 6개) — KV shorts:cost:<날짜>
// 시크릿(유튜브만): YT_CLIENT_ID, YT_CLIENT_SECRET — 리프레시 토큰은 연결 때 KV yt:<코드해시> 에 저장
// [필수] AI 는 百炼만 — Anthropic 호출 없음
// =========================================================

const cnDay = (t = Date.now()) => new Date(t + 8 * 3600e3).toISOString().slice(0, 10);
const host = (env) => (env.DASHSCOPE_WS_HOST || "dashscope.aliyuncs.com").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
const serr = (message, status = 400, code = "shorts") => Object.assign(new Error(message), { code, status });
const ORIGIN = "https://voice.zhnote.net";

async function hmac16(env, s) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode("shorts|" + (env.ALLOWED_CODES || "") + (env.DASHSCOPE_API_KEY || "")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(s));
  return [...new Uint8Array(sig)].slice(0, 8).map((x) => x.toString(16).padStart(2, "0")).join("");
}
const fileUrl = async (env, k) => "/shorts/file?k=" + encodeURIComponent(k) + "&s=" + (await hmac16(env, k));

// 주인 확인 — 사용량판과 같은 주인(처음 연 초대 코드)
async function owner(env, h) {
  let o = await env.KV.get("usage:owner");
  if (!o) { await env.KV.put("usage:owner", h); o = h; }
  if (o !== h) throw serr("숏츠 공방은 주인만 쓸 수 있어요.", 403, "not_owner");
}

async function dsPost(env, path, body, async_) {
  const r = await fetch("https://" + host(env) + "/api/v1" + path, {
    method: "POST",
    headers: { authorization: "Bearer " + env.DASHSCOPE_API_KEY, "content-type": "application/json", ...(async_ ? { "X-DashScope-Async": "enable" } : {}) },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  let j = {};
  try { j = JSON.parse(t); } catch {}
  if (!r.ok) throw serr("百炼 " + r.status + ": " + (j.message || j.code || t.slice(0, 160)), 502);
  return j;
}
async function qwen(env, messages, opt = {}) {
  const body = { model: opt.model || env.SHORTS_MODEL || "qwen3.8-flash", messages, temperature: 0.85, response_format: { type: "json_object" }, enable_thinking: false };
  if (opt.search) body.enable_search = true;
  // 百炼 쪽 일시 오류(5xx·520·429·연결 끊김)는 잠깐 쉬고 두 번까지 다시 시도
  const call = async () => {
    for (let k = 0; ; k++) {
      let r = null;
      try { r = await fetch("https://" + host(env) + "/compatible-mode/v1/chat/completions", { method: "POST", headers: { authorization: "Bearer " + env.DASHSCOPE_API_KEY, "content-type": "application/json" }, body: JSON.stringify(body) }); } catch (e) { if (k >= 2) throw serr("千问 연결 실패: " + (e.message || e), 502); }
      if (r && (r.ok || (r.status < 500 && r.status !== 429) || k >= 2)) return r;
      await new Promise((ok) => setTimeout(ok, 1500 * (k + 1)));
    }
  };
  let r = await call();
  if (!r.ok && opt.search) { delete body.enable_search; r = await call(); }
  if (!r.ok && r.status === 400) { delete body.response_format; delete body.enable_thinking; r = await call(); }
  const t = await r.text();
  let j = {};
  try { j = JSON.parse(t); } catch {}
  if (!r.ok) throw serr(r.status >= 500 ? "千问 서버가 잠시 불안정해요(" + r.status + "). 1~2분 뒤 다시 눌러 주세요." : "千问 " + r.status + ": " + ((j.error && j.error.message) || t.slice(0, 160)), 502);
  const c = String((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "").replace(/^```(?:json)?\s*|\s*```$/g, "");
  try { return JSON.parse(c); } catch {}
  const a = c.indexOf("{"), z = c.lastIndexOf("}");
  if (a >= 0 && z > a) try { return JSON.parse(c.slice(a, z + 1)); } catch {}
  throw serr("千问 응답을 읽지 못했어요. 다시 눌러 주세요.", 502);
}

async function costDay(env) { return (await env.KV.get("shorts:cost:" + cnDay(), "json")) || { img: 0, vid: 0, tts: 0 }; }
async function addCost(env, k, n) { const c = await costDay(env); c[k] = (c[k] || 0) + n; await env.KV.put("shorts:cost:" + cnDay(), JSON.stringify(c), { expirationTtl: 40 * 86400 }); return c; }

const listKey = (h) => "shorts:" + h;
const draftKey = (h, id) => "shorts:" + h + ":" + id;

export async function shortsApi(env, ctx, path, b, h, synth) {
  await owner(env, h);
  if (path === "/shorts/list") {
    const l = (await env.KV.get(listKey(h), "json")) || [];
    return { ok: true, list: l, cost: await costDay(env), caps: caps(env), yt: !!(await env.KV.get("yt:" + h)), ytConfig: !!(env.YT_CLIENT_ID && env.YT_CLIENT_SECRET) };
  }
  if (path === "/shorts/ideas") return ideas(env, h, b);
  if (path === "/shorts/script") return script(env, b, h);
  if (path === "/shorts/load") return load(env, b, h);
  if (path === "/shorts/plan") return plan(env, b, h);
  if (path === "/shorts/asr") return asr(env, b, h);
  if (path === "/shorts/update") return update(env, b, h);
  if (path === "/shorts/asset") return asset(env, b, h, synth);
  if (path === "/shorts/poll") return poll(env, b, h);
  if (path === "/shorts/yt/start") return ytStart(env, h);
  if (path === "/shorts/yt/status") return ytStatus(env, h);
  if (path === "/shorts/yt/stats") return ytStats(env, h, b);
  if (path === "/shorts/yt/upload") return ytUpload(env, b, h);
  throw serr("not_found", 404);
}
const caps = (env) => ({ img: Number(env.SHORTS_IMG_DAY) || 40, vid: Number(env.SHORTS_VID_DAY) || 6 });

// 한국 시청자 각도 — 중국 문화 해설이 아니라 "한국인한테 왜 쓸모있나/재밌나"
const ANGLES = {
  mix: { label: "골고루", d: "아래 각도를 골고루 섞어서" },
  compare: { label: "한국이랑 비교", d: "한국과 비교되는 점(가격·서비스·생활방식·같은 메뉴 다른 맛)이 핵심이 되게" },
  price: { label: "원화로 얼마?", d: "물가·가성비를 원화로 환산해 보여주는 것이 핵심이 되게(한국 가격과 나란히)" },
  tip: { label: "여행 꿀팁", d: "광저우에 올 한국인(무비자 여행객·출장자)이 바로 써먹을 실용 정보(결제·디디·앱·환전·주의할 점·동선)가 핵심이 되게" },
  shock: { label: "문화 충격", d: "한국인이 보면 '이게 된다고?' 하고 놀랄 장면·서비스·습관이 핵심이 되게" },
  food: { label: "한국인 입맛 맛집", d: "한국인 입맛에 맞는 메뉴, 실패 없는 주문법, 한국 음식의 현지 버전이 핵심이 되게" },
  life: { label: "주재원 현실", d: "광저우에 사는 한국 직장인 부부의 현실 생활(장보기·집·병원·주말)이 핵심이 되게. 회사 이름·업무 내용은 넣지 말 것" },
};
async function krw(env) {
  try { const j = await (await fetch("https://api.frankfurter.app/latest?from=CNY&to=KRW")).json(); return Math.round(j.rates.KRW); } catch { return 0; }
}
const KR_RULES = "시청자는 한국에 사는 한국인이다. 중국 문화·역사 해설이나 '중국은 이렇다' 식 강의, 중국어 표현 소개 위주 내용은 피한다. " +
  "매 이야기는 '한국인인 나에게 왜 재밌거나 쓸모 있나'가 분명해야 한다: 한국과의 비교, 원화 환산 가격, 바로 써먹을 꿀팁, 놀라운 반전 중 하나 이상. " +
  "중국어 단어는 꼭 필요할 때만(메뉴 이름 등) 한두 개, 한글로 읽는 법을 붙인다. 정치·혐오·비하 표현 금지.";

async function ideas(env, h, b) {
  const q = (await env.KV.get("quest:" + h, "json")) || {};
  const been = (q.hist || []).slice(0, 15).map((x) => x.name + "(" + (x.area || "") + ")");
  const ang = ANGLES[b && b.angle] || ANGLES.mix;
  // 우리 채널에서 잘된 것·안 된 것(올린 지 하루 넘은 공개 영상, 하루당 조회수 기준)을 알려 주고 잘된 쪽 패턴을 따르게
  let perf = "";
  const st = await env.KV.get("yt:stats:" + h, "json");
  if (st && st.items) {
    const pub = st.items.filter((x) => x.privacy === "public" && Date.now() - x.at > 20 * 3600e3).map((x) => ({ t: x.title, d: x.views / Math.max(1, (Date.now() - x.at) / 86400e3) })).sort((a, c) => c.d - a.d);
    if (pub.length >= 3) perf = " 우리 채널 성적(하루당 조회수): 잘된 것 " + pub.slice(0, 3).map((x) => "'" + x.t + "' " + Math.round(x.d)).join(", ") + (pub.length >= 5 ? " / 안 된 것 " + pub.slice(-2).map((x) => "'" + x.t + "' " + Math.round(x.d)).join(", ") : "") + ". 잘된 쪽의 첫마디·주제 패턴을 따르고 안 된 쪽 패턴은 피하라.";
  }
  const out = await qwen(env, [
    { role: "system", content: "너는 한국 시청자용 유튜브 숏츠 채널 기획자다. 채널: 광저우에 사는 한국인 40대 직장인 부부가 주말에 돌아다니며 보여주는 광저우 생활. " + KR_RULES +
      " 인터넷 검색으로 요즘 한국 뉴스·커뮤니티에서 중국·광저우와 관련해 한국인이 궁금해하는 것(예: 중국 무비자 여행, 캔톤페어, 중국 쇼핑·물가, 결제·앱 사용, 한국 브랜드·한식의 중국 반응)을 참고해, " +
      ang.d + " 30~60초 숏츠 주제 5개를 제안하라. 제목은 한국 숏츠에서 잘 먹히는 말투(숫자·반전·질문)로, 과장 낚시는 금지." +
      ' JSON만 출력: {"ideas":[{"topic":"한국어 주제","hook":"첫 2초에 할 한국어 한마디","why":"한국인이 왜 볼지 한 문장"}]}' },
    { role: "user", content: "오늘: " + cnDay() + ". 최근 우리가 가 본 곳: " + (been.join(", ") || "(아직 없음)") + ". 1위안 ≈ " + ((await krw(env)) || 190) + "원." + perf },
  ], { search: true });
  return { ok: true, ideas: (Array.isArray(out.ideas) ? out.ideas : []).slice(0, 6).map((x) => ({ topic: String(x.topic || "").slice(0, 80), hook: String(x.hook || "").slice(0, 80), why: String(x.why || "").slice(0, 120) })) };
}

async function script(env, b, h) {
  const topic = String(b.topic || "").trim().slice(0, 200);
  if (!topic) throw serr("주제를 적어 주세요.");
  const sec = [30, 45, 60].includes(Number(b.sec)) ? Number(b.sec) : 45;
  const nScenes = sec === 30 ? 5 : sec === 45 ? 7 : 9;
  const ang = ANGLES[b.angle] || ANGLES.mix;
  const rate = (await krw(env)) || 190;
  const out = await qwen(env, [
    { role: "system", content: "너는 한국어 유튜브 숏츠 작가 겸 콘티 작가다. 채널: 광저우에 사는 한국인 직장인 부부의 광저우 생활. 약 " + sec + "초, 장면 " + nScenes + "개 세로 영상 대본을 쓴다. " + KR_RULES + " 이번 영상은 " + ang.d + ". " +
      "가격이 나오면 위안과 원화를 같이 말한다(1위안 ≈ " + rate + "원, 반올림해서 말하기 쉽게). 한국 가격과 비교할 수 있으면 비교한다. " +
      "규칙: 1번 장면이 바로 훅(반전·질문·숫자), 자기소개 금지. say 는 한국어 구어체 1~2문장, 읽으면 4~7초. cap 은 화면 큰 글씨, 한국어 12자 이내, 이모지 1개까지. " +
      "img 는 이미지 생성 모델에 줄 중국어 장면 묘사: 세로 구도, 실사 사진 느낌, 광저우의 실제 같은 디테일(빛·사람 동작·음식·거리), 화면에 글자·간판 글씨·워터마크·로고 금지, 유명인 금지. " +
      "move 는 중국어 카메라 움직임(예: \"镜头缓慢推进，热气升腾\"). 마지막 장면은 자연스럽게 구독·댓글 유도(질문형으로, 예: '여러분이라면 뭐 시키실래요?'). " +
      "title 은 한국어 40자 이내, 클릭하고 싶지만 과장 없이. description 한국어 2~3줄. tags 8개 이내(한국어 위주, # 없이)." +
      ' JSON만 출력: {"title":"","description":"","tags":[],"scenes":[{"cap":"","say":"","img":"","move":""}]}' },
    { role: "user", content: "주제: " + topic },
  ]);
  const scenes = (Array.isArray(out.scenes) ? out.scenes : []).slice(0, 10).map((s) => ({
    cap: String(s.cap || "").slice(0, 30), say: String(s.say || "").slice(0, 160), img: String(s.img || "").slice(0, 400), move: String(s.move || "").slice(0, 160),
  })).filter((s) => s.say || s.img);
  if (scenes.length < 3) throw serr("대본이 너무 짧게 나왔어요. 다시 눌러 주세요.", 502);
  const id = "s" + Date.now().toString(36);
  const d = { id, topic, sec, angle: b.angle || "mix", made: Date.now(), title: String(out.title || topic).slice(0, 90), description: String(out.description || "").slice(0, 900), tags: (Array.isArray(out.tags) ? out.tags : []).map((t) => String(t).replace(/^#/, "").slice(0, 30)).slice(0, 10), scenes };
  await env.KV.put(draftKey(h, id), JSON.stringify(d), { expirationTtl: 120 * 86400 });
  const l = (await env.KV.get(listKey(h), "json")) || [];
  l.unshift({ id, title: d.title, made: d.made });
  await env.KV.put(listKey(h), JSON.stringify(l.slice(0, 40)));
  return { ok: true, draft: d, files: {} };
}

// 시리즈: 같은 형식을 반복해 구독으로 잇는다. 제목 앞 번호는 KV 카운터(shorts:series:<해시>:<키>)
const SERIES = {
  price: { name: "광저우 물가 1분", rule: "이 영상은 '광저우 물가 1분' 시리즈다: 첫 구간 cap 은 대표 물건과 원화 가격으로 놀라게(예: '편의점 도시락 = 2,800원?!'), 가격표·메뉴판이 보이는 장면은 꼭 쓰고 그 구간 cap 에 '00위안 ≈ 0,000원'. 한국 가격과 비교 한 줄(모르면 '한국이면?' 질문). 실제로 먹거나 써 본 반응 구간 포함. 마지막 구간 say 는 '여러분 동네는 얼마예요?' 같은 댓글 질문. 제목에는 번호를 넣지 말 것(자동으로 붙음), 대신 가장 놀라운 가격을 넣는다. 태그에 광저우물가·중국물가 포함." },
};
// 🎥 편집실 — 내가 찍은 클립의 캡처(폰에서 뽑은 작은 JPEG)를 보고 구간·순서·자막·내레이션을 정한다. 원본 영상은 서버로 오지 않는다
async function plan(env, b, h) {
  const clips = (Array.isArray(b.clips) ? b.clips : []).slice(0, 20).map((c) => ({ dur: Math.max(0.5, Math.min(600, Number(c.dur) || 0)), name: String(c.name || "").slice(0, 60) }));
  if (!clips.length) throw serr("클립을 골라 주세요.");
  const frames = (Array.isArray(b.frames) ? b.frames : []).filter((f) => f && clips[f.c] && /^data:image\/jpeg;base64,/.test(f.img || "") && f.img.length < 120000).slice(0, 40);
  if (frames.length < 2) throw serr("장면 캡처를 만들지 못했어요. 다른 클립으로 해 보세요.");
  const sec = [15, 20, 30, 45, 60].includes(Number(b.sec)) ? Number(b.sec) : 45;
  const ser = SERIES[b.series] || null;
  const ang = ANGLES[b.angle] || ANGLES.mix;
  const topic = String(b.topic || "").slice(0, 200);
  const rate = (await krw(env)) || 190;
  const content = [];
  for (const f of frames) { content.push({ type: "text", text: "[클립 " + (f.c + 1) + " · " + Number(f.t).toFixed(1) + "초]" }); content.push({ type: "image_url", image_url: { url: f.img } }); }
  content.push({ type: "text", text: "위는 내가 광저우에서 직접 찍은 영상 클립들의 장면 캡처다(클립 번호·시각 표시). 클립 길이: " + clips.map((c, i) => "클립 " + (i + 1) + "=" + c.dur.toFixed(1) + "초").join(", ") + ". " +
    (topic ? "내가 적은 설명: " + topic + ". " : "") +
    "이걸로 약 " + sec + "초짜리 한국어 유튜브 숏츠 편집 계획을 짜라. " + (ser ? ser.rule + " " : "") + KR_RULES + " 이번 영상은 " + ang.d + ". 가격이 보이거나 언급되면 위안과 원화(1위안≈" + rate + "원)를 같이. " +
    "규칙: 첫 구간은 가장 눈길 끄는 장면(훅). 구간은 2.5~6초로 너무 잘게 자르지 말고(첫 구간만 1.5초도 됨), 움직임이 이어지는 장면은 한 구간으로 길게, start/end 는 그 클립 길이 안에서 캡처를 근거로 고르고, 흔들리거나 의미 없는 부분은 피한다. 같은 순간을 두 번 쓰지 않는다. 구간 합계가 약 " + sec + "초 — 단 클립이 모자라면 반복하지 말고 더 짧게 끝낸다. " +
    "cap 은 화면 큰 글씨(한국어 12자 이내, 이모지 1개까지, 필요 없으면 빈칸). say 는 그 구간에 깔 한국어 내레이션 — 구간 길이 1초당 4글자 이내로 짧게, 화면만으로 충분하면 빈칸. 사진에 없는 사실을 지어내지 말 것(모르면 느낌·질문으로). 마지막 구간은 댓글 유도 질문. " +
    'title(한국어 40자 이내), description(2~3줄), tags(8개 이내, # 없이). JSON만 출력: {"title":"","description":"","tags":[],"segments":[{"clip":1,"start":0,"end":3,"cap":"","say":""}]}' });
  const out = await qwen(env, [{ role: "user", content }], { model: env.SHORTS_VL_MODEL || "qwen3-vl-plus" });
  let segs = (Array.isArray(out.segments) ? out.segments : []).map((x) => {
    const c = Math.round(Number(x.clip)) - 1;
    if (!clips[c]) return null;
    let st = Math.max(0, Number(x.start) || 0), en = Number(x.end) || st + 3;
    st = Math.min(st, Math.max(0, clips[c].dur - 0.5)); en = Math.min(Math.max(en, st + 1), clips[c].dur);
    if (en - st < 0.5) return null;
    return { clip: c, s: +st.toFixed(2), e: +en.toFixed(2), cap: String(x.cap || "").slice(0, 30), say: String(x.say || "").slice(0, 160), img: "", move: "" };
  }).filter(Boolean).slice(0, 15);
  if (!segs.length) segs = clips.slice(0, 8).map((c, i) => ({ clip: i, s: 0, e: Math.min(c.dur, 4), cap: "", say: "", img: "", move: "" }));
  const id = "s" + Date.now().toString(36);
  let title = String(out.title || topic || "광저우 둘이서");
  if (ser) { const ck = "shorts:series:" + h + ":" + b.series, n = (Number(await env.KV.get(ck)) || 0) + 1; await env.KV.put(ck, String(n)); title = "[" + ser.name + " #" + n + "] " + title.replace(/^\[[^\]]*\]\s*/, ""); }
  const d = { id, kind: "mine", series: ser ? b.series : "", topic: topic || "내 영상", sec, angle: b.angle || "mix", made: Date.now(), title: title.slice(0, 90), description: String(out.description || "").slice(0, 900),
    tags: (Array.isArray(out.tags) ? out.tags : []).map((t) => String(t).replace(/^#/, "").slice(0, 30)).slice(0, 10), clips, scenes: segs, opts: { fit: "crop", orig: 0.3, narr: true, subs: true } };
  await env.KV.put(draftKey(h, id), JSON.stringify(d), { expirationTtl: 120 * 86400 });
  const l = (await env.KV.get(listKey(h), "json")) || [];
  l.unshift({ id, title: d.title, made: d.made, kind: "mine", series: d.series });
  await env.KV.put(listKey(h), JSON.stringify(l.slice(0, 40)));
  return { ok: true, draft: d, files: {} };
}

async function load(env, b, h) {
  const id = String(b.id || "");
  const d = await env.KV.get(draftKey(h, id), "json");
  if (!d) throw serr("초안을 찾지 못했어요.", 404);
  return { ok: true, draft: d, files: await files(env, h, id) };
}
async function files(env, h, id) {
  const pre = "shorts/" + h + "/" + id + "/", out = {};
  const r = await env.R2.list({ prefix: pre, limit: 100 });
  for (const o of r.objects) out[o.key.slice(pre.length)] = await fileUrl(env, o.key);
  return out;
}
async function update(env, b, h) {
  const id = String(b.id || "");
  const d = await env.KV.get(draftKey(h, id), "json");
  if (!d) throw serr("초안을 찾지 못했어요.", 404);
  const u = b.draft || {};
  if (u.title) d.title = String(u.title).slice(0, 90);
  if (typeof u.description === "string") d.description = u.description.slice(0, 900);
  if (Array.isArray(u.tags)) d.tags = u.tags.map((t) => String(t).slice(0, 30)).slice(0, 10);
  if (Array.isArray(u.scenes)) d.scenes = u.scenes.slice(0, 15).map((s, i) => {
    const o = { ...(d.scenes[i] || {}), cap: String(s.cap || "").slice(0, 30), say: String(s.say || "").slice(0, 160), img: String(s.img || "").slice(0, 400), move: String(s.move || "").slice(0, 160) };
    if (d.kind === "mine") { o.clip = Math.max(0, Math.min(19, Math.round(Number(s.clip) || 0))); o.s = Math.max(0, Number(s.s) || 0); o.e = Math.max(o.s + 0.3, Number(s.e) || o.s + 2); o.sp = [0.5, 1, 1.5, 2].includes(Number(s.sp)) ? Number(s.sp) : 1; }
    return o;
  });
  if (d.kind === "mine" && u.asr && typeof u.asr === "object" && Array.isArray(d.clips)) for (const k of Object.keys(u.asr)) { const c = d.clips[Number(k)]; if (c && Array.isArray(u.asr[k])) c.asr = cleanAsr(u.asr[k]); }
  if (u.opts && typeof u.opts === "object") d.opts = { fit: u.opts.fit === "full" ? "full" : "crop", orig: [0, 0.3, 1].includes(Number(u.opts.orig)) ? Number(u.opts.orig) : 0.3, narr: u.opts.narr !== false, subs: u.opts.subs !== false, voice: ["Cherry", "Ethan", "mine", "rec"].includes(u.opts.voice) ? u.opts.voice : "Cherry", end: u.opts.end !== false, tag: typeof u.opts.tag === "string" ? u.opts.tag.slice(0, 20) : "📍 광저우 广州", bgv: [0, 0.07, 0.12, 0.22].includes(Number(u.opts.bgv)) ? Number(u.opts.bgv) : 0.12 };
  if (b.yt) d.yt = b.yt;
  await env.KV.put(draftKey(h, id), JSON.stringify(d), { expirationTtl: 120 * 86400 });
  if (u.title || b.yt) {
    const l = (await env.KV.get(listKey(h), "json")) || [];
    const x = l.find((y) => y.id === id);
    if (x) { if (u.title) x.title = d.title; if (b.yt) x.yt = b.yt; await env.KV.put(listKey(h), JSON.stringify(l)); }
  }
  return { ok: true, draft: d };
}

function b64(u8) { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }

async function asset(env, b, h, synth) {
  const id = String(b.id || ""), n = Number(b.n), kind = b.kind;
  if (!/^s[0-9a-z]{6,12}$/.test(id) || !Number.isInteger(n) || n < 0 || n > 14) throw serr("bad asset");
  const pre = "shorts/" + h + "/" + id + "/" + n;
  if (kind === "img") {
    const c = await costDay(env);
    if (c.img >= caps(env).img) throw serr("오늘 그림 한도(" + caps(env).img + "장)를 다 썼어요.", 429);
    const prompt = String(b.text || "").slice(0, 500);
    if (!prompt) throw serr("그림 설명이 비었어요.");
    const j = await dsPost(env, "/services/aigc/text2image/image-synthesis", {
      model: env.SHORTS_T2I_MODEL || "wan2.5-t2i-preview",
      input: { prompt: prompt + "，竖构图，电影感写实摄影，自然光，细节丰富", negative_prompt: "文字，字幕，水印，logo，招牌文字，低质量，畸形的手" },
      parameters: { size: "720*1280", n: 1, prompt_extend: true, watermark: false },
    }, true);
    await addCost(env, "img", 1);
    return { ok: true, task: j.output && j.output.task_id };
  }
  if (kind === "vid") {
    const c = await costDay(env);
    if (c.vid >= caps(env).vid) throw serr("오늘 영상 클립 한도(" + caps(env).vid + "개)를 다 썼어요.", 429);
    const img = await env.R2.get(pre + ".jpg");
    if (!img) throw serr("먼저 그림을 만들어 주세요.");
    const u8 = new Uint8Array(await img.arrayBuffer());
    const model = env.SHORTS_I2V_MODEL || "wan2.5-i2v-preview";
    const j = await dsPost(env, "/services/aigc/video-generation/video-synthesis", {
      model, input: { prompt: String(b.text || "镜头缓慢推进").slice(0, 300) + "，画面稳定自然，没有文字", img_url: "data:image/jpeg;base64," + b64(u8) },
      parameters: { resolution: env.SHORTS_I2V_RES || "480P", duration: Number(env.SHORTS_I2V_SEC) || 5, prompt_extend: true, watermark: false },
    }, true);
    await addCost(env, "vid", 1);
    return { ok: true, task: j.output && j.output.task_id };
  }
  if (kind === "say") {
    const text = String(b.text || "").trim().slice(0, 200);
    if (!text) throw serr("내레이션이 비었어요.");
    let bytes = null, why = "", ext = "wav", ct = "audio/wav";
    const want = ["Cherry", "Ethan", "mine"].includes(b.voice) ? b.voice : (env.SHORTS_VOICE || "Cherry");
    // 내 목소리(CosyVoice 복제)를 고르면 먼저 시도, 안 되면 AI 성우로
    if (want === "mine") {
      const mine = await env.KV.get("voice:" + h);
      if (!mine) why = "내 목소리 미등록(실전 중국어 발음 탭에서 등록)";
      else try { bytes = await synth(env, mine, text); ext = "mp3"; ct = "audio/mpeg"; } catch (e) { why = "내 목소리: " + String(e.message || e).slice(0, 100); }
    }
    if (!bytes) try {
      const j = await dsPost(env, "/services/aigc/multimodal-generation/generation", { model: env.SHORTS_TTS_MODEL || "qwen3-tts-flash", input: { text, voice: want === "mine" ? "Cherry" : want, language_type: "Korean" } });
      const url = j.output && j.output.audio && j.output.audio.url;
      if (url) { const r = await fetch(url); if (r.ok) bytes = new Uint8Array(await r.arrayBuffer()); }
      if (!bytes) why += " / qwen-tts 결과 없음";
    } catch (e) { why += " / " + String(e.message || e).slice(0, 140); }
    if (!bytes && want !== "mine") {
      const mine = await env.KV.get("voice:" + h);
      if (mine) try { bytes = await synth(env, mine, text); ext = "mp3"; ct = "audio/mpeg"; } catch (e) { why += " / 내 목소리: " + String(e.message || e).slice(0, 100); }
    }
    if (!bytes) throw serr("내레이션을 만들지 못했어요: " + why, 502);
    await env.R2.delete([pre + ".wav", pre + ".mp3"]).catch(() => {});
    await env.R2.put(pre + "." + ext, bytes, { httpMetadata: { contentType: ct } });
    await addCost(env, "tts", text.length);
    return { ok: true, done: true, kind, url: await fileUrl(env, pre + "." + ext) };
  }
  throw serr("bad kind");
}

async function poll(env, b, h) {
  const id = String(b.id || ""), n = Number(b.n), kind = b.kind, task = String(b.task || "");
  if (!/^[\w-]{8,80}$/.test(task) || !/^s[0-9a-z]{6,12}$/.test(id)) throw serr("bad task");
  const r = await fetch("https://" + host(env) + "/api/v1/tasks/" + task, { headers: { authorization: "Bearer " + env.DASHSCOPE_API_KEY } });
  const j = await r.json().catch(() => ({}));
  const st = (j.output && j.output.task_status) || "UNKNOWN";
  if (st === "FAILED" || st === "CANCELED" || st === "UNKNOWN" && !r.ok) return { ok: true, status: "failed", detail: (j.output && (j.output.message || j.output.code)) || st };
  if (st !== "SUCCEEDED") return { ok: true, status: st };
  const url = kind === "vid" ? j.output.video_url : ((j.output.results || []).find((x) => x && x.url) || {}).url;
  if (!url) return { ok: true, status: "failed", detail: "결과 주소 없음" };
  const f = await fetch(url);
  if (!f.ok) return { ok: true, status: "failed", detail: "결과 내려받기 실패 " + f.status };
  const key = "shorts/" + h + "/" + id + "/" + n + (kind === "vid" ? ".mp4" : ".jpg");
  await env.R2.put(key, await f.arrayBuffer(), { httpMetadata: { contentType: kind === "vid" ? "video/mp4" : (f.headers.get("content-type") || "image/png") } });
  return { ok: true, status: "done", url: await fileUrl(env, key) };
}

// 완성 영상 저장(본문 그대로)
export async function shortsSave(req, env, url, hashFn, allowed) {
  const code = req.headers.get("x-code") || "";
  if (!allowed(env, code)) return { error: "not_allowed", status: 403 };
  const h = await hashFn(code.trim());
  await owner(env, h);
  const id = url.searchParams.get("id") || "";
  if (!/^s[0-9a-z]{6,12}$/.test(id)) return { error: "bad id", status: 400 };
  const len = Number(req.headers.get("content-length") || 0);
  if (len > 150 * 1048576) return { error: "영상이 너무 커요(150MB 초과)", status: 413 };
  const ct = req.headers.get("content-type") || "video/mp4";
  const key = "shorts/" + h + "/" + id + "/final." + (ct.includes("webm") ? "webm" : "mp4");
  await env.R2.put(key, req.body, { httpMetadata: { contentType: ct } });
  return { ok: true, key, url: await fileUrl(env, key) };
}

// R2 파일 — Range 지원
export async function shortsFile(req, env, url) {
  const k = url.searchParams.get("k") || "";
  if (!/^shorts\/[0-9a-f]{12}\/s[0-9a-z]{6,12}\/[\w.]+$/.test(k) || url.searchParams.get("s") !== (await hmac16(env, k))) return new Response("forbidden", { status: 403 });
  const rg = req.headers.get("range");
  const m = rg && /^bytes=(\d+)-(\d*)$/.exec(rg);
  if (m) {
    const head = await env.R2.head(k);
    if (!head) return new Response("not found", { status: 404 });
    const start = Number(m[1]), end = m[2] ? Math.min(Number(m[2]), head.size - 1) : head.size - 1;
    if (start >= head.size) return new Response(null, { status: 416, headers: { "content-range": "bytes */" + head.size } });
    const o = await env.R2.get(k, { range: { offset: start, length: end - start + 1 } });
    return new Response(o.body, { status: 206, headers: { "content-type": head.httpMetadata?.contentType || "application/octet-stream", "content-range": "bytes " + start + "-" + end + "/" + head.size, "content-length": String(end - start + 1), "accept-ranges": "bytes", "cache-control": "private, max-age=86400" } });
  }
  const o = await env.R2.get(k);
  if (!o) return new Response("not found", { status: 404 });
  return new Response(o.body, { headers: { "content-type": o.httpMetadata?.contentType || "application/octet-stream", "content-length": String(o.size), "accept-ranges": "bytes", "cache-control": "private, max-age=86400" } });
}

// ---------------- 유튜브 ----------------
const YT_SCOPE = "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly";
function ytCfg(env) { if (!env.YT_CLIENT_ID || !env.YT_CLIENT_SECRET) throw serr("유튜브 연결 설정(YT_CLIENT_ID·YT_CLIENT_SECRET 시크릿)이 아직 없어요.", 400, "yt_config"); }
async function ytStart(env, h) {
  ytCfg(env);
  const state = crypto.randomUUID().replace(/-/g, "");
  await env.KV.put("ytstate:" + state, h, { expirationTtl: 900 });
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.search = new URLSearchParams({ client_id: env.YT_CLIENT_ID, redirect_uri: ORIGIN + "/shorts/yt/cb", response_type: "code", scope: YT_SCOPE, access_type: "offline", prompt: "consent", state }).toString();
  return { ok: true, url: u.toString() };
}
export async function ytCallback(env, url) {
  const page = (msg) => new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:16px -apple-system,sans-serif;padding:40px 20px;text-align:center;background:#EFE8DE;color:#1A2330">' + msg + '<p><a href="/shorts" style="color:#1664B0">숏츠 공방으로 돌아가기</a></p></body>', { headers: { "content-type": "text/html; charset=utf-8" } });
  const state = url.searchParams.get("state") || "", code = url.searchParams.get("code") || "";
  if (url.searchParams.get("error")) return page("연결을 취소했어요: " + url.searchParams.get("error").replace(/[<>&]/g, ""));
  const h = state && (await env.KV.get("ytstate:" + state));
  if (!h || !code) return page("연결 요청이 만료됐어요. 다시 시도해 주세요.");
  await env.KV.delete("ytstate:" + state);
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: env.YT_CLIENT_ID, client_secret: env.YT_CLIENT_SECRET, redirect_uri: ORIGIN + "/shorts/yt/cb", grant_type: "authorization_code" }) });
  const j = await r.json().catch(() => ({}));
  if (!j.refresh_token) return page("토큰을 받지 못했어요: " + String(j.error_description || j.error || r.status).replace(/[<>&]/g, ""));
  const ch = await ytChannel(j.access_token);
  await env.KV.put("yt:" + h, JSON.stringify({ refresh: j.refresh_token, channel: ch.title || "", chId: ch.id || "", scope: j.scope || "", at: Date.now() }));
  if (ch.title) return page("✅ 유튜브 채널 <b>" + ch.title.replace(/[<>&]/g, "") + "</b> 연결됐어요.");
  return page("⚠️ 로그인은 됐지만 채널을 찾지 못했어요.<br><small>" + ch.why.replace(/[<>&]/g, "") + "</small><br><br>로그인할 때 <b>채널 이름이 적힌 계정</b>을 고르고, 권한 체크박스를 <b>전부</b> 체크한 뒤 다시 연결해 주세요.");
}
async function ytChannel(token) {
  try {
    const r = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", { headers: { authorization: "Bearer " + token } });
    const c = await r.json().catch(() => ({}));
    if (!r.ok) return { why: "채널 조회 " + r.status + ": " + ((c.error && c.error.message) || "").slice(0, 160) };
    const it = c.items && c.items[0];
    if (!it) return { why: "이 구글 계정에는 유튜브 채널이 없어요(브랜드 계정 채널이면 로그인 때 그 계정을 골라야 해요)." };
    return { title: it.snippet.title, id: it.id };
  } catch (e) { return { why: String(e.message || e).slice(0, 160) }; }
}
async function ytToken(env, h) {
  ytCfg(env);
  const y = await env.KV.get("yt:" + h, "json");
  if (!y) throw serr("유튜브가 아직 연결되지 않았어요.", 400, "yt_login");
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: env.YT_CLIENT_ID, client_secret: env.YT_CLIENT_SECRET, refresh_token: y.refresh, grant_type: "refresh_token" }) });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) throw serr("유튜브 연결이 끊겼어요. 다시 연결해 주세요. (" + (j.error || r.status) + ")", 400, "yt_login");
  return { token: j.access_token, channel: y.channel };
}
// 📈 내 채널 성적: 올린 영상들의 조회·좋아요·댓글(YouTube Data API, 기존 youtube.readonly 권한). 10분 캐시 → 주제 추천에도 씀
function isoSec(d) { const m = String(d || "").match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0; }
async function ytStats(env, h, b) {
  const ck = "yt:stats:" + h;
  if (!(b && b.fresh)) { const c = await env.KV.get(ck, "json"); if (c && Date.now() - c.at < 10 * 60e3) return { ok: true, ...c, cached: true }; }
  const { token } = await ytToken(env, h);
  const H = { authorization: "Bearer " + token };
  const get = async (u) => { const r = await fetch("https://www.googleapis.com/youtube/v3/" + u, { headers: H }); const j = await r.json().catch(() => ({})); if (!r.ok) throw serr("유튜브 조회 " + r.status + ": " + ((j.error && j.error.message) || "").slice(0, 160) + (r.status === 403 ? " — 다시 연결해 권한을 모두 체크해 주세요." : ""), 502); return j; };
  const ch = await get("channels?part=contentDetails,statistics&mine=true");
  const it0 = ch.items && ch.items[0];
  if (!it0) throw serr("채널을 찾지 못했어요.", 404);
  const up = it0.contentDetails.relatedPlaylists.uploads;
  const pl = await get("playlistItems?part=contentDetails&maxResults=50&playlistId=" + encodeURIComponent(up));
  const ids = (pl.items || []).map((x) => x.contentDetails.videoId).filter(Boolean);
  let items = [];
  if (ids.length) {
    const v = await get("videos?part=snippet,statistics,contentDetails,status&id=" + ids.join(","));
    const l = (await env.KV.get(listKey(h), "json")) || [];
    const byVid = {}; for (const x of l) if (x.yt && x.yt.vid) byVid[x.yt.vid] = x;
    items = (v.items || []).map((x) => { const st = x.statistics || {}, m = byVid[x.id] || {}; return {
      id: x.id, title: x.snippet.title, at: Date.parse(x.snippet.publishedAt) || 0, views: +st.viewCount || 0, likes: +st.likeCount || 0, comments: +st.commentCount || 0,
      sec: isoSec(x.contentDetails && x.contentDetails.duration), privacy: (x.status && x.status.privacyStatus) || "", kind: m.id ? (m.kind || "ai") : "", series: m.series || "" }; });
  }
  const subs = +((it0.statistics || {}).subscriberCount) || 0;
  const out = { at: Date.now(), subs, items };
  await env.KV.put(ck, JSON.stringify(out), { expirationTtl: 30 * 86400 });
  return { ok: true, ...out };
}
async function ytStatus(env, h) {
  if (!env.YT_CLIENT_ID || !env.YT_CLIENT_SECRET) return { ok: true, config: false };
  const y = await env.KV.get("yt:" + h, "json");
  if (!y) return { ok: true, config: true, connected: false };
  if (y.channel) return { ok: true, config: true, connected: true, channel: y.channel };
  // 이름이 비어 있으면 지금 다시 확인
  try {
    const { token } = await ytToken(env, h);
    const ch = await ytChannel(token);
    if (ch.title) { y.channel = ch.title; y.chId = ch.id; await env.KV.put("yt:" + h, JSON.stringify(y)); return { ok: true, config: true, connected: true, channel: ch.title }; }
    return { ok: true, config: true, connected: true, channel: "", why: ch.why };
  } catch (e) { return { ok: true, config: true, connected: false, why: String(e.message || e) }; }
}
async function ytUpload(env, b, h) {
  const id = String(b.id || "");
  const d = await env.KV.get(draftKey(h, id), "json");
  if (!d) throw serr("초안을 찾지 못했어요.", 404);
  const pre = "shorts/" + h + "/" + id + "/final.";
  const obj = (await env.R2.head(pre + "mp4")) ? pre + "mp4" : (await env.R2.head(pre + "webm")) ? pre + "webm" : "";
  if (!obj) throw serr("먼저 영상을 저장해 주세요.");
  const { token } = await ytToken(env, h);
  const privacy = ["public", "unlisted", "private"].includes(b.privacy) ? b.privacy : "private";
  let title = String(b.title || d.title).slice(0, 95);
  if (!/#shorts/i.test(title)) title = title.slice(0, 92) + " #Shorts";
  const meta = {
    snippet: { title, description: String(b.description != null ? b.description : d.description).slice(0, 4800) + "\n\n#Shorts #광저우 #广州", tags: (b.tags || d.tags || []).slice(0, 15), categoryId: "19", defaultLanguage: "ko", defaultAudioLanguage: "ko" },
    status: { privacyStatus: privacy, selfDeclaredMadeForKids: false, containsSyntheticMedia: b.synthetic !== false },
  };
  const head = await env.R2.head(obj);
  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json; charset=UTF-8", "x-upload-content-type": head.httpMetadata?.contentType || "video/mp4", "x-upload-content-length": String(head.size) },
    body: JSON.stringify(meta),
  });
  if (!init.ok) throw serr("유튜브 업로드 시작 실패 " + init.status + ": " + (await init.text()).slice(0, 200), 502);
  const loc = init.headers.get("location");
  const o = await env.R2.get(obj);
  const up = await fetch(loc, { method: "PUT", headers: { "content-type": head.httpMetadata?.contentType || "video/mp4", "content-length": String(head.size) }, body: o.body });
  const j = await up.json().catch(() => ({}));
  if (!up.ok || !j.id) throw serr("유튜브 업로드 실패 " + up.status + ": " + JSON.stringify(j).slice(0, 200), 502);
  const yt = { vid: j.id, url: "https://youtube.com/shorts/" + j.id, privacy, at: Date.now() };
  await update(env, { id, yt }, h);
  return { ok: true, yt };
}

// 구글 OAuth 브랜딩(앱 게시)에 필요한 공개 페이지 — 홈·개인정보처리방침·약관
const LEGAL = {
  "/about": ["숏츠 공방", "<p>숏츠 공방은 운영자 본인(박지훈)이 광저우 생활을 소개하는 유튜브 숏츠를 만들고 본인 채널에 올리기 위한 개인용 도구입니다.</p><p>AI(알리바바 百炼)로 대본·그림·내레이션을 만들고, 사용자가 직접 연결한 본인 유튜브 채널에만 영상을 업로드합니다. 외부 사용자에게 서비스를 제공하지 않습니다.</p><p><a href=\"/privacy\">개인정보처리방침</a> · <a href=\"/terms\">이용약관</a></p>"],
  "/privacy": ["개인정보처리방침", "<p>시행일: 2026년 10월 10일</p><h2>수집하는 정보</h2><p>유튜브 연결 시 Google OAuth 로 발급되는 리프레시 토큰과 채널 이름만 저장합니다. 이메일·연락처·시청 기록 등 다른 Google 사용자 데이터는 요청하거나 저장하지 않습니다.</p><h2>이용 목적</h2><p>사용자가 직접 만든 숏츠 영상을 사용자 본인의 유튜브 채널에 업로드하고, 연결된 채널 이름을 화면에 표시하기 위해서만 사용합니다(YouTube Data API: youtube.upload, youtube.readonly).</p><h2>보관·삭제</h2><p>토큰은 Cloudflare 저장소에 암호화 전송으로 보관되며, 사용자가 연결 해제를 요청하거나 <a href=\"https://myaccount.google.com/permissions\">Google 계정 권한 페이지</a>에서 접근을 취소하면 더 이상 사용되지 않습니다. 제3자에게 제공·판매하지 않습니다.</p><h2>Google API 서비스 사용자 데이터 정책</h2><p>Google API 로부터 받은 정보의 사용 및 다른 앱으로의 전송은 제한적 사용 요구사항을 포함한 Google API 서비스 사용자 데이터 정책을 준수합니다. 본 서비스는 YouTube API 서비스를 사용하며, 이용자는 <a href=\"https://www.youtube.com/t/terms\">YouTube 서비스 약관</a>과 <a href=\"https://policies.google.com/privacy\">Google 개인정보처리방침</a>의 적용을 받습니다.</p><h2>문의</h2><p>운영자에게 연결된 유튜브 채널을 통해 문의할 수 있습니다.</p>"],
  "/terms": ["이용약관", "<p>시행일: 2026년 10월 10일</p><p>숏츠 공방은 운영자 개인용 도구이며 초대받은 본인만 사용할 수 있습니다. 업로드되는 영상의 내용과 저작권 책임은 업로드한 사용자에게 있습니다. 본 도구로 유튜브에 업로드하는 경우 <a href=\"https://www.youtube.com/t/terms\">YouTube 서비스 약관</a>이 함께 적용됩니다. 서비스는 사전 통지 없이 변경·중단될 수 있습니다.</p><p>문의는 운영자의 유튜브 채널로 해 주세요.</p>"],
};
export function legalPage(path) {
  const x = LEGAL[path];
  if (!x) return null;
  return new Response('<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + x[0] + '</title><style>body{margin:0;background:#EFE8DE;color:#1A2330;font:16px/1.65 -apple-system,"Apple SD Gothic Neo",sans-serif}main{max-width:680px;margin:0 auto;padding:32px 20px 60px}h1{font-size:24px;border-bottom:3px solid #D21624;padding-bottom:10px}h2{font-size:17px;margin-top:26px}a{color:#1664B0}</style></head><body><main><h1>' + x[0] + '</h1>' + x[1] + '</main></body></html>', { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600" } });
}

export const SHORTS_HTML = String.raw`<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#1664B0">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="숏츠 공방">
<link rel="apple-touch-icon" href="/icon-180.png">
<title>숏츠 공방</title>
<style>
:root{--sky:#1664B0;--bg:#EFE8DE;--card:#F7F2EA;--ink:#1A2330;--ink2:#5E6672;--line:#D9CEBD;--red:#D21624;--soft:#E6DCCB;--ok:#1F7A4D}
@media (prefers-color-scheme:dark){:root{--bg:#141A22;--card:#1C2430;--ink:#EDE6DA;--ink2:#9AA3AE;--line:#2C3644;--soft:#253041;--ok:#5CC08C}}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,"Apple SD Gothic Neo","PingFang SC",system-ui,sans-serif;-webkit-text-size-adjust:100%}
header{background:var(--sky);color:#fff;padding:calc(env(safe-area-inset-top) + 14px) 16px 14px;border-bottom:3px solid var(--red);display:flex;align-items:center;gap:12px}
header h1{margin:0;font-size:19px}a.back{color:#fff;text-decoration:none;font-size:20px}header .cost{margin-left:auto;font-size:11.5px;opacity:.85;text-align:right}
main{max-width:640px;margin:0 auto;padding:14px 16px 60px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:12px}
.card h2{margin:0 0 8px;font-size:15.5px}.lbl{font-size:12.5px;color:var(--ink2);margin:8px 0 4px}
input[type=text],textarea{width:100%;font:inherit;font-size:16px;padding:10px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink)}
textarea{min-height:64px;resize:vertical}
.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{border:1px solid var(--line);background:transparent;color:var(--ink);border-radius:999px;padding:6px 12px;font:inherit;font-size:13.5px}.chip.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.big{display:block;width:100%;border:0;border-radius:12px;background:var(--sky);color:#fff;font:inherit;font-weight:700;font-size:16px;padding:14px;margin-top:10px}.big:disabled{opacity:.5}
.big.ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}.big.red{background:var(--red)}
.idea{border-top:1px solid var(--line);padding:10px 0}.idea:first-child{border-top:0}.idea b{display:block}.idea small{color:var(--ink2)}.idea button{margin-top:6px}
.sc{display:grid;grid-template-columns:96px 1fr;gap:10px;border-top:1px solid var(--line);padding:12px 0}.sc:first-of-type{border-top:0}
.thumb{position:relative;width:96px;height:170px;border-radius:8px;background:var(--soft);overflow:hidden;display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--ink2);text-align:center}
.thumb img,.thumb video{width:100%;height:100%;object-fit:cover;display:block}
.thumb .st{position:absolute;left:0;right:0;bottom:0;background:rgba(26,35,48,.75);color:#fff;font-size:11px;padding:2px 4px;display:flex;justify-content:space-around}
.sc .n{font-weight:800;color:var(--sky);font-size:13px}.sc input,.sc textarea{font-size:14.5px;padding:7px 9px;margin-bottom:6px}
.sc details{font-size:13px;color:var(--ink2)}.sc details textarea{font-size:13px}
.mini{display:flex;gap:6px;flex-wrap:wrap}.mini button{border:1px solid var(--line);background:transparent;color:var(--ink);border-radius:8px;padding:6px 10px;font:inherit;font-size:12.5px}
.row{display:flex;gap:8px;align-items:center}.row label{font-size:14px}
.note{font-size:12.5px;color:var(--ink2);margin:6px 0 0}.err{color:var(--red);font-size:13.5px;margin-top:8px;white-space:pre-wrap}
.prog{font-size:14px;margin:8px 0}.bar{height:6px;background:var(--soft);border-radius:3px;overflow:hidden}.bar i{display:block;height:100%;background:var(--sky);width:0}
canvas.pv{width:60%;max-width:300px;display:block;margin:10px auto;border-radius:10px;background:#000}
video.out{width:70%;max-width:320px;display:block;margin:10px auto;border-radius:10px;background:#000}
.list a{display:flex;justify-content:space-between;gap:8px;padding:9px 0;border-top:1px solid var(--line);color:var(--ink);text-decoration:none}.list a:first-child{border-top:0}.list small{color:var(--ink2);white-space:nowrap}
.toast{position:fixed;left:50%;bottom:calc(20px + env(safe-area-inset-bottom));transform:translateX(-50%);background:var(--ink);color:var(--bg);padding:10px 16px;border-radius:999px;font-size:14px;z-index:9;max-width:90vw;text-align:center}
.gate{padding:40px 0;text-align:center}
.spin{display:inline-block;animation:sp 1.2s linear infinite}@keyframes sp{to{transform:rotate(360deg)}}
</style></head><body>
<header><a class="back" href="/" aria-label="박비서">‹</a><h1>🎬 숏츠 공방</h1><div class="cost" id="cost"></div></header>
<main id="main"><div class="gate">불러오는 중…</div></main>
<script>
var CODE='';try{CODE=localStorage.getItem('pb-code')||'';}catch(e){}
var L=null,D=null,F={},SEC=45,BUSY={},VIDON=false,ANG='mix';try{ANG=localStorage.getItem('sh-ang')||'mix';}catch(e){}
var ANGS=[['mix','골고루'],['compare','🇰🇷 한국이랑 비교'],['price','💰 원화로 얼마?'],['tip','✈️ 여행 꿀팁'],['shock','😮 문화 충격'],['food','🍜 한국인 입맛'],['life','🏠 주재원 현실']];
function $(i){return document.getElementById(i);}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function toast(t){var d=document.createElement('div');d.className='toast';d.textContent=t;document.body.appendChild(d);setTimeout(function(){d.remove();},3000);}
function api(p,b){b=b||{};b.code=CODE;return fetch(p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json().catch(function(){return {error:'서버 응답 오류 '+r.status};});});}
function gate(m){$('main').innerHTML='<div class="gate"><p>'+esc(m||'초대 코드를 넣어 주세요')+'</p><input type="text" id="cd" placeholder="초대 코드" style="max-width:220px"> <button class="chip on" id="go">열기</button></div>';$('go').onclick=function(){CODE=$('cd').value.trim();try{localStorage.setItem('pb-code',CODE);}catch(e){}home();};}
function costTxt(c,caps){if(!c)return '';return '오늘 그림 '+(c.img||0)+'/'+caps.img+' · 클립 '+(c.vid||0)+'/'+caps.vid+'<br>약 '+((c.img||0)*0.2+(c.vid||0)*3+(c.tts||0)/10000*0.8).toFixed(1)+'위안';}
function home(){
  if(!CODE)return gate();
  api('/shorts/list').then(function(j){
    if(j.error==='not_allowed')return gate('초대 코드가 맞지 않아요');if(j.error==='not_owner'){$('main').innerHTML='<div class="gate">주인만 쓸 수 있는 화면이에요.</div>';return;}
    if(!j.ok)return gate(j.detail||j.error);L=j;$('cost').innerHTML=costTxt(j.cost,j.caps);
    var h='<div class="card"><h2>새 숏츠</h2><p class="lbl">주제</p><input type="text" id="topic" placeholder="예: 광저우 아침 早茶, 한국인이 놀라는 3가지">'
      +'<p class="lbl">한국 시청자 각도</p><div class="chips">'+ANGS.map(function(a){return '<button class="chip'+(a[0]===ANG?' on':'')+'" data-ang="'+a[0]+'">'+a[1]+'</button>';}).join('')+'</div>'
      +'<div class="mini" style="margin-top:8px"><button id="ideaBtn">💡 주제 추천받기</button></div><div id="ideas"></div>'
      +'<p class="lbl">길이</p><div class="chips">'+[30,45,60].map(function(s){return '<button class="chip'+(s===SEC?' on':'')+'" data-sec="'+s+'">'+s+'초</button>';}).join('')+'</div>'
      +'<button class="big" id="scriptBtn">✍️ 대본 쓰기</button><div class="err" id="e1"></div></div>';
    h+='<div class="card" id="ytCard"><h2>유튜브 연결</h2><div id="ytBox" class="note">확인 중…</div></div>';
    if(j.yt)h+='<div class="card"><h2>📈 내 채널 성적 <button class="chip" id="stRe" style="float:right;font-size:12px;padding:3px 9px">새로고침</button></h2><div id="stBox" class="note">불러오는 중…</div></div>';
    h='<a class="big" href="/edit" style="text-align:center;text-decoration:none;background:var(--red);margin:0 0 12px">🎥 내가 찍은 영상으로 만들기 (편집실)</a>'+h;
    if(j.list&&j.list.length)h+='<div class="card"><h2>내 숏츠</h2><div class="list">'+j.list.map(function(x){return '<a href="'+(x.kind==='mine'?'/edit?id='+x.id:'#')+'"'+(x.kind==='mine'?'':' data-open="'+x.id+'"')+'>'+(x.kind==='mine'?'🎥 ':'')+'<span>'+esc(x.title)+'</span><small>'+(x.yt?'▶ '+(x.yt.privacy==='public'?'공개':x.yt.privacy==='unlisted'?'일부공개':'비공개'):new Date(x.made).toLocaleDateString('ko-KR',{month:'numeric',day:'numeric'}))+'</small></a>';}).join('')+'</div></div>';
    $('main').innerHTML=h;
    document.querySelectorAll('[data-ang]').forEach(function(b){b.onclick=function(){ANG=b.getAttribute('data-ang');try{localStorage.setItem('sh-ang',ANG);}catch(e){}document.querySelectorAll('[data-ang]').forEach(function(x){x.classList.toggle('on',x===b);});};});
    document.querySelectorAll('[data-sec]').forEach(function(b){b.onclick=function(){SEC=+b.getAttribute('data-sec');document.querySelectorAll('[data-sec]').forEach(function(x){x.classList.toggle('on',x===b);});};});
    document.querySelectorAll('[data-open]').forEach(function(a){a.onclick=function(e){e.preventDefault();openDraft(a.getAttribute('data-open'));};});
    $('ideaBtn').onclick=function(){var b=this;b.disabled=true;b.innerHTML='<span class="spin">💡</span> 요즘 한국에서 궁금해하는 광저우 찾는 중…';api('/shorts/ideas',{angle:ANG}).then(function(r){b.disabled=false;b.textContent='💡 다시 추천받기';if(!r.ok){$('e1').textContent=r.detail||r.error;return;}
      $('ideas').innerHTML=r.ideas.map(function(x,i){return '<div class="idea"><b>'+esc(x.topic)+'</b><small>“'+esc(x.hook)+'” · '+esc(x.why)+'</small><br><button class="chip" data-idea="'+i+'">이걸로</button></div>';}).join('');
      document.querySelectorAll('[data-idea]').forEach(function(c){c.onclick=function(){var x=r.ideas[+c.getAttribute('data-idea')];$('topic').value=x.topic+' — 첫마디: '+x.hook;$('topic').scrollIntoView({block:'center'});};});});};
    $('scriptBtn').onclick=function(){var t=$('topic').value.trim();if(!t){$('e1').textContent='주제를 적거나 추천에서 골라 주세요';return;}var b=this;b.disabled=true;b.innerHTML='<span class="spin">✍️</span> 대본 쓰는 중… (15초쯤)';
      api('/shorts/script',{topic:t,sec:SEC,angle:ANG}).then(function(r){b.disabled=false;b.textContent='✍️ 대본 쓰기';if(!r.ok){$('e1').textContent=r.detail||r.error;return;}D=r.draft;F=r.files||{};editor();});};
    ytBox();
    if(j.yt){stats(false);$('stRe').onclick=function(){stats(true);};}
  }).catch(function(){gate('서버에 연결하지 못했어요');});
}
function ago(t){var hh=(Date.now()-t)/3600e3;return hh<1?'방금':hh<48?Math.round(hh)+'시간 전':Math.round(hh/24)+'일 전';}
function stats(fresh){var b=$('stBox');if(!b)return;b.textContent='불러오는 중…';
  api('/shorts/yt/stats',{fresh:fresh}).then(function(r){if(!r.ok){b.textContent=r.detail||r.error;return;}
    var it=r.items.slice().sort(function(a,c){return c.at-a.at;});if(!it.length){b.textContent='아직 올린 영상이 없어요.';return;}
    var pub=it.filter(function(x){return x.privacy==='public';}),tv=pub.reduce(function(a,x){return a+x.views;},0);
    var best=pub.filter(function(x){return Date.now()-x.at>20*3600e3;}).map(function(x){return {x:x,d:x.views/Math.max(1,(Date.now()-x.at)/86400e3)};}).sort(function(a,c){return c.d-a.d;})[0];
    var h='<div style="display:flex;gap:14px;margin:2px 0 8px;font-size:14px;color:var(--ink)"><span>구독자 <b>'+r.subs+'</b></span><span>공개 '+pub.length+'편</span><span>총 조회 <b>'+tv+'</b></span></div>';
    if(best)h+='<p style="margin:0 0 8px;font-size:13.5px;color:var(--ink)">🏆 하루당 조회 1위: <b>'+esc(best.x.title)+'</b> ('+Math.round(best.d)+'회/일)</p>';
    h+=it.map(function(x){var hrs=Math.max(1,(Date.now()-x.at)/3600e3);return '<a href="https://youtube.com/shorts/'+esc(x.id)+'" target="_blank" style="display:block;padding:8px 0;border-top:1px solid var(--line);color:var(--ink);text-decoration:none">'
      +'<div style="font-size:14px;line-height:1.35">'+(x.kind==='mine'?'🎥 ':x.kind==='ai'?'🤖 ':'')+esc(x.title)+'</div>'
      +'<div style="font-size:12.5px;color:var(--ink2);margin-top:2px">▶ <b style="color:var(--ink)">'+x.views+'</b> · 👍 '+x.likes+' · 💬 '+x.comments+' · '+ago(x.at)+(x.privacy!=='public'?' · <span style="color:var(--red)">'+(x.privacy==='private'?'비공개':'일부공개')+'</span>':' · 시간당 '+(x.views/hrs).toFixed(1))+'</div></a>';}).join('');
    h+='<p class="note">🎥 편집실 · 🤖 AI 생성. 첫 화면에서 넘긴 비율·시청 비율은 유튜브 스튜디오 → 분석에서 봐요. 이 성적은 💡 주제 추천에 자동 반영돼요.</p>';
    b.innerHTML=h;});}
function ytBox(){
  api('/shorts/yt/status').then(function(y){var b=$('ytBox');if(!b)return;
    if(!y.config){b.innerHTML='아직 유튜브 앱 설정(시크릿 2개)이 없어요. 설정하면 여기서 바로 연결돼요.';return;}
    if(y.connected&&y.channel){b.innerHTML='✅ <b>'+esc(y.channel)+'</b> 연결됨 <button class="chip" id="ytRe" style="margin-left:6px">다시 연결</button>';}
    else if(y.connected){b.innerHTML='⚠️ 로그인은 됐지만 채널을 못 찾았어요.<br><small>'+esc(y.why||'')+'</small><button class="big" id="ytRe">▶ 다시 연결 (채널 계정 고르기·권한 전부 체크)</button>';}
    else b.innerHTML='<button class="big" id="ytRe">▶ 유튜브 채널 연결</button>';
    $('ytRe').onclick=function(){api('/shorts/yt/start').then(function(r){if(r.url)location.href=r.url;else toast(r.detail||r.error);});};
  });
}
function openDraft(id){api('/shorts/load',{id:id}).then(function(r){if(!r.ok)return toast(r.detail||r.error);D=r.draft;F=r.files||{};editor();});}
function sayKey(n){return F[n+'.wav']?n+'.wav':F[n+'.mp3']?n+'.mp3':'';}
function scHtml(s,i){
  var img=F[i+'.jpg'],vid=F[i+'.mp4'],sk=sayKey(i);
  return '<div class="sc" data-i="'+i+'"><div class="thumb" id="th'+i+'">'+(vid?'<video muted playsinline loop autoplay src="'+esc(vid)+'"></video>':img?'<img src="'+esc(img)+'" alt="">':'그림<br>아직')
    +'<div class="st"><span>'+(img?'🖼✓':'🖼')+'</span><span>'+(sk?'🔊✓':'🔊')+'</span><span>'+(vid?'🎞✓':'🎞')+'</span></div></div>'
    +'<div><div class="n">#'+(i+1)+(BUSY[i]?' <span class="spin">⏳</span> '+esc(BUSY[i]):'')+'</div>'
    +'<input type="text" data-f="cap" value="'+esc(s.cap)+'" placeholder="화면 큰 글씨">'
    +'<textarea data-f="say" placeholder="내레이션">'+esc(s.say)+'</textarea>'
    +'<details><summary>그림·움직임 설명</summary><textarea data-f="img">'+esc(s.img)+'</textarea><textarea data-f="move">'+esc(s.move)+'</textarea></details>'
    +'<div class="mini"><button data-a="img">🖼 그림 '+(img?'다시':'만들기')+'</button><button data-a="say">🔊 '+(sk?'다시 녹음':'목소리')+'</button>'+(sk?'<button data-a="play">▶ 듣기</button>':'')+'<button data-a="vid">🎞 클립'+(vid?' 다시':'')+'</button></div></div></div>';
}
function editor(){
  var h='<div class="card"><h2>대본</h2><p class="lbl">제목</p><input type="text" id="tt" value="'+esc(D.title)+'">'
   +'<p class="lbl">설명</p><textarea id="ds">'+esc(D.description)+'</textarea><p class="lbl">태그(쉼표)</p><input type="text" id="tg" value="'+esc((D.tags||[]).join(', '))+'"></div>';
  h+='<div class="card"><h2>장면 '+D.scenes.length+'개 <small style="font-weight:400;color:var(--ink2)">· '+esc(D.topic)+'</small></h2>'+D.scenes.map(scHtml).join('')+'</div>';
  h+='<div class="card"><h2>소재 한 번에 만들기</h2><div class="row"><input type="checkbox" id="vidOn"'+(VIDON?' checked':'')+'><label for="vidOn">AI 영상 클립도 (장면당 5초, 1개 약 3위안, 하루 '+(L?L.caps.vid:6)+'개까지)</label></div>'
   +'<p class="note">기본은 그림 + 켄 번스(천천히 확대) 움직임이에요. 클립을 켜면 그림이 실제로 움직이는 영상이 돼요.</p>'
   +'<button class="big" id="allBtn">⚡ 그림·목소리 전부 만들기</button><div class="prog" id="allProg"></div></div>';
  h+='<div class="card"><h2>영상 완성</h2><p class="note">720×1280 세로 영상을 이 화면에서 녹화해요. 길이만큼 걸리니 화면을 켜 두세요.</p><button class="big" id="renderBtn">🎬 영상 만들기</button><div id="out"></div></div>';
  h+='<button class="big ghost" id="backBtn">← 목록으로</button>';
  $('main').innerHTML=h;window.scrollTo(0,0);bindEditor();
}
function readForm(){
  D.title=$('tt').value.trim()||D.title;D.description=$('ds').value;D.tags=$('tg').value.split(/[,，]/).map(function(x){return x.trim();}).filter(Boolean);
  document.querySelectorAll('.sc').forEach(function(el){var i=+el.getAttribute('data-i');el.querySelectorAll('[data-f]').forEach(function(f){D.scenes[i][f.getAttribute('data-f')]=f.value;});});
}
var saveT=null;function saveSoon(){clearTimeout(saveT);saveT=setTimeout(function(){readForm();api('/shorts/update',{id:D.id,draft:D});},1200);}
function bindEditor(){
  document.querySelectorAll('#main input[type=text],#main textarea').forEach(function(x){x.oninput=saveSoon;});
  document.querySelectorAll('.sc [data-a]').forEach(function(b){b.onclick=function(){var i=+b.closest('.sc').getAttribute('data-i');var a=b.getAttribute('data-a');readForm();if(a==='play')return playSay(i);make(i,a).then(refreshSc);};});
  $('vidOn').onchange=function(){VIDON=this.checked;};
  $('allBtn').onclick=makeAll;$('renderBtn').onclick=render;$('backBtn').onclick=home;
}
function refreshSc(i){var el=document.querySelector('.sc[data-i="'+i+'"]');if(!el)return;readForm();var tmp=document.createElement('div');tmp.innerHTML=scHtml(D.scenes[i],i);el.replaceWith(tmp.firstChild);bindEditor();}
function playSay(i){var u=F[sayKey(i)];if(!u)return;try{var a=new Audio(u);a.play();}catch(e){}}
function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}
async function make(i,kind){
  var s=D.scenes[i];BUSY[i]=kind==='img'?'그림 그리는 중':kind==='vid'?'클립 만드는 중(1~3분)':'목소리 입히는 중';refreshSc(i);
  try{
    var r=await api('/shorts/asset',{id:D.id,n:i,kind:kind,text:kind==='img'?s.img:kind==='vid'?s.move:s.say});
    if(!r.ok)throw new Error(r.detail||r.error);
    if(r.done){delete F[i+'.wav'];delete F[i+'.mp3'];F[i+(r.url.indexOf('.mp3')>0?'.mp3':'.wav')]=r.url;}
    else{var t0=Date.now();while(true){await sleep(kind==='vid'?8000:4000);var p=await api('/shorts/poll',{id:D.id,n:i,kind:kind,task:r.task});
      if(p.status==='done'){F[i+(kind==='vid'?'.mp4':'.jpg')]=p.url;break;}if(p.status==='failed')throw new Error(p.detail||'실패');if(Date.now()-t0>600000)throw new Error('시간 초과');}}
    BUSY[i]='';return true;
  }catch(e){BUSY[i]='';toast('#'+(i+1)+' '+e.message);return false;}
}
async function makeAll(){
  readForm();api('/shorts/update',{id:D.id,draft:D});var b=$('allBtn'),pg=$('allProg');b.disabled=true;
  var jobs=[],n=D.scenes.length,done=0,total=0;
  function tick(){pg.textContent='진행 '+done+' / '+total;}
  D.scenes.forEach(function(s,i){
    if(!F[i+'.jpg']){total++;jobs.push(make(i,'img').then(function(ok){done++;tick();refreshSc(i);if(ok&&VIDON&&!F[i+'.mp4']){total++;tick();return make(i,'vid').then(function(){done++;tick();refreshSc(i);});}}));}
    else if(VIDON&&!F[i+'.mp4']){total++;jobs.push(make(i,'vid').then(function(){done++;tick();refreshSc(i);}));}
    if(!sayKey(i)){total++;jobs.push(make(i,'say').then(function(){done++;tick();refreshSc(i);}));}
  });
  tick();await Promise.all(jobs);b.disabled=false;pg.textContent=total?'✅ 다 만들었어요. 아래에서 영상 만들기!':'이미 다 있어요.';
  api('/shorts/list').then(function(j){if(j.ok)$('cost').innerHTML=costTxt(j.cost,j.caps);});
}
// ---------- 렌더링 ----------
function loadImg(u){return new Promise(function(ok){if(!u)return ok(null);var im=new Image();im.onload=function(){ok(im);};im.onerror=function(){ok(null);};im.src=u;});}
function loadVid(u){return new Promise(function(ok){if(!u)return ok(null);var v=document.createElement('video');v.muted=true;v.playsInline=true;v.setAttribute('playsinline','');v.loop=true;v.preload='auto';var done=false;v.oncanplaythrough=v.onloadeddata=function(){if(!done){done=true;ok(v);}};v.onerror=function(){if(!done){done=true;ok(null);}};v.src=u;v.load();setTimeout(function(){if(!done){done=true;ok(v.readyState>=2?v:null);}},15000);});}
function decode(ac,ab){return new Promise(function(ok,no){try{var p=ac.decodeAudioData(ab,ok,no);if(p&&p.then)p.then(ok,no);}catch(e){no(e);}});}
// 줄바꿈은 띄어쓰기 단위로(숫자·단어 중간에서 안 끊김: '2.5/6만원' 같은 오독 방지), 한 단어가 너무 길 때만 글자 단위
function wrap(g,t,max){t=String(t||'');var out=[],cur='';function fits(x){return g.measureText(x).width<=max;}
  t.split(/ +/).forEach(function(w){if(!w)return;var n=cur?cur+' '+w:w;if(fits(n)){cur=n;return;}if(cur)out.push(cur);cur='';
    if(fits(w)){cur=w;return;}for(var i=0;i<w.length;i++){var m=cur+w[i];if(!fits(m)&&cur){out.push(cur);cur=w[i];}else cur=m;}});
  if(cur)out.push(cur);return out;}
async function render(){
  readForm();api('/shorts/update',{id:D.id,draft:D});
  var out=$('out'),btn=$('renderBtn');btn.disabled=true;
  var Ctx=window.AudioContext||window.webkitAudioContext,ac=new Ctx();if(ac.resume)ac.resume();
  var lock=null;try{if(navigator.wakeLock)lock=await navigator.wakeLock.request('screen');}catch(e){}
  out.innerHTML='<p class="prog">소재 불러오는 중…</p>';
  var n=D.scenes.length,imgs=[],vids=[],aud=[];
  for(var i=0;i<n;i++){imgs[i]=await loadImg(F[i+'.jpg']);vids[i]=await loadVid(F[i+'.mp4']);var sk=sayKey(i);
    if(sk){try{aud[i]=await decode(ac,await (await fetch(F[sk])).arrayBuffer());}catch(e){aud[i]=null;}}}
  var W=720,H=1280,segs=[],t=0;
  for(var j=0;j<n;j++){var d=Math.max(2.4,(aud[j]?aud[j].duration:2.6)+0.35);segs.push({t0:t,t1:t+d,i:j});t+=d;}
  var total=Math.min(t+0.6,179);
  var cv=document.createElement('canvas');cv.width=W;cv.height=H;var g=cv.getContext('2d');
  if(!cv.captureStream||!window.MediaRecorder){out.innerHTML='<p class="err">이 브라우저는 영상 녹화를 못 해요(iOS 최신 Safari 필요).</p>';btn.disabled=false;return;}
  var vs=cv.captureStream(30),dest=ac.createMediaStreamDestination();
  var mime=['video/mp4;codecs=avc1','video/mp4','video/webm;codecs=vp9,opus','video/webm'].filter(function(m){return MediaRecorder.isTypeSupported&&MediaRecorder.isTypeSupported(m);})[0]||'';
  var rec=new MediaRecorder(new MediaStream(vs.getVideoTracks().concat(dest.stream.getAudioTracks())),mime?{mimeType:mime,videoBitsPerSecond:5000000}:{}),chunks=[];
  rec.ondataavailable=function(e){if(e.data&&e.data.size)chunks.push(e.data);};
  out.innerHTML='<p class="prog" id="rp">녹화 중… 화면을 켜 두세요</p><div class="bar"><i id="rb"></i></div>';out.appendChild(cv);cv.className='pv';
  var t0=ac.currentTime+0.3;
  segs.forEach(function(s){if(aud[s.i]){var b=ac.createBufferSource();b.buffer=aud[s.i];b.connect(dest);b.connect(ac.destination);b.start(t0+s.t0+0.15);}});
  function cover(src,sw,sh,z,dx,dy){var sc=Math.max(W/sw,H/sh)*z,w=sw*sc,h=sh*sc;g.drawImage(src,(W-w)/2+dx,(H-h)/2+dy,w,h);}
  function stroke(txt,x,y,font,fill,lw){g.font=font;g.textAlign='center';g.lineJoin='round';g.lineWidth=lw;g.strokeStyle='rgba(0,0,0,.85)';g.strokeText(txt,x,y);g.fillStyle=fill;g.fillText(txt,x,y);}
  var started={};
  function frame(tt){
    var s=segs.filter(function(x){return tt>=x.t0&&tt<x.t1;})[0]||segs[segs.length-1],p=(tt-s.t0)/(s.t1-s.t0);
    g.fillStyle='#000';g.fillRect(0,0,W,H);
    var v=vids[s.i],im=imgs[s.i];
    if(v){if(!started[s.i]){started[s.i]=1;try{v.currentTime=0;v.play();}catch(e){}}if(v.readyState>=2)cover(v,v.videoWidth,v.videoHeight,1.02,0,0);else if(im)cover(im,im.width,im.height,1+0.08*p,0,0);}
    else if(im){var dir=s.i%3;cover(im,im.width,im.height,1.04+0.10*p,dir===1?-20*p:dir===2?20*p:0,dir===0?-14*p:0);}
    // 장면 전환 페이드
    var fin=Math.min(1,(tt-s.t0)/0.25);if(fin<1){g.fillStyle='rgba(0,0,0,'+(1-fin)+')';g.fillRect(0,0,W,H);}
    // 위아래 그림자
    var gr=g.createLinearGradient(0,H*0.5,0,H);gr.addColorStop(0,'rgba(0,0,0,0)');gr.addColorStop(1,'rgba(0,0,0,.6)');g.fillStyle=gr;g.fillRect(0,H*0.5,W,H*0.5);
    var sc=D.scenes[s.i];
    if(sc.cap){var pop=Math.min(1,(tt-s.t0)/0.18),fs=Math.round(68*(0.85+0.15*pop));g.font='900 '+fs+'px -apple-system,"Apple SD Gothic Neo",sans-serif';var cl=wrap(g,sc.cap,W-140);cl.forEach(function(l,k){stroke(l,W/2,H*0.20+k*(fs+12),'900 '+fs+'px -apple-system,"Apple SD Gothic Neo",sans-serif',k===0&&s.i===0?'#FFD84D':'#FFFFFF',14);});}
    if(sc.say){var fnt='700 36px -apple-system,"Apple SD Gothic Neo",sans-serif';g.font=fnt;var sl=wrap(g,sc.say,W-170).slice(0,4);sl.forEach(function(l,k){stroke(l,W/2-20,H*0.66+k*48-(sl.length-1)*24,fnt,'#FFFFFF',9);});}
    g.font='600 22px -apple-system,sans-serif';g.textAlign='left';g.fillStyle='rgba(255,255,255,.75)';g.fillText('📍 광저우 广州',30,60);
    var b=$('rb');if(b)b.style.width=Math.min(100,tt/total*100)+'%';
  }
  frame(0);rec.start(500);
  await new Promise(function(done){(function loop(){var tt=ac.currentTime-t0;if(tt>=total){done();return;}frame(Math.max(0,tt));requestAnimationFrame(loop);})();});
  await new Promise(function(ok){rec.onstop=ok;rec.stop();});
  vids.forEach(function(v){if(v)try{v.pause();}catch(e){}});
  try{if(lock)lock.release();}catch(e){}try{ac.close();}catch(e){}
  var type=(mime||'video/mp4').split(';')[0],blob=new Blob(chunks,{type:type}),url=URL.createObjectURL(blob),ext=type.indexOf('webm')>=0?'webm':'mp4';
  out.innerHTML='<video class="out" controls playsinline src="'+url+'"></video>'
   +'<div class="mini" style="justify-content:center"><button id="dl">📥 기기에 저장</button></div>'
   +'<p class="lbl">유튜브 공개 범위</p><div class="chips" id="pv">'+[['private','비공개(확인 후 공개)'],['unlisted','일부 공개'],['public','바로 공개']].map(function(x,k){return '<button class="chip'+(k===0?' on':'')+'" data-pv="'+x[0]+'">'+x[1]+'</button>';}).join('')+'</div>'
   +'<button class="big red" id="ytUp">▶ 유튜브에 올리기</button><p class="note">AI 생성 콘텐츠로 자동 표시돼요. 제목에 #Shorts 가 붙어요.</p><div class="err" id="ue"></div>';
  btn.disabled=false;btn.textContent='🎬 다시 만들기';
  var PV='private';document.querySelectorAll('[data-pv]').forEach(function(c){c.onclick=function(){PV=c.getAttribute('data-pv');document.querySelectorAll('[data-pv]').forEach(function(x){x.classList.toggle('on',x===c);});};});
  $('dl').onclick=function(){var f=new File([blob],(D.title||'shorts').replace(/[\\/:*?"<>|#]/g,'').slice(0,40)+'.'+ext,{type:type});
    if(navigator.canShare&&navigator.canShare({files:[f]}))navigator.share({files:[f]}).catch(function(){});else{var a=document.createElement('a');a.href=url;a.download=f.name;a.click();}};
  $('ytUp').onclick=async function(){var b=this,ue=$('ue');b.disabled=true;ue.textContent='';
    try{b.innerHTML='<span class="spin">⏫</span> 서버에 저장 중… ('+(blob.size/1048576).toFixed(1)+'MB)';
      var r=await fetch('/shorts/save?id='+D.id,{method:'POST',headers:{'content-type':type,'x-code':CODE},body:blob});var j=await r.json();if(!j.ok)throw new Error(j.detail||j.error);
      b.innerHTML='<span class="spin">▶</span> 유튜브에 올리는 중…';readForm();
      var y=await api('/shorts/yt/upload',{id:D.id,privacy:PV,title:D.title,description:D.description,tags:D.tags});
      if(!y.ok){if(y.error==='yt_login'||y.error==='yt_config'){ue.textContent=(y.detail||'')+' 목록 화면의 \'유튜브 연결\'에서 먼저 연결해 주세요.';b.disabled=false;b.textContent='▶ 다시 올리기';return;}throw new Error(y.detail||y.error);}
      b.textContent='✅ 올렸어요';ue.innerHTML='<a href="'+esc(y.yt.url)+'" target="_blank" style="color:var(--sky)">'+esc(y.yt.url)+'</a>';
    }catch(e){ue.textContent=e.message;b.disabled=false;b.textContent='▶ 다시 올리기';}
  };
}
home();
</script></body></html>`;

// 🗣 영상 속 말 자막 — 폰이 클립 소리만 16kHz PCM 으로 뽑아 보냄(영상 원본은 안 옴) → 百炼 실시간 인식(문장 시각 포함, 광둥어 포함) → 千问이 한국어 자막으로
function cleanAsr(a) {
  return (Array.isArray(a) ? a : []).slice(0, 80).map((x) => Array.isArray(x) ? [Math.max(0, +Number(x[0]).toFixed(2) || 0), Math.max(0, +Number(x[1]).toFixed(2) || 0), String(x[2] || "").slice(0, 80), String(x[3] || "").slice(0, 40)] : null).filter((x) => x && x[1] > x[0] && (x[2] || x[3]));
}
async function recognize(env, pcm) {
  const up = await fetch("https://" + host(env) + "/api-ws/v1/inference", { headers: { Upgrade: "websocket", Authorization: "Bearer " + env.DASHSCOPE_API_KEY } });
  const ws = up.webSocket;
  if (!ws) throw serr("음성 인식 서버 연결 거부 " + up.status, 502);
  ws.accept();
  const task = crypto.randomUUID().replace(/-/g, "");
  const msg = (action, payload) => JSON.stringify({ header: { action, task_id: task, streaming: "duplex" }, payload });
  const sents = new Map();
  return await new Promise((res, rej) => {
    let done = false;
    const fin = (e, v) => { if (done) return; done = true; clearTimeout(to); try { ws.close(); } catch {} e ? rej(e) : res(v); };
    const to = setTimeout(() => fin(serr("음성 인식 시간 초과", 504)), 90000);
    ws.addEventListener("message", async (ev) => {
      if (typeof ev.data !== "string") return;
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      const e = m.header && m.header.event;
      if (e === "task-started") {
        try {
          for (let o = 0; o < pcm.length; o += 3200) { ws.send(pcm.subarray(o, Math.min(pcm.length, o + 3200))); if ((o / 3200) % 5 === 4) await new Promise((ok) => setTimeout(ok, 60)); }
          ws.send(msg("finish-task", { input: {} }));
        } catch (x) { fin(serr("음성 전송 실패: " + (x.message || x), 502)); }
      } else if (e === "result-generated") {
        const st = m.payload && m.payload.output && m.payload.output.sentence;
        if (st && st.text != null && st.begin_time != null) sents.set(st.begin_time, { t0: st.begin_time / 1000, t1: st.end_time ? st.end_time / 1000 : 0, zh: String(st.text).trim() });
      } else if (e === "task-finished") {
        const l = [...sents.values()].filter((x) => x.zh).sort((a, b) => a.t0 - b.t0);
        l.forEach((x, i) => { if (!x.t1 || x.t1 <= x.t0) x.t1 = l[i + 1] ? l[i + 1].t0 : x.t0 + 2.5; });
        fin(null, l);
      } else if (e === "task-failed") fin(serr("음성 인식 실패: " + (m.header.error_message || m.header.error_code || "unknown"), 502));
    });
    ws.addEventListener("close", () => fin(serr("음성 인식 연결이 끊겼어요", 502)));
    ws.send(msg("run-task", { task_group: "audio", task: "asr", function: "recognition", model: env.SHORTS_ASR_MODEL || "paraformer-realtime-v2",
      parameters: { format: "pcm", sample_rate: 16000, language_hints: ["zh", "yue"], disfluency_removal_enabled: true }, input: {} }));
  });
}
async function asr(env, b, h) {
  const id = String(b.id || ""), ci = Math.round(Number(b.clip));
  const d = await env.KV.get(draftKey(h, id), "json");
  if (!d || d.kind !== "mine" || !Array.isArray(d.clips) || !d.clips[ci]) throw serr("초안이나 클립을 찾지 못했어요.", 404);
  const b64 = String(b.pcm || "");
  if (!b64 || b64.length > 2700000) throw serr("소리가 없거나 너무 길어요(클립당 60초까지).");
  const bin = atob(b64), pcm = new Uint8Array(bin.length & ~1);
  for (let i = 0; i < pcm.length; i++) pcm[i] = bin.charCodeAt(i);
  const day = "shorts:asr:" + cnDay(), used = Number(await env.KV.get(day)) || 0, cap = Number(env.SHORTS_ASR_DAY || 60);
  if (used >= cap) throw serr("오늘 영상 속 말 자막은 " + cap + "번까지예요.", 429);
  await env.KV.put(day, String(used + 1), { expirationTtl: 3 * 86400 });
  const l = await recognize(env, pcm);
  let rows = [];
  if (l.length) {
    const out = await qwen(env, [{ role: "user", content: "광저우에서 찍은 영상 속 현지인 말(표준 중국어 또는 광둥어)을 인식한 문장들이다. 한국 유튜브 숏츠 자막으로 옮겨라: 문장마다 자연스러운 한국어 구어체, 18자 이내, 상황을 모르면 직역보다 뜻 위주. 인식이 엉망인 잡음 문장은 빈 문자열.\n" +
      l.map((x, i) => i + 1 + ". " + x.zh).join("\n") + '\nJSON만 출력: {"ko":["…"]} (순서·개수 그대로)' }], { model: env.SHORTS_MODEL || "qwen3.8-flash" });
    const ko = Array.isArray(out.ko) ? out.ko : [];
    rows = cleanAsr(l.map((x, i) => [x.t0, x.t1, x.zh, String(ko[i] || "")])).filter((x) => x[3]);
  }
  d.clips[ci].asr = rows;
  await env.KV.put(draftKey(h, id), JSON.stringify(d), { expirationTtl: 120 * 86400 });
  return { ok: true, asr: rows, heard: l.length };
}
