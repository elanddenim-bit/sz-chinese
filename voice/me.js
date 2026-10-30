// =========================================================
// 🪞 나 살피기 + ⚽ 내 팀 (2026-10-30 소유자 '최근 패턴 분석 → 생활에 도움 되는 API 프로그램' 중 1·4번)
//  GET  /me                         화면(박비서 초대 코드 pb-code, 주인 전용 — usage:owner)
//  POST /me/state   {code, fresh?}  → 이번 주·지난주 요약, 날짜별 줄, 도구 사용, 팀 경기, 설정
//  POST /me/health  {code, d?, steps?, sleep?, days?{날짜:{steps,sleep}}}  ← 아이폰 단축어 자동화(매일 밤)
//        sleep 단위 자동: ≤24 → 시간, ≤1000 → 분, 그 위 → 초
//  POST /me/cfg     {code, on?, wday?, hour?, team?, mh?, suwon?, t1?}
//  POST /me/test    {code, what:'week'|'team'}  → 지금 상태로 Bark 시험(기록 안 남김)
// 이번 주 숫자는 전부 코드가 계산(AI 없음):
//  · 수면·걸음 = 단축어가 보낸 건강 기록
//  · 작업 시각 = GitHub 커밋(조직 elanddenim-bit, 시크릿 GITHUB_TOKEN 있으면 비공개 저장소까지, 없으면 공개 저장소만) — 중국 시각 0~5시 = '자정 넘어'
//  · 도구 사용 = 사용량판 KV u:<날짜>:<앱> (주인 것만), 2주 동안 한 번도 안 연 도구 목록
//  · 중국어 분 = Supabase trainer stats.days (초대 코드가 필요해 단축어·화면이 열릴 때 받아 둠)
// 주간 알림 meCron: 중국 cfg.wday(기본 일요일) cfg.hour(기본 19)시 정각 틱 → 출장 브리핑 Bark(brief:<해시>.bark)
// 팀: 수원삼성 = TheSportsDB 무료 키(3 → 123), T1 = lolesports 일정 API(웹사이트가 쓰는 공개 키)
//  · 경기 날 아침 cfg.mh(기본 9)시 '오늘 경기' 1번, 끝나면 결과 1번(15분마다 확인, 경기 시작 뒤에만)
// 저장: KV me:<해시> {cfg, health{날짜:{st,sl,at}}, study{날짜:{min,n}}, gh{at,days,repos,priv,err}, teams{at,fb,lol}, sent{week,team{키:날짜}}}
// =========================================================
import { barkPush, leaveAt } from "./brief.js";
import { todoUpcoming } from "./todo.js";
import { APPS, OWNER_SCOPED, study as studyDays, logUse } from "./usage.js";

const TZ = 8 * 3600e3;
const cnDay = (t = Date.now()) => new Date(t + TZ).toISOString().slice(0, 10);
const cnHour = (t) => new Date(t + TZ).getUTCHours();
const merr = (message, status = 400) => Object.assign(new Error(message), { code: "me", status });
const KEY = (h) => "me:" + h;
const DEF = { on: true, wday: 0, hour: 19, team: true, mh: 9, suwon: true, t1: true, gst: 8000, gex: 30, gsl: 420, gstudy: 30 }; // 목표: 걸음·운동 분·수면 분·중국어 분(위젯)
const SKIP_IDLE = new Set(["daily", "me", "spain"]); // 공개·남이 쓰는 앱, 이 화면 자신은 '안 쓴 도구'에서 뺌
const WD = ["일", "월", "화", "수", "목", "금", "토"];

async function owner(env, h) {
  let o = await env.KV.get("usage:owner");
  if (!o) { await env.KV.put("usage:owner", h); o = h; }
  if (o !== h) throw merr("나 살피기는 주인만 쓸 수 있어요.", 403);
}
async function load(env, h) {
  const d = (await env.KV.get(KEY(h), "json")) || {};
  d.cfg = { ...DEF, ...(d.cfg || {}) };
  d.health = d.health || {}; d.study = d.study || {}; d.sent = d.sent || {}; d.sent.team = d.sent.team || {};
  d.teams = d.teams || {};
  return d;
}
function trim(obj, keep) {
  const ks = Object.keys(obj).sort(); for (const k of ks.slice(0, Math.max(0, ks.length - keep))) delete obj[k];
}
async function save(env, h, d) {
  trim(d.health, 120); trim(d.study, 60);
  if (d.gh && d.gh.days) trim(d.gh.days, 40);
  for (const [k, v] of Object.entries(d.sent.team)) if (v < cnDay(Date.now() - 30 * 864e5)) delete d.sent.team[k];
  await env.KV.put(KEY(h), JSON.stringify(d));
}
function dayList(to, n) { const t = Date.parse(to + "T00:00:00Z"); const out = []; for (let i = n - 1; i >= 0; i--) out.push(new Date(t - i * 864e5).toISOString().slice(0, 10)); return out; }

// ---------- 건강 기록 ----------
function sleepMin(v) {
  const x = Number(v); if (!isFinite(x) || x <= 0) return null;
  const m = x <= 24 ? x * 60 : x <= 1000 ? x : x / 60;
  return m > 0 && m < 1000 ? Math.round(m) : null;
}
function putHealth(d, day, v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const cur = d.health[day] || {};
  const sv = v.steps !== undefined ? v.steps : v.step;
  const st = Number(sv), sl = sleepMin(v.sleep), ex = Number(v.ex !== undefined ? v.ex : v.exercise);
  let ok = false;
  if (isFinite(st) && st >= 0 && st < 200000 && sv !== undefined && sv !== "") { cur.st = Math.round(st); ok = true; }
  if (isFinite(ex) && ex >= 0 && (v.ex !== undefined || v.exercise !== undefined)) { const m = ex > 1440 ? ex / 60 : ex; if (m < 1440) { cur.ex = Math.round(m); ok = true; } } // 운동 분(초로 오면 분으로)
  if (sl != null) { cur.sl = sl; ok = true; }
  if (ok) { cur.at = Date.now(); d.health[day] = cur; }
  return ok;
}

// ---------- GitHub 커밋 ----------
async function ghFetch(env, d, force) {
  const g = d.gh || {};
  if (!force && g.at && Date.now() - g.at < (g.err ? 10 * 60e3 : 3 * 3600e3)) return g; // 실패했으면 10분 뒤 다시
  const H = { "user-agent": "sz-voice-me", accept: "application/vnd.github+json" };
  if (env.GITHUB_TOKEN) H.authorization = "Bearer " + env.GITHUB_TOKEN;
  const org = env.GH_ORG || "elanddenim-bit";
  const since = Date.now() - 15 * 864e5;
  const out = { at: Date.now(), days: g.days || {}, repos: 0, priv: !!env.GITHUB_TOKEN, err: "" };
  try {
    // elanddenim-bit 은 조직이 아니라 개인 계정 → /orgs 는 404. 토큰이 있으면 /user/repos(비공개 포함), 없으면 /users/<이름>/repos(공개만)
    const urls = env.GITHUB_TOKEN
      ? ["https://api.github.com/user/repos?per_page=100&sort=pushed&affiliation=owner,organization_member", `https://api.github.com/users/${org}/repos?per_page=100&sort=pushed&type=owner`]
      : [`https://api.github.com/users/${org}/repos?per_page=100&sort=pushed&type=owner`, `https://api.github.com/orgs/${org}/repos?per_page=100&sort=pushed`];
    let list = null, st = 0;
    for (const u of urls) { const r = await fetch(u, { headers: H }); st = r.status; if (r.ok) { list = await r.json(); break; } }
    if (!list) throw new Error("저장소 목록 " + st + (st === 401 ? " (토큰이 틀렸거나 만료)" : st === 403 ? " (요청 한도)" : ""));
    const repos = list.filter((x) => Date.parse(x.pushed_at) > since).map((x) => x.full_name).slice(0, 18);
    out.repos = repos.length;
    const fresh = {};
    for (const name of repos) {
      const cr = await fetch(`https://api.github.com/repos/${name}/commits?per_page=100&since=${new Date(since).toISOString()}`, { headers: H });
      if (!cr.ok) continue;
      for (const c of await cr.json()) {
        const who = ((c.author && c.author.login) || (c.commit.author && c.commit.author.name) || "").toLowerCase();
        const msg = (c.commit && c.commit.message) || "";
        if (/bot|github-actions/.test(who) || /^rates:/.test(msg)) continue;
        const t = Date.parse((c.commit.committer && c.commit.committer.date) || (c.commit.author && c.commit.author.date));
        if (!t) continue;
        const day = cnDay(t), hr = cnHour(t);
        const x = fresh[day] || (fresh[day] = { n: 0, late: 0, add: 0, last: 0 });
        x.n++;
        if (hr < 5) x.late++;
        if (/추가/.test(msg.split("\n")[0])) x.add++;
        const lateness = hr < 5 ? hr + 24 : hr; // 새벽 2시 = 26시
        if (lateness > x.last) x.last = lateness;
      }
    }
    // 새로 받은 기간(15일)은 통째로 바꾸고, 그 전 기록은 남김
    const cut = cnDay(since);
    for (const k of Object.keys(out.days)) if (k >= cut) delete out.days[k];
    Object.assign(out.days, fresh);
  } catch (e) { out.err = String(e.message || e).slice(0, 120); }
  d.gh = out;
  return out;
}

// ---------- 도구 사용(사용량판 기록) ----------
async function useRows(env, h, from) {
  const months = []; for (let t = Date.parse(from + "T00:00:00Z"); ; t += 28 * 864e5) { const m = new Date(t).toISOString().slice(0, 7); if (!months.includes(m)) months.push(m); if (m >= cnDay().slice(0, 7)) break; }
  if (!months.includes(cnDay().slice(0, 7))) months.push(cnDay().slice(0, 7));
  const by = {}; // 날짜 → 앱 → {n,s}
  for (const m of months) {
    let cursor;
    for (let i = 0; i < 10; i++) {
      const r = await env.KV.list({ prefix: "u:" + m, cursor, limit: 1000 });
      for (const k of r.keys) {
        const [, day, app] = k.name.split(":");
        if (day < from || !k.metadata || !APPS[app]) continue;
        if (OWNER_SCOPED.has(app) && k.metadata.w !== h) continue;
        const n = Object.values(k.metadata.c || {}).reduce((a, b) => a + (Number(b) || 0), 0);
        const a = ((by[day] = by[day] || {})[app] = by[day][app] || { n: 0, s: 0 });
        a.n += n; a.s += k.metadata.s || 0;
      }
      if (r.list_complete) break;
      cursor = r.cursor;
    }
  }
  return by;
}

// ---------- 주간 요약 ----------
const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
function weekOf(d, use, days) {
  const sl = days.map((x) => d.health[x] && d.health[x].sl).filter((v) => v > 0);
  const st = days.map((x) => d.health[x] && d.health[x].st).filter((v) => v >= 0 && v != null);
  const ex = days.map((x) => d.health[x] && d.health[x].ex).filter((v) => v >= 0 && v != null);
  const gd = (d.gh && d.gh.days) || {};
  let commits = 0, lateDays = 0, adds = 0, latest = 0;
  for (const x of days) { const g = gd[x]; if (!g) continue; commits += g.n; adds += g.add; if (g.late) lateDays++; if (g.last > latest) latest = g.last; }
  const apps = {};
  for (const x of days) for (const [a, v] of Object.entries(use[x] || {})) { if (a === "me") continue; const o = (apps[a] = apps[a] || { n: 0, s: 0, days: 0 }); o.n += v.n; o.s += v.s; o.days++; }
  let smin = 0, sdays = 0;
  for (const x of days) { const v = d.study[x]; if (v && v.min > 0) { smin += v.min; sdays++; } }
  return {
    from: days[0], to: days[days.length - 1],
    sleep: { avg: sl.length ? Math.round(avg(sl)) : null, n: sl.length, under6: sl.filter((v) => v < 360).length },
    steps: { avg: st.length ? Math.round(avg(st)) : null, n: st.length },
    ex: { avg: ex.length ? Math.round(avg(ex)) : null, n: ex.length, sum: ex.reduce((a, b) => a + b, 0), d30: ex.filter((v) => v >= 30).length },
    gh: { commits, lateDays, adds, latest },
    apps: Object.entries(apps).map(([a, v]) => ({ a, ...v })).sort((x, y) => y.s - x.s || y.n - x.n),
    study: { min: Math.round(smin), days: sdays },
  };
}
function idleApps(use, days14) {
  const seen = new Set(); for (const x of days14) for (const a of Object.keys(use[x] || {})) seen.add(a);
  return Object.keys(APPS).filter((a) => !seen.has(a) && !SKIP_IDLE.has(a));
}
const hm = (m) => m == null ? "—" : Math.floor(m / 60) + "시간" + (m % 60 ? " " + (m % 60) + "분" : "");
const clock = (x) => { const h = x % 24; return (x >= 24 ? "새벽 " : "") + h + "시"; };
function notes(w, prev, idle) {
  const out = [];
  if (w.sleep.n >= 3 && w.sleep.avg < 390) out.push({ lv: w.sleep.avg < 360 ? "r" : "w", t: `수면 평균 ${hm(w.sleep.avg)}${w.sleep.under6 ? ` · 6시간 못 잔 날 ${w.sleep.under6}일` : ""}` });
  if (w.sleep.n >= 3 && prev.sleep.n >= 3 && w.sleep.avg - prev.sleep.avg <= -30) out.push({ lv: "w", t: `지난주보다 하루 ${prev.sleep.avg - w.sleep.avg}분 덜 잠` });
  if (w.gh.lateDays >= 2) out.push({ lv: w.gh.lateDays >= 4 ? "r" : "w", t: `자정 넘어 작업한 날 ${w.gh.lateDays}일 (가장 늦은 커밋 ${clock(w.gh.latest)})` });
  if (idle.length >= 5) out.push({ lv: w.gh.adds >= 5 ? "r" : "w", t: `2주 동안 한 번도 안 연 도구 ${idle.length}개${w.gh.adds ? ` — 이번 주 '추가' 커밋은 ${w.gh.adds}건` : ""}` });
  if (w.ex.n >= 3 && w.ex.d30 === 0) out.push({ lv: "w", t: `30분 넘게 운동한 날 없음 (하루 평균 ${w.ex.avg}분)` });
  if (w.steps.n >= 3 && w.steps.avg < 5000) out.push({ lv: "w", t: `걸음 평균 ${w.steps.avg.toLocaleString()}보` });
  if (!w.sleep.n && !w.steps.n) out.push({ lv: "g", t: "건강 기록이 아직 없어요 — 아래 '아이폰 단축어 연결'을 한 번 해 두면 매일 밤 자동으로 들어와요" });
  if (!out.length) out.push({ lv: "g", t: "특별히 걸리는 숫자가 없는 한 주예요" });
  return out;
}
async function summary(env, h, d, force) {
  const today = cnDay();
  const cur = dayList(today, 7), prev = dayList(cnDay(Date.now() - 7 * 864e5), 7), d14 = dayList(today, 14);
  const [use] = await Promise.all([useRows(env, h, prev[0]), ghFetch(env, d, force)]);
  const w = weekOf(d, use, cur), p = weekOf(d, use, prev), idle = idleApps(use, d14);
  const rows = dayList(today, 14).reverse().map((x) => ({ d: x, wd: WD[new Date(x + "T00:00:00Z").getUTCDay()], sl: d.health[x] && d.health[x].sl, st: d.health[x] && d.health[x].st, ex: d.health[x] && d.health[x].ex, gh: (d.gh.days || {})[x] || null, study: d.study[x] ? d.study[x].min : null, apps: Object.keys(use[x] || {}).length }));
  const ns = notes(w, p, idle);
  d.notes = { at: Date.now(), list: ns }; // 위젯이 쓰는 '이번 주 경고' 캐시
  return { week: w, prev: p, idle, notes: ns, rows };
}
function weekText(s) {
  const w = s.week, L = [];
  L.push(w.sleep.n ? `😴 수면 평균 ${hm(w.sleep.avg)}${w.sleep.under6 ? ` · 6시간 미만 ${w.sleep.under6}일` : ""}` : "😴 수면 기록 없음");
  if (w.steps.n) L.push(`🚶 걸음 평균 ${w.steps.avg.toLocaleString()}보`);
  if (w.ex.n) L.push(`🏃 운동 ${w.ex.sum}분 · 30분 넘긴 날 ${w.ex.d30}일`);
  L.push(`💻 커밋 ${w.gh.commits}건 · 자정 넘어 ${w.gh.lateDays}일`);
  L.push(`🧰 쓴 도구 ${w.apps.length}개 · 2주 안 연 도구 ${s.idle.length}개`);
  if (w.study.min) L.push(`🀄 중국어 ${w.study.min}분 (${w.study.days}일)`);
  return L.join("\n");
}

