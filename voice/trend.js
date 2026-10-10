// =========================================================
// 🔥 오늘의 중국 인터넷 — 웨이보·더우인 등에서 지금 뜨는 이슈와 유행어를 한국어로 5줄 해설 (박비서와 같은 초대 코드)
//  GET  /trend                 화면
//  POST /trend/today {code, fresh?}   → 오늘 판(중국 날짜 기준 하루 한 번 만들어 KV 공유 캐시, 새로고침은 하루 3번)
//  GET  /trend/say?t&s                → 중국어 문장 읽어 주기(CosyVoice, R2 캐시, 서명)
// 千问 enable_search(forced_search, enable_source) 로 실제 검색 결과만 근거로 — 정치·사회 갈등 이슈는 빼고 생활·연예·밈·소비 위주
// 저장: KV trend:<날짜>(3일), trend:re:<날짜>
// [필수] AI 는 百炼(千问)만 — Anthropic 호출 없음
// =========================================================
import { logUse } from "./usage.js";

const cnDay = (t = Date.now()) => new Date(t + 8 * 3600e3).toISOString().slice(0, 10);
const host = (env) => (env.DASHSCOPE_WS_HOST || "dashscope.aliyuncs.com").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
const terr = (message, status = 400) => Object.assign(new Error(message), { code: "trend", status });
async function hmac16(env, s) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode("tr|" + (env.ALLOWED_CODES || "") + (env.DASHSCOPE_API_KEY || "")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(s));
  return [...new Uint8Array(sig)].slice(0, 8).map((x) => x.toString(16).padStart(2, "0")).join("");
}
const sayUrl = async (env, t) => "/trend/say?t=" + encodeURIComponent(t) + "&s=" + (await hmac16(env, "say|" + t));

async function withSay(env, d) {
  for (const x of d.items || []) if (x.word && x.word.z) x.word.say = await sayUrl(env, x.word.z);
  if (d.office && d.office.z) d.office.say = await sayUrl(env, d.office.z);
  return d;
}

export async function trendApi(env, ctx, path, b, h) {
  if (path !== "/trend/today") throw terr("not_found", 404);
  const day = cnDay(), key = "trend:" + day;
  let d = await env.KV.get(key, "json");
  if (d && b.fresh) {
    const rk = "trend:re:" + day, n = Number(await env.KV.get(rk)) || 0;
    if (n >= (Number(env.TREND_REFRESH_MAX) || 3)) throw terr("오늘 새로고침은 다 썼어요. 내일 아침에 새 판이 나와요.", 429);
    await env.KV.put(rk, String(n + 1), { expirationTtl: 3 * 86400 });
    d = null;
  }
  if (!d) {
    d = await make(env, day);
    await env.KV.put(key, JSON.stringify(d), { expirationTtl: 3 * 86400 });
    ctx.waitUntil(logUse(env, "trend", { make: 1 }, 0, h).catch(() => {}));
  }
  ctx.waitUntil(logUse(env, "trend", { open: 1 }, 0, h).catch(() => {}));
  return { ok: true, ...(await withSay(env, JSON.parse(JSON.stringify(d)))) };
}

