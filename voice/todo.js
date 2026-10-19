// 📅 데일리 업무 체크(To-Do-List 저장소) ↔ 캘린더 (2026-10-19)
//  ① GET /todo/ics?k=<공간 코드> → live ICS(아이폰 구독용)
//  ② POST /todo/sync {k} / POST /todo/status {k} / 크론 todoCron — 네이버 캘린더에 CalDAV 로 직접 추가·수정·삭제(네이버 위젯용, 소유자 선택 B)
//     시크릿 NAVER_ID·NAVER_PW(2단계 인증 켜면 앱 비밀번호), 선택 NAVER_CAL(캘린더 이름, 기본 '업무 일정' — 네이버 웹에서 먼저 만들어 둠).
//     네이버 '해외 로그인 차단'은 꺼져 있어야 함(Cloudflare 는 해외). 공간 코드는 KV todo:ws 에(크론이 쓰려고), 진행 상태 KV todo:sync {map{uid:해시}, cal, at, ok, err}.
//     서버 → 네이버 한 방향. 관리 대상 UID 는 *@eland-dailywork 뿐이라 다른 일정은 건드리지 않음. 한 번에 최대 40건(무료 플랜 서브리퀘스트 50), 남으면 다음 호출·크론.
const SUPA_URL = "https://emoblnrvyqezitvymwbr.supabase.co";
const SUPA_KEY = "sb_publishable_vA-lhwZUr9FS-2YGrQHNFA_I1ixtCmk";
const CALDAV = "https://caldav.calendar.naver.com";
const PRI = { high: "🔴 ", mid: "🟡 ", low: "" };
const MAX_OPS = 40;

function esc(t) { return String(t || "").replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); }
function fold(line) { // RFC5545 75옥텟 접기
  const out = []; let cur = "";
  for (const ch of line) { if (new TextEncoder().encode(cur + ch).length > 72) { out.push(cur); cur = " " + ch; } else cur += ch; }
  out.push(cur); return out.join("\r\n");
}
function nextDay(d) { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); }
function fnv(s) { let h = 0x811c9dc5; for (const c of new TextEncoder().encode(s)) { h ^= c; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, "0"); }
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const okKey = (k) => k.length >= 10 && k.length <= 80 && /^[\w-]+$/.test(k);

async function loadDb(k) {
  const r = await fetch(SUPA_URL + "/rest/v1/workdata?id=eq." + encodeURIComponent(k) + "&select=data", {
    headers: { apikey: SUPA_KEY, authorization: "Bearer " + SUPA_KEY, "x-ws": k }, cf: { cacheTtl: 0 } });
  if (!r.ok) throw new Error("supabase " + r.status);
  const rows = await r.json().catch(() => []);
  return (rows[0] && rows[0].data) || null;
}

// DB → 이벤트 목록 [{uid, lines[]}] (일정 종일·기간 + 시각 있는 TO-DO 30분 블록, ±60일)
function buildEvents(db) {
  const ev = [];
  for (const s of db.sched || []) {
    if (!s || !DATE_RE.test(s.start || "") || !DATE_RE.test(s.end || "")) continue;
    ev.push({ uid: s.id + "@eland-dailywork", lines: ["DTSTART;VALUE=DATE:" + s.start.replace(/-/g, ""), "DTEND;VALUE=DATE:" + nextDay(s.end).replace(/-/g, ""), "SUMMARY:" + esc(s.title)] });
  }
  const now = Date.now(), lo = new Date(now - 60 * 86400e3).toISOString().slice(0, 10), hi = new Date(now + 60 * 86400e3).toISOString().slice(0, 10);
  for (const [d, day] of Object.entries(db.days || {})) {
    if (!DATE_RE.test(d) || d < lo || d > hi) continue;
    for (const t of (day && day.todos) || []) {
      if (!t || !/^\d{1,2}:\d{2}$/.test(t.time || "")) continue;
      const [h, m] = t.time.split(":").map(Number); if (h > 23 || m > 59) continue;
      const st = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8), h - 8, m)); // 중국 시각 → UTC
      const z = (x) => x.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
      const lines = ["DTSTART:" + z(st), "DTEND:" + z(new Date(st.getTime() + 30 * 60e3)), "SUMMARY:" + esc((t.done ? "✓ " : (PRI[t.priority] || "")) + t.text)];
      if (t.doneNote) lines.push("DESCRIPTION:" + esc(t.doneNote));
      ev.push({ uid: "todo-" + t.id + "@eland-dailywork", lines });
    }
  }
  return ev;
}
function vevent(e, stamp) { return ["BEGIN:VEVENT", "UID:" + e.uid, "DTSTAMP:" + stamp].concat(e.lines.map(fold)).concat(["END:VEVENT"]); }
const STAMP = () => new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

