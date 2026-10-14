// =========================================================
// ♟ 象棋 · 중국 장기 — 규칙 안내 + 봇 대국. 서버 호출 없음(오프라인), 판은 localStorage tp-xq (GET /xiangqi)
// 수 생성은 perft 44/1920/79666 으로 검증. 봇은 네가맥스 알파베타+반복 심화(쉬움2·보통3·어려움5수, 시간 제한).
// =========================================================
export const XIANGQI_HTML = String.raw`<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#1664B0">
<meta name="apple-mobile-web-app-capable" content="yes">
<link rel="apple-touch-icon" href="/icon-180.png">
<title>象棋</title>
<style>
:root{--sky:#1664B0;--bg:#EFE8DE;--card:#F7F2EA;--ink:#1A2330;--ink2:#5E6672;--line:#D9CEBD;--red:#D21624;--green:#1664B0;--clay:#D21624;--cream:#F7F2EA;--paper:#EFE8DE;--muted:#5E6672;--rule:#D9CEBD}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,"Apple SD Gothic Neo",system-ui,sans-serif}
header{background:var(--sky);color:#fff;padding:calc(env(safe-area-inset-top) + 14px) 16px 14px;border-bottom:3px solid var(--red);display:flex;align-items:center;gap:12px}
header h1{margin:0;font-size:19px}a.back{color:#fff;text-decoration:none;font-size:20px}
main{max-width:640px;margin:0 auto;padding:12px 16px 48px}.m{font-size:13px;color:var(--ink2);margin:0 0 6px}
.status{padding:9px 12px;border-radius:8px;font-size:13px;font-weight:700;background:var(--card);border-left:3px solid var(--sky);margin:6px 0}
</style></head><body>
<header><a class="back" href="/hub" aria-label="도구함">‹</a><h1>♟ 象棋 · 중국 장기</h1></header>
<main><div class="xq">
<p class="m">홍(红, 아래)이 먼저 둡니다. 말을 탭하면 갈 수 있는 자리가 보이고, 자리를 탭하면 둡니다. 봇은 폰에서 바로 계산(서버 없음, 오프라인 OK).</p>
<div class="bar">
<label>봇 <select id="lv"><option value="2">쉬움</option><option value="3" selected>보통</option><option value="5">어려움</option></select></label>
<button class="b2" id="undo">↶ 무르기</button><button class="b2" id="flip">색 바꾸기</button><button class="b2" id="new">새 판</button><button class="b2" id="help">📖 규칙</button>
</div>
<div id="msg" class="status ok">홍 차례 — 말을 고르세요.</div>
<canvas id="bd"></canvas>
<div id="cap" class="cap"></div>
<section class="box" id="rules" hidden>
<h2>한국 장기와 다른 점 7가지</h2>
<ol>
<li><b>판</b>: 말은 교차점 위. 가운데 <b>강(楚河·漢界)</b>이 있고, 궁(九宫)은 3×3 — 한국 장기와 같지만 궁 대각선은 <b>사·장만</b> 씁니다.</li>
<li><b>장(将/帅)</b>: 궁 안에서 <b>직선 1칸</b>만(대각선 ✗). <b>두 장이 같은 줄에서 마주 보면 안 됨</b>(사이에 말이 없으면 그 수는 불법 — "飞将"). 한국 장기엔 없는 규칙이라 제일 많이 당하는 부분.</li>
<li><b>사(士/仕)</b>: 궁 안 <b>대각선 1칸</b>만. 한국은 직선도 가지만 중국은 대각만.</li>
<li><b>상(象/相)</b>: <b>田자(대각 2칸)</b>, 가운데(象眼)에 말이 있으면 못 감, <b>강을 못 건넘</b> — 순수 수비 말. 한국 상(用자, 강 건넘)과 완전히 다름.</li>
<li><b>마(马)</b>: 日자, 바로 옆(马腿)에 말이 있으면 막힘. 한국과 같음.</li>
<li><b>포(炮)</b>: <b>이동은 차처럼 직진</b>, <b>잡을 때만 딱 하나를 넘어서</b>. 한국 포는 이동도 넘어야 하고 포끼리 못 넘지만, 중국 포는 아무 말이나 넘어 잡고 포도 잡음.</li>
<li><b>졸(兵/卒)</b>: 앞으로 1칸, <b>강을 건너면 옆으로도</b> 1칸. 뒤로는 끝까지 못 감. 한국 졸은 처음부터 옆으로 감.</li>
</ol>
<h2>승패</h2>
<p>외통(将死)이면 짐. <b>둘 곳이 없어도 짐</b>(한국·체스의 비김과 다름). 같은 수로 계속 장군(长将)은 금지 — 이 앱은 안 막으니 스스로 피하세요.</p>
<h2>첫 수 세 가지</h2>
<p><b>中炮(炮二平五)</b>: 오른쪽 포를 가운데로 — 가장 공격적, 초보 추천. <b>飞象(相三进五)</b>: 상을 가운데로 올려 수비. <b>仙人指路(兵三进一)</b>: 졸 한 칸 — 상대 속 떠보기. 공원에서 아저씨들은 거의 中炮 vs 屏风马(양쪽 마를 올려 받기).</p>
<h2>말 가치(대략)</h2>
<p>차 9 · 포 4.5 · 마 4 · 상 2 · 사 2 · 졸 1(강 건너면 2). 초반엔 포, 후반엔 마가 세집니다. 차 하나 = 마+포.</p>
</section>
</div>
<style>
.xq .bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:8px 0}.xq .bar label{font-size:12.5px;display:flex;align-items:center;gap:4px}.xq select{font:inherit;font-size:13px;padding:4px 6px;border:1px solid var(--rule);border-radius:6px;background:#fff}
.xq .b2{font:inherit;font-size:12.5px;font-weight:700;padding:6px 10px;border-radius:8px;border:1px solid var(--rule);background:#fff;color:var(--green);cursor:pointer}
.xq canvas{display:block;width:100%;max-width:460px;margin:8px auto 0;touch-action:manipulation;border-radius:8px}
.xq .cap{font-size:12px;color:var(--muted);text-align:center;margin-top:6px;min-height:1.2em}
.xq .box{background:var(--cream);border:1px solid var(--rule);border-radius:12px;padding:14px;margin-top:14px;font-size:13.5px}.xq .box h2{margin:12px 0 4px;font-size:15px}.xq .box h2:first-child{margin-top:0}.xq ol{padding-left:18px;margin:4px 0}.xq li{margin:4px 0}.xq .box p{margin:4px 0}
.xq .status.think{border-left-color:var(--clay)}
</style>
<script>
(function(){
var $=function(i){return document.getElementById(i)};
// 판: 10행×9열, 0행=위(흑), 9행=아래(홍). 대문자=홍(K A B N R C P), 소문자=흑
var INIT='rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR';
var CH={K:'帅',A:'仕',B:'相',N:'马',R:'车',C:'炮',P:'兵',k:'将',a:'士',b:'象',n:'马',r:'车',c:'炮',p:'卒'};
var VAL={K:10000,A:200,B:200,N:400,R:900,C:450,P:100};
function parse(f){var b=[];f.split('/').forEach(function(row){for(var i=0;i<row.length;i++){var c=row[i];if(c>='1'&&c<='9'){for(var j=0;j<+c;j++)b.push('')}else b.push(c)}});return b}
var B,turn,hist,sel,moves,human='r',busy=false,LV=3;
function red(p){return p&&p===p.toUpperCase()}function side(p){return !p?'':red(p)?'r':'b'}
function at(r,c){return (r<0||r>9||c<0||c>8)?null:B[r*9+c]}
function inPal(r,c,s){return c>=3&&c<=5&&(s==='r'?r>=7:r<=2)}
// 가짜 수(자기 장군 검사 전) 생성
function pseudo(b,s){var out=[];for(var i=0;i<90;i++){var p=b[i];if(!p||side(p)!==s)continue;var r=(i/9)|0,c=i%9,t=p.toUpperCase();
  var g=function(rr,cc){if(rr<0||rr>9||cc<0||cc>8)return false;var q=b[rr*9+cc];if(q&&side(q)===s)return false;out.push([i,rr*9+cc]);return !q};
  if(t==='K'){[[1,0],[-1,0],[0,1],[0,-1]].forEach(function(d){var rr=r+d[0],cc=c+d[1];if(inPal(rr,cc,s))g(rr,cc)});var f2=s==='r'?-1:1,rr2=r+f2;while(rr2>=0&&rr2<=9){var q2=b[rr2*9+c];if(q2){if(q2.toUpperCase()==='K')out.push([i,rr2*9+c]);break}rr2+=f2}}
  else if(t==='A'){[[1,1],[1,-1],[-1,1],[-1,-1]].forEach(function(d){var rr=r+d[0],cc=c+d[1];if(inPal(rr,cc,s))g(rr,cc)})}
  else if(t==='B'){[[2,2],[2,-2],[-2,2],[-2,-2]].forEach(function(d){var rr=r+d[0],cc=c+d[1];if(rr<0||rr>9||cc<0||cc>8)return;if(s==='r'?rr<5:rr>4)return;if(b[(r+d[0]/2)*9+c+d[1]/2])return;g(rr,cc)})}
  else if(t==='N'){[[2,1,1,0],[2,-1,1,0],[-2,1,-1,0],[-2,-1,-1,0],[1,2,0,1],[-1,2,0,1],[1,-2,0,-1],[-1,-2,0,-1]].forEach(function(d){var lr=r+d[2],lc=c+d[3];if(lr<0||lr>9||lc<0||lc>8||b[lr*9+lc])return;g(r+d[0],c+d[1])})}
  else if(t==='R'||t==='C'){[[1,0],[-1,0],[0,1],[0,-1]].forEach(function(d){var rr=r+d[0],cc=c+d[1],jumped=false;while(rr>=0&&rr<=9&&cc>=0&&cc<=8){var q=b[rr*9+cc];
    if(t==='R'){if(q){if(side(q)!==s)out.push([i,rr*9+cc]);break}out.push([i,rr*9+cc])}
    else{if(!jumped){if(q)jumped=true;else out.push([i,rr*9+cc])}else{if(q){if(side(q)!==s)out.push([i,rr*9+cc]);break}}}
    rr+=d[0];cc+=d[1]}})}
  else if(t==='P'){var f=s==='r'?-1:1;g(r+f,c);var crossed=s==='r'?r<=4:r>=5;if(crossed){g(r,c+1);g(r,c-1)}}
 }return out}
function kingPos(b,s){var k=s==='r'?'K':'k';for(var i=0;i<90;i++)if(b[i]===k)return i;return -1}
function attacked(b,s){var k=kingPos(b,s);if(k<0)return true;var o=s==='r'?'b':'r';var ms=pseudo(b,o);for(var i=0;i<ms.length;i++)if(ms[i][1]===k)return true;return false}
function legal(b,s){return pseudo(b,s).filter(function(m){var q=b[m[1]];b[m[1]]=b[m[0]];b[m[0]]='';var bad=attacked(b,s);b[m[0]]=b[m[1]];b[m[1]]=q;return !bad})}
// 평가(홍 기준 +)
var PST_P=[0,0,0,0,0,0,0,0,0, 90,90,110,120,120,120,110,90,90, 90,90,110,120,120,120,110,90,90, 70,90,100,110,110,110,100,90,70, 70,70,70,70,70,70,70,70,70, 0,0,0,0,0,0,0,0,0];
function evalB(b){var sc=0;for(var i=0;i<90;i++){var p=b[i];if(!p)continue;var t=p.toUpperCase(),v=VAL[t],r=(i/9)|0;
  if(t==='P'){var rr=red(p)?r:9-r;v=rr<=4?(PST_P[rr*9+i%9]||100)+100:100}
  else if(t==='N'||t==='R'||t==='C'){var cc=i%9;v+=(4-Math.abs(cc-4))*4}
  sc+=red(p)?v:-v}return sc}
var nodes,deadline,abort;
// 가짜 수로 탐색 — 상대 장을 잡는 수가 있으면 직전 수가 불법이었다는 뜻(큰 점수). 마주보기도 장이 장을 '잡는' 수로 처리
function search(b,s,depth,alpha,beta){nodes++;if((nodes&2047)===0&&Date.now()>deadline)abort=true;if(abort)return 0;
  var ms=pseudo(b,s);for(var k=0;k<ms.length;k++){var tq=b[ms[k][1]];if(tq&&tq.toUpperCase()==='K')return 99999-(10-depth)}
  if(depth===0)return (s==='r'?1:-1)*evalB(b);
  if(!ms.length)return -99999+(10-depth);
  ms.sort(function(x,y){return (b[y[1]]?VAL[b[y[1]].toUpperCase()]:0)-(b[x[1]]?VAL[b[x[1]].toUpperCase()]:0)});
  var o=s==='r'?'b':'r',best=-1e9;
  for(var i=0;i<ms.length;i++){var m=ms[i],q=b[m[1]];b[m[1]]=b[m[0]];b[m[0]]='';var v=-search(b,o,depth-1,-beta,-alpha);b[m[0]]=b[m[1]];b[m[1]]=q;if(abort)return 0;if(v>best)best=v;if(v>alpha)alpha=v;if(alpha>=beta)break}
  return best}
function botMove(s){var ms=legal(B,s);if(!ms.length)return null;var o=s==='r'?'b':'r';var bestM=ms[0],ms2=ms.slice();
  ms2.sort(function(x,y){return (B[y[1]]?VAL[B[y[1]].toUpperCase()]:0)-(B[x[1]]?VAL[B[x[1]].toUpperCase()]:0)});
  deadline=Date.now()+(LV>=5?2500:LV===3?1200:400);abort=false;nodes=0;
  for(var d=1;d<=LV;d++){var bm=null,bv=-1e9,a=-1e9;
    for(var i=0;i<ms2.length;i++){var m=ms2[i],q=B[m[1]];B[m[1]]=B[m[0]];B[m[0]]='';var v=-search(B,o,d-1,-1e9,-a);B[m[0]]=B[m[1]];B[m[1]]=q;if(abort)break;
      v+=Math.random()*3;if(v>bv){bv=v;bm=m}if(v>a)a=v}
    if(abort)break;bestM=bm;if(bv>90000)break}
  return bestM}
// 그리기
var cv=$('bd'),cx=cv.getContext('2d'),CS,OX,OY,last=null;
function size(){var w=Math.min(460,cv.parentNode.clientWidth||360);CS=Math.floor((w-20)/9);var W=CS*9+20,H=CS*10+20;cv.width=W*2;cv.height=H*2;cv.style.height=H+'px';cx.setTransform(2,0,0,2,0,0);OX=10+CS/2;OY=10+CS/2;if(B)draw()}
function xy(r,c){return [OX+c*CS,OY+r*CS]}
function draw(){var W=CS*9+20,H=CS*10+20;cx.fillStyle='#E6DCCB';cx.fillRect(0,0,W,H);cx.strokeStyle='#5E6672';cx.lineWidth=1;
  for(var r=0;r<10;r++){var a=xy(r,0),b=xy(r,8);cx.beginPath();cx.moveTo(a[0],a[1]);cx.lineTo(b[0],b[1]);cx.stroke()}
  for(var c=0;c<9;c++){var a1=xy(0,c),b1=xy(4,c),a2=xy(5,c),b2=xy(9,c);cx.beginPath();if(c===0||c===8){cx.moveTo(a1[0],a1[1]);cx.lineTo(b2[0],b2[1])}else{cx.moveTo(a1[0],a1[1]);cx.lineTo(b1[0],b1[1]);cx.moveTo(a2[0],a2[1]);cx.lineTo(b2[0],b2[1])}cx.stroke()}
  [[0,3,2,5],[7,3,9,5]].forEach(function(p){var a=xy(p[0],p[1]),b=xy(p[2],p[3]),c1=xy(p[0],p[3]),d=xy(p[2],p[1]);cx.beginPath();cx.moveTo(a[0],a[1]);cx.lineTo(b[0],b[1]);cx.moveTo(c1[0],c1[1]);cx.lineTo(d[0],d[1]);cx.stroke()});
  cx.fillStyle='#5E6672';cx.font='bold '+Math.round(CS*.42)+'px serif';cx.textAlign='center';cx.textBaseline='middle';var m=xy(4.5,2),n=xy(4.5,6);cx.fillText('楚 河',m[0],m[1]);cx.fillText('漢 界',n[0],n[1]);
  if(last){[last[0],last[1]].forEach(function(i){var p=xy((i/9)|0,i%9);cx.strokeStyle='#1664B0';cx.lineWidth=2;cx.strokeRect(p[0]-CS*.46,p[1]-CS*.46,CS*.92,CS*.92)})}
  for(var i=0;i<90;i++){var p=B[i];if(!p)continue;var q=xy((i/9)|0,i%9),R=CS*.43;cx.beginPath();cx.arc(q[0],q[1],R,0,7);cx.fillStyle='#F7F1E6';cx.fill();cx.lineWidth=2;cx.strokeStyle=red(p)?'#D21624':'#1A2330';cx.stroke();cx.beginPath();cx.arc(q[0],q[1],R*.82,0,7);cx.stroke();
    cx.fillStyle=red(p)?'#D21624':'#1A2330';cx.font='bold '+Math.round(CS*.5)+'px "PingFang SC","Noto Sans SC",serif';cx.fillText(CH[p],q[0],q[1]+1)}
  if(sel!=null){var s=xy((sel/9)|0,sel%9);cx.strokeStyle='#1664B0';cx.lineWidth=3;cx.beginPath();cx.arc(s[0],s[1],CS*.47,0,7);cx.stroke();
    moves.forEach(function(mv){var t=xy((mv[1]/9)|0,mv[1]%9);cx.fillStyle=B[mv[1]]?'rgba(210,22,36,.55)':'rgba(22,100,176,.55)';cx.beginPath();cx.arc(t[0],t[1],CS*(B[mv[1]]?.2:.14),0,7);cx.fill()})}
}
function status(t,think){$('msg').textContent=t;$('msg').className='status '+(think?'think':'ok')}
function capText(){var r=[],b=[];for(var i=0;i<90;i++){var p=B[i];if(!p)continue;(red(p)?r:b).push(p)}
  var cnt=function(arr){var m={};arr.forEach(function(p){m[p.toUpperCase()]=(m[p.toUpperCase()]||0)+1});return m};var cr=cnt(r),cb=cnt(b),full={R:2,N:2,B:2,A:2,C:2,P:5};
  var lost=function(c,s){var o=[];Object.keys(full).forEach(function(t){var n=full[t]-(c[t]||0);for(var k=0;k<n;k++)o.push(CH[s==='r'?t:t.toLowerCase()])});return o.join(' ')||'없음'};
  $('cap').textContent='잡힌 말 — 홍: '+lost(cr,'r')+' · 흑: '+lost(cb,'b')}
function save(){try{localStorage.setItem('tp-xq',JSON.stringify({B:B,turn:turn,hist:hist,human:human,last:last}))}catch(e){}}
function end(){var ms=legal(B,turn);if(ms.length)return false;var chk=attacked(B,turn);status((turn==='r'?'홍':'흑')+(chk?' 외통(将死)':' 둘 곳 없음(困毙)')+' — '+(turn===human?'졌습니다 😅':'이겼습니다 🎉')+' · 새 판으로');return true}
function play(m){last=m;B[m[1]]=B[m[0]];B[m[0]]='';hist.push(m);turn=turn==='r'?'b':'r';sel=null;moves=[];draw();capText();save()}
function afterHuman(){if(end())return;var chk=attacked(B,turn);status('봇 생각 중…'+(chk?' (장군!)':''),true);busy=true;
  setTimeout(function(){var m=botMove(turn);busy=false;if(!m){end();return}var q=B[m[1]];play([m[0],m[1]]);if(end())return;
    var c2=attacked(B,turn);status((turn==='r'?'홍':'흑')+' 차례'+(q?' — 봇이 '+CH[q]+'를 잡았습니다':'')+(c2?' · 장군!':''))},50)}
cv.addEventListener('click',function(e){if(busy||turn!==human)return;var rc=cv.getBoundingClientRect(),x=(e.clientX-rc.left)*(cv.width/2/rc.width),y=(e.clientY-rc.top)*(cv.height/2/rc.height);
  var c=Math.round((x-OX)/CS),r=Math.round((y-OY)/CS);if(r<0||r>9||c<0||c>8)return;var i=r*9+c;
  if(sel!=null){var mv=moves.filter(function(m){return m[1]===i})[0];if(mv){play(mv);afterHuman();return}}
  var p=B[i];if(p&&side(p)===human){sel=i;moves=legal(B,human).filter(function(m){return m[0]===i});if(!moves.length)status('그 말은 지금 둘 수 없습니다(장군이 걸리거나 장이 마주 봄)');draw()}else{sel=null;moves=[];draw()}});
function newGame(){B=parse(INIT);turn='r';hist=[];sel=null;moves=[];last=null;draw();capText();save();status('홍 차례 — 말을 고르세요.');if(human==='b')afterHuman()}
$('new').onclick=newGame;
$('undo').onclick=function(){if(busy||hist.length<2)return;hist.splice(-2,2);var h=hist.slice();B=parse(INIT);turn='r';hist=[];last=null;h.forEach(function(m){B[m[1]]=B[m[0]];B[m[0]]='';hist.push(m);turn=turn==='r'?'b':'r';last=m});sel=null;moves=[];draw();capText();save();status((turn==='r'?'홍':'흑')+' 차례')};
$('flip').onclick=function(){if(busy)return;human=human==='r'?'b':'r';status('이제 '+(human==='r'?'홍':'흑')+'을 둡니다');if(turn!==human)afterHuman()};
$('lv').onchange=function(){LV=+this.value};
$('help').onclick=function(){$('rules').hidden=!$('rules').hidden};
window.addEventListener('resize',size);
(function(){var s=null;try{s=JSON.parse(localStorage.getItem('tp-xq')||'null')}catch(e){}
  if(s&&s.B&&s.B.length===90){B=s.B;turn=s.turn;hist=s.hist||[];human=s.human||'r';last=s.last||null;sel=null;moves=[];size();capText();if(!end()){status((turn==='r'?'홍':'흑')+' 차례');if(turn!==human)afterHuman()}}
  else{human='r';size();newGame()}})();
})();
</script>
</main></body></html>`;
