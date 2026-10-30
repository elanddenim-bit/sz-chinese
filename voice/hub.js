// =========================================================
// 🧰 도구함 — 박비서 헤더에 아이콘이 너무 많아져서 한 화면에 모음 (GET /hub)
//   2026-10-30 브루탈 토큰(brutal.js) 첫 적용 — 크림·검정 테두리·하드 섀도·노란 섹션 띠·체커 띠
// =========================================================
import { BRUTAL_CSS } from "./brutal.js";

const CARD = (href, icon, name, desc, cls = "") =>
  `<a class="bc${cls ? " " + cls : ""}" href="${href}"><i>${icon}</i><b>${name}</b><small>${desc}</small><span class="ar">→</span></a>`;

const SEC = (n, en, ko, cards) =>
  `<div class="bl"><b>${n}</b>${en}<small>${ko}</small></div><div class="g">${cards.join("")}</div>`;

const PAGE = String.raw`<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#EFE8DE">
<meta name="apple-mobile-web-app-capable" content="yes">
<link rel="apple-touch-icon" href="/icon-180.png">
<title>도구함</title>
<style>${BRUTAL_CSS}
main{max-width:640px;margin:0 auto;padding:6px 16px 56px}
.g{display:grid;grid-template-columns:1fr 1fr;gap:14px 12px;padding-right:4px}
.g .bc{padding:12px 12px 12px;min-height:118px;display:flex;flex-direction:column}
.g .bc i{font-style:normal;font-size:28px;line-height:1}
.g .bc b{display:block;font:400 17px/1.15 var(--head);margin-top:8px;letter-spacing:.2px}
.g .bc small{display:block;color:var(--k2);font-size:12px;line-height:1.4;margin-top:4px;flex:1}
.g .bc .ar{position:absolute;right:10px;top:10px;color:var(--k)}
.g .bc.y b{color:#111}.g .bc.y small,.g .bc.y .ar{color:#4A3B08}
.hero{margin:14px 0 4px;padding:14px 16px;background:var(--k);color:var(--bg);border:var(--bw) solid var(--k);border-radius:var(--rad);box-shadow:var(--sh) var(--sh) 0 var(--y);display:flex;justify-content:space-between;align-items:flex-end;gap:12px}
.hero .t{font:400 34px/1 var(--disp);text-transform:uppercase;letter-spacing:.5px}
.hero .s{font:700 11px/1.3 var(--body);letter-spacing:2px;text-transform:uppercase;color:var(--k3);margin-top:6px}
.hero .n{font:400 44px/1 var(--disp);color:var(--y)}
footer{margin-top:28px;font:700 10.5px/1.4 var(--body);letter-spacing:2px;text-transform:uppercase;color:var(--k3);text-align:center}
@media (max-width:360px){.g{grid-template-columns:1fr}}
</style></head><body>
<header class="bh"><a class="bq" href="/" aria-label="박비서">←</a><div><h1 class="ttl">Toolbox</h1><div class="sub">박비서 도구함 · voice.zhnote.net</div></div></header>
<div class="bz"></div>
<main>
<div class="hero"><div><div class="t">All tools</div><div class="s">나 · 업무 · 읽기 · 놀기 · 보기</div></div><div class="n">NCOUNT</div></div>
${SEC("01", "Me", "나", [
  CARD("/me", "🪞", "나 살피기", "이번 주 수면·작업 시각·안 쓰는 도구 · 수원·T1 경기", "y"),
])}
${SEC("02", "Work", "업무", [
  CARD("/guest", "🤝", "출장자 지원", "호텔·차량·식사·손님 취향, 지사원과 공유"),
  CARD("/brief", "🧳", "출장 브리핑", "전날 밤 날씨·출발·챙길 것 알림"),
  CARD("/mag/", "📰", "기내 잡지", "탑승 전 한 번 열면 오프라인으로"),
  CARD("/vpn", "📶", "VPN 용량", "남은 용량·만료 알림, 공유기·폰 구독 함께"),
  CARD("/live", "🎧", "동시통역", "한↔중 실시간, 내 목소리로 번역 음성"),
])}
${SEC("03", "Read", "읽기", [
  CARD("/daily", "🌏", "오늘의 중국 (공개)", "하루 3문제·화제·환율 — 남에게 보내는 링크"),
  CARD("/trend", "🔥", "오늘의 중국 인터넷", "지금 뜨는 이슈·유행어"),
])}
${SEC("04", "Play", "놀기", [
  CARD("/art", "🖼", "명화 한 점", "그림 한 점, 1분 쉬기 · 액자 모드"),
  CARD("/quest", "🧭", "주말 탐험", "오늘 갈 곳 3곳 미션"),
  CARD("/mystery", "🕵️", "광저우 미스터리", "실제 장소 추리 게임"),
  CARD("/air/", "✈️", "미스터리 기내편", "그림·심문, 비행기 모드 OK"),
  CARD("/timecam", "🕰", "타임머신 카메라", "1930·1985·2080·눈"),
  CARD("/signs", "🪧", "간판 사냥", "웃긴 중국어 간판 도감"),
  CARD("/novel", "📖", "우리 연재 소설", "우리 기록이 한 화씩 소설로"),
  CARD("/memoir", "🎙", "구술 자서전", "매일 밤 5분, 질문 하나에 답하면 책이 됩니다"),
  CARD("/xiangqi", "♟", "象棋 중국 장기", "규칙 7가지 + 봇 대국, 오프라인"),
  CARD("/tv", "📺", "박비서 TV", "공개 TV·라디오 + 내 m3u 목록, 넷플릭스식 화면"),
])}
${SEC("05", "Stats", "보기", [
  CARD("/usage", "📊", "앱 사용량", "내 앱들 얼마나 썼나"),
])}
<footer>Park's Toolbox · Guangzhou</footer>
</main></body></html>`;
// 히어로의 도구 개수 = 카드 수(카드 추가 시 자동)
export const HUB_HTML = PAGE.replace("NCOUNT", String((PAGE.match(/class="bc/g) || []).length));