export async function todoIcs(url) {
  const k = String(url.searchParams.get("k") || "").trim();
  if (!okKey(k)) return new Response("bad key", { status: 400 });
  let db; try { db = await loadDb(k); } catch (e) { return new Response(e.message, { status: 502 }); }
  if (!db) return new Response("not found", { status: 404 });
  const stamp = STAMP();
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ELAND GZ//DailyWorkCheck Live//KO", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:업무 일정", "X-WR-TIMEZONE:Asia/Shanghai", "REFRESH-INTERVAL;VALUE=DURATION:PT15M", "X-PUBLISHED-TTL:PT15M"];
  for (const e of buildEvents(db)) L.push(...vevent(e, stamp));
  L.push("END:VCALENDAR");
  return new Response(L.join("\r\n") + "\r\n", { headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "no-store", "content-disposition": "inline; filename=\"work.ics\"" } });
}

/* ---------- CalDAV(네이버) ---------- */
function auth(env) { return "Basic " + btoa(env.NAVER_ID + ":" + env.NAVER_PW); }
async function dav(env, method, url, headers, body) {
  const r = await fetch(url, { method, headers: Object.assign({ authorization: auth(env), "user-agent": "sz-voice-todo/1.0" }, headers || {}), body });
  const text = await r.text().catch(() => "");
  return { status: r.status, text, etag: r.headers.get("etag") };
}
const abs = (href) => (href.startsWith("http") ? href : CALDAV + href);
function pick(xml, tag) { const m = xml.match(new RegExp("<(?:[\\w-]+:)?" + tag + "[^>]*>\\s*<(?:[\\w-]+:)?href[^>]*>([^<]+)<", "i")); return m ? m[1].trim() : ""; }
function responses(xml) { return xml.split(/<(?:[\w-]+:)?response[\s>]/i).slice(1); }

async function discover(env) {
  const name = (env.NAVER_CAL || "업무 일정").trim();
  const P = (url, depth, body) => dav(env, "PROPFIND", url, { depth: String(depth), "content-type": "application/xml; charset=utf-8" }, body);
  let r = await P(CALDAV + "/", 0, '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>');
  if (r.status === 401) throw new Error("네이버 로그인 실패(401) — NAVER_ID/NAVER_PW 또는 해외 로그인 차단 확인");
  if (r.status >= 400 && r.status !== 207) throw new Error("CalDAV 루트 " + r.status);
  const principal = pick(r.text, "current-user-principal");
  if (!principal) throw new Error("principal 을 찾지 못함: " + r.text.slice(0, 200));
  r = await P(abs(principal), 0, '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>');
  const home = pick(r.text, "calendar-home-set");
  if (!home) throw new Error("calendar-home 을 찾지 못함: " + r.text.slice(0, 200));
  r = await P(abs(home), 1, '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:displayname/><d:resourcetype/><d:current-user-privilege-set/></d:prop></d:propfind>');
  const cals = [];
  for (const x of responses(r.text)) {
    const href = (x.match(/<(?:[\w-]+:)?href[^>]*>([^<]+)</i) || [])[1];
    if (!href || !/<(?:[\w-]+:)?calendar\s*\/?>/i.test(x)) continue;
    const dn = (x.match(/<(?:[\w-]+:)?displayname[^>]*>([^<]*)</i) || [])[1] || "";
    const ro = /current-user-privilege-set/i.test(x) && !/<(?:[\w-]+:)?write(?:-content)?\s*\/?>/i.test(x);
    cals.push({ href: href.trim(), name: dn.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim(), ro });
  }
  const hit = cals.find((c) => c.name === name) || cals.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (hit) return { href: abs(hit.href).replace(/\/?$/, "/"), name: hit.name, cals: cals.map((c) => c.name) };
  // 없으면 만들어 봄(네이버가 MKCALENDAR 를 막으면 안내)
  const slug = "work-" + Date.now().toString(36);
  const mk = await dav(env, "MKCALENDAR", abs(home).replace(/\/?$/, "/") + slug + "/", { "content-type": "application/xml; charset=utf-8" },
    '<?xml version="1.0"?><c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:set><d:prop><d:displayname>' + name.replace(/[<&]/g, "") + '</d:displayname></d:prop></d:set></c:mkcalendar>');
  if (mk.status === 201) return { href: abs(home).replace(/\/?$/, "/") + slug + "/", name, cals: cals.map((c) => c.name).concat(name) };
  throw new Error("네이버에 '" + name + "' 캘린더가 없어요. 네이버 캘린더 웹에서 그 이름으로 캘린더를 하나 만들어 주세요. (있는 캘린더: " + cals.map((c) => c.name).join(", ") + ")");
}

