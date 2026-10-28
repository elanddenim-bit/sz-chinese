// =========================================================
// 📶 VPN 용량 알림 (2026-10-28 소유자 '남은 용량·만료를 놓치지 않게, 공유기·폰 구독 다 같이')
//  GET  /vpn                  화면(박비서 초대 코드 pb-code, 주인 전용 — usage:owner)
//  POST /vpn/state  {code}                          → {groups, subs(주소는 가린 것), cfg, bark}
//  POST /vpn/add    {code, name, dev, url}          → 바로 한 번 조회해서 추가
//  POST /vpn/edit   {code, id, name?, dev?, url?}
//  POST /vpn/del    {code, id}
//  POST /vpn/check  {code}                          → 전부 다시 조회(하루 30번)
//  POST /vpn/cfg    {code, minGB?, days?, hour?, on?}
//  POST /vpn/test   {code}                          → 지금 상태로 Bark 시험 알림
// 조회: 구독 주소를 Clash 계열 UA 로 받아 응답 헤더 subscription-userinfo(upload·download·total·expire)를 읽음.
//       헤더가 없으면 본문(base64) 안의 '剩余流量/过期时间' 줄을 찾아봄. 노드 정보는 저장하지 않음.
// 같은 계정(총량·만료·사용량이 같음)은 한 묶음으로 보여 주고 알림도 한 번만.
// 알림(vpnCron, 중국 cfg.hour 정각 틱, 기본 9시): 남은 용량 < minGB · 만료 D-14/7/3/1/0 · 지금 속도면 만료 전에 바닥 — 출장 브리핑 Bark(brief:<해시>.bark)로
// 저장: KV vpn:<해시> {subs[{id,name,dev,url,last,err,at}], cfg, hist{그룹키:{날짜:사용바이트}}(60일), sent{조건:날짜}, day{d,n}}
// 구독 주소는 비밀번호와 같음 — 화면에는 가린 주소만 보냄, 저장소·메모리에 넣지 않음
// =========================================================
import { barkPush } from "./brief.js";

const cnDay = (t = Date.now()) => new Date(t + 8 * 3600e3).toISOString().slice(0, 10);
const verr = (message, status = 400) => Object.assign(new Error(message), { code: "vpn", status });
const GB = 1024 ** 3;
const DEVS = { router: "📡 공유기", iphone: "📱 아이폰", ipad: "📲 아이패드", mac: "💻 맥북", pc: "🖥 PC", etc: "🔌 기타" };
const KEY = (h) => "vpn:" + h;
const DEF_CFG = { minGB: 100, days: 14, hour: 9, on: true };

async function owner(env, h) {
  let o = await env.KV.get("usage:owner");
  if (!o) { await env.KV.put("usage:owner", h); o = h; }
  if (o !== h) throw verr("VPN 용량 알림은 주인만 쓸 수 있어요.", 403);
}
async function load(env, h) {
  const d = (await env.KV.get(KEY(h), "json")) || {};
  return { subs: d.subs || [], cfg: { ...DEF_CFG, ...(d.cfg || {}) }, hist: d.hist || {}, sent: d.sent || {}, day: d.day || {} };
}
const save = (env, h, d) => env.KV.put(KEY(h), JSON.stringify(d));

const mask = (u) => {
  try {
    const x = new URL(u), tail = (x.pathname + x.search).replace(/[^A-Za-z0-9]/g, "").slice(-4);
    return x.host + "/…" + tail;
  } catch { return "…"; }
};

