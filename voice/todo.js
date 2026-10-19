// 📅 데일리 업무 체크(To-Do-List 저장소) 일정 → 아이폰·네이버가 구독하는 live ICS 피드 (2026-10-19)
//  GET /todo/ics?k=<공간 코드>  → text/calendar. 앱이 '전체 캘린더 등록(.ics)' 로 내려 주던 정적 파일은 한 번 가져오기라
//  삭제·추가가 폰에 반영되지 않던 문제 → 구독 주소로 바꿔 아이폰 '가져오기 15분' 주기로 자동 동기화.
//  Supabase 는 To-Do-List 앱과 같은 공개키 + x-ws 헤더(RLS 가 그 행만 허용). 공간 코드는 URL 에만 있고 저장하지 않음.
const SUPA_URL = "https://emoblnrvyqezitvymwbr.supabase.co";
const SUPA_KEY = "sb_publishable_vA-lhwZUr9FS-2YGrQHNFA_I1ixtCmk";
const PRI = { high: "🔴 ", mid: "🟡 ", low: "" };

function esc(t) { return String(t || "").replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); }
function fold(line) { // RFC5545 75옥텟 접기(UTF-8 기준 대략)
  const out = []; let cur = "";
  for (const ch of line) { if (new TextEncoder().encode(cur + ch).length > 72) { out.push(cur); cur = " " + ch; } else cur += ch; }
  out.push(cur); return out.join("\r\n");
}
function nextDay(d) { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); }
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function todoIcs(url) {
  const k = String(url.searchParams.get("k") || "").trim();
  if (k.length < 10 || k.length > 80 || !/^[\w-]+$/.test(k)) return new Response("bad key", { status: 400 });
  const r = await fetch(SUPA_URL + "/rest/v1/workdata?id=eq." + encodeURIComponent(k) + "&select=data", {
    headers: { apikey: SUPA_KEY, authorization: "Bearer " + SUPA_KEY, "x-ws": k }, cf: { cacheTtl: 0 } });
  if (!r.ok) return new Response("upstream " + r.status, { status: 502 });
  const rows = await r.json().catch(() => []);
  const db = (rows[0] && rows[0].data) || null;
  if (!db) return new Response("not found", { status: 404 });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ELAND GZ//DailyWorkCheck Live//KO", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:업무 일정", "X-WR-TIMEZONE:Asia/Shanghai", "REFRESH-INTERVAL;VALUE=DURATION:PT15M", "X-PUBLISHED-TTL:PT15M"];
  const ev = (uid, body) => { L.push("BEGIN:VEVENT", "UID:" + uid + "@eland-dailywork", "DTSTAMP:" + stamp); body.forEach((x) => L.push(fold(x))); L.push("END:VEVENT"); };
  // 일정(종일, 기간)
  for (const s of db.sched || []) {
    if (!DATE_RE.test(s.start || "") || !DATE_RE.test(s.end || "")) continue;
    ev(s.id, ["DTSTART;VALUE=DATE:" + s.start.replace(/-/g, ""), "DTEND;VALUE=DATE:" + nextDay(s.end).replace(/-/g, ""), "SUMMARY:" + esc(s.title)]);
  }
  // 시각이 있는 TO-DO(30분 블록, 완료는 ✓) — 최근 60일 ~ 앞 60일만
  const now = Date.now(), lo = new Date(now - 60 * 86400e3).toISOString().slice(0, 10), hi = new Date(now + 60 * 86400e3).toISOString().slice(0, 10);
  for (const [d, day] of Object.entries(db.days || {})) {
    if (!DATE_RE.test(d) || d < lo || d > hi) continue;
    for (const t of (day && day.todos) || []) {
      if (!t || !/^\d{1,2}:\d{2}$/.test(t.time || "")) continue;
      const [h, m] = t.time.split(":").map(Number); if (h > 23 || m > 59) continue;
      const st = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8), h - 8, m)); // 중국 시각 → UTC
      const en = new Date(st.getTime() + 30 * 60e3);
      const z = (x) => x.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
      ev("todo-" + t.id, ["DTSTART:" + z(st), "DTEND:" + z(en), "SUMMARY:" + esc((t.done ? "✓ " : (PRI[t.priority] || "")) + t.text)]
        .concat(t.doneNote ? ["DESCRIPTION:" + esc(t.doneNote)] : []));
    }
  }
  L.push("END:VCALENDAR");
  return new Response(L.join("\r\n") + "\r\n", { headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "no-store", "content-disposition": "inline; filename=\"work.ics\"" } });
}
