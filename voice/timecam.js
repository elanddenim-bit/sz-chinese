// =========================================================
// 🕰 타임머신 카메라 — 지금 찍은 광저우 사진을 같은 구도로 1930년대·1980년대·2080년·눈 오는 날로 (박비서와 같은 초대 코드)
//  GET  /timecam                  화면
//  POST /timecam/list  {code}                 → 내 앨범(원본·결과 서명 주소)
//  POST /timecam/make  {code, image, era, w, h} → 원본 R2 저장 + 通义万相 이미지 편집(비동기) 작업 시작 → {task, id}
//  POST /timecam/poll  {code, task}           → 진행 상태, 끝나면 결과를 R2 로 옮기고 앨범에 추가
//  GET  /timecam/img?k&s                      → 사진(서명)
// 저장: R2 tc/<코드해시>/<id>-src.jpg · <id>-<era>.png, KV tc:<코드해시>(앨범 60), tc:task:<task>(24시간)
// [필수] AI 는 百炼(通义万相)만 — Anthropic 호출 없음
// =========================================================
import { logUse } from "./usage.js";

const ERAS = {
  e1930: ["🎞 1930년대", "把这张照片改成1930年代民国时期广州同一地点的老照片：同样的构图和视角，建筑改为当时的骑楼、木窗、石板路，路上有黄包车、电车或旧式汽车，行人穿长衫旗袍；黑白偏棕褐色的老照片质感，轻微颗粒和划痕，真实摄影感。"],
  e1985: ["📼 1985년", "把这张照片改成1985年改革开放初期广州同一地点的样子：同样的构图和视角，建筑改为当时的砖楼和简朴店铺，路上是成群的自行车、老式公交车，行人穿八十年代衣服；褪色的彩色胶片照片质感，暖黄色调，真实摄影感。"],
  e2080: ["🚀 2080년", "把这张照片改成2080年未来广州同一地点的样子：同样的构图和视角，建筑变成覆盖植物的未来建筑和柔和发光的玻璃幕墙，空中有安静的无人驾驶飞行器，街道干净；写实摄影风格，不要夸张的赛博朋克，看起来可信。"],
  snow: ["❄️ 눈 오는 날", "把这张照片改成广州同一地点下大雪的样子：同样的构图和视角，屋顶、树木、街道覆盖厚厚的白雪，空中飘着雪花，冬天的柔和光线，行人穿冬衣；真实摄影感，像真的拍到的一样。"],
};
const NEG = "文字, 水印, 签名, 变形的人脸, 多余的手指, 模糊, 低质量";
const cnDay = (t = Date.now()) => new Date(t + 8 * 3600e3).toISOString().slice(0, 10);
const host = (env) => (env.DASHSCOPE_WS_HOST || "dashscope.aliyuncs.com").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
const terr = (message, status = 400) => Object.assign(new Error(message), { code: "timecam", status });

