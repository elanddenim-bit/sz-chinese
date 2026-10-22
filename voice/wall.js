// 📱 잠금화면(2026-10-23 소유자 '어제 틀린 것·반복할 것·오늘 쓸 문장을 아이폰 대기화면에')
// 그림은 실전 중국어 앱이 폰에서 캔버스로 그림(시스템 글꼴 그대로) → POST /wall/put 으로 R2 wall/<해시>.jpg 에 하나만 보관.
// 아이폰 단축어 자동화(매일 아침): GET /wall/img?h&s(HMAC) → '배경화면 설정'(잠금 화면).
async function hmac16(env, s) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode("wall|" + (env.ALLOWED_CODES || "") + (env.DASHSCOPE_API_KEY || "")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(s));
  return [...new Uint8Array(sig)].slice(0, 8).map((x) => x.toString(16).padStart(2, "0")).join("");
}
const werr = (message, status = 400) => Object.assign(new Error(message), { code: "wall", status });

export async function wallApi(env, path, b, h, origin) {
  const url = origin + "/wall/img?h=" + h + "&s=" + (await hmac16(env, h));
  if (path === "/wall/url") {
    const m = await env.R2.head("wall/" + h + ".jpg");
    return { url, at: m ? m.uploaded : null };
  }
  if (path === "/wall/put") {
    const s = String(b.img || "").replace(/^data:image\/\w+;base64,/, "");
    if (!s || s.length > 6e6) throw werr("그림이 없거나 너무 큽니다.");
    const bin = atob(s), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    if (u8[0] !== 0xff || u8[1] !== 0xd8) throw werr("JPEG 가 아닙니다.");
    await env.R2.put("wall/" + h + ".jpg", u8, { httpMetadata: { contentType: "image/jpeg" }, customMetadata: { d: String(b.d || "").slice(0, 10) } });
    return { ok: true, url, bytes: u8.length };
  }
  throw werr("없는 경로", 404);
}

export async function wallGet(env, url) {
  const h = url.searchParams.get("h") || "", s = url.searchParams.get("s") || "";
  if (!/^[0-9a-f]{8,64}$/.test(h) || s !== (await hmac16(env, h))) return new Response("bad sig", { status: 403 });
  const o = await env.R2.get("wall/" + h + ".jpg");
  if (!o) return new Response("아직 잠금화면 그림이 없습니다 — 실전 중국어 앱을 한 번 열어 주세요.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  return new Response(o.body, { headers: { "content-type": "image/jpeg", "cache-control": "no-store" } });
}