async function make(env, day) {
  const sys = "你是给住在广州的韩国中年上班族（公司里大多是中国同事）讲解中国网络热点的编辑。请联网搜索今天（" + day + "）微博热搜、抖音热榜、小红书、B站等平台上正在火的话题和流行语，" +
    "优先选中国网友自己在热议、在玩梗的话题（热搜榜前列、评论区刷屏、二创/表情包），只选生活、娱乐、明星综艺、影视、体育、美食、消费、新奇科技产品、网络梗、天气节气这类轻松话题；不要企业专利诉讼、财报、行业新闻这类硬新闻，不要韩国媒体报道的韩国相关新闻；不要政治、外交、军事、社会冲突、灾难伤亡、案件、敏感人物。必须基于搜索到的真实内容，不确定就不要写。" +
    "选5条，用韩语讲解：ko(韩语标题,20字内)、what(发生了什么,2句)、why(为什么火/中国人笑点,1句)、word(从这个话题里学一个中国网友真在用的流行语或梗：z 必须是汉字(可带少量字母，如'CP')，不能只写英文缩写；p 是 z 的带声调拼音；k 韩语意思，人名按韩国通用译名，如孙悟空=손오공)、emo(一个emoji)、src(来源平台名，如微博)。" +
    "另外给 office：明天在公司可以跟中国同事聊这个的一句中文开场白（z,p,k）。" +
    '只输出 JSON：{"items":[{"zh":"原话题(中文)","ko":"","what":"","why":"","word":{"z":"","p":"","k":""},"emo":"","src":""}],"office":{"z":"","p":"","k":""}}';
  let last = "";
  // 모델 × 검색 옵션(지원 안 하면 400 → 옵션 줄여서) 순서로 시도
  const tries = [];
  for (const model of [env.TREND_MODEL, "qwen-plus", env.QUEST_MODEL || "qwen3.8-flash"].filter(Boolean)) {
    tries.push({ model, so: { forced_search: true, enable_source: true, search_strategy: "pro" } }, { model, so: { forced_search: true, enable_source: true } }, { model, so: null });
  }
  for (const { model, so } of tries) {
    let r;
    try {
      r = await fetch("https://" + host(env) + "/compatible-mode/v1/chat/completions", {
        method: "POST", headers: { authorization: "Bearer " + env.DASHSCOPE_API_KEY, "content-type": "application/json" },
        body: JSON.stringify(Object.assign({ model, temperature: 0.4, enable_thinking: false, enable_search: true,
          messages: [{ role: "system", content: sys }, { role: "user", content: "今天是 " + day + "。开始。" }] }, so ? { search_options: so } : {})),
      });
    } catch (e) { last = String(e.message || e); continue; }
    const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch {}
    if (!r.ok) { last = model + " " + r.status + ": " + ((j.error && j.error.message) || "").slice(0, 100); continue; }
    const c = String((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "");
    let o = null; try { o = JSON.parse(c); } catch { const a = c.indexOf("{"), z = c.lastIndexOf("}"); if (a >= 0 && z > a) try { o = JSON.parse(c.slice(a, z + 1)); } catch {} }
    if (!o || !Array.isArray(o.items) || o.items.length < 3) { last = model + ": 결과 부족"; continue; }
    const srcs = ((j.search_info && j.search_info.search_results) || []).slice(0, 8).map((s) => ({ t: String(s.title || s.site_name || "").slice(0, 60), u: String(s.url || "") })).filter((s) => /^https?:\/\//.test(s.u));
    const w = (x) => x && x.z ? { z: String(x.z).slice(0, 40), p: String(x.p || "").slice(0, 80), k: String(x.k || "").slice(0, 60) } : null;
    // 한국 매체 출처·한글 섞인 출처는 '중국 인터넷'이 아니므로 뺌
    o.items = o.items.filter((x) => !/[\uAC00-\uD7A3]/.test(String(x.src || "") + String(x.zh || "")));
    if (o.items.length < 3) { last = model + ": 중국 화제 부족"; continue; }
    return { day, made: Date.now(), model, sources: srcs,
      items: o.items.slice(0, 5).map((x) => ({ zh: String(x.zh || "").slice(0, 40), ko: String(x.ko || "").slice(0, 40), what: String(x.what || "").slice(0, 200), why: String(x.why || "").slice(0, 140), word: w(x.word), emo: String(x.emo || "🔥").slice(0, 4), src: String(x.src || "").slice(0, 12) })),
      office: w(o.office) };
  }
  throw terr("오늘 판을 만들지 못했어요(" + last + "). 잠시 뒤 다시 열어 주세요.", 502);
}

export async function trendGet(req, env, url, synth) {
  if (url.pathname === "/trend/say") {
    const t = String(url.searchParams.get("t") || "").slice(0, 60);
    if (!t || url.searchParams.get("s") !== (await hmac16(env, "say|" + t))) return new Response("forbidden", { status: 403 });
    const key = "tts/trend/" + (await hmac16(env, "k|" + t)) + ".mp3";
    const head = { "content-type": "audio/mpeg", "cache-control": "private, max-age=31536000" };
    const hit = await env.R2.get(key);
    if (hit) return new Response(hit.body, { headers: head });
    let mp3 = null;
    try { mp3 = await synth(env, env.QUEST_VOICE || "longxiaochun_v2", t, env.QUEST_TTS_MODEL || "cosyvoice-v2"); } catch (e) { return new Response("tts: " + String(e.message || e).slice(0, 160), { status: 502 }); }
    await env.R2.put(key, mp3, { httpMetadata: { contentType: "audio/mpeg" } });
    return new Response(mp3, { headers: head });
  }
  return new Response("not found", { status: 404 });
}

export const TREND_HTML = String.raw`<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#1664B0">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="오늘의 중국 인터넷">
<link rel="apple-touch-icon" href="/icon-180.png">
<title>오늘의 중국 인터넷</title>
<style>
:root{--sky:#1664B0;--bg:#EFE8DE;--card:#F7F2EA;--ink:#1A2330;--ink2:#5E6672;--line:#D9CEBD;--red:#D21624;--soft:#E6DCCB}
@media (prefers-color-scheme:dark){:root{--bg:#141A22;--card:#1C2430;--ink:#EDE6DA;--ink2:#9AA3AE;--line:#2C3644;--soft:#253041}}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 -apple-system,"Apple SD Gothic Neo","PingFang SC",system-ui,sans-serif;-webkit-text-size-adjust:100%}
header{background:var(--sky);color:#fff;padding:calc(env(safe-area-inset-top) + 14px) 16px 14px;border-bottom:3px solid var(--red);display:flex;align-items:center;gap:12px}
header h1{margin:0;font-size:19px}a.back{color:#fff;text-decoration:none;font-size:20px}header small{margin-left:auto;font-size:12.5px;opacity:.9}
main{max-width:640px;margin:0 auto;padding:14px 16px 60px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:12px}
.it .hd{display:flex;gap:10px;align-items:flex-start}.it .n{flex:none;width:30px;height:30px;border-radius:50%;background:var(--red);color:#fff;font-weight:800;display:flex;align-items:center;justify-content:center}
.it h2{margin:0;font-size:17px;line-height:1.35}.it .zh{font-size:13px;color:var(--ink2)}.it .src{font-size:11.5px;border:1px solid var(--line);border-radius:999px;padding:0 7px;margin-left:4px}
.it p{margin:8px 0 0}.it .why{color:var(--ink2);font-size:14px}
.word{display:flex;align-items:center;gap:10px;margin-top:10px;background:var(--soft);border-radius:10px;padding:8px 10px}.word b{font-size:17px}.word small{display:block;color:var(--ink2);font-size:12.5px}
.word button{margin-left:auto;border:0;background:var(--sky);color:#fff;border-radius:50%;width:36px;height:36px;font-size:16px;flex:none}
.office{border-left:4px solid var(--sky)}.office h3{margin:0 0 6px;font-size:15px}
.src-l a{display:block;font-size:12.5px;color:var(--ink2);padding:3px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.re{border:1px solid var(--line);background:transparent;color:var(--ink);border-radius:999px;padding:6px 12px;font:inherit;font-size:13px}
.note{font-size:12.5px;color:var(--ink2)}.err{color:var(--red)}
.toast{position:fixed;left:50%;bottom:calc(20px + env(safe-area-inset-bottom));transform:translateX(-50%);background:var(--ink);color:var(--bg);padding:10px 16px;border-radius:999px;font-size:14px;z-index:9;max-width:90vw;text-align:center}
.spin{display:inline-block;animation:sp 1.2s linear infinite}@keyframes sp{to{transform:rotate(360deg)}}
.gate{padding:40px 0;text-align:center}
</style></head><body>
<header><a class="back" href="/hub" aria-label="도구함">‹</a><h1>🔥 오늘의 중국 인터넷</h1><small id="day"></small></header>
<main id="main"><div class="gate"><span class="spin">🔥</span> 오늘 판 불러오는 중… (처음 여는 날은 30초쯤)</div></main>
<script>
var CODE='';try{CODE=localStorage.getItem('pb-code')||'';}catch(e){}
var S=null,AU=null;
function $(i){return document.getElementById(i);}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function toast(t){var d=document.createElement('div');d.className='toast';d.textContent=t;document.body.appendChild(d);setTimeout(function(){d.remove();},3200);}
function api(p,b){b=b||{};b.code=CODE;return fetch(p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json().catch(function(){return {error:'서버 응답 오류 '+r.status};});},function(){return {error:'network',detail:'네트워크가 끊겼어요.'};});}
function gate(m){$('main').innerHTML='<div class="gate"><p>'+esc(m||'박비서 초대 코드를 넣어 주세요')+'</p><input id="cd" placeholder="초대 코드" style="font:inherit;padding:8px;border-radius:8px;border:1px solid var(--line)"> <button id="go">열기</button></div>';$('go').onclick=function(){CODE=$('cd').value.trim();try{localStorage.setItem('pb-code',CODE);}catch(e){}load(false);};}
function load(fresh){if(!CODE)return gate();if(fresh)$('main').innerHTML='<div class="gate"><span class="spin">🔥</span> 새로 찾는 중… (30초쯤)</div>';
  api('/trend/today',{fresh:fresh}).then(function(j){if(j.error==='not_allowed')return gate('초대 코드가 맞지 않아요');if(!j.ok){if(S){render();toast(j.detail||j.error);}else $('main').innerHTML='<div class="gate err">'+esc(j.detail||j.error)+'<br><br><button class="re" onclick="load(false)">다시</button></div>';return;}S=j;render();});}
function wordHtml(w){return w?'<div class="word"><div><b>'+esc(w.z)+'</b><small>'+esc(w.p)+' · '+esc(w.k)+'</small></div><button data-say="'+esc(w.say||'')+'" aria-label="듣기">🔊</button></div>':'';}
function render(){
  $('day').textContent=S.day;
  var h=S.items.map(function(x,i){return '<div class="card it"><div class="hd"><div class="n">'+(i+1)+'</div><div><h2>'+esc(x.emo)+' '+esc(x.ko)+'</h2><div class="zh">'+esc(x.zh)+(x.src?'<span class="src">'+esc(x.src)+'</span>':'')+'</div></div></div>'
    +'<p>'+esc(x.what)+'</p><p class="why">💡 '+esc(x.why)+'</p>'+wordHtml(x.word)+'</div>';}).join('');
  if(S.office)h+='<div class="card office"><h3>🏢 내일 회사에서 한마디</h3>'+wordHtml(S.office)+'</div>';
  if(S.sources&&S.sources.length)h+='<div class="card"><details><summary class="note">📎 근거로 쓴 검색 결과 '+S.sources.length+'개</summary><div class="src-l">'+S.sources.map(function(s){return '<a href="'+esc(s.u)+'" target="_blank" rel="noopener">'+esc(s.t||s.u)+'</a>';}).join('')+'</div></details></div>';
  h+='<p class="note" style="text-align:center">AI가 검색 결과로 정리한 거라 틀릴 수 있어요. 정치·사건 이슈는 일부러 뺐어요.<br><button class="re" id="re" style="margin-top:8px">🔄 지금 다시 찾기</button></p>';
  $('main').innerHTML=h;
  document.querySelectorAll('[data-say]').forEach(function(b){b.onclick=function(){var u=b.getAttribute('data-say');if(!u)return;try{if(AU)AU.pause();AU=new Audio(u);var p=AU.play();if(p&&p.catch)p.catch(function(){toast('소리를 재생하지 못했어요');});}catch(e){}};});
  $('re').onclick=function(){load(true);};
}
load(false);
</script></body></html>`;
