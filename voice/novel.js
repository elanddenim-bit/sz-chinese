// =========================================================
// 📖 우리 연재 소설 — 주말 탐험·미스터리·간판 사냥·타임머신·숏츠 기록과 한 줄 메모로, 두 사람이 주인공인 광저우 생활 소설을 한 화씩 연재 + 삽화
//  GET  /novel                     화면 (박비서와 같은 초대 코드)
//  POST /novel/state    {code}               → 설정·회차 목록(삽화 서명 주소)
//  POST /novel/settings {code, names[2], style}
//  POST /novel/write    {code, memo}         → 지난 화 이후 기록 모아 千问이 다음 화 집필 → 삽화(通义万相 문생도 비동기) 작업 시작
//  POST /novel/poll     {code, task, n}      → 삽화 완료 시 R2 저장
//  POST /novel/del      {code, n}            → 마지막 화 지우기(다시 쓰기용)
//  GET  /novel/img?k&s
// 저장: KV nv:<코드해시> {names, style, chapters(60)}, R2 nv/<코드해시>/<n>.png
// [필수] AI 는 百炼(千问·通义万相)만 — Anthropic 호출 없음
// =========================================================
import { logUse } from "./usage.js";

const STYLES = {
  warm: ["☕ 잔잔한 에세이", "따뜻하고 잔잔한 생활 소설. 작은 장면과 대화, 해외살이의 소소한 감정을 담백하게. 과장 없이, 끝은 여운 있게."],
  sitcom: ["😂 시트콤", "티격태격하는 부부 시트콤. 대화 위주, 오해와 반전, 매 화 끝은 웃긴 한 줄로. 서로를 아끼는 마음은 바닥에 깔려 있게."],
  noir: ["🕶 하드보일드", "레이먼드 챈들러풍 1인칭 하드보일드 패러디. 평범한 주말을 비장한 사건처럼, 건조한 비유와 짧은 문장. 웃기지만 진지한 척."],
};
const cnDay = (t = Date.now()) => new Date(t + 8 * 3600e3).toISOString().slice(0, 10);
const host = (env) => (env.DASHSCOPE_WS_HOST || "dashscope.aliyuncs.com").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
const nerr = (message, status = 400) => Object.assign(new Error(message), { code: "novel", status });

async function hmac16(env, s) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode("nv|" + (env.ALLOWED_CODES || "") + (env.DASHSCOPE_API_KEY || "")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(s));
  return [...new Uint8Array(sig)].slice(0, 8).map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function load(env, h) { const d = (await env.KV.get("nv:" + h, "json")) || {}; return { names: d.names || ["남편", "아내"], style: d.style || "warm", chapters: d.chapters || [], gen: d.gen || {} }; }
const save = (env, h, d) => env.KV.put("nv:" + h, JSON.stringify(d));
async function view(env, d) {
  return { ok: true, names: d.names, style: d.style, styles: Object.fromEntries(Object.entries(STYLES).map(([k, v]) => [k, v[0]])),
    chapters: await Promise.all(d.chapters.map(async (c) => ({ n: c.n, title: c.title, text: c.text, at: c.at, task: c.img ? "" : (c.task || ""),
      imgUrl: c.img ? "/novel/img?k=" + encodeURIComponent(c.img) + "&s=" + (await hmac16(env, c.img)) : "" }))) };
}

