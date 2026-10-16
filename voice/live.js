// =========================================================
// 🎧 동시통역 — 百炼 Qwen-LiveTranslate 실시간(음성→번역 음성, 2~3초 지연, 말하는 사람 목소리 실시간 복제, 카메라 프레임 보조)
//  GET /live                 화면(초대 코드 pb-code). 방향: 한→중 / 중→한 / 자동(두 세션에 같은 소리를 넣고 원문 언어로 어느 쪽 음성을 틀지 고름)
//  WS  /live/ws?code&to=zh,ko&clone=1   중계 — 대상 언어마다 百炼 세션 하나(서버가 session.update), 내려보내는 이벤트에 `_d`(대상 언어) 붙임
// 하루 상한 KV lt:<날짜>:<해시> 초(`LT_DAY_MIN` 기본 60분), 한 번 20분. 사용량판 앱 `live`.
// 모델 `LT_MODEL` 기본 qwen3.8-livetranslate-flash-realtime(원문 언어 자동 감지, speaker_detection) — 이벤트 이름이 omni realtime 과 다름(response.text.delta 등).
// [필수] 百炼만 사용. 번역 음성이 스피커로 나올 때는 마이크를 보내지 않음(에코 재번역 방지).
// =========================================================
import { logUse } from "./usage.js";

const cnDay = (t = Date.now()) => new Date(t + 8 * 3600e3).toISOString().slice(0, 10);
const host = (env) => (env.DASHSCOPE_WS_HOST || "dashscope.aliyuncs.com").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
const LT_MAX_SEC = 1200;
const LANGS = new Set(["zh", "ko", "en", "ja"]);

