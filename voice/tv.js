// 📺 박비서 TV — 나만의 방송국(2026-10-18). 소유자가 GPT 로 만든 UI 초안을 개인 팔레트(Aegean Sky·Sandy Linen·Scarlet)·게임 글꼴(Black Han Sans + Lilita One)·프리텐다드로 다듬은 화면.
// 지금은 화면 + 샘플 채널 데이터. 실제 채널 목록(iptv-org·radio-browser)·재생·박비서 채널 편성은 다음 단계에서 /tv/* API 로 연결.
export const TV_HTML = String.raw`<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#1664B0">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="박비서 TV">
<link rel="apple-touch-icon" href="/icon-180.png">
<title>박비서 TV · 나만의 방송국</title>
<style>
@font-face{font-family:"Pretendard";font-weight:400;src:url(/fonts/pretendard-400.woff2) format("woff2");font-display:swap}
@font-face{font-family:"Pretendard";font-weight:700;src:url(/fonts/pretendard-700.woff2) format("woff2");font-display:swap}
@font-face{font-family:"BB BlackHan";src:url(/fonts/blackhan.woff) format("woff");font-display:swap}
@font-face{font-family:"BB Lilita";src:url(/fonts/lilita.woff) format("woff");font-display:swap}
:root{
  --sky:#1664B0;--sky2:#0F4F8F;--sky3:#E3EDF7;--linen:#EFE8DE;--linen2:#F7F2EA;--linen3:#E6DCCB;--red:#D21624;
  --ink:#1A2330;--ink2:#5E6672;--ink3:#8A9099;--line:#D9CEBD;--card:#FBF8F2;--gold:#FFD84D;
  --bg:var(--linen);--surface:var(--card);--sidebar:232px;--radius:18px;
  --sans:"Pretendard",-apple-system,"Apple SD Gothic Neo","PingFang SC",system-ui,sans-serif;
  --disp:"BB Lilita","BB BlackHan","Pretendard",-apple-system,"Apple SD Gothic Neo",sans-serif;
  --olw:.13em;--ol:0 .08em 0 #0B1A2A;
  color-scheme:light;
}
@media (prefers-color-scheme:dark){:root{--bg:#141A22;--surface:#1C2430;--card:#1C2430;--line:#2C3644;--ink:#EDE6DA;--ink2:#9AA3AE;--ink3:#6F7985;--sky3:#1B2F45;--linen2:#222C3A;--linen3:#2A3442;color-scheme:dark}}
*{box-sizing:border-box}html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 var(--sans);letter-spacing:-.01em;-webkit-font-smoothing:antialiased}
button,input,a{font:inherit}button{cursor:pointer;color:inherit}a{text-decoration:none;color:inherit}
button:focus-visible,a:focus-visible,input:focus-visible{outline:2px solid var(--sky);outline-offset:3px}
.i{display:inline-flex;width:19px;height:19px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex:none}.i.sm{width:16px;height:16px}.i.lg{width:23px;height:23px}
.hidden{display:none!important}
/* 게임 글꼴 글씨: 남색 외곽선 + 아래 그림자, 금색은 그라데이션 */
.disp{font-family:var(--disp);font-weight:400;letter-spacing:0}
.gt{font-family:var(--disp);font-weight:400;color:#fff;-webkit-text-stroke:var(--olw) #0B1A2A;paint-order:stroke fill;text-shadow:var(--ol)}
.gt.gold{background:linear-gradient(#FFE866,#FFA726);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-stroke:0;text-shadow:none;filter:drop-shadow(0 .06em 0 #E8761A) drop-shadow(0 .05em 0 #0B1A2A)}
/* ── 셸 ── */
.shell{min-height:100vh;display:flex}
.sidebar{width:var(--sidebar);background:var(--sky);color:#fff;position:fixed;inset:0 auto 0 0;display:flex;flex-direction:column;padding:28px 14px 20px;z-index:50;border-right:3px solid var(--red)}
.brand{display:flex;align-items:center;gap:11px;padding:0 10px 28px}
.brand-mark{height:40px;width:40px;display:grid;place-items:center;border-radius:12px;background:var(--linen);color:var(--sky);font-family:var(--disp);font-size:22px;box-shadow:0 3px 0 #0B1A2A}
.brand h1{margin:0;font-family:var(--disp);font-weight:400;font-size:20px;line-height:1.1;color:#fff;-webkit-text-stroke:2.2px #0B1A2A;paint-order:stroke fill;text-shadow:0 2px 0 #0B1A2A}
.brand small{display:block;font-size:10px;color:#CFE0F3;font-weight:700;letter-spacing:.14em;margin-top:3px}
.nav-label{font-size:10px;color:#BBD1EA;letter-spacing:.14em;font-weight:800;padding:0 14px;margin:8px 0 8px}
.nav-list{display:flex;flex-direction:column;gap:4px}
.nav-item{border:0;background:transparent;color:#DCE8F5;display:flex;align-items:center;text-align:left;gap:12px;padding:11px 14px;border-radius:12px;font-weight:700;font-size:13.5px;width:100%;transition:.15s}
.nav-item:hover{background:rgba(255,255,255,.12);color:#fff}
.nav-item.active{background:var(--linen);color:var(--sky);box-shadow:0 2px 0 rgba(11,26,42,.25)}
.nav-item .new{margin-left:auto;background:var(--red);color:#fff;padding:2px 6px;border-radius:6px;font-size:9px;font-weight:800;letter-spacing:.06em}
.nav-item.active .new{background:var(--red)}
.nav-divider{height:1px;background:rgba(255,255,255,.22);margin:18px 12px}
.side-bottom{margin-top:auto;padding:0 6px}
.side-info{border-radius:14px;padding:14px 13px;background:rgba(11,26,42,.22);border:1px solid rgba(255,255,255,.18)}
.side-info .small-heading{display:flex;gap:7px;align-items:center;color:#fff;font-size:11px;font-weight:800;letter-spacing:.06em}
.side-info p{color:#CFE0F3;line-height:1.55;font-size:11px;margin:8px 0 0}
.avatar-line{display:flex;align-items:center;gap:9px;margin-top:16px;border-top:1px solid rgba(255,255,255,.22);padding:14px 4px 0}
.avatar{width:32px;height:32px;background:var(--red);color:#fff;border-radius:50%;display:grid;place-items:center;font-family:var(--disp);font-size:16px;box-shadow:0 2px 0 #0B1A2A}
.avatar-line strong{display:block;font-size:12px;color:#fff}.avatar-line small{display:block;color:#BBD1EA;font-size:10px;margin-top:2px}
/* ── 본문 ── */
.main{margin-left:var(--sidebar);width:calc(100% - var(--sidebar));min-width:0;padding:0 34px 72px;max-width:1700px}
.topbar{height:78px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);gap:20px}
.breadcrumb{color:var(--ink3);font-size:12px;font-weight:700;letter-spacing:.06em}.breadcrumb strong{color:var(--ink);margin-left:8px}
.top-right{display:flex;align-items:center;gap:14px}
.live-clock{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink2);font-variant-numeric:tabular-nums}
.live-clock #clock{font-family:var(--disp);font-size:18px;color:var(--sky)}
.time-zone{font-size:10px;color:var(--ink3)}
.status-tag{display:inline-flex;gap:7px;align-items:center;color:var(--ink2);font-weight:700;border:1px solid var(--line);background:var(--surface);padding:7px 10px;border-radius:999px;font-size:10px;white-space:nowrap}
.status-tag .dot{width:7px;height:7px;background:var(--red);border-radius:50%;box-shadow:0 0 0 3px rgba(210,22,36,.15)}
.bell{width:36px;height:36px;border-radius:11px;display:grid;place-items:center;border:1px solid var(--line);color:var(--ink2);background:var(--surface)}
.page-intro{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;margin:32px 0 22px}
.eyebrow{font-size:10px;letter-spacing:.17em;font-weight:800;color:var(--red);text-transform:uppercase;margin:0 0 10px}
.page-intro h2{font-family:var(--disp);font-weight:400;font-size:clamp(28px,3.2vw,40px);line-height:1.15;margin:0;color:var(--sky);-webkit-text-stroke:0;letter-spacing:0}
.page-intro h2 .dot{color:var(--red)}
.page-intro p{color:var(--ink2);margin:8px 0 0;font-size:13.5px;line-height:1.6}
.intro-btn{border:0;color:#fff;background:var(--ink);padding:11px 16px;border-radius:11px;font-size:12.5px;font-weight:700;display:flex;align-items:center;gap:9px;white-space:nowrap;box-shadow:0 3px 0 #0B1A2A}
.intro-btn:active{transform:translateY(2px);box-shadow:0 1px 0 #0B1A2A}
/* ── 플레이어 ── */
.hero{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(288px,1fr);gap:16px}
.player{min-width:0;overflow:hidden;display:flex;flex-direction:column;border-radius:var(--radius);background:var(--ink);box-shadow:0 4px 0 #0B1A2A,0 18px 40px rgba(26,35,48,.18)}
.player-screen{min-height:340px;flex:1;position:relative;overflow:hidden;isolation:isolate;background:radial-gradient(circle at 56% 44%,#2C7CC9 0%,#1664B0 30%,#163C68 62%,#1A2330 100%);transition:background .3s}
.player-screen:before{content:"";position:absolute;inset:0;opacity:.22;background-image:linear-gradient(rgba(255,255,255,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.08) 1px,transparent 1px);background-size:42px 42px;mask-image:linear-gradient(to top,black,transparent 90%)}
.player-screen[data-theme=cyan]{background:radial-gradient(circle at 56% 44%,#2A8FB8,#1D6286 30%,#163C68 62%,#1A2330)}
.player-screen[data-theme=violet]{background:radial-gradient(circle at 56% 44%,#6C5AA8,#3F3870 35%,#1A2330 85%)}
.player-screen[data-theme=coral]{background:radial-gradient(circle at 56% 44%,#D2545F,#7A2C3A 35%,#1A2330 85%)}
.player-screen[data-theme=blue]{background:radial-gradient(circle at 56% 44%,#2C7CC9,#1664B0 30%,#163C68 62%,#1A2330)}
.player-screen[data-theme=gold]{background:radial-gradient(circle at 56% 44%,#D7A93A,#7A5E1E 35%,#1A2330 85%)}
.player-screen[data-theme=rose]{background:radial-gradient(circle at 56% 44%,#C6517F,#6E2F4E 35%,#1A2330 85%)}
.player-screen[data-theme=mint]{background:radial-gradient(circle at 56% 44%,#2FA98F,#1C6A63 35%,#1A2330 85%)}
.player-top{position:absolute;top:18px;left:20px;right:20px;z-index:3;display:flex;align-items:center;justify-content:space-between}
.onair{display:flex;align-items:center;gap:8px;border-radius:8px;background:rgba(11,26,42,.6);border:1px solid rgba(255,255,255,.18);backdrop-filter:blur(14px);padding:7px 11px;color:#fff;font-family:var(--disp);font-size:13px;letter-spacing:.04em}
.onair .pulse{height:8px;width:8px;border-radius:50%;background:var(--red);box-shadow:0 0 0 4px rgba(210,22,36,.25);animation:pulse 1.6s infinite}
@keyframes pulse{0%,100%{box-shadow:0 0 0 3px rgba(210,22,36,.25)}50%{box-shadow:0 0 0 7px rgba(210,22,36,.08)}}
.player-demo{font-size:10px;letter-spacing:.12em;font-weight:800;color:#fff;opacity:.7}
.poster-art{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:7px;z-index:1;pointer-events:none}
.orb{position:absolute;left:50%;top:42%;transform:translate(-50%,-50%);width:min(36%,220px);aspect-ratio:1;border-radius:50%;background:radial-gradient(circle at 35% 26%,#FFF4D6 0%,#FFD84D 22%,#E8761A 55%,#7A2C3A 76%,transparent 77%);box-shadow:0 0 90px rgba(255,216,77,.22);opacity:.9}
.orbit{position:absolute;left:50%;top:42%;transform:translate(-50%,-50%) rotate(-23deg);width:44%;height:23%;border:2px solid rgba(255,255,255,.35);border-radius:50%}
.poster-word{position:relative;margin-top:130px;font-family:var(--disp);font-weight:400;font-size:clamp(30px,4.4vw,58px);color:#fff;-webkit-text-stroke:var(--olw) #0B1A2A;paint-order:stroke fill;text-shadow:var(--ol);line-height:1.05;text-align:center;padding:0 16px}
.poster-word.smallword{font-size:clamp(26px,3.4vw,44px)}
.poster-sub{position:relative;font-size:10px;letter-spacing:.35em;font-weight:800;color:#FFE9A8;margin-top:4px}
.play-center{position:absolute;left:50%;top:42%;transform:translate(-50%,-50%);z-index:6;border:0;border-radius:50%;width:66px;height:66px;background:var(--red);display:grid;place-items:center;color:#fff;box-shadow:0 4px 0 #0B1A2A,0 10px 30px rgba(0,0,0,.3);transition:.15s}
.play-center:hover{transform:translate(-50%,-50%) scale(1.06)}.play-center:active{transform:translate(-50%,-48%) scale(.98);box-shadow:0 1px 0 #0B1A2A}
.play-center svg{margin-left:4px}
.screen-gradient{position:absolute;inset:50% 0 0;z-index:2;background:linear-gradient(0deg,rgba(26,35,48,.95),rgba(26,35,48,0))}
.screen-caption{position:absolute;z-index:4;bottom:18px;left:22px;right:22px;display:flex;align-items:flex-end;gap:12px;justify-content:space-between}
.screen-caption small{color:#FFD84D;font-weight:800;font-size:10px;letter-spacing:.1em}
.screen-caption h3{font-family:var(--disp);font-weight:400;font-size:24px;margin:5px 0 4px;color:#fff;-webkit-text-stroke:2px #0B1A2A;paint-order:stroke fill;text-shadow:0 2px 0 #0B1A2A}
.screen-caption p{font-size:11.5px;color:#DCE8F5;margin:0;max-width:390px;line-height:1.5}
.screen-caption .quality{border:1px solid rgba(255,255,255,.35);background:rgba(11,26,42,.55);border-radius:6px;padding:5px 8px;font-family:var(--disp);font-size:11px;color:#fff;white-space:nowrap;letter-spacing:.04em}
.player-bottom{height:58px;display:flex;align-items:center;justify-content:space-between;padding:0 18px;gap:8px;background:var(--ink);color:#fff}
.player-left{display:flex;align-items:center;gap:12px;min-width:0}
.player-left strong{font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.line-dot{height:4px;width:4px;background:#5E6672;border-radius:50%}
.player-left span{font-size:11px;color:#9AA3AE;white-space:nowrap}
.controls{display:flex;align-items:center;gap:5px}
.icon-btn{border:0;background:transparent;color:#C9D1DB;width:34px;height:34px;display:grid;place-items:center;border-radius:9px}
.icon-btn:hover{background:rgba(255,255,255,.1);color:#fff}
.icon-btn.saved{color:var(--red);background:rgba(210,22,36,.15)}.icon-btn.saved .i{fill:var(--red)}
/* ── 편성표 ── */
.schedule{background:var(--surface);border-radius:var(--radius);border:1px solid var(--line);display:flex;flex-direction:column;padding:20px 20px 16px;min-height:0;overflow:hidden;box-shadow:0 3px 0 var(--line)}
.panel-top{display:flex;align-items:center;justify-content:space-between;gap:10px}
.panel-top h3{font-size:15px;font-weight:800;margin:0}
.pill-soft{font-size:10px;padding:5px 9px;color:var(--sky);border:1px solid var(--sky);border-radius:7px;white-space:nowrap;font-weight:800}
.schedule-lead{margin:18px 0 16px;padding:16px;background:var(--sky);color:#fff;border-radius:14px;box-shadow:0 3px 0 #0B1A2A}
.schedule-lead .kicker{color:#FFD84D;font-size:10px;font-weight:800;letter-spacing:.08em}
.schedule-lead h4{margin:8px 0 4px;font-family:var(--disp);font-weight:400;font-size:21px;-webkit-text-stroke:2px #0B1A2A;paint-order:stroke fill;text-shadow:0 2px 0 #0B1A2A}
.schedule-lead p{font-size:11.5px;color:#DCE8F5;margin:0}
.progress-top{display:flex;justify-content:space-between;font-size:11px;color:#CFE0F3;margin:16px 0 8px;font-family:var(--disp);letter-spacing:.03em}
.track{height:6px;background:rgba(11,26,42,.35);border-radius:5px;overflow:hidden}
.track span{display:block;height:100%;background:var(--gold);border-radius:5px;width:37%;transition:width .5s}
.schedule-list{display:flex;flex-direction:column;gap:0;flex:1;min-height:0}
.schedule-row{display:grid;grid-template-columns:46px 1fr auto;align-items:center;gap:12px;padding:11px 1px;border-bottom:1px solid var(--line)}
.schedule-row:last-child{border-bottom:0}
.schedule-time{font-family:var(--disp);font-size:14px;color:var(--sky);letter-spacing:.02em}
.schedule-row strong{font-size:12.5px;font-weight:700;display:block}
.schedule-row small{font-size:10.5px;color:var(--ink3);margin-top:3px;display:block}
.schedule-link{margin-top:auto;padding:14px 0 0;background:transparent;border:0;text-align:left;display:flex;align-items:center;gap:7px;color:var(--sky);font-size:12px;font-weight:800}
/* ── 채널 격자 ── */
.content-section{margin-top:34px}
.section-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:14px}
.section-title{display:flex;align-items:center;gap:12px}
.section-head h3{font-size:19px;font-weight:800;margin:0}
.section-head .sub{color:var(--ink3);font-size:11px;margin:0}
.section-number{display:inline-grid;place-items:center;height:28px;min-width:28px;border-radius:8px;color:#fff;background:var(--red);font-family:var(--disp);font-size:13px;box-shadow:0 2px 0 #0B1A2A}
.filters{display:flex;justify-content:space-between;gap:13px;align-items:center;margin-bottom:14px;flex-wrap:wrap}
.filter-list{display:flex;gap:7px;overflow:auto;scrollbar-width:none}.filter-list::-webkit-scrollbar{display:none}
.filter-chip{padding:8px 13px;background:var(--surface);border:1.5px solid var(--line);border-radius:999px;font-size:12px;font-weight:700;color:var(--ink2);white-space:nowrap;transition:.15s}
.filter-chip:hover{border-color:var(--sky);color:var(--sky)}
.filter-chip.active{background:var(--sky);border-color:var(--sky);color:#fff;box-shadow:0 2px 0 #0B1A2A}
.search{display:flex;align-items:center;gap:9px;padding:0 12px;border:1.5px solid var(--line);background:var(--surface);border-radius:10px;height:38px;color:var(--ink3);width:min(240px,100%)}
.search input{width:100%;min-width:0;outline:none;border:none;color:var(--ink);background:transparent;font-size:12px}.search input::placeholder{color:var(--ink3)}
.channel-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.channel-card{min-width:0;padding:0;text-align:left;border:1.5px solid var(--line);background:var(--surface);border-radius:15px;overflow:hidden;position:relative;transition:transform .15s,border-color .15s;box-shadow:0 3px 0 var(--line)}
.channel-card:hover{transform:translateY(-2px);border-color:var(--sky)}
.channel-card.selected{border-color:var(--sky);box-shadow:0 3px 0 var(--sky)}
.tile-art{height:104px;position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden;background:radial-gradient(circle at 47% 45%,#2C7CC9,#163C68 78%)}
.tile-art:before{content:"";position:absolute;inset:0;opacity:.35;background:repeating-linear-gradient(135deg,transparent 0 23px,rgba(255,255,255,.05) 24px,transparent 25px)}
.tile-art.blue{background:radial-gradient(circle at 47% 45%,#2C7CC9,#163C68 78%)}
.tile-art.mint{background:radial-gradient(circle at 47% 45%,#2FA98F,#1C4F4C 78%)}
.tile-art.gold{background:radial-gradient(circle at 47% 45%,#D7A93A,#5E4617 78%)}
.tile-art.coral{background:radial-gradient(circle at 47% 45%,#D2545F,#5E2430 78%)}
.tile-art.violet{background:radial-gradient(circle at 47% 45%,#6C5AA8,#2E2852 78%)}
.tile-art.rose{background:radial-gradient(circle at 47% 45%,#C6517F,#4F2238 78%)}
.channel-logo{position:relative;color:#fff;font-family:var(--disp);font-size:clamp(20px,2vw,27px);-webkit-text-stroke:var(--olw) #0B1A2A;paint-order:stroke fill;text-shadow:var(--ol);padding:0 10px;text-align:center}
.tile-art .country{position:absolute;top:10px;left:11px;font-size:15px}
.tile-art .fav-corner{position:absolute;top:6px;right:6px;width:30px;height:30px;border-radius:9px;border:0;color:rgba(255,255,255,.8);background:rgba(11,26,42,.35);display:grid;place-items:center;z-index:2}
.tile-art .fav-corner.is-on{color:#fff;background:var(--red)}.fav-corner.is-on .i{fill:#fff}
.tile-info{padding:12px 13px 13px}
.tile-name{display:block;font-size:12.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tile-meta{display:flex;justify-content:space-between;gap:5px;align-items:center;color:var(--ink3);font-size:10.5px;margin-top:6px}
.tile-meta .test{display:flex;align-items:center;gap:5px}
.test:before{content:"";width:6px;height:6px;border-radius:50%;background:var(--ink3)}
.test.ok:before{background:#2E9E5B}.test.bad:before{background:var(--red)}
.tile-meta .genre{white-space:nowrap;color:var(--sky);font-weight:700}
.empty-state{grid-column:1/-1;border:1.5px dashed var(--line);border-radius:15px;padding:38px 15px;text-align:center;color:var(--ink3)}
.empty-state strong{color:var(--ink);display:block;margin-bottom:8px}.empty-state p{margin:0;font-size:12px}
/* ── 아래 카드 ── */
.bottom-grid{display:grid;grid-template-columns:1.25fr 1fr;gap:16px;margin-top:28px}
.feature-card{border:1.5px solid var(--line);border-radius:18px;background:var(--surface);padding:20px 22px;min-width:0;box-shadow:0 3px 0 var(--line)}
.feature-top{display:flex;align-items:center;justify-content:space-between;gap:10px}
.feature-top h3{font-size:15.5px;margin:0;font-weight:800}.feature-top small{font-size:10px;color:var(--red);font-weight:800;letter-spacing:.1em}
.radio-big{display:flex;gap:17px;align-items:center;margin-top:18px}
.radio-cover{width:90px;height:90px;border-radius:14px;background:radial-gradient(circle at 35% 30%,#2C7CC9,#163C68);display:flex;align-items:center;justify-content:center;flex:none;position:relative;overflow:hidden;color:#fff;box-shadow:0 3px 0 #0B1A2A}
.radio-cover:before{content:"";position:absolute;width:95px;height:95px;border:1.5px solid rgba(255,255,255,.3);border-radius:50%;transform:translate(17px,15px)}
.radio-cover .i{height:37px;width:37px}
.radio-description{min-width:0;flex:1}
.radio-description span{font-size:10px;font-weight:800;color:var(--red);letter-spacing:.06em}
.radio-description h4{font-family:var(--disp);font-weight:400;font-size:20px;margin:5px 0 5px;color:var(--sky)}
.radio-description p{font-size:11.5px;margin:0;color:var(--ink2);line-height:1.6}
.radio-actions{margin-top:13px;display:flex;align-items:center;gap:11px}
.radio-actions button{display:flex;align-items:center;gap:7px;font-size:12px;color:#fff;background:var(--sky);border:0;border-radius:9px;padding:9px 13px;font-weight:700;box-shadow:0 3px 0 #0B1A2A}
.radio-actions button:active{transform:translateY(2px);box-shadow:0 1px 0 #0B1A2A}
.radio-actions small{color:var(--ink3);font-size:10.5px}
.sports-list{display:flex;gap:9px;margin-top:18px}
.sports-link{display:flex;flex:1;min-width:0;align-items:center;gap:11px;border:1.5px solid var(--line);border-radius:12px;padding:14px 12px;background:var(--linen2);transition:.15s}
.sports-link:hover{border-color:var(--sky)}
.sports-icon{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;background:var(--sky);color:#fff;flex:none;box-shadow:0 2px 0 #0B1A2A}
.sports-link:nth-child(2) .sports-icon{background:var(--red)}
.sports-link strong{font-size:12.5px;display:block}.sports-link small{font-size:10.5px;color:var(--ink3);display:block;margin-top:3px}
.sports-link .arrow{margin-left:auto;color:var(--ink3)}
.footer{border-top:1px solid var(--line);margin-top:34px;padding:18px 0 0;display:flex;justify-content:space-between;gap:20px;font-size:10.5px;color:var(--ink3);line-height:1.6}
.footer .foot-strong{color:var(--sky);font-family:var(--disp);font-size:12px;letter-spacing:.04em}
.mobile-header{display:none}.mobile-nav{display:none}
.toast{position:fixed;bottom:25px;left:50%;transform:translate(-50%,12px);max-width:min(440px,90vw);border-radius:12px;padding:12px 18px;background:var(--ink);color:#fff;box-shadow:0 3px 0 #0B1A2A,0 15px 40px rgba(0,0,0,.25);font-size:12.5px;font-weight:700;z-index:80;opacity:0;transition:all .2s;pointer-events:none;text-align:center}
.toast.show{opacity:1;transform:translate(-50%,0)}
.compact-label{font-size:10px;font-weight:800;color:var(--ink3);letter-spacing:.09em;margin:14px 0 10px}
.recent-line{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
.recent-pill{border-radius:9px;background:var(--surface);border:1.5px solid var(--line);color:var(--ink2);padding:8px 10px;font-size:11px;font-weight:700}
.recent-pill:hover{border-color:var(--sky);color:var(--sky)}
.custom-only{margin:0 0 18px;border:1.5px solid var(--sky);background:var(--sky3);border-radius:13px;padding:13px 16px;display:flex;align-items:center;gap:12px}
.custom-only strong{font-size:12.5px;color:var(--sky)}.custom-only span{font-size:11.5px;color:var(--ink2)}
.custom-only button{margin-left:auto;color:#fff;border-radius:8px;border:0;background:var(--sky);padding:8px 11px;font-size:11.5px;font-weight:700;box-shadow:0 2px 0 #0B1A2A}
/* ── 반응형 ── */
@media(max-width:1250px){.main{padding:0 24px 55px}.channel-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.hero{grid-template-columns:minmax(0,1.45fr) minmax(260px,1fr)}.schedule{padding:18px 16px}.player-screen{min-height:317px;aspect-ratio:1.52/1}}
@media(max-width:1050px){:root{--sidebar:76px}.sidebar{padding:26px 10px}.brand{padding:2px 6px 24px}.brand h1,.brand small,.nav-label,.nav-item span,.nav-item .new,.side-bottom{display:none}.brand-mark{flex:none}.nav-item{height:47px;width:54px;padding:0;display:grid;place-items:center;justify-content:center}.nav-divider{margin:16px 7px}.main{padding:0 22px 55px}.hero{grid-template-columns:minmax(0,1.35fr) minmax(270px,1fr)}.player-screen{min-height:300px}.channel-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:800px){.hero{grid-template-columns:1fr}.player-screen{min-height:320px;aspect-ratio:1.75/1}.schedule{min-height:unset}.schedule-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:18px}.bottom-grid{grid-template-columns:1fr}.channel-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:640px){:root{--sidebar:0}.shell{display:block}.sidebar{display:none}.main{margin-left:0;width:100%;padding:0 16px 110px}.topbar{height:64px}.breadcrumb{display:none}.top-right{gap:10px;margin-left:auto}.top-right .status-tag{display:none}.live-clock .i{display:none}.time-zone{display:none}.bell{height:32px;width:32px}
  .mobile-header{display:flex;align-items:center;gap:9px}.mobile-header .brand-mark{height:34px;width:34px;border-radius:10px;font-size:18px;background:var(--sky);color:var(--linen)}.mobile-header strong{font-family:var(--disp);font-weight:400;font-size:20px;color:var(--sky)}
  .mobile-nav{display:flex;position:fixed;bottom:0;left:0;right:0;z-index:60;justify-content:space-around;padding:8px 6px calc(10px + env(safe-area-inset-bottom));background:var(--sky);border-top:3px solid var(--red)}
  .mobile-nav button{display:flex;align-items:center;gap:4px;flex-direction:column;min-width:52px;padding:5px 6px;border:0;background:transparent;color:#BBD1EA;font-size:10px;font-weight:700;border-radius:10px}
  .mobile-nav button.active{color:var(--sky);background:var(--linen)}.mobile-nav .i{width:21px;height:21px}
  .page-intro{margin:22px 0 18px}.page-intro h2{font-size:28px}.page-intro p{font-size:12px;margin-top:7px}.intro-btn{display:none}
  .hero{gap:12px}.player{border-radius:17px}.player-screen{aspect-ratio:1.26/1;min-height:285px}.player-top{left:14px;right:14px;top:14px}.poster-word,.poster-sub{display:none}.orb{width:170px;top:38%}.orbit{width:65%;height:26%;top:38%}.play-center{top:38%}.play-center{height:58px;width:58px}
  .screen-caption{left:15px;right:15px;bottom:16px}.screen-caption h3{font-size:20px}.screen-caption p{font-size:10.5px;max-width:260px}.player-bottom{padding:0 9px 0 15px}.player-left span,.line-dot{display:none}
  .schedule{padding:16px}.schedule-lead{margin:14px 0 10px}.schedule-list{grid-template-columns:1fr}.schedule-row{padding:10px 0}.schedule-row:nth-child(n+4){display:none}
  .content-section{margin-top:26px}.section-head h3{font-size:17px}.filters{gap:10px}.filter-list{width:100%;padding-bottom:2px}.filter-chip{font-size:11px;padding:8px 11px}.search{width:100%}
  .channel-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.tile-art{height:92px}.tile-info{padding:11px}.tile-name{font-size:11.5px}.tile-meta{font-size:9.5px}.channel-logo{font-size:22px}
  .feature-card{padding:16px}.bottom-grid{gap:12px;margin-top:22px}.radio-cover{width:74px;height:74px}.radio-description h4{font-size:17px}.radio-description p{font-size:10.5px}.sports-list{flex-direction:column}
  .footer{margin-top:26px;display:block}.footer span{display:block;margin-bottom:5px}.toast{bottom:92px}.custom-only{align-items:flex-start;flex-direction:column}.custom-only button{margin-left:0}}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{transition:none!important;animation:none!important}html{scroll-behavior:auto}}
</style>
</head>
<body>
<svg aria-hidden="true" width="0" height="0" style="position:absolute;overflow:hidden"><defs>
<symbol id="ic-home" viewBox="0 0 24 24"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/></symbol>
<symbol id="ic-tv" viewBox="0 0 24 24"><rect x="2.5" y="4" width="19" height="15" rx="3"/><path d="M8 22h8M12 19v3M9 11l2.2 2 4-4"/></symbol>
<symbol id="ic-radio" viewBox="0 0 24 24"><rect x="3" y="8" width="18" height="13" rx="3"/><path d="m5 8 13-5M7 13h7M7 16h4"/><circle cx="17" cy="15" r="2"/></symbol>
<symbol id="ic-wave" viewBox="0 0 24 24"><path d="M3 9v6M7 5v14M11 8v8M15 3v18M19 7v10M23 10v4"/></symbol>
<symbol id="ic-history" viewBox="0 0 24 24"><path d="M3 11a9 9 0 1 1 2.7 6.5M3 4v7h7M12 7v5l3 2"/></symbol>
<symbol id="ic-game" viewBox="0 0 24 24"><path d="M7 8h10a4 4 0 0 1 4 3l1 6a2 2 0 0 1-3 2l-3-2H8l-3 2a2 2 0 0 1-3-2l1-6a4 4 0 0 1 4-3zM7 12v4M5 14h4M16 13h.01M19 15h.01"/></symbol>
<symbol id="ic-search" viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="7.5"/><path d="m17 17 5 5"/></symbol>
<symbol id="ic-bell" viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></symbol>
<symbol id="ic-play" viewBox="0 0 24 24"><path d="m8 4 12 8-12 8z"/></symbol>
<symbol id="ic-heart" viewBox="0 0 24 24"><path d="M20.5 5.8a5.5 5.5 0 0 0-7.8 0L12 6.5l-.7-.7a5.5 5.5 0 0 0-7.8 7.8L12 22l8.5-8.4a5.5 5.5 0 0 0 0-7.8z"/></symbol>
<symbol id="ic-volume" viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4M17 9a4 4 0 0 1 0 6M20 6a8 8 0 0 1 0 12"/></symbol>
<symbol id="ic-expand" viewBox="0 0 24 24"><path d="M8 3H3v5m0-5 7 7m6-7h5v5m0-5-7 7M3 16v5h5m-5 0 7-7m11 2v5h-5m5 0-7-7"/></symbol>
<symbol id="ic-chevron" viewBox="0 0 24 24"><path d="m8 5 7 7-7 7"/></symbol>
<symbol id="ic-arrow" viewBox="0 0 24 24"><path d="M6 18 18 6M7 6h11v11"/></symbol>
<symbol id="ic-headphones" viewBox="0 0 24 24"><path d="M3 14v-3a9 9 0 0 1 18 0v3M3 14h5v7H6a3 3 0 0 1-3-3v-4zm18 0h-5v7h2a3 3 0 0 0 3-3v-4z"/></symbol>
</defs></svg>
<div class="shell">
  <aside class="sidebar" aria-label="주 메뉴">
    <div class="brand"><div class="brand-mark">P</div><div><h1>박비서 TV</h1><small>MY BROADCAST</small></div></div>
    <div class="nav-label">BROADCAST</div>
    <nav class="nav-list">
      <button class="nav-item active" data-view="home"><svg class="i"><use href="#ic-home"/></svg><span>홈</span></button>
      <button class="nav-item" data-view="tv"><svg class="i"><use href="#ic-tv"/></svg><span>TV 채널</span></button>
      <button class="nav-item" data-view="radio"><svg class="i"><use href="#ic-radio"/></svg><span>라디오</span></button>
      <button class="nav-item" data-view="personal"><svg class="i"><use href="#ic-wave"/></svg><span>박비서 채널</span><span class="new">MY</span></button>
      <div class="nav-divider"></div>
      <button class="nav-item" data-view="favorites"><svg class="i"><use href="#ic-heart"/></svg><span>즐겨찾기</span></button>
      <button class="nav-item" data-view="history"><svg class="i"><use href="#ic-history"/></svg><span>최근 시청</span></button>
      <button class="nav-item" data-view="esports"><svg class="i"><use href="#ic-game"/></svg><span>e스포츠</span></button>
    </nav>
    <div class="side-bottom">
      <div class="side-info"><div class="small-heading"><svg class="i sm"><use href="#ic-wave"/></svg> DATA SOURCE</div><p>iptv-org · radio-browser.info<br>공개 방송만 연결합니다.</p></div>
      <div class="avatar-line"><div class="avatar">P</div><div><strong>개인 방송국</strong><small>voice.zhnote.net/tv</small></div></div>
    </div>
  </aside>
  <main class="main">
    <header class="topbar">
      <div class="breadcrumb">MY STUDIO <span style="margin-left:8px;color:var(--line)">/</span> <strong id="breadcrumb-text">대시보드</strong></div>
      <div class="mobile-header"><div class="brand-mark">P</div><strong>박비서 TV</strong></div>
      <div class="top-right"><div class="live-clock"><svg class="i sm"><use href="#ic-wave"/></svg><span id="clock">09:41</span><span class="time-zone">중국시간 GMT+8</span></div><span class="status-tag"><span class="dot"></span> 연결 준비 중</span><button class="bell" id="notification-button" aria-label="알림"><svg class="i"><use href="#ic-bell"/></svg></button></div>
    </header>
    <div class="page-intro"><div><p class="eyebrow">PERSONAL BROADCASTING SPACE</p><h2 id="page-heading">내 취향이 방송이 되는 곳<span class="dot">.</span></h2><p id="page-subheading">TV부터 라디오, 나만의 오디오 콘텐츠까지. 하나의 공간에서.</p></div><button class="intro-btn" id="guide-button"><svg class="i sm"><use href="#ic-wave"/></svg> 방송국 이용 안내 <svg class="i sm"><use href="#ic-chevron"/></svg></button></div>
    <section class="hero" aria-label="현재 선택한 채널과 편성표">
      <div class="player"><div class="player-screen" id="player-screen" data-theme="blue">
        <div class="player-top"><span class="onair"><span class="pulse"></span><span id="on-air-label">MY CHANNEL</span></span><span class="player-demo">PREVIEW</span></div>
        <div class="poster-art"><div class="orb"></div><div class="orbit"></div><div class="poster-word" id="poster-word">박비서 채널</div><div class="poster-sub" id="poster-sub">A CHANNEL OF MY OWN</div></div>
        <button class="play-center" id="main-play" aria-label="재생"><svg class="i lg" style="width:30px;height:30px;fill:currentColor;stroke-width:1.2"><use href="#ic-play"/></svg></button>
        <div class="screen-gradient"></div><div class="screen-caption"><div><small id="screen-kicker">NOW ON AIR</small><h3 id="screen-title">박비서 채널</h3><p id="screen-description">기내 잡지 오디오북, 라디오 드라마, 중국 이야기. 나만의 편성으로 만나는 하루.</p></div><span class="quality" id="quality">AUDIO</span></div>
      </div><div class="player-bottom"><div class="player-left"><strong id="current-channel">박비서 채널</strong><span class="line-dot"></span><span id="current-genre">나만의 방송 · 오디오</span></div><div class="controls"><button class="icon-btn" id="main-fav" aria-label="즐겨찾기"><svg class="i"><use href="#ic-heart"/></svg></button><button class="icon-btn" id="main-volume" aria-label="볼륨"><svg class="i"><use href="#ic-volume"/></svg></button><button class="icon-btn" id="main-expand" aria-label="전체 화면"><svg class="i"><use href="#ic-expand"/></svg></button></div></div></div>
      <aside class="schedule" id="schedule-panel"><div class="panel-top"><h3 id="schedule-title">박비서 채널 편성표</h3><span class="pill-soft" id="schedule-pill">오늘의 방송</span></div><div class="schedule-lead"><span class="kicker">● NOW PLAYING</span><h4 id="current-program">기내 잡지 오디오북</h4><p id="current-program-desc">나만의 오디오 콘텐츠 편성</p><div class="progress-top"><span id="program-start">09:00</span><span id="program-end">12:00</span></div><div class="track"><span id="program-progress"></span></div></div><div class="schedule-list" id="schedule-items"></div><button class="schedule-link" id="schedule-button">전체 편성표 보기 <svg class="i sm"><use href="#ic-chevron"/></svg></button></aside>
    </section>
    <section class="content-section" id="channel-section"><div class="section-head"><div class="section-title"><span class="section-number">01</span><h3 id="grid-heading">추천 TV 채널</h3></div><span class="sub" id="grid-meta">공개 목록 기반</span></div><div class="custom-only hidden" id="custom-only"><strong>✦ 나만의 채널</strong><span>오디오북 · 라디오 드라마 · 중국 소식 · 자서전 낭독을 시간표에 맞춰 배치하는 공간</span><button id="custom-edit">편성 수정</button></div><div class="filters" id="filter-row"><div class="filter-list" id="country-filters"></div><label class="search"><svg class="i sm"><use href="#ic-search"/></svg><input id="search-field" type="search" placeholder="채널 이름 검색" aria-label="채널 이름 검색" autocomplete="off"></label></div><div class="channel-grid" id="channel-grid"></div><div id="recent-container" class="hidden"><div class="compact-label">최근 선택한 채널</div><div class="recent-line" id="recent-line"></div></div></section>
    <div class="bottom-grid" id="feature-grid"><section class="feature-card"><div class="feature-top"><h3>라디오, 가볍게 듣기</h3><small>RADIO STATION</small></div><div class="radio-big"><div class="radio-cover"><svg class="i"><use href="#ic-headphones"/></svg></div><div class="radio-description"><span>추천 라디오</span><h4>RTHK Radio 3</h4><p>이동 중, 업무 중에도 듣기 좋은 라디오. 홈 화면 앱으로 열면 잠금 화면에서도 이어 들을 수 있게 만들 예정입니다.</p><div class="radio-actions"><button id="radio-open"><svg class="i sm"><use href="#ic-radio"/></svg> 라디오 둘러보기</button><small>백그라운드 재생 지원 예정</small></div></div></div></section><section class="feature-card"><div class="feature-top"><h3>e스포츠 LIVE 바로가기</h3><small>EXTERNAL LINKS</small></div><div class="sports-list"><a class="sports-link" href="https://lolesports.com/" target="_blank" rel="noopener noreferrer"><span class="sports-icon"><svg class="i lg"><use href="#ic-game"/></svg></span><span><strong>LCK · Worlds</strong><small>공식 대회 웹사이트</small></span><svg class="i sm arrow"><use href="#ic-arrow"/></svg></a><a class="sports-link" href="https://www.youtube.com/@lolesports" target="_blank" rel="noopener noreferrer"><span class="sports-icon"><svg class="i lg"><use href="#ic-play"/></svg></span><span><strong>LoL Esports</strong><small>YouTube 채널</small></span><svg class="i sm arrow"><use href="#ic-arrow"/></svg></a></div><p style="font-size:10.5px;color:var(--ink3);line-height:1.55;margin:14px 0 0">e스포츠는 직접 스트리밍하지 않고 공식 페이지로 이동합니다. T1 경기 날엔 여기 알림이 뜹니다.</p></section></div>
    <footer class="footer"><span><span class="foot-strong">PARK SECRETARY TV</span> · 개인 방송국</span><span>채널 정보는 iptv-org · radio-browser.info 공개 목록, 재생은 폰이 방송사 서버에 직접 접속합니다.</span></footer>
  </main>
</div>
<nav class="mobile-nav" aria-label="모바일 내비게이션"><button class="active" data-view="home"><svg class="i"><use href="#ic-home"/></svg>홈</button><button data-view="tv"><svg class="i"><use href="#ic-tv"/></svg>TV</button><button data-view="radio"><svg class="i"><use href="#ic-radio"/></svg>라디오</button><button data-view="personal"><svg class="i"><use href="#ic-wave"/></svg>내 채널</button><button data-view="favorites"><svg class="i"><use href="#ic-heart"/></svg>즐겨찾기</button></nav>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script>
'use strict';
// 1단계: 화면·샘플 채널. 다음 단계에서 /tv/channels(KV, iptv-org·radio-browser 하루 1번 갱신)와 HLS 재생(iOS 사파리 네이티브)·박비서 채널 편성(KV 오디오)으로 교체.
const channels=[
  {id:'park',name:'박비서 채널',brand:'PARK TV',desc:'오디오북 · 라디오 드라마 · 중국 브리핑',country:'MY',medium:'personal',genre:'나만의 채널',theme:'blue',poster:'박비서 채널',subtitle:'A CHANNEL OF MY OWN'},
  {id:'cgtn',name:'CGTN',brand:'CGTN',desc:'International news · News',country:'CN',medium:'tv',genre:'뉴스',theme:'cyan',poster:'CGTN',subtitle:'GLOBAL NEWS'},
  {id:'cctv',name:'CCTV-13',brand:'CCTV 13',desc:'중국 뉴스 프로그램',country:'CN',medium:'tv',genre:'뉴스',theme:'blue',poster:'CCTV-13',subtitle:'CHINA NEWS'},
  {id:'phoenix',name:'Phoenix TV',brand:'PHOENIX',desc:'홍콩 중국어 방송',country:'HK',medium:'tv',genre:'종합',theme:'gold',poster:'PHOENIX',subtitle:'HONG KONG'},
  {id:'arirang',name:'Arirang TV',brand:'ARIRANG',desc:'한국 국제 방송',country:'KR',medium:'tv',genre:'종합',theme:'violet',poster:'ARIRANG',subtitle:'KOREA GLOBAL'},
  {id:'tvbs',name:'TVBS News',brand:'TVBS',desc:'대만 뉴스',country:'TW',medium:'tv',genre:'뉴스',theme:'coral',poster:'TVBS',subtitle:'TAIWAN NEWS'},
  {id:'nhk',name:'NHK WORLD-JAPAN',brand:'NHK WORLD',desc:'일본 국제 방송',country:'JP',medium:'tv',genre:'뉴스',theme:'blue',poster:'NHK WORLD',subtitle:'JAPAN'},
  {id:'kbsworld',name:'KBS WORLD',brand:'KBS WORLD',desc:'한국 엔터테인먼트',country:'KR',medium:'tv',genre:'엔터',theme:'rose',poster:'KBS WORLD',subtitle:'KOREA'},
  {id:'rthk',name:'RTHK Radio 3',brand:'RTHK 3',desc:'홍콩 영어 라디오',country:'HK',medium:'radio',genre:'토크',theme:'mint',poster:'RTHK Radio 3',subtitle:'RADIO · HONG KONG'},
  {id:'cnr',name:'China National Radio',brand:'CNR',desc:'중국 국영 라디오',country:'CN',medium:'radio',genre:'종합',theme:'blue',poster:'CNR RADIO',subtitle:'RADIO · CHINA'},
  {id:'kbsfm',name:'KBS Cool FM',brand:'KBS FM',desc:'한국 음악 · 토크 라디오',country:'KR',medium:'radio',genre:'음악',theme:'violet',poster:'KBS COOL FM',subtitle:'RADIO · KOREA'},
  {id:'hitradio',name:'Hit FM Taiwan',brand:'HIT FM',desc:'대만 음악 라디오',country:'TW',medium:'radio',genre:'음악',theme:'coral',poster:'HIT FM',subtitle:'RADIO · TAIWAN'},
  {id:'nhkradio',name:'NHK Radio 1',brand:'NHK RADIO',desc:'일본 라디오',country:'JP',medium:'radio',genre:'종합',theme:'gold',poster:'NHK RADIO',subtitle:'RADIO · JAPAN'}
];
const countries=[['all','전체'],['KR','🇰🇷 한국'],['CN','🇨🇳 중국'],['HK','🇭🇰 홍콩'],['TW','🇹🇼 대만'],['JP','🇯🇵 일본']];
const flags={MY:'✦',KR:'🇰🇷',CN:'🇨🇳',HK:'🇭🇰',TW:'🇹🇼',JP:'🇯🇵'};
const schedule=[{time:'06:00',title:'오늘의 중국 인터넷',note:'데일리 뉴스 & 트렌드',length:180},{time:'09:00',title:'기내 잡지 오디오북',note:'여행과 라이프스타일',length:180},{time:'12:00',title:'박비서 라디오 드라마',note:'오리지널 오디오 콘텐츠',length:180},{time:'15:00',title:'자서전 낭독',note:'나의 기록과 이야기',length:240},{time:'19:00',title:'오늘의 중국 인터넷',note:'저녁 브리핑',length:180},{time:'22:00',title:'심야 오디오북',note:'하루의 끝, 조용한 낭독',length:480}];
const viewLabels={home:['대시보드','내 취향이 방송이 되는 곳','TV부터 라디오, 나만의 오디오 콘텐츠까지. 하나의 공간에서.'],tv:['TV 채널','오늘은 어떤 채널을 볼까요?','한국·중국·홍콩·대만·일본의 공개 TV 목록을 한눈에.'],radio:['라디오','듣고 싶은 순간, 바로 라디오','음악과 뉴스, 이동 중에도 어울리는 오디오 채널.'],personal:['박비서 채널','세상에 하나뿐인 내 채널','오디오북과 드라마, 나의 이야기가 하루의 방송이 됩니다.'],favorites:['즐겨찾기','마음에 드는 채널만 모아보기','하트를 눌러 자주 보는 방송을 간편하게 찾아보세요.'],history:['최근 시청','최근 둘러본 방송','최근 선택한 채널을 쉽게 다시 찾아보세요.'],esports:['e스포츠','경기는 공식 채널에서','LCK와 Worlds는 공식 외부 링크에서 시청하세요.']};
const $=id=>document.getElementById(id);
let favorites=new Set();let recent=[];
try{favorites=new Set(JSON.parse(localStorage.getItem('tv-fav')||'[]'));recent=JSON.parse(localStorage.getItem('tv-recent')||'[]');}catch(e){}
let state={view:'home',country:'all',selected:'park',search:''};
let toastTimer;
function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),2900)}
function fmtMinutes(min){return String(Math.floor(min/60)%24).padStart(2,'0')+':'+String(min%60).padStart(2,'0')}
function chinaDate(){return new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Shanghai'}))}
function nowMinutes(){const d=chinaDate();return d.getHours()*60+d.getMinutes()}
function currentSchedule(){const n=nowMinutes();let slot=schedule[schedule.length-1];for(let i=0;i<schedule.length;i++){const m=parseInt(schedule[i].time.slice(0,2))*60+parseInt(schedule[i].time.slice(3));if(n>=m)slot=schedule[i]}const start=parseInt(slot.time.slice(0,2))*60+parseInt(slot.time.slice(3));const diff=(n-start+1440)%1440;return {slot,start,diff,percentage:Math.min(100,Math.round(diff/slot.length*100))}}
function renderSchedule(){const d=chinaDate();$('clock').textContent=String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');if(state.selected!=='park'){const c=channels.find(x=>x.id===state.selected);$('schedule-title').textContent=(c?c.name:'채널')+' 방송 정보';$('schedule-pill').textContent='연동 전';$('current-program').textContent='편성 정보 준비 중';$('current-program-desc').textContent='공개 EPG 연결 시 표시됩니다';$('program-start').textContent='--:--';$('program-end').textContent='--:--';$('program-progress').style.width='0%';$('schedule-items').innerHTML=[['방송 정보','iptv-org 가이드 연동 예정'],['재생 방식',c?.medium==='radio'?'공개 오디오 스트림':'HLS / 공개 스트림'],['중국 접속 여부','실제 재생 결과 누적 후 표시']].map(([title,note])=>'<div class="schedule-row"><span class="schedule-time">—</span><div><strong>'+title+'</strong><small>'+note+'</small></div></div>').join('');$('screen-kicker').textContent='CHANNEL PREVIEW · 재생 연결 전';return;}$('schedule-title').textContent='박비서 채널 편성표';$('schedule-pill').textContent='오늘의 방송';const {slot,start,percentage}=currentSchedule();$('current-program').textContent=slot.title;$('current-program-desc').textContent=slot.note;$('program-start').textContent=fmtMinutes(start);$('program-end').textContent=fmtMinutes(start+slot.length);$('program-progress').style.width=percentage+'%';$('schedule-items').innerHTML=schedule.filter(x=>x!==slot).slice(0,3).map(s=>'<div class="schedule-row"><span class="schedule-time">'+s.time+'</span><div><strong>'+s.title+'</strong><small>'+s.note+'</small></div><svg class="i sm" style="color:var(--ink3)"><use href="#ic-chevron"/></svg></div>').join('');$('screen-kicker').textContent='NOW ON AIR · '+slot.title}
function saveState(){try{localStorage.setItem('tv-fav',JSON.stringify([...favorites]));localStorage.setItem('tv-recent',JSON.stringify(recent))}catch(e){}}
function selectChannel(id){const c=channels.find(x=>x.id===id);if(!c)return;state.selected=id;recent=[id,...recent.filter(x=>x!==id)].slice(0,8);saveState();$('player-screen').dataset.theme=c.theme;$('poster-word').textContent=c.poster;$('poster-word').classList.toggle('smallword',c.poster.length>11);$('poster-sub').textContent=c.subtitle;$('screen-title').textContent=c.name;$('screen-description').textContent=c.id==='park'?'기내 잡지 오디오북, 라디오 드라마, 중국 이야기. 나만의 편성으로 만나는 하루.':c.desc;$('current-channel').textContent=c.name;$('current-genre').textContent=c.genre+' · '+(c.medium==='radio'?'라디오':c.medium==='tv'?'TV':'오디오');$('on-air-label').textContent=c.medium==='personal'?'MY CHANNEL':c.medium==='radio'?'RADIO':'TV CHANNEL';$('quality').textContent=c.medium==='tv'?'HLS':'AUDIO';$('main-fav').classList.toggle('saved',favorites.has(id));renderSchedule();renderGrid();window.scrollTo({top:0,behavior:'smooth'})}
function toggleFavorite(id){if(favorites.has(id)){favorites.delete(id);toast('즐겨찾기에서 뺐어요')}else{favorites.add(id);toast('즐겨찾기에 넣었어요')}saveState();$('main-fav').classList.toggle('saved',favorites.has(state.selected));renderGrid()}
function listForView(){let list=channels.filter(c=>c.medium==='tv');if(state.view==='radio')list=channels.filter(c=>c.medium==='radio');if(state.view==='personal')list=channels.filter(c=>c.medium==='personal');if(state.view==='favorites')list=channels.filter(c=>favorites.has(c.id));if(state.view==='history')list=recent.map(id=>channels.find(c=>c.id===id)).filter(Boolean);if(state.view==='esports')list=[];if(state.country!=='all')list=list.filter(c=>c.country===state.country);const q=state.search.trim().toLocaleLowerCase();if(q)list=list.filter(c=>(c.name+' '+c.desc+' '+c.genre).toLocaleLowerCase().includes(q));return list}
function renderFilters(){const show=state.view!=='personal'&&state.view!=='esports';$('filter-row').classList.toggle('hidden',!show);$('country-filters').innerHTML=countries.map(([id,label])=>'<button class="filter-chip '+(state.country===id?'active':'')+'" data-country="'+id+'">'+label+'</button>').join('');document.querySelectorAll('[data-country]').forEach(b=>b.addEventListener('click',()=>{state.country=b.dataset.country;renderFilters();renderGrid()}))}
function renderGrid(){const list=listForView();$('channel-grid').innerHTML=list.map(c=>'<article class="channel-card '+(state.selected===c.id?'selected':'')+'" data-channel="'+c.id+'" tabindex="0" role="button" aria-label="'+c.name+' 선택"><div class="tile-art '+(c.theme==='cyan'?'':c.theme)+'"><span class="country">'+flags[c.country]+'</span><span class="channel-logo">'+c.brand+'</span><button class="fav-corner '+(favorites.has(c.id)?'is-on':'')+'" data-fav="'+c.id+'" aria-label="'+c.name+' 즐겨찾기"><svg class="i sm"><use href="#ic-heart"/></svg></button></div><div class="tile-info"><strong class="tile-name">'+c.name+'</strong><div class="tile-meta"><span class="genre">'+c.genre+'</span><span class="test">접속 미확인</span></div></div></article>').join('')||'<div class="empty-state"><strong>'+(state.view==='favorites'?'즐겨찾기한 채널이 없어요':state.view==='esports'?'공식 링크 카드를 이용하세요':state.view==='history'?'최근 선택한 채널이 없어요':'검색 결과가 없어요')+'</strong><p>'+(state.view==='favorites'?'채널 카드의 하트를 눌러 담아 두세요.':state.view==='esports'?'아래 LCK · Worlds 외부 링크를 선택하세요.':state.view==='history'?'채널을 선택하면 여기에서 다시 볼 수 있어요.':'다른 국가나 검색어로 찾아보세요.')+'</p></div>';
  document.querySelectorAll('[data-channel]').forEach(el=>{el.addEventListener('click',e=>{if(e.target.closest('[data-fav]'))return;selectChannel(el.dataset.channel)});el.addEventListener('keydown',e=>{if(e.target===el&&(e.key==='Enter'||e.key===' ')){e.preventDefault();selectChannel(el.dataset.channel)}})});document.querySelectorAll('[data-fav]').forEach(el=>el.addEventListener('click',e=>{e.stopPropagation();toggleFavorite(el.dataset.fav)}));$('grid-meta').textContent=list.length+'개';
  $('recent-container').classList.toggle('hidden',state.view!=='home'||recent.length===0);$('recent-line').innerHTML=recent.slice(0,5).map(id=>channels.find(c=>c.id===id)).filter(Boolean).map(c=>'<button class="recent-pill" data-recent="'+c.id+'">'+flags[c.country]+' '+c.name+'</button>').join('');document.querySelectorAll('[data-recent]').forEach(b=>b.addEventListener('click',()=>selectChannel(b.dataset.recent)))}
function changeView(view){state.view=view;state.country='all';state.search='';$('search-field').value='';document.querySelectorAll('[data-view]').forEach(el=>el.classList.toggle('active',el.dataset.view===view));$('breadcrumb-text').textContent=viewLabels[view][0];$('page-heading').innerHTML=viewLabels[view][1]+'<span class="dot">.</span>';$('page-subheading').textContent=viewLabels[view][2];$('grid-heading').textContent=({home:'추천 TV 채널',tv:'TV 채널 둘러보기',radio:'라디오 채널',personal:'내 방송 채널',favorites:'나의 즐겨찾기',history:'최근 시청 채널',esports:'공식 경기 시청 안내'})[view];$('custom-only').classList.toggle('hidden',view!=='personal');$('feature-grid').classList.toggle('hidden',view==='personal'||view==='history'||view==='favorites');if(view==='personal')selectChannel('park');renderFilters();renderGrid();if(view==='esports'){$('feature-grid').classList.remove('hidden');$('feature-grid').scrollIntoView({block:'nearest',behavior:'smooth'})}else window.scrollTo({top:0,behavior:'smooth'})}
document.querySelectorAll('[data-view]').forEach(el=>el.addEventListener('click',()=>changeView(el.dataset.view)));
$('search-field').addEventListener('input',e=>{state.search=e.target.value;renderGrid()});
$('main-fav').addEventListener('click',()=>toggleFavorite(state.selected));
$('main-play').addEventListener('click',()=>toast('재생은 다음 단계에서 연결돼요'));
$('main-volume').addEventListener('click',()=>toast('볼륨은 재생기 연결 뒤'));
$('main-expand').addEventListener('click',()=>toast('전체 화면은 재생기 연결 뒤'));
$('notification-button').addEventListener('click',()=>toast('알림은 아직 없어요'));
$('guide-button').addEventListener('click',()=>toast('TV · 라디오 · 내 채널 — 공개 방송만, 폰이 직접 재생'));
$('custom-edit').addEventListener('click',()=>toast('편성 수정은 다음 단계'));
$('schedule-button').addEventListener('click',()=>{changeView('personal');document.querySelector('.schedule').scrollIntoView({block:'nearest',behavior:'smooth'})});
$('radio-open').addEventListener('click',()=>changeView('radio'));
selectChannel('park');changeView('home');renderSchedule();setInterval(renderSchedule,30000);
</script>
</body>
</html>`;