async function hmac16(env, s) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode("tc|" + (env.ALLOWED_CODES || "") + (env.DASHSCOPE_API_KEY || "")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(s));
  return [...new Uint8Array(sig)].slice(0, 8).map((x) => x.toString(16).padStart(2, "0")).join("");
}
const signed = async (env, k) => k ? "/timecam/img?k=" + encodeURIComponent(k) + "&s=" + (await hmac16(env, k)) : "";
function b64bytes(b64) { const s = atob(String(b64).replace(/^data:[^,]+,/, "")); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
// 1024×1024 픽셀 수 안팎(원본 비율 유지, 16 배수)
function size(w, h) {
  w = Number(w) || 0; h = Number(h) || 0;
  if (w < 50 || h < 50 || w / h > 4 || h / w > 4) return {};
  const k = Math.sqrt((1024 * 1024) / (w * h));
  return { size: Math.max(384, Math.round((w * k) / 16) * 16) + "*" + Math.max(384, Math.round((h * k) / 16) * 16) };
}

async function album(env, h) {
  const l = (await env.KV.get("tc:" + h, "json")) || [];
  return { ok: true, eras: Object.fromEntries(Object.entries(ERAS).map(([k, v]) => [k, v[0]])),
    album: await Promise.all(l.map(async (x) => ({ id: x.id, era: x.era, at: x.at, src: await signed(env, x.src), out: await signed(env, x.out) }))) };
}

export async function timecamApi(env, ctx, path, b, h) {
  if (path === "/timecam/list") return album(env, h);
  if (path === "/timecam/make") return make(env, ctx, b, h);
  if (path === "/timecam/poll") return poll(env, b, h);
  throw terr("not_found", 404);
}

async function make(env, ctx, b, h) {
  const era = ERAS[b.era] ? b.era : null;
  if (!era) throw terr("시대를 골라 주세요.");
  const img = String(b.image || "");
  if (!/^data:image\/jpeg;base64,/.test(img)) throw terr("사진이 필요해요.");
  if (img.length > 5_000_000) throw terr("사진이 너무 커요.");
  const day = cnDay(), dk = "tc:day:" + day, used = Number(await env.KV.get(dk)) || 0, cap = Number(env.TIMECAM_DAY_MAX) || 12;
  if (used >= cap) throw terr("오늘은 " + cap + "장까지예요. 내일 또 타임머신을 타요!", 429);
  // 같은 원본으로 다른 시대를 또 만들 땐 원본을 다시 올리지 않음(id 재사용)
  let id = /^t[0-9a-z]{6,12}$/.test(String(b.id || "")) ? String(b.id) : "t" + Date.now().toString(36);
  const src = "tc/" + h + "/" + id + "-src.jpg";
  if (!(await env.R2.head(src))) await env.R2.put(src, b64bytes(img), { httpMetadata: { contentType: "image/jpeg" } });
  const r = await fetch("https://" + host(env) + "/api/v1/services/aigc/image2image/image-synthesis", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + env.DASHSCOPE_API_KEY, "X-DashScope-Async": "enable" },
    body: JSON.stringify({ model: env.TIMECAM_MODEL || env.WAN_MODEL || "wan2.5-i2i-preview",
      input: { prompt: ERAS[era][1], negative_prompt: NEG, images: [img] },
      parameters: Object.assign({ n: 1, watermark: false, prompt_extend: false }, size(b.w, b.h)) }),
  });
  const j = await r.json().catch(() => ({}));
  const task = j.output && j.output.task_id;
  if (!r.ok || !task) throw terr("타임머신 시동 실패: " + (j.message || j.code || r.status), 502);
  await env.KV.put(dk, String(used + 1), { expirationTtl: 3 * 86400 });
  await env.KV.put("tc:task:" + task, JSON.stringify({ h, id, era, src }), { expirationTtl: 86400 });
  ctx.waitUntil(logUse(env, "timecam", { make: 1, ["era_" + era]: 1 }, 0, h).catch(() => {}));
  return { ok: true, task, id, left: cap - used - 1 };
}

async function poll(env, b, h) {
  const task = String(b.task || "");
  if (!/^[0-9a-zA-Z-]{8,80}$/.test(task)) throw terr("작업 번호가 이상해요.");
  const meta = await env.KV.get("tc:task:" + task, "json");
  if (!meta || meta.h !== h) throw terr("작업을 찾지 못했어요(24시간 지남).", 404);
  if (meta.done) return { ok: true, status: "SUCCEEDED", id: meta.id, era: meta.era, ...(await album(env, h)) };
  const r = await fetch("https://" + host(env) + "/api/v1/tasks/" + task, { headers: { authorization: "Bearer " + env.DASHSCOPE_API_KEY } });
  const j = await r.json().catch(() => ({}));
  const st = (j.output && j.output.task_status) || "UNKNOWN";
  if (st === "PENDING" || st === "RUNNING") return { ok: true, status: st };
  const hit = ((j.output && j.output.results) || []).find((x) => x && x.url);
  if (st !== "SUCCEEDED" || !hit) { await env.KV.delete("tc:task:" + task); throw terr("시간 여행 실패: " + ((j.output && (j.output.message || j.output.code)) || st), 502); }
  const im = await fetch(hit.url);
  if (!im.ok) throw terr("결과 내려받기 실패 " + im.status, 502);
  const out = "tc/" + h + "/" + meta.id + "-" + meta.era + ".png";
  await env.R2.put(out, im.body, { httpMetadata: { contentType: "image/png" } });
  const l = ((await env.KV.get("tc:" + h, "json")) || []).filter((x) => !(x.id === meta.id && x.era === meta.era));
  l.unshift({ id: meta.id, era: meta.era, src: meta.src, out, at: Date.now() });
  await env.KV.put("tc:" + h, JSON.stringify(l.slice(0, 60)));
  await env.KV.put("tc:task:" + task, JSON.stringify({ ...meta, done: out }), { expirationTtl: 86400 });
  return { ok: true, status: "SUCCEEDED", id: meta.id, era: meta.era, ...(await album(env, h)) };
}

