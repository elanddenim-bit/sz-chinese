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
import { barkPush } from "./brief.js";
import { APPS, OWNER_SCOPED, study as studyDays, logUse } from "./usage.js";

const TZ = 8 * 3600e3;
const cnDay = (t = Date.now()) => new Date(t + TZ).toISOString().slice(0, 10);
const cnHour = (t) => new Date(t + TZ).getUTCHours();
const merr = (message, status = 400) => Object.assign(new Error(message), { code: "me", status });
const KEY = (h) => "me:" + h;
const DEF = { on: true, wday: 0, hour: 19, team: true, mh: 9, suwon: true, t1: true };
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
  const st = Number(v.steps), sl = sleepMin(v.sleep);
  let ok = false;
  if (isFinite(st) && st >= 0 && st < 200000 && v.steps !== undefined && v.steps !== "") { cur.st = Math.round(st); ok = true; }
  if (sl != null) { cur.sl = sl; ok = true; }
  if (ok) { cur.at = Date.now(); d.health[day] = cur; }
  return ok;
}

// ---------- GitHub 커밋 ----------
async function ghFetch(env, d, force) {
  const g = d.gh || {};
  if (!force && g.at && Date.now() - g.at < 3 * 3600e3) return g;
  const H = { "user-agent": "sz-voice-me", accept: "application/vnd.github+json" };
  if (env.GITHUB_TOKEN) H.authorization = "Bearer " + env.GITHUB_TOKEN;
  const org = env.GH_ORG || "elanddenim-bit";
  const since = Date.now() - 15 * 864e5;
  const out = { at: Date.now(), days: g.days || {}, repos: 0, priv: !!env.GITHUB_TOKEN, err: "" };
  try {
    const r = await fetch(`https://api.github.com/orgs/${org}/repos?per_page=100&sort=pushed${env.GITHUB_TOKEN ? "&type=all" : ""}`, { headers: H });
    if (!r.ok) throw new Error("저장소 목록 " + r.status + (r.status === 403 ? " (요청 한도)" : ""));
    const repos = (await r.json()).filter((x) => Date.parse(x.pushed_at) > since).map((x) => x.name).slice(0, 18);
    out.repos = repos.length;
    const fresh = {};
    for (const name of repos) {
      const cr = await fetch(`https://api.github.com/repos/${org}/${name}/commits?per_page=100&since=${new Date(since).toISOString()}`, { headers: H });
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
  } catch (e) { out.err = String(e.message || e).slice(0, 120); if (g.at) { out.at = g.at; } }
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
  const rows = dayList(today, 14).reverse().map((x) => ({ d: x, wd: WD[new Date(x + "T00:00:00Z").getUTCDay()], sl: d.health[x] && d.health[x].sl, st: d.health[x] && d.health[x].st, gh: (d.gh.days || {})[x] || null, study: d.study[x] ? d.study[x].min : null, apps: Object.keys(use[x] || {}).length }));
  return { week: w, prev: p, idle, notes: notes(w, p, idle), rows };
}
function weekText(s) {
  const w = s.week, L = [];
  L.push(w.sleep.n ? `😴 수면 평균 ${hm(w.sleep.avg)}${w.sleep.under6 ? ` · 6시간 미만 ${w.sleep.under6}일` : ""}` : "😴 수면 기록 없음");
  if (w.steps.n) L.push(`🚶 걸음 평균 ${w.steps.avg.toLocaleString()}보`);
  L.push(`💻 커밋 ${w.gh.commits}건 · 자정 넘어 ${w.gh.lateDays}일`);
  L.push(`🧰 쓴 도구 ${w.apps.length}개 · 2주 안 연 도구 ${s.idle.length}개`);
  if (w.study.min) L.push(`🀄 중국어 ${w.study.min}분 (${w.study.days}일)`);
  return L.join("\n");
}

// ---------- 팀: 수원삼성(TheSportsDB) ----------
const KR = [["Suwon Samsung", "수원삼성"], ["Suwon FC", "수원FC"], ["Seoul E-Land", "서울이랜드"], ["Busan", "부산"], ["Jeonnam", "전남"], ["Bucheon", "부천"], ["Seongnam", "성남"], ["Ansan", "안산"], ["Gimpo", "김포"], ["Asan", "충남아산"], ["Cheonan", "천안"], ["Gyeongnam", "경남"], ["Hwaseong", "화성"], ["Paju", "파주"], ["Gimhae", "김해"], ["Yongin", "용인"], ["Cheongju", "충북청주"], ["Incheon", "인천"], ["Daegu", "대구"], ["Jeju", "제주"], ["Jeonbuk", "전북"], ["Ulsan", "울산"], ["Pohang", "포항"], ["Gangwon", "강원"], ["Daejeon", "대전"], ["Gwangju", "광주"], ["Gimcheon", "김천"], ["Anyang", "안양"], ["FC Seoul", "서울"]];
const kr = (n) => { const x = KR.find(([e]) => String(n || "").includes(e)); return x ? x[1] : String(n || ""); };
async function tsdb(path) {
  for (const k of ["3", "123"]) {
    try {
      const r = await fetch(`https://www.thesportsdb.com/api/v1/json/${k}/${path}`, { headers: { "user-agent": "sz-voice-me" } });
      if (!r.ok) continue;
      const j = await r.json().catch(() => null);
      if (j) return j;
    } catch {}
  }
  return null;
}
function fbEv(e) {
  const t = Date.parse(e.strTimestamp ? (e.strTimestamp.endsWith("Z") || /[+-]\d\d:?\d\d$/.test(e.strTimestamp) ? e.strTimestamp : e.strTimestamp + "Z") : (e.dateEvent + "T" + (e.strTime || "00:00:00").slice(0, 8) + "Z"));
  const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
  return { id: String(e.idEvent), t: t || 0, home: e.strHomeTeam, away: e.strAwayTeam, hid: String(e.idHomeTeam || ""), hs: num(e.intHomeScore), as: num(e.intAwayScore), st: e.strStatus || "", lg: e.strLeague || "", round: e.intRound || "" };
}
async function fbFetch(prev) {
  const o = { id: prev && prev.id, lg: prev && prev.lg, ev: [], err: "" };
  try {
    if (!o.id) {
      const j = await tsdb("searchteams.php?t=" + encodeURIComponent("Suwon Samsung"));
      const t = ((j && j.teams) || []).find((x) => /samsung/i.test(x.strTeam) || /bluewings/i.test(x.strTeamAlternate || "")) || null;
      if (!t) throw new Error("수원삼성 팀을 못 찾음");
      o.id = String(t.idTeam); o.lg = String(t.idLeague || "");
    }
    const all = new Map();
    const add = (list) => { for (const e of list || []) if (e && e.idEvent) all.set(String(e.idEvent), fbEv(e)); };
    const [nx, ls] = await Promise.all([tsdb("eventsnext.php?id=" + o.id), tsdb("eventslast.php?id=" + o.id)]);
    add(nx && nx.events); add(ls && ls.results);
    if (o.lg) { const yr = new Date(Date.now() + TZ).getUTCFullYear(); const s = await tsdb(`eventsseason.php?id=${o.lg}&s=${yr}`); add(((s && s.events) || []).filter((e) => String(e.idHomeTeam) === o.id || String(e.idAwayTeam) === o.id)); }
    const lo = Date.now() - 30 * 864e5, hi = Date.now() + 60 * 864e5;
    o.ev = [...all.values()].filter((e) => e.t > lo && e.t < hi).sort((a, b) => a.t - b.t);
    if (!o.ev.length) o.err = "가까운 경기 정보 없음";
  } catch (e) { o.err = String(e.message || e).slice(0, 100); if (prev && prev.ev) o.ev = prev.ev; }
  return o;
}
const fbDone = (e) => e.hs != null && e.as != null && (/FT|Finish|AET|PEN|AP/i.test(e.st) || Date.now() - e.t > 3 * 3600e3);
function fbLine(e, id) {
  const home = e.hid === id;
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
    if (!o.ev.length) o.err = "가까운 T1 경기 없음(비시즌일 수 있음)";
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
    suwon: { on: d.cfg.suwon, err: fb.err || "", past: f.past.map((e) => ({ t: e.t, line: fbLine(e, fb.id) })), next: f.next.map((e) => ({ t: e.t, line: fbLine(e, fb.id) })) },
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
  // 팀
  if (d.cfg.team && (d.cfg.suwon || d.cfg.t1)) {
    if (await teamsFetch(d, false)) dirty = true;
    const lines = [];
    // 결과
    if (d.cfg.suwon && d.teams.fb) for (const e of d.teams.fb.ev || []) {
      const k = "fb:" + e.id;
      if (d.sent.team[k] || !fbDone(e) || Date.now() - e.t > 24 * 3600e3) continue;
      d.sent.team[k] = today; dirty = true; lines.push(fbLine(e, d.teams.fb.id));
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
export async function meApi(env, path, b, h) {
  await owner(env, h);
  const d = await load(env, h);
  const code = String(b.code || "").trim();
  if (path === "/me/health") {
    let n = 0;
    if (b.days && typeof b.days === "object") for (const [k, v] of Object.entries(b.days).slice(0, 31)) if (v && putHealth(d, k, v)) n++;
    if (b.steps !== undefined || b.sleep !== undefined) if (putHealth(d, /^\d{4}-\d{2}-\d{2}$/.test(b.d || "") ? b.d : cnDay(), b)) n++;
    const sd = await studyDays(code); if (sd) { for (const [k, v] of Object.entries(sd)) if (k >= cnDay(Date.now() - 40 * 864e5)) d.study[k] = { min: v.min, n: v.n }; }
    await save(env, h, d);
    await logUse(env, "me", { health: 1 }, 0);
    const t = d.health[cnDay()] || {};
    return { ok: true, saved: n, msg: n ? `받았어요 · 오늘 ${t.sl ? hm(t.sl) : "수면 없음"} · ${t.st != null ? t.st.toLocaleString() + "보" : "걸음 없음"}` : "숫자가 없어요(steps·sleep)" };
  }
  if (path === "/me/cfg") {
    const c = d.cfg;
    for (const k of ["on", "team", "suwon", "t1"]) if (typeof b[k] === "boolean") c[k] = b[k];
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
.two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px}.two>*{min-width:0}input[type=date]{-webkit-appearance:none;appearance:none;min-width:0;display:block;min-height:46px;text-align:left}
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
  S=j;var w=j.week,p=j.prev,h='';
  h+='<h2>이번 주 · '+w.from.slice(5).replace('-','/')+' ~ '+w.to.slice(5).replace('-','/')+'</h2><div class="card">';
  h+=j.notes.map(function(n){return '<div class="note"><i class="dot '+n.lv+'"></i><span>'+esc(n.t)+'</span></div>'}).join('');
  h+='</div><div class="card"><div class="grid">';
  h+='<div><div class="k">😴 수면 평균 ('+w.sleep.n+'일 기록)</div><div class="v">'+hm(w.sleep.avg)+'</div>'+diff(w.sleep.avg,p.sleep.avg,'분','up')+'</div>';
  h+='<div><div class="k">🚶 걸음 평균</div><div class="v">'+num(w.steps.avg)+'<small> 보</small></div>'+diff(w.steps.avg,p.steps.avg,'보','up')+'</div>';
  h+='<div><div class="k">💻 커밋 · 자정 넘어</div><div class="v">'+w.gh.commits+'<small> 건 · </small>'+w.gh.lateDays+'<small> 일</small></div>'+(w.gh.latest?'<span class="d">가장 늦게 '+clock(w.gh.latest)+'</span>':'')+'</div>';
  h+='<div><div class="k">🀄 중국어 공부</div><div class="v">'+w.study.min+'<small> 분 · '+w.study.days+'일</small></div>'+diff(w.study.min,p.study.min,'분','up')+'</div>';
  h+='</div></div>';
  // 날짜별
  h+='<h2>최근 14일</h2><div class="card" style="overflow-x:auto"><table><tr><th>날짜</th><th class="n">수면</th><th class="n">걸음</th><th class="n">커밋</th><th class="n">마지막</th><th class="n">중국어</th></tr>';
  h+=j.rows.map(function(r){var g=r.gh||{};return '<tr><td>'+r.d.slice(5).replace('-','/')+' '+r.wd+'</td><td class="n">'+(r.sl?hm(r.sl):'—')+'</td><td class="n">'+num(r.st)+'</td><td class="n">'+(g.n||'—')+'</td><td class="n'+(g.late?' late':'')+'">'+(g.last?clock(g.last):'')+'</td><td class="n">'+(r.study?r.study+'분':'—')+'</td></tr>'}).join('');
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
  h+='<p class="hint">시각은 중국 시각 · '+ago(t.at)+' 받음 · 경기 날 아침 '+j.cfg.mh+'시에 오늘 경기, 끝나면 결과를 아이폰으로 보내요.</p></div>';
  // 건강 기록
  h+='<h2>건강 기록</h2><div class="card"><div class="k">마지막으로 받은 때: '+ago(j.healthAt)+'</div>';
  h+='<div class="two"><div><label for="hd">날짜</label><input id="hd" type="date" value="'+j.today+'"></div><div><label for="hs">잔 시간(시간)</label><input id="hs" inputmode="decimal" placeholder="예: 6.5"></div></div><label for="hp">걸음</label><input id="hp" inputmode="numeric" placeholder="예: 7200"><button class="btn s" id="hsave">직접 넣기</button>';
  h+='<details style="margin-top:14px"><summary>아이폰 단축어 연결 (매일 밤 자동)</summary><ol>';
  h+='<li>단축어 앱 → 자동화 → <b>특정 시간</b> 매일 22:30 → <b>즉시 실행</b></li>';
  h+='<li><b>건강 샘플 찾기</b>: 걸음, 시작일 <b>오늘</b> → <b>통계 계산</b> 합계 → 변수 이름 <code>걸음</code></li>';
  h+='<li><b>건강 샘플 찾기</b>: 수면 분석, 시작일 <b>지난 1일</b>, 값 <b>수면 중</b>(코어·깊은·REM 모두) → <b>건강 샘플 세부사항 가져오기</b> 지속 시간 → <b>통계 계산</b> 합계 → 변수 <code>수면</code></li>';
  h+='<li><b>URL 콘텐츠 가져오기</b>: <code>https://voice.zhnote.net/me/health</code> · 방법 POST · 본문 JSON — <code>code</code>(초대 코드), <code>steps</code>=걸음, <code>sleep</code>=수면</li>';
  h+='</ol><p class="hint">수면 단위는 시간·분·초 어떤 것이든 서버가 알아서 맞춰요. 한 번 실행해 보고 위 \'마지막으로 받은 때\'가 바뀌면 연결된 거예요.</p></details></div>';
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
  $('t_w').onclick=function(){api('/me/test',{what:'week'}).then(function(r){toast(r.msg)}).catch(function(e){toast(e.message)})};
  $('t_t').onclick=function(){api('/me/test',{what:'team'}).then(function(r){toast(r.msg);load()}).catch(function(e){toast(e.message)})};
  if(location.hash==='#teams'){var el=$('teams');if(el)el.scrollIntoView()}
}
$('rf').onclick=function(){load(true)};
try{navigator.sendBeacon('/u',JSON.stringify({app:'me',c:{open:1}}))}catch(e){}
load();
</script></body></html>`;
