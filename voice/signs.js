// =========================================================
// 🪧 간판 사냥 — 길에서 본 웃긴·이상한 중국어 간판/메뉴/안내문을 찍으면 직역 개그 + 진짜 뜻 + 쓸만한 단어, 도감으로 모음
//  GET  /signs                화면 (박비서와 같은 초대 코드)
//  POST /signs/list  {code}            → 도감·점수·배지
//  POST /signs/hunt  {code, image}     → 千问 VL 판독 → 통과하면 R2 저장·도감 추가
//  POST /signs/del   {code, id}        → 도감에서 빼기(사진도 삭제)
//  GET  /signs/img?k&s                 → 사진(서명)
// 저장: KV sg:<코드해시> {items(300), pts}, R2 sg/<코드해시>/<id>.jpg
// [필수] AI 는 百炼(千问)만 — Anthropic 호출 없음
// =========================================================
import { logUse } from "./usage.js";

const TYPES = { engrish: "🤪 엉뚱한 영어", pun: "😏 말장난", big: "📢 과장 광고", name: "🏷 희한한 가게 이름", wisdom: "🧘 생활 명언", rule: "🚫 이상한 안내문", plain: "📄 평범" };
const BADGES = [
  { k: "n1", icon: "🪧", name: "첫 사냥", need: (d) => d.items.length >= 1 },
  { k: "n10", icon: "📚", name: "간판 수집가", need: (d) => d.items.length >= 10 },
  { k: "n30", icon: "🏛", name: "간판 박물관장", need: (d) => d.items.length >= 30 },
  { k: "lol3", icon: "🤣", name: "배꼽 도둑", need: (d) => d.items.filter((x) => x.fun >= 5).length >= 3 },
  { k: "eng5", icon: "🤪", name: "Engrish 헌터", need: (d) => d.items.filter((x) => x.type === "engrish").length >= 5 },
  { k: "all", icon: "🌈", name: "종류 다 모음", need: (d) => Object.keys(TYPES).filter((t) => t !== "plain").every((t) => d.items.some((x) => x.type === t)) },
];
const cnDay = (t = Date.now()) => new Date(t + 8 * 3600e3).toISOString().slice(0, 10);
const host = (env) => (env.DASHSCOPE_WS_HOST || "dashscope.aliyuncs.com").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
const serr = (message, status = 400) => Object.assign(new Error(message), { code: "signs", status });