export async function timecamGet(req, env, url) {
  if (url.pathname === "/timecam/img") {
    const k = url.searchParams.get("k") || "";
    if (!/^tc\/[0-9a-f]{12}\/[\w.-]+\.(jpg|png)$/.test(k) || url.searchParams.get("s") !== (await hmac16(env, k))) return new Response("forbidden", { status: 403 });
    const o = await env.R2.get(k);
    if (!o) return new Response("not found", { status: 404 });
    return new Response(o.body, { headers: { "content-type": k.endsWith(".png") ? "image/png" : "image/jpeg", "cache-control": "private, max-age=31536000" } });
  }
  return new Response("not found", { status: 404 });
}

export const TIMECAM_HTML = String.raw`<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#1664B0">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="타임머신 카메라">
<link rel="apple-touch-icon" href="/icon-180.png">
<title>타임머신 카메라</title>
<style>
:root{--sky:#1664B0;--bg:#EFE8DE;--card:#F7F2EA;--ink:#1A2330;--ink2:#5E6672;--line:#D9CEBD;--red:#D21624;--soft:#E6DCCB}
@media (prefers-color-scheme:dark){:root{--bg:#141A22;--card:#1C2430;--ink:#EDE6DA;--ink2:#9AA3AE;--line:#2C3644;--soft:#253041}}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,"Apple SD Gothic Neo","PingFang SC",system-ui,sans-serif;-webkit-text-size-adjust:100%}
header{background:var(--sky);color:#fff;padding:calc(env(safe-area-inset-top) + 14px) 16px 14px;border-bottom:3px solid var(--red);display:flex;align-items:center;gap:12px}
header h1{margin:0;font-size:19px}a.back{color:#fff;text-decoration:none;font-size:20px}
main{max-width:640px;margin:0 auto;padding:14px 16px 60px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:12px}.card h2{margin:0 0 8px;font-size:16px}
.lbl{font-size:12.5px;color:var(--ink2);margin:10px 0 6px}.note{font-size:12.5px;color:var(--ink2);margin:6px 0 0}.err{color:var(--red);font-size:13.5px;margin-top:8px}
.pick{display:block;border:2px dashed var(--line);border-radius:14px;padding:20px;text-align:center;color:var(--ink2)}.pick input{display:none}.pick b{display:block;color:var(--ink);font-size:16px;margin-bottom:4px}
.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{border:1px solid var(--line);background:transparent;color:var(--ink);border-radius:999px;padding:7px 13px;font:inherit;font-size:14px}.chip.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.big{display:block;width:100%;border:0;border-radius:12px;background:var(--sky);color:#fff;font:inherit;font-weight:700;font-size:16px;padding:14px;margin-top:12px}.big:disabled{opacity:.5}
.ba{position:relative;border-radius:12px;overflow:hidden;background:#000;user-select:none;-webkit-user-select:none;touch-action:pan-y}
.ba img{display:block;width:100%}.ba .top{position:absolute;inset:0;overflow:hidden}.ba .top img{position:absolute;top:0;left:0;height:100%;width:auto;max-width:none}
.ba .line{position:absolute;top:0;bottom:0;width:3px;background:#fff;box-shadow:0 0 6px rgba(0,0,0,.6)}
.ba .tag{position:absolute;top:8px;background:rgba(0,0,0,.55);color:#fff;font-size:12px;padding:2px 8px;border-radius:999px}
.ba input{position:absolute;inset:0;width:100%;height:100%;opacity:0;margin:0}
.mini{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.mini button{border:1px solid var(--line);background:transparent;color:var(--ink);border-radius:8px;padding:7px 11px;font:inherit;font-size:13px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.grid img{width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:8px;display:block;background:var(--soft)}.grid div{position:relative}.grid span{position:absolute;left:4px;bottom:4px;background:rgba(0,0,0,.6);color:#fff;font-size:11px;padding:1px 5px;border-radius:5px}
.prev{width:100%;border-radius:12px;display:block;margin-top:10px}
.toast{position:fixed;left:50%;bottom:calc(20px + env(safe-area-inset-bottom));transform:translateX(-50%);background:var(--ink);color:var(--bg);padding:10px 16px;border-radius:999px;font-size:14px;z-index:9;max-width:90vw;text-align:center}
.spin{display:inline-block;animation:sp 1.2s linear infinite}@keyframes sp{to{transform:rotate(360deg)}}
.gate{padding:40px 0;text-align:center}
</style></head><body>
<header><a class="back" href="/" aria-label="박비서">‹</a><h1>🕰 타임머신 카메라</h1></header>
<main id="main"><div class="gate">불러오는 중…</div></main>
<script>
var CODE='';try{CODE=localStorage.getItem('pb-code')||'';}catch(e){}
var S=null,IMG=null,W=0,H=0,ID='',ERA='e1930',BUSY=false,SHOW=null;
function $(i){return document.getElementById(i);}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function toast(t){var d=document.createElement('div');d.className='toast';d.textContent=t;document.body.appendChild(d);setTimeout(function(){d.remove();},3200);}
function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}
function api(p,b,tries){b=b||{};b.code=CODE;tries=tries==null?1:tries;return fetch(p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json().catch(function(){return {error:'서버 응답 오류 '+r.status};});},function(){if(tries>0)return sleep(1500).then(function(){return api(p,b,tries-1);});return {error:'network',detail:'네트워크가 끊겼어요.'};});}
function pend(){try{return JSON.parse(localStorage.getItem('tc-pend')||'[]');}catch(e){return [];}}
function setPend(l){try{localStorage.setItem('tc-pend',JSON.stringify(l));}catch(e){}}
function gate(m){$('main').innerHTML='<div class="gate"><p>'+esc(m||'박비서 초대 코드를 넣어 주세요')+'</p><input id="cd" placeholder="초대 코드" style="font:inherit;padding:8px;border-radius:8px;border:1px solid var(--line)"> <button class="chip on" id="go">열기</button></div>';$('go').onclick=function(){CODE=$('cd').value.trim();try{localStorage.setItem('pb-code',CODE);}catch(e){}load();};}
function load(){if(!CODE)return gate();api('/timecam/list').then(function(j){if(j.error==='not_allowed')return gate('초대 코드가 맞지 않아요');if(!j.ok)return gate(j.detail||j.error);S=j;render();pend().forEach(function(t){watch(t);});});}
function render(){
  var h='<div class="card"><label class="pick"><input type="file" id="file" accept="image/*"><b>📸 사진 찍기 / 고르기</b>지금 서 있는 거리·건물·풍경 — 사람보다 장소가 잘 나와요</label>'
   +(IMG?'<img class="prev" src="'+IMG+'" alt="">':'')
   +'<p class="lbl">어느 시대로 갈까요?</p><div class="chips">'+Object.keys(S.eras).map(function(k){return '<button class="chip'+(k===ERA?' on':'')+'" data-era="'+k+'">'+esc(S.eras[k])+'</button>';}).join('')+'</div>'
   +'<button class="big" id="go" '+(IMG&&!BUSY?'':'disabled')+'>🕰 타임머신 출발</button><div class="note" id="st">한 장에 30초~1분 걸려요. 화면을 닫아도 다시 열면 이어 받아요.</div><div class="err" id="er"></div></div>';
  if(SHOW)h+='<div class="card" id="showCard"><h2>'+esc(S.eras[SHOW.era]||'')+'</h2>'+baHtml(SHOW)+'<div class="mini"><button id="dl">📥 저장·공유</button><button id="again">🔁 같은 사진, 다른 시대</button></div></div>';
  if(S.album.length)h+='<div class="card"><h2>🗂 타임머신 앨범</h2><div class="grid">'+S.album.map(function(x,i){return '<div data-show="'+i+'"><img loading="lazy" src="'+esc(x.out)+'" alt=""><span>'+esc(S.eras[x.era]||'')+'</span></div>';}).join('')+'</div></div>';
  $('main').innerHTML=h;bind();
}
function baHtml(x){return '<div class="ba" id="ba"><img src="'+esc(x.out)+'" alt="" id="baOut"><div class="top" id="baTop" style="width:50%"><img src="'+esc(x.src)+'" alt="" id="baSrc"></div><div class="line" id="baLine" style="left:50%"></div><span class="tag" style="left:8px">지금</span><span class="tag" style="right:8px">'+esc(S.eras[x.era]||'')+'</span><input type="range" min="0" max="100" value="50" id="baR" aria-label="비교"></div><p class="note">좌우로 밀어서 비교해 보세요.</p>';}
function fitBa(){var o=$('baOut'),s=$('baSrc');if(o&&s)s.style.width=o.clientWidth+'px';}
function bind(){
  $('file').onchange=function(){var f=this.files&&this.files[0];this.value='';if(!f)return;shrink(f).then(function(r){IMG=r.d;W=r.w;H=r.h;ID='';render();});};
  document.querySelectorAll('[data-era]').forEach(function(b){b.onclick=function(){ERA=b.getAttribute('data-era');render();};});
  $('go').onclick=go;
  document.querySelectorAll('[data-show]').forEach(function(d){d.onclick=function(){SHOW=S.album[+d.getAttribute('data-show')];render();var c=$('showCard');if(c)c.scrollIntoView({block:'start',behavior:'smooth'});};});
  if($('baR')){var r=$('baR');r.oninput=function(){$('baTop').style.width=r.value+'%';$('baLine').style.left=r.value+'%';};$('baOut').onload=fitBa;fitBa();window.onresize=fitBa;}
  if($('dl'))$('dl').onclick=function(){fetch(SHOW.out).then(function(r){return r.blob();}).then(function(b){var f=new File([b],'timemachine-'+SHOW.era+'.png',{type:'image/png'});if(navigator.canShare&&navigator.canShare({files:[f]}))navigator.share({files:[f]}).catch(function(){});else{var a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=f.name;a.click();}});};
  if($('again'))$('again').onclick=function(){fetch(SHOW.src).then(function(r){return r.blob();}).then(function(b){return shrink(b);}).then(function(r){IMG=r.d;W=r.w;H=r.h;ID=SHOW.id;SHOW=null;render();window.scrollTo(0,0);toast('시대를 골라 출발!');});};
}
function shrink(file){return new Promise(function(ok,no){var u=URL.createObjectURL(file),im=new Image();im.onload=function(){var M=1280,w=im.naturalWidth,h=im.naturalHeight,s=Math.min(1,M/Math.max(w,h));var c=document.createElement('canvas');c.width=Math.round(w*s);c.height=Math.round(h*s);c.getContext('2d').drawImage(im,0,0,c.width,c.height);URL.revokeObjectURL(u);ok({d:c.toDataURL('image/jpeg',.85),w:c.width,h:c.height});};im.onerror=function(){no();};im.src=u;});}
function go(){
  if(!IMG||BUSY)return;BUSY=true;$('go').disabled=true;$('er').textContent='';$('st').innerHTML='<span class="spin">🕰</span> 시동 거는 중…';
  api('/timecam/make',{image:IMG,era:ERA,w:W,h:H,id:ID}).then(function(j){
    if(!j.ok){BUSY=false;$('go').disabled=false;$('st').textContent='';$('er').textContent=j.detail||j.error;return;}
    ID=j.id;var l=pend();l.push(j.task);setPend(l);watch(j.task);
  });
}
var T0={};
function watch(task){
  T0[task]=T0[task]||Date.now();
  api('/timecam/poll',{task:task}).then(function(j){
    var st=$('st');
    if(!j.ok){setPend(pend().filter(function(t){return t!==task;}));BUSY=false;var g=$('go');if(g)g.disabled=!IMG;if($('er'))$('er').textContent=j.detail||j.error;if(st)st.textContent='';return;}
    if(j.status!=='SUCCEEDED'){if(st)st.innerHTML='<span class="spin">🕰</span> 시간 여행 중… '+Math.round((Date.now()-T0[task])/1000)+'초 ('+(j.status==='PENDING'?'차례 기다리는 중':'그리는 중')+')';setTimeout(function(){watch(task);},4000);return;}
    setPend(pend().filter(function(t){return t!==task;}));BUSY=false;S=j;
    SHOW=S.album.filter(function(x){return x.id===j.id&&x.era===j.era;})[0]||S.album[0];render();var c=$('showCard');if(c)c.scrollIntoView({block:'start',behavior:'smooth'});toast('도착! 좌우로 밀어 보세요');
  });
}
load();
</script></body></html>`;