const SYNC_KEY = "todo:sync";
async function syncDoc(env) { return (await env.KV.get(SYNC_KEY, "json")) || { map: {}, cal: null }; }

// 한 번 실행: 바뀐 것만 PUT, 없어진 것만 DELETE. 반환 {ok, left, put, del, n, err}
export async function todoSync(env, k, force) {
  if (!env.NAVER_ID || !env.NAVER_PW) return { ok: false, err: "서버에 NAVER_ID·NAVER_PW 시크릿이 없어요", noauth: true };
  const doc = await syncDoc(env);
  const save = async () => { doc.at = Date.now(); await env.KV.put(SYNC_KEY, JSON.stringify(doc)); };
  try {
    const db = await loadDb(k); if (!db) throw new Error("공간 코드에 데이터가 없어요");
    await env.KV.put("todo:ws", k);
    const want = {}; for (const e of buildEvents(db)) want[e.uid] = { e, h: fnv(e.lines.join("\n")) };
    const puts = Object.keys(want).filter((u) => force || doc.map[u] !== want[u].h);
    const dels = Object.keys(doc.map).filter((u) => !want[u]);
    doc.n = Object.keys(want).length;
    if (!puts.length && !dels.length) { doc.ok = true; doc.err = ""; await save(); return { ok: true, left: 0, put: 0, del: 0, n: doc.n, cal: doc.cal && doc.cal.name, at: doc.at }; }
    if (!doc.cal) doc.cal = await discover(env);
    let put = 0, del = 0, ops = 0, lastErr = "";
    const stamp = STAMP();
    for (const u of puts) {
      if (ops >= MAX_OPS) break; ops++;
      const body = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ELAND GZ//DailyWorkCheck//KO"].concat(vevent(want[u].e, stamp), ["END:VCALENDAR"]).join("\r\n") + "\r\n";
      const r = await dav(env, "PUT", doc.cal.href + encodeURIComponent(u) + ".ics", { "content-type": "text/calendar; charset=utf-8" }, body);
      if (r.status === 404 && !lastErr) { doc.cal = null; lastErr = "캘린더 경로가 바뀜 — 다시 시도"; break; }
      if (r.status >= 200 && r.status < 300) { doc.map[u] = want[u].h; put++; } else lastErr = "PUT " + r.status + " " + r.text.slice(0, 120);
    }
    for (const u of dels) {
      if (ops >= MAX_OPS) break; ops++;
      const r = await dav(env, "DELETE", doc.cal ? doc.cal.href + encodeURIComponent(u) + ".ics" : CALDAV, {});
      if ((r.status >= 200 && r.status < 300) || r.status === 404) { delete doc.map[u]; del++; } else lastErr = "DELETE " + r.status;
    }
    const left = Object.keys(want).filter((u) => doc.map[u] !== want[u].h).length + Object.keys(doc.map).filter((u) => !want[u]).length;
    doc.ok = !lastErr; doc.err = lastErr; doc.left = left; await save();
    return { ok: !lastErr, left, put, del, n: doc.n, cal: doc.cal && doc.cal.name, err: lastErr, at: doc.at };
  } catch (e) {
    doc.ok = false; doc.err = e.message; await save();
    return { ok: false, err: e.message, at: doc.at };
  }
}

export async function todoApi(env, path, b) {
  const k = String((b && b.k) || "").trim();
  if (!okKey(k)) return { error: "bad_key" };
  if (path === "/todo/sync") return todoSync(env, k, !!b.force);
  if (path === "/todo/status") {
    const doc = await syncDoc(env);
    return { ok: !!doc.ok, at: doc.at || 0, n: doc.n || 0, left: doc.left || 0, err: doc.err || "", cal: doc.cal && doc.cal.name, configured: !!(env.NAVER_ID && env.NAVER_PW), bound: (await env.KV.get("todo:ws")) === k };
  }
  if (path === "/todo/reset") { await env.KV.delete(SYNC_KEY); return { ok: true }; } // 캘린더를 바꿨을 때 전부 다시 올리기
  return { error: "not_found" };
}

// 크론(*/15): 앱이 저장 직후 동기화를 못 했을 때(앱 꺼짐·네트워크) 보정. 바뀐 게 없으면 Supabase 1회 읽기로 끝.
export async function todoCron(env) {
  if (!env.NAVER_ID || !env.NAVER_PW) return;
  const k = await env.KV.get("todo:ws"); if (!k) return;
  await todoSync(env, k, false);
}