export async function liveRelay(req, env, ctx, url, allowed, hash) {
  if (req.headers.get("upgrade") !== "websocket") return new Response("websocket only", { status: 426 });
  const pair = new WebSocketPair(), client = pair[0], server = pair[1];
  server.accept();
  const fail = (code, message) => { try { server.send(JSON.stringify({ type: "error", error: { code, message } })); } catch {} try { server.close(1008, code); } catch {} return new Response(null, { status: 101, webSocket: client }); };
  const code = url.searchParams.get("code") || "";
  if (!allowed(env, code)) return fail("not_allowed", "이 초대 코드는 동시통역을 쓸 수 없습니다.");
  if (!env.DASHSCOPE_API_KEY) return fail("config", "서버에 DASHSCOPE_API_KEY 가 없습니다.");
  const to = [...new Set(String(url.searchParams.get("to") || "zh").split(",").filter((x) => LANGS.has(x)))].slice(0, 2);
  if (!to.length) return fail("bad", "대상 언어가 없습니다.");
  const clone = url.searchParams.get("clone") === "1";
  const who = await hash(code), dayKey = "lt:" + cnDay() + ":" + who;
  const used = Number(await env.KV.get(dayKey)) || 0, cap = (Number(env.LT_DAY_MIN) || 60) * 60;
  if (used >= cap) return fail("daily_cap", "오늘 동시통역 한도(" + Math.round(cap / 60) + "분)를 다 썼습니다.");
  const model = env.LT_MODEL || "qwen3.8-livetranslate-flash-realtime";
  const ups = [];
  for (const lang of to) {
    let up;
    try { up = await fetch("https://" + host(env) + "/api-ws/v1/realtime?model=" + encodeURIComponent(model), { headers: { Upgrade: "websocket", Authorization: "Bearer " + env.DASHSCOPE_API_KEY } }); } catch (e) { return fail("upstream", "百炼 연결 실패: " + String(e.message || e).slice(0, 120)); }
    if (!up.webSocket) return fail("upstream", "百炼 연결 거부 " + up.status + ": " + (await up.text().catch(() => "")).slice(0, 160));
    up.webSocket.accept(); ups.push({ lang, ws: up.webSocket });
  }
  const t0 = Date.now(); let closed = false, done; const finished = new Promise((r) => (done = r));
  const limit = Math.min(LT_MAX_SEC, cap - used);
  const end = (why) => {
    if (closed) return; closed = true;
    try { server.send(JSON.stringify({ type: "relay.closed", reason: why })); } catch {}
    for (const u of ups) { try { u.ws.send(JSON.stringify({ type: "session.finish" })); } catch {} setTimeout(() => { try { u.ws.close(1000, "end"); } catch {} }, 800); }
    try { server.close(1000, "end"); } catch {}
    const sec = Math.ceil((Date.now() - t0) / 1000);
    done(Promise.all([env.KV.put(dayKey, String(used + sec), { expirationTtl: 3 * 86400 }).catch(() => {}), logUse(env, "live", { session: 1, ["to_" + to.join("_")]: 1 }, sec, who).catch(() => {})]));
  };
  const timer = setTimeout(() => end("time_limit"), limit * 1000);
  server.addEventListener("message", (e) => {
    if (typeof e.data !== "string") return;
    if (e.data.includes('"session.update"') || e.data.includes('"session.finish"')) return; // 세션 설정은 서버만
    for (const u of ups) { try { u.ws.send(e.data); } catch { end("upstream_send"); } }
  });
  for (const u of ups) {
    u.ws.addEventListener("message", (e) => {
      if (typeof e.data !== "string") return;
      if (!u.set && (e.data.includes('"session.created"') || !e.data.startsWith('{"type":"response.audio.delta"'))) {
        u.set = true;
        const session = { output_modalities: ["text", "audio"], translation: { language: u.lang }, turn_detection: { type: "speaker_detection", threshold: 0.5 } };
        if (clone) { session.enable_voice_clone = true; session.voice_clone_options = { frequency: "always" }; session.voice = "default"; }
        try { u.ws.send(JSON.stringify({ type: "session.update", session })); } catch { end("upstream_send"); }
      }
      // 대상 언어 표시를 붙여 내려보냄(JSON 끝 } 앞에 삽입 — 오디오 조각도 파싱 없이)
      const d = e.data.trimEnd();
      const out = d.endsWith("}") ? d.slice(0, -1) + ',"_d":"' + u.lang + '"}' : d;
      try { server.send(out); } catch { end("client_send"); }
    });
    u.ws.addEventListener("close", (ev) => { clearTimeout(timer); end("upstream_close " + (ev.code || "") + " " + (ev.reason || "")); });
    u.ws.addEventListener("error", () => end("upstream_error"));
  }
  server.addEventListener("close", () => { clearTimeout(timer); end("client_close"); });
  server.addEventListener("error", () => end("client_error"));
  ctx.waitUntil(finished.then((p) => p));
  try { server.send(JSON.stringify({ type: "relay.ready", model, limit_sec: limit, to })); } catch {}
  return new Response(null, { status: 101, webSocket: client });
}