// ---------- 구독 조회 ----------
const UAS = ["clash-verge/v1.7.7", "ClashForWindows/0.20.39", "Shadowrocket/2070 CFNetwork/1410 Darwin/22.6.0", "Quantumult%20X/1.4.1"];
function parseInfo(s) {
  const o = {};
  for (const p of String(s || "").split(/[;,]/)) {
    const m = p.trim().match(/^(upload|download|total|expire)\s*=\s*(\d+(?:\.\d+)?)/i);
    if (m) o[m[1].toLowerCase()] = Number(m[2]);
  }
  return o.total ? { up: o.upload || 0, down: o.download || 0, total: o.total, expire: o.expire ? o.expire * 1000 : 0 } : null;
}
const unitB = (n, u) => n * ({ T: 1024 ** 4, G: GB, M: 1024 ** 2, K: 1024 }[String(u || "G")[0].toUpperCase()] || GB);
function parseBody(txt) {
  let t = String(txt || "").slice(0, 200000);
  if (!/STATUS=|剩余|过期|到期/.test(t)) {
    try { t = new TextDecoder().decode(Uint8Array.from(atob(t.replace(/\s+/g, "")), (c) => c.charCodeAt(0))); } catch {}
    t = t.split("\n").map((l) => { try { return decodeURIComponent(l); } catch { return l; } }).join("\n");
  }
  const left = t.match(/(?:剩余流量|剩余)[:：\s]*([\d.]+)\s*([TGMK])i?B/i);
  const used = t.match(/(?:已用流量|已用)[:：\s]*([\d.]+)\s*([TGMK])i?B/i);
  const tot = t.match(/(?:总流量|套餐流量|总计)[:：\s]*([\d.]+)\s*([TGMK])i?B/i);
  const exp = t.match(/(?:过期时间|到期时间|到期|过期)[:：\s]*(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (!left && !tot) return null;
  const L = left ? unitB(+left[1], left[2]) : null, U = used ? unitB(+used[1], used[2]) : null, T = tot ? unitB(+tot[1], tot[2]) : null;
  const total = T || (L != null && U != null ? L + U : L);
  const usedB = U != null ? U : T != null && L != null ? T - L : 0;
  return { up: 0, down: Math.max(0, usedB), total, expire: exp ? Date.UTC(+exp[1], +exp[2] - 1, +exp[3]) - 8 * 3600e3 + 86400e3 - 1 : 0, rough: true };
}
async function fetchSub(url) {
  let last = "응답 없음";
  for (const ua of UAS) {
    let r;
    try { r = await fetch(url, { headers: { "user-agent": ua, accept: "*/*" }, redirect: "follow", cf: { cacheTtl: 0 } }); }
    catch (e) { last = "연결 실패(" + String(e.message || e).slice(0, 60) + ")"; continue; }
    const info = parseInfo(r.headers.get("subscription-userinfo"));
    if (info) { try { r.body && r.body.cancel(); } catch {} return info; }
    if (!r.ok) { last = "서버 응답 " + r.status; try { r.body && r.body.cancel(); } catch {} continue; }
    const b = parseBody(await r.text().catch(() => ""));
    if (b) return b;
    last = "용량 정보가 없는 응답(이 서비스는 헤더를 안 줄 수 있어요)";
  }
  throw verr(last);
}

// ---------- 묶기·계산 ----------
const gkey = (l) => l ? (Math.round(l.total / 1e6) + "|" + Math.round((l.expire || 0) / 864e5)) : "";
function groups(d) {
  const by = {};
  for (const s of d.subs) {
    const k = s.last ? gkey(s.last) : "err:" + s.id;
    (by[k] = by[k] || { key: k, subs: [] }).subs.push(s);
  }
  return Object.values(by).map((g) => {
    const best = g.subs.filter((s) => s.last).sort((a, b) => (b.at || 0) - (a.at || 0))[0];
    if (!best) return { key: g.key, ids: g.subs.map((s) => s.id), err: g.subs[0].err || "아직 조회 전" };
    const l = best.last, used = l.up + l.down, left = Math.max(0, l.total - used);
    const days = l.expire ? Math.ceil((l.expire - Date.now()) / 864e5) : null;
    // 하루 사용량: 기록된 날짜들 사이 차이(사용량이 줄면 = 리셋, 그날은 뺌), 최근 7개 평균
    const h = d.hist[g.key] || {}, ds = Object.keys(h).sort(), daily = [];
    for (let i = 1; i < ds.length; i++) {
      const gap = Math.max(1, Math.round((Date.parse(ds[i]) - Date.parse(ds[i - 1])) / 864e5)), dv = h[ds[i]] - h[ds[i - 1]];
      if (dv >= 0) daily.push({ d: ds[i], v: dv / gap });
    }
    const recent = daily.slice(-7), rate = recent.length ? recent.reduce((a, x) => a + x.v, 0) / recent.length : null;
    const runOut = rate && rate > 0 ? Math.floor(left / rate) : null;
    return {
      key: g.key, ids: g.subs.map((s) => s.id), used, left, total: l.total, expire: l.expire || 0, days, rough: !!l.rough, at: best.at,
      rate, runOut, shortBefore: runOut != null && days != null && runOut < days, daily: daily.slice(-14),
    };
  });
}

async function refresh(env, d) {
  const today = cnDay();
  for (const s of d.subs) {
    try { s.last = await fetchSub(s.url); s.err = ""; s.at = Date.now(); }
    catch (e) { s.err = String(e.message || e).slice(0, 120); }
  }
  // 그룹별 오늘 사용량 기록(같은 계정은 한 줄)
  for (const s of d.subs) {
    if (!s.last || s.err) continue;
    const k = gkey(s.last), h = (d.hist[k] = d.hist[k] || {});
    h[today] = s.last.up + s.last.down;
    for (const x of Object.keys(h)) if (Date.parse(x) < Date.now() - 60 * 864e5) delete h[x];
  }
  const live = new Set(d.subs.filter((s) => s.last).map((s) => gkey(s.last)));
  for (const k of Object.keys(d.hist)) if (!live.has(k)) delete d.hist[k];
}

const gbs = (b) => b >= 100 * GB ? Math.round(b / GB) + "GB" : (b / GB).toFixed(1) + "GB";
const md = (t) => { const x = new Date(t + 8 * 3600e3); return (x.getUTCMonth() + 1) + "/" + x.getUTCDate(); };
function label(d, g) { return d.subs.filter((s) => g.ids.includes(s.id)).map((s) => s.name).join("·"); }

// 알릴 것 고르기 — 조건마다 하루 한 번(바닥 예상은 7일에 한 번)
function alerts(d, gs, force) {
  const out = [], today = cnDay(), c = d.cfg;
  for (const g of gs) {
    if (g.err) continue;
    const nm = label(d, g), lines = [];
    const once = (k, every = 1) => {
      const last = d.sent[g.key + "|" + k];
      if (force) return true; // 시험 알림은 기록하지 않음(진짜 알림을 막지 않게)
      if (last && (Date.parse(today) - Date.parse(last)) / 864e5 < every) return false;
      d.sent[g.key + "|" + k] = today; return true;
    };
    if (g.left < c.minGB * GB && once("low")) lines.push(`남은 용량 ${gbs(g.left)} (기준 ${c.minGB}GB 아래)`);
    if (g.days != null && [14, 7, 3, 1, 0].includes(g.days) && g.days <= c.days && once("exp" + g.days)) lines.push(g.days <= 0 ? "오늘 만료돼요" : `만료 D-${g.days} (${md(g.expire)})`);
    if (g.days != null && g.days < 0 && once("expired", 3)) lines.push("이미 만료됐어요");
    if (g.shortBefore && once("pace", 7)) lines.push(`지금 속도(하루 ${gbs(g.rate)})면 ${g.runOut < 1 ? "오늘 안에" : g.runOut + "일 뒤"} 바닥 — 만료(${md(g.expire)})보다 먼저`);
    if (force && !lines.length) lines.push(`남은 ${gbs(g.left)} / ${gbs(g.total)}` + (g.days != null ? ` · 만료 D-${g.days}` : "") + (g.rate ? ` · 하루 ${gbs(g.rate)}` : ""));
    if (lines.length) out.push({ title: "📶 VPN " + nm, body: lines.join("\n") });
  }
  if (force) for (const s of d.subs) if (s.err) out.push({ title: "📶 VPN " + s.name + " 조회 실패", body: s.err });
  return out;
}

async function send(env, h, list) {
  const doc = (await env.KV.get("brief:" + h, "json")) || {};
  if (!doc.bark) throw verr("Bark 주소가 없어요 — 출장 브리핑 화면에서 먼저 넣어 주세요.");
  for (const a of list) await barkPush(doc.bark, a.title, a.body, "https://voice.zhnote.net/vpn");
  return list.length;
}

function view(d) {
  return {
    cfg: d.cfg, devs: DEVS,
    subs: d.subs.map((s) => ({ id: s.id, name: s.name, dev: s.dev, host: mask(s.url), err: s.err || "", at: s.at || 0, ok: !!s.last })),
    groups: groups(d),
  };
}

export async function vpnApi(env, path, b, h) {
  await owner(env, h);
  const d = await load(env, h);
  const bark = !!(((await env.KV.get("brief:" + h, "json")) || {}).bark);
  if (path === "/vpn/state") return { ...view(d), bark };
  if (path === "/vpn/add" || path === "/vpn/edit") {
    let s;
    if (path === "/vpn/edit") { s = d.subs.find((x) => x.id === b.id); if (!s) throw verr("없는 항목이에요."); }
    else { if (d.subs.length >= 12) throw verr("12개까지만 넣을 수 있어요."); s = { id: "v" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }; }
    if (b.name != null) s.name = String(b.name).trim().slice(0, 20) || "구독";
    if (b.dev != null) s.dev = DEVS[b.dev] ? b.dev : "etc";
    if (b.url) {
      const u = String(b.url).trim();
      if (!/^https?:\/\/[^\s]+$/i.test(u) || u.length > 1000) throw verr("구독 주소(https://…)를 그대로 붙여 넣어 주세요.");
      s.url = u;
      try { s.last = await fetchSub(u); s.err = ""; s.at = Date.now(); } catch (e) { s.err = String(e.message || e).slice(0, 120); }
    }
    if (!s.url) throw verr("구독 주소가 필요해요.");
    if (!s.name) s.name = DEVS[s.dev || "etc"].split(" ")[1];
    if (path === "/vpn/add") d.subs.push(s);
    await refreshHistOnly(d, s);
    await save(env, h, d);
    return { ...view(d), bark };
  }
  if (path === "/vpn/del") { d.subs = d.subs.filter((x) => x.id !== b.id); await save(env, h, d); return { ...view(d), bark }; }
  if (path === "/vpn/check") {
    const t = cnDay();
    if (d.day.d !== t) d.day = { d: t, n: 0 };
    if (d.day.n >= 30) throw verr("오늘은 다시 조회를 30번 했어요. 내일 다시 해 주세요.");
    d.day.n++;
    await refresh(env, d); await save(env, h, d);
    return { ...view(d), bark };
  }
  if (path === "/vpn/cfg") {
    const c = d.cfg;
    if (b.minGB != null) c.minGB = Math.max(1, Math.min(5000, Math.round(+b.minGB) || DEF_CFG.minGB));
    if (b.days != null) c.days = Math.max(0, Math.min(30, Math.round(+b.days) || 0));
    if (b.hour != null) c.hour = Math.max(6, Math.min(23, Math.round(+b.hour) || DEF_CFG.hour));
    if (b.on != null) c.on = !!b.on;
    await save(env, h, d); return { ...view(d), bark };
  }
  if (path === "/vpn/test") {
    await refresh(env, d);
    const n = await send(env, h, alerts(d, groups(d), true));
    await save(env, h, d);
    return { ...view(d), bark, sent: n };
  }
  throw verr("not_found", 404);
}
async function refreshHistOnly(d, s) {
  if (!s.last || s.err) return;
  const k = gkey(s.last), hh = (d.hist[k] = d.hist[k] || {});
  hh[cnDay()] = s.last.up + s.last.down;
}

// 15분 크론의 정각 틱: 중국 cfg.hour 시에 조회 + 조건 맞으면 Bark. 사용량 기록용으로 알림 꺼져 있어도 조회는 함
export async function vpnCron(env, uh, um) {
  if (um >= 15) return;
  const h = await env.KV.get("usage:owner"); if (!h) return;
  const d = await load(env, h);
  if (!d.subs.length || (uh + 8) % 24 !== d.cfg.hour) return;
  if (d.ran === cnDay()) return;
  d.ran = cnDay();
  await refresh(env, d);
  if (d.cfg.on) { const list = alerts(d, groups(d), false); if (list.length) { try { await send(env, h, list); } catch (e) { console.log("vpn bark", e.message); } } }
  await save(env, h, d);
}

export const VPN_HTML = String.raw`<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#1664B0">
<meta name="apple-mobile-web-app-capable" content="yes">
<link rel="apple-touch-icon" href="/icon-180.png">
<title>VPN 용량</title>
<style>
@font-face{font-family:Pretendard;font-weight:400;font-display:swap;src:url(/fonts/pretendard-400.woff2) format("woff2")}
@font-face{font-family:Pretendard;font-weight:700;font-display:swap;src:url(/fonts/pretendard-700.woff2) format("woff2")}
:root{--sky:#1664B0;--bg:#EFE8DE;--card:#F7F2EA;--ink:#1A2330;--ink2:#5E6672;--line:#D9CEBD;--red:#D21624;--ok:#1F8A5B;--warn:#C77700}
@media (prefers-color-scheme:dark){:root{--bg:#141A22;--card:#1C2430;--ink:#EDE6DA;--ink2:#9AA3AE;--line:#2C3644}}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 Pretendard,-apple-system,"Apple SD Gothic Neo",system-ui,sans-serif}
header{background:var(--sky);color:#fff;padding:calc(env(safe-area-inset-top) + 14px) 16px 14px;border-bottom:3px solid var(--red);display:flex;align-items:center;gap:12px}
header h1{margin:0;font-size:19px;flex:1}a.back{color:#fff;text-decoration:none;font-size:22px}
header button{background:rgba(255,255,255,.18);color:#fff;border:0;border-radius:10px;padding:8px 12px;font:inherit;font-weight:700}
main{max-width:640px;margin:0 auto;padding:14px 16px 60px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px;margin-bottom:12px}
h2{font-size:13px;color:var(--ink2);margin:18px 0 8px;font-weight:700}
.big{font-size:34px;font-weight:700;letter-spacing:-.5px;line-height:1.1}.big small{font-size:15px;color:var(--ink2);font-weight:400}
.bar{height:10px;border-radius:6px;background:var(--line);overflow:hidden;margin:10px 0 6px}.bar i{display:block;height:100%;background:var(--sky)}
.bar i.w{background:var(--warn)}.bar i.r{background:var(--red)}
.row{display:flex;justify-content:space-between;gap:8px;color:var(--ink2);font-size:13px}
.tag{display:inline-block;font-size:12px;border-radius:8px;padding:2px 8px;margin:6px 6px 0 0;background:rgba(22,100,176,.12);color:var(--sky);font-weight:700}
.tag.r{background:rgba(210,22,36,.12);color:var(--red)}.tag.w{background:rgba(199,119,0,.14);color:var(--warn)}.tag.g{background:rgba(31,138,91,.13);color:var(--ok)}
.pace{margin-top:10px;font-size:14px}
.spark{display:flex;align-items:flex-end;gap:3px;height:44px;margin-top:10px}.spark i{flex:1;background:var(--sky);opacity:.55;border-radius:3px 3px 0 0;min-height:2px}
.dev{display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--line)}.dev:first-child{border-top:0}
.dev b{display:block}.dev small{color:var(--ink2);font-size:12.5px;word-break:break-all}.dev .e{color:var(--red)}
.dev button{margin-left:auto;background:none;border:1px solid var(--line);color:var(--ink2);border-radius:8px;padding:6px 10px;font:inherit;font-size:13px}
label{display:block;font-size:13px;color:var(--ink2);margin:10px 0 4px}
input,select{width:100%;font:inherit;padding:11px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink)}
.two{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.btn{display:block;width:100%;margin-top:12px;background:var(--sky);color:#fff;border:0;border-radius:12px;padding:13px;font:inherit;font-weight:700}
.btn.s{background:transparent;color:var(--sky);border:1px solid var(--sky)}
.note{font-size:12.5px;color:var(--ink2);margin-top:8px}
#toast{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom) + 20px);transform:translateX(-50%);background:var(--ink);color:var(--bg);padding:10px 16px;border-radius:12px;font-size:14px;display:none;max-width:90%;z-index:9}
.sw{display:flex;align-items:center;justify-content:space-between;margin-top:12px}.sw input{width:auto;transform:scale(1.3)}
</style></head><body>
<header><a class="back" href="/hub" aria-label="도구함">‹</a><h1>📶 VPN 용량</h1><button id="rf">새로고침</button></header>
<main id="m"><div class="card">불러오는 중…</div></main>
<div id="toast"></div>
<script>
var CODE='';try{CODE=localStorage.getItem('pb-code')||'';}catch(e){}
var S=null,$=function(i){return document.getElementById(i)};
function toast(t){var x=$('toast');x.textContent=t;x.style.display='block';clearTimeout(x._t);x._t=setTimeout(function(){x.style.display='none'},3500)}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function api(p,o){o=o||{};o.code=CODE;return fetch(p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(o)}).then(function(r){return r.json()}).then(function(j){if(j.error){throw new Error(j.detail||j.error)}return j})}
var GB=1073741824;function gb(b){return b>=100*GB?Math.round(b/GB)+'GB':(b/GB).toFixed(1)+'GB'}
function md(t){var x=new Date(t);return (x.getMonth()+1)+'월 '+x.getDate()+'일'}
function ago(t){if(!t)return'';var m=Math.round((Date.now()-t)/60000);return m<1?'방금':m<60?m+'분 전':m<1440?Math.round(m/60)+'시간 전':Math.round(m/1440)+'일 전'}
function askCode(){$('m').innerHTML='<div class="card"><b>초대 코드</b><p class="note">박비서와 같은 코드예요. 이 기기에 한 번만 넣으면 돼요.</p><input id="cd" autocomplete="off"><button class="btn" id="go">열기</button></div>';$('go').onclick=function(){CODE=$('cd').value.trim();try{localStorage.setItem('pb-code',CODE)}catch(e){}load()}}
function load(){if(!CODE)return askCode();api('/vpn/state').then(draw).catch(function(e){$('m').innerHTML='<div class="card">'+esc(e.message)+'</div>';if(/not_allowed/.test(e.message))askCode()})}
function groupCard(g){
  var names=S.subs.filter(function(s){return g.ids.indexOf(s.id)>=0});
  if(g.err)return '<div class="card"><b>'+esc(names.map(function(s){return s.name}).join('·'))+'</b><p class="note e" style="color:var(--red)">조회 실패: '+esc(g.err)+'</p></div>';
  var pct=g.total?Math.min(100,Math.round(g.used/g.total*100)):0,low=g.left<S.cfg.minGB*GB;
  var cls=low?'r':pct>80?'w':'';
  var h='<div class="card"><div class="row"><span>'+names.map(function(s){return esc((S.devs[s.dev]||'').split(' ')[0])+' '+esc(s.name)}).join(' · ')+'</span><span>'+ago(g.at)+'</span></div>';
  h+='<div class="big" style="margin-top:6px">'+gb(g.left)+' <small>남음 / 총 '+gb(g.total)+'</small></div>';
  h+='<div class="bar"><i class="'+cls+'" style="width:'+pct+'%"></i></div><div class="row"><span>사용 '+gb(g.used)+' ('+pct+'%)</span><span>'+(g.expire?md(g.expire)+' 만료':'만료일 없음')+'</span></div>';
  if(g.days!=null)h+='<span class="tag '+(g.days<=3?'r':g.days<=S.cfg.days?'w':'')+'">'+(g.days<0?'만료됨':'D-'+g.days)+'</span>';
  if(low)h+='<span class="tag r">기준('+S.cfg.minGB+'GB) 아래</span>';
  if(names.length>1)h+='<span class="tag">같은 계정 '+names.length+'곳</span>';
  if(g.rough)h+='<span class="tag w">대략값</span>';
  if(g.rate!=null){
    h+='<div class="pace">하루 평균 <b>'+gb(g.rate)+'</b> 사용 · ';
    if(g.runOut==null||g.rate<=0)h+='거의 안 씀';
    else if(g.shortBefore)h+='<b style="color:var(--red)">'+(g.runOut<1?'오늘 안에':g.runOut+'일 뒤')+' 바닥</b> — 만료보다 '+(g.days-g.runOut)+'일 먼저';
    else h+='이 속도면 만료까지 <b style="color:var(--ok)">충분</b> (약 '+g.runOut+'일 분량)';
    h+='</div>';
    if(g.daily&&g.daily.length>1){var mx=Math.max.apply(null,g.daily.map(function(x){return x.v}))||1;h+='<div class="spark">'+g.daily.map(function(x){return '<i title="'+x.d+' '+gb(x.v)+'" style="height:'+Math.max(4,Math.round(x.v/mx*100))+'%"></i>'}).join('')+'</div><div class="row"><span>최근 '+g.daily.length+'일 하루 사용량</span><span>최대 '+gb(mx)+'</span></div>'}
  }else h+='<p class="note">하루 사용량은 내일부터 계산돼요(매일 '+S.cfg.hour+'시에 기록).</p>';
  return h+'</div>';
}
function draw(j){
  S=j;var h='';
  if(!j.subs.length)h+='<div class="card"><b>구독 주소를 넣어 주세요</b><p class="note">공유기(OpenClash)·아이폰·아이패드에서 쓰는 구독 주소를 각각 넣으면 남은 용량·만료일을 모아 보여 주고, 부족해지면 아이폰으로 알려 드려요. 같은 계정이면 자동으로 한 묶음이 돼요.</p></div>';
  else{h+='<h2>계정별</h2>'+j.groups.map(groupCard).join('')}
  h+='<h2>구독 주소 '+j.subs.length+'개</h2><div class="card">';
  if(!j.subs.length)h+='<p class="note">아직 없어요.</p>';
  h+=j.subs.map(function(s){return '<div class="dev"><div><b>'+esc(j.devs[s.dev]||'')+' '+esc(s.name)+'</b><small>'+esc(s.host)+(s.err?'<br><span class="e">'+esc(s.err)+'</span>':' · '+ago(s.at))+'</small></div><button data-del="'+s.id+'">삭제</button></div>'}).join('');
  h+='</div><div class="card"><b>＋ 구독 추가</b><div class="two"><div><label>이름</label><input id="nm" placeholder="예: 침실 공유기"></div><div><label>어디서 쓰나</label><select id="dv">'+Object.keys(j.devs).map(function(k){return '<option value="'+k+'">'+j.devs[k]+'</option>'}).join('')+'</select></div></div><label>구독 주소</label><input id="ur" placeholder="https://… (Shadowrocket·Clash 구독 주소)" autocomplete="off" autocapitalize="off"><button class="btn" id="add">추가하고 바로 조회</button><p class="note">주소는 서버에만 저장되고 화면에는 가린 형태로만 보여요. Shadowrocket: 구독 길게 누르기 → 편집 → URL 복사.</p></div>';
  h+='<h2>알림</h2><div class="card">'+(j.bark?'':'<p class="note" style="color:var(--red)">Bark 주소가 없어요 — <a href="/brief">출장 브리핑</a> 화면에서 먼저 넣어 주세요(같은 알림 주소를 써요).</p>')+'<div class="sw"><span>알림 받기</span><input type="checkbox" id="on"'+(j.cfg.on?' checked':'')+'></div><div class="two"><div><label>남은 용량 기준(GB)</label><input id="mg" type="number" inputmode="numeric" value="'+j.cfg.minGB+'"></div><div><label>만료 며칠 전부터</label><input id="dy" type="number" inputmode="numeric" value="'+j.cfg.days+'"></div></div><label>매일 확인 시각(중국)</label><select id="hr">'+[7,8,9,10,12,18,20,21,22].map(function(x){return '<option'+(x==j.cfg.hour?' selected':'')+' value="'+x+'">'+x+'시</option>'}).join('')+'</select><button class="btn s" id="sv">설정 저장</button><button class="btn s" id="ts">지금 상태로 시험 알림</button><p class="note">기준 아래·만료 D-14/7/3/1·지금 속도면 만료 전에 바닥날 때만 보내요(같은 내용은 하루 한 번).</p></div>';
  $('m').innerHTML=h;
  $('add').onclick=function(){var u=$('ur').value.trim();if(!u)return toast('구독 주소를 붙여 넣어 주세요');this.disabled=true;this.textContent='조회 중…';api('/vpn/add',{name:$('nm').value,dev:$('dv').value,url:u}).then(function(r){draw(r);var s=r.subs[r.subs.length-1];toast(s&&s.err?'추가했지만 조회 실패: '+s.err:'추가했어요')}).catch(function(e){toast(e.message);load()})};
  [].forEach.call(document.querySelectorAll('[data-del]'),function(b){b.onclick=function(){if(!confirm('이 구독 주소를 지울까요?'))return;api('/vpn/del',{id:b.getAttribute('data-del')}).then(draw).catch(function(e){toast(e.message)})}});
  $('sv').onclick=function(){api('/vpn/cfg',{on:$('on').checked,minGB:$('mg').value,days:$('dy').value,hour:$('hr').value}).then(function(r){draw(r);toast('저장했어요')}).catch(function(e){toast(e.message)})};
  $('ts').onclick=function(){this.disabled=true;api('/vpn/test').then(function(r){draw(r);toast('알림 '+r.sent+'개 보냈어요')}).catch(function(e){toast(e.message);load()})};
}
$('rf').onclick=function(){var b=this;b.disabled=true;b.textContent='조회 중…';api('/vpn/check').then(function(r){draw(r);toast('최신으로 바꿨어요')}).catch(function(e){toast(e.message)}).then(function(){b.disabled=false;b.textContent='새로고침'})};
load();
</script></body></html>`;
