// =========================================================
// 🕵️ 광저우 미스터리 — 실제 광저우 장소를 무대로 한 추리 게임 (박비서와 같은 초대 코드)
//  GET  /mystery                화면
//  POST /mystery/state  {code}                        → 진행 중 사건(범인·결말·잠긴 장은 숨김)·기록
//  POST /mystery/new    {code, gps, radius, who, genre} → 高德 주변 후보(디디 /api/poi) → 千问이 4장짜리 사건 전체를 한 번에 설계
//  POST /mystery/check  {code, n, image}              → 千问 VL 이 현장 사진 판정 → 통과하면 그 장 단서 공개·다음 장 열림
//  POST /mystery/skip   {code, n}                     → 못 가는 장은 단서만 보기(-20점)
//  POST /mystery/hint   {code}                        → 힌트(-15점)
//  POST /mystery/accuse {code, who}                   → 범인 지목 → 결말·점수, 기록에 남김
//  GET  /mystery/img?k&s                              → 현장 사진(서명)
// 저장: KV myst:<코드해시> 문서 하나, 사진 R2 myst/<코드해시>/<사건id>-<n>.jpg
// 실제 가게·사람은 배경일 뿐 — 범인·악역은 모두 가상 인물(명예훼손 방지)
// [필수] AI 는 百炼(千问)만 — Anthropic 호출 없음
// =========================================================
import { logUse } from "./usage.js";

const KW = ["老街", "骑楼", "公园", "博物馆", "书店", "茶楼", "寺", "码头", "市场", "咖啡馆", "创意园", "图书馆", "美术馆", "古村"];
const GENRES = {
  classic: { label: "🕵️ 정통 추리", d: "经典本格推理：一件神秘的失窃/失踪案（不是凶杀），线索公平，读者能推理出真相" },
  ghost: { label: "🏮 괴담(안 무서움)", d: "岭南民间怪谈风格的悬疑：看似灵异，最后真相是人为的、温暖或有点好笑，不血腥不恐怖" },
  romance: { label: "💌 편지 수수께끼", d: "一封几十年前寄错的情书/家书引出的寻人谜题，温情、怀旧，最后揭开写信人是谁" },
};
const cnDay = (t = Date.now()) => new Date(t + 8 * 3600e3).toISOString().slice(0, 10);
const host = (env) => (env.DASHSCOPE_WS_HOST || "dashscope.aliyuncs.com").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
const merr = (message, status = 400) => Object.assign(new Error(message), { code: "mystery", status });

async function hmac16(env, s) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode("myst|" + (env.ALLOWED_CODES || "") + (env.DASHSCOPE_API_KEY || "")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(s));
  return [...new Uint8Array(sig)].slice(0, 8).map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function load(env, h) { const d = (await env.KV.get("myst:" + h, "json")) || {}; return { cur: d.cur || null, hist: d.hist || [], total: d.total || 0, gen: d.gen || {} }; }
const save = (env, h, d) => env.KV.put("myst:" + h, JSON.stringify(d));

