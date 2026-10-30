// =========================================================
// 🟨 브루탈 토큰 — 개인·공개 도구 공통 디자인(2026-10-30 소유자 '앞으로 만드는 컨셉은 이런 거')
//   네오 브루탈리즘: 크림 바탕 · 검정 2px 테두리 · 하드 오프셋 섀도 · 노랑 강조 · 주황/스칼렛 행동 버튼 · 대문자 압축 헤드라인 · 체커 띠 · 화살표
//   쓰는 법: import { BRUTAL_CSS } from "./brutal.js"; <style>${BRUTAL_CSS}</style> 뒤에 화면 고유 CSS. 글꼴은 같은 도메인 /fonts/*(CDN 금지)
//   E·LAND CI 회사 업무 도구(출장자 지원·견적·1on1 등)에는 쓰지 않음. 글이 많은 화면(기내 잡지·소설)은 헤더·버튼·칩만 브루탈.
//   역할: 노랑(--y) = 강조·표시, 주황(--o)·스칼렛(--r) = 누르는 것, 검정(--k) = 선·글자, 크림(--bg) = 바탕
// =========================================================
export const BRUTAL_CSS = String.raw`
@font-face{font-family:"BB Lilita";src:url(/fonts/lilita.woff) format("woff");font-display:swap}
@font-face{font-family:"BB BlackHan";src:url(/fonts/blackhan.woff) format("woff");font-display:swap}
@font-face{font-family:"Pretendard";src:url(/fonts/pretendard-400.woff2) format("woff2");font-weight:400;font-display:swap}
@font-face{font-family:"Pretendard";src:url(/fonts/pretendard-700.woff2) format("woff2");font-weight:700;font-display:swap}
:root{
  --bg:#EFE8DE;--bg2:#E6DCCB;--card:#F7F2EA;--k:#111111;--k2:#4A4A4A;--k3:#8A857C;
  --y:#FFC61A;--y2:#FFE066;--o:#FF7A1A;--r:#D21624;--b:#1664B0;--g:#1E9E5A;
  --bw:2px;--sh:4px;--rad:6px;--sh-c:var(--k);
  --disp:"BB Lilita","BB BlackHan","Apple SD Gothic Neo",system-ui,sans-serif;
  --head:"BB BlackHan","BB Lilita","Apple SD Gothic Neo",system-ui,sans-serif;
  --body:"Pretendard",-apple-system,"Apple SD Gothic Neo","PingFang SC",system-ui,sans-serif;
}
@media (prefers-color-scheme:dark){:root{--bg:#17150F;--bg2:#1F1C14;--card:#241F16;--k:#F2EADC;--k2:#C9C0B0;--k3:#8A8275;--y:#FFC61A;--y2:#4A3B08;--sh-c:#000;--o:#FF8A33}}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--k);font:15px/1.5 var(--body);-webkit-text-size-adjust:100%}
/* 체커 띠 — 헤더 아래·섹션 사이 */
.bz{height:10px;background:repeating-conic-gradient(var(--k) 0 25%,transparent 0 50%) 0 0/20px 20px;background-color:var(--y);border-top:var(--bw) solid var(--k);border-bottom:var(--bw) solid var(--k)}
/* 헤더 */
.bh{display:flex;align-items:center;gap:12px;padding:calc(env(safe-area-inset-top) + 12px) 16px 10px;background:var(--bg);border-bottom:var(--bw) solid var(--k)}
.bh .ttl{font:400 30px/1 var(--disp);letter-spacing:.5px;text-transform:uppercase;margin:0}
.bh .ttl.ko{font-family:var(--head);font-size:26px}
.bh .sub{font:700 11px/1 var(--body);letter-spacing:2px;text-transform:uppercase;color:var(--k2);margin-top:4px}
/* 사각 버튼(뒤로·메뉴) */
.bq{width:40px;height:40px;display:grid;place-items:center;border:var(--bw) solid var(--k);background:var(--card);color:var(--k);text-decoration:none;font:400 22px/1 var(--disp);box-shadow:var(--sh) var(--sh) 0 var(--sh-c);border-radius:var(--rad)}
.bq:active{transform:translate(2px,2px);box-shadow:2px 2px 0 var(--sh-c)}
/* 섹션 라벨: 노란 띠 + 번호 */
.bl{display:inline-flex;align-items:center;gap:8px;margin:22px 0 10px;font:400 18px/1 var(--disp);text-transform:uppercase;letter-spacing:1px}
.bl b{font-family:var(--head);font-weight:400;background:var(--y);color:#111;padding:4px 10px;border:var(--bw) solid var(--k);box-shadow:3px 3px 0 var(--sh-c)}
.bl small{font:700 11px/1 var(--body);color:var(--k3);letter-spacing:2px}
/* 카드 */
.bc{display:block;position:relative;background:var(--card);border:var(--bw) solid var(--k);border-radius:var(--rad);box-shadow:var(--sh) var(--sh) 0 var(--sh-c);color:var(--k);text-decoration:none;padding:14px}
a.bc:active{transform:translate(2px,2px);box-shadow:2px 2px 0 var(--sh-c)}
.bc.y{background:var(--y);color:#111}.bc.y small,.bc.y b,.bc.y .ar{color:#4A3B08}.bc.y b{color:#111}
.bc.k{background:var(--k);color:var(--bg)}.bc.k small{color:var(--k3)}
/* 버튼 */
.bb{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:10px 16px;border:var(--bw) solid var(--k);border-radius:var(--rad);background:var(--card);color:var(--k);font:700 15px/1 var(--body);box-shadow:var(--sh) var(--sh) 0 var(--sh-c);cursor:pointer;text-decoration:none;-webkit-tap-highlight-color:transparent}
.bb.o{background:var(--o);color:#111}.bb.r{background:var(--r);color:#fff}.bb.y{background:var(--y);color:#111}.bb.k{background:var(--k);color:var(--bg)}
.bb:active{transform:translate(2px,2px);box-shadow:2px 2px 0 var(--sh-c)}
.bb[disabled]{opacity:.45;box-shadow:none;transform:none}
/* 칩 */
.bp{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border:var(--bw) solid var(--k);border-radius:999px;background:var(--card);font:700 12.5px/1 var(--body);color:var(--k)}
.bp.on{background:var(--k);color:var(--bg)}.bp.y{background:var(--y);color:#111}
/* 화살표·꼬리표 */
.ar{font-family:var(--disp);font-size:22px;line-height:1}
.tag{position:absolute;top:-10px;right:10px;background:var(--o);color:#111;border:var(--bw) solid var(--k);font:700 10.5px/1 var(--body);letter-spacing:1px;text-transform:uppercase;padding:3px 7px;transform:rotate(2deg)}
/* 큰 숫자 */
.num{font:400 44px/1 var(--disp);letter-spacing:-1px}
hr.bz{border:0;margin:0}
`;