export const LIVE_HTML = String.raw`<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,maximum-scale=1">
<meta name="theme-color" content="#1664B0">
<meta name="apple-mobile-web-app-capable" content="yes">
<link rel="apple-touch-icon" href="/icon-180.png">
<title>동시통역</title>
<style>
:root{--sky:#1664B0;--bg:#EFE8DE;--card:#F7F2EA;--ink:#1A2330;--ink2:#5E6672;--line:#D9CEBD;--red:#D21624}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 -apple-system,"Apple SD Gothic Neo","PingFang SC",system-ui,sans-serif;height:100%}
body{display:flex;flex-direction:column;min-height:100vh}
header{background:var(--sky);color:#fff;padding:calc(env(safe-area-inset-top) + 12px) 14px 10px;border-bottom:3px solid var(--red);display:flex;align-items:center;gap:10px}
header h1{margin:0;font-size:18px;flex:1}a.back{color:#fff;text-decoration:none;font-size:20px}#lim{font-size:12px;opacity:.9}
.bar{display:flex;gap:6px;padding:10px 14px 0;max-width:680px;margin:0 auto;width:100%}
.chip{flex:1;padding:9px 6px;border-radius:999px;border:1px solid var(--line);background:#fff;font-weight:800;font-size:14px;text-align:center;cursor:pointer}.chip.on{background:var(--sky);color:#fff;border-color:var(--sky)}
.opts{display:flex;gap:12px;flex-wrap:wrap;padding:8px 14px 0;max-width:680px;margin:0 auto;width:100%;font-size:13px;color:var(--ink2)}.opts label{display:flex;align-items:center;gap:4px}
main{flex:1;max-width:680px;margin:0 auto;width:100%;padding:8px 14px 150px;overflow-y:auto}
.t{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:10px 14px;margin-top:8px}.t .src{font-size:13.5px;color:var(--ink2)}.t .dst{font-size:22px;font-weight:700;line-height:1.4;margin-top:2px;min-height:1.4em}.t.ko .dst{color:var(--sky)}.t .dst:empty::before{content:'…';color:var(--ink2)}
body.big main{padding-bottom:170px}body.big .t .dst{font-size:34px}body.big .t .src{font-size:16px}
.foot{position:fixed;left:0;right:0;bottom:0;background:linear-gradient(transparent,var(--bg) 30%);padding:18px 14px calc(env(safe-area-inset-bottom) + 14px)}
.foot .in{max-width:680px;margin:0 auto}
.big{width:100%;padding:18px;border:0;border-radius:16px;background:var(--red);color:#fff;font-size:19px;font-weight:800}.big.on{background:var(--ink)}
.st{font-size:13px;color:var(--ink2);text-align:center;margin-top:6px;min-height:1.3em}
.gate{padding:40px 14px;text-align:center}.gate input{padding:10px;border:1px solid var(--line);border-radius:9px;font-size:16px}
.b2{background:#fff;border:1px solid var(--line);color:var(--sky);border-radius:9px;padding:7px 12px;font-weight:700;font-size:13px;cursor:pointer}
#cam{position:fixed;right:10px;bottom:120px;width:96px;height:72px;object-fit:cover;border-radius:10px;border:2px solid #fff;display:none;box-shadow:0 2px 8px rgba(0,0,0,.25)}
.help{font-size:13px;color:var(--ink2);margin-top:14px}.help b{color:var(--ink)}
</style></head><body>
<header><a class="back" href="/hub" aria-label="도구함">‹</a><h1>🎧 동시통역</h1><span id="lim"></span></header>
<div class="bar" id="dir"><div class="chip on" data-d="ko2zh">🇰🇷 한 → 중</div><div class="chip" data-d="zh2ko">🇨🇳 중 → 한</div><div class="chip" data-d="auto">⇄ 자동</div></div>
<div class="opts"><label><input type="checkbox" id="oc" checked> 말하는 사람 목소리로</label><label><input type="checkbox" id="ov"> 📷 카메라 보조</label><label><input type="checkbox" id="ob"> 큰 글씨</label><button class="b2" id="clr" style="margin-left:auto">지우기</button></div>
<main id="main"></main>
<video id="cam" muted playsinline></video>
<div class="foot"><div class="in"><button class="big" id="go">🎧 통역 시작</button><div class="st" id="st"></div></div></div>
<script>
(function(){
var $=function(i){return document.getElementById(i)};var CODE='';try{CODE=localStorage.getItem('pb-code')||'';}catch(e){}
var DIR='ko2zh';try{DIR=localStorage.getItem('lv-dir')||'ko2zh';}catch(e){}
var S=null;
function say(t){$('st').textContent=t||''}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function gate(){$('main').innerHTML='<div class="gate"><p>박비서 초대 코드를 넣어 주세요</p><input id="ci" placeholder="초대 코드"> <button class="b2" id="cs">열기</button></div>';$('cs').onclick=function(){CODE=$('ci').value.trim();try{localStorage.setItem('pb-code',CODE);}catch(e){}help()}}
function help(){$('main').innerHTML='<div class="help"><b>어떻게 쓰나요</b><br>· <b>한 → 중</b>: 내가 한국어로 말하면 2~3초 뒤 중국어 음성이 나옵니다(폰을 상대 쪽으로). "말하는 사람 목소리로"를 켜면 내 목소리 톤으로 중국어가 나옵니다.<br>· <b>중 → 한</b>: 상대가 중국어로 말하면 한국어로. 이어폰을 끼면 상대에게 안 들립니다.<br>· <b>자동</b>: 한국어·중국어를 번갈아 말해도 알아서(두 세션이라 사용량 2배).<br>· <b>카메라 보조</b>: 메뉴판·화면 글자·입모양을 같이 보고 동음이의어를 잡습니다.<br>· 번역 음성이 나오는 동안은 마이크를 잠깐 멈춥니다(스피커 소리 재번역 방지). 두 사람이 각자 폰으로 서로 반대 방향을 켜면 이어폰 통역이 됩니다.<br>· 하루 60분(자동은 두 배로 셈), 한 번에 20분.</div>'}
document.querySelectorAll('#dir .chip').forEach(function(c){c.classList.toggle('on',c.dataset.d===DIR);c.onclick=function(){if(S)return say('통역을 멈추고 바꿔 주세요');DIR=c.dataset.d;try{localStorage.setItem('lv-dir',DIR);}catch(e){}document.querySelectorAll('#dir .chip').forEach(function(x){x.classList.toggle('on',x===c)})}});
$('ob').onchange=function(){document.body.classList.toggle('big',this.checked)};
$('clr').onclick=function(){help()};
// 오디오(박비서와 같은 연속 버퍼 재생)
function b64(i16){var u=new Uint8Array(i16.buffer),s='';for(var i=0;i<u.length;i+=0x8000)s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000));return btoa(s)}
function down(f,sr){var r=sr/16000,n=Math.floor(f.length/r),o=new Int16Array(n);for(var i=0;i<n;i++){var a=Math.floor(i*r),b=Math.min(f.length,Math.floor((i+1)*r)),x=0;for(var j=a;j<b;j++)x+=f[j];var v=Math.max(-1,Math.min(1,x/Math.max(1,b-a)));o[i]=v<0?v*0x8000:v*0x7fff}return o}
function mkPcm(sr){return {buf:new Float32Array(48000),r:0,w:0,on:false,g:0,left:null,rate:24000/sr}}
function pcmPush(P,d){var bin=atob(d),L=bin.length+(P.left!=null?1:0),a=new Uint8Array(L),o=0;if(P.left!=null){a[0]=P.left;o=1;P.left=null}for(var k=0;k<bin.length;k++)a[o+k]=bin.charCodeAt(k);if(L%2){P.left=a[L-1];L--}var n=L>>1;if(!n)return;var r0=Math.floor(P.r),keep=P.w-r0;if(P.w+n>P.buf.length){var nb=new Float32Array(Math.max(48000,2*(keep+n)));nb.set(P.buf.subarray(r0,P.w));P.buf=nb;P.r-=r0;P.w=keep}for(var i=0;i<n;i++){var v=a[2*i]|(a[2*i+1]<<8);if(v>=0x8000)v-=0x10000;P.buf[P.w++]=v/0x8000}}
function pcmPull(P,out){var N=out.length,i=0;if(!P||!P.on){if(P&&P.w-P.r>=2400){P.on=true;P.g=0}else{out.fill(0);return}}for(;i<N;i++){var x=Math.floor(P.r);if(x+1>=P.w){P.on=false;break}var f=P.r-x,s=P.buf[x]+(P.buf[x+1]-P.buf[x])*f;if(P.g<1)P.g=Math.min(1,P.g+1/240);out[i]=s*P.g;P.r+=P.rate}var last=i?out[i-1]:0;for(;i<N;i++){last*=0.97;out[i]=last}if(!P.on&&P.w-P.r<=1){P.r=0;P.w=0}}
function pcmBusy(P){return !!P&&(P.on||P.w-P.r>1)}
var HAN=/[가-힣]/,CJK=/[一-鿿]/;
function want(d,src){ // 자동 모드: 원문 언어로 어느 세션 음성을 틀지
  if(DIR!=='auto')return true;if(d==='zh')return HAN.test(src)||!CJK.test(src);return CJK.test(src)&&!HAN.test(src)}
function send(o){if(S&&S.ws&&S.ws.readyState===1)S.ws.send(JSON.stringify(o))}
function card(d){var el=document.createElement('div');el.className='t '+d;el.innerHTML='<div class="src"></div><div class="dst"></div>';$('main').appendChild(el);el.scrollIntoView({block:'end'});return el}
var DBG=[];function dbg(t){DBG.push(t);if(DBG.length>6)DBG.shift();if(S&&S.ready<S.n)say('연결 중… '+DBG.join(' › '))}
function ev(e){var d=e._d||S.first,R=S.r[d]||S.r[S.first];var t=e.type;if(t!=='response.audio.delta')dbg(t+(e._d?'/'+e._d:''));if(!R)return;
  if(t==='session.updated'){S.ready=(S.ready||0)+1;if(S.ready>=S.n)say(DIR==='auto'?'말씀하세요 (한국어·중국어 자동)':'말씀하세요');return}
  if(t==='input_audio_buffer.speech_started'){if(!R.cur||R.cur.done){R.cur={el:null,src:'',dst:'',done:false,pend:[],dec:null}}return}
  if(t==='conversation.item.input_audio_transcription.delta'){if(!R.cur)R.cur={el:null,src:'',dst:'',done:false,pend:[],dec:null};R.cur.src+=e.delta||'';decide(d,R);show(d,R);return}
  if(t==='conversation.item.input_audio_transcription.completed'){if(!R.cur)R.cur={el:null,src:'',dst:'',done:false,pend:[],dec:null};if(e.transcript)R.cur.src=e.transcript;decide(d,R);show(d,R);return}
  if(t==='response.audio_transcript.delta'||t==='response.text.delta'){if(!R.cur)R.cur={el:null,src:'',dst:'',done:false,pend:[],dec:null};R.cur.dst+=e.delta||'';decide(d,R);show(d,R);return}
  if(t==='response.audio.delta'){if(!R.cur)R.cur={el:null,src:'',dst:'',done:false,pend:[],dec:null};if(R.cur.dec===true)pcmPush(S.pl,e.delta);else if(R.cur.dec===null)R.cur.pend.push(e.delta);return}
  if(t==='response.done'){if(R.cur){if(R.cur.dec===null){R.cur.dec=(DIR!=='auto'||d===S.first);if(R.cur.dec)flush(R.cur);else R.cur.pend=[];show(d,R)}R.cur.done=true}return}
  if(t==='error'||e.code){var m=(e.error&&(e.error.message||e.error.code))||e.message||(e.code?e.code+' '+(e.msg||''):'')||'오류';var c=card(d);c.querySelector('.dst').textContent='⚠ '+m;return}
  if(t==='relay.closed'){stop(e.reason==='daily_cap'?'오늘 한도를 다 썼어요':'')}
}
function decide(d,R){var c=R.cur;if(c.dec!==null)return;if(!c.src&&!c.dst)return;var src=c.src||'';
  if(DIR!=='auto'){c.dec=true;flush(c);return}
  if(!src)return; // 원문이 와야 판단
  c.dec=want(d,src);if(c.dec)flush(c);else c.pend=[]}
function flush(c){for(var i=0;i<c.pend.length;i++)pcmPush(S.pl,c.pend[i]);c.pend=[]}
function show(d,R){var c=R.cur;if(DIR==='auto'&&c.dec===false)return;if(DIR==='auto'&&c.dec===null)return;if(!c.el)c.el=card(d);c.el.querySelector('.src').textContent=c.src;c.el.querySelector('.dst').textContent=c.dst;c.el.scrollIntoView({block:'end'})}
async function start(){
  var Ctx=window.AudioContext||window.webkitAudioContext,ctx=new Ctx();if(ctx.resume)ctx.resume();
  var stream;try{stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1}})}catch(e){say('마이크 권한이 필요합니다');ctx.close();return}
  var to=DIR==='ko2zh'?['zh']:DIR==='zh2ko'?['ko']:['zh','ko'];
  S={ctx:ctx,stream:stream,pl:mkPcm(ctx.sampleRate),ready:0,n:to.length,r:{},first:to[0],t0:Date.now()};to.forEach(function(l){S.r[l]={cur:null}});
  var src=ctx.createMediaStreamSource(stream),pr=ctx.createScriptProcessor(4096,1,1);
  pr.onaudioprocess=function(e){pcmPull(S&&S.pl,e.outputBuffer.getChannelData(0));if(!S||S.ready<S.n)return;if(pcmBusy(S.pl))return;send({type:'input_audio_buffer.append',audio:b64(down(e.inputBuffer.getChannelData(0),ctx.sampleRate))})};
  src.connect(pr);pr.connect(ctx.destination);S.pr=pr;S.src=src;
  var ws=new WebSocket(location.origin.replace(/^http/,'ws')+'/live/ws?code='+encodeURIComponent(CODE)+'&to='+to.join(',')+'&clone='+($('oc').checked?'1':'0'));S.ws=ws;
  ws.onmessage=function(m){var e;try{e=JSON.parse(m.data)}catch(_){return}if(e.type==='relay.ready'){$('lim').textContent='최대 '+Math.round(e.limit_sec/60)+'분';setTimeout(function(){if(S&&S.ready<S.n){S.ready=S.n;say('말씀하세요 (설정 응답 없이 시작)')}},5000);return}ev(e)};
  ws.onerror=function(){say('서버 연결 실패')};ws.onclose=function(){if(S)stop('')};
  if($('ov').checked)camOn();
  $('main').innerHTML='';$('go').textContent='■ 멈추기';$('go').classList.add('on');say('연결 중…');
  S.tick=setInterval(function(){if(!S)return;var s=Math.floor((Date.now()-S.t0)/1000);$('lim').textContent=Math.floor(s/60)+':'+String(s%60).padStart(2,'0')},1000);
}
async function camOn(){try{var v=$('cam'),st=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment',width:640,height:480}});v.srcObject=st;v.style.display='block';await v.play();S.cam=st;var cv=document.createElement('canvas');cv.width=320;cv.height=240;var cx=cv.getContext('2d');
  S.camT=setInterval(function(){if(!S||S.ready<S.n)return;cx.drawImage(v,0,0,320,240);var u=cv.toDataURL('image/jpeg',0.6);send({type:'input_image_buffer.append',image:u.split(',')[1]})},700)}catch(e){say('카메라를 켤 수 없어요');$('ov').checked=false}}
function stop(msg){if(!S)return;var s=S;S=null;clearInterval(s.tick);clearInterval(s.camT);try{s.ws.close()}catch(e){}try{s.pr.disconnect();s.src.disconnect()}catch(e){}try{s.stream.getTracks().forEach(function(t){t.stop()})}catch(e){}try{if(s.cam)s.cam.getTracks().forEach(function(t){t.stop()})}catch(e){}try{s.ctx.close()}catch(e){}
  $('cam').style.display='none';$('go').textContent='🎧 통역 시작';$('go').classList.remove('on');say(msg||'');$('lim').textContent=''}
$('go').onclick=function(){if(!CODE)return gate();S?stop(''):start()};
if(!CODE)gate();else help();
})();
</script></body></html>`;
