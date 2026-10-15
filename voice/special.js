// =========================================================
// 🎓 3년 특례 계산기 — 재외국민 특별전형(해외근무자 자녀) 체류일·학기 계산. 공개 링크(GET /special), 초대 코드 없음.
// 데이터는 보는 사람의 폰(localStorage sp3-v2)에만 저장 — 서버로 보내지 않음. JSON 내보내기/불러오기로 백업.
// 기준(연세대 2027 요강·교육부 공통): 고교 1개 학년(2학기) 포함 중·고교 3개 학년(6학기) 이상 국외 정규학교 수료,
//   학생은 각 기간의 3/4, 부모(배우자 동반 포함)는 2/3 이상 근무지 국가 체류, 기간이 해외근무 안, 재직 3년. 소수점 버림.
//   행은 학기(1·2) 또는 학년 전체(=2학기)로 넣을 수 있어 2학기에 시작한 경우도 계산.
// =========================================================
export const SPECIAL_HTML = String.raw`<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#1664B0">
<meta name="apple-mobile-web-app-capable" content="yes">
<title>3년 특례 계산기</title>
<style>
:root{--sky:#1664B0;--bg:#EFE8DE;--card:#F7F2EA;--ink:#1A2330;--ink2:#5E6672;--line:#D9CEBD;--red:#D21624;--ok:#1E7D46}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,"Apple SD Gothic Neo",system-ui,sans-serif}
header{background:var(--sky);color:#fff;padding:calc(env(safe-area-inset-top) + 14px) 16px 14px;border-bottom:3px solid var(--red)}
header h1{margin:0;font-size:19px}header p{margin:3px 0 0;font-size:12.5px;opacity:.85}
main{max-width:760px;margin:0 auto;padding:12px 16px 80px}
.box{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin-top:12px}
h2{font-size:16px;margin:0 0 6px}.m{font-size:12.5px;color:var(--ink2);margin:0 0 8px}
input,select,button{font:inherit}input,select{font-size:13px;padding:6px 7px;border:1px solid var(--line);border-radius:7px;background:#fff;color:var(--ink)}
.b1,.b2{font-weight:700;border-radius:9px;cursor:pointer;padding:9px 14px}.b1{background:var(--sky);color:#fff;border:0}.b2{background:#fff;color:var(--sky);border:1px solid var(--line);font-size:13px}
table.t{width:100%;border-collapse:collapse;font-size:12.5px}.t th{text-align:left;font-size:11px;color:var(--ink2);font-weight:700;padding:4px;border-bottom:1px solid var(--line)}
.t td{padding:4px;border-bottom:1px solid var(--line);white-space:nowrap;vertical-align:middle}.t input{width:100%;min-width:56px}.t input[type=date]{min-width:124px}.t select{min-width:66px}
.n{text-align:right;font-variant-numeric:tabular-nums}.ok{color:var(--ok);font-weight:800}.bad{color:var(--red);font-weight:800}.dim{color:var(--ink2)}
.x{background:none;border:0;color:var(--red);font-size:16px;cursor:pointer;padding:0 4px}
.quick{display:flex;flex-wrap:wrap;gap:10px;align-items:end;margin:8px 0 12px}.quick label{font-size:12.5px;display:flex;flex-direction:column;gap:3px}
.tabs{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0 2px}.tab{padding:7px 12px;border-radius:999px;border:1px solid var(--line);background:#fff;font-weight:700;font-size:13px;cursor:pointer}.tab.on{background:var(--sky);color:#fff;border-color:var(--sky)}
.pp{display:grid;grid-template-columns:1fr 1fr;gap:14px}.pp>div{display:flex;flex-direction:column;gap:6px}.pp label{font-size:12.5px;display:flex;flex-direction:column;gap:2px}.pp label.row{flex-direction:row;align-items:center;gap:6px}
@media(max-width:560px){.pp{grid-template-columns:1fr}.t{display:block;overflow-x:auto}}
.kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-top:8px}.kv div{background:#fff;border-radius:8px;padding:8px 10px;font-size:12.5px}.kv b{display:block;font-size:15px;margin-top:2px}
.big{font-size:21px;font-weight:800;margin:4px 0}.warn{background:#FBE7EA;border-left:3px solid var(--red);padding:8px 10px;border-radius:6px;font-size:13px;margin-top:8px}
.uni{margin:8px 0;padding:8px 10px;background:#fff;border-radius:8px;font-size:13px}.uni p{margin:3px 0 0;color:var(--ink2)}.uni a{color:var(--sky)}
.rows{display:flex;flex-direction:column;gap:6px;margin-top:6px}.row{background:#fff;border:1px solid var(--line);border-radius:10px;padding:8px 10px}.row.pass{border-left:4px solid var(--ok)}.row.fail{border-left:4px solid var(--red)}.row.na{border-left:4px solid var(--line)}
.row .l1{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.row .l1 input.g{width:52px}.row .l1 select{min-width:0}.row .l1 input[type=date]{min-width:118px}.row .l1 .end{font-size:12.5px;color:var(--ink2)}.row .l1 .v{margin-left:auto;font-weight:800;font-size:13px;white-space:nowrap}
.row .l2{font-size:11.5px;color:var(--ink2);margin-top:4px;display:flex;flex-wrap:wrap;gap:4px 10px}.row .l2 b{font-weight:700}.row .l2 .ok{color:var(--ok)}.row .l2 .bad{color:var(--red)}
.bar{position:fixed;left:0;right:0;bottom:0;padding:10px 16px calc(env(safe-area-inset-bottom) + 10px);background:var(--bg);border-top:1px solid var(--line);display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.toast{position:fixed;left:50%;bottom:90px;transform:translateX(-50%);background:var(--ink);color:#fff;padding:8px 14px;border-radius:999px;font-size:13px;opacity:0;transition:.2s;pointer-events:none}.toast.on{opacity:1}
</style></head><body>
<header><h1>🎓 3년 특례 계산기</h1><p>재외국민 특별전형(해외근무자 자녀) · 학기별 체류일 · 귀임 가능 시점</p></header>
<main>
<p class="m" style="margin-top:12px">입력한 내용은 <b>이 기기(브라우저)에만</b> 저장돼요. 서버로 보내지 않습니다. 다른 기기로 옮기려면 아래 '내보내기'.</p>

<section class="box"><h2>① 자녀</h2>
<div class="tabs" id="ktabs"></div>
<div class="quick" id="kq"></div>
<p class="m">한 행 = 한 학기(또는 학년 전체). 종료일은 <b>다음 행 시작 전날</b>로 자동(방학 포함 — 요강의 산정 방식), 마지막 행만 직접 적어요. 한국에서 다닌 학기는 국가를 한국으로.</p>
<div class="rows" id="yt"></div>
<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button class="b2" id="yadd">+ 학기 행 추가</button><button class="b2" id="kdel" style="color:var(--red)">이 자녀 삭제</button></div>
</section>

<section class="box"><h2>② 부모 (자녀 공통)</h2>
<div class="pp">
<div><b>해외근무자(아빠 기준, 엄마면 그대로 바꿔 쓰세요)</b><label>해외 근무 시작 <input type="date" id="dwork"></label><label>근무 종료(예정, 비우면 계속) <input type="date" id="dworkEnd"></label><label>근무지 국가 체류 시작 <input type="date" id="dstay"></label><label>체류 종료(예정) <input type="date" id="dstayEnd"></label></div>
<div><b>동반 배우자</b><label class="row"><input type="checkbox" id="mon" checked> 체류 요건에 포함(연세대: 배우자 동반)</label><label>체류 시작 <input type="date" id="mstay"></label><label>체류 종료(예정) <input type="date" id="mstayEnd"></label></div>
</div>
</section>

<section class="box"><h2>③ 근무지 국가를 벗어난 기간</h2>
<p class="m">한국 방문·여행 등 체류 국가를 벗어난 날(출국일~입국일). 앞으로 계획도 넣으면 '남은 여유'가 바뀝니다. 출국·입국 당일은 둘 다 '벗어난 날'로 셉니다(보수적).</p>
<table class="t" id="at"><thead><tr><th>누구</th><th>출국</th><th>입국</th><th>일수</th><th>메모</th><th></th></tr></thead><tbody></tbody></table>
<button class="b2" id="aadd" style="margin-top:8px">+ 기간 추가</button>
</section>

<section class="box" id="res"></section>

<section class="box"><h2>기준·메모</h2>
<div class="uni"><b>연세대 (재외국민 특별전형 · 3년)</b><p>고교 1개 학년 포함 중·고교 3개 학년(6학기) 이상 국외 정규학교 수료. 학생은 각 학년(학기) 기간의 3/4, 부모(배우자 동반)는 2/3 이상 체류. 총 초·중·고 23학기 이상, 검정고시·홈스쿨 불인정, 학제 차이로 생긴 1학기 결손 인정. 지원 시 중학교 입학~고교 졸업 출입국 기록 전부 조회. <a href="https://admission.yonsei.ac.kr/seoul/admission/html/abroad/" target="_blank" rel="noopener">입학처 안내 ↗</a></p></div>
<div class="uni"><b>고려대 (재외국민 3년)</b><p>같은 공통 자격(3/4·2/3·배우자 동반·재직 3년). 출국일은 국외 체류로, 입국일은 제외. 학제 차이 1학기 결손 인정, 국내·국외 학기가 겹치면 1학기만 인정. 1단계 서류 100%(3배수) → 1단계 70% + 면접 30%. 2027학년도부터 인문·자연·의학 계열 단위 선발, 모집 78명.</p></div>
<div class="uni"><b>성균관대 (재외국민 3년)</b><p>같은 공통 자격. 출국일 포함·입국일 제외. <b>중간 편입은 편입일부터 365일을 1개 학년으로</b> 봐서 2학기에 시작한 경우에 유리. 1학기 결손 인정. 서류평가 100%(의예과만 2단계 면접 30%). 접수 7월 초(2026학년도는 7/7~7/10).</p></div>
<div class="uni"><b>한양대 (중·고교과정 해외이수자)</b><p>서울 캠퍼스 2027 요강은 웹에서 본문을 못 열어 <b>ERICA 요강 기준</b>으로 넣었어요(같은 학교 공통 규정일 가능성이 높지만 확인 필요): 재직 역년 통산 3년(1,095일, 유학·연수·출장 불인정), <b>입국일은 국외 체류로, 출국일은 제외</b>(다른 대학과 반대), 학제 결손 1학기 인정, 1단계 서류 100%(5배수) → 2단계 자격심사, 면접 없음, 서류 반영 학업 40·진로 40·공동체 20. 서울 접수 2026-07-07~07-09.</p></div>
<p class="m">※ 참고용 계산입니다. 최종 판단은 지원 학년도 모집요강 원문과 입학처 문의로 확인하세요. 특히 출입국 당일 포함 여부·학기 산정 방식은 대학마다 다릅니다.</p>
</section>
<div class="bar"><button class="b1" id="save">💾 저장</button><button class="b2" id="exp">내보내기</button><label class="b2" style="cursor:pointer">불러오기<input type="file" id="imp" accept="application/json" style="display:none"></label><span id="saved" class="m" style="margin:0"></span></div>
</main>
<div class="toast" id="toast"></div>
<script>
(function(){
var $=function(i){return document.getElementById(i)};
var D={kids:[],abs:[],dad:{},mom:{on:true}},K=0;
var GS=['G5','G6','G7','G8','G9','G10','G11','G12'],KO={G5:'초5',G6:'초6',G7:'중1',G8:'중2',G9:'중3',G10:'고1',G11:'고2',G12:'고3'};
function dt(s){if(!s)return null;var p=s.split('-');return Date.UTC(+p[0],+p[1]-1,+p[2])}
function ds(ms){var d=new Date(ms);return d.getUTCFullYear()+'-'+('0'+(d.getUTCMonth()+1)).slice(-2)+'-'+('0'+d.getUTCDate()).slice(-2)}
function days(a,b){return Math.floor((b-a)/864e5)+1}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function uid(){return Math.random().toString(36).slice(2,8)}
function toast(t){var e=$('toast');e.textContent=t;e.classList.add('on');setTimeout(function(){e.classList.remove('on')},1800)}
function kid(){return D.kids[K]}
// 대학별 차이(2026~27 요강): day = 출입국 당일 처리(both 둘 다 벗어난 날로(보수적) / dep 출국일은 국외 체류로 / arr 입국일은 국외 체류로), anchor = 중간 편입 시 편입일부터 365일을 1개 학년으로
var UNI=[
 {k:'ys',n:'연세대',day:'both',anchor:false,m:'1단계 서류 → 2단계 서류+면접 · 접수 7월 초 · 당일 처리 미명시(보수적으로 둘 다 제외) · 학제 차이 1학기 결손 인정'},
 {k:'ku',n:'고려대',day:'dep',anchor:false,m:'서류 100%(3배수) → 1단계 70%+면접 30% · 2027부터 계열 단위 선발 · 출국일은 국외 체류, 입국일 제외 · 국내외 학기 겹침은 1학기만 인정'},
 {k:'sk',n:'성균관대',day:'dep',anchor:true,m:'서류 100%(의예 면접) · 접수 7월 초 · 출국일 포함·입국일 제외 · 중간 편입은 편입일부터 365일을 1개 학년으로(2학기 시작에 유리)'},
 {k:'hy',n:'한양대',day:'arr',anchor:false,m:'서울 캠퍼스 요강 원문 미확인 — ERICA 기준 적용: 서류 100%(5배수)+자격심사, 면접 없음 · 입국일은 국외 체류, 출국일 제외 · 접수 7/7~7/9 · 재직 3년은 발령일·출국일 중 늦은 날부터'}
];
var DAYMODE='both';
// 어떤 사람이 [a,b] 기간 중 근무지 국가에 있던 날 — 체류 시작 전·종료 후 + 벗어난 기간을 뺌
function present(who,stayS,stayE,a,b){
  var len=days(a,b),away=0;
  if(stayS&&stayS>a)away+=days(a,Math.min(b,stayS-864e5));
  if(stayE&&stayE<b)away+=days(Math.max(a,stayE+864e5),b);
  D.abs.forEach(function(x){if(x.who!==who)return;var s=dt(x.s),e=dt(x.e);if(!s||!e||e<s)return;if(DAYMODE==='dep')s+=864e5;else if(DAYMODE==='arr')e-=864e5;if(e<s)return;var lo=Math.max(s,a),hi=Math.min(e,b);if(hi>=lo)away+=days(lo,hi)});
  return Math.max(0,len-away);
}
function calc(k,u){
  DAYMODE=u?u.day:'both';
  if(u&&u.anchor)return calcAnchor(k);
  var out=[],units=0,hiUnits=0,sixth=null,who='k'+k;
  var dS=dt(D.dad.stay),dE=dt(D.dad.stayEnd),mS=dt(D.mom.stay),mE=dt(D.mom.stayEnd),wS=dt(D.dad.work),wE=dt(D.dad.workEnd);
  var rs=(D.kids[k].rows||[]).slice().sort(function(x,y){return (x.s||'')<(y.s||'')?-1:1});
  rs.forEach(function(y,i){
    var a=dt(y.s),nx=rs[i+1]?dt(rs[i+1].s):null,b=nx?nx-864e5:dt(y.e);y._e=b?ds(b):'';if(!a||!b||b<a){out.push({y:y,bad:1});return}
    var len=days(a,b),ns=Math.floor(len*3/4),np=Math.floor(len*2/3),u=y.t==='y'?2:1;
    var ps=present(who,null,null,a,b),pd=present('d',dS,dE,a,b),pm=D.mom.on?present('m',mS,mE,a,b):null;
    var abroad=(y.c||'')!=='kr',inWork=wS?(a>=wS&&(!wE||b<=wE)):false,noP=!wS||!dS||(D.mom.on&&!mS);
    var okS=ps>=ns,okD=pd>=np,okM=!D.mom.on||pm>=np,pass=abroad&&okS&&okD&&okM&&inWork;
    if(noP)pass=false;
    if(pass){units+=u;if(/^G1[0-2]$/.test(y.g))hiUnits+=u;if(units>=6&&hiUnits>=2&&!sixth)sixth=b}
    out.push({y:y,len:len,ns:ns,np:np,ps:ps,pd:pd,pm:pm,okS:okS,okD:okD,okM:okM,abroad:abroad,inWork:inWork,noP:noP,pass:pass,u:u,slackS:ps-ns,slackD:pd-np,slackM:pm==null?null:pm-np});
  });
  var work3=wS?dt(D.dad.work.slice(0,4)*1+3+D.dad.work.slice(4))-864e5:null;
  return {rows:out,units:units,hiUnits:hiUnits,sixth:sixth,work3:work3};
}
// 편입일 기준 365일 창(성균관대 식): 첫 국외 행 시작일부터 365일씩 — 창 안이 전부 국외 행으로 덮여야 하고, 창의 절반 이상이 고교 행이면 고교 학년
function calcAnchor(k){
  var who='k'+k,rows=(D.kids[k].rows||[]).filter(function(y){return dt(y.s)&&dt(y.e)&&(y.c||'')!=='kr'}).sort(function(x,y){return dt(x.s)-dt(y.s)});
  var dS=dt(D.dad.stay),dE=dt(D.dad.stayEnd),mS=dt(D.mom.stay),mE=dt(D.mom.stayEnd),wS=dt(D.dad.work),wE=dt(D.dad.workEnd);
  var out=[],units=0,hiUnits=0,sixth=null;if(!rows.length)return {rows:out,units:0,hiUnits:0,sixth:null,work3:wS?dt(D.dad.work.slice(0,4)*1+3+D.dad.work.slice(4))-864e5:null,anchor:true};
  var a=dt(rows[0].s),last=Math.max.apply(null,rows.map(function(y){return dt(y.e)}));
  while(a+364*864e5<=last){var b=a+364*864e5,len=365,cov=0,hi=0;
    rows.forEach(function(y){var lo=Math.max(dt(y.s),a),hiD=Math.min(dt(y.e),b);if(hiD>=lo){var d=days(lo,hiD);cov+=d;if(/^G1[0-2]$/.test(y.g))hi+=d}});
    var ns=Math.floor(len*3/4),np=Math.floor(len*2/3),ps=present(who,null,null,a,b),pd=present('d',dS,dE,a,b),pm=D.mom.on?present('m',mS,mE,a,b):null;
    var full=cov>=len-3,inWork=wS?(a>=wS&&(!wE||b<=wE)):false,okS=ps>=ns,okD=pd>=np,okM=!D.mom.on||pm>=np,pass=full&&okS&&okD&&okM&&inWork,isHi=hi>=len/2;
    if(pass){units+=2;if(isHi)hiUnits+=2;if(units>=6&&hiUnits>=2&&!sixth)sixth=b}
    out.push({y:{g:(isHi?'고교':'중학')+' 학년',t:'y',s:ds(a),e:ds(b)},len:len,ns:ns,np:np,ps:ps,pd:pd,pm:pm,okS:okS,okD:okD,okM:okM,abroad:full,inWork:inWork,pass:pass,u:2,slackS:ps-ns,slackD:pd-np,slackM:pm==null?null:pm-np});
    a=b+864e5}
  return {rows:out,units:units,hiUnits:hiUnits,sixth:sixth,work3:wS?dt(D.dad.work.slice(0,4)*1+3+D.dad.work.slice(4))-864e5:null,anchor:true};
}
// 귀임 시점을 학기 끝에 맞춤: 요건 충족일이 학기 도중이면 그 학기 끝(다음 학기 시작 전날)으로. 한국 학교는 3월(1~2월 귀임)·9월(6~8월 귀임) 편입
function snapEnd(k,t){var rs=(D.kids[k].rows||[]).slice().sort(function(x,y){return (x.s||'')<(y.s||'')?-1:1});
  for(var i=0;i<rs.length;i++){var a=dt(rs[i].s),b=rs[i+1]?dt(rs[i+1].s)-864e5:dt(rs[i].e);if(!a||!b)continue;if(t>=a&&t<=b)return {t:b,row:rs[i],mid:t<b-864e5*20}}return {t:t,row:null,mid:false}}
function krTerm(t){var d=new Date(t),y=d.getUTCFullYear(),m=d.getUTCMonth()+1;if(m<=2)return y+'년 3월 신학기';if(m<=8)return y+'년 9월(2학기 편입)';return (y+1)+'년 3월 신학기'}
function cell(v,ok,need){return v==null?'<td class="dim">—</td>':'<td class="n '+(ok?'ok':'bad')+'">'+v+'<small class="dim">/'+need+'</small></td>'}
function render(){
  if(!D.kids.length)D.kids.push({id:uid(),name:'자녀 1',rows:[]});if(K>=D.kids.length)K=D.kids.length-1;
  $('ktabs').innerHTML=D.kids.map(function(x,i){return '<button class="tab'+(i===K?' on':'')+'" data-kid="'+i+'">'+esc(x.name)+'</button>'}).join('')+'<button class="tab" data-kid="new">＋ 자녀 추가</button>';
  var k=kid();
  $('kq').innerHTML='<label>이름 <input id="kname" value="'+esc(k.name)+'" style="width:84px"></label><label>지금 학년 <select id="qg">'+GS.map(function(g){return '<option'+(g===(k.q&&k.q.g||'G10')?' selected':'')+'>'+g+'</option>'}).join('')+'</select></label><label>지금 학기 <select id="qs"><option value="1"'+((k.q&&k.q.s)==='2'?'':' selected')+'>1학기</option><option value="2"'+((k.q&&k.q.s)==='2'?' selected':'')+'>2학기</option></select></label>'
    +'<label>1학기 시작 <span><input id="qm1" type="number" min="1" max="12" value="'+(k.q&&k.q.m1||8)+'" style="width:50px"> / <input id="qd1" type="number" min="1" max="31" value="'+(k.q&&k.q.d1||15)+'" style="width:50px"></span></label><label>2학기 시작 <span><input id="qm2" type="number" min="1" max="12" value="'+(k.q&&k.q.m2||2)+'" style="width:50px"> / <input id="qd2" type="number" min="1" max="31" value="'+(k.q&&k.q.d2||1)+'" style="width:50px"></span></label>'
    +'<label>지금 학년도(1학기 시작 연도) <input id="qy" type="number" min="2015" max="2040" value="'+(k.q&&k.q.y||2026)+'" style="width:74px"></label><label>해외 첫 학기 <span><select id="qfg">'+GS.map(function(g){return '<option'+(g===(k.q&&k.q.fg||'G8')?' selected':'')+'>'+g+'</option>'}).join('')+'</select> <select id="qfs"><option value="1"'+((k.q&&k.q.fs)==='2'?'':' selected')+'>1학기</option><option value="2"'+((k.q&&k.q.fs)==='2'?' selected':'')+'>2학기</option></select></span></label><button class="b2" id="qgen">학기 표 만들기</button>';
  var R=calc(K),map={};R.rows.forEach(function(r){map[r.y.id]=r});
  var sorted=(k.rows||[]).slice().sort(function(x,y){return (x.s||'')<(y.s||'')?-1:1});
  $('yt').innerHTML=sorted.map(function(y,i){var r=map[y.id]||{},last=i===sorted.length-1,st=r.bad?'na':r.pass?'pass':(r.noP||!r.abroad)?'na':'fail';
    var v=r.bad?'<span class="dim">날짜?</span>':r.pass?'<span class="ok">✓ '+(r.u===2?'2학기':'1학기')+'</span>':!r.abroad?'<span class="dim">한국</span>':r.noP?'<span class="dim">부모 입력 전</span>':!r.inWork?'<span class="bad">근무기간 밖</span>':'<span class="bad">✗ 체류 부족</span>';
    var nums=r.len?'<span>'+r.len+'일</span><span class="'+(r.okS?'ok':'bad')+'">학생 '+r.ps+'/'+r.ns+'</span><span class="'+(r.okD?'ok':'bad')+'">아빠 '+r.pd+'/'+r.np+'</span>'+(r.pm==null?'':'<span class="'+(r.okM?'ok':'bad')+'">엄마 '+r.pm+'/'+r.np+'</span>'):'';
    return '<div class="row '+st+'" data-id="'+y.id+'"><div class="l1"><input class="g" data-k="g" value="'+esc(y.g)+'" aria-label="학년"><span class="dim" style="font-size:12px">'+(KO[y.g]||'')+'</span><select data-k="t"><option value="1"'+(y.t==='1'?' selected':'')+'>1학기</option><option value="2"'+(y.t==='2'?' selected':'')+'>2학기</option><option value="y"'+(y.t==='y'?' selected':'')+'>학년 전체</option></select><select data-k="c"><option value="cn"'+(y.c==='cn'?' selected':'')+'>중국</option><option value="other"'+(y.c==='other'?' selected':'')+'>다른 해외</option><option value="kr"'+(y.c==='kr'?' selected':'')+'>한국</option></select><input type="date" data-k="s" value="'+esc(y.s)+'">'+(last?'<span class="end">~</span><input type="date" data-k="e" value="'+esc(y.e)+'" aria-label="종료">':'<span class="end">~ '+esc(y._e||'')+'</span>')+'<span class="v">'+v+'</span><button class="x" data-del="'+y.id+'">×</button></div>'+(nums?'<div class="l2">'+nums+'</div>':'')+'</div>'}).join('');
  $('at').querySelector('tbody').innerHTML=D.abs.map(function(x){var s=dt(x.s),e=dt(x.e);return '<tr data-id="'+x.id+'"><td><select data-k="who">'+D.kids.map(function(c,i){return '<option value="k'+i+'"'+(x.who==='k'+i?' selected':'')+'>'+esc(c.name)+'</option>'}).join('')+'<option value="d"'+(x.who==='d'?' selected':'')+'>아빠</option><option value="m"'+(x.who==='m'?' selected':'')+'>엄마</option></select></td><td><input type="date" data-k="s" value="'+esc(x.s)+'"></td><td><input type="date" data-k="e" value="'+esc(x.e)+'"></td><td class="n">'+(s&&e&&e>=s?days(s,e):'')+'</td><td><input data-k="memo" value="'+esc(x.memo)+'" placeholder="한국 방문"></td><td><button class="x" data-del="'+x.id+'">×</button></td></tr>'}).join('');
  $('dwork').value=D.dad.work||'';$('dworkEnd').value=D.dad.workEnd||'';$('dstay').value=D.dad.stay||'';$('dstayEnd').value=D.dad.stayEnd||'';$('mon').checked=!!D.mom.on;$('mstay').value=D.mom.stay||'';$('mstayEnd').value=D.mom.stayEnd||'';
  // 판정 — 자녀 전체
  var h='<h2>④ 판정</h2>';
  D.kids.forEach(function(c,i){var Q=calc(i),ok6=Q.units>=6,hi=Q.hiUnits>=2,all=ok6&&hi&&Q.work3;
    h+='<div class="uni"><b>'+esc(c.name)+'</b> <span class="big '+(all?'ok':'bad')+'" style="font-size:16px">'+(all?'✓ 자격 충족(계획대로 가면)':'✗ 아직 미충족')+'</span>'
      +'<div class="kv"><div>인정 학기<b class="'+(ok6?'ok':'bad')+'">'+Q.units+' / 6</b></div><div>고교 학기 포함<b class="'+(hi?'ok':'bad')+'">'+Q.hiUnits+' / 2</b></div><div>6학기+고교 2학기 완성<b>'+(Q.sixth?ds(Q.sixth):'—')+'</b></div></div>';
    if(Q.sixth&&Q.work3){var earliest=Math.max(Q.sixth,Q.work3),sn=snapEnd(i,earliest);
      h+='<p style="margin:8px 0 0;font-size:13px"><b>요건 충족일 '+ds(earliest)+'</b>'+(sn.mid?' — 학기 도중이라 그날 돌아가면 그 학기('+esc(sn.row.g)+' '+(sn.row.t==='y'?'학년':sn.row.t+'학기')+') 성적이 날아갑니다.':'')+'</p>'
        +'<p style="margin:4px 0 0;font-size:13px">✂️ <b>학기 끝에 맞춘 귀임: '+ds(sn.t)+'</b>'+(sn.row?' ('+esc(sn.row.g)+' '+(sn.row.t==='y'?'학년':sn.row.t+'학기')+' 끝, 방학 포함)':'')+' → 한국 학교 <b>'+krTerm(sn.t+864e5)+'</b>. 그 전에 누구라도 체류 비율이 깨지면 그 학기는 통째로 빠집니다.</p>'}
    h+='<table class="t" style="margin-top:8px"><thead><tr><th>대학</th><th>인정</th><th>고교</th><th>요건 충족</th><th>학기 끝 귀임</th><th>판정</th></tr></thead><tbody>'+UNI.map(function(u){var q=calc(i,u),o6=q.units>=6,oh=q.hiUnits>=2,ok=o6&&oh&&q.work3,er=(q.sixth&&q.work3)?ds(snapEnd(i,Math.max(q.sixth,q.work3)).t):'—';
      return '<tr><td><b>'+u.n+'</b>'+(u.anchor?' <small class="dim">학년(편입일 365일)</small>':'')+'</td><td class="n '+(o6?'ok':'bad')+'">'+q.units+'/6</td><td class="n '+(oh?'ok':'bad')+'">'+q.hiUnits+'/2</td><td>'+(q.sixth?ds(q.sixth):'—')+'</td><td>'+er+'</td><td class="'+(ok?'ok':'bad')+'">'+(ok?'✓':'✗')+'</td></tr>'}).join('')+'</tbody></table>'
      +'<p class="m" style="margin:6px 0 0">출입국 당일 처리(연세대 둘 다 제외·고려대/성균관대 출국일 포함·한양대 입국일 포함)와 성균관대의 편입일 기준 학년 산정을 반영. 한양대 서울은 요강 원문 미확인(ERICA 기준).</p>';
    DAYMODE='both';
    var now=Date.now(),cur=Q.rows.filter(function(r){return r.len&&dt(r.y.s)<=now&&dt(r.y.e)>=now})[0];
    if(cur)h+='<p class="m" style="margin:6px 0 0">이번 학기('+esc(cur.y.g)+') 남은 여유 — 자녀 <b class="'+(cur.slackS>=0?'ok':'bad')+'">'+cur.slackS+'일</b> · 아빠 <b class="'+(cur.slackD>=0?'ok':'bad')+'">'+cur.slackD+'일</b>'+(cur.slackM==null?'':' · 엄마 <b class="'+(cur.slackM>=0?'ok':'bad')+'">'+cur.slackM+'일</b>')+' 더 벗어나도 됨(남은 기간 전부 근무지에 있다고 가정)</p>';
    Q.rows.forEach(function(r){if(!r.len||!r.abroad||r.noP)return;var w=[];if(!r.okS)w.push('자녀 '+r.ps+'일 < '+r.ns+'일');if(!r.okD)w.push('아빠 '+r.pd+'일 < '+r.np+'일');if(D.mom.on&&!r.okM)w.push('엄마 '+r.pm+'일 < '+r.np+'일');if(!r.inWork)w.push('해외 근무 기간 밖');if(w.length)h+='<div class="warn"><b>'+esc(r.y.g)+' '+(r.y.t==='y'?'학년':r.y.t+'학기')+' ('+esc(r.y.s)+'~'+esc(r.y._e||r.y.e)+')</b>: '+w.join(' · ')+'</div>'});
    h+='</div>'});
  h+='<div class="kv"><div>아빠 재직 3년 완성<b>'+(R.work3?ds(R.work3):'근무 시작일 입력')+'</b></div></div>';
  $('res').innerHTML=h;
}
function pad(n){return ('0'+n).slice(-2)}
function gen(){var k=kid(),q={g:$('qg').value,s:$('qs').value,m1:+$('qm1').value,d1:+$('qd1').value,m2:+$('qm2').value,d2:+$('qd2').value,y:+$('qy').value,fg:$('qfg').value,fs:$('qfs').value};k.q=q;
  var ci=GS.indexOf(q.g),fi=GS.indexOf(q.fg);if(ci<0||fi<0||fi>ci)return toast('첫 학년이 지금 학년보다 뒤예요');
  k.rows=[];
  for(var i=fi;i<GS.length;i++){var y0=q.y-(ci-i);
    var s1=y0+'-'+pad(q.m1)+'-'+pad(q.d1),s2=(q.m2<q.m1?y0+1:y0)+'-'+pad(q.m2)+'-'+pad(q.d2),n1=(y0+1)+'-'+pad(q.m1)+'-'+pad(q.d1);
    if(!(i===fi&&q.fs==='2'))k.rows.push({id:uid(),g:GS[i],t:'1',c:'cn',s:s1,e:ds(dt(s2)-864e5)});
    k.rows.push({id:uid(),g:GS[i],t:'2',c:'cn',s:s2,e:ds(dt(n1)-864e5)});}
  render();save(true)}
document.addEventListener('input',function(e){var t=e.target,tr=t.closest('tr');
  if(t.id==='kname'){kid().name=t.value;return}
  var rw=t.closest('.row');
  if(rw&&t.dataset.k){var o1=kid().rows.filter(function(x){return x.id===rw.dataset.id})[0];if(o1){o1[t.dataset.k]=t.value;if(t.type==='date'||t.tagName==='SELECT')render();else if(t.dataset.k==='g'){rw.querySelector('.l1 .dim').textContent=KO[t.value]||''}}return}
  if(tr&&t.dataset.k){var id=tr.dataset.id,o=D.abs.filter(function(x){return x.id===id})[0];if(o){o[t.dataset.k]=t.value;if(t.type==='date'||t.tagName==='SELECT')render()}return}
  var m={dwork:['dad','work'],dworkEnd:['dad','workEnd'],dstay:['dad','stay'],dstayEnd:['dad','stayEnd'],mstay:['mom','stay'],mstayEnd:['mom','stayEnd']}[t.id];
  if(m){D[m[0]][m[1]]=t.value;render()}if(t.id==='mon'){D.mom.on=t.checked;render()}
});
document.addEventListener('change',function(e){if(e.target.id==='kname')render()});
document.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;
  if(b.dataset.kid!=null){if(b.dataset.kid==='new'){D.kids.push({id:uid(),name:'자녀 '+(D.kids.length+1),rows:[]});K=D.kids.length-1}else K=+b.dataset.kid;render();return}
  if(b.dataset.del){kid().rows=kid().rows.filter(function(x){return x.id!==b.dataset.del});D.abs=D.abs.filter(function(x){return x.id!==b.dataset.del});render()}
  if(b.id==='qgen')gen();
  if(b.id==='yadd'){var rows=kid().rows,last=rows.slice().sort(function(x,y){return (x.s||'')<(y.s||'')?-1:1}).pop();var s=last&&last.e?ds(dt(last.e)+864e5):'';rows.push({id:uid(),g:last?last.g:'',t:last&&last.t==='1'?'2':'1',c:'cn',s:s,e:''});render()}
  if(b.id==='kdel'){if(D.kids.length<=1)return toast('자녀는 한 명 이상 있어야 해요');if(!confirm(kid().name+' 자료를 지울까요?'))return;var who='k'+K;D.abs=D.abs.filter(function(x){return x.who!==who});D.kids.splice(K,1);K=0;render();save(true)}
  if(b.id==='aadd'){D.abs.push({id:uid(),who:'k'+K,s:'',e:'',memo:''});render()}
  if(b.id==='save')save();
  if(b.id==='exp'){var a=document.createElement('a');a.href='data:application/json;charset=utf-8,'+encodeURIComponent(JSON.stringify(D));a.download='3년특례_'+new Date().toISOString().slice(0,10)+'.json';a.click()}
});
$('imp').onchange=function(){var f=this.files&&this.files[0];this.value='';if(!f)return;var r=new FileReader();r.onload=function(){try{var j=JSON.parse(r.result);if(!j||!Array.isArray(j.kids))throw 0;D=j;K=0;render();save(true);toast('불러왔어요')}catch(e){toast('파일 형식이 달라요')}};r.readAsText(f)};
function save(q){try{localStorage.setItem('sp3-v2',JSON.stringify(D));$('saved').textContent='이 기기에 저장됨 '+new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});if(!q)toast('저장했어요')}catch(e){toast('저장 실패(사생활 보호 모드?)')}}
(function load(){var s=null;try{s=JSON.parse(localStorage.getItem('sp3-v2')||'null')}catch(e){}
  if(!s){try{var o=JSON.parse(localStorage.getItem('tp-special')||'null');if(o&&o.years){s={kids:[{id:uid(),name:'자녀 1',rows:o.years.map(function(y){return {id:y.id||uid(),g:y.g,t:'y',c:y.c,s:y.s,e:y.e}})}],abs:(o.abs||[]).map(function(x){x.who=x.who==='s'?'k0':x.who;return x}),dad:o.dad||{},mom:o.mom||{on:true}}}}catch(e){}}
  if(s&&Array.isArray(s.kids))D=s;render()})();
})();
</script></body></html>`;
