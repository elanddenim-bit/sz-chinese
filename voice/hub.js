// =========================================================
// 🧰 도구함 — 박비서 헤더에 아이콘이 너무 많아져서 한 화면에 모음 (GET /hub)
// =========================================================
export const HUB_HTML = String.raw`<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#1664B0">
<meta name="apple-mobile-web-app-capable" content="yes">
<link rel="apple-touch-icon" href="/icon-180.png">
<title>도구함</title>
<style>
:root{--sky:#1664B0;--bg:#EFE8DE;--card:#F7F2EA;--ink:#1A2330;--ink2:#5E6672;--line:#D9CEBD;--red:#D21624}
@media (prefers-color-scheme:dark){:root{--bg:#141A22;--card:#1C2430;--ink:#EDE6DA;--ink2:#9AA3AE;--line:#2C3644}}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,"Apple SD Gothic Neo",system-ui,sans-serif}
header{background:var(--sky);color:#fff;padding:calc(env(safe-area-inset-top) + 14px) 16px 14px;border-bottom:3px solid var(--red);display:flex;align-items:center;gap:12px}
header h1{margin:0;font-size:19px}a.back{color:#fff;text-decoration:none;font-size:20px}
main{max-width:640px;margin:0 auto;padding:14px 16px 48px}h2{font-size:13px;color:var(--ink2);margin:16px 0 8px;font-weight:600}
.g{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.g a{display:block;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;color:var(--ink);text-decoration:none}
.g a b{display:block;font-size:16px;margin-top:4px}.g a i{font-style:normal;font-size:28px}.g a small{display:block;color:var(--ink2);font-size:12.5px;margin-top:2px}
</style></head><body>
<header><a class="back" href="/" aria-label="박비서">‹</a><h1>🧰 도구함</h1></header>
<main>
<h2>읽기</h2><div class="g">
<a href="/trend"><i>🔥</i><b>오늘의 중국 인터넷</b><small>지금 뜨는 이슈·유행어</small></a>
</div>
<h2>놀기</h2><div class="g">
<a href="/quest"><i>🧭</i><b>주말 탐험</b><small>오늘 갈 곳 3곳 미션</small></a>
<a href="/mystery"><i>🕵️</i><b>광저우 미스터리</b><small>실제 장소 추리 게임</small></a>
<a href="/timecam"><i>🕰</i><b>타임머신 카메라</b><small>1930·1985·2080·눈</small></a>
<a href="/signs"><i>🪧</i><b>간판 사냥</b><small>웃긴 중국어 간판 도감</small></a>
<a href="/novel"><i>📖</i><b>우리 연재 소설</b><small>우리 기록이 한 화씩 소설로</small></a>
</div>
<h2>보기</h2><div class="g">
<a href="/usage"><i>📊</i><b>앱 사용량</b><small>내 앱들 얼마나 썼나</small></a>
</div>
</main></body></html>`;