// ---------- 팀: 수원삼성(TheSportsDB) ----------
const KR = [["Suwon Samsung", "수원삼성"], ["Suwon FC", "수원FC"], ["Seoul E-Land", "서울이랜드"], ["Busan", "부산"], ["Jeonnam", "전남"], ["Bucheon", "부천"], ["Seongnam", "성남"], ["Ansan", "안산"], ["Gimpo", "김포"], ["Asan", "충남아산"], ["Cheonan", "천안"], ["Gyeongnam", "경남"], ["Hwaseong", "화성"], ["Paju", "파주"], ["Gimhae", "김해"], ["Yongin", "용인"], ["Cheongju", "충북청주"], ["Incheon", "인천"], ["Daegu", "대구"], ["Jeju", "제주"], ["Jeonbuk", "전북"], ["Ulsan", "울산"], ["Pohang", "포항"], ["Gangwon", "강원"], ["Daejeon", "대전"], ["Gwangju", "광주"], ["Gimcheon", "김천"], ["Anyang", "안양"], ["FC Seoul", "서울"]];
const kr = (n) => { const x = KR.find(([e]) => String(n || "").includes(e)); return x ? x[1] : String(n || ""); };
// TheSportsDB 호출 — 실패 이유(HTTP 상태·네트워크)를 돌려줘서 화면에 그대로 보임(2026-10-30 소유자 '수원 경기를 왜 못 불러오나')
async function tsdb(path) {
  const why = [];
  for (const k of ["123", "3"]) {
    try {
      const r = await fetch(`https://www.thesportsdb.com/api/v1/json/${k}/${path}`, { headers: { "user-agent": "Mozilla/5.0 sz-voice-me", accept: "application/json" }, cf: { cacheTtl: 0 } });
      if (!r.ok) { why.push(`HTTP ${r.status}`); continue; }
      const txt = await r.text();
      try { return { j: JSON.parse(txt), why: "" }; } catch { why.push("JSON 아님(" + txt.slice(0, 40).replace(/\s+/g, " ") + ")"); }
    } catch (e) { why.push(String(e.message || e).slice(0, 60)); }
  }
  return { j: null, why: [...new Set(why)].join("/") || "응답 없음" };
}
function fbEv(e) {
  const t = Date.parse(e.strTimestamp ? (e.strTimestamp.endsWith("Z") || /[+-]\d\d:?\d\d$/.test(e.strTimestamp) ? e.strTimestamp : e.strTimestamp + "Z") : (e.dateEvent + "T" + (e.strTime || "00:00:00").slice(0, 8) + "Z"));
  const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
  return { id: String(e.idEvent), t: t || 0, home: e.strHomeTeam, away: e.strAwayTeam, hid: String(e.idHomeTeam || ""), hs: num(e.intHomeScore), as: num(e.intAwayScore), st: e.strStatus || "", lg: e.strLeague || "", round: e.intRound || "" };
}
const FB_NAMES = ["Suwon Samsung Bluewings", "Suwon Samsung", "Suwon Bluewings", "Suwon"];
// 2026-10-30 실제 응답: 팀 검색은 되지만 eventsnext·eventslast·eventsseason 은 키 123 → 429, 키 3 → 403 (무료 키로 막힘)
// → ① v1(순차) ② v2 schedule(X-API-KEY 123) ③ ESPN 공개 site API(kor.1·kor.2) 순으로 시도, 어느 경로였는지 src 에 남김
async function tsdb2(path) {
  try {
    const r = await fetch("https://www.thesportsdb.com/api/v2/json/" + path, { headers: { "X-API-KEY": "123", "user-agent": "Mozilla/5.0 sz-voice-me", accept: "application/json" }, cf: { cacheTtl: 0 } });
    if (!r.ok) return { j: null, why: "HTTP " + r.status };
    const txt = await r.text(); try { return { j: JSON.parse(txt), why: "" }; } catch { return { j: null, why: "JSON 아님" }; }
  } catch (e) { return { j: null, why: String(e.message || e).slice(0, 60) }; }
}
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/soccer/";
async function espnFetch(path) {
  try {
    const r = await fetch(ESPN + path, { headers: { "user-agent": "Mozilla/5.0 sz-voice-me", accept: "application/json" }, cf: { cacheTtl: 0 } });
    if (!r.ok) return { j: null, why: "HTTP " + r.status };
    return { j: await r.json(), why: "" };
  } catch (e) { return { j: null, why: String(e.message || e).slice(0, 60) }; }
}
// ESPN 일정 → fbEv 와 같은 모양(id·t·home·away·hid·hs·as·st·lg)
function espnEv(e, lg) {
  const c = (e.competitions && e.competitions[0]) || {}, cs = c.competitors || [];
  const H = cs.find((x) => x.homeAway === "home") || cs[0] || {}, A = cs.find((x) => x.homeAway === "away") || cs[1] || {};
  const num = (v) => (v === null || v === undefined || v === "" ? null : Number(typeof v === "object" ? v.value ?? v.displayValue : v));
  const done = !!(c.status && c.status.type && c.status.type.completed);
  return { id: "e" + e.id, t: Date.parse(e.date) || 0, home: (H.team && (H.team.displayName || H.team.name)) || "", away: (A.team && (A.team.displayName || A.team.name)) || "", hid: "e" + ((H.team && H.team.id) || ""), hs: num(H.score), as: num(A.score), st: done ? "FT" : ((c.status && c.status.type && c.status.type.shortDetail) || ""), lg: lg || "", round: "" };
}
async function fbEspn(o) {
  const errs = [], evs = [];
  for (const lg of ["kor.1", "kor.2"]) {
    if (!o.eid || o.elg !== lg) {
      if (o.eid && o.elg) continue; // 이미 다른 리그에서 찾음
      const { j, why } = await espnFetch(lg + "/teams?limit=50");
      if (!j) { errs.push("espn " + lg + " 팀: " + why); continue; }
      const teams = (((j.sports || [])[0] || {}).leagues || [])[0]; const list = (teams && teams.teams) || [];
      const t = list.map((x) => x.team).find((x) => x && /suwon/i.test(x.displayName + " " + x.name + " " + (x.shortDisplayName || "")) && !/fc$/i.test(x.name || "") || (x && /bluewings|samsung/i.test(x.displayName || "")));
      if (!t) { errs.push("espn " + lg + ": 수원삼성 없음"); continue; }
      o.eid = String(t.id); o.elg = lg; o.name = o.name || t.displayName;
    }
    const { j: sj, why: w2 } = await espnFetch(o.elg + "/teams/" + o.eid + "/schedule");
    if (!sj) { errs.push("espn 일정: " + w2); break; }
    for (const e of sj.events || []) evs.push(espnEv(e, (sj.season && sj.season.displayName) || o.elg));
    break;
  }
  return { evs, errs };
}
async function fbFetch(prev) {
  const o = { id: prev && prev.id, lg: prev && prev.lg, name: prev && prev.name, eid: prev && prev.eid, elg: prev && prev.elg, ev: [], err: "", src: "" };
  const errs = [];
  try {
    const all = new Map();
    const add = (list, conv) => { for (const e of list || []) if (e && (e.idEvent || e.id)) { const v = conv ? conv(e) : fbEv(e); all.set(v.id, v); } };
    // ① TheSportsDB v1 (팀 검색은 무료 키로 됨)
    if (!o.id) {
      let last = "";
      for (const n of FB_NAMES) {
        const { j, why } = await tsdb("searchteams.php?t=" + encodeURIComponent(n));
        if (!j) { last = why; continue; }
        const t = ((j && j.teams) || []).find((x) => /suwon/i.test(x.strTeam || "") && (/samsung|bluewings/i.test((x.strTeam || "") + " " + (x.strTeamAlternate || "")) || /soccer|football/i.test(x.strSport || ""))) || null;
        if (t) { o.id = String(t.idTeam); o.lg = String(t.idLeague || ""); o.name = t.strTeam; break; }
        last = "검색 결과에 수원삼성 없음(" + (((j && j.teams) || []).map((x) => x.strTeam).slice(0, 3).join(", ") || "0건") + ")";
      }
      if (!o.id) errs.push("tsdb 팀 검색: " + last);
    }
    if (o.id) {
      const yr = new Date(Date.now() + TZ).getUTCFullYear();
      const calls = [["eventsnext", "eventsnext.php?id=" + o.id, "events"], ["eventslast", "eventslast.php?id=" + o.id, "results"]];
      if (o.lg) calls.push(["season " + yr, `eventsseason.php?id=${o.lg}&s=${yr}`, "events"]);
      for (const [nm, p, key] of calls) { // 순차 — 한꺼번에 보내면 429
        const { j, why } = await tsdb(p);
        if (!j) { errs.push("tsdb " + nm + ": " + why); continue; }
        add(nm.startsWith("season") ? (j[key] || []).filter((e) => String(e.idHomeTeam) === o.id || String(e.idAwayTeam) === o.id) : j[key]);
      }
      if (all.size) o.src = "tsdb v1";
      // ② v2
      if (!all.size) {
        for (const [nm, p] of [["v2 next", "schedule/next/" + o.id], ["v2 prev", "schedule/previous/" + o.id]]) {
          const { j, why } = await tsdb2(p);
          if (!j) { errs.push("tsdb " + nm + ": " + why); continue; }
          add(j.schedule || j.events || j.results);
        }
        if (all.size) o.src = "tsdb v2";
      }
    }
    // ③ ESPN
    if (!all.size) {
      const { evs, errs: e2 } = await fbEspn(o);
      errs.push(...e2);
      for (const v of evs) all.set(v.id, v);
      if (all.size) { o.src = "espn " + o.elg; if (!o.id) o.id = o.eid; o.hid = "e" + o.eid; }
    }
    const lo = Date.now() - 30 * 864e5, hi = Date.now() + 60 * 864e5;
    o.ev = [...all.values()].filter((e) => e.t > lo && e.t < hi).sort((a, b) => a.t - b.t);
    if (!o.ev.length) {
      if (!all.size) throw new Error("경기 조회 실패: " + errs.join(" · "));
      o.err = "가까운 경기 정보 없음(" + (o.name || "수원") + ", " + o.src + ")"; o.empty = true;
    } else if (errs.length) o.warn = o.src + " 로 받음 · 실패한 경로: " + errs.join(" · ");
  } catch (e) { o.err = String(e.message || e).slice(0, 300); if (prev && prev.ev) o.ev = prev.ev; }
  return o;
}
const fbDone = (e) => e.hs != null && e.as != null && (/FT|Finish|AET|PEN|AP/i.test(e.st) || Date.now() - e.t > 3 * 3600e3);
function fbLine(e, fb) {
  const home = e.hid === fb.id || (!!fb.hid && e.hid === fb.hid);
  const opp = kr(home ? e.away : e.home), where = home ? "홈" : "원정";
  if (!fbDone(e)) return `⚽ ${hhmm(e.t)} 수원 vs ${opp} (${where})`;
  const my = home ? e.hs : e.as, ot = home ? e.as : e.hs;
  return `⚽ 수원 ${my}-${ot} ${my > ot ? "승" : my < ot ? "패" : "무"} — vs ${opp} (${where})`;
}

// ---------- 팀: T1(lolesports) ----------
const LOL_KEY = "0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z"; // lolesports.com 웹페이지가 그대로 쓰는 공개 키(개인 계정 키 아님)
async function lolFetch(prev) {
  const o = { ev: [], err: "" };
  try {
    const r = await fetch("https://esports-api.lolesports.com/persisted/gw/getSchedule?hl=ko-KR", { headers: { "x-api-key": LOL_KEY, "user-agent": "sz-voice-me" } });
    if (!r.ok) throw new Error("일정 " + r.status);
    const j = await r.json();
    const evs = ((j.data && j.data.schedule && j.data.schedule.events) || []).filter((e) => e.type === "match" && e.match && (e.match.teams || []).some((t) => t.code === "T1"));
    o.ev = evs.map((e) => {
      const ts = e.match.teams, me = ts.find((t) => t.code === "T1"), op = ts.find((t) => t !== me) || {};
      return { id: String(e.match.id), t: Date.parse(e.startTime) || 0, lg: (e.league && e.league.name) || "", bl: e.blockName || "", st: e.state || "", bo: (e.match.strategy && e.match.strategy.count) || 1, op: op.code || op.name || "?", opn: op.name || "", w: me.result ? me.result.gameWins : null, ow: op.result ? op.result.gameWins : null, out: me.result ? me.result.outcome : null };
    }).sort((a, b) => a.t - b.t);
    if (!o.ev.length) { o.err = "가까운 T1 경기 없음(비시즌일 수 있음)"; o.empty = true; }
  } catch (e) { o.err = String(e.message || e).slice(0, 100); if (prev && prev.ev) o.ev = prev.ev; }
  return o;
}
const lolDone = (e) => e.st === "completed";
function lolLine(e) {
  const tag = [e.lg, e.bl].filter(Boolean).join(" ");
  if (!lolDone(e)) return `🎮 ${hhmm(e.t)} T1 vs ${e.op}${e.bo > 1 ? ` (${e.bo}판 ${Math.ceil(e.bo / 2)}선승)` : ""}${tag ? " · " + tag : ""}`;
  const win = e.out === "win" || (e.w != null && e.ow != null && e.w > e.ow);
  return `🎮 T1 ${e.w ?? "?"}:${e.ow ?? "?"} ${win ? "승" : "패"} — vs ${e.op}${tag ? " · " + tag : ""}`;
}
const hhmm = (t) => { const x = new Date(t + TZ); return (x.getUTCMonth() + 1) + "/" + x.getUTCDate() + " " + String(x.getUTCHours()).padStart(2, "0") + ":" + String(x.getUTCMinutes()).padStart(2, "0"); };

// 결과를 기다리는 경기: 시작했고(12시간 안) 아직 결과 알림을 안 보낸 것
function pending(d) {
  const now = Date.now(), out = [];
  const fb = d.teams.fb, lol = d.teams.lol;
  if (d.cfg.suwon && fb) for (const e of fb.ev || []) if (e.t < now && e.t > now - 12 * 3600e3 && !d.sent.team["fb:" + e.id]) out.push(e);
  if (d.cfg.t1 && lol) for (const e of lol.ev || []) if (e.t < now && e.t > now - 12 * 3600e3 && !d.sent.team["lol:" + e.id]) out.push(e);
  return out;
}
async function teamsFetch(d, force) {
  const tm = d.teams, now = Date.now();
  const stale = !tm.at || now - tm.at > 6 * 3600e3;
  const wait = pending(d).length > 0 && (!tm.at || now - tm.at > 14 * 60e3);
  if (!force && !stale && !wait) return false;
  const [fb, lol] = await Promise.all([d.cfg.suwon ? fbFetch(tm.fb) : Promise.resolve(tm.fb || null), d.cfg.t1 ? lolFetch(tm.lol) : Promise.resolve(tm.lol || null)]);
  d.teams = { at: now, fb, lol };
  return true;
}
function teamView(d) {
  const now = Date.now(), cut = now - 14 * 864e5;
  const fb = d.teams.fb || {}, lol = d.teams.lol || {};
  const pick = (ev, done) => { const past = (ev || []).filter((e) => done(e) && e.t > cut).slice(-3).reverse(); const next = (ev || []).filter((e) => !done(e) && e.t > now - 3 * 3600e3).slice(0, 3); return { past, next }; };
  const f = pick(fb.ev, fbDone), l = pick(lol.ev, lolDone);
  return {
    at: d.teams.at || 0,
    suwon: { on: d.cfg.suwon, err: fb.err || fb.warn || "", past: f.past.map((e) => ({ t: e.t, line: fbLine(e, fb) })), next: f.next.map((e) => ({ t: e.t, line: fbLine(e, fb) })) },
    t1: { on: d.cfg.t1, err: lol.err || "", past: l.past.map((e) => ({ t: e.t, line: lolLine(e) })), next: l.next.map((e) => ({ t: e.t, line: lolLine(e) })) },
  };
}

// ---------- 크론(*/15 틱) ----------
export async function meCron(env, uh, um) {
  const h = await env.KV.get("usage:owner"); if (!h) return;
  const d0 = await env.KV.get(KEY(h)); if (!d0) return; // 화면을 한 번도 안 열었으면 아무것도 안 함
  const d = await load(env, h);
  const bd = await env.KV.get("brief:" + h, "json"); const bark = bd && bd.bark;
  let dirty = false;
  const today = cnDay(), chH = (uh + 8) % 24, wday = new Date(Date.now() + TZ).getUTCDay();
  // 주간 알림
  if (bark && d.cfg.on && um < 15 && chH === d.cfg.hour && wday === d.cfg.wday && d.sent.week !== today) {
    d.sent.week = today; dirty = true;
    try {
      const s = await summary(env, h, d, true);
      await barkPush(bark, `🪞 이번 주 나 (${s.week.from.slice(5).replace("-", "/")}~${s.week.to.slice(5).replace("-", "/")})`, weekText(s), "https://voice.zhnote.net/me");
      await logUse(env, "me", { week: 1 }, 0);
    } catch (e) { console.log("meCron week", e && e.message); }
  }
  // 위젯용 '이번 주 경고'를 하루 한 번 새로(중국 6시)
  if (um < 15 && chH === 6 && d.notesDay !== today) {
    d.notesDay = today; dirty = true;
    try { await summary(env, h, d, false); } catch (e) { console.log("meCron notes", e && e.message); }
  }
  // 팀
  if (d.cfg.team && (d.cfg.suwon || d.cfg.t1)) {
    if (await teamsFetch(d, false)) dirty = true;
    const lines = [];
    // 결과
    if (d.cfg.suwon && d.teams.fb) for (const e of d.teams.fb.ev || []) {
      const k = "fb:" + e.id;
      if (d.sent.team[k] || !fbDone(e) || Date.now() - e.t > 24 * 3600e3) continue;
      d.sent.team[k] = today; dirty = true; lines.push(fbLine(e, d.teams.fb));
    }
    if (d.cfg.t1 && d.teams.lol) for (const e of d.teams.lol.ev || []) {
      const k = "lol:" + e.id;
      if (d.sent.team[k] || !lolDone(e) || Date.now() - e.t > 24 * 3600e3) continue;
      d.sent.team[k] = today; dirty = true; lines.push(lolLine(e));
    }
    if (bark && lines.length) { try { await barkPush(bark, "경기 결과", lines.join("\n"), "https://voice.zhnote.net/me#teams"); await logUse(env, "me", { team: 1 }, 0); } catch (e) { console.log("meCron result", e && e.message); } }
    // 오늘 경기(아침)
    if (bark && um < 15 && chH === d.cfg.mh && !d.sent.team["pre:" + today]) {
      d.sent.team["pre:" + today] = today; dirty = true;
      const tv = [];
      if (d.cfg.suwon && d.teams.fb) for (const e of d.teams.fb.ev || []) if (cnDay(e.t) === today && !fbDone(e)) tv.push(fbLine(e, d.teams.fb.id));
      if (d.cfg.t1 && d.teams.lol) for (const e of d.teams.lol.ev || []) if (cnDay(e.t) === today && !lolDone(e)) tv.push(lolLine(e));
      if (tv.length) { try { await barkPush(bark, "오늘 경기", tv.join("\n"), "https://voice.zhnote.net/me#teams"); } catch (e) { console.log("meCron pre", e && e.message); } }
    }
  }
  if (dirty) await save(env, h, d);
}

// ---------- API ----------

