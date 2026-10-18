// 📺 박비서 TV — 나만의 방송국(2026-10-18). 넷플릭스식 검정·빨강 톤(소유자 지정), 제목 글꼴은 게임 글꼴(BB Lilita→BB BlackHan), 본문 프리텐다드.
// 채널 출처: iptv-org 나라별 공개 m3u(kr·cn·hk·tw·jp) + radio-browser.info(나라별 추천순 라디오). 재생은 폰이 방송 서버에 직접(Worker 중계 없음, iOS 사파리 HLS 네이티브).
// 내 목록: 소유자가 받은 m3u 주소·본문을 붙여 넣으면 KV `tv:my:<해시>` 에 저장, 매일 새벽 공개 목록과 같이 다시 받음.
// KV: tv:list {at, tv[], radio[], err[]} / tv:my:<h> {lists[{id,name,url,n,at,kind}], items[]} / tv:stat:<h> {id:[ok,bad,at]}(폰이 보고한 재생 성공·실패 = '중국에서 열림')
const serr = (message, status = 400) => Object.assign(new Error(message), { code: "tv", status });
const COUNTRIES = [["KR", "🇰🇷", "한국"], ["CN", "🇨🇳", "중국"], ["HK", "🇭🇰", "홍콩"], ["TW", "🇹🇼", "대만"], ["JP", "🇯🇵", "일본"]];
const TV_MAX = 160, RADIO_MAX = 60, MY_MAX = 600;
const UA = "szvoice-tv/1.0 (+https://voice.zhnote.net/tv)";

// m3u → [{i,n,l,g,u,c,k}] (#EXTINF 속성 + 다음 줄 URL)
export function parseM3u(text, def) {
  const out = [], lines = String(text || "").split(/\r?\n/);
  let cur = null;
  for (const raw of lines) {
    const ln = raw.trim();
    if (!ln) continue;
    if (ln.startsWith("#EXTINF")) {
      const attr = (k) => { const m = ln.match(new RegExp(k + '="([^"]*)"')); return m ? m[1] : ""; };
      const name = ln.slice(ln.lastIndexOf(",") + 1).trim().replace(/\s*[\(\[](\d+p|geo-blocked|not 24\/7)[^\)\]]*[\)\]]/gi, "").trim();
      cur = { n: name.slice(0, 60), l: attr("tvg-logo"), g: attr("group-title"), id: attr("tvg-id"), c: (attr("tvg-country") || def.c || "").toUpperCase().slice(0, 2), o: [] };
    } else if (/^#(EXTVLCOPT|KODIPROP|EXTHTTP):/i.test(ln)) { if (cur && cur.o.length < 4) cur.o.push(ln.slice(0, 240)); continue; }
    else if (ln.startsWith("#")) { continue; }
    else if (cur && /^https?:\/\//i.test(ln)) {
      const u = ln.split(/\s/)[0];
      if (!def.keepHttp && !/^https:\/\//i.test(u)) { cur = null; continue; } // 공개 목록의 http:// 는 https 화면에서 브라우저가 막음(혼합 콘텐츠) — 뺌. 내 목록은 앱으로 열 수 있어 남김
      const it = { i: (def.src || "m") + ":" + fnv(cur.id ? cur.id + "|" + u : cur.n + "|" + u), n: cur.n || "채널", l: cur.l, g: cur.g, u, c: cur.c || def.c || "", k: def.k || "tv" };
      if (cur.o.length) it.o = cur.o; // 앱(VLC·TiviMate)용 헤더 옵션 — m3u 내보내기 때 그대로 씀
      out.push(it);
      cur = null;
    }
  }
  return out;
}
function fnv(s) { let h = 0x811c9dc5; for (const c of new TextEncoder().encode(s)) { h ^= c; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, "0"); }