// 千问: 모델 목록을 차례로 시도(이름이 없거나 일시 오류면 다음), JSON 앞뒤 잡문 허용
async function qwen(env, models, messages, temperature = 0.9) {
  let last = "";
  for (const model of models.filter(Boolean)) {
    for (let k = 0; k < 2; k++) {
      let r;
      try {
        r = await fetch("https://" + host(env) + "/compatible-mode/v1/chat/completions", {
          method: "POST", headers: { authorization: "Bearer " + env.DASHSCOPE_API_KEY, "content-type": "application/json" },
          body: JSON.stringify({ model, messages, temperature, response_format: { type: "json_object" }, enable_thinking: false }),
        });
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
  throw merr("千问 오류: " + last + " — 잠시 뒤 다시 눌러 주세요.", 502);
}

// 화면에 보낼 모양: 범인·결말·안 열린 장 내용은 빼고 보냄
async function view(env, d) {
  const c = d.cur;
  let cur = null;
  if (c) {
    const open = c.chapters.findIndex((x) => !x.done);
    cur = {
      id: c.id, title: c.title, intro: c.intro, genre: c.genre, made: c.made, score: c.score, hintUsed: !!c.hintUsed, hint: c.hintUsed ? c.hint : "",
      suspects: c.suspects, solved: c.solved || null, ending: c.solved ? c.solved.ending : "",
      chapters: await Promise.all(c.chapters.map(async (x, i) => {
        const vis = x.done || i === open;
        const o = { n: i, done: !!x.done, skipped: !!x.skipped, locked: !vis, title: vis ? x.title : "" };
        if (!vis) return o;
        Object.assign(o, { story: x.story, mission: x.mission, poi: x.poi, comment: x.comment || "" });
        if (x.done) o.clue = x.clue;
        if (x.img) o.imgUrl = "/mystery/img?k=" + encodeURIComponent(x.img) + "&s=" + (await hmac16(env, x.img));
        return o;
      })),
      ready: c.chapters.every((x) => x.done),
    };
  }
  return { ok: true, cur, hist: d.hist.slice(0, 30), total: d.total, genres: Object.fromEntries(Object.entries(GENRES).map(([k, g]) => [k, g.label])) };
}

export async function mysteryApi(env, ctx, path, b, h) {
  if (path === "/mystery/state") return view(env, await load(env, h));
  if (path === "/mystery/new") return newCase(env, ctx, b, h);
  if (path === "/mystery/check") return check(env, ctx, b, h, false);
  if (path === "/mystery/skip") return check(env, ctx, b, h, true);
  if (path === "/mystery/hint") return hint(env, h);
  if (path === "/mystery/accuse") return accuse(env, ctx, b, h);
  throw merr("not_found", 404);
}

async function newCase(env, ctx, b, h) {
  const gps = String(b.gps || "");
  if (!/^-?\d+\.\d+,-?\d+\.\d+$/.test(gps)) throw merr("현재 위치가 필요해요. 위치 권한을 허용해 주세요.");
  if (!env.DIDI || !env.DIDI_ACCESS_KEY) throw merr("장소 검색 서버(디디 주소록) 연결이 없습니다", 500);
  const d = await load(env, h);
  if (d.cur && !d.cur.solved && !b.force) throw merr("진행 중인 사건이 있어요. 끝내거나 '사건 포기'를 눌러 주세요.");
  const day = cnDay(), max = Number(env.MYST_DAY_MAX) || 3;
  if ((d.gen[day] || 0) >= max) throw merr("오늘은 사건을 " + max + "번 받았어요. 내일 다시!", 429);
  const radius = [5000, 10000, 20000].includes(Number(b.radius)) ? Number(b.radius) : 10000;
  const genre = GENRES[b.genre] ? b.genre : "classic";
  const poiRes = await env.DIDI.fetch("https://didi/api/poi", { method: "POST", headers: { "x-access-key": env.DIDI_ACCESS_KEY, "content-type": "application/json" }, body: JSON.stringify({ gps, radius, kw: KW }) }).then((r) => r.json());
  if (!poiRes.ok) throw merr("주변 장소를 못 찾았어요: " + (poiRes.error || ""), 502);
  const used = new Set(d.hist.flatMap((x) => x.pids || []));
  let cands = (poiRes.pois || []).filter((p) => !used.has(p.id));
  // 종류가 골고루 섞이게: 키워드별로 평점 좋은 순 2~3곳씩
  const byKw = {};
  for (const p of cands.sort((a, c) => (c.rating || 3) - (a.rating || 3))) (byKw[p.kw] = byKw[p.kw] || []).push(p);
  cands = Object.values(byKw).flatMap((l) => l.slice(0, 3)).slice(0, 36);
  if (cands.length < 4) throw merr("반경 안에 무대로 쓸 장소가 부족해요. 반경을 넓혀 보세요.");
  const list = cands.map((p, i) => ({ i, name: p.name, type: p.type, kw: p.kw, area: p.area, km: +(p.dist / 1000).toFixed(1) }));
  const who = b.who === "solo" ? "一位住在广州的韩国中年男性（独自）" : "一对住在广州的韩国中年夫妻（两人一起）";
  const sys = "你是城市实景解谜游戏的编剧。玩家是" + who + "，周末在广州真实地点之间移动来破案。题材：" + GENRES[genre].d + "。\n" +
    "从候选真实地点中选4个作为4章的舞台（类型尽量不同，顺序要合理，第1章最好近一点）。每章：玩家到现场拍一张照片完成'现场调查'后，才能读到该章线索。\n" +
    "规则：1) 真实地点只当背景和舞台，所有犯人、可疑人物、事件都是虚构的；不要把真实店铺、员工或真实人物写成坏人、不要说真实店铺有违法或负面行为。2) 不能有凶杀、血腥、暴力、色情、政治内容。" +
    "3) 3个嫌疑人（虚构中文名字，韩语描述职业和性格），其中1个是真相；4章线索要公平：单看一条不够，4条合起来能推理出唯一答案，也要有误导。" +
    "4) mission 是到了那类地方一定能拍到的具体画面（例如'刻着年份的石碑'、'菜单上最贵的一道菜'、'窗格的花纹'），不能拍陌生人的脸，不能违反场所规定、不能危险。" +
    "5) 全部用韩语写（人名可用中文名后括号注音），story 用'두 분은…/당신은…'第二人称，每章3~5句，有画面感；clue 1~2句，具体。ending 是揭晓真相的结局（4~6句，说明每条线索怎么指向真相），wrong 是猜错时的结局（2~3句，不剧透真相，鼓励下次）。hint 一句，点到为止。\n" +
    '只输出 JSON：{"title":"","intro":"2~3句案件开场","suspects":[{"name":"","role":"","desc":""}],"culprit":0到2的整数,"chapters":[{"i":候选编号,"title":"","story":"","mission":"","clue":""}],"hint":"","ending":"","wrong":""}';
  const out = await qwen(env, [env.MYST_MODEL, "qwen-plus", env.QUEST_MODEL || "qwen3.8-flash"], [{ role: "system", content: sys }, { role: "user", content: "候选地点：" + JSON.stringify(list) }]);
  const seen = new Set();
  const chapters = (Array.isArray(out.chapters) ? out.chapters : []).filter((x) => Number.isInteger(Number(x.i)) && cands[Number(x.i)] && !seen.has(Number(x.i)) && seen.add(Number(x.i))).slice(0, 4).map((x) => {
    const p = cands[Number(x.i)];
    return { title: String(x.title || p.name).slice(0, 40), story: String(x.story || "").slice(0, 500), mission: String(x.mission || "").slice(0, 160), clue: String(x.clue || "").slice(0, 240),
      poi: { id: p.id, name: p.name, addr: p.addr, area: p.area, loc: p.loc, ms: p.ms, dist: p.dist, type: p.type }, done: false };
  });
  const suspects = (Array.isArray(out.suspects) ? out.suspects : []).slice(0, 3).map((s) => ({ name: String(s.name || "?").slice(0, 30), role: String(s.role || "").slice(0, 40), desc: String(s.desc || "").slice(0, 160) }));
  const culprit = Number(out.culprit);
  if (chapters.length < 3 || suspects.length < 3 || !(culprit >= 0 && culprit <= 2)) throw merr("사건 설계가 엉성하게 나왔어요. 다시 눌러 주세요.", 502);
  if (d.cur && !d.cur.solved) d.hist.unshift({ id: d.cur.id, title: d.cur.title, date: cnDay(d.cur.made), solved: false, gaveUp: true, score: 0, pids: d.cur.chapters.map((x) => x.poi.id) });
  d.cur = { id: "m" + Date.now().toString(36), made: Date.now(), genre, title: String(out.title || "광저우 미스터리").slice(0, 50), intro: String(out.intro || "").slice(0, 400),
    suspects, culprit, chapters, hint: String(out.hint || "").slice(0, 200), ending: String(out.ending || "").slice(0, 900), wrong: String(out.wrong || "").slice(0, 400), score: 100 };
  d.gen = { [day]: (d.gen[day] || 0) + 1 };
  d.hist = d.hist.slice(0, 50);
  await save(env, h, d);
  ctx.waitUntil(logUse(env, "mystery", { new: 1 }, 0, h).catch(() => {}));
  return view(env, d);
}

function b64bytes(b64) { const s = atob(String(b64).replace(/^data:[^,]+,/, "")); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }

async function check(env, ctx, b, h, skip) {
  const d = await load(env, h), c = d.cur;
  if (!c || c.solved) throw merr("진행 중인 사건이 없어요.");
  const n = Number(b.n), ch = c.chapters[n];
  if (!ch) throw merr("그 장을 찾지 못했어요.");
  if (c.chapters.findIndex((x) => !x.done) !== n) throw merr("앞 장부터 풀어 주세요.");
  let verdict;
  if (skip) { verdict = { ok: true, comment: "현장엔 못 갔지만 단서는 손에 넣었어요. (-20점)" }; c.score = Math.max(0, c.score - 20); }
  else {
    const img = String(b.image || "");
    if (!img) throw merr("사진이 필요해요.");
    if (img.length > 4_000_000) throw merr("사진이 너무 커요.");
    const prompt = "这是城市解谜游戏的现场调查照片验证。地点：" + ch.poi.name + "（" + ch.poi.type + "）。任务（韩语）：" + ch.mission +
      "\n判断照片是否大致完成任务（宽松：在那类地方、有任务说的主要东西就算通过；明显无关、截图、翻拍屏幕不算）。" +
      '只输出 JSON：{"ok":true或false,"comment":"韩语1~2句，像侦探搭档一样评价这张现场照片；不通过时说缺了什么"}';
    const v = await qwen(env, [env.QUEST_VL_MODEL || "qwen3-vl-plus"], [{ role: "user", content: [{ type: "image_url", image_url: { url: img.startsWith("data:") ? img : "data:image/jpeg;base64," + img } }, { type: "text", text: prompt }] }], 0.6);
    verdict = { ok: v.ok === true || v.ok === "true", comment: String(v.comment || "").slice(0, 200) };
    if (!verdict.ok) { ctx.waitUntil(logUse(env, "mystery", { fail: 1 }, 0, h).catch(() => {})); return { ...(await view(env, d)), result: verdict }; }
    if (env.R2) { ch.img = "myst/" + h + "/" + c.id + "-" + n + ".jpg"; await env.R2.put(ch.img, b64bytes(img), { httpMetadata: { contentType: "image/jpeg" } }); }
  }
  Object.assign(ch, { done: true, skipped: !!skip, comment: verdict.comment, at: Date.now() });
  await save(env, h, d);
  ctx.waitUntil(logUse(env, "mystery", { [skip ? "skip" : "clue"]: 1 }, 0, h).catch(() => {}));
  return { ...(await view(env, d)), result: { ...verdict, clue: ch.clue } };
}

async function hint(env, h) {
  const d = await load(env, h), c = d.cur;
  if (!c || c.solved) throw merr("진행 중인 사건이 없어요.");
  if (!c.hintUsed) { c.hintUsed = true; c.score = Math.max(0, c.score - 15); await save(env, h, d); }
  return view(env, d);
}

async function accuse(env, ctx, b, h) {
  const d = await load(env, h), c = d.cur;
  if (!c || c.solved) throw merr("진행 중인 사건이 없어요.");
  if (!c.chapters.every((x) => x.done)) throw merr("단서를 다 모은 뒤에 지목할 수 있어요.");
  const who = Number(b.who);
  if (!(who >= 0 && who < c.suspects.length)) throw merr("용의자를 골라 주세요.");
  const right = who === c.culprit;
  const score = right ? c.score : 0;
  c.solved = { right, who, score, at: Date.now(), ending: right ? c.ending : c.wrong + "\n\n(정답은 공개하지 않아요 — 다음 사건에서 설욕!)" };
  d.total += score;
  d.hist.unshift({ id: c.id, title: c.title, date: cnDay(c.made), solved: right, score, pids: c.chapters.map((x) => x.poi.id) });
  d.hist = d.hist.slice(0, 50);
  await save(env, h, d);
  ctx.waitUntil(logUse(env, "mystery", { [right ? "solve" : "wrong"]: 1 }, 0, h).catch(() => {}));
  return view(env, d);
}

export async function mysteryGet(req, env, url) {
  if (url.pathname === "/mystery/img") {
    const k = url.searchParams.get("k") || "";
    if (!/^myst\/[0-9a-f]{12}\/[\w.-]+\.jpg$/.test(k) || url.searchParams.get("s") !== (await hmac16(env, k))) return new Response("forbidden", { status: 403 });
    const o = await env.R2.get(k);
    if (!o) return new Response("not found", { status: 404 });
    return new Response(o.body, { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=31536000" } });
  }
  return new Response("not found", { status: 404 });
}

export const MYSTERY_HTML = String.raw`<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#1A2330">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="광저우 미스터리">
<link rel="apple-touch-icon" href="/icon-180.png">
<title>광저우 미스터리</title>
<style>
:root{--sky:#1664B0;--bg:#EFE8DE;--card:#F7F2EA;--ink:#1A2330;--ink2:#5E6672;--line:#D9CEBD;--red:#D21624;--soft:#E6DCCB;--ok:#1F7A4D;--paper:#FBF6EC}
@media (prefers-color-scheme:dark){:root{--bg:#141A22;--card:#1C2430;--ink:#EDE6DA;--ink2:#9AA3AE;--line:#2C3644;--soft:#253041;--ok:#5CC08C;--paper:#202836}}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 -apple-system,"Apple SD Gothic Neo","PingFang SC",system-ui,sans-serif;-webkit-text-size-adjust:100%}
header{background:#1A2330;color:#fff;padding:calc(env(safe-area-inset-top) + 14px) 16px 14px;border-bottom:3px solid var(--red);display:flex;align-items:center;gap:12px}
header h1{margin:0;font-size:19px}a.back{color:#fff;text-decoration:none;font-size:20px}header .pt{margin-left:auto;text-align:right;font-size:12px;opacity:.9}header .pt b{display:block;font-size:20px;line-height:1.1}
main{max-width:640px;margin:0 auto;padding:14px 16px 60px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:12px}
.card h2{margin:0 0 6px;font-size:16px}.lbl{font-size:12.5px;color:var(--ink2);margin:10px 0 6px}
.case{background:var(--paper);border-left:4px solid var(--red)}.case h2{font-size:19px;letter-spacing:-.3px}
.intro{white-space:pre-wrap}
.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{border:1px solid var(--line);background:transparent;color:var(--ink);border-radius:999px;padding:6px 12px;font:inherit;font-size:13.5px}.chip.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.big{display:block;width:100%;border:0;border-radius:12px;background:var(--sky);color:#fff;font:inherit;font-weight:700;font-size:16px;padding:14px;margin-top:12px;text-align:center;text-decoration:none}.big:disabled{opacity:.5}
.big.dark{background:#1A2330}.big.red{background:var(--red)}.big.ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}
.sus{display:grid;gap:8px}.sus div{border:1px dashed var(--line);border-radius:10px;padding:8px 10px}.sus b{font-size:15px}.sus small{display:block;color:var(--ink2);font-size:12.5px}
.ch{border-top:1px solid var(--line);padding:12px 0}.ch:first-of-type{border-top:0}.ch .hd{display:flex;gap:8px;align-items:center;font-weight:700}.ch .no{width:26px;height:26px;border-radius:50%;background:#1A2330;color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;flex:none}
.ch.lock{color:var(--ink2)}.ch.lock .no{background:var(--soft);color:var(--ink2)}
.story{white-space:pre-wrap;margin:8px 0}.place{background:var(--soft);border-radius:10px;padding:8px 10px;font-size:13.5px}.place b{font-size:14.5px}
.ms{border-left:3px solid var(--sky);padding:4px 10px;margin:10px 0;font-size:14.5px}
.clue{background:#FFF6D6;color:#4A3B00;border-radius:10px;padding:10px 12px;margin-top:8px;font-size:14.5px}@media (prefers-color-scheme:dark){.clue{background:#3A3416;color:#F3E6A8}}
.acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.acts a,.acts button,.acts label{border:1px solid var(--line);background:transparent;color:var(--ink);border-radius:10px;padding:8px 11px;font:inherit;font-size:13.5px;text-decoration:none}
.acts label.cam{background:var(--sky);color:#fff;border-color:var(--sky);font-weight:700}.acts label input{display:none}
.res{margin-top:8px;font-size:14px}.res.no{color:var(--red)}
img.ph{width:100%;max-height:240px;object-fit:cover;border-radius:10px;margin-top:8px;display:block}
.end{white-space:pre-wrap;background:var(--paper);border-radius:12px;padding:12px;margin-top:8px}
.hist div{display:flex;justify-content:space-between;gap:8px;padding:7px 0;border-top:1px solid var(--line);font-size:14px}.hist div:first-child{border-top:0}.hist small{color:var(--ink2);white-space:nowrap}
.note{font-size:12.5px;color:var(--ink2);margin:6px 0 0}.err{color:var(--red);font-size:13.5px;margin-top:8px}
.toast{position:fixed;left:50%;bottom:calc(20px + env(safe-area-inset-bottom));transform:translateX(-50%);background:var(--ink);color:var(--bg);padding:10px 16px;border-radius:999px;font-size:14px;z-index:9;max-width:90vw;text-align:center}
.spin{display:inline-block;animation:sp 1.2s linear infinite}@keyframes sp{to{transform:rotate(360deg)}}
.gate{padding:40px 0;text-align:center}
</style></head><body>
<header><a class="back" href="/" aria-label="박비서">‹</a><h1>🕵️ 광저우 미스터리</h1><div class="pt" id="pt"></div></header>
<main id="main"><div class="gate">불러오는 중…</div></main>
<script>
var CODE='';try{CODE=localStorage.getItem('pb-code')||'';}catch(e){}
var S=null,RAD=10000,WHO='duo',GEN='classic',BUSY=false;
function $(i){return document.getElementById(i);}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function toast(t){var d=document.createElement('div');d.className='toast';d.textContent=t;document.body.appendChild(d);setTimeout(function(){d.remove();},3500);}
function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}
function api(p,b,tries){b=b||{};b.code=CODE;tries=tries==null?1:tries;return fetch(p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json().catch(function(){return {error:'서버 응답 오류 '+r.status};});},function(e){if(tries>0)return sleep(1500).then(function(){return api(p,b,tries-1);});return {error:'network',detail:'네트워크가 끊겼어요. 다시 눌러 주세요.'};});}
function gate(m){$('main').innerHTML='<div class="gate"><p>'+esc(m||'박비서 초대 코드를 넣어 주세요')+'</p><input id="cd" placeholder="초대 코드" style="font:inherit;padding:8px;border-radius:8px;border:1px solid var(--line)"> <button class="chip on" id="go">열기</button></div>';$('go').onclick=function(){CODE=$('cd').value.trim();try{localStorage.setItem('pb-code',CODE);}catch(e){}load();};}
function kmT(m){return m>=1000?(m/1000).toFixed(1)+'km':Math.round(m)+'m';}
function load(){if(!CODE)return gate();api('/mystery/state').then(function(j){if(j.error==='not_allowed')return gate('초대 코드가 맞지 않아요');if(!j.ok)return gate(j.detail||j.error);S=j;render();});}
function render(){
  $('pt').innerHTML='누적<b>'+(S.total||0)+'</b>';
  var c=S.cur,h='';
  if(!c||c.solved){
    if(c&&c.solved)h+=solvedHtml(c);
    h+=newHtml();
  }else h+=caseHtml(c);
  if(S.hist&&S.hist.length)h+='<div class="card"><h2>📁 사건 기록</h2><div class="hist">'+S.hist.map(function(x){return '<div><span>'+(x.solved?'✅ ':x.gaveUp?'🏳 ':'❌ ')+esc(x.title)+'</span><small>'+esc(x.date)+' · '+x.score+'점</small></div>';}).join('')+'</div></div>';
  $('main').innerHTML=h;bind();
}
function newHtml(){
  return '<div class="card"><h2>새 사건 받기</h2><p class="note" style="margin-top:0">지금 있는 곳 주변의 실제 장소 4곳이 사건 무대가 돼요. 장소마다 가서 현장 사진을 찍으면 단서가 열리고, 단서 4개로 범인을 지목해요. 하루에 다 못 풀어도 돼요 — 몇 주에 걸쳐 이어 가도 OK.</p>'
   +'<p class="lbl">장르</p><div class="chips">'+Object.keys(S.genres).map(function(k){return '<button class="chip'+(k===GEN?' on':'')+'" data-gen="'+k+'">'+esc(S.genres[k])+'</button>';}).join('')+'</div>'
   +'<p class="lbl">누구랑</p><div class="chips"><button class="chip'+(WHO==='duo'?' on':'')+'" data-who="duo">👫 둘이서</button><button class="chip'+(WHO==='solo'?' on':'')+'" data-who="solo">🚶 혼자</button></div>'
   +'<p class="lbl">무대 반경</p><div class="chips">'+[[5000,'5km'],[10000,'10km'],[20000,'20km']].map(function(r){return '<button class="chip'+(r[0]===RAD?' on':'')+'" data-rad="'+r[0]+'">'+r[1]+'</button>';}).join('')+'</div>'
   +'<button class="big dark" id="gen">📍 이 근처에서 사건 받기</button><div class="err" id="gerr"></div></div>';
}
function caseHtml(c){
  var h='<div class="card case"><p class="lbl" style="margin:0 0 4px">'+esc(S.genres[c.genre]||'')+' · 현재 '+c.score+'점</p><h2>'+esc(c.title)+'</h2><div class="intro">'+esc(c.intro)+'</div></div>';
  h+='<div class="card"><h2>🧑‍🤝‍🧑 용의자</h2><div class="sus">'+c.suspects.map(function(s,i){return '<div><b>'+(i+1)+'. '+esc(s.name)+'</b> <span style="color:var(--ink2);font-size:13px">'+esc(s.role)+'</span><small>'+esc(s.desc)+'</small></div>';}).join('')+'</div></div>';
  h+='<div class="card"><h2>🗺 수사 일지</h2>'+c.chapters.map(chHtml).join('')+'</div>';
  if(c.ready){h+='<div class="card"><h2>⚖️ 범인 지목</h2><p class="note" style="margin-top:0">단서 4개를 다시 읽고 한 명을 고르세요. 기회는 한 번이에요.</p><div class="chips" style="margin-top:8px">'+c.suspects.map(function(s,i){return '<button class="chip" data-acc="'+i+'">'+esc(s.name)+'</button>';}).join('')+'</div><div class="err" id="aerr"></div></div>';}
  h+='<div class="card"><h2>💡 막혔다면</h2>'+(c.hintUsed?'<div class="clue">'+esc(c.hint)+'</div>':'<button class="big ghost" id="hintBtn">힌트 보기 (-15점)</button>')
   +'<button class="big ghost" id="quit" style="margin-top:8px">🏳 이 사건 포기하고 새 사건</button></div>';
  return h;
}
function chHtml(x){
  if(x.locked)return '<div class="ch lock"><div class="hd"><span class="no">'+(x.n+1)+'</span>🔒 '+(x.n+1)+'장 — 앞 장을 풀면 열려요</div></div>';
  var p=x.poi,h='<div class="ch" id="ch'+x.n+'"><div class="hd"><span class="no">'+(x.done?'✓':(x.n+1))+'</span>'+esc(x.title)+'</div><div class="story">'+esc(x.story)+'</div>';
  h+='<div class="place">📍 <b>'+esc(p.name)+'</b> · '+esc(p.area||'')+' · '+kmT(p.dist)+'</div>';
  if(x.done){if(x.imgUrl)h+='<img class="ph" src="'+esc(x.imgUrl)+'" alt="" onerror="this.style.display=\'none\'">';h+=(x.comment?'<p class="note">'+esc(x.comment)+'</p>':'')+'<div class="clue">🔎 단서: '+esc(x.clue)+'</div></div>';return h;}
  var ll=(p.loc||',').split(',');
  h+='<div class="ms"><b>📸 현장 조사</b><br>'+esc(x.mission)+'</div><div class="acts"><a href="https://uri.amap.com/navigation?to='+ll[0]+','+ll[1]+','+encodeURIComponent(p.name)+'&mode=car&coordinate=gaode&callnative=1">🗺 高德 길찾기</a>'
   +'<button data-copy="'+esc(p.name)+'">🚕 이름 복사</button><label class="cam">📸 현장 사진<input type="file" accept="image/*" capture="environment" data-n="'+x.n+'"></label><button data-skip="'+x.n+'">못 가요 (-20점)</button></div><div id="r'+x.n+'"></div></div>';
  return h;
}
function solvedHtml(c){
  var s=c.solved;return '<div class="card case"><h2>'+(s.right?'🎉 사건 해결!':'😵 아쉽게도…')+'</h2><p class="lbl" style="margin:0">'+esc(c.title)+' · 지목: '+esc(c.suspects[s.who]&&c.suspects[s.who].name)+' · '+s.score+'점</p><div class="end">'+esc(c.ending)+'</div></div>';
}
function bind(){
  document.querySelectorAll('[data-gen]').forEach(function(b){b.onclick=function(){GEN=b.getAttribute('data-gen');render();};});
  document.querySelectorAll('[data-who]').forEach(function(b){b.onclick=function(){WHO=b.getAttribute('data-who');render();};});
  document.querySelectorAll('[data-rad]').forEach(function(b){b.onclick=function(){RAD=+b.getAttribute('data-rad');render();};});
  if($('gen'))$('gen').onclick=function(){gen(false);};
  if($('quit'))$('quit').onclick=function(){if(!confirmTwice(this))return;S.cur=null;render();window.scrollTo(0,0);toast('새 사건을 받으면 지금 사건은 포기로 기록돼요');QUIT=true;};
  if($('hintBtn'))$('hintBtn').onclick=function(){if(!confirmTwice(this))return;api('/mystery/hint').then(function(j){if(!j.ok)return toast(j.detail||j.error);S=j;render();});};
  document.querySelectorAll('[data-copy]').forEach(function(b){b.onclick=function(){var t=b.getAttribute('data-copy');try{navigator.clipboard.writeText(t).then(function(){toast('복사됨 — 디디에 붙여 넣으세요');});}catch(e){toast(t);}};});
  document.querySelectorAll('input[data-n]').forEach(function(i){i.onchange=function(){var f=i.files&&i.files[0];if(f)shoot(+i.getAttribute('data-n'),f);i.value='';};});
  document.querySelectorAll('[data-skip]').forEach(function(b){b.onclick=function(){if(!confirmTwice(this))return;var n=+b.getAttribute('data-skip');api('/mystery/skip',{n:n}).then(function(j){if(!j.ok)return toast(j.detail||j.error);S=j;render();var e=$('ch'+n);if(e)e.scrollIntoView({block:'center'});});};});
  document.querySelectorAll('[data-acc]').forEach(function(b){b.onclick=function(){if(!confirmTwice(this,'정말 이 사람?'))return;api('/mystery/accuse',{who:+b.getAttribute('data-acc')}).then(function(j){if(!j.ok){$('aerr').textContent=j.detail||j.error;return;}S=j;render();window.scrollTo(0,0);});};});
}
var QUIT=false;
function confirmTwice(b,msg){if(b.getAttribute('data-sure'))return true;b.setAttribute('data-sure','1');var t=b.textContent;b.textContent=msg||'한 번 더 누르면 진행';setTimeout(function(){if(b){b.removeAttribute('data-sure');b.textContent=t;}},3000);return false;}
function gen(){
  if(BUSY)return;var b=$('gen'),er=$('gerr');if(!navigator.geolocation){er.textContent='이 기기에서 위치를 쓸 수 없어요';return;}
  BUSY=true;b.disabled=true;b.innerHTML='<span class="spin">🧭</span> 위치 확인 중…';
  navigator.geolocation.getCurrentPosition(function(pos){
    b.innerHTML='<span class="spin">🕵️</span> 사건을 설계하는 중… (20~40초)';
    var g=pos.coords.longitude.toFixed(6)+','+pos.coords.latitude.toFixed(6);
    api('/mystery/new',{gps:g,radius:RAD,who:WHO,genre:GEN,force:QUIT}).then(function(j){BUSY=false;if(!j.ok){b.disabled=false;b.textContent='📍 다시 받기';er.textContent=j.detail||j.error||'실패';return;}QUIT=false;S=j;render();window.scrollTo(0,0);});
  },function(){BUSY=false;b.disabled=false;b.textContent='📍 다시 받기';er.textContent='위치 권한을 허용해 주세요 (설정 → Safari → 위치)';},{enableHighAccuracy:true,timeout:15000,maximumAge:60000});
}
function shrink(file){return new Promise(function(ok,no){var u=URL.createObjectURL(file),im=new Image();im.onload=function(){var M=1280,w=im.naturalWidth,h=im.naturalHeight,s=Math.min(1,M/Math.max(w,h));var c=document.createElement('canvas');c.width=Math.round(w*s);c.height=Math.round(h*s);c.getContext('2d').drawImage(im,0,0,c.width,c.height);URL.revokeObjectURL(u);ok(c.toDataURL('image/jpeg',.82));};im.onerror=function(){no();};im.src=u;});}
function shoot(n,file){
  var box=$('r'+n);box.innerHTML='<div class="res"><span class="spin">🔍</span> 현장 사진 감식 중…</div>';
  shrink(file).then(function(d){return api('/mystery/check',{n:n,image:d});}).then(function(j){
    if(!j.ok){box.innerHTML='<div class="res no">'+esc(j.detail||j.error)+'</div>';return;}
    var r=j.result||{};if(r.ok){S=j;render();toast('🔎 단서 확보!');var e=$('ch'+n);if(e)e.scrollIntoView({block:'center'});return;}
    box.innerHTML='<div class="res no">'+esc(r.comment||'조사 대상이 잘 안 보여요')+' — 다시 찍어 보세요.</div>';
  }).catch(function(){box.innerHTML='<div class="res no">사진을 보내지 못했어요. 다시 찍어 주세요.</div>';});
}
load();
</script></body></html>`;