async function hmac16(env, s) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode("sg|" + (env.ALLOWED_CODES || "") + (env.DASHSCOPE_API_KEY || "")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(s));
  return [...new Uint8Array(sig)].slice(0, 8).map((x) => x.toString(16).padStart(2, "0")).join("");
}
function b64bytes(b64) { const s = atob(String(b64).replace(/^data:[^,]+,/, "")); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
async function load(env, h) { const d = (await env.KV.get("sg:" + h, "json")) || {}; return { items: d.items || [], pts: d.pts || 0, badges: d.badges || [], gen: d.gen || {} }; }
async function view(env, d) {
  return { ok: true, pts: d.pts, types: TYPES, badges: BADGES.map((b) => ({ k: b.k, icon: b.icon, name: b.name, got: d.badges.includes(b.k) })),
    items: await Promise.all(d.items.map(async (x) => ({ ...x, img: undefined, imgUrl: x.img ? "/signs/img?k=" + encodeURIComponent(x.img) + "&s=" + (await hmac16(env, x.img)) : "" }))) };
}

export async function signsApi(env, ctx, path, b, h) {
  if (path === "/signs/list") return view(env, await load(env, h));
  if (path === "/signs/hunt") return hunt(env, ctx, b, h);
  if (path === "/signs/del") {
    const d = await load(env, h), x = d.items.find((y) => y.id === b.id);
    if (x) { d.items = d.items.filter((y) => y.id !== b.id); d.pts = Math.max(0, d.pts - (x.pts || 0)); if (x.img) await env.R2.delete(x.img).catch(() => {}); await env.KV.put("sg:" + h, JSON.stringify(d)); }
    return view(env, d);
  }
  throw serr("not_found", 404);
}

async function hunt(env, ctx, b, h) {
  const img = String(b.image || "");
  if (!/^data:image\/jpeg;base64,/.test(img)) throw serr("사진이 필요해요.");
  if (img.length > 4_000_000) throw serr("사진이 너무 커요.");
  const d = await load(env, h), day = cnDay(), cap = Number(env.SIGNS_DAY_MAX) || 40;
  if ((d.gen[day] || 0) >= cap) throw serr("오늘은 " + cap + "장까지 사냥했어요. 내일 또!", 429);
  const prompt = "这是'招牌猎人'游戏：在中国（广州）街头拍到的招牌、菜单、告示、包装上的文字。读出图里最有看点的中文（和中式英文），给住在广州的韩国中年夫妇讲解。\n" +
    "要求：literal 是逐字直译成韩语、故意保留字面意思的搞笑版本；real 是真正的意思（自然韩语）；why 用韩语1~2句说明好笑点或文化背景，语气轻松不嘲讽当地人；" +
    "type 从 engrish(奇怪英文翻译) pun(谐音双关) big(夸张广告) name(奇特店名) wisdom(人生哲理/鸡汤) rule(奇怪的规定告示) plain(普通) 里选一个；fun 1~5 是好笑/稀奇程度（普通招牌给1~2，真的离谱才给5）；" +
    "learn 是图里一个在生活中用得上的词（z 汉字, p 带声调拼音, k 韩语）。如果图里没有可读的中文文字，ok=false 并在 why 里用韩语说明。\n" +
    '只输出 JSON：{"ok":true,"zh":"原文(最多40字)","py":"拼音","literal":"","real":"","why":"","type":"","fun":3,"learn":{"z":"","p":"","k":""}}';
  const r = await fetch("https://" + host(env) + "/compatible-mode/v1/chat/completions", {
    method: "POST", headers: { authorization: "Bearer " + env.DASHSCOPE_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ model: env.SIGNS_VL_MODEL || env.QUEST_VL_MODEL || "qwen3-vl-plus", temperature: 0.8, response_format: { type: "json_object" }, enable_thinking: false,
      messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: img } }, { type: "text", text: prompt }] }] }),
  });
  const t = await r.text();
  let j = {}; try { j = JSON.parse(t); } catch {}
  if (!r.ok) throw serr("千问 " + r.status + ": " + ((j.error && j.error.message) || t.slice(0, 140)) + (r.status >= 500 ? " — 잠시 뒤 다시" : ""), 502);
  const c = String((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "");
  let o = null; try { o = JSON.parse(c); } catch { const a = c.indexOf("{"), z = c.lastIndexOf("}"); try { o = JSON.parse(c.slice(a, z + 1)); } catch {} }
  if (!o) throw serr("판독 결과를 읽지 못했어요. 다시 찍어 주세요.", 502);
  if (o.ok === false || o.ok === "false" || !o.zh) return { ...(await view(env, d)), result: { ok: false, why: String(o.why || "중국어 글자를 못 찾았어요. 글자가 크게 나오게 다시 찍어 주세요.").slice(0, 200) } };
  const type = TYPES[o.type] ? o.type : "plain", fun = Math.max(1, Math.min(5, Math.round(Number(o.fun) || 2)));
  const id = "g" + Date.now().toString(36);
  const key = "sg/" + h + "/" + id + ".jpg";
  await env.R2.put(key, b64bytes(img), { httpMetadata: { contentType: "image/jpeg" } });
  const item = { id, at: Date.now(), zh: String(o.zh).slice(0, 60), py: String(o.py || "").slice(0, 120), literal: String(o.literal || "").slice(0, 120), real: String(o.real || "").slice(0, 120),
    why: String(o.why || "").slice(0, 240), type, fun, pts: fun * 10, img: key,
    learn: o.learn && o.learn.z ? { z: String(o.learn.z).slice(0, 20), p: String(o.learn.p || "").slice(0, 40), k: String(o.learn.k || "").slice(0, 40) } : null };
  d.items.unshift(item); d.items = d.items.slice(0, 300); d.pts += item.pts;
  d.gen = { [day]: (d.gen[day] || 0) + 1 };
  const before = new Set(d.badges), got = [];
  for (const bd of BADGES) if (!before.has(bd.k) && bd.need(d)) { d.badges.push(bd.k); got.push(bd.icon + " " + bd.name); }
  await env.KV.put("sg:" + h, JSON.stringify(d));
  ctx.waitUntil(logUse(env, "signs", { hunt: 1, ["t_" + type]: 1 }, 0, h).catch(() => {}));
  return { ...(await view(env, d)), result: { ok: true, id, got } };
}