async function fetchText(url, ms = 12000) {
  const r = await fetch(url, { headers: { "user-agent": UA, accept: "*/*" }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error("HTTP " + r.status + " " + url);
  return await r.text();
}
// 같은 채널이 화질별로 여러 줄이면 첫 줄만
function dedupe(items) { const seen = new Set(), out = []; for (const x of items) { const key = x.n.toLowerCase() + "|" + x.c; if (seen.has(key)) continue; seen.add(key); out.push(x); } return out; }

export async function tvRefresh(env) {
  const tv = [], radio = [], err = [];
  for (const [c] of COUNTRIES) {
    try { tv.push(...dedupe(parseM3u(await fetchText("https://iptv-org.github.io/iptv/countries/" + c.toLowerCase() + ".m3u"), { c, k: "tv", src: "io" })).slice(0, TV_MAX)); }
    catch (e) { err.push("tv " + c + ": " + String(e.message || e).slice(0, 80)); }
  }
  const hosts = ["de1.api.radio-browser.info", "at1.api.radio-browser.info", "nl1.api.radio-browser.info"];
  for (const [c] of COUNTRIES) {
    for (let i = 0; i < hosts.length; i++) {
      try {
        const arr = JSON.parse(await fetchText("https://" + hosts[i] + "/json/stations/bycountrycodeexact/" + c + "?limit=" + RADIO_MAX + "&order=votes&reverse=true&hidebroken=true"));
        for (const s of arr) { const u = s.url_resolved || s.url; if (!u || !/^https:\/\//.test(u)) continue; radio.push({ i: "rb:" + String(s.stationuuid || fnv(u)).slice(0, 12), n: String(s.name || "").trim().slice(0, 60), l: s.favicon || "", g: String(s.tags || "").split(",")[0] || "", u, c, k: "radio", v: s.votes || 0 }); }
        break;
      } catch (e) { if (i === hosts.length - 1) err.push("radio " + c + ": " + String(e.message || e).slice(0, 80)); }
    }
  }
  const doc = { at: Date.now(), tv, radio, err };
  await env.KV.put("tv:list", JSON.stringify(doc));
  return doc;
}
// 중국 새벽 4시(UTC 20시) 하루 1번: 공개 목록 + 주소로 넣은 내 목록 다시 받기
export async function tvCron(env, uh, um) {
  if (!(um < 15 && uh === 20)) return;
  await tvRefresh(env);
  const ks = await env.KV.list({ prefix: "tv:my:" });
  for (const k of ks.keys) {
    const h = k.name.slice(6), d = await myLoad(env, h);
    let changed = false;
    for (const L of d.lists) {
      if (!L.url) continue;
      try { const items = parseM3u(await fetchText(L.url), { c: "", k: L.kind || "tv", src: L.id, keepHttp: true }); if (items.length) { d.items = d.items.filter((x) => !x.i.startsWith(L.id + ":")).concat(items.slice(0, MY_MAX)); L.n = items.length; L.at = Date.now(); changed = true; } } catch {}
    }
    if (changed) await env.KV.put("tv:my:" + h, JSON.stringify(d));
  }
}

async function myLoad(env, h) { return (await env.KV.get("tv:my:" + h, "json")) || { lists: [], items: [] }; }
async function myImport(env, h, b) {
  const d = await myLoad(env, h);
  const url = String(b.url || "").trim(), text = String(b.text || ""), name = String(b.name || "").trim().slice(0, 30), kind = b.kind === "radio" ? "radio" : "tv";
  let body = text;
  if (url) { if (!/^https?:\/\//i.test(url)) throw serr("주소는 http(s)로 시작해야 해요."); try { body = await fetchText(url); } catch (e) { throw serr("목록을 못 받았어요: " + String(e.message || e).slice(0, 100)); } }
  if (!/#EXTINF/i.test(body)) throw serr("m3u 형식이 아니에요(#EXTINF 줄이 없음).");
  const id = "my" + Date.now().toString(36);
  const items = parseM3u(body, { c: "", k: kind, src: id, keepHttp: true }).slice(0, MY_MAX);
  if (!items.length) throw serr("채널을 하나도 못 읽었어요.");
  d.lists.push({ id, name: name || (url ? url.replace(/^https?:\/\//, "").slice(0, 30) : "붙여 넣은 목록"), url: url || "", n: items.length, at: Date.now(), kind });
  d.items = d.items.concat(items);
  if (d.items.length > MY_MAX) d.items = d.items.slice(-MY_MAX);
  await env.KV.put("tv:my:" + h, JSON.stringify(d));
  return d;
}
async function myDel(env, h, id) {
  const d = await myLoad(env, h);
  d.lists = d.lists.filter((x) => x.id !== id); d.items = d.items.filter((x) => !x.i.startsWith(id + ":"));
  await env.KV.put("tv:my:" + h, JSON.stringify(d));
  return d;
}

export async function tvGet(req, env, url) {
  if (url.pathname === "/tv/channels") {
    const d = (await env.KV.get("tv:list", "json")) || { at: 0, tv: [], radio: [], err: ["목록이 아직 없어요 — 새로고침을 눌러 주세요"] };
    return new Response(JSON.stringify(d), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300" } });
  }
  return new Response("not found", { status: 404 });
}
export async function tvApi(env, ctx, path, b, h) {
  if (path === "/tv/state") {
    const [list, my, stat] = await Promise.all([env.KV.get("tv:list", "json"), myLoad(env, h), env.KV.get("tv:stat:" + h, "json")]);
    return { list: list || { at: 0, tv: [], radio: [], err: [] }, my, stat: stat || {} };
  }
  if (path === "/tv/refresh") {
    const k = "tv:re:" + new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 13);
    if (await env.KV.get(k)) throw serr("새로고침은 한 시간에 한 번만요. 매일 새벽 4시엔 자동으로 받아요.", 429);
    await env.KV.put(k, "1", { expirationTtl: 3600 });
    const d = await tvRefresh(env);
    return { ok: true, tv: d.tv.length, radio: d.radio.length, err: d.err, at: d.at };
  }
  if (path === "/tv/import") return { my: await myImport(env, h, b) };
  if (path === "/tv/my/del") return { my: await myDel(env, h, String(b.id || "")) };
  if (path === "/tv/stat") {
    const id = String(b.id || "").slice(0, 60); if (!id) throw serr("id");
    const s = (await env.KV.get("tv:stat:" + h, "json")) || {}, cur = s[id] || [0, 0, 0];
    if (b.ok) cur[0]++; else cur[1]++; cur[2] = Date.now(); s[id] = cur;
    const keys = Object.keys(s); if (keys.length > 800) for (const k of keys.sort((a, c) => s[a][2] - s[c][2]).slice(0, keys.length - 800)) delete s[k];
    await env.KV.put("tv:stat:" + h, JSON.stringify(s));
    return { ok: true };
  }
  throw serr("not_found", 404);
}

export const TV_HTML = String.raw`<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#141414">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="박비서 TV">
<link rel="apple-touch-icon" href="/icon-180.png">
<title>박비서 TV</title>
<style>
@font-face{font-family:"Pretendard";font-weight:400;src:url(/fonts/pretendard-400.woff2) format("woff2");font-display:swap}
@font-face{font-family:"Pretendard";font-weight:700;src:url(/fonts/pretendard-700.woff2) format("woff2");font-display:swap}
@font-face{font-family:"BB BlackHan";src:url(/fonts/blackhan.woff) format("woff");font-display:swap}
@font-face{font-family:"BB Lilita";src:url(/fonts/lilita.woff) format("woff");font-display:swap}
:root{--bg:#141414;--bg2:#1f1f1f;--bg3:#2a2a2a;--line:#333;--red:#E50914;--red2:#B20710;--ink:#fff;--ink2:#b3b3b3;--ink3:#777;--ok:#46d369;--bad:#e87c03;
  --sans:"Pretendard",-apple-system,"Apple SD Gothic Neo","PingFang SC",system-ui,sans-serif;--disp:"BB Lilita","BB BlackHan","Pretendard",sans-serif;color-scheme:dark}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 var(--sans);-webkit-font-smoothing:antialiased;min-height:100vh}
button,input,textarea{font:inherit;color:inherit}button{cursor:pointer;border:0;background:none;padding:0}
a{color:inherit;text-decoration:none}
.hidden{display:none!important}
/* 머리 */
.top{position:sticky;top:0;z-index:40;display:flex;align-items:center;gap:18px;padding:calc(10px + env(safe-area-inset-top)) 4% 10px;background:linear-gradient(180deg,rgba(0,0,0,.9),rgba(20,20,20,.8) 70%,rgba(20,20,20,0))}
.logo{font-family:var(--disp);font-size:26px;color:var(--red);letter-spacing:.01em;white-space:nowrap;text-shadow:0 2px 0 #4a0309}
.nav{display:flex;gap:16px;font-size:14px;color:var(--ink2);flex:1;overflow:auto;scrollbar-width:none}.nav::-webkit-scrollbar{display:none}
.nav button{white-space:nowrap;font-weight:500;padding:4px 0}.nav button.on{color:#fff;font-weight:700}
.tools{display:flex;gap:8px;align-items:center}
.ib{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;color:#fff;background:rgba(255,255,255,.1)}.ib:active{background:rgba(255,255,255,.25)}
.ib svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.search{display:none;align-items:center;gap:8px;background:#000;border:1px solid #666;padding:6px 10px;border-radius:4px}.search.on{display:flex}
.search input{background:none;border:0;outline:0;width:150px;color:#fff}
/* 히어로 */
.hero{position:relative;margin-top:-62px;background:#000}
.screen{position:relative;width:100%;aspect-ratio:16/9;max-height:76vh;min-height:300px;background:radial-gradient(ellipse at 70% 30%,#3a0a0f 0%,#1a0507 35%,#000 70%);overflow:hidden}
.screen video,.screen img.art{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000}
.screen .art{padding:12%;opacity:.9}
.screen .shade{position:absolute;inset:0;background:linear-gradient(0deg,#141414 0%,rgba(20,20,20,.75) 18%,rgba(20,20,20,0) 50%),linear-gradient(90deg,rgba(0,0,0,.55),rgba(0,0,0,0) 60%);pointer-events:none}
.screen .shade.playing{background:linear-gradient(0deg,#141414 0%,rgba(20,20,20,0) 14%)}
.hero-txt{position:absolute;left:4%;right:4%;bottom:12%;max-width:620px;z-index:2}
.badge{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;letter-spacing:.14em;color:#fff;margin-bottom:8px}
.badge i{width:8px;height:8px;border-radius:50%;background:var(--red);display:inline-block}
.badge i.live{animation:pulse 1.4s infinite}@keyframes pulse{50%{box-shadow:0 0 0 6px rgba(229,9,20,.25)}}
.hero-txt h1{font-family:var(--disp);font-weight:400;font-size:clamp(32px,6vw,72px);line-height:1;margin:0 0 10px;text-shadow:0 2px 12px rgba(0,0,0,.7)}
.hero-txt p{margin:0 0 14px;color:#e5e5e5;font-size:14px;text-shadow:0 1px 8px rgba(0,0,0,.7)}
.btns{display:flex;gap:10px;flex-wrap:wrap}
.btn{display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border-radius:4px;font-weight:700;font-size:15px;background:#fff;color:#000}
.btn svg{width:20px;height:20px;fill:currentColor}
.btn.gray{background:rgba(109,109,110,.7);color:#fff}.btn.red{background:var(--red);color:#fff}.btn:active{opacity:.8}.btn.on{background:var(--red);color:#fff}
.err{position:absolute;left:4%;right:4%;bottom:3%;z-index:3;background:rgba(0,0,0,.75);border-left:3px solid var(--red);padding:10px 12px;font-size:13px;color:#fff;border-radius:4px}
/* 칩 */
.chips{display:flex;gap:8px;padding:6px 4%;overflow:auto;scrollbar-width:none;position:relative;z-index:3}.chips::-webkit-scrollbar{display:none}
.chip{white-space:nowrap;padding:6px 14px;border-radius:999px;border:1px solid #555;color:#ddd;font-size:13px;font-weight:600}.chip.on{background:var(--red);border-color:var(--red);color:#fff}
/* 줄 */
.rows{padding:8px 0 90px}
.row{margin:18px 0 6px}
.row h2{font-size:17px;font-weight:700;margin:0 0 8px 4%;display:flex;align-items:center;gap:10px}
.row h2 small{color:var(--ink3);font-size:12px;font-weight:500}.row h2 .flag{font-size:20px}
.strip{display:flex;gap:8px;overflow-x:auto;padding:4px 4% 10px;scroll-snap-type:x proximity;scrollbar-width:none}.strip::-webkit-scrollbar{display:none}
.card{flex:0 0 calc(33.33% - 6px);scroll-snap-align:start;position:relative;border-radius:5px;overflow:hidden;background:var(--bg2);aspect-ratio:16/9;display:grid;place-items:center;transition:transform .15s;text-align:left;color:#fff}
.card:active{transform:scale(.97)}.card.on{outline:2px solid #fff;outline-offset:-2px}
.card img{width:70%;height:60%;object-fit:contain;filter:drop-shadow(0 2px 6px rgba(0,0,0,.6))}
.card .txt{font-family:var(--disp);font-size:clamp(14px,2.4vw,22px);padding:0 10px;text-align:center;color:#eee;line-height:1.1;word-break:keep-all}
.card .txt+.nm{display:none}.card .nm{position:absolute;left:0;right:0;bottom:0;padding:16px 8px 6px;font-size:11px;font-weight:600;background:linear-gradient(0deg,rgba(0,0,0,.85),transparent);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.card .st{position:absolute;top:6px;right:6px;width:8px;height:8px;border-radius:50%;background:#555}.card .st.ok{background:var(--ok)}.card .st.bad{background:var(--bad)}
.card .fav{position:absolute;top:2px;left:5px;font-size:14px;color:var(--red)}
.card .tag{position:absolute;top:5px;left:6px;font-size:9px;font-weight:800;letter-spacing:.05em;background:var(--bad);color:#000;padding:1px 5px;border-radius:3px}.card.np{opacity:.45}
.card.radio{aspect-ratio:1/1;flex-basis:calc(25% - 6px)}.card.radio img{width:60%;height:60%;border-radius:8px}
@media(min-width:700px){.card{flex-basis:calc(20% - 7px)}.card.radio{flex-basis:calc(14.28% - 7px)}}
@media(min-width:1100px){.card{flex-basis:calc(14.28% - 7px)}.card.radio{flex-basis:calc(10% - 8px)}}
.empty{margin:10px 4%;padding:24px;border:1px dashed #444;border-radius:6px;color:var(--ink2);font-size:13px;text-align:center}
/* 시트 */
.sheet{position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:60;display:none;align-items:flex-end;justify-content:center}.sheet.on{display:flex}
.sheet .box{background:var(--bg2);width:100%;max-width:560px;border-radius:16px 16px 0 0;padding:18px 18px calc(18px + env(safe-area-inset-bottom));max-height:88vh;overflow:auto}
.sheet h3{margin:0 0 6px;font-size:18px}.sheet p{color:var(--ink2);font-size:12.5px;margin:0 0 12px}
.sheet input,.sheet textarea{width:100%;background:#333;border:1px solid #555;border-radius:6px;padding:10px;color:#fff;outline:0;margin-bottom:8px;font-size:14px}
.sheet textarea{min-height:110px;font-family:ui-monospace,monospace;font-size:12px}
.seg{display:flex;gap:6px;margin-bottom:10px}.seg .chip{flex:1;text-align:center}
.lst{display:flex;flex-direction:column;gap:6px;margin:10px 0}
.lst div{display:flex;align-items:center;gap:10px;background:#2a2a2a;border-radius:6px;padding:8px 10px;font-size:13px}.lst div b{flex:1}.lst div small{color:var(--ink3)}.lst div button{color:var(--red);font-weight:700}
.toast{position:fixed;left:50%;bottom:28px;transform:translate(-50%,10px);background:#fff;color:#000;padding:10px 16px;border-radius:6px;font-weight:700;font-size:13px;opacity:0;transition:.2s;z-index:80;pointer-events:none;max-width:90vw;text-align:center}.toast.on{opacity:1;transform:translate(-50%,0)}
.mini{position:fixed;left:0;right:0;bottom:0;z-index:50;display:none;align-items:center;gap:10px;padding:8px 4% calc(8px + env(safe-area-inset-bottom));background:#000;border-top:1px solid #333}
.mini.on{display:flex}.mini img{width:40px;height:40px;border-radius:6px;object-fit:contain;background:#222}.mini b{flex:1;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mini small{display:block;color:var(--ink3);font-weight:400;font-size:11px}
.mini .ib{background:#fff;color:#000}
.foot{color:var(--ink3);font-size:11px;padding:10px 4% 20px;line-height:1.6}.foot button{color:#fff;text-decoration:underline}
</style>
</head>
<body>
<header class="top">
  <div class="logo">박비서TV</div>
  <nav class="nav" id="nav"><button data-v="home" class="on">홈</button><button data-v="tv">TV</button><button data-v="radio">라디오</button><button data-v="my">내 목록</button><button data-v="fav">즐겨찾기</button></nav>
  <div class="tools">
    <label class="search" id="searchBox"><input id="q" placeholder="채널 검색" autocomplete="off"></label>
    <button class="ib" id="sBtn" aria-label="검색"><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/></svg></button>
    <button class="ib" id="addBtn" aria-label="목록 추가"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
  </div>
</header>
<section class="hero">
  <div class="screen" id="screen">
    <video id="vid" playsinline webkit-playsinline preload="none" class="hidden"></video>
    <audio id="aud" preload="none"></audio>
    <img class="art" id="art" alt="">
    <div class="shade" id="shade"></div>
    <div class="hero-txt">
      <div class="badge"><i id="dot"></i><span id="kick">박비서 TV</span></div>
      <h1 id="h1">채널을 골라 주세요</h1>
      <p id="desc">아래 줄에서 채널을 탭하면 바로 재생돼요. 중국에서 열리는 채널은 재생될 때마다 초록 점으로 표시해요.</p>
      <div class="btns"><button class="btn gray" id="appBtn">📲 앱으로</button><button class="btn" id="playBtn"><svg viewBox="0 0 24 24"><path d="M6 4l14 8-14 8z"/></svg><span>재생</span></button><button class="btn gray" id="favBtn">♡ 즐겨찾기</button><button class="btn gray" id="fsBtn">⛶ 전체 화면</button></div>
    </div>
    <div class="err hidden" id="err"></div>
  </div>
</section>
<div class="chips" id="chips"></div>
<main class="rows" id="rows"><div class="empty">목록 받는 중…</div></main>
<div class="foot" id="foot"></div>
<div class="mini" id="mini"><img id="mImg" alt=""><b id="mNm">—<small id="mSub"></small></b><button class="ib" id="mStop" aria-label="멈춤"><svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg></button></div>
<div class="sheet" id="sheet"><div class="box">
  <h3>내 목록 추가</h3><p>받은 m3u 주소를 붙여 넣거나, 파일 내용을 그대로 붙여 넣으세요. 주소로 넣은 목록은 매일 새벽 다시 받아요.</p>
  <div class="seg"><button class="chip on" data-k="tv">📺 TV</button><button class="chip" data-k="radio">📻 라디오</button></div>
  <input id="iName" placeholder="목록 이름(선택)"><input id="iUrl" placeholder="https://…/playlist.m3u"><textarea id="iText" placeholder="#EXTM3U
#EXTINF:-1 tvg-logo=&quot;…&quot; group-title=&quot;News&quot;,채널 이름
https://…/index.m3u8"></textarea>
  <div class="btns"><button class="btn red" id="iGo">추가</button><button class="btn gray" id="iExp">📤 m3u 내보내기</button><button class="btn gray" id="iClose">닫기</button></div>
  <p>내보내기 = 내 목록 + 즐겨찾기를 m3u 파일로(헤더 옵션 유지) → VLC·TiviMate·Infuse 에 넣어 앱에서 통째로 보기.</p>
  <div class="lst" id="myLists"></div>
</div></div>
<div class="sheet" id="appSheet"><div class="box">
  <h3 id="asTitle">📲 앱으로 열기</h3><p>브라우저가 못 트는 형식(FLV·TS·RTMP)은 IPTV 앱이 틀어요. 앱이 없으면 App Store에서 받으세요(VLC 무료).</p>
  <div class="lst" id="asList"></div>
  <div class="btns"><button class="btn gray" id="asCopy">주소 복사</button><button class="btn gray" id="asClose">닫기</button></div>
</div></div>
<div class="toast" id="toast"></div>
<script>
'use strict';
var $=function(id){return document.getElementById(id)};
var CODE=localStorage.getItem('pb-code')||'';
var COUNTRIES=[['KR','🇰🇷','한국'],['CN','🇨🇳','중국'],['HK','🇭🇰','홍콩'],['TW','🇹🇼','대만'],['JP','🇯🇵','일본']];
var GENRE={General:'종합',News:'뉴스',Entertainment:'예능',Music:'음악',Sports:'스포츠',Kids:'키즈',Movies:'영화',Documentary:'다큐',Education:'교육',Religious:'종교',Shop:'홈쇼핑',Business:'경제',Culture:'문화',Lifestyle:'라이프',Animation:'애니',Series:'드라마',Family:'가족',Legislative:'의회',Outdoor:'아웃도어',Science:'과학',Travel:'여행',Weather:'날씨',Comedy:'코미디',Classic:'클래식',Auto:'자동차',Cooking:'요리',Public:'공영',Undefined:'기타',Relax:'힐링'};
var LIST={tv:[],radio:[],at:0,err:[]},MY={lists:[],items:[]},STAT={};
var FAV=new Set(),RECENT=[];try{FAV=new Set(JSON.parse(localStorage.getItem('tv-fav')||'[]'));RECENT=JSON.parse(localStorage.getItem('tv-recent')||'[]')}catch(e){}
var S={view:'home',genre:'all',q:'',cur:null,playing:false,hideBad:localStorage.getItem('tv-hidebad')!=='0'},ALL={};
function save(){try{localStorage.setItem('tv-fav',JSON.stringify([...FAV]));localStorage.setItem('tv-recent',JSON.stringify(RECENT.slice(0,30)))}catch(e){}}
var tT;function toast(m){$('toast').textContent=m;$('toast').classList.add('on');clearTimeout(tT);tT=setTimeout(function(){$('toast').classList.remove('on')},2600)}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function post(p,b){b=b||{};b.code=CODE;return fetch(p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json()}).then(function(j){if(j&&j.error)throw new Error(j.detail||j.error);return j})}
function needCode(){if(CODE)return true;var c=prompt('초대 코드(한 번만 저장)');if(!c)return false;CODE=c.trim();localStorage.setItem('pb-code',CODE);return true}
function index(){ALL={};[].concat(LIST.tv,LIST.radio,MY.items).forEach(function(x){ALL[x.i]=x})}
function gname(g){if(!g)return '';var k=g.split(';')[0].trim();return GENRE[k]||k}
function flag(c){var f=COUNTRIES.filter(function(x){return x[0]===c})[0];return f?f[1]:'📡'}
function fmt(u){var m=/\.(m3u8|flv|ts|mp4|mp3|aac|m4a|ogg|opus|webm|mpd)(\?|$)/i.exec(u||''),e=m?m[1].toLowerCase():'';if(/^(rtmp|rtsp|mms|udp|rtp):/i.test(u||''))e=u.split(':')[0].toLowerCase();return e}
function unplayable(x){var e=fmt(x.u);if(/^http:\/\//i.test(x.u||''))return 'HTTP';return e==='flv'||e==='ts'||e==='mpd'||e==='rtmp'||e==='rtsp'||e==='mms'||e==='udp'||e==='rtp'?e.toUpperCase():''}
function st(id){var s=STAT[id];if(!s)return '';return s[0]>=s[1]?'ok':'bad'}
function cardHtml(x){var cls='card'+(x.k==='radio'?' radio':'')+(S.cur&&S.cur.i===x.i?' on':'');
  var inner=x.l?'<img src="'+esc(x.l)+'" loading="lazy" alt="" onerror="this.replaceWith(Object.assign(document.createElement(\'span\'),{className:\'txt\',textContent:this.nextSibling.textContent}))">':'<span class="txt">'+esc(x.n)+'</span>';
  var bad=unplayable(x);return '<button class="'+cls+(bad?' np':'')+'" data-id="'+esc(x.i)+'">'+inner+'<span class="nm">'+esc(x.n)+'</span><span class="st '+st(x.i)+'"></span>'+(bad?'<span class="tag">'+bad+'</span>':'')+(FAV.has(x.i)?'<span class="fav">♥</span>':'')+'</button>'}
function row(title,items,sub){if(!items.length)return '';return '<section class="row"><h2>'+title+(sub?' <small>'+esc(sub)+'</small>':'')+'</h2><div class="strip">'+items.map(cardHtml).join('')+'</div></section>'}
function filt(items){var q=S.q.trim().toLowerCase();return items.filter(function(x){if(S.hideBad&&(st(x.i)==='bad'||unplayable(x))&&!FAV.has(x.i))return false;var g=gname(x.g)||'기타';if(S.genre!=='all'&&g!==S.genre)return false;if(q&&(x.n+' '+g).toLowerCase().indexOf(q)<0)return false;return true})}
function render(){var h='',v=S.view;
  var rec=RECENT.map(function(i){return ALL[i]}).filter(Boolean),fav=[...FAV].map(function(i){return ALL[i]}).filter(Boolean);
  if(v==='home'||v==='fav')h+=row('♥ 즐겨찾기',filt(fav));
  if(v==='home'){h+=row('최근 본 채널',filt(rec));if(MY.items.length)h+=row('내 목록',filt(MY.items).slice(0,40))}
  if(v==='my'){MY.lists.forEach(function(L){h+=row('📂 '+esc(L.name),filt(MY.items.filter(function(x){return x.i.indexOf(L.id+':')===0})),L.n+'개')});if(!MY.lists.length)h+='<div class="empty">아직 내 목록이 없어요. 오른쪽 위 ＋ 로 m3u 주소나 내용을 붙여 넣으세요.</div>'}
  if(v==='home'||v==='tv')COUNTRIES.forEach(function(c){h+=row('<span class="flag">'+c[1]+'</span>'+c[2]+' TV',filt(LIST.tv.filter(function(x){return x.c===c[0]})))});
  if(v==='home'||v==='radio')COUNTRIES.forEach(function(c){h+=row('<span class="flag">'+c[1]+'</span>'+c[2]+' 라디오',filt(LIST.radio.filter(function(x){return x.c===c[0]})))});
  if(!h)h='<div class="empty">'+(v==='fav'?'카드를 길게 누르거나 ♡ 버튼으로 즐겨찾기를 담아 두세요.':'표시할 채널이 없어요.')+'</div>';
  $('rows').innerHTML=h;
  var gs={};[].concat(LIST.tv,MY.items).forEach(function(x){var g=gname(x.g)||'기타';gs[g]=(gs[g]||0)+1});
  var top=Object.keys(gs).sort(function(a,b){return gs[b]-gs[a]}).slice(0,12);
  var nbad=Object.keys(STAT).filter(function(i){return ALL[i]&&st(i)==='bad'}).length;
  $('chips').innerHTML='<button class="chip'+(S.genre==='all'?' on':'')+'" data-g="all">전체</button>'+top.map(function(g){return '<button class="chip'+(S.genre===g?' on':'')+'" data-g="'+esc(g)+'">'+esc(g)+'</button>'}).join('')+'<button class="chip'+(S.hideBad?' on':'')+'" id="hideBad" style="margin-left:auto">'+(S.hideBad?'🙈 안 열리는 채널 숨김':'👁 안 열리는 채널 보임')+(nbad?' '+nbad:'')+'</button>';
  $('hideBad').onclick=function(){S.hideBad=!S.hideBad;localStorage.setItem('tv-hidebad',S.hideBad?'1':'0');render()};
  $('chips').classList.remove('hidden');
  $('foot').innerHTML='채널 출처: iptv-org(공개 무료 방송 색인) · radio-browser.info'+(LIST.at?' · 목록 갱신 '+new Date(LIST.at).toLocaleString('ko-KR',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'')+' · TV '+LIST.tv.length+' · 라디오 '+LIST.radio.length+(MY.items.length?' · 내 목록 '+MY.items.length:'')+'개'+(LIST.err&&LIST.err.length?'<br>⚠ '+LIST.err.map(esc).join(' / '):'')+'<br>재생은 폰이 방송 서버에 직접 접속해요 — 중국 회선에서 안 열리는 채널은 주황 점, 열린 채널은 초록 점. <button id="reBtn">목록 새로고침</button>';
  $('reBtn').onclick=refresh}
function pick(x){S.cur=x;$('h1').textContent=x.n;$('kick').textContent=(x.k==='radio'?'RADIO · ':'TV · ')+flag(x.c)+' '+(gname(x.g)||'');$('desc').textContent=(x.k==='radio'?'라디오':'TV')+(st(x.i)==='ok'?' · 최근 재생 성공':st(x.i)==='bad'?' · 최근 재생 실패 — 중국에서 안 열릴 수 있어요':' · 아직 재생해 본 적 없음');
  $('art').src=x.l||'';$('art').classList.toggle('hidden',!x.l||S.playing);$('favBtn').textContent=(FAV.has(x.i)?'♥':'♡')+' 즐겨찾기';$('favBtn').classList.toggle('on',FAV.has(x.i));$('err').classList.add('hidden');
  document.querySelectorAll('.card.on').forEach(function(e){e.classList.remove('on')});var el=document.querySelector('.card[data-id="'+CSS.escape(x.i)+'"]');if(el)el.classList.add('on')}
var watch=null,reported=false;
function report(ok){if(reported||!S.cur)return;reported=true;var id=S.cur.i;var s=STAT[id]||[0,0,0];if(ok)s[0]++;else s[1]++;s[2]=Date.now();STAT[id]=s;if(CODE)post('/tv/stat',{id:id,ok:ok}).catch(function(){});render();pick(S.cur);$('dot').classList.toggle('live',ok)}
function stop(){var v=$('vid'),a=$('aud');clearTimeout(watch);try{v.pause();v.removeAttribute('src');v.load()}catch(e){}try{a.pause();a.removeAttribute('src');a.load()}catch(e){}v.classList.add('hidden');S.playing=false;$('art').classList.toggle('hidden',!(S.cur&&S.cur.l));$('shade').classList.remove('playing');$('mini').classList.remove('on');$('dot').classList.remove('live');$('playBtn').innerHTML='<svg viewBox="0 0 24 24"><path d="M6 4l14 8-14 8z"/></svg><span>재생</span>'}
function play(x){if(!x)return;stop();pick(x);reported=false;$('err').classList.add('hidden');
  var np=unplayable(x);if(np){$('err').textContent=np+' 스트림은 브라우저가 직접 못 틀어요 — 아래 📲 앱으로 여세요.';$('err').classList.remove('hidden');openApp(x);return}
  RECENT=[x.i].concat(RECENT.filter(function(i){return i!==x.i}));save();
  var el=x.k==='radio'?$('aud'):$('vid');
  if(x.k==='tv'){var ok=el.canPlayType('application/vnd.apple.mpegurl')||el.canPlayType('application/x-mpegURL');if(!ok&&/m3u8/i.test(x.u)){$('err').textContent='이 브라우저는 HLS 를 직접 못 틀어요 — 아이폰·아이패드·맥 사파리에서 열어 주세요.';$('err').classList.remove('hidden')}
    el.classList.remove('hidden');$('art').classList.add('hidden')}
  el.src=x.u;el.load();
  var p=el.play();if(p&&p.catch)p.catch(function(e){if(!S.playing)return;var m=String(e&&e.message||e);fail(/not supported/i.test(m)?'이 형식은 브라우저가 못 틀어요 — '+(fmt(x.u)||'확장자 없음')+' · '+x.u.replace(/^https?:\/\//,'').slice(0,60):/NotAllowed/i.test(e&&e.name)?'한 번 더 눌러 주세요(자동 재생 제한)':'재생 실패: '+m)});
  S.playing=true;$('shade').classList.add('playing');$('playBtn').innerHTML='<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg><span>멈춤</span>';
  $('mImg').src=x.l||'';$('mNm').firstChild.textContent=x.n;$('mSub').textContent=flag(x.c)+' '+(x.k==='radio'?'라디오':'TV');$('mini').classList.add('on');
  clearTimeout(watch);watch=setTimeout(function(){if(S.playing&&!reported)fail('12초 안에 안 열렸어요 — 중국 회선에서 막혔거나 꺼진 채널일 수 있어요.')},12000);
  if('mediaSession' in navigator){try{navigator.mediaSession.metadata=new MediaMetadata({title:x.n,artist:'박비서 TV',artwork:x.l?[{src:x.l}]:[]});navigator.mediaSession.setActionHandler('pause',stop);navigator.mediaSession.setActionHandler('play',function(){play(x)})}catch(e){}}
  if(CODE)fetch('/u',{method:'POST',body:JSON.stringify({app:'tv',c:{play:1},sec:0}),keepalive:true}).catch(function(){})}
function fail(m){$('err').textContent=m+' · 📲 앱으로 열기를 눌러 보세요';$('err').classList.remove('hidden');report(false);stop();$('err').classList.remove('hidden')}
['vid','aud'].forEach(function(id){var el=$(id);el.addEventListener('playing',function(){clearTimeout(watch);report(true)});el.addEventListener('error',function(){if(S.playing)fail('이 채널은 지금 안 열려요(서버 오류 또는 지역 차단).')});el.addEventListener('ended',stop)});
$('playBtn').onclick=function(){if(!S.cur)return toast('아래에서 채널을 고르세요');if(S.playing)stop();else play(S.cur)};
$('mStop').onclick=stop;
$('favBtn').onclick=function(){if(!S.cur)return;var i=S.cur.i;if(FAV.has(i)){FAV.delete(i);toast('즐겨찾기에서 뺐어요')}else{FAV.add(i);toast('즐겨찾기에 담았어요')}save();render();pick(S.cur)};
$('fsBtn').onclick=function(){var v=$('vid');if(v.classList.contains('hidden'))return toast('TV 채널을 재생한 뒤 눌러 주세요');if(v.webkitEnterFullscreen)v.webkitEnterFullscreen();else if(v.requestFullscreen)v.requestFullscreen()};
document.addEventListener('click',function(e){var c=e.target.closest('.card');if(c){var x=ALL[c.getAttribute('data-id')];if(x)play(x);return}var g=e.target.closest('.chip[data-g]');if(g){S.genre=g.getAttribute('data-g');render();return}var n=e.target.closest('#nav button');if(n){S.view=n.getAttribute('data-v');document.querySelectorAll('#nav button').forEach(function(b){b.classList.toggle('on',b===n)});render();window.scrollTo({top:$('chips').offsetTop-70,behavior:'smooth'})}});
var pressT;document.addEventListener('touchstart',function(e){var c=e.target.closest('.card');if(!c)return;pressT=setTimeout(function(){var i=c.getAttribute('data-id');if(FAV.has(i))FAV.delete(i);else FAV.add(i);save();render();toast(FAV.has(i)?'♥ 즐겨찾기에 담았어요':'즐겨찾기에서 뺐어요')},600)},{passive:true});
document.addEventListener('touchend',function(){clearTimeout(pressT)});document.addEventListener('touchmove',function(){clearTimeout(pressT)});
$('sBtn').onclick=function(){$('searchBox').classList.toggle('on');if($('searchBox').classList.contains('on'))$('q').focus();else{S.q='';$('q').value='';render()}};
$('q').oninput=function(){S.q=this.value;render()};
// 📲 앱으로 열기: iOS URL 스킴(VLC·Infuse·nPlayer). 헤더가 필요한 스트림은 스킴으로 못 넘겨 m3u 내보내기로
var APPS=[['VLC','vlc-x-callback://x-callback-url/stream?url=',1],['Infuse','infuse://x-callback-url/play?url=',1],['nPlayer','nplayer-',0],['OPlayer','oplayer://',0]];
function openApp(x){if(!x)return;$('asTitle').textContent='📲 '+x.n;$('asList').innerHTML=APPS.map(function(a,i){return '<div><b>'+a[0]+'</b><small>'+(unplayable(x)||fmt(x.u).toUpperCase()||'스트림')+(x.o?' · 헤더 필요(앱에서 안 되면 m3u 내보내기)':'')+'</small><button data-app="'+i+'">열기</button></div>'}).join('');
  document.querySelectorAll('[data-app]').forEach(function(b){b.onclick=function(){var a=APPS[+b.getAttribute('data-app')];location.href=a[1]+(a[2]?encodeURIComponent(x.u):x.u);toast(a[0]+' 여는 중… 안 열리면 앱이 없는 거예요')}});
  $('asCopy').onclick=function(){(navigator.clipboard?navigator.clipboard.writeText(x.u):Promise.reject()).then(function(){toast('주소 복사했어요')},function(){prompt('주소',x.u)})};
  $('appSheet').classList.add('on')}
$('asClose').onclick=function(){$('appSheet').classList.remove('on')};$('appSheet').onclick=function(e){if(e.target===$('appSheet'))$('appSheet').classList.remove('on')};
$('appBtn').onclick=function(){if(!S.cur)return toast('채널을 먼저 고르세요');openApp(S.cur)};
function exportM3u(){var items=MY.items.concat([...FAV].map(function(i){return ALL[i]}).filter(function(x){return x&&x.i.indexOf('my')!==0}));if(!items.length)return toast('내보낼 채널이 없어요');
  var t='#EXTM3U\n'+items.map(function(x){return '#EXTINF:-1'+(x.l?' tvg-logo="'+x.l+'"':'')+' group-title="'+(x.g||'')+'",'+x.n+'\n'+(x.o||[]).join('\n')+(x.o?'\n':'')+x.u}).join('\n')+'\n';
  var f=new File([t],'parktv.m3u',{type:'audio/x-mpegurl'});
  if(navigator.canShare&&navigator.canShare({files:[f]}))navigator.share({files:[f],title:'박비서 TV 목록'}).catch(function(){});
  else{var a=document.createElement('a');a.href=URL.createObjectURL(f);a.download='parktv.m3u';document.body.appendChild(a);a.click();a.remove()}}
$('iExp').onclick=exportM3u;
// 내 목록(m3u 가져오기)
var KIND='tv';
$('addBtn').onclick=function(){if(!needCode())return;$('sheet').classList.add('on');myLists()};
$('iClose').onclick=function(){$('sheet').classList.remove('on')};
$('sheet').onclick=function(e){if(e.target===$('sheet'))$('sheet').classList.remove('on')};
document.querySelectorAll('.seg .chip').forEach(function(b){b.onclick=function(){KIND=b.getAttribute('data-k');document.querySelectorAll('.seg .chip').forEach(function(x){x.classList.toggle('on',x===b)})}});
function myLists(){$('myLists').innerHTML=MY.lists.map(function(L){return '<div><b>'+esc(L.name)+'</b><small>'+L.n+'개'+(L.url?' · 주소':' · 붙여 넣기')+'</small><button data-del="'+esc(L.id)+'">삭제</button></div>'}).join('')||'<div><small>아직 없음</small></div>';
  document.querySelectorAll('[data-del]').forEach(function(b){b.onclick=function(){if(!confirm('이 목록을 지울까요?'))return;post('/tv/my/del',{id:b.getAttribute('data-del')}).then(function(j){MY=j.my;index();render();myLists();toast('지웠어요')}).catch(function(e){toast(e.message)})}})}
$('iGo').onclick=function(){var url=$('iUrl').value.trim(),text=$('iText').value;if(!url&&!text.trim())return toast('주소나 내용을 넣어 주세요');$('iGo').disabled=true;$('iGo').textContent='받는 중…';
  post('/tv/import',{url:url,text:url?'':text,name:$('iName').value,kind:KIND}).then(function(j){MY=j.my;index();$('iUrl').value='';$('iText').value='';$('iName').value='';var L=j.my.lists[j.my.lists.length-1],its=j.my.items.filter(function(x){return x.i.indexOf(L.id+':')===0}),np=its.filter(unplayable).length;toast('추가 '+its.length+'개'+(np?' — 그중 '+np+'개는 FLV·TS·http 라 브라우저에선 안 되고 📲 앱으로 열어요':''));S.view='my';document.querySelectorAll('#nav button').forEach(function(b){b.classList.toggle('on',b.getAttribute('data-v')==='my')});render();myLists();$('sheet').classList.remove('on')}).catch(function(e){toast(e.message)}).then(function(){$('iGo').disabled=false;$('iGo').textContent='추가'})};
function refresh(){if(!needCode())return;toast('공개 목록 받는 중… 20초쯤 걸려요');post('/tv/refresh').then(function(j){toast('TV '+j.tv+' · 라디오 '+j.radio+'개'+(j.err.length?' (일부 실패)':''));return load()}).catch(function(e){toast(e.message)})}
function load(){var p=CODE?post('/tv/state').then(function(j){LIST=j.list;MY=j.my||MY;STAT=j.stat||{}}):fetch('/tv/channels').then(function(r){return r.json()}).then(function(j){LIST=j});
  return p.then(function(){index();render();if(!S.cur){var first=(RECENT.map(function(i){return ALL[i]}).filter(Boolean)[0])||LIST.tv.filter(function(x){return x.c==='KR'})[0]||LIST.tv[0];if(first)pick(first)}
    if(!LIST.at&&CODE)refresh()}).catch(function(e){$('rows').innerHTML='<div class="empty">목록을 못 받았어요: '+esc(e.message)+'</div>'})}
load();
document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible'&&CODE)post('/tv/state').then(function(j){STAT=j.stat||STAT;MY=j.my||MY;index()}).catch(function(){})});
</script>
</body>
</html>`;