// ---------- 📱 위젯용: 실전 중국어 진도(Supabase trainer prog) · 단어 이름표(앱 index.html 에서 하루 한 번 뽑아 KV 캐시) ----------
const TR_URL = "https://qmxcfsozzrcdakkiozts.supabase.co", TR_KEY = "sb_publishable_fTwyVCtEqz7HhSBJ74X9HQ_OjaVZam8";
async function trainer(code) {
  try {
    const r = await fetch(TR_URL + "/rest/v1/trainer?id=eq." + encodeURIComponent(code) + "&select=prog:data->prog,days:data->stats->days,frm:data->frm->p,fix:data->fix->items,pron:data->pron->sents,call:data->call->score", { headers: { apikey: TR_KEY, authorization: "Bearer " + TR_KEY } });
    if (!r.ok) return null;
    const j = await r.json(); return (j && j[0]) || null;
  } catch { return null; }
}
// 단어 배열 이름 → 진도 id 접두어 (index.html 의 forEach 와 같게. 배열은 끝에만 추가되므로 순서 = 번호)
const WORD_ARR = { W4: "w4-", W4B: "w4b-", W4C: "w4c-", W5: "w5-", W5B: "w5b-", W5C: "w5c-", W7: "w7-" };
const HSK4 = ["W4", "W4B", "W4C"];
// 배열 리터럴의 닫는 ] 위치(문자열 안 괄호는 건너뜀)
function arrEnd(h, i) {
  let dep = 0, q = "";
  for (let k = i; k < h.length && k < i + 400000; k++) {
    const ch = h[k];
    if (q) { if (ch === "\\") k++; else if (ch === q) q = ""; continue; }
    if (ch === '"' || ch === "'" || ch === "`") q = ch;
    else if (ch === "[") dep++;
    else if (ch === "]" && --dep === 0) return k;
  }
  return -1;
}
async function wordMap(env) {
  const c = await env.KV.get("me:words", "json");
  if (c && c.at > Date.now() - 7 * 864e5 && c.m) return c.m;
  try {
    const r = await fetch((env.SZCN_URL || "https://elanddenim-bit.github.io/sz-chinese/") + "index.html", { cf: { cacheTtl: 0 } });
    if (!r.ok) throw new Error(r.status);
    const h = await r.text(), m = {};
    for (const n of Object.keys(WORD_ARR)) {
      const i = h.indexOf("const " + n + "=["); if (i < 0) continue;
      const j = arrEnd(h, h.indexOf("[", i)); if (j < 0) continue;
      const rows = [...h.slice(i, j + 1).matchAll(/\[\s*"((?:\\.|[^"\\])*)"\s*,\s*"((?:\\.|[^"\\])*)"\s*,\s*"((?:\\.|[^"\\])*)"\s*\]/g)];
      if (rows.length) m[n] = rows.map((x) => [x[1], x[3]]);
    }
    if (HSK4.every((n) => m[n])) { await env.KV.put("me:words", JSON.stringify({ at: Date.now(), m })); return m; }
  } catch {}
  return (c && c.m) || null;
}
function studyCard(tr, m, today) {
  const prog = (tr && tr.prog) || {}, days = (tr && tr.days) || {};
  const word = (id) => { for (const [n, pre] of Object.entries(WORD_ARR)) if (id.startsWith(pre)) { const i = Number(id.slice(pre.length)); return m && m[n] && m[n][i] ? { z: m[n][i][0], k: m[n][i][1], n } : null; } return null; };
  const isWord = (id) => Object.values(WORD_ARR).some((p) => id.startsWith(p));
  const h4 = (id) => /^w4[bc]?-/.test(id);
  let seen = 0, mast = 0, all = 0, mast5 = 0;
  for (const [id, p] of Object.entries(prog)) {
    if (!p || !isWord(id)) continue;
    const touched = (p.w || 0) + (p.c || 0) > 0 || p.mastered;
    if (touched) all++;
    if (h4(id)) { if (touched) seen++; if (p.mastered) mast++; }
    if (/^w5[bc]?-/.test(id) && p.mastered) mast5++;
  }
  const total = m ? HSK4.reduce((a, n) => a + m[n].length, 0) : 509;
  const lv = mast >= total * 0.8 ? 5 : 4;
  // 다시 볼 단어: 오답 중 많이 틀린 것 → 거의 익힌 것(연속 정답 1+)
  const ids = Object.keys(prog).filter((id) => isWord(id) && prog[id]);
  const wrong = ids.filter((id) => prog[id].inWrong).sort((a, b) => (prog[b].w || 0) - (prog[a].w || 0));
  const near = ids.filter((id) => !prog[id].inWrong && !prog[id].mastered && (prog[id].streak || 0) >= 1);
  const chips = [];
  for (const id of wrong.concat(near)) { const w = word(id); if (w && !chips.some((c) => c.z === w.z)) chips.push({ z: w.z, k: String(w.k).split(/[·(]/)[0].trim().slice(0, 8), wrong: !!prog[id].inWrong }); if (chips.length >= 6) break; }
  const t = days[today] || {};
  const total5 = m && m.W5 ? ["W5", "W5B", "W5C"].reduce((a, n) => a + ((m[n] && m[n].length) || 0), 0) : 1264;
  return { hsk: { lv, total, seen, mast }, hsk5: { total: total5, mast: mast5 }, words: all, todayN: t.n || 0, chips };
}

// 위젯 링에 무엇을 보일지(/me 화면에서 고름, cfg.ring)
export const RINGS = { time: "오늘 공부 시간", week: "이번 주 공부 시간", hsk4: "HSK 4 단어 익힘", hsk5: "HSK 5 단어 익힘", frame: "문장 틀 말하기", fix: "교정 문장 말하기", pron: "발음 통과", call: "통화 연습 점수" };
function ringOf(k, o) {
  const tr = o.tr || {}, pct = (a, b) => (b ? Math.min(1, a / b) : 0), boxed = (arr) => arr.filter((x) => x && (x.box || 0) >= 3).length;
  if (!RINGS[k]) k = "hsk4";
  if (k === "time") return { k, title: "오늘 공부", big: String(o.today), unit: "분", sub: "목표 " + o.goal + "분", pct: pct(o.today, o.goal) };
  if (k === "week") return { k, title: "이번 주", big: String(o.week), unit: "분", sub: "목표 " + o.goal * 7 + "분", pct: pct(o.week, o.goal * 7) };
  if (k === "hsk5") { const h = o.sc.hsk5; return { k, title: "HSK 5", big: String(Math.round(pct(h.mast, h.total) * 100)), unit: "%", sub: h.mast.toLocaleString() + " / " + h.total.toLocaleString(), pct: pct(h.mast, h.total) }; }
  if (k === "frame") { const n = boxed(Object.values(tr.frm || {})); return { k, title: "문장 틀", big: String(Math.round(pct(n, 60) * 100)), unit: "%", sub: "익힘 " + n + " / 60", pct: pct(n, 60) }; }
  if (k === "fix") { const a = Array.isArray(tr.fix) ? tr.fix : [], n = boxed(a); return { k, title: "교정 문장", big: String(Math.round(pct(n, a.length) * 100)), unit: "%", sub: "익힘 " + n + " / " + a.length, pct: pct(n, a.length) }; }
  if (k === "pron") { const v = Object.values(tr.pron || {}), n = v.filter((x) => x && (x.best || 0) >= 80).length; return { k, title: "발음", big: String(Math.round(pct(n, v.length) * 100)), unit: "%", sub: "통과 " + n + " / " + v.length + "문장", pct: pct(n, v.length) }; }
  if (k === "call") { const v = Object.values(tr.call || {}).map(Number).filter((x) => x >= 0); const avg = v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : 0; return { k, title: "통화 점수", big: String(avg), unit: "점", sub: "상황 " + v.length + "개 평균", pct: avg / 100 }; }
  const h = o.sc.hsk; return { k: "hsk4", title: "HSK 4", big: String(Math.round(pct(h.mast, h.total) * 100)), unit: "%", sub: h.mast.toLocaleString() + " / " + h.total.toLocaleString(), pct: pct(h.mast, h.total) };
}

export async function meApi(env, path, b, h) {
  await owner(env, h);
  const d = await load(env, h);
  const code = String(b.code || "").trim();
  if (path === "/me/health") {
    let n = 0;
    if (b.days && typeof b.days === "object") for (const [k, v] of Object.entries(b.days).slice(0, 31)) if (v && putHealth(d, k, v)) n++;
    if (b.steps !== undefined || b.step !== undefined || b.sleep !== undefined || b.ex !== undefined || b.exercise !== undefined) if (putHealth(d, /^\d{4}-\d{2}-\d{2}$/.test(b.d || "") ? b.d : cnDay(), b)) n++;
    const sd = await studyDays(code); if (sd) { for (const [k, v] of Object.entries(sd)) if (k >= cnDay(Date.now() - 40 * 864e5)) d.study[k] = { min: v.min, n: v.n }; }
    await save(env, h, d);
    await logUse(env, "me", { health: 1 }, 0);
    const t = d.health[cnDay()] || {};
    return { ok: true, saved: n, msg: n ? `받았어요 · 오늘 ${t.sl ? hm(t.sl) : "수면 없음"} · ${t.st != null ? t.st.toLocaleString() + "보" : "걸음 없음"} · ${t.ex != null ? "운동 " + t.ex + "분" : "운동 없음"}` : "숫자가 없어요(steps·sleep)" };
  }
  if (path === "/me/widget") {
    // 📱 아이폰 위젯(Scriptable): 중국어 공부(Supabase 실시간) · 다음 출장(출장 브리핑) · 다음 경기 · 이번 주 경고(캐시)
    const today = cnDay(), now = Date.now();
    // 팀 일정은 크론이 6시간마다 받음. 여기서는 한 번도 안 받았을 때만 받음(위젯 요청이 외부 호출로 길어지면 Scriptable 이 15초에 끊고 '저장본'을 보임 — 2026-10-30 실사용)
    if (d.cfg.team !== false && (d.cfg.suwon || d.cfg.t1) && !(d.teams && d.teams.at)) { try { if (await teamsFetch(d, false)) await save(env, h, d); } catch (e) {} }
    const sd = await studyDays(code);
    if (sd) for (const [k, v] of Object.entries(sd)) if (k >= cnDay(now - 40 * 864e5)) d.study[k] = { min: v.min, n: v.n };
    const mins = (k) => (d.study[k] && d.study[k].min) || 0;
    let streak = 0;
    for (let i = mins(today) > 0 ? 0 : 1; i < 60; i++) { if (mins(cnDay(now - i * 864e5)) > 0) streak++; else break; }
    let week = 0; for (let i = 0; i < 7; i++) week += mins(cnDay(now - i * 864e5));
    // 다음 출장 이동(현지 체류 제외)
    let trip = null;
    const bd = await env.KV.get("brief:" + h, "json");
    const hm0 = new Date(now + TZ).toISOString().slice(11, 16);
    const legs = ((bd && bd.trips) || []).filter((x) => x.d && x.how !== "stay" && (x.d > today || (x.d === today && (!x.t || x.t >= hm0)))).sort((a, b) => (a.d + (a.t || "")).localeCompare(b.d + (b.t || "")));
    if (legs[0]) {
      const x = legs[0], dd = Math.round((Date.parse(x.d + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 864e5);
      trip = { d: x.d, dday: dd, icon: { plane: "✈️", train: "🚄", car: "🚗" }[x.how] || "🧳", t: x.t || "", from: x.from || "", to: x.to || "", no: x.no || "", leave: leaveAt(x) || "" };
    }
    const fb = d.teams.fb, lol = d.teams.lol, games = [];
    if (d.cfg.suwon && fb) { const e = (fb.ev || []).find((x) => !fbDone(x) && x.t > now - 3 * 3600e3); if (e) games.push({ t: e.t, line: fbLine(e, fb) }); }
    if (d.cfg.t1 && lol) { const e = (lol.ev || []).find((x) => !lolDone(x) && x.t > now - 3 * 3600e3); if (e) games.push({ t: e.t, line: lolLine(e) }); }
    games.sort((a, b) => a.t - b.t);
    const ns = (d.notes && d.notes.list) || [];
    const note = ns.find((n) => n.lv === "r") || ns.find((n) => n.lv === "w") || ns[0] || null;
    // 큰 위젯: 단어 진도 · 다음 일정 여러 개(출장 + 업무 일정) · 팀 경기 3개
    const [tr, wm, todos] = await Promise.all([trainer(code), wordMap(env), todoUpcoming(env, 4).catch(() => [])]);
    const sc = studyCard(tr, wm, today);
    const ring = ringOf(d.cfg.ring, { tr, sc, today: mins(today), week: (() => { let s = 0; for (let i = 0; i < 7; i++) s += mins(cnDay(now - i * 864e5)); return s; })(), goal: d.cfg.gstudy || 30 });
    const plan = legs.slice(0, 3).map((x) => ({ d: x.d, t: x.t || "", icon: { plane: "✈️", train: "🚄", car: "🚗" }[x.how] || "🧳", title: (x.from ? x.from + " → " : "") + (x.to || ""), sub: [x.no, leaveAt(x) ? "나갈 시각 " + leaveAt(x) : ""].filter(Boolean).join(" · ") }))
      .concat(todos.map((x) => ({ d: x.d, t: x.t, icon: x.t ? "🕘" : "📅", title: x.title, sub: x.end ? "~" + x.end.slice(5).replace("-", "/") : "" })))
      .sort((a, b) => (a.d + (a.t || "00:00")).localeCompare(b.d + (b.t || "00:00"))).slice(0, 4);
    const gl = [];
    if (d.cfg.suwon && fb) for (const e of (fb.ev || []).filter((x) => !fbDone(x) && x.t > now - 3 * 3600e3).slice(0, 3)) { const home = e.hid === fb.id || e.hid === fb.hid; gl.push({ t: e.t, k: "fb", me: "수원", op: kr(home ? e.away : e.home), tag: home ? "홈" : "원정", home }); }
    if (d.cfg.t1 && lol) for (const e of (lol.ev || []).filter((x) => !lolDone(x) && x.t > now - 3 * 3600e3).slice(0, 3)) gl.push({ t: e.t, k: "lol", me: "T1", op: e.op, tag: e.lg || "LoL", bo: e.bo || 0 });
    gl.sort((a, b) => a.t - b.t);
    // 최근 결과(done:true) — 위젯이 예정 경기가 모자랄 때 줄을 채움(수원 2·T1 2, 최근 순)
    const gr = [];
    if (d.cfg.suwon && fb) for (const e of (fb.ev || []).filter(fbDone).sort((a, b) => b.t - a.t).slice(0, 2)) { const home = e.hid === fb.id || e.hid === fb.hid, my = home ? e.hs : e.as, ot = home ? e.as : e.hs; gr.push({ t: e.t, k: "fb", me: "수원", op: kr(home ? e.away : e.home), tag: home ? "홈" : "원정", home, done: true, res: my + "-" + ot + " " + (my > ot ? "승" : my < ot ? "패" : "무"), win: my > ot ? 1 : my < ot ? -1 : 0 }); }
    if (d.cfg.t1 && lol) for (const e of (lol.ev || []).filter(lolDone).sort((a, b) => b.t - a.t).slice(0, 2)) { const win = e.out === "win" || (e.w != null && e.ow != null && e.w > e.ow); gr.push({ t: e.t, k: "lol", me: "T1", op: e.op, tag: e.lg || "LoL", done: true, res: (e.w ?? "?") + ":" + (e.ow ?? "?") + " " + (win ? "승" : "패"), win: win ? 1 : -1 }); }
    gr.sort((a, b) => b.t - a.t);
    const gview = gl.slice(0, 3).concat(gr.slice(0, 3)).map((g) => { const x = new Date(g.t + TZ); return { ...g, d: x.toISOString().slice(0, 10), hm: x.toISOString().slice(11, 16) }; });
    const days7 = []; for (let i = 6; i >= 0; i--) { const k = cnDay(now - i * 864e5); days7.push({ d: k, min: mins(k) }); }
    return { ok: true, d: today, study: { today: mins(today), goal: d.cfg.gstudy || 30, streak, week, n: sc.todayN, days7 }, hsk: sc.hsk, ring, words: sc.words, chips: sc.chips, trip, plan, games: gview, gerr: [d.cfg.suwon && fb && fb.err ? "⚽ " + fb.err : "", d.cfg.t1 && lol && lol.err ? "🎮 " + lol.err : "", !d.cfg.suwon && !d.cfg.t1 ? "/me 화면에서 팀을 켜 주세요" : ""].filter(Boolean).join(" · "), ...(() => {
      // 경기 상태: ok 있음 / empty 일정 없음 / fail 받기 실패 / off 팀 꺼짐 — 확인 안 된 경기는 만들지 않음
      const on = [d.cfg.suwon && ["⚽", fb], d.cfg.t1 && ["🎮", lol]].filter(Boolean);
      if (!on.length) return { gstate: "off", gmsg: "" };
      if (gview.length) return { gstate: "ok", gmsg: "" };
      const bad = on.filter(([, t]) => !t || (t.err && !t.empty));
      if (bad.length === on.length) return { gstate: "fail", gmsg: bad.map(([i, t]) => i + " " + ((t && t.err) || "아직 한 번도 받지 못함")).join(" · ") };
      return { gstate: "empty", gmsg: on.map(([i, t]) => i + " " + (t && t.empty ? "다음 경기 일정 없음" : (t && t.err) || "")).join(" · ") };
    })(), ring2: ringOf("call", { tr, sc, today: mins(today), week: 0, goal: d.cfg.gstudy || 30 }), game: games[0] ? games[0].line : "", note };
  }
  if (path === "/me/cfg") {
    const c = d.cfg;
    if (b.gst !== undefined && Number(b.gst) >= 1000 && Number(b.gst) <= 50000) c.gst = Math.round(Number(b.gst));
    if (b.gex !== undefined && Number(b.gex) >= 5 && Number(b.gex) <= 300) c.gex = Math.round(Number(b.gex));
    if (b.gstudy !== undefined && Number(b.gstudy) >= 5 && Number(b.gstudy) <= 120) c.gstudy = Math.round(Number(b.gstudy));
    if (b.gsl !== undefined && Number(b.gsl) >= 240 && Number(b.gsl) <= 600) c.gsl = Math.round(Number(b.gsl));
    for (const k of ["on", "team", "suwon", "t1"]) if (typeof b[k] === "boolean") c[k] = b[k];
    if (b.ring !== undefined && RINGS[b.ring]) c.ring = b.ring;
    if (b.wday !== undefined && Number(b.wday) >= 0 && Number(b.wday) <= 6) c.wday = Number(b.wday);
    if (b.hour !== undefined && Number(b.hour) >= 6 && Number(b.hour) <= 23) c.hour = Number(b.hour);
    if (b.mh !== undefined && Number(b.mh) >= 6 && Number(b.mh) <= 12) c.mh = Number(b.mh);
    await save(env, h, d);
    return { ok: true, cfg: c };
  }
  if (path === "/me/test") {
    const bd = await env.KV.get("brief:" + h, "json");
    if (!bd || !bd.bark) throw merr("Bark 주소가 없어요 — 출장 브리핑 화면에서 먼저 넣어 주세요.");
    if (b.what === "team") {
      await teamsFetch(d, true); await save(env, h, d);
      const v = teamView(d), L = [];
      for (const t of [v.suwon, v.t1]) if (t.on) { if (t.past[0]) L.push(t.past[0].line); if (t.next[0]) L.push(t.next[0].line); if (!t.past[0] && !t.next[0]) L.push((t === v.suwon ? "⚽ " : "🎮 ") + (t.err || "경기 정보 없음")); }
      await barkPush(bd.bark, "경기 알림 시험", L.join("\n") || "켜 둔 팀이 없어요", "https://voice.zhnote.net/me#teams");
      return { ok: true, msg: "시험 알림을 보냈어요" };
    }
    const s = await summary(env, h, d, false); await save(env, h, d);
    await barkPush(bd.bark, "🪞 이번 주 나 (시험)", weekText(s), "https://voice.zhnote.net/me");
    return { ok: true, msg: "시험 알림을 보냈어요" };
  }
  if (path === "/me/state") {
    if (!d.studyAt || Date.now() - d.studyAt > 3 * 3600e3) { const sd = await studyDays(code); if (sd) { for (const [k, v] of Object.entries(sd)) if (k >= cnDay(Date.now() - 40 * 864e5)) d.study[k] = { min: v.min, n: v.n }; d.studyAt = Date.now(); } }
    if (d.cfg.team) await teamsFetch(d, !!b.fresh);
    const s = await summary(env, h, d, !!b.fresh);
    await save(env, h, d);
    const bd = await env.KV.get("brief:" + h, "json");
    const last = Object.entries(d.health).sort((a, b) => (b[1].at || 0) - (a[1].at || 0))[0];
    return { ok: true, ...s, apps: Object.fromEntries(Object.entries(APPS).map(([k, v]) => [k, { name: v.name, icon: v.icon }])), cfg: d.cfg, bark: !!(bd && bd.bark), gh: { at: d.gh.at, repos: d.gh.repos, priv: d.gh.priv, err: d.gh.err }, healthAt: last ? last[1].at : 0, teams: teamView(d), today: cnDay() };
  }
  throw merr("없는 요청이에요.", 404);
}

export const ME_HTML = String.raw`<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#1664B0">
<meta name="apple-mobile-web-app-capable" content="yes">
<link rel="apple-touch-icon" href="/icon-180.png">
<title>나 살피기</title>
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
.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px 12px}
.k{font-size:12.5px;color:var(--ink2)}.v{font-size:24px;font-weight:700;letter-spacing:-.3px;line-height:1.2;font-variant-numeric:tabular-nums}.v small{font-size:13px;color:var(--ink2);font-weight:400}
.d{font-size:12.5px;color:var(--ink2);font-variant-numeric:tabular-nums}.up{color:var(--ok)}.dn{color:var(--red)}
.note{display:flex;gap:8px;align-items:flex-start;padding:7px 0;border-top:1px solid var(--line);font-size:14px}.note:first-child{border-top:0}
.dot{flex:none;width:9px;height:9px;border-radius:50%;margin-top:7px;background:var(--ok)}.dot.w{background:var(--warn)}.dot.r{background:var(--red)}
table{width:100%;border-collapse:collapse;font-size:13.5px;font-variant-numeric:tabular-nums}th{font-weight:400;color:var(--ink2);text-align:left;font-size:12px;padding:0 4px 6px}td{padding:6px 4px;border-top:1px solid var(--line)}td.n{text-align:right}th.n{text-align:right}
.late{color:var(--red);font-weight:700}
.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{font-size:13px;border-radius:999px;padding:4px 10px;background:rgba(22,100,176,.12);color:var(--sky)}.chip.g{background:transparent;border:1px solid var(--line);color:var(--ink2)}
.tm b{display:block;margin-bottom:4px}.tm div{font-size:14px;padding:3px 0}.tm .e{color:var(--ink2);font-size:13px}.tm+.tm{margin-top:12px;padding-top:12px;border-top:1px solid var(--line)}
label{display:block;font-size:13px;color:var(--ink2);margin:10px 0 4px}
input,select{width:100%;font:inherit;padding:11px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink)}
.two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px}.two>*{min-width:0}input[type=date]{-webkit-appearance:none;appearance:none;min-width:0;max-width:100%;display:block;min-height:46px;text-align:left}input[type=date]::-webkit-date-and-time-value{text-align:left}
.btn{display:block;width:100%;margin-top:12px;background:var(--sky);color:#fff;border:0;border-radius:12px;padding:13px;font:inherit;font-weight:700}
.btn.s{background:transparent;color:var(--sky);border:1px solid var(--sky)}
.sw{display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-top:1px solid var(--line)}.sw:first-child{border-top:0}.sw input{width:auto;transform:scale(1.3)}
.hint{font-size:12.5px;color:var(--ink2);margin-top:8px}
details summary{cursor:pointer;color:var(--sky);font-weight:700;font-size:14px}
ol{padding-left:20px;margin:8px 0;font-size:14px}ol li{margin:4px 0}
code{font-size:12.5px;background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:1px 5px;word-break:break-all}
#toast{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom) + 20px);transform:translateX(-50%);background:var(--ink);color:var(--bg);padding:10px 16px;border-radius:12px;font-size:14px;display:none;max-width:90%;z-index:9}
</style></head><body>
<header><a class="back" href="/hub" aria-label="도구함">‹</a><h1>🪞 나 살피기</h1><button id="rf">새로고침</button></header>
<main id="m"><div class="card">불러오는 중…</div></main>
<div id="toast"></div>
<script>
var CODE='';try{CODE=localStorage.getItem('pb-code')||'';}catch(e){}
var S=null,$=function(i){return document.getElementById(i)};
function toast(t){var x=$('toast');x.textContent=t;x.style.display='block';clearTimeout(x._t);x._t=setTimeout(function(){x.style.display='none'},3500)}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function api(p,o){o=o||{};o.code=CODE;return fetch(p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(o)}).then(function(r){return r.json()}).then(function(j){if(j.error){throw new Error(j.detail||j.error)}return j})}
function hm(m){if(m==null)return '—';var h=Math.floor(m/60),r=m%60;return h+'시간'+(r?' '+r+'분':'')}
function num(n){return n==null?'—':Number(n).toLocaleString()}
function ago(t){if(!t)return '없음';var m=Math.round((Date.now()-t)/60000);return m<1?'방금':m<60?m+'분 전':m<1440?Math.round(m/60)+'시간 전':Math.round(m/1440)+'일 전'}
function clock(x){if(!x)return '';var h=x%24;return (x>=24?'새벽 ':'')+h+'시'}
function diff(a,b,unit,better){if(a==null||b==null)return '';var d=a-b;if(!d)return '<span class="d">지난주와 같음</span>';var good=better==='up'?d>0:d<0;return '<span class="d '+(good?'up':'dn')+'">지난주보다 '+(d>0?'+':'−')+Math.abs(d).toLocaleString()+unit+'</span>'}
function askCode(){$('m').innerHTML='<div class="card"><b>초대 코드</b><p class="hint">박비서와 같은 코드예요. 이 기기에 한 번만 넣으면 돼요.</p><input id="cd" autocomplete="off"><button class="btn" id="go">열기</button></div>';$('go').onclick=function(){CODE=$('cd').value.trim();try{localStorage.setItem('pb-code',CODE)}catch(e){}load()}}
function load(fresh){if(!CODE)return askCode();api('/me/state',{fresh:!!fresh}).then(draw).catch(function(e){$('m').innerHTML='<div class="card">'+esc(e.message)+'</div>';if(/not_allowed/.test(e.message))askCode()})}
function draw(j){
  S=j;var w=j.week,p=j.prev,h='',c0=j.cfg;
  h+='<h2>이번 주 · '+w.from.slice(5).replace('-','/')+' ~ '+w.to.slice(5).replace('-','/')+'</h2><div class="card">';
  h+=j.notes.map(function(n){return '<div class="note"><i class="dot '+n.lv+'"></i><span>'+esc(n.t)+'</span></div>'}).join('');
  h+='</div><div class="card"><div class="grid">';
  h+='<div><div class="k">😴 수면 평균 ('+w.sleep.n+'일 기록)</div><div class="v">'+hm(w.sleep.avg)+'</div>'+diff(w.sleep.avg,p.sleep.avg,'분','up')+'</div>';
  h+='<div><div class="k">🚶 걸음 평균</div><div class="v">'+num(w.steps.avg)+'<small> 보</small></div>'+diff(w.steps.avg,p.steps.avg,'보','up')+'</div>';
  h+='<div><div class="k">🏃 운동 ('+w.ex.n+'일 기록)</div><div class="v">'+(w.ex.n?w.ex.sum:'—')+'<small> 분 · 30분↑ '+(w.ex.d30||0)+'일</small></div>'+diff(w.ex.sum,p.ex.sum,'분','up')+'</div>';
  h+='<div><div class="k">💻 커밋 · 자정 넘어</div><div class="v">'+w.gh.commits+'<small> 건 · </small>'+w.gh.lateDays+'<small> 일</small></div>'+(w.gh.latest?'<span class="d">가장 늦게 '+clock(w.gh.latest)+'</span>':'')+'</div>';
  h+='<div><div class="k">🀄 중국어 공부</div><div class="v">'+w.study.min+'<small> 분 · '+w.study.days+'일</small></div>'+diff(w.study.min,p.study.min,'분','up')+'</div>';
  h+='</div></div>';
  // 날짜별
  h+='<h2>최근 14일</h2><div class="card" style="overflow-x:auto"><table><tr><th>날짜</th><th class="n">수면</th><th class="n">걸음</th><th class="n">운동</th><th class="n">커밋</th><th class="n">마지막</th><th class="n">중국어</th></tr>';
  h+=j.rows.map(function(r){var g=r.gh||{};return '<tr><td>'+r.d.slice(5).replace('-','/')+' '+r.wd+'</td><td class="n">'+(r.sl?hm(r.sl):'—')+'</td><td class="n">'+num(r.st)+'</td><td class="n">'+(r.ex!=null?r.ex+'분':'—')+'</td><td class="n">'+(g.n||'—')+'</td><td class="n'+(g.late?' late':'')+'">'+(g.last?clock(g.last):'')+'</td><td class="n">'+(r.study?r.study+'분':'—')+'</td></tr>'}).join('');
  h+='</table><p class="hint">커밋은 GitHub '+(j.gh.priv?'전체':'공개')+' 저장소 '+j.gh.repos+'곳 · '+ago(j.gh.at)+' 받음'+(j.gh.err?' · <b style="color:var(--red)">'+esc(j.gh.err)+'</b>':'')+(j.gh.priv?'':' (비공개 저장소까지 보려면 GITHUB_TOKEN 시크릿이 필요해요)')+'</p></div>';
  // 도구
  h+='<h2>도구</h2><div class="card"><div class="k" style="margin-bottom:6px">이번 주 쓴 도구 '+w.apps.length+'개</div><div class="chips">';
  h+=w.apps.length?w.apps.map(function(a){var ap=j.apps[a.a]||{name:a.a,icon:''};return '<span class="chip">'+esc(ap.icon+' '+ap.name)+(a.s>=60?' · '+Math.round(a.s/60)+'분':' · '+a.n+'번')+'</span>'}).join(''):'<span class="hint">기록 없음</span>';
  h+='</div><div class="k" style="margin:14px 0 6px">2주 동안 한 번도 안 연 도구 '+j.idle.length+'개</div><div class="chips">';
  h+=j.idle.map(function(a){var ap=j.apps[a]||{name:a,icon:''};return '<span class="chip g">'+esc(ap.icon+' '+ap.name)+'</span>'}).join('')||'<span class="hint">없음 — 다 쓰고 있어요</span>';
  h+='</div><p class="hint">사용량판(📊)에 기록되는 도구만 셉니다. 정리하거나 다시 써 볼 후보예요.</p></div>';
  // 팀
  var t=j.teams;h+='<h2 id="teams">내 팀</h2><div class="card">';
  [['⚽ 수원삼성',t.suwon],['🎮 T1',t.t1]].forEach(function(x){var v=x[1];h+='<div class="tm"><b>'+x[0]+(v.on?'':' <span class="hint">(꺼짐)</span>')+'</b>';
    if(v.on){h+=v.next.map(function(e){return '<div>'+esc(e.line)+'</div>'}).join('');h+=v.past.map(function(e){return '<div style="color:var(--ink2)">'+esc(e.line)+'</div>'}).join('');if(!v.next.length&&!v.past.length)h+='<div class="e">'+esc(v.err||'경기 정보 없음')+'</div>';else if(v.err)h+='<div class="e">'+esc(v.err)+'</div>'}
    h+='</div>'});
  h+='<p class="hint">시각은 중국 시각 · '+ago(t.at)+' 받음 · 경기 날 아침 '+j.cfg.mh+'시에 오늘 경기, 끝나면 결과를 아이폰으로 보내요.</p><button class="btn sm" id="tmFresh">🔄 경기 일정 지금 다시 받기</button></div>';
  // 건강 기록
  h+='<h2>건강 기록</h2><div class="card"><div class="k">마지막으로 받은 때: '+ago(j.healthAt)+'</div>';
  h+='<label for="hd">날짜</label><input id="hd" type="date" value="'+j.today+'"><div class="two"><div><label for="hs">잔 시간(시간)</label><input id="hs" inputmode="decimal" placeholder="예: 6.5"></div><div><label for="hp">걸음</label><input id="hp" inputmode="numeric" placeholder="예: 7200"></div></div><button class="btn s" id="hsave">직접 넣기</button>';
  h+='<details style="margin-top:14px"><summary>아이폰 단축어 연결 (매일 밤 자동)</summary><ol>';
  h+='<li>단축어 앱 → 자동화 → <b>특정 시간</b> 매일 22:30 → <b>즉시 실행</b></li>';
  h+='<li><b>건강 샘플 찾기</b>: 걸음, 시작일 <b>오늘</b> → <b>통계 계산</b> 합계 → 변수 이름 <code>걸음</code></li>';
  h+='<li><b>건강 샘플 찾기</b>: 수면 분석, 시작일 <b>지난 1일</b>, 값 <b>수면 중</b>(코어·깊은·REM 모두) → <b>건강 샘플 세부사항 가져오기</b> 지속 시간 → <b>통계 계산</b> 합계 → 변수 <code>수면</code></li>';
  h+='<li><b>URL 콘텐츠 가져오기</b>: <code>https://voice.zhnote.net/me/health</code> · 방법 POST · 본문 JSON — <code>code</code>(초대 코드), <code>steps</code>=걸음, <code>sleep</code>=수면, <code>ex</code>=운동하기 시간 합계(분)</li>';
  h+='</ol><p class="hint">수면 단위는 시간·분·초 어떤 것이든 서버가 알아서 맞춰요. 한 번 실행해 보고 위 \'마지막으로 받은 때\'가 바뀌면 연결된 거예요.</p></details></div>';
  // 위젯
  h+='<h2>📱 아이폰 위젯</h2><div class="card"><p style="margin:0 0 6px">오늘 중국어 공부(링·연속 일수) · 다음 출장과 나갈 시각 · 다음 경기 · 이번 주 경고 한 줄.</p><ol>';
  h+='<li>아래 버튼으로 스크립트를 복사</li><li><b>Scriptable</b> 앱 → 오른쪽 위 <b>+</b> → 붙여넣기 → 이름 <code>나 살피기</code> (이미 있으면 내용을 통째로 바꿔 붙여넣기)</li><li>그 스크립트를 한 번 실행 → 초대 코드 입력 → 미리보기 확인 (메뉴의 <b>🖼 배경 사진 고르기</b>로 앨범 사진을 배경에 — 글씨가 보이게 어둡게 덮어요)</li><li>홈 화면 길게 누르기 → 편집 → 위젯 추가 → Scriptable(작게 또는 중간) → 위젯을 눌러 Script 를 <b>나 살피기</b>로</li></ol>';
  h+='<label for="g_cn">중국어 하루 목표</label><select id="g_cn">'+[15,20,30,45,60].map(function(x){return '<option value="'+x+'"'+(x===(c0.gstudy||30)?' selected':'')+'>'+x+'분</option>'}).join('')+'</select>';
  h+='<label for="w_ring">위젯 링에 보일 것</label><select id="w_ring">'+Object.keys(RG).map(function(k){return '<option value="'+k+'"'+(k===(c0.ring||'hsk4')?' selected':'')+'>'+RG[k]+'</option>'}).join('')+'</select>';
  h+='<button class="btn" id="wcopy">위젯 스크립트 복사</button><p class="hint">스크립트에는 초대 코드가 들어 있지 않아요(폰 안에만 저장). 경고 한 줄은 이 화면을 열 때와 매일 아침 6시에 새로 계산해요.</p></div>';
  // 설정
  var c=j.cfg;h+='<h2>알림 설정</h2><div class="card">';
  if(!j.bark)h+='<p class="hint" style="color:var(--red)">Bark 주소가 없어요 — 출장 브리핑 화면에서 먼저 넣어 주세요.</p>';
  h+='<div class="sw"><span>주간 \'이번 주 나\' 알림</span><input type="checkbox" id="c_on"'+(c.on?' checked':'')+'></div>';
  h+='<div class="two"><div><label for="c_wd">요일</label><select id="c_wd">'+['일','월','화','수','목','금','토'].map(function(x,i){return '<option value="'+i+'"'+(i===c.wday?' selected':'')+'>'+x+'요일</option>'}).join('')+'</select></div><div><label for="c_h">시각(중국)</label><select id="c_h">'+[17,18,19,20,21,22].map(function(x){return '<option'+(x===c.hour?' selected':'')+'>'+x+'</option>'}).join('')+'</select></div></div>';
  h+='<div class="sw" style="margin-top:10px"><span>경기 알림</span><input type="checkbox" id="c_team"'+(c.team?' checked':'')+'></div>';
  h+='<div class="sw"><span>⚽ 수원삼성</span><input type="checkbox" id="c_su"'+(c.suwon?' checked':'')+'></div><div class="sw"><span>🎮 T1</span><input type="checkbox" id="c_t1"'+(c.t1?' checked':'')+'></div>';
  h+='<label for="c_mh">오늘 경기 알림 시각(중국)</label><select id="c_mh">'+[7,8,9,10,11,12].map(function(x){return '<option'+(x===c.mh?' selected':'')+'>'+x+'</option>'}).join('')+'</select>';
  h+='<div class="two"><button class="btn s" id="t_w">주간 알림 시험</button><button class="btn s" id="t_t">경기 알림 시험</button></div></div>';
  $('m').innerHTML=h;
  $('hsave').onclick=function(){var o={d:$('hd').value};if($('hs').value.trim())o.sleep=Number($('hs').value);if($('hp').value.trim())o.steps=Number($('hp').value);api('/me/health',o).then(function(r){toast(r.msg);load()}).catch(function(e){toast(e.message)})};
  function cfg(o){api('/me/cfg',o).then(function(){toast('저장했어요')}).catch(function(e){toast(e.message)})}
  $('c_on').onchange=function(){cfg({on:this.checked})};$('c_team').onchange=function(){cfg({team:this.checked})};
  $('c_su').onchange=function(){cfg({suwon:this.checked})};$('c_t1').onchange=function(){cfg({t1:this.checked})};
  $('c_wd').onchange=function(){cfg({wday:Number(this.value)})};$('c_h').onchange=function(){cfg({hour:Number(this.value)})};$('c_mh').onchange=function(){cfg({mh:Number(this.value)})};
  $('g_cn').onchange=function(){cfg({gstudy:Number(this.value)})};
  $('w_ring').onchange=function(){cfg({ring:this.value})};
  $('tmFresh').onclick=function(){this.disabled=true;this.textContent='받는 중…';load(true)};
  $('wcopy').onclick=function(){var t=WJS;if(!t){toast('스크립트를 받는 중이에요 — 잠시 뒤 다시');return}
    var done=function(){toast('복사했어요 — Scriptable 에 붙여넣기')};
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(done).catch(function(){fallback(t)})}else fallback(t)};
  $('t_w').onclick=function(){api('/me/test',{what:'week'}).then(function(r){toast(r.msg)}).catch(function(e){toast(e.message)})};
  $('t_t').onclick=function(){api('/me/test',{what:'team'}).then(function(r){toast(r.msg);load()}).catch(function(e){toast(e.message)})};
  if(location.hash==='#teams'){var el=$('teams');if(el)el.scrollIntoView()}
}
var RG=${JSON.stringify(RINGS)};
var WJS='';fetch('/me/widget.js').then(function(r){return r.text()}).then(function(t){WJS=t}).catch(function(){});
function fallback(t){var ta=document.createElement('textarea');ta.value=t;ta.style.position='fixed';ta.style.top='0';document.body.appendChild(ta);ta.focus();ta.select();try{document.execCommand('copy');toast('복사했어요 — Scriptable 에 붙여넣기')}catch(e){toast('복사 실패 — 길게 눌러 전체 선택 후 복사')}setTimeout(function(){ta.remove()},800)}
$('rf').onclick=function(){load(true)};
try{navigator.sendBeacon('/u',JSON.stringify({app:'me',c:{open:1}}))}catch(e){}
load();
</script></body></html>`;


// ---------- 📱 아이폰 위젯(Scriptable) 스크립트 — GET /me/widget.js, 화면의 '위젯 스크립트 복사' 버튼이 이걸 복사 ----------
// 2026-10-30 소유자: 운동은 피트니스 위젯이 있으니 빼고 → 중국어 공부 · 다음 일정 · 이번 주 경고 한 줄.
// 초대 코드는 스크립트에 안 넣고 Scriptable Keychain('pb-code')에 — 앱에서 처음 실행할 때 한 번 물음.
export const WIDGET_JS = String.raw`// 나 살피기 위젯 — voice.zhnote.net/me (Scriptable)
// 앱 안에서 한 번 실행하면 초대 코드를 묻고, 위젯 미리보기를 보여 줍니다.
const API = "https://voice.zhnote.net/me/widget";
const FM = FileManager.local();
const CACHE = FM.joinPath(FM.documentsDirectory(), "me-widget2.json");
const BG = FM.joinPath(FM.documentsDirectory(), "me-widget-bg.jpg"); // 앨범에서 고른 배경(이 폰에만)
const DIM = 0.5; // 배경 사진 위에 덮는 검정 농도(글씨 잘 보이게)
const C = { bg: new Color("#1C1C1E"), ring: new Color("#FF375F"), ringBg: new Color("#3A0A16"), ok: new Color("#A6FF00"), sub: new Color("#8E8E93"), txt: Color.white(), warn: new Color("#FFB340"), red: new Color("#FF5A5F"), sky: new Color("#5AC8FA") };

async function code(ask) {
  if (!ask && Keychain.contains("pb-code")) return Keychain.get("pb-code");
  if (!config.runsInApp) return null;
  const a = new Alert(); a.title = "초대 코드"; a.message = "박비서와 같은 코드예요. 이 폰에만 저장돼요.";
  a.addSecureTextField("초대 코드", ""); a.addAction("저장"); a.addCancelAction("취소");
  if ((await a.presentAlert()) === -1) return null;
  const c = a.textFieldValue(0).trim(); if (c) Keychain.set("pb-code", c); return c || null;
}
async function load(c) {
  const fm = FM;
  try {
    const r = new Request(API); r.method = "POST"; r.headers = { "content-type": "application/json" };
    r.body = JSON.stringify({ code: c }); r.timeoutInterval = 15;
    const j = await r.loadJSON();
    if (j && j.ok) { fm.writeString(CACHE, JSON.stringify(j)); return j; }
    if (j && j.error) return { err: j.detail || j.error };
  } catch (e) {}
  if (fm.fileExists(CACHE)) { const j = JSON.parse(fm.readString(CACHE)); j.stale = true; return j; }
  return { err: "연결 안 됨" };
}
function arc(ctx, cx, cy, r, w, frac, color) {
  const n = Math.max(2, Math.ceil(180 * frac));
  ctx.setFillColor(color);
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + 2 * Math.PI * frac * (i / n);
    ctx.fillEllipse(new Rect(cx + r * Math.cos(a) - w / 2, cy + r * Math.sin(a) - w / 2, w, w));
  }
}
function ring(frac, label, size) {
  const S = 200, ctx = new DrawContext(); ctx.size = new Size(S, S); ctx.opaque = false; ctx.respectScreenScale = true;
  const r = 78, w = 34;
  arc(ctx, S / 2, S / 2, r, w, 1, C.ringBg);
  if (frac > 0) arc(ctx, S / 2, S / 2, r, w, Math.min(frac, 1), C.ring);
  ctx.setTextAlignedCenter(); ctx.setFont(Font.boldRoundedSystemFont(size || 64)); ctx.setTextColor(!label && frac >= 1 ? C.ok : C.txt);
  const t = label || (frac >= 1 ? "✓" : "中"), fh = (size || 64) * 1.25;
  ctx.drawTextInRect(t, new Rect(0, S / 2 - fh / 2, S, fh));
  return ctx.getImage();
}
// 가로 막대: 진하게 = 익힘, 옅게 = 학습
function bar(f1, f2, W) {
  const H = 10, ctx = new DrawContext(); ctx.size = new Size(W, H); ctx.opaque = false; ctx.respectScreenScale = true;
  const rr = (x, w, col) => { if (w <= 0) return; const p = new Path(); p.addRoundedRect(new Rect(x, 0, Math.max(w, H), H), H / 2, H / 2); ctx.addPath(p); ctx.setFillColor(col); ctx.fillPath(); };
  rr(0, W, new Color("#FFFFFF", 0.14)); rr(0, W * Math.min(f2, 1), new Color("#FF375F", 0.4)); rr(0, W * Math.min(f1, 1), C.ring);
  return ctx.getImage();
}
const md = (d) => { const p = d.split("-"); return Number(p[1]) + "/" + Number(p[2]); };
function tripLines(t) {
  if (!t) return ["다음 출장 없음", ""];
  const when = t.dday === 0 ? "오늘" : t.dday === 1 ? "내일" : md(t.d) + " (D-" + t.dday + ")";
  const a = t.icon + " " + when + (t.t ? " " + t.t : "") + " → " + t.to;
  const b = [t.no, t.leave ? "나갈 시각 " + t.leave : ""].filter(Boolean).join(" · ");
  return [a, b];
}
let HASBG = false;
function txt(st, s, size, color, lines, weight) {
  const t = st.addText(s); t.font = weight === "b" ? Font.boldRoundedSystemFont(size) : Font.semiboldRoundedSystemFont(size);
  t.textColor = color || C.txt; t.lineLimit = lines || 1; t.minimumScaleFactor = 0.6;
  if (HASBG) { t.shadowColor = new Color("#000000", 0.8); t.shadowRadius = 3; t.shadowOffset = new Point(0, 1); }
  return t;
}
// 배경: 위젯 비율로 가운데를 잘라 채우고 검정을 덮음
function bgImage(fam) {
  if (!FM.fileExists(BG)) return null;
  const src = Image.fromFile(BG); if (!src) return null;
  const W = fam === "small" ? 340 : 720, H = fam === "large" || fam === "extraLarge" ? 760 : 340;
  const ctx = new DrawContext(); ctx.size = new Size(W, H); ctx.opaque = true; ctx.respectScreenScale = false;
  const k = Math.max(W / src.size.width, H / src.size.height), w = src.size.width * k, h = src.size.height * k;
  ctx.drawImageInRect(src, new Rect((W - w) / 2, (H - h) / 2, w, h));
  ctx.setFillColor(new Color("#000000", DIM)); ctx.fillRect(new Rect(0, 0, W, H));
  return ctx.getImage();
}
async function pickBg() {
  try {
    // 앨범 또는 파일 앱(iCloud Drive·다운로드)에서 — 둘 다 1200px 로 줄여 이 폰에만 저장
    const q = new Alert(); q.title = "배경 사진"; q.addAction("앨범에서"); q.addAction("파일에서"); q.addCancelAction("취소");
    const r = await q.presentSheet(); if (r < 0) return false;
    let img;
    if (r === 1) { const f = await DocumentPicker.openFile(); img = Image.fromFile(f); if (!img) throw new Error("이미지 파일이 아니에요"); }
    else img = await Photos.fromLibrary();
    // 너무 크면 줄여서 저장(위젯 메모리 한도)
    const k = Math.min(1, 1200 / Math.max(img.size.width, img.size.height));
    const ctx = new DrawContext(); ctx.size = new Size(Math.round(img.size.width * k), Math.round(img.size.height * k)); ctx.opaque = true; ctx.respectScreenScale = false;
    ctx.drawImageInRect(img, new Rect(0, 0, ctx.size.width, ctx.size.height));
    FM.writeImage(BG, ctx.getImage());
    return true;
  } catch (e) { return false; }
}
// ---------- 큰 화면용 카드(어두운 반투명 카드, 배경 사진 위) ----------
function card(parent) {
  const c = parent.addStack(); c.layoutVertically(); c.setPadding(10, 12, 10, 12); c.cornerRadius = 16;
  c.backgroundColor = HASBG ? new Color("#1C1C1E", 0.72) : new Color("#2C2C2E"); return c;
}
function head(c, title, right) {
  const r = c.addStack(); r.centerAlignContent(); txt(r, title, 13, C.txt, 1, "b"); r.addSpacer();
  if (right) txt(r, right, 11, C.sub); c.addSpacer(6);
}
const n0 = (x) => Number(x || 0).toLocaleString();
function dayLabel(j, d) {
  if (d === j.d) return "오늘";
  const dd = Math.round((Date.parse(d + "T00:00:00Z") - Date.parse(j.d + "T00:00:00Z")) / 864e5);
  return dd === 1 ? "내일" : md(d);
}
function studySec(w, j, big) {
  const s = j.study || {}, hk = j.hsk || { lv: 4, total: 509, seen: 0, mast: 0 };
  const c = card(w); head(c, "중국어 학습 진척", "HSK " + hk.lv);
  const pct = hk.total ? hk.mast / hk.total : 0;
  const top = c.addStack(); top.centerAlignContent();
  const im = top.addImage(ring(pct, Math.round(pct * 100) + "%", 52)); im.imageSize = new Size(big ? 64 : 50, big ? 64 : 50);
  top.addSpacer(10);
  const R = top.addStack(); R.layoutVertically();
  txt(R, "HSK " + hk.lv + " 단어 " + n0(hk.total) + "개 중", 12, C.sub);
  const l2 = R.addStack(); l2.centerAlignContent(); txt(l2, n0(hk.mast) + "개 익힘", 16, C.txt, 1, "b"); txt(l2, "  · 학습 " + n0(hk.seen), 11, C.sub);
  R.addSpacer(5);
  const b = R.addImage(bar(pct, hk.total ? hk.seen / hk.total : 0, 220)); b.imageSize = new Size(big ? 220 : 200, 8);
  c.addSpacer(big ? 10 : 7);
  const tiles = c.addStack(); tiles.layoutHorizontally();
  const tile = (lab, val, col) => { const t = tiles.addStack(); t.layoutVertically(); t.setPadding(6, 7, 6, 7); t.cornerRadius = 10; t.backgroundColor = new Color("#FFFFFF", 0.07); t.size = new Size(68, 0); txt(t, lab, 10, C.sub); txt(t, val, 15, col || C.txt, 1, "b"); };
  tile("오늘 학습", (s.today || 0) + "/" + (s.goal || 30) + "분", (s.today || 0) >= (s.goal || 30) ? C.ok : C.ring); tiles.addSpacer(5);
  tile("오늘 문제", (s.n || 0) + "개"); tiles.addSpacer(5);
  tile("누적 단어", n0(j.words)); tiles.addSpacer(5);
  tile("연속", s.streak ? "🔥" + s.streak + "일" : "0일", C.warn);
  const ch = (j.chips || []).slice(0, big ? 6 : 2);
  if (ch.length) {
    c.addSpacer(big ? 10 : 7);
    txt(c, ch.some((x) => x.wrong) ? "다시 볼 단어" : "거의 익힌 단어", 10, C.sub); c.addSpacer(4);
    const rows = big ? [ch.slice(0, 2), ch.slice(2, 4), ch.slice(4, 6)] : [ch];
    for (const row of rows) {
      if (!row.length) continue;
      const r = c.addStack(); r.layoutHorizontally();
      row.forEach((x, i) => {
        const p = r.addStack(); p.centerAlignContent(); p.setPadding(5, 8, 5, 8); p.cornerRadius = 9; p.size = new Size(big ? 142 : 136, 0);
        p.backgroundColor = x.wrong ? new Color("#FF375F", 0.18) : new Color("#5AC8FA", 0.15);
        txt(p, x.z, 15, C.txt, 1, "b"); p.addSpacer(6); txt(p, x.k, 11, C.sub); p.addSpacer();
        if (i < row.length - 1) r.addSpacer(6);
      });
      c.addSpacer(5);
    }
  }
  if (big && s.days7 && s.days7.length) {
    c.addSpacer(6);
    const hr = c.addStack(); txt(hr, "이번 주 공부", 10, C.sub); hr.addSpacer(); txt(hr, "주 " + (s.week || 0) + "분", 10, C.sub);
    c.addSpacer(4);
    const im2 = c.addImage(weekBars(s.days7, s.goal || 30, j.d)); im2.imageSize = new Size(286, 62);
  }
  if (big) c.addSpacer(); // 카드가 위젯 아래까지 차도록
  return c;
}
// 7일 막대: 목표 채운 날 초록, 오늘 분홍, 점선 = 목표
function weekBars(days, goal, today) {
  const W = 572, H = 124, ctx = new DrawContext(); ctx.size = new Size(W, H); ctx.opaque = false; ctx.respectScreenScale = false;
  const top = 18, base = H - 26, bw = 44, gap = (W - bw * 7) / 6;
  const mx = Math.max(goal * 1.2, ...days.map((x) => x.min || 0), 1);
  const DOW = ["일", "월", "화", "수", "목", "금", "토"];
  const gy = base - (base - top) * goal / mx;
  ctx.setFillColor(new Color("#FFFFFF", 0.25));
  for (let x = 0; x < W; x += 14) ctx.fillRect(new Rect(x, gy - 1, 7, 2));
  days.forEach((x, i) => {
    const X = i * (bw + gap), h = Math.max(4, (base - top) * (x.min || 0) / mx);
    const p = new Path(); p.addRoundedRect(new Rect(X, base - h, bw, h), 8, 8); ctx.addPath(p);
    ctx.setFillColor(x.min >= goal ? C.ok : x.d === today ? C.ring : new Color("#FFFFFF", x.min ? 0.45 : 0.12)); ctx.fillPath();
    ctx.setTextAlignedCenter(); ctx.setFont(Font.semiboldRoundedSystemFont(20));
    ctx.setTextColor(x.d === today ? C.txt : C.sub);
    ctx.drawTextInRect(DOW[new Date(x.d + "T00:00:00Z").getUTCDay()], new Rect(X - 6, base + 2, bw + 12, 24));
    if (x.min) { ctx.setFont(Font.boldRoundedSystemFont(18)); ctx.setTextColor(C.txt); ctx.drawTextInRect(String(x.min), new Rect(X - 10, Math.max(0, base - h - 22), bw + 20, 22)); }
  });
  return ctx.getImage();
}
function planSec(w, j, n) {
  const c = card(w); head(c, "다음 일정");
  const L = (j.plan || []).slice(0, n);
  if (!L.length) { txt(c, "다가오는 일정 없음", 12, C.sub); return c; }
  L.forEach((x, i) => {
    const r = c.addStack(); r.centerAlignContent();
    const t = r.addStack(); t.layoutVertically(); t.size = new Size(46, 0);
    txt(t, dayLabel(j, x.d), 11, x.d === j.d ? C.ring : C.sub, 1, "b"); txt(t, x.t || "종일", 12, C.txt, 1, "b");
    r.addSpacer(8);
    const m = r.addStack(); m.layoutVertically();
    txt(m, x.icon + " " + x.title, 13, C.txt, 1, "b"); if (x.sub) txt(m, x.sub, 10, C.sky);
    r.addSpacer();
    if (i < L.length - 1) c.addSpacer(6);
  });
  return c;
}
function teamSec(w, j, n) {
  const c = card(w); head(c, "좋아하는 팀 일정");
  const L = (j.games || []).slice(0, n);
  if (!L.length) { txt(c, "예정된 경기 없음", 12, C.sub); return c; }
  L.forEach((g, i) => {
    const r = c.addStack(); r.centerAlignContent();
    txt(r, dayLabel(j, g.d) + " " + g.hm, 11, C.sub); r.addSpacer(6);
    txt(r, (g.k === "fb" ? "⚽ " : "🎮 ") + g.me + " vs " + g.op, 13, C.txt, 1, "b"); r.addSpacer();
    const p = r.addStack(); p.setPadding(2, 6, 2, 6); p.cornerRadius = 7;
    p.backgroundColor = g.k === "fb" ? (g.home ? new Color("#1664B0", 0.85) : new Color("#8E8E93", 0.45)) : new Color("#D21624", 0.75);
    txt(p, g.tag, 10, C.txt, 1, "b");
    if (i < L.length - 1) c.addSpacer(5);
  });
  return c;
}
// ---------- 🎨 그려서 만드는 위젯(큰 위젯·중간 team) — 남색 유리 카드 시안 ----------
const K = 3; // 그림 배율(픽셀/포인트)
const CREST = FM.joinPath(FM.documentsDirectory(), "me-widget-crest.png"); // 응원 팀 엠블럼(이 폰에만, 앱 메뉴에서 고름)
let CRIMG; function crest() { if (CRIMG === undefined) { CRIMG = null; try { if (FM.fileExists(CREST)) CRIMG = Image.fromFile(CREST); } catch (e) {} } return CRIMG; }
function imgIn(c, im, x, y, w, h) { const k = Math.min(w / im.size.width, h / im.size.height), iw = im.size.width * k, ih = im.size.height * k; c.drawImageInRect(im, R(x + (w - iw) / 2, y + (h - ih) / 2, iw, ih)); }
const P = {
  bg1: new Color("#050E24"), bg2: new Color("#0B2152"), card: new Color("#0D2148", 0.62), line: new Color("#4C7BE0", 0.42),
  inner: new Color("#0A1A3C", 0.75), innerLine: new Color("#3D66C2", 0.30), txt: Color.white(), sub: new Color("#A9BCE0"), dim: new Color("#6F84AE"),
  blue: new Color("#2F7BFF"), blue2: new Color("#1450D8"), green: new Color("#22D37A"), green2: new Color("#8AF27A"), pink: new Color("#FF4D7A")
};
function wsize(fam) {
  const sw = Device.screenSize().width;
  const t = sw >= 428 ? [364, 170, 382] : sw >= 390 ? [338, 158, 354] : sw >= 375 ? [321, 148, 324] : [292, 141, 311];
  return fam === "medium" ? new Size(t[0], t[1]) : new Size(t[0], t[2]);
}
function mix(a, b, f) { return new Color("#" + [a.red, a.green, a.blue].map((v, i) => Math.round((v + ([b.red, b.green, b.blue][i] - v) * f) * 255).toString(16).padStart(2, "0")).join(""), a.alpha + (b.alpha - a.alpha) * f); }
function D(sz) { const c = new DrawContext(); c.size = new Size(sz.width * K, sz.height * K); c.opaque = true; c.respectScreenScale = false; return c; }
function R(x, y, w, h) { return new Rect(x * K, y * K, w * K, h * K); }
function rr(c, x, y, w, h, r, fill, stroke, lw) {
  const p = new Path(); p.addRoundedRect(R(x, y, w, h), r * K, r * K);
  if (fill) { c.addPath(p); c.setFillColor(fill); c.fillPath(); }
  if (stroke) { c.addPath(p); c.setStrokeColor(stroke); c.setLineWidth((lw || 1) * K); c.strokePath(); }
}
// 세로 그라데이션 둥근 사각(얇은 띠를 겹쳐 그림)
function grad(c, x, y, w, h, r, a, b) {
  const n = Math.max(8, Math.round(h * 1.5));
  for (let i = 0; i < n; i++) {
    const yy = y + h * i / n, hh = h / n + 0.4, inset = Math.max(0, r - Math.min(yy - y, y + h - yy - hh));
    const ins = inset > 0 ? r - Math.sqrt(Math.max(0, r * r - (r - Math.min(yy - y + hh / 2, y + h - yy - hh / 2)) ** 2)) : 0;
    c.setFillColor(mix(a, b, i / n)); c.fillRect(R(x + ins, yy, w - ins * 2, hh));
  }
}
function glow(c, x, y, r, col, a) { const n = 24; for (let i = n; i >= 1; i--) { c.setFillColor(new Color(col, a / n * 0.9)); const rr2 = r * Math.pow(i / n, 0.8); c.fillEllipse(R(x - rr2, y - rr2, rr2 * 2, rr2 * 2)); } }
// 글자: 넘치면 먼저 82%까지 줄이고, 그래도 넘치면 말줄임(한글은 SF 기준 약 0.93em)
function tw(t, size, wt) { let n = 0; for (const ch of String(t)) n += /[ᄀ-ᇿ㄰-㆏가-힯]/.test(ch) ? 0.93 : /[　-鿿＀-￯]/.test(ch) ? 1.0 : /[️‍]/.test(ch) ? 0 : /[\uD800-\uDFFF]/.test(ch) ? 0.6 : /[ -⯿]/.test(ch) ? 1.0 : /[A-Z0-9%]/.test(ch) ? 0.62 : /[ .,:·/()\-~]/.test(ch) ? 0.3 : 0.53; return n * size * (wt === "h" ? 1.06 : wt === "b" ? 1.03 : 1); }
function fit(t, w, size, wt) { if ([...t].length <= 2 || tw(t, size, wt) <= w) return t; let s = ""; for (const ch of t) { if (tw(s + ch + "…", size, wt) > w) break; s += ch; } return s.replace(/\s+$/, "") + "…"; }
function T(c, t, x, y, w, size, color, weight, align, h) {
  t = String(t == null ? "" : t); let sz = size; const need = tw(t, sz, weight);
  if (need > w) sz = Math.max(size * 0.82, size * w / need);
  c.setFont(weight === "b" ? Font.boldSystemFont(sz * K) : weight === "h" ? Font.heavySystemFont(sz * K) : weight === "m" ? Font.semiboldSystemFont(sz * K) : Font.systemFont(sz * K));
  c.setTextColor(color || P.txt);
  if (align === "c") c.setTextAlignedCenter(); else if (align === "r") c.setTextAlignedRight(); else c.setTextAlignedLeft();
  c.drawTextInRect(fit(t, w, sz, weight), R(x, y + (size - sz) * 0.55, w, h || size * 1.4));
}
function arcG(c, cx, cy, r, lw, f0, f1, a, b, alpha) {
  const n = Math.max(2, Math.ceil(240 * (f1 - f0)));
  for (let i = 0; i <= n; i++) {
    const f = f0 + (f1 - f0) * i / n, ang = -Math.PI / 2 + 2 * Math.PI * f, col = mix(a, b, (f - f0) / Math.max(0.001, f1 - f0));
    c.setFillColor(alpha != null ? new Color("#" + col.hex, alpha) : col);
    c.fillEllipse(R(cx + r * Math.cos(ang) - lw / 2, cy + r * Math.sin(ang) - lw / 2, lw, lw));
  }
}
// ---------- 정적 그림(배경·카드 유리·네온 테두리·제목) — 한 번 그려 폰에 캐시 ----------
const BASE_V = "v2b";
function backdrop(c, sz) {
  const W = sz.width, H = sz.height;
  grad(c, 0, 0, W, H, 0, new Color("#0A1C47"), new Color("#030A1C"));
  glow(c, W * 0.12, H * 0.06, W * 0.55, "#1E5BFF", 0.40);
  glow(c, W * 0.95, H * 0.55, W * 0.45, "#0B3BC0", 0.28);
  glow(c, W * 0.3, H * 1.0, W * 0.5, "#0A2E8A", 0.30);
  if (FM.fileExists(BG)) {
    const src = Image.fromFile(BG);
    if (src) {
      const PW = W * K, PH = H * K, k = Math.max(PW / src.size.width, PH / src.size.height);
      c.drawImageInRect(src, new Rect((PW - src.size.width * k) / 2, (PH - src.size.height * k) / 2, src.size.width * k, src.size.height * k));
      // 사진은 살리고 카드 글자 쪽만 조금 어둡게: 전체 30% + 아래로 갈수록 진해지는 남색
      c.setFillColor(new Color("#030A1E", 0.30)); c.fillRect(new Rect(0, 0, PW, PH));
      for (let i = 0; i < 24; i++) { c.setFillColor(new Color("#030A1E", 0.018 * i)); c.fillRect(new Rect(0, PH * i / 24, PW, PH / 24 + 1)); }
    }
  }
}
// 유리 카드: 그림자 → 바깥 네온 번짐 → 남색 유리 그라데이션 → 위쪽 광택 → 안쪽 하이라이트 선 → 테두리
function glass(c, x, y, w, h, r) {
  r = r || 18;
  for (let i = 6; i >= 1; i--) rr(c, x - i * 0.3, y + i * 0.9, w + i * 0.6, h + i * 0.6, r + i, new Color("#000000", 0.05));
  for (let i = 5; i >= 1; i--) rr(c, x - i, y - i, w + i * 2, h + i * 2, r + i, null, new Color("#3E86FF", 0.035 * (6 - i)), 1.4);
  grad(c, x, y, w, h, r, new Color("#16336F", 0.78), new Color("#0A1736", 0.82));
  grad(c, x + 1, y + 1, w - 2, Math.min(46, h * 0.38), r - 1, new Color("#FFFFFF", 0.07), new Color("#FFFFFF", 0.0));
  rr(c, x + 0.8, y + 0.8, w - 1.6, h - 1.6, r - 0.8, null, new Color("#FFFFFF", 0.07), 0.6);
  rr(c, x, y, w, h, r, null, new Color("#5C95FF", 0.55), 1.1);
  c.setFillColor(new Color("#9CC2FF", 0.35)); c.fillRect(R(x + r, y + 0.4, w - r * 2, 0.6)); // 윗변 빛
}
function iconBox(c, x, y, s, emoji) {
  glow(c, x + s / 2, y + s / 2, s * 0.95, "#2F7BFF", 0.35);
  grad(c, x, y, s, s, s * 0.28, new Color("#4A97FF"), new Color("#1442C2"));
  grad(c, x + 1, y + 1, s - 2, s * 0.45, s * 0.26, new Color("#FFFFFF", 0.28), new Color("#FFFFFF", 0.0));
  rr(c, x, y, s, s, s * 0.28, null, new Color("#BFD8FF", 0.45), 0.6);
  T(c, emoji, x, y + s * 0.2, s, s * 0.5, P.txt, "", "c", s * 0.7);
}
function dHead(c, x, y, w, emoji, title) { iconBox(c, x, y, 24, emoji); T(c, title, x + 32, y + 3, w - 32, 14.5, P.txt, "b"); }
function inner(c, x, y, w, h, r, tint) {
  grad(c, x, y, w, h, r, new Color(tint || "#0E2554", 0.85), new Color("#08142F", 0.85));
  rr(c, x, y, w, h, r, null, new Color("#4D7FE0", 0.32), 0.7);
}
// 화면 배치(카드 칸) — 정적 그림과 데이터 그림이 같은 칸을 씀
function layout(fam, P0, W, H) {
  const m = 5, A = H - m * 4, L = [];
  if (fam === "medium") return [{ k: "team", x: m, y: m, w: W - m * 2, h: H - m * 2, n: 3 }];
  if (P0 === "study") { const h1 = Math.round((H - m * 3) * 0.66); return [{ k: "study", x: m, y: m, w: W - m * 2, h: h1, big: true }, { k: "plan", x: m, y: m * 2 + h1, w: W - m * 2, h: H - m * 3 - h1, n: 2 }]; }
  if (P0 === "plan") { const h1 = Math.round((H - m * 3) * 0.52); return [{ k: "plan", x: m, y: m, w: W - m * 2, h: h1, n: 3 }, { k: "team", x: m, y: m * 2 + h1, w: W - m * 2, h: H - m * 3 - h1, n: 3 }]; }
  const h1 = Math.round(A * 0.455), h2 = Math.round(A * 0.24);
  return [{ k: "study", x: m, y: m, w: W - m * 2, h: h1 }, { k: "plan", x: m, y: m * 2 + h1, w: W - m * 2, h: h2, n: 1 }, { k: "team", x: m, y: m * 3 + h1 + h2, w: W - m * 2, h: A - h1 - h2, n: 3 }];
}
const HEADS = { study: ["📖", "중국어 학습"], plan: ["📅", "다음 일정"], team: ["⚽", ""] };
function baseImage(fam, P0, sz) {
  let stamp = "nobg"; try { if (FM.fileExists(BG)) stamp = String(FM.modificationDate(BG).getTime()); } catch (e) {}
  const key = [BASE_V, fam, P0 || "all", sz.width, sz.height, stamp].join("_").replace(/[^\w.-]/g, "");
  const f = FM.joinPath(FM.documentsDirectory(), "me-base-" + key + ".png");
  try { if (FM.fileExists(f)) { const im = Image.fromFile(f); if (im) return im; } } catch (e) {}
  const c = D(sz); backdrop(c, sz);
  for (const b of layout(fam, P0, sz.width, sz.height)) {
    glass(c, b.x, b.y, b.w, b.h);
    if (b.k !== "team") dHead(c, b.x + 12, b.y + 10, b.w - 120, HEADS[b.k][0], HEADS[b.k][1]);
    else { const lw = Math.min(78, b.w * 0.23); grad(c, b.x + 1, b.y + 1, lw, b.h - 2, 17, new Color("#1B4FC4", 0.75), new Color("#071636", 0.6)); glow(c, b.x + 1 + lw / 2, b.y + b.h / 2, lw * 0.75, "#3D8BFF", 0.45); }
  }
  const im = c.getImage();
  try { for (const n of FM.listContents(FM.documentsDirectory())) if (/^me-base-/.test(n)) FM.remove(FM.joinPath(FM.documentsDirectory(), n)); FM.writeImage(f, im); } catch (e) {}
  return im;
}
// ---------- 데이터 그림 ----------
const KDOW = ["일", "월", "화", "수", "목", "금", "토"];
const dow = (d) => KDOW[new Date(d + "T00:00:00Z").getUTCDay()];
const kday = (d) => { const p = d.split("-"); return Number(p[1]) + "월 " + Number(p[2]) + "일 (" + dow(d) + ")"; };
const sday = (d) => { const p = d.split("-"); return Number(p[1]) + "/" + Number(p[2]) + " (" + dow(d) + ")"; };
const n1 = (x) => Number(x || 0).toLocaleString();
function dayWord(j, d) { const dd = Math.round((Date.parse(d + "T00:00:00Z") - Date.parse(j.d + "T00:00:00Z")) / 864e5); return dd === 0 ? "오늘" : dd === 1 ? "내일" : dd > 1 && dd < 7 ? dd + "일 뒤" : ""; }
function pill(c, x, y, w, h, t, size, bg, line) { rr(c, x, y, w, h, h / 2, bg || new Color("#13285A", 0.9), line || new Color("#6A93E8", 0.5), 0.7); T(c, t, x + 3, y + (h - size * 1.3) / 2, w - 6, size, P.txt, "b", "c"); }

function studyCard(c, j, b) {
  const { x, y, w, h } = b, s = j.study || {}, hk = j.hsk || null, rg = j.ring || null;
  // 메인 링 = HSK 익힘(데이터 있을 때). 링 설정이 HSK 5 면 HSK 5
  let main = null;
  if (rg && rg.k === "hsk5") main = { title: "HSK 5", pct: rg.pct || 0, big: rg.big, unit: rg.unit, sub: rg.sub };
  else if (hk && hk.total) { const p = hk.mast / hk.total; main = { title: "HSK " + (hk.lv || 4), pct: p, big: String(Math.round(p * 100)), unit: "%", sub: n1(hk.mast) + " / " + n1(hk.total) }; }
  else if (rg) main = rg;
  else main = { title: "오늘 공부", pct: s.goal ? Math.min(1, (s.today || 0) / s.goal) : 0, big: String(s.today || 0), unit: "분", sub: "목표 " + (s.goal || 30) + "분" };
  pill(c, x + w - 76, y + 11, 64, 20, main.title + " 목표", 9.5);
  // 보조 지표 하나: 링 설정이 HSK·오늘 시간이 아니면 그것, 아니면 통화 점수
  const sec = rg && !/^(hsk4|hsk5|time)$/.test(rg.k) ? rg : j.ring2 || null;
  const pct = Math.max(0, Math.min(1, main.pct || 0));
  const top = y + 38, avail = (b.big ? Math.min(h - 46, 150) : h - 46), rr0 = Math.min(b.big ? 50 : 42, avail / 2 - 5);
  const cx = x + 16 + rr0 + 5, cy = top + Math.min(avail / 2, rr0 + 6);
  glow(c, cx, cy, rr0 + 16, "#22D37A", 0.12);
  arcG(c, cx, cy, rr0, 9, 0, 1, new Color("#1D3B78"), new Color("#1D3B78"));
  if (pct > 0) { arcG(c, cx, cy, rr0, 14, 0, pct, P.green, P.green2, 0.10); arcG(c, cx, cy, rr0, 9, 0, pct, new Color("#12B866"), new Color("#9BF58C")); }
  T(c, main.title, cx - rr0 + 6, cy - rr0 * 0.62, rr0 * 2 - 12, 10, P.sub, "m", "c");
  const pv = String(main.big), bs = rr0 >= 48 ? 30 : 25, uw = tw(main.unit, 12, "b"), vw = tw(pv, bs, "h");
  T(c, pv, cx - (vw + uw) / 2 - 3, cy - bs * 0.62, vw + 6, bs, P.txt, "h", "c", bs * 1.3);
  T(c, main.unit, cx - (vw + uw) / 2 + vw + 1, cy - 2, uw + 6, 12, P.txt, "b");
  T(c, main.sub, cx - rr0 + 6, cy + rr0 * 0.36, rr0 * 2 - 12, 9.5, P.sub, "", "c");
  // 오른쪽: 타일 2×2
  const rx = cx + rr0 + 16, rw = x + w - 12 - rx, g = 6, tW = (rw - g) / 2, tH = b.big ? 34 : 28;
  const tiles = [["⏱", "오늘 학습", (s.today || 0) + "분", "#0F4A45", (s.today || 0) >= (s.goal || 30) ? P.green2 : P.txt],
    sec ? ["📞", sec.title, sec.big + sec.unit, "#2A2A6A", P.txt] : ["📚", "누적 단어", n1(j.words), "#183A86", P.txt],
    sec ? ["📚", "누적 단어", n1(j.words), "#183A86", P.txt] : ["🧩", "오늘 문제", (s.n || 0) + "개", "#2A2A6A", P.txt],
    ["🔥", "연속 학습", (s.streak || 0) + "일", "#4A1E2A", new Color("#FFB86B")]];
  tiles.forEach((t, i) => {
    const tx = rx + (i % 2) * (tW + g), ty = top + Math.floor(i / 2) * (tH + g);
    inner(c, tx, ty, tW, tH, 10, t[3]);
    T(c, t[0], tx + 5, ty + tH / 2 - 7, 18, 12, P.txt, "", "c");
    T(c, t[1], tx + 25, ty + tH / 2 - 12.5, tW - 28, 9.5, P.sub);
    T(c, t[2], tx + 25, ty + tH / 2 - 0.5, tW - 28, 13, t[4], "b");
  });
  // 오늘의 단어(최대 2개) — 실제 단어만, 없으면 문구
  let wy = top + tH * 2 + g + (b.big ? 8 : 5);
  const ch = (j.chips || []).slice(0, 2), lab = ch.some((q) => q.wrong) ? "💡 오늘의 단어 · 다시 볼 것" : "💡 오늘의 단어";
  const chipH = b.big ? 34 : 28;
  if (wy + 13 + chipH <= y + h - 4) {
    T(c, lab, rx, wy, rw, 9.5, P.sub, "m");
    wy += 13;
    if (!ch.length) T(c, "틀린 단어가 생기면 여기에 떠요", rx, wy + chipH / 2 - 7, rw, 10, P.dim);
    const CC = [["#3A2A12", "#C08A30"], ["#10285E", "#3F7BF0"]];
    ch.forEach((q, i) => {
      const qx = rx + i * (tW + g);
      grad(c, qx, wy, tW, chipH, 9, new Color(CC[i][0], 0.95), new Color("#081530", 0.9)); rr(c, qx, wy, tW, chipH, 9, null, new Color(CC[i][1], 0.8), 0.9);
      if (b.big) { T(c, q.z, qx + 8, wy + 4, tW - 16, 15, P.txt, "h"); T(c, q.k, qx + 8, wy + 22, tW - 16, 10, P.sub); }
      else { const zw = Math.min(tw(q.z, 14, "h") + 6, tW * 0.55); T(c, q.z, qx + 7, wy + chipH / 2 - 9, zw, 14, P.txt, "h"); T(c, q.k, qx + 8 + zw, wy + chipH / 2 - 6.5, tW - zw - 13, 10, P.sub); }
    });
  }
  // 큰 공부 카드: 아래에 이번 주 막대
  const d7 = s.days7 || [];
  if (b.big && d7.length) {
    const by = Math.max(cy + rr0 + 14, wy + chipH + 10), bh = y + h - 10 - by;
    if (bh >= 30) {
      T(c, "이번 주 공부 · " + (s.week || 0) + "분", x + 14, by, w - 28, 9.5, P.sub, "m");
      const gy = by + 15, gh = bh - 26, bw = (w - 28 - 6 * 8) / 7, goal = s.goal || 30, mx = Math.max(goal, ...d7.map((q) => q.min || 0), 1);
      d7.forEach((q, i) => {
        const bx = x + 14 + i * (bw + 8), hh = Math.max(2, gh * Math.min(1, (q.min || 0) / mx));
        rr(c, bx, gy, bw, gh, 4, new Color("#FFFFFF", 0.06));
        rr(c, bx, gy + gh - hh, bw, hh, 4, q.min >= goal ? P.green : q.d === j.d ? P.pink : new Color("#4C7BE0", q.min ? 0.9 : 0.25));
        T(c, dow(q.d) + (q.min ? " " + q.min : ""), bx - 4, gy + gh + 1, bw + 8, 9, q.d === j.d ? P.txt : P.sub, "", "c");
      });
    }
  }
}
function splitPlace(it) { const m = String(it.title || "").split(/\s*@\s*/); return { title: m[0], place: m[1] || "" }; }
function planCard(c, j, b) {
  const { x, y, w, h } = b, L = (j.plan || []).slice(0, b.n || 1), top = y + 37, avail = y + h - 7 - top;
  if (!L.length) { inner(c, x + 8, top, w - 16, Math.min(avail, 44), 12); T(c, "다가오는 일정이 없어요", x + 20, top + Math.min(avail, 44) / 2 - 8, w - 40, 12, P.sub, "m"); return; }
  const first = Math.min(L.length > 1 ? 54 : avail, 64), restH = L.length > 1 ? Math.min(40, (avail - first - 4 * (L.length - 1)) / (L.length - 1)) : 0;
  let yy = top;
  L.forEach((it, i) => {
    const big = i === 0, hh = big ? first : restH, ix = x + 8, iw = w - 16, sp = splitPlace(it), dw = dayWord(j, it.d);
    if (hh < 22) return;
    inner(c, ix, yy, iw, hh, 12, big ? "#123070" : null);
    const tcol = big ? 94 : 80, ts = big ? (hh >= 50 ? 22 : 18) : 14, ls = big ? 9.5 : 9, y0 = yy + (hh - (ls * 1.25 + ts * 1.15)) / 2, yT = y0 + ls * 1.25;
    if (it.t) {
      T(c, (dw ? dw + " · " : "") + sday(it.d), ix + 10, y0, tcol - 14, ls, P.sub);
      T(c, it.t, ix + 10, yT, tcol - 14, ts, P.txt, "h", "", ts * 1.4);
    } else {
      T(c, dw || dow(it.d) + "요일", ix + 10, y0, tcol - 14, ls, P.sub);
      const p = it.d.split("-"), ds = Number(p[1]) + "/" + Number(p[2]), dW = Math.min(52, tw(ds, ts, "h") + 4);
      T(c, ds, ix + 10, yT, dW + 4, ts, P.txt, "h", "", ts * 1.4);
      if (big) pill(c, ix + 12 + dW, yT + ts * 0.25, 28, 14, "종일", 8.5, new Color("#1450D8"), new Color("#7FA8FF", 0.6));
    }
    c.setFillColor(new Color("#FFFFFF", 0.14)); c.fillRect(R(ix + tcol, yy + 9, 0.7, hh - 18));
    const icx = ix + tcol + 10, ic = it.icon === "🕘" ? "💼" : it.icon, cs = big ? 30 : 22;
    if (big) glow(c, icx + cs / 2, yy + hh / 2, cs * 0.9, "#2F7BFF", 0.4);
    c.setFillColor(big ? P.blue2 : new Color("#1A2E5C")); c.fillEllipse(R(icx, yy + hh / 2 - cs / 2, cs, cs));
    T(c, ic, icx, yy + hh / 2 - cs * 0.27, cs, cs * 0.45, P.txt, "", "c");
    const mx = icx + cs + 9, mw = ix + iw - 10 - mx;
    // 우선순위: 제목 > 장소 > 상세(기간·편명)
    const l2 = [sp.place ? "📍 " + sp.place : "", it.sub || ""].filter(Boolean);
    if (big) {
      T(c, sp.title, mx, yy + (l2.length ? hh / 2 - 15 : hh / 2 - 9), mw, 13.5, P.txt, "b");
      if (l2[0]) T(c, l2[0], mx, yy + hh / 2 + 2, mw, 10, P.sub);
      if (l2[1] && hh >= 58) T(c, l2[1], mx, yy + hh / 2 + 16, mw, 9.5, P.dim);
    } else {
      T(c, sp.title, mx, yy + (l2.length ? hh / 2 - 13 : hh / 2 - 8), mw, 11.5, P.txt, "b");
      if (l2[0]) T(c, l2[0], mx, yy + hh / 2 + 1, mw, 9.5, P.sub);
    }
    yy += hh + 4;
  });
}
function teamCard(c, j, b) {
  const { x, y, w, h } = b, lw = Math.min(78, w * 0.23), cr = crest(), G = (j.games || []).filter((g) => !g.done).slice(0, b.n || 3);
  if (cr) imgIn(c, cr, x + 9, y + 10, lw - 16, h - 20);
  else { T(c, "⚽", x + 1, y + h / 2 - 20, lw, 32, P.txt, "", "c", 42); T(c, "MY TEAM", x + 1, y + h - 22, lw, 9, P.sub, "b", "c"); }
  const rx = x + lw + 12, rw = x + w - 10 - rx;
  T(c, "좋아하는 팀 일정", rx, y + 9, rw * 0.62, 14, P.txt, "b");
  const st = j.gstate || (G.length ? "ok" : j.gerr ? "fail" : "empty");
  if (!G.length) {
    // 경기 없음 / 연결 실패 / 팀 꺼짐 — 서로 다른 화면
    const by = y + 34, bh = y + h - 8 - by;
    inner(c, rx - 2, by, rw + 2, bh, 12, st === "fail" ? "#3A1520" : null);
    const M = st === "fail" ? ["⚠️ 경기 정보를 못 불러왔어요", j.gmsg || j.gerr || "잠시 뒤 다시 시도해요", "다음 새로고침 때 다시 받아요"]
      : st === "off" ? ["팀 알림이 꺼져 있어요", "voice.zhnote.net/me 에서 팀을 켜 주세요", ""]
      : ["📭 예정된 경기가 없어요", j.gmsg || "시즌이 끝났거나 일정이 아직 안 나왔어요", "일정이 나오면 여기에 바로 떠요"];
    T(c, M[0], rx + 10, by + 10, rw - 18, 12.5, st === "fail" ? new Color("#FF9AA8") : P.txt, "b");
    T(c, M[1], rx + 10, by + 29, rw - 18, 10, P.sub, "", "", 28);
    if (M[2] && bh > 62) T(c, M[2], rx + 10, by + bh - 20, rw - 18, 9.5, P.dim);
    return;
  }
  const top = y + 33, avail = y + h - 7 - top, rows = avail >= 92 ? 3 : avail >= 52 ? 2 : 1; G.splice(rows);
  const firstH = G.length > 1 ? Math.min(36, Math.max(28, avail * 0.42)) : Math.min(40, avail), restH = G.length > 1 ? Math.min(28, (avail - firstH - 4 * (G.length - 1)) / (G.length - 1)) : 0;
  let ry = top;
  G.forEach((g, i) => {
    const big = i === 0, rh = big ? firstH : restH;
    if (rh < 18) return;
    inner(c, rx - 2, ry, rw + 2, rh, 10, big ? "#123070" : null);
    const dw = dayWord(j, g.d), dl = big && dw ? dw : sday(g.d);
    T(c, dl, rx + 6, ry + rh / 2 - (big ? 12 : 6), 52, big ? 10 : 9.5, big ? P.txt : P.sub, big ? "b" : "");
    if (big) T(c, sday(g.d), rx + 6, ry + rh / 2 + 1, 52, 8.5, P.sub);
    T(c, g.hm, rx + 56, ry + rh / 2 - (big ? 8 : 6.5), 40, big ? 13 : 11, P.txt, "h");
    const tag = g.k === "lol" ? (g.tag || "LoL") : g.home ? "홈" : "원정", home = g.k === "fb" ? g.home : true;
    const pw = Math.max(30, Math.min(48, tw(tag, 9, "b") + 14));
    pill(c, rx + rw - pw - 2, ry + rh / 2 - 8, pw, 16, tag, 9, home ? P.blue2 : new Color("#2A3656"), home ? new Color("#7FA8FF", 0.7) : new Color("#8A97B8", 0.5));
    const a = g.k === "fb" && !g.home ? g.op : g.me, bb = g.k === "fb" && !g.home ? g.me : g.op, mx = rx + 98, mw = rw - 98 - pw - 8;
    const mine = new Color(g.k === "lol" ? "#FF6B7E" : "#7FB2FF"), col = (n) => n === g.me ? mine : P.txt, ms = big ? 12.5 : 10.5;
    const ce = g.k === "fb" && cr, half = (mw - 18) / 2, cw2 = ce ? ms + 3 : 0;
    T(c, a, mx, ry + rh / 2 - ms * 0.65, half - (ce && a === g.me ? cw2 : 0), ms, col(a), "b", "r");
    if (ce && a === g.me) imgIn(c, cr, mx + half - ms - 1, ry + rh / 2 - ms * 0.6, ms, ms * 1.25);
    T(c, "vs", mx + half, ry + rh / 2 - 5, 18, 8.5, P.dim, "", "c");
    if (ce && bb === g.me) imgIn(c, cr, mx + half + 19, ry + rh / 2 - ms * 0.6, ms, ms * 1.25);
    T(c, bb, mx + half + 18 + (ce && bb === g.me ? cw2 : 0), ry + rh / 2 - ms * 0.65, half - (ce && bb === g.me ? cw2 : 0), ms, col(bb), "b");
    ry += rh + 4;
  });
}
// ---------- 🖼 이미지 배경 하이브리드(2026-10-30 소유자 ZIP: widget_large_background.png 1092×1146 + 좌표표) ----------
// 배경 PNG 에 카드·테두리·헤더·레이블·엠블럼·링 트랙이 다 들어 있음 → 여기서는 값 글자와 진척 호만 그림. 딤 없음.
// 파일은 폰 Scriptable 문서 폴더(공개 저장소에 구단 엠블럼을 넣지 않음) — 앱 메뉴 '🖼 위젯 배경 그림 고르기'. 없으면 그려서 만드는 화면으로.
const IMGBG = FM.joinPath(FM.documentsDirectory(), "widget_large_background.png");
const IMGBG2 = FM.joinPath(FM.documentsDirectory(), "widget_large_bg_crisp_v2.png"); // 2026-10-30 crisp v2(선명 판) — 있으면 이쪽을 먼저 씀
const SLOT1 = { hsk_badge: [296, 21, 47, 13], hsk_level: [37, 87, 57, 15], hsk_percent: [27, 104, 76, 34], hsk_mastery: [37, 130, 56, 12],
  today_minutes: [139, 71, 85, 17], total_words: [250, 71, 91, 17], speaking_score: [139, 116, 85, 17], study_streak: [250, 116, 91, 17],
  chinese_word_1: [133, 158, 94, 13], chinese_word_2: [245, 158, 96, 13],
  next_date: [22, 233, 76, 12], next_time: [22, 245, 76, 12], next_title: [121, 232, 221, 15], next_subtitle: [121, 247, 221, 10],
  game_row_1: [118, 321, 225, 14], game_row_2: [118, 347, 225, 14], no_games_message: [115, 328, 224, 29] };
// crisp v2 좌표(widget_large_coordinates_crisp_v2.json, 논리 pt): 'HSK 4' 배지·레이블은 배경에 박혀 있어 값만
const SLOT2 = { hsk_percent: [32, 89, 70, 37], hsk_progress_detail: [37, 120, 65, 16],
  study_minutes: [142, 66, 86, 20], cumulative_words: [252, 66, 85, 20], speaking_score: [142, 113, 86, 20], streak_days: [252, 113, 85, 20],
  word_1: [138, 156, 94, 12], word_2: [248, 156, 96, 12],
  event_date_time: [24, 226, 85, 22], event_name: [126, 223, 211, 17], event_detail: [126, 240, 211, 11],
  match_1: [126, 318, 216, 14], match_2: [126, 345, 216, 14] };
const RING1 = { cx: 65, cy: 111, r: 40, w: 8, color: "#28E9C7" };
const RING2 = { cx: 67, cy: 105, r: 41, w: 9, color: "#29D3B8" };
let SLOT = SLOT1;
const IC = { txt: new Color("#F1F7FF"), sub: new Color("#A8BDDF"), acc: new Color("#28E9C7"), warn: new Color("#FFB86B"), bad: new Color("#FF9AA8"), mine: new Color("#7FB2FF") };
function imgBg() {
  try {
    if (FM.fileExists(IMGBG2)) return { img: Image.fromFile(IMGBG2), v: 2 };
    if (FM.fileExists(IMGBG)) return { img: Image.fromFile(IMGBG), v: 1 };
  } catch (e) {}
  return null;
}
// 칸 안에 글자: 높이에 맞춰 크기를 정하고, 폭이 넘치면 줄였다가 말줄임
function S(c, key, t, size, color, weight, align) {
  const [x, y, w, h] = SLOT[key]; t = String(t == null ? "" : t); if (!t) return;
  let sz = size || Math.min(h * 0.86, 30); const need = tw(t, sz, weight);
  if (need > w) sz = Math.max(sz * 0.78, sz * w / need);
  c.setFont(weight === "b" ? Font.boldSystemFont(sz * K) : weight === "h" ? Font.heavySystemFont(sz * K) : weight === "m" ? Font.semiboldSystemFont(sz * K) : Font.systemFont(sz * K));
  c.setTextColor(color || IC.txt);
  if (align === "c") c.setTextAlignedCenter(); else if (align === "r") c.setTextAlignedRight(); else c.setTextAlignedLeft();
  const lh = sz * 1.3, yy = y + Math.max(0, (h - lh) / 2) - sz * 0.08; // 칸 세로 가운데
  c.drawTextInRect(fit(t, w, sz, weight), R(x, yy, w, Math.max(h, lh)));
}
// 링 호만(트랙은 배경에 있음)
function ringArc(c, RING, pct) {
  pct = Math.max(0, Math.min(1, pct || 0)); if (pct <= 0) return;
  arcG(c, RING.cx, RING.cy, RING.r, RING.w + 4, 0, pct, new Color(RING.color), new Color(RING.color), 0.18);
  arcG(c, RING.cx, RING.cy, RING.r, RING.w, 0, pct, new Color("#19C9A9"), new Color("#6FF6DD"));
}
function hskRing(j) { // 진척률 = 실제 익힌 단어 / HSK 목표 단어(j.ring.big 가 아님)
  const hk = j.hsk && j.hsk.total ? j.hsk : null, rg = j.ring || null;
  if (rg && rg.k === "hsk5") return { title: "HSK 5", pct: rg.pct || 0, big: rg.big + rg.unit, sub: rg.sub };
  if (hk) { const pct = hk.mast / hk.total; return { title: "HSK " + (hk.lv || 4), pct, big: Math.round(pct * 100) + "%", sub: n1(hk.mast) + " / " + n1(hk.total) }; }
  if (rg) return { title: rg.title, pct: rg.pct || 0, big: rg.big + rg.unit, sub: rg.sub };
  return { title: "HSK 4", pct: 0, big: "0%", sub: "" };
}
function speakScore(j) { const rg = j.ring || null; return j.ring2 && j.ring2.k === "call" ? j.ring2 : rg && rg.k === "call" ? rg : null; }
// 수원 경기 두 줄: 확인된 경기만. 없으면 [상태 문장, 보조 문장] — 받기 실패·확인된 일정 없음·저장본 구분, 경기를 지어내지 않음
function gameLines(j) {
  const G = (j.games || []).filter((g) => g.k === "fb" && !g.done).slice(0, 2), st = j.gstate || (G.length ? "ok" : "fail");
  if (G.length) return { ok: true, rows: G.map((g) => { const dw = dayWord(j, g.d), a = g.home ? g.me : g.op, b = g.home ? g.op : g.me; return (dw ? dw + " " : "") + sday(g.d) + " " + g.hm + "  " + a + " vs " + b + "  · " + (g.home ? "홈" : "원정"); }) };
  if (st === "fail") return { ok: false, bad: true, rows: ["⚠️ 경기 정보를 못 불러왔어요", j.stale ? "저장본 · 마지막으로 받은 값이에요" : (j.gmsg || "잠시 뒤 다시 받아요")] };
  if (st === "off") return { ok: false, rows: ["팀 알림이 꺼져 있어요", "/me 내 팀에서 켤 수 있어요"] };
  return { ok: false, rows: ["확인된 다음 경기 없음", "일정이 확인되면 여기에 표시됩니다"] };
}
function proImg(j, bg) {
  SLOT = bg.v === 2 ? SLOT2 : SLOT1;
  const c = new DrawContext(); c.size = new Size(bg.img.size.width, bg.img.size.height); c.opaque = false; c.respectScreenScale = false;
  c.drawImageInRect(bg.img, new Rect(0, 0, bg.img.size.width, bg.img.size.height)); // 배경 그대로 — 딤·흐림 없음
  const s = j.study || {}, hr = hskRing(j), goal = s.goal || 30, today = s.today || 0, sp = speakScore(j), ch = (j.chips || []).slice(0, 2), it = (j.plan || [])[0], gl = gameLines(j);
  if (bg.v === 2) {
    ringArc(c, RING2, hr.pct);
    S(c, "hsk_percent", hr.big, hr.big.length > 3 ? 25 : 29, IC.txt, "h", "c");
    S(c, "hsk_progress_detail", hr.sub, 10.5, IC.sub, "", "c");
    S(c, "study_minutes", today + "분" + (goal ? " / " + goal : ""), 15, today >= goal ? IC.acc : IC.txt, "b");
    S(c, "cumulative_words", n1(j.words) + "개", 15, IC.txt, "b");
    S(c, "speaking_score", sp ? sp.big + sp.unit : "기록 없음", sp ? 15 : 12, sp && Number(sp.big) > 0 ? IC.txt : IC.sub, "b");
    S(c, "streak_days", (s.streak || 0) + "일", 15, (s.streak || 0) > 0 ? IC.warn : IC.txt, "b");
    if (ch[0]) S(c, "word_1", ch[0].z + " · " + ch[0].k, 11, IC.txt, "b"); else S(c, "word_1", "틀린 단어 없음", 10, IC.sub);
    if (ch[1]) S(c, "word_2", ch[1].z + " · " + ch[1].k, 11, IC.txt, "b");
    if (it) {
      const sp2 = splitPlace(it), p = it.d.split("-"), dw = dayWord(j, it.d);
      S(c, "event_date_time", Number(p[1]) + "/" + Number(p[2]) + " · " + (it.t || "종일"), 14, IC.txt, "b");
      S(c, "event_name", sp2.title, 14, IC.txt, "b");
      S(c, "event_detail", [dw ? dw + " (" + dow(it.d) + ")" : "", sp2.place ? "📍 " + sp2.place : "", it.sub || ""].filter(Boolean).join(" · "), 9.5, IC.sub);
    } else { S(c, "event_date_time", "—", 14, IC.sub, "b"); S(c, "event_name", "다가오는 일정이 없어요", 13, IC.sub, "m"); }
    S(c, "match_1", gl.rows[0], 12, gl.ok ? IC.txt : gl.bad ? IC.bad : IC.txt, gl.ok ? "b" : "m");
    if (gl.rows[1]) S(c, "match_2", gl.rows[1], gl.ok ? 12 : 10.5, gl.ok ? IC.txt : IC.sub, gl.ok ? "m" : "");
  } else {
    ringArc(c, RING1, hr.pct);
    S(c, "hsk_badge", hr.title, 10, IC.txt, "b", "c");
    S(c, "hsk_level", hr.title, 11, IC.sub, "m", "c");
    S(c, "hsk_percent", hr.big, hr.big.length > 3 ? 24 : 28, IC.txt, "h", "c");
    S(c, "hsk_mastery", hr.sub, 9, IC.sub, "", "c");
    S(c, "today_minutes", today + "분" + (goal ? " / " + goal : ""), 14, today >= goal ? IC.acc : IC.txt, "b");
    S(c, "total_words", n1(j.words) + "개", 14, IC.txt, "b");
    S(c, "speaking_score", sp ? sp.big + sp.unit : "기록 없음", 14, sp && Number(sp.big) > 0 ? IC.txt : IC.sub, "b");
    S(c, "study_streak", (s.streak || 0) + "일", 14, (s.streak || 0) > 0 ? IC.warn : IC.txt, "b");
    if (ch[0]) S(c, "chinese_word_1", ch[0].z + " · " + ch[0].k, 11, IC.txt, "b"); else S(c, "chinese_word_1", "틀린 단어 없음", 10, IC.sub);
    if (ch[1]) S(c, "chinese_word_2", ch[1].z + " · " + ch[1].k, 11, IC.txt, "b");
    if (it) {
      const sp2 = splitPlace(it), dw = dayWord(j, it.d), p = it.d.split("-");
      S(c, "next_date", (dw ? dw + " · " : "") + Number(p[1]) + "/" + Number(p[2]) + " (" + dow(it.d) + ")", 9.5, IC.sub);
      S(c, "next_time", it.t || "종일", it.t ? 13 : 11, IC.txt, "h");
      S(c, "next_title", sp2.title, 13, IC.txt, "b");
      S(c, "next_subtitle", [sp2.place ? "📍 " + sp2.place : "", it.sub || ""].filter(Boolean).join(" · ") || (it.t ? "" : "하루 종일"), 9.5, IC.sub);
    } else { S(c, "next_title", "다가오는 일정이 없어요", 12, IC.sub, "m"); }
    if (gl.ok) gl.rows.forEach((r, i) => S(c, i ? "game_row_2" : "game_row_1", r, 11, IC.txt, i ? "m" : "b"));
    else S(c, "no_games_message", gl.rows[0], 11.5, gl.bad ? IC.bad : IC.sub, "m");
  }
  if (j.stale) T(c, "⚠︎ 저장본", 364 - 64, 382 - 13, 56, 8, IC.sub, "", "r");
  const w = new ListWidget(); w.backgroundImage = c.getImage(); w.url = "https://voice.zhnote.net/me";
  w.refreshAfterDate = new Date(Date.now() + 20 * 60e3); w.setPadding(0, 0, 0, 0);
  return w;
}
async function pickBgImg() {
  try {
    const f = await DocumentPicker.openFile(), name = String(f).split("/").pop().toLowerCase();
    const dst = /crisp|v2/.test(name) ? IMGBG2 : IMGBG; // crisp v2 그림은 좌표가 다르므로 이름으로 구분
    FM.write(dst, Data.fromFile(f)); if (dst === IMGBG2 && FM.fileExists(IMGBG)) FM.remove(IMGBG);
    return true;
  } catch (e) { return false; }
}
// 큰 위젯: 비움·all = 공부+일정+팀 / study = 공부(크게)+일정 / plan = 일정+팀 · 중간 위젯 plan·team = 팀
function pro(j, fam, P0) {
  if (P0 === "all") P0 = "";
  if (fam !== "medium" && !P0) { const bg = imgBg(); if (bg) return proImg(j, bg); } // 배경 그림이 있으면 이미지 하이브리드
  const sz = wsize(fam), c = D(sz);
  c.drawImageInRect(baseImage(fam, P0, sz), new Rect(0, 0, sz.width * K, sz.height * K));
  for (const b of layout(fam, P0, sz.width, sz.height)) { if (b.k === "study") studyCard(c, j, b); else if (b.k === "plan") planCard(c, j, b); else teamCard(c, j, b); }
  if (j.stale) T(c, "⚠︎ 저장본", sz.width - 64, sz.height - 13, 56, 8, P.dim, "", "r");
  const w = new ListWidget(); w.backgroundImage = c.getImage(); w.url = "https://voice.zhnote.net/me";
  w.refreshAfterDate = new Date(Date.now() + 20 * 60e3); w.setPadding(0, 0, 0, 0);
  return w;
}
// 엠블럼: 배경이 투명한 PNG 를 파일 앱에서 고르는 게 가장 깔끔(사진 앱은 투명이 빠질 수 있음)
async function pickCrest() {
  const q = new Alert(); q.title = "팀 엠블럼"; q.message = "배경이 투명한 PNG 를 파일 앱에 저장해 두고 '파일에서'를 고르세요."; q.addAction("파일에서"); q.addAction("사진에서"); q.addCancelAction("취소");
  const r = await q.presentSheet();
  try {
    if (r === 0) { const f = await DocumentPicker.openFile(); FM.write(CREST, Data.fromFile(f)); return true; }
    if (r === 1) { const im = await Photos.fromLibrary(); FM.writeImage(CREST, im); return true; }
  } catch (e) {}
  return false;
}
// ---------- ✨ 네이티브 글자 위젯(2026-10-30 소유자 '선명도' — 위젯 전체를 그림 한 장으로 만들지 않음) ----------
// 글자·숫자는 전부 WidgetText(그림자·글로우 없음), 카드는 WidgetStack(배경색·테두리·모서리), DrawContext 는 링 호·엠블럼 같은 그림에만.
const NC = { bg1: new Color("#0A1430"), bg2: new Color("#0F1F44"), card: new Color("#0F1F42", 0.94), line: new Color("#3156A0", 0.85), txt: new Color("#F5F8FF"), sub: new Color("#BBC9E8"), dim: new Color("#8A9AC2"),
  acc: new Color("#2EE6C5"), warn: new Color("#FFC56E"), bad: new Color("#FF9AA8"), blue: new Color("#2F6FE4"), mine: new Color("#8FBBFF"), lol: new Color("#FF7A8C"), chip: new Color("#13285A"), chipLine: new Color("#6A93E8", 0.6) };
const TILE = { g: ["#0E3A33", "#2BB591"], b: ["#112E60", "#3B82F6"], p: ["#2A1A4E", "#8A63E8"], r: ["#3A1626", "#E0566E"] };
function NT(st, s, size, color, weight, lines) {
  const t = st.addText(String(s == null ? "" : s));
  t.font = weight === "b" ? Font.boldSystemFont(size) : weight === "h" ? Font.heavySystemFont(size) : weight === "m" ? Font.semiboldSystemFont(size) : Font.systemFont(size);
  t.textColor = color || NC.txt; t.lineLimit = lines || 1; t.minimumScaleFactor = 0.72; return t;
}
let PHOTO = false; // 배경 사진이 깔려 있으면 카드를 살짝 비쳐 보이게
function NCard(parent, pad, h) { const c = parent.addStack(); c.layoutVertically(); c.backgroundColor = PHOTO ? new Color("#0C1A3A", 0.78) : NC.card; c.cornerRadius = 16; c.borderWidth = 1; c.borderColor = NC.line; c.setPadding(pad, 12, pad, 12); if (h) c.size = new Size(0, h); return c; }
function NBox(parent, bg, line, r, px, py) { const b = parent.addStack(); b.backgroundColor = bg; b.cornerRadius = r; if (line) { b.borderWidth = 1; b.borderColor = line; } b.setPadding(py, px, py, px); b.centerAlignContent(); return b; }
function NHead(c, emoji, title, right, rightBox) {
  const h = c.addStack(); h.centerAlignContent();
  const ib = h.addStack(); ib.size = new Size(26, 26); ib.cornerRadius = 7; ib.backgroundColor = NC.blue; ib.centerAlignContent(); ib.addSpacer(); NT(ib, emoji, 14); ib.addSpacer();
  h.addSpacer(8); NT(h, title, 16, NC.txt, "b"); h.addSpacer();
  if (right) { if (rightBox) { const b = NBox(h, new Color("#102B5E"), NC.line, 11, 10, 3); NT(b, right, 12, NC.txt, "m"); } else NT(h, right, 11, NC.sub, "m"); }
  return h;
}
// 링: 트랙+진척 호만 그림(글자 없음) → 그 위에 WidgetText
function ringImg(pct, S, col) {
  const c = new DrawContext(); c.size = new Size(S, S); c.opaque = false; c.respectScreenScale = true;
  const lw = Math.max(7, S * 0.1), r = S / 2 - lw / 2 - 1, cx = S / 2, cy = S / 2;
  c.setStrokeColor(new Color("#2A4A86", 0.9)); c.setLineWidth(lw); c.strokeEllipse(new Rect(cx - r, cy - r, r * 2, r * 2));
  pct = Math.max(0, Math.min(1, pct || 0));
  if (pct > 0.003) {
    const n = Math.max(2, Math.round(120 * pct)), path = new Path();
    for (let i = 0; i <= n; i++) { const a = -Math.PI / 2 + Math.PI * 2 * pct * i / n; const pt = new Point(cx + r * Math.cos(a), cy + r * Math.sin(a)); if (i === 0) path.move(pt); else path.addLine(pt); }
    c.addPath(path); c.setStrokeColor(new Color(col || "#2EE6C5")); c.setLineWidth(lw); c.strokePath();
    const e = -Math.PI / 2 + Math.PI * 2 * pct; c.setFillColor(new Color(col || "#2EE6C5")); c.fillEllipse(new Rect(cx + r * Math.cos(e) - lw / 2, cy + r * Math.sin(e) - lw / 2, lw, lw));
  }
  return c.getImage();
}
function NRing(parent, S, pct, big, sub, bigSize) {
  const rs = parent.addStack(); rs.size = new Size(S, S); rs.backgroundImage = ringImg(pct, S); rs.layoutVertically(); rs.setPadding(0, 0, 0, 0);
  rs.addSpacer(); const r1 = rs.addStack(); r1.addSpacer(); NT(r1, big, bigSize || 24, NC.txt, "h"); r1.addSpacer();
  if (sub) { const r2 = rs.addStack(); r2.addSpacer(); NT(r2, sub, 10.5, NC.sub, "m"); r2.addSpacer(); }
  rs.addSpacer(); return rs;
}
function NTile(row, w, label, value, k, valCol, Q) {
  const t = row.addStack(); t.layoutVertically(); t.size = new Size(w, 0); t.backgroundColor = new Color(TILE[k][0]); t.cornerRadius = 11; t.borderWidth = 1; t.borderColor = new Color(TILE[k][1], 0.8); t.setPadding(Q.tp, 9, Q.tp, 9);
  NT(t, label, 11.5, new Color(TILE[k][1]), "m"); t.addSpacer(1); NT(t, value, Q.tv, valCol || NC.txt, "b"); return t;
}
function NChip(row, w, text, k) { const b = row.addStack(); b.size = new Size(w, 0); b.backgroundColor = k === "y" ? new Color("#2E2410") : NC.chip; b.cornerRadius = 9; b.borderWidth = 1; b.borderColor = k === "y" ? new Color("#D9A441", 0.7) : NC.chipLine; b.setPadding(4, 8, 4, 8); b.centerAlignContent(); NT(b, text, 12, NC.txt, "b"); b.addSpacer(); return b; }
function NStudy(w, j, W, big, Q) {
  const c = NCard(w, Q.pad), s = j.study || {}, hr = hskRing(j), goal = s.goal || 30, today = s.today || 0, sp = speakScore(j), ch = (j.chips || []).slice(0, big ? 4 : 2);
  NHead(c, "📖", "중국어 학습", hr.title, true); c.addSpacer(Q.g);
  const body = c.addStack(); body.centerAlignContent();
  const RS = big ? 104 : Q.ring, left = body.addStack(); left.layoutVertically(); left.size = new Size(RS + 4, 0);
  const lr = left.addStack(); lr.addSpacer(); NRing(lr, RS, hr.pct, hr.big, hr.sub, big ? 27 : 23); lr.addSpacer();
  if (big) { left.addSpacer(3); const lt = left.addStack(); lt.addSpacer(); NT(lt, "HSK 진척률", 11.5, NC.dim, "m"); lt.addSpacer(); }
  body.addSpacer(8);
  const right = body.addStack(); right.layoutVertically(); const tw2 = (W - 24 - RS - 4 - 8 - 6) / 2;
  const r1 = right.addStack(); NTile(r1, tw2, "오늘 학습", today + "분 / " + goal, "g", today >= goal ? NC.acc : NC.txt, Q); r1.addSpacer(6); NTile(r1, tw2, "누적 단어", n1(j.words) + "개", "b", null, Q);
  right.addSpacer(6);
  const r2 = right.addStack(); NTile(r2, tw2, "통화 점수", sp ? sp.big + sp.unit : "기록 없음", "p", sp && Number(sp.big) > 0 ? NC.txt : NC.sub, Q); r2.addSpacer(6); NTile(r2, tw2, "연속 학습", (s.streak || 0) + "일", "r", (s.streak || 0) > 0 ? NC.warn : NC.txt, Q);
  c.addSpacer(Q.g);
  if (big) { NT(c, "오늘의 단어", 12, NC.sub, "m"); c.addSpacer(4); }
  const cw = (W - 24 - 6) / 2, wr = c.addStack();
  if (ch[0]) NChip(wr, cw, ch[0].z + " · " + ch[0].k, "y"); else NChip(wr, cw, "틀린 단어 없음", "");
  wr.addSpacer(6); if (ch[1]) NChip(wr, cw, ch[1].z + " · " + ch[1].k, ""); else wr.addSpacer();
  if (big && ch[2]) { c.addSpacer(5); const w2 = c.addStack(); NChip(w2, cw, ch[2].z + " · " + ch[2].k, ""); w2.addSpacer(6); if (ch[3]) NChip(w2, cw, ch[3].z + " · " + ch[3].k, ""); else w2.addSpacer(); }
  return c;
}
function NPlanRow(c, j, it, first) {
  const row = c.addStack(); row.centerAlignContent(); row.backgroundColor = new Color("#0B1A3A", 0.9); row.cornerRadius = 12; row.borderWidth = 1; row.borderColor = NC.line; row.setPadding(first ? 7 : 5, 10, first ? 7 : 5, 10);
  const sp2 = splitPlace(it), p = it.d.split("-"), dw = dayWord(j, it.d);
  const L = row.addStack(); L.size = new Size(92, 0); L.centerAlignContent(); NT(L, Number(p[1]) + "/" + Number(p[2]) + " · " + (it.t || "종일"), first ? 14 : 13, NC.txt, "b"); L.addSpacer();
  const bar = row.addStack(); bar.size = new Size(1, first ? 30 : 22); bar.backgroundColor = NC.line; row.addSpacer(10);
  const R = row.addStack(); R.layoutVertically(); NT(R, sp2.title, first ? 14 : 13, NC.txt, "b");
  const det = [dw ? dw + " (" + dow(it.d) + ")" : dow(it.d), sp2.place ? "📍 " + sp2.place : "", it.sub || ""].filter(Boolean).join(" · ");
  if (first && det) NT(R, det, 11, NC.sub, "m");
  row.addSpacer(); return row;
}
function NPlan(w, j, n, Q, lite) {
  const c = NCard(w, Q.pad), P2 = (j.plan || []).slice(0, n);
  NHead(c, "📅", "다음 일정", "NEXT EVENT"); c.addSpacer(Q.g);
  if (!P2.length) { const b = NBox(c, new Color("#0B1A3A", 0.9), NC.line, 12, 10, 8); NT(b, "다가오는 일정이 없어요", 13, NC.sub, "m"); b.addSpacer(); return c; }
  P2.forEach((it, i) => { if (i) c.addSpacer(4); NPlanRow(c, j, it, i === 0 && !lite); });
  return c;
}
function NGameRow(c, j, g, first) {
  const row = c.addStack(); row.centerAlignContent(); row.backgroundColor = new Color(first ? "#112C66" : "#0B1A3A", 0.92); row.cornerRadius = 10; row.borderWidth = 1; row.borderColor = NC.line; row.setPadding(5, 8, 5, 8);
  const bar = row.addStack(); bar.size = new Size(3, 16); bar.cornerRadius = 1.5; bar.backgroundColor = g.k === "lol" ? NC.lol : NC.acc; row.addSpacer(8);
  const dw = dayWord(j, g.d), mine = g.k === "lol" ? NC.lol : NC.mine;
  if (g.done) { // 최근 결과: 날짜 · 수원 3-2 승 · vs 상대
    NT(row, sday(g.d), 12.5, NC.sub, "m"); row.addSpacer(8);
    NT(row, g.me + " " + g.res, 13, g.win > 0 ? NC.acc : g.win < 0 ? NC.bad : NC.txt, "b"); NT(row, "  vs " + g.op, 12.5, NC.txt, "m");
  } else {
    NT(row, (dw ? dw + " " : "") + sday(g.d) + " " + g.hm, 12.5, NC.sub, "m"); row.addSpacer(8);
    const a = g.k === "fb" && !g.home ? g.op : g.me, b = g.k === "fb" && !g.home ? g.me : g.op;
    NT(row, a, 13, a === g.me ? mine : NC.txt, "b"); NT(row, " vs ", 11, NC.dim, "m"); NT(row, b, 13, b === g.me ? mine : NC.txt, "b");
  }
  row.addSpacer();
  const lt = String(g.tag || "LoL"), tag = g.k === "lol" ? (/월드|world/i.test(lt) ? "Worlds" : /LCK/i.test(lt) ? "LCK" : /MSI/i.test(lt) ? "MSI" : [...lt].length > 6 ? [...lt].slice(0, 6).join("") : lt) : g.home ? "홈" : "원정", pb = NBox(row, g.k === "fb" && g.home ? new Color("#1E4FB0") : new Color("#2A3656"), null, 8, 7, 2); NT(pb, tag, 10, NC.txt, "b");
  return row;
}
function NTeam(w, j, n, fbOnly, Q, lite) {
  const all = (j.games || []).filter((g) => !fbOnly || g.k === "fb"), c = NCard(w, Q.pad), cr = crest();
  const G = all.filter((g) => !g.done).slice(0, n); for (const g of all.filter((g) => g.done)) { if (G.length >= n) break; G.push(g); } // 예정 먼저, 모자라면 최근 결과
  const body = c.addStack(); body.centerAlignContent();
  const L = body.addStack(); L.layoutVertically(); L.size = new Size(n >= 3 ? 76 : 64, 0); L.centerAlignContent();
  if (cr) { const im = L.addImage(cr); im.imageSize = new Size(n >= 3 ? 68 : 58, n >= 3 ? 68 : 58); im.centerAlignImage(); } else { const e = L.addStack(); e.addSpacer(); NT(e, "⚽", 34); e.addSpacer(); }
  body.addSpacer(10);
  const R = body.addStack(); R.layoutVertically();
  NT(R, "수원 삼성 블루윙즈", 15, NC.txt, "b"); if (!lite) NT(R, G.length && G[0].done ? "RECENT RESULT" : "NEXT MATCH", 10.5, NC.sub, "m"); R.addSpacer(lite ? 4 : 5);
  if (G.length) G.forEach((g, i) => { if (i) R.addSpacer(4); NGameRow(R, j, g, i === 0 && !g.done); });
  else {
    const gl = gameLines(j);
    const b1 = NBox(R, new Color(gl.bad ? "#3A1520" : "#0B1A3A", 0.92), NC.line, 10, 9, 5); NT(b1, gl.rows[0], 13, gl.bad ? NC.bad : NC.txt, "b"); b1.addSpacer();
    R.addSpacer(4); const b2 = NBox(R, new Color("#0B1A3A", 0.92), NC.line, 10, 9, 5); NT(b2, gl.rows[1], 11.5, NC.sub, "m"); b2.addSpacer();
  }
  return c;
}
// 큰 위젯: 비움·all = 공부+일정+팀 / study = 공부(크게)+일정 / plan = 일정 3+팀 3 · 중간 위젯 team = 팀 3 / plan = 일정 2+팀 1
// 배경 사진(앨범에서 고른 me-widget-bg.jpg): 위젯 비율로 가운데를 잘라 채우고 남색을 35% + 아래로 갈수록 조금 더 — 글자는 카드 위 WidgetText 라 그대로 선명
function bgPhotoN(fam) {
  if (!FM.fileExists(BG)) return null;
  const src = Image.fromFile(BG); if (!src) return null;
  const sz = wsize(fam), W = sz.width * 2, H = sz.height * 2;
  const c = new DrawContext(); c.size = new Size(W, H); c.opaque = true; c.respectScreenScale = false;
  const k = Math.max(W / src.size.width, H / src.size.height), w = src.size.width * k, h = src.size.height * k;
  c.drawImageInRect(src, new Rect((W - w) / 2, (H - h) / 2, w, h));
  c.setFillColor(new Color("#071028", 0.35)); c.fillRect(new Rect(0, 0, W, H));
  for (let i = 0; i < 12; i++) { c.setFillColor(new Color("#071028", 0.03)); c.fillRect(new Rect(0, H * (0.4 + i * 0.05), W, H)); }
  return c.getImage();
}
function native(j, fam, P0) {
  if (P0 === "all") P0 = "";
  // 화면 높이에 따라 여백·링·숫자 크기를 줄임(428 폭 382pt 기준, 390 폭 354 · 375 폭 324) — 글자 크기는 규칙 안에서만
  const sz = wsize(fam), H = sz.height, Q = fam === "medium" ? { pad: 8, g: 5, ring: 84, tp: 5, tv: 18, out: 8 } : H >= 370 ? { pad: 8, g: 6, ring: 92, tp: 5, tv: 20, out: 8 } : H >= 340 ? { pad: 6, g: 4, ring: 84, tp: 4, tv: 20, out: 6 } : { pad: 6, g: 3, ring: 76, tp: 3, tv: 19, out: 5 };
  const W = sz.width - Q.out * 2, w = new ListWidget(); w.url = "https://voice.zhnote.net/me"; w.refreshAfterDate = new Date(Date.now() + 20 * 60e3);
  const bg = bgPhotoN(fam); PHOTO = !!bg; if (bg) w.backgroundImage = bg; else { const g = new LinearGradient(); g.colors = [NC.bg1, NC.bg2]; g.locations = [0, 1]; w.backgroundGradient = g; }
  w.setPadding(Q.out, Q.out, Q.out, Q.out);
  if (fam === "medium") {
    if (P0 === "plan") { NPlan(w, j, 1, Q); w.addSpacer(6); NTeam(w, j, 1, false, Q, true); }
    else NTeam(w, j, 3, false, Q);
  } else if (P0 === "study") { NStudy(w, j, W, true, Q); w.addSpacer(Q.out); NPlan(w, j, 2, Q); }
  else if (P0 === "plan") { NPlan(w, j, 3, Q); w.addSpacer(Q.out); NTeam(w, j, 3, false, Q); }
  else { NStudy(w, j, W, false, Q); w.addSpacer(Q.out); NPlan(w, j, 1, Q, true); w.addSpacer(Q.out); NTeam(w, j, H >= 340 ? 2 : 1, true, Q, true); }
  w.addSpacer();
  if (j.stale) { const f = w.addStack(); f.addSpacer(); NT(f, "⚠︎ 저장본", 9, NC.dim); }
  return w;
}
// 🔬 비교: 같은 데이터로 ① 그림 한 장(pro) ② 네이티브 글자(native) 를 차례로 미리보기 — 홈 화면에서는 매개변수 'img' 가 ① 고정
async function compareRender(j) {
  const a = new Alert(); a.title = "선명도 비교"; a.message = "① 그림 한 장(예전) → ② 글자 위젯(새) 순서로 큰 위젯을 띄워요. 같은 숫자·일정이 보이는지, 글자가 선명한지 비교하세요."; a.addAction("시작"); a.addCancelAction("취소");
  if (await a.presentAlert() < 0) return;
  await pro(j, "large", "").presentLarge();
  await native(j, "large", "").presentLarge();
  const m = new Alert(); m.title = "중간 위젯(팀)도 비교"; m.addAction("보기"); m.addCancelAction("그만");
  if (await m.presentAlert() < 0) return;
  await pro(j, "medium", "team").presentMedium();
  await native(j, "medium", "team").presentMedium();
}
function build(j, fam, param) {
  const w = new ListWidget(); w.backgroundColor = C.bg; w.url = "https://voice.zhnote.net/me";
  const bg = bgImage(fam); HASBG = !!bg; if (bg) w.backgroundImage = bg;
  w.refreshAfterDate = new Date(Date.now() + 20 * 60e3);
  if (j.err) { w.setPadding(14, 14, 14, 14); txt(w, "나 살피기\n" + j.err + "\n\n앱에서 한 번 실행해 주세요", 13, C.sub, 6); return w; }
  const P = String(param || "").trim().toLowerCase();
  // 기본 = 네이티브 글자 위젯(native). 매개변수 'img' = 예전 그림 한 장(pro, 비교용), 'old' = 맨 처음 글자 위젯
  const fam2 = fam === "medium" ? "medium" : "large", P1 = P.replace(/\s*img\s*/, "").trim();
  if (!/old/.test(P) && (fam === "large" || fam === "extraLarge" || (fam === "medium" && (P1 === "plan" || P1 === "team")))) {
    try { return /img/.test(P) ? pro(j, fam2, P1) : native(j, fam2, P1); } catch (e) { console.error(e); }
  }
  if (fam === "large" || fam === "extraLarge") {
    w.setPadding(8, 8, 8, 8);
    if (P === "study") { studySec(w, j, true); }
    else if (P === "plan") { planSec(w, j, 4); w.addSpacer(8); teamSec(w, j, 3); w.addSpacer(); }
    else { studySec(w, j, false); w.addSpacer(6); planSec(w, j, 2); w.addSpacer(6); teamSec(w, j, 2); w.addSpacer(); }
    if (j.stale) { const f = w.addText("⚠︎ 저장본"); f.font = Font.systemFont(9); f.textColor = C.sub; }
    return w;
  }
  // 중간 위젯 + plan: 일정·팀 두 칸
  if (fam === "medium" && (P === "plan" || P === "team")) {
    w.setPadding(8, 8, 8, 8);
    if (P === "team") { teamSec(w, j, 3); } else { planSec(w, j, 2); w.addSpacer(6); teamSec(w, j, 1); }
    w.addSpacer(); return w;
  }
  if (fam === "medium" && P === "study") { w.setPadding(8, 8, 8, 8); studySec(w, j, false); w.addSpacer(); return w; }
  const s = j.study || { today: 0, goal: 30, streak: 0, week: 0 };
  const frac = s.goal ? s.today / s.goal : 0;
  const tl = tripLines(j.trip);
  const noteCol = j.note ? (j.note.lv === "r" ? C.red : j.note.lv === "w" ? C.warn : C.ok) : C.sub;
  w.setPadding(13, 14, 11, 14);
  if (fam === "medium") {
    const row = w.addStack(); row.layoutHorizontally();
    const L = row.addStack(); L.layoutVertically(); L.size = new Size(118, 0);
    const im = L.addImage(ring(frac)); im.imageSize = new Size(54, 54);
    L.addSpacer(5);
    const n = L.addStack(); n.centerAlignContent(); txt(n, String(s.today), 26, C.ring, 1, "b"); txt(n, "/" + s.goal + "분", 15, C.ring, 1, "b");
    txt(L, (s.streak ? "🔥 " + s.streak + "일 연속" : "오늘 첫 공부를") + " · 주 " + s.week + "분", 11, C.sub);
    row.addSpacer(10);
    const R = row.addStack(); R.layoutVertically();
    txt(R, "다음 출장", 11, C.sub); R.addSpacer(2);
    txt(R, tl[0], 15, C.txt, 2, "b"); if (tl[1]) txt(R, tl[1], 12, C.sky);
    if (j.game) { R.addSpacer(6); txt(R, j.game, 12, C.txt, 2); }
    R.addSpacer();
    w.addSpacer(4);
    if (j.note) txt(w, "● " + j.note.t, 11, noteCol, 1);
  } else {
    const top = w.addStack(); top.centerAlignContent();
    const im = top.addImage(ring(frac)); im.imageSize = new Size(44, 44);
    top.addSpacer(8);
    const c = top.addStack(); c.layoutVertically();
    const n = c.addStack(); n.centerAlignContent(); txt(n, String(s.today), 24, C.ring, 1, "b"); txt(n, "/" + s.goal + "분", 13, C.ring, 1, "b");
    txt(c, s.streak ? "🔥 " + s.streak + "일 연속" : "오늘 첫 공부를", 11, C.sub);
    w.addSpacer(8);
    txt(w, tl[0], 13, C.txt, 2, "b"); if (tl[1]) txt(w, tl[1], 11, C.sky);
    w.addSpacer();
    if (j.note) txt(w, "● " + j.note.t, 10, noteCol, 2);
  }
  if (j.stale) { const f = w.addText("⚠︎ 저장본"); f.font = Font.systemFont(9); f.textColor = C.sub; }
  return w;
}

let c = await code(false);
if (config.runsInApp) {
  if (!c) c = await code(true);
  const a = new Alert(); a.title = "나 살피기 위젯";
  const ACT = [["작은 위젯", "small", ""], ["중간 위젯", "medium", ""], ["큰 위젯 · 전부(비우기·all)", "large", "all"], ["큰 위젯 · 공부+일정(study)", "large", "study"], ["큰 위젯 · 일정+팀(plan)", "large", "plan"], ["중간 위젯 · 팀(team)", "medium", "team"], ["큰 위젯 · 그림 한 장(img, 비교용)", "large", "img"], ["큰 위젯 · 예전 모양(old)", "large", "old"]];
  ACT.forEach((x) => a.addAction(x[0] + " 미리보기")); a.addAction("🖼 배경 사진 고르기"); a.addAction("배경 사진 지우기"); a.addAction("초대 코드 다시 넣기"); a.addAction("🛡 팀 엠블럼 고르기(파일·사진)"); a.addAction("팀 엠블럼 지우기"); a.addAction("🖼 위젯 배경 그림 고르기(파일, 큰 위젯)"); a.addAction("위젯 배경 그림 지우기"); a.addAction("🔬 선명도 비교(그림 vs 글자)"); a.addCancelAction("닫기");
  let k = await a.presentSheet(); const N = ACT.length;
  if (k === N) { const ok = await pickBg(); if (ok) k = 2; } // 고르면 바로 큰 위젯 미리보기
  else if (k === N + 1) { if (FM.fileExists(BG)) FM.remove(BG); k = 0; }
  else if (k === N + 3) { if (await pickCrest()) k = 4; } // 고르면 팀 카드 미리보기
  else if (k === N + 4) { if (FM.fileExists(CREST)) FM.remove(CREST); k = 4; }
  else if (k === N + 5) { if (await pickBgImg()) k = 2; } // 고르면 큰 위젯(전부) 미리보기
  else if (k === N + 6) { if (FM.fileExists(IMGBG)) FM.remove(IMGBG); if (FM.fileExists(IMGBG2)) FM.remove(IMGBG2); k = 2; }
  else if (k === N + 7) { const j = c ? await load(c) : { err: "초대 코드 없음" }; if (!j.err) await compareRender(j); k = -1; }
  if (k === N + 2) { c = await code(true); }
  else if (k >= 0 && k < N) {
    const j = c ? await load(c) : { err: "초대 코드 없음" }; const w = build(j, ACT[k][1], ACT[k][2]);
    if (ACT[k][1] === "large") await w.presentLarge(); else if (ACT[k][1] === "medium") await w.presentMedium(); else await w.presentSmall();
  }
} else {
  const j = c ? await load(c) : { err: "초대 코드 없음" };
  Script.setWidget(build(j, config.widgetFamily || "small", args.widgetParameter));
}
Script.complete();
`;