export async function signsGet(req, env, url) {
  if (url.pathname === "/signs/img") {
    const k = url.searchParams.get("k") || "";
    if (!/^sg\/[0-9a-f]{12}\/[\w.-]+\.jpg$/.test(k) || url.searchParams.get("s") !== (await hmac16(env, k))) return new Response("forbidden", { status: 403 });
    const o = await env.R2.get(k);
    if (!o) return new Response("not found", { status: 404 });
    return new Response(o.body, { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=31536000" } });
  }
  return new Response("not found", { status: 404 });
}

export const SIGNS_HTML = String.raw`<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#1664B0">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="간판 사냥">
<link rel="apple-touch-icon" href="/icon-180.png">
<title>간판 사냥</title>
<style>
:root{--sky:#1664B0;--bg:#EFE8DE;--card:#F7F2EA;--ink:#1A2330;--ink2:#5E6672;--line:#D9CEBD;--red:#D21624;--soft:#E6DCCB;--gold:#B7791F}
@media (prefers-color-scheme:dark){:root{--bg:#141A22;--card:#1C2430;--ink:#EDE6DA;--ink2:#9AA3AE;--line:#2C3644;--soft:#253041;--gold:#E2B04A}}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,"Apple SD Gothic Neo","PingFang SC",system-ui,sans-serif;-webkit-text-size-adjust:100%}
header{background:var(--sky);color:#fff;padding:calc(env(safe-area-inset-top) + 14px) 16px 14px;border-bottom:3px solid var(--red);display:flex;align-items:center;gap:12px}
header h1{margin:0;font-size:19px}a.back{color:#fff;text-decoration:none;font-size:20px}header .pt{margin-left:auto;text-align:right;font-size:12px}header .pt b{display:block;font-size:20px;line-height:1.1}
main{max-width:640px;margin:0 auto;padding:14px 16px 60px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:12px}.card h2{margin:0 0 8px;font-size:16px}
.shoot{display:block;text-align:center;background:var(--red);color:#fff;border-radius:14px;padding:18px;font-weight:800;font-size:17px}.shoot input{display:none}.shoot small{display:block;font-weight:400;font-size:12.5px;opacity:.9;margin-top:2px}
.note{font-size:12.5px;color:var(--ink2);margin:6px 0 0}.err{color:var(--red);font-size:13.5px;margin-top:8px}
.bd{display:flex;flex-wrap:wrap;gap:6px}.bd span{border:1px solid var(--line);border-radius:999px;padding:3px 10px;font-size:13px}.bd span.off{opacity:.35}
.sg{border-top:1px solid var(--line);padding:12px 0;display:grid;grid-template-columns:96px 1fr;gap:10px}.sg:first-of-type{border-top:0}
.sg img{width:96px;height:96px;object-fit:cover;border-radius:10px;background:var(--soft);display:block}
.zh{font-size:18px;font-weight:700;line-height:1.35}.py{font-size:12.5px;color:var(--ink2)}
.lit{margin-top:6px;font-size:14.5px}.lit b{color:var(--gold)}.real{font-size:14.5px}.why{font-size:13px;color:var(--ink2);margin-top:4px}
.tag{display:inline-block;font-size:12px;border:1px solid var(--line);border-radius:999px;padding:1px 8px;margin-right:4px}.stars{color:var(--gold);font-size:13px}
.learn{display:inline-block;margin-top:6px;background:var(--soft);border-radius:8px;padding:3px 8px;font-size:13px}
.del{border:0;background:none;color:var(--ink2);font-size:12px;padding:0;margin-left:6px}
.new{outline:3px solid var(--gold);border-radius:12px;padding:10px;margin:-2px -2px 8px}
.filt{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px}.filt button{border:1px solid var(--line);background:transparent;color:var(--ink);border-radius:999px;padding:4px 10px;font:inherit;font-size:12.5px}.filt button.on{background:var(--ink);color:var(--bg)}
.toast{position:fixed;left:50%;bottom:calc(20px + env(safe-area-inset-bottom));transform:translateX(-50%);background:var(--ink);color:var(--bg);padding:10px 16px;border-radius:999px;font-size:14px;z-index:9;max-width:90vw;text-align:center}
.spin{display:inline-block;animation:sp 1.2s linear infinite}@keyframes sp{to{transform:rotate(360deg)}}
.gate{padding:40px 0;text-align:center}
</style></head><body>
<header><a class="back" href="/hub" aria-label="도구함">‹</a><h1>🪧 간판 사냥</h1><div class="pt" id="pt"></div></header>
<main id="main"><div class="gate">불러오는 중…</div></main>
<script>
var CODE='';try{CODE=localStorage.getItem('pb-code')||'';}catch(e){}
var S=null,F='',NEW='';
function $(i){return document.getElementById(i);}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function toast(t){var d=document.createElement('div');d.className='toast';d.textContent=t;document.body.appendChild(d);setTimeout(function(){d.remove();},3500);}
function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}
function api(p,b,tries){b=b||{};b.code=CODE;tries=tries==null?1:tries;return fetch(p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json().catch(function(){return {error:'서버 응답 오류 '+r.status};});},function(){if(tries>0)return sleep(1500).then(function(){return api(p,b,tries-1);});return {error:'network',detail:'네트워크가 끊겼어요.'};});}
function gate(m){$('main').innerHTML='<div class="gate"><p>'+esc(m||'박비서 초대 코드를 넣어 주세요')+'</p><input id="cd" placeholder="초대 코드" style="font:inherit;padding:8px;border-radius:8px;border:1px solid var(--line)"> <button id="go">열기</button></div>';$('go').onclick=function(){CODE=$('cd').value.trim();try{localStorage.setItem('pb-code',CODE);}catch(e){}load();};}
function load(){if(!CODE)return gate();api('/signs/list').then(function(j){if(j.error==='not_allowed')return gate('초대 코드가 맞지 않아요');if(!j.ok)return gate(j.detail||j.error);S=j;render();});}
function stars(n){var s='';for(var i=0;i<5;i++)s+=i<n?'★':'☆';return s;}
function itemHtml(x){
  return '<div class="sg'+(x.id===NEW?' new':'')+'" id="'+x.id+'"><img loading="lazy" src="'+esc(x.imgUrl)+'" alt="" onerror="this.style.visibility=\'hidden\'"><div>'
   +'<div class="zh">'+esc(x.zh)+'</div><div class="py">'+esc(x.py)+'</div>'
   +'<div class="lit"><b>직역:</b> '+esc(x.literal)+'</div><div class="real"><b>진짜 뜻:</b> '+esc(x.real)+'</div><div class="why">'+esc(x.why)+'</div>'
   +'<div style="margin-top:6px"><span class="tag">'+esc(S.types[x.type]||'')+'</span><span class="stars">'+stars(x.fun)+'</span> <small style="color:var(--ink2)">+'+x.pts+'</small><button class="del" data-del="'+x.id+'">빼기</button></div>'
   +(x.learn?'<span class="learn">📖 '+esc(x.learn.z)+' '+esc(x.learn.p)+' · '+esc(x.learn.k)+'</span>':'')+'</div></div>';
}
function render(){
  $('pt').innerHTML='점수<b>'+S.pts+'</b>';
  var h='<div class="card"><label class="shoot">📸 간판 찍기<small>웃긴 간판·메뉴판·안내문·엉뚱한 영어 — 글자가 크게 나오게</small><input type="file" id="file" accept="image/*" capture="environment"></label>'
   +'<label class="note" style="display:block;text-align:center;margin-top:8px"><u>앨범에서 고르기</u><input type="file" id="file2" accept="image/*" style="display:none"></label><div id="st"></div></div>';
  h+='<div class="card"><h2>🏅 배지</h2><div class="bd">'+S.badges.map(function(b){return '<span class="'+(b.got?'':'off')+'">'+b.icon+' '+esc(b.name)+'</span>';}).join('')+'</div></div>';
  var items=S.items.filter(function(x){return !F||(F==='lol'?x.fun>=4:x.type===F);});
  h+='<div class="card"><h2>📚 간판 도감 '+S.items.length+'장</h2><div class="filt"><button data-f="" class="'+(F===''?'on':'')+'">전체</button><button data-f="lol" class="'+(F==='lol'?'on':'')+'">🤣 ★4 이상</button>'
   +Object.keys(S.types).filter(function(t){return S.items.some(function(x){return x.type===t;});}).map(function(t){return '<button data-f="'+t+'" class="'+(F===t?'on':'')+'">'+esc(S.types[t])+'</button>';}).join('')+'</div>'
   +(items.length?items.map(itemHtml).join(''):'<p class="note">아직 없어요. 오늘 길에서 첫 간판을 잡아 보세요!</p>')+'</div>';
  $('main').innerHTML=h;bind();
}
function bind(){
  [$('file'),$('file2')].forEach(function(i){i.onchange=function(){var f=i.files&&i.files[0];i.value='';if(f)hunt(f);};});
  document.querySelectorAll('[data-f]').forEach(function(b){b.onclick=function(){F=b.getAttribute('data-f');render();};});
  document.querySelectorAll('[data-del]').forEach(function(b){b.onclick=function(){if(!b.getAttribute('data-sure')){b.setAttribute('data-sure','1');b.textContent='한 번 더 누르면 삭제';return;}api('/signs/del',{id:b.getAttribute('data-del')}).then(function(j){if(j.ok){S=j;render();}});};});
}
function shrink(file){return new Promise(function(ok,no){var u=URL.createObjectURL(file),im=new Image();im.onload=function(){var M=1280,w=im.naturalWidth,h=im.naturalHeight,s=Math.min(1,M/Math.max(w,h));var c=document.createElement('canvas');c.width=Math.round(w*s);c.height=Math.round(h*s);c.getContext('2d').drawImage(im,0,0,c.width,c.height);URL.revokeObjectURL(u);ok(c.toDataURL('image/jpeg',.85));};im.onerror=function(){no();};im.src=u;});}
function hunt(f){
  $('st').innerHTML='<p class="note" style="text-align:center"><span class="spin">🔍</span> 간판 해독 중… (10초쯤)</p>';
  shrink(f).then(function(d){return api('/signs/hunt',{image:d});}).then(function(j){
    if(!j.ok){$('st').innerHTML='<p class="err">'+esc(j.detail||j.error)+'</p>';return;}
    var r=j.result||{};if(!r.ok){$('st').innerHTML='<p class="err">'+esc(r.why)+'</p>';return;}
    S=j;NEW=r.id;F='';render();var e=$(r.id);if(e)e.scrollIntoView({block:'center',behavior:'smooth'});
    toast('잡았다! +'+(S.items[0]&&S.items[0].pts)+(r.got&&r.got.length?' · 새 배지 '+r.got.join(', '):''));
  }).catch(function(){$('st').innerHTML='<p class="err">사진을 보내지 못했어요. 다시 찍어 주세요.</p>';});
}
load();
</script></body></html>`;