async function qwen(env, messages) {
  let last = "";
  for (const model of [env.NOVEL_MODEL, "qwen-plus", env.QUEST_MODEL || "qwen3.8-flash"].filter(Boolean)) {
    for (let k = 0; k < 2; k++) {
      let r; try {
        r = await fetch("https://" + host(env) + "/compatible-mode/v1/chat/completions", { method: "POST", headers: { authorization: "Bearer " + env.DASHSCOPE_API_KEY, "content-type": "application/json" },
          body: JSON.stringify({ model, messages, temperature: 0.95, response_format: { type: "json_object" }, enable_thinking: false }) });
      } catch (e) { last = String(e.message || e); continue; }
      const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch {}
      if (!r.ok) { last = model + " " + r.status; if (r.status >= 500 || r.status === 429) { await new Promise((ok) => setTimeout(ok, 1500)); continue; } break; }
      const c = String((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "");
      try { return JSON.parse(c); } catch {}
      const a = c.indexOf("{"), z = c.lastIndexOf("}"); if (a >= 0 && z > a) try { return JSON.parse(c.slice(a, z + 1)); } catch {}
      last = model + ": JSON 아님";
    }
  }
  throw nerr("千问 오류: " + last + " — 잠시 뒤 다시 눌러 주세요.", 502);
}

// 지난 화 이후(첫 화는 최근 3주) 다른 놀이에서 남긴 기록을 모아 소설 재료로
async function material(env, h, since) {
  const out = [];
  const q = (await env.KV.get("quest:" + h, "json")) || {};
  for (const x of (q.hist || []).filter((x) => x.date >= cnDay(since)).slice(0, 8)) out.push("주말 탐험 " + x.date + ": " + x.name + "(" + (x.area || "") + ") — 미션 '" + (x.title || "") + "' 완료" + (x.comment ? ", 판정 한마디: " + x.comment : ""));
  const m = (await env.KV.get("myst:" + h, "json")) || {};
  for (const x of (m.hist || []).filter((x) => x.date >= cnDay(since)).slice(0, 3)) out.push("추리 게임 '" + x.title + "' " + (x.solved ? "해결" : x.gaveUp ? "포기" : "범인 지목 실패"));
  const s = (await env.KV.get("sg:" + h, "json")) || {};
  for (const x of (s.items || []).filter((x) => x.at >= since).slice(0, 5)) out.push("길에서 본 간판 '" + x.zh + "'(직역: " + x.literal + ")");
  const t = (await env.KV.get("tc:" + h, "json")) || [];
  if (t.filter((x) => x.at >= since).length) out.push("타임머신 카메라로 동네 사진을 옛날·미래 모습으로 바꿔 봄");
  const sh = (await env.KV.get("shorts:" + h, "json")) || [];
  for (const x of sh.filter((x) => x.made >= since).slice(0, 3)) out.push("유튜브 숏츠 '" + x.title + "' 만들어 올림");
  return out;
}

export async function novelApi(env, ctx, path, b, h) {
  if (path === "/novel/state") return view(env, await load(env, h));
  if (path === "/novel/settings") {
    const d = await load(env, h);
    if (Array.isArray(b.names)) d.names = [0, 1].map((i) => String(b.names[i] || d.names[i]).trim().slice(0, 12) || d.names[i]);
    if (STYLES[b.style]) d.style = b.style;
    await save(env, h, d); return view(env, d);
  }
  if (path === "/novel/write") return write(env, ctx, b, h);
  if (path === "/novel/poll") return poll(env, b, h);
  if (path === "/novel/del") {
    const d = await load(env, h), c = d.chapters[d.chapters.length - 1];
    if (c && c.n === Number(b.n)) { d.chapters.pop(); if (c.img) await env.R2.delete(c.img).catch(() => {}); await save(env, h, d); }
    return view(env, d);
  }
  throw nerr("not_found", 404);
}

async function write(env, ctx, b, h) {
  const d = await load(env, h), day = cnDay(), cap = Number(env.NOVEL_DAY_MAX) || 3;
  if ((d.gen[day] || 0) >= cap) throw nerr("오늘은 " + cap + "화까지 썼어요. 작가도 쉬어야죠 😌", 429);
  const prev = d.chapters[d.chapters.length - 1];
  const since = prev ? prev.at : Date.now() - 21 * 86400e3;
  const mat = await material(env, h, since);
  const memo = String(b.memo || "").trim().slice(0, 300);
  if (!mat.length && !memo) throw nerr("지난 화 이후 기록이 없어요. '이번 주 한 줄'에 있었던 일을 적어 주세요.");
  const n = (prev ? prev.n : 0) + 1;
  const story = d.chapters.slice(-6).map((c) => c.n + "화 '" + c.title + "': " + c.summary).join("\n");
  const [a, z] = d.names;
  const sys = "너는 한국어 연재 소설 작가다. 주인공은 광저우에 사는 한국인 40대 부부 '" + a + "'와 '" + z + "'(주재원과 그 배우자). " + STYLES[d.style][1] +
    " 규칙: 아래 '이번 화 재료'의 실제 사건을 뼈대로 쓰되 장면·대화·감정은 상상해서 채운다. 실제 가게·사람을 나쁘게 그리지 않는다. 정치·민감한 주제 금지. 분량 900~1300자, 문단 사이 빈 줄. 이전 화와 자연스럽게 이어지게(지난 줄거리 참고), 매 화 제목을 붙인다." +
    ' 삽화용 img 는 이 화의 대표 장면을 그림 생성 모델에 줄 중국어 묘사(水彩插画风格, 温暖色调, 广州街景细节, 两个人物从背后或远景出现, 不要文字). JSON만 출력: {"title":"","text":"","summary":"다음 화를 위한 2문장 요약","img":""}';
  const user = "회차: " + n + "화\n지난 줄거리:\n" + (story || "(첫 화 — 두 사람과 광저우 생활을 소개하며 시작)") + "\n\n이번 화 재료:\n" + (mat.map((x) => "- " + x).join("\n") || "(기록 없음)") + (memo ? "\n- 직접 적은 한 줄: " + memo : "");
  const o = await qwen(env, [{ role: "system", content: sys }, { role: "user", content: user }]);
  const text = String(o.text || "").trim();
  if (text.length < 300) throw nerr("원고가 너무 짧게 나왔어요. 다시 눌러 주세요.", 502);
  const ch = { n, title: String(o.title || n + "화").slice(0, 40), text: text.slice(0, 3000), summary: String(o.summary || "").slice(0, 300), at: Date.now(), task: "" };
  // 삽화 — 실패해도 원고는 남김
  try {
    const r = await fetch("https://" + host(env) + "/api/v1/services/aigc/text2image/image-synthesis", {
      method: "POST", headers: { authorization: "Bearer " + env.DASHSCOPE_API_KEY, "content-type": "application/json", "X-DashScope-Async": "enable" },
      body: JSON.stringify({ model: env.NOVEL_T2I_MODEL || env.SHORTS_T2I_MODEL || "wan2.5-t2i-preview",
        input: { prompt: String(o.img || "广州街头，一对中年夫妻的背影").slice(0, 400) + "，水彩插画，温暖柔和的色调，书籍插图，细节丰富", negative_prompt: "文字，水印，logo，低质量，畸形的手，正脸特写" },
        parameters: { size: "1024*768", n: 1, prompt_extend: true, watermark: false } }),
    });
    const j = await r.json().catch(() => ({}));
    ch.task = (j.output && j.output.task_id) || "";
  } catch {}
  d.chapters.push(ch); d.chapters = d.chapters.slice(-60);
  d.gen = { [day]: (d.gen[day] || 0) + 1 };
  await save(env, h, d);
  ctx.waitUntil(logUse(env, "novel", { write: 1, ["s_" + d.style]: 1 }, 0, h).catch(() => {}));
  return { ...(await view(env, d)), wrote: n, used: mat.length };
}

async function poll(env, b, h) {
  const d = await load(env, h), c = d.chapters.find((x) => x.n === Number(b.n));
  if (!c || !c.task) return view(env, d);
  const r = await fetch("https://" + host(env) + "/api/v1/tasks/" + c.task, { headers: { authorization: "Bearer " + env.DASHSCOPE_API_KEY } });
  const j = await r.json().catch(() => ({}));
  const st = (j.output && j.output.task_status) || "UNKNOWN";
  if (st === "PENDING" || st === "RUNNING") return { ...(await view(env, d)), status: st };
  const hit = ((j.output && j.output.results) || []).find((x) => x && x.url);
  if (st === "SUCCEEDED" && hit) {
    const im = await fetch(hit.url);
    if (im.ok) { c.img = "nv/" + h + "/" + c.n + ".png"; await env.R2.put(c.img, im.body, { httpMetadata: { contentType: "image/png" } }); }
  }
  c.task = "";
  await save(env, h, d);
  return { ...(await view(env, d)), status: st };
}

export async function novelGet(req, env, url) {
  if (url.pathname === "/novel/img") {
    const k = url.searchParams.get("k") || "";
    if (!/^nv\/[0-9a-f]{12}\/\d+\.png$/.test(k) || url.searchParams.get("s") !== (await hmac16(env, k))) return new Response("forbidden", { status: 403 });
    const o = await env.R2.get(k);
    if (!o) return new Response("not found", { status: 404 });
    return new Response(o.body, { headers: { "content-type": "image/png", "cache-control": "private, max-age=31536000" } });
  }
  return new Response("not found", { status: 404 });
}

export const NOVEL_HTML = String.raw`<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#1664B0">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="우리 연재 소설">
<link rel="apple-touch-icon" href="/icon-180.png">
<title>우리 연재 소설</title>
<style>
:root{--sky:#1664B0;--bg:#EFE8DE;--card:#F7F2EA;--paper:#FBF7EF;--ink:#1A2330;--ink2:#5E6672;--line:#D9CEBD;--red:#D21624;--soft:#E6DCCB}
@media (prefers-color-scheme:dark){:root{--bg:#141A22;--card:#1C2430;--paper:#1F2633;--ink:#EDE6DA;--ink2:#9AA3AE;--line:#2C3644;--soft:#253041}}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,"Apple SD Gothic Neo","PingFang SC",system-ui,sans-serif;-webkit-text-size-adjust:100%}
header{background:var(--sky);color:#fff;padding:calc(env(safe-area-inset-top) + 14px) 16px 14px;border-bottom:3px solid var(--red);display:flex;align-items:center;gap:12px}
header h1{margin:0;font-size:19px}a.back{color:#fff;text-decoration:none;font-size:20px}
main{max-width:640px;margin:0 auto;padding:14px 16px 60px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:12px}.card h2{margin:0 0 8px;font-size:16px}
.lbl{font-size:12.5px;color:var(--ink2);margin:10px 0 6px}.note{font-size:12.5px;color:var(--ink2);margin:6px 0 0}.err{color:var(--red);font-size:13.5px;margin-top:8px}
input[type=text],textarea{width:100%;font:inherit;font-size:16px;padding:9px 10px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink)}textarea{min-height:64px;resize:vertical}
.row{display:flex;gap:8px}.row input{flex:1}
.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{border:1px solid var(--line);background:transparent;color:var(--ink);border-radius:999px;padding:6px 12px;font:inherit;font-size:13.5px}.chip.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.big{display:block;width:100%;border:0;border-radius:12px;background:var(--sky);color:#fff;font:inherit;font-weight:700;font-size:16px;padding:14px;margin-top:12px}.big:disabled{opacity:.5}
.toc a{display:flex;justify-content:space-between;padding:8px 0;border-top:1px solid var(--line);color:var(--ink);text-decoration:none}.toc a:first-child{border-top:0}.toc small{color:var(--ink2)}
.ch{background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:18px 18px 22px;margin-bottom:14px}
.ch .no{font-size:12.5px;color:var(--ink2);letter-spacing:1px}.ch h3{margin:2px 0 12px;font-size:21px;font-family:"Apple SD Gothic Neo",serif}
.ch img{width:100%;border-radius:10px;display:block;margin-bottom:14px;background:var(--soft)}
.ch .wait{height:120px;border-radius:10px;background:var(--soft);display:flex;align-items:center;justify-content:center;color:var(--ink2);font-size:13px;margin-bottom:14px}
.ch .tx{white-space:pre-wrap;font-size:16.5px;line-height:1.85;font-family:"Apple SD Gothic Neo","Nanum Myeongjo",serif}
.ch .del{border:0;background:none;color:var(--ink2);font-size:12px;margin-top:10px;padding:0}
.toast{position:fixed;left:50%;bottom:calc(20px + env(safe-area-inset-bottom));transform:translateX(-50%);background:var(--ink);color:var(--bg);padding:10px 16px;border-radius:999px;font-size:14px;z-index:9;max-width:90vw;text-align:center}
.spin{display:inline-block;animation:sp 1.2s linear infinite}@keyframes sp{to{transform:rotate(360deg)}}
.gate{padding:40px 0;text-align:center}
</style></head><body>
<header><a class="back" href="/hub" aria-label="도구함">‹</a><h1>📖 우리 연재 소설</h1></header>
<main id="main"><div class="gate">불러오는 중…</div></main>
<script>
var CODE='';try{CODE=localStorage.getItem('pb-code')||'';}catch(e){}
var S=null,BUSY=false,POLL={};
function $(i){return document.getElementById(i);}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function toast(t){var d=document.createElement('div');d.className='toast';d.textContent=t;document.body.appendChild(d);setTimeout(function(){d.remove();},3200);}
function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}
function api(p,b,tries){b=b||{};b.code=CODE;tries=tries==null?1:tries;return fetch(p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json().catch(function(){return {error:'서버 응답 오류 '+r.status};});},function(){if(tries>0)return sleep(1500).then(function(){return api(p,b,tries-1);});return {error:'network',detail:'네트워크가 끊겼어요.'};});}
function gate(m){$('main').innerHTML='<div class="gate"><p>'+esc(m||'박비서 초대 코드를 넣어 주세요')+'</p><input id="cd" placeholder="초대 코드" style="max-width:220px"> <button id="go">열기</button></div>';$('go').onclick=function(){CODE=$('cd').value.trim();try{localStorage.setItem('pb-code',CODE);}catch(e){}load();};}
function load(){if(!CODE)return gate();api('/novel/state').then(function(j){if(j.error==='not_allowed')return gate('초대 코드가 맞지 않아요');if(!j.ok)return gate(j.detail||j.error);S=j;render();});}
function render(){
  var mv=$('memo')?$('memo').value:'';
  var h='<div class="card"><h2>✍️ 다음 화 쓰기</h2><p class="note" style="margin-top:0">지난 화 이후의 주말 탐험·미스터리·간판 사냥·타임머신·숏츠 기록이 자동으로 재료가 돼요. 기록에 없는 일은 한 줄로 적어 주세요.</p>'
   +'<p class="lbl">이번 주 한 줄 (선택)</p><textarea id="memo" placeholder="예: 토요일에 사우디 커피 마시러 갔는데 너무 진해서 둘 다 잠 못 잠"></textarea>'
   +'<button class="big" id="write">📖 '+((S.chapters.length?S.chapters[S.chapters.length-1].n:0)+1)+'화 쓰기</button><div class="err" id="er"></div>'
   +'<details style="margin-top:10px"><summary class="note" style="margin:0">⚙ 주인공 이름 · 문체</summary><p class="lbl">주인공 이름</p><div class="row"><input type="text" id="n1" value="'+esc(S.names[0])+'"><input type="text" id="n2" value="'+esc(S.names[1])+'"></div>'
   +'<p class="lbl">문체</p><div class="chips">'+Object.keys(S.styles).map(function(k){return '<button class="chip'+(k===S.style?' on':'')+'" data-st="'+k+'">'+esc(S.styles[k])+'</button>';}).join('')+'</div></details></div>';
  if(S.chapters.length>1)h+='<div class="card"><h2>목차</h2><div class="toc">'+S.chapters.slice().reverse().map(function(c){return '<a href="#c'+c.n+'"><span>'+c.n+'화 · '+esc(c.title)+'</span><small>'+new Date(c.at).toLocaleDateString('ko-KR',{month:'numeric',day:'numeric'})+'</small></a>';}).join('')+'</div></div>';
  var last=S.chapters.length?S.chapters[S.chapters.length-1].n:0;
  h+=S.chapters.slice().reverse().map(function(c){return '<div class="ch" id="c'+c.n+'"><div class="no">제 '+c.n+' 화</div><h3>'+esc(c.title)+'</h3>'
    +(c.imgUrl?'<img src="'+esc(c.imgUrl)+'" alt="" loading="lazy">':c.task?'<div class="wait"><span class="spin">🎨</span>&nbsp;삽화 그리는 중…</div>':'')
    +'<div class="tx">'+esc(c.text)+'</div>'+(c.n===last?'<button class="del" data-del="'+c.n+'">이 화 지우고 다시 쓰기</button>':'')+'</div>';}).join('');
  if(!S.chapters.length)h+='<p class="note" style="text-align:center">아직 1화가 없어요. 첫 화를 써 보세요!</p>';
  $('main').innerHTML=h;if(mv)$('memo').value=mv;bind();
  S.chapters.forEach(function(c){if(c.task&&!POLL[c.n]){POLL[c.n]=1;poll(c.n);}});
}
function bind(){
  $('write').onclick=write;
  document.querySelectorAll('[data-st]').forEach(function(b){b.onclick=function(){api('/novel/settings',{style:b.getAttribute('data-st')}).then(function(j){if(j.ok){S=j;render();}});};});
  [$('n1'),$('n2')].forEach(function(i){i.onchange=function(){api('/novel/settings',{names:[$('n1').value,$('n2').value]}).then(function(j){if(j.ok){S=j;toast('이름 저장됨');}});};});
  document.querySelectorAll('[data-del]').forEach(function(b){b.onclick=function(){if(!b.getAttribute('data-sure')){b.setAttribute('data-sure','1');b.textContent='한 번 더 누르면 지워요';return;}api('/novel/del',{n:+b.getAttribute('data-del')}).then(function(j){if(j.ok){S=j;render();}});};});
}
function write(){
  if(BUSY)return;BUSY=true;var b=$('write');b.disabled=true;$('er').textContent='';b.innerHTML='<span class="spin">✍️</span> 작가가 쓰는 중… (30초쯤)';
  api('/novel/write',{memo:$('memo').value}).then(function(j){BUSY=false;if(!j.ok){b.disabled=false;b.textContent='📖 다시 쓰기';$('er').textContent=j.detail||j.error;return;}
    $('memo').value='';S=j;render();var e=$('c'+j.wrote);if(e)e.scrollIntoView({block:'start',behavior:'smooth'});toast(j.wrote+'화 완성! (기록 '+j.used+'개 반영)');});
}
function poll(n){api('/novel/poll',{n:n}).then(function(j){if(!j.ok){delete POLL[n];return;}var c=j.chapters.filter(function(x){return x.n===n;})[0];
  if(c&&c.task){setTimeout(function(){poll(n);},5000);return;}delete POLL[n];S.chapters=j.chapters;var y=window.scrollY;render();window.scrollTo(0,y);});}
load();
</script></body></html>`;
