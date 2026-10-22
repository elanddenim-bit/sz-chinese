// =========================================================
// 🤝 출장자 지원(2026-10-22, GET /guest) — 한국 출장자 접대를 지사원이 이어받을 수 있게
//  · 출장 건: 언제 누가 왔나, 항공편·호텔·차량·담당, 준비 체크리스트(D-14 정보 → D-10 호텔 → D-7 차량 → D-3 일정표 → D-1 픽업 → D+3 정산), 식사 기록(식당·메뉴·분위기·반응)
//  · 손님: 좋아하는 음식 / 못 먹는 음식·알레르기 / 술 / 매운맛 / 메모 + 방문 이력·식당 반응 자동 모음('식사 전에 볼 것')
//  · 업체: 식당·호텔·차량 업체 목록(연락처·단가·메모)
//  접근: 주인(초대 코드, usage:owner) 또는 팀 코드(주인이 설정 탭에서 지정, KV guest:team 에 해시만). 지사원은 초대 코드 없이 팀 코드로.
//  데이터: KV guest:db 문서 하나 {guests, trips, places}. 쓰기는 항목 단위 upsert(같은 id 마지막 저장이 이김), 삭제는 del 표시.
//  팀 코드 틀리면 IP 당 15분에 20회까지(KV guest:fail:<ip>).
// =========================================================
const DB_KEY = "guest:db";
const KINDS = ["guests", "trips", "places"];

async function sha(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function clean(v, depth = 0) {
  if (depth > 5) return null;
  if (typeof v === "string") return v.slice(0, 2000);
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "boolean" || v === null) return v;
  if (Array.isArray(v)) return v.slice(0, 300).map((x) => clean(x, depth + 1));
  if (typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).slice(0, 60)) if (/^[\w-]{1,40}$/.test(k)) o[k] = clean(v[k], depth + 1);
    return o;
  }
  return null;
}
async function load(env) {
  const db = (await env.KV.get(DB_KEY, "json")) || {};
  for (const k of KINDS) if (!Array.isArray(db[k])) db[k] = [];
  return db;
}
async function role(env, b, allowed, hash, ip) {
  if (b.code && allowed(env, b.code)) {
    const h = await hash(String(b.code).trim());
    let o = await env.KV.get("usage:owner");
    if (!o) { await env.KV.put("usage:owner", h); o = h; }
    if (o === h) return "owner";
  }
  const t = String(b.t || "").trim();
  if (t) {
    const fk = "guest:fail:" + ip;
    const n = Number(await env.KV.get(fk)) || 0;
    if (n >= 20) return "locked";
    const th = await env.KV.get("guest:team");
    if (th && th === (await sha("guest|" + t))) return "team";
    await env.KV.put(fk, String(n + 1), { expirationTtl: 900 });
  }
  return null;
}

export async function guestApi(req, env, path, b, allowed, hash) {
  const ip = req.headers.get("cf-connecting-ip") || "";
  const r = await role(env, b, allowed, hash, ip);
  if (r === "locked") return { error: "locked", msg: "잠시 후 다시 시도하세요 请稍后再试" };
  if (!r) return { error: "bad_code", msg: "코드가 맞지 않아요 代码不正确" };
  if (path === "/guest/auth") return { role: r, team: !!(await env.KV.get("guest:team")) };
  if (path === "/guest/data") return { role: r, db: await load(env) };
  if (path === "/guest/put") {
    if (!KINDS.includes(b.kind)) return { error: "kind" };
    const it = clean(b.item || {});
    if (!it || typeof it !== "object" || !/^[\w-]{4,40}$/.test(String(it.id || ""))) return { error: "id" };
    it.upd = Date.now();
    it.by = String(b.me || "").slice(0, 30);
    const db = await load(env);
    const list = db[b.kind];
    const i = list.findIndex((x) => x.id === it.id);
    if (i >= 0) list[i] = it; else list.push(it);
    await env.KV.put(DB_KEY, JSON.stringify(db));
    return { ok: true, item: it };
  }
  if (r !== "owner") return { error: "owner_only", msg: "지사장만 할 수 있어요 仅限支社长" };
  if (path === "/guest/team") {
    const t = String(b.team || "").trim();
    if (t.length < 6) return { error: "short", msg: "팀 코드는 6자 이상" };
    await env.KV.put("guest:team", await sha("guest|" + t));
    return { ok: true };
  }
  if (path === "/guest/import") {
    const src = clean(b.db || {});
    const db = await load(env);
    let n = 0;
    for (const k of KINDS) for (const it of Array.isArray(src[k]) ? src[k] : []) {
      if (!it || !/^[\w-]{4,40}$/.test(String(it.id || ""))) continue;
      it.upd = Date.now(); it.by = it.by || "import";
      const i = db[k].findIndex((x) => x.id === it.id);
      if (i >= 0) db[k][i] = it; else db[k].push(it);
      n++;
    }
    await env.KV.put(DB_KEY, JSON.stringify(db));
    return { ok: true, n };
  }
  return { error: "not_found" };
}

export const GUEST_HTML = String.raw`<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#1A2A4A">
<meta name="apple-mobile-web-app-capable" content="yes">
<title>출장자 지원 出差接待</title>
<style>
:root{--navy:#1A2A4A;--red:#D51030;--grey:#969BA5;--bg:#F4F5F7;--card:#fff;--ink:#1A2330;--ink2:#5E6672;--line:#E1E3E8;--ok:#1E8E5A;--warn:#C77700}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,"PingFang SC","Apple SD Gothic Neo",system-ui,sans-serif}
header{background:var(--navy);color:#fff;padding:calc(env(safe-area-inset-top) + 12px) 16px 12px;border-bottom:3px solid var(--red);display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:5}
header h1{margin:0;font-size:17px;flex:1}header button{background:none;border:0;color:#fff;font-size:22px;padding:0 4px}
main{max-width:680px;margin:0 auto;padding:12px 16px calc(90px + env(safe-area-inset-bottom))}
nav{position:fixed;left:0;right:0;bottom:0;background:#fff;border-top:1px solid var(--line);display:flex;padding-bottom:env(safe-area-inset-bottom);z-index:5}
nav button{flex:1;border:0;background:none;padding:9px 0 8px;font-size:12px;color:var(--ink2)}nav button b{display:block;font-size:20px;line-height:1.2}nav button.on{color:var(--red);font-weight:700}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin:0 0 10px}
.card.tap{cursor:pointer}.row{display:flex;gap:8px;align-items:center}.grow{flex:1;min-width:0}
.t{font-weight:700}.s{color:var(--ink2);font-size:13px}.zh{color:var(--grey);font-size:12px;font-weight:400}
.badge{display:inline-block;font-size:12px;border-radius:999px;padding:1px 8px;background:#EEF0F4;color:var(--navy);margin:2px 4px 2px 0;white-space:nowrap}
.badge.red{background:#FBE7EA;color:var(--red)}.badge.ok{background:#E3F4EB;color:var(--ok)}.badge.warn{background:#FDF1DD;color:var(--warn)}
h2{font-size:14px;color:var(--navy);margin:18px 0 8px}
label{display:block;font-size:13px;color:var(--ink2);margin:10px 0 4px}
input,select,textarea{width:100%;font:inherit;padding:9px 10px;border:1px solid var(--line);border-radius:9px;background:#fff;color:var(--ink)}
textarea{min-height:64px;resize:vertical}.two{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.btn{display:inline-block;border:0;border-radius:10px;padding:10px 14px;font:inherit;font-weight:700;background:var(--navy);color:#fff;cursor:pointer}
.btn.red{background:var(--red)}.btn.ghost{background:#fff;color:var(--navy);border:1px solid var(--line)}.btn.wide{width:100%;margin-top:10px}.btn.sm{padding:6px 10px;font-size:13px}
.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{border:1px solid var(--line);background:#fff;border-radius:999px;padding:5px 11px;font-size:14px;cursor:pointer}.chip.on{background:var(--navy);color:#fff;border-color:var(--navy)}
.chk{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-top:1px solid var(--line)}.chk:first-child{border-top:0}.chk input{width:22px;height:22px;margin:1px 0 0;flex:none}
.must{border-left:4px solid var(--red)}.note{background:#FBF7EF;border-radius:10px;padding:10px 12px;font-size:14px}
.seg{display:flex;background:#E7E9EE;border-radius:10px;padding:3px;margin-bottom:10px}.seg button{flex:1;border:0;background:none;padding:7px;border-radius:8px;font:inherit;font-size:14px}.seg button.on{background:#fff;font-weight:700}
#sheet{position:fixed;inset:0;background:rgba(10,20,40,.45);display:none;z-index:9;align-items:flex-end;justify-content:center}
#sheet>div{background:var(--bg);width:100%;max-width:680px;max-height:92vh;overflow:auto;border-radius:16px 16px 0 0;padding:16px 16px calc(20px + env(safe-area-inset-bottom))}
#toast{position:fixed;left:50%;bottom:90px;transform:translateX(-50%);background:var(--navy);color:#fff;padding:9px 16px;border-radius:999px;font-size:14px;display:none;z-index:10}
.empty{text-align:center;color:var(--ink2);padding:30px 10px}
.stars{font-size:20px;letter-spacing:4px}
</style></head><body>
<header><button id="back" style="display:none" aria-label="뒤로">‹</button><h1 id="ttl">🤝 출장자 지원 <span class="zh" style="color:#C9CED8">出差接待</span></h1><button id="rf" aria-label="새로고침">↻</button></header>
<main id="m"></main>
<nav id="nav" style="display:none">
<button data-v="trips" class="on"><b>🧳</b>출장 出差</button>
<button data-v="guests"><b>👤</b>손님 客人</button>
<button data-v="places"><b>🍽</b>업체 商家</button>
<button data-v="set"><b>⚙</b>설정 设置</button>
</nav>
<div id="sheet"><div id="sh"></div></div>
<div id="toast"></div>
<script>
var $=function(s){return document.querySelector(s)};
var E=function(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})};
function ls(k,v){try{if(v===undefined)return localStorage.getItem(k);if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,v)}catch(e){return null}}
var AUTH=null,ROLE='',DB={guests:[],trips:[],places:[]},VIEW='trips',PSEG='food',STACK=[],CUR=null;
var ME=ls('gs-me')||'';
function toast(t){var x=$('#toast');x.textContent=t;x.style.display='block';clearTimeout(toast.h);toast.h=setTimeout(function(){x.style.display='none'},2200)}
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,7)}
function today(){return new Date(Date.now()+8*3600e3).toISOString().slice(0,10)}
function addDays(d,n){var t=new Date(d+'T00:00:00Z');t.setUTCDate(t.getUTCDate()+n);return t.toISOString().slice(0,10)}
function diff(a,b){return Math.round((Date.parse(a+'T00:00:00Z')-Date.parse(b+'T00:00:00Z'))/864e5)}
function md(d){return d?Number(d.slice(5,7))+'/'+Number(d.slice(8,10)):''}
function api(p,b){
  var body=Object.assign({},AUTH,{me:ME},b||{});
  return fetch('/guest/'+p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json()}).catch(function(){return {error:'net',msg:'연결 실패 网络错误'}}).then(function(j){if(j.error)throw new Error(j.msg||j.error);return j});
}
function live(k){return DB[k].filter(function(x){return !x.del})}
function byId(k,id){for(var i=0;i<DB[k].length;i++)if(DB[k][i].id===id)return DB[k][i];return null}
function gName(id){var g=byId('guests',id);return g?g.name:'?'}
function put(kind,item){
  return api('put',{kind:kind,item:item}).then(function(j){
    var l=DB[kind],i=-1;for(var n=0;n<l.length;n++)if(l[n].id===j.item.id)i=n;
    if(i>=0)l[i]=j.item;else l.push(j.item);return j.item;
  });
}

// ---------- 로그인 ----------
function login(msg){
  $('#nav').style.display='none';$('#back').style.display='none';
  $('#m').innerHTML='<div class="card" style="margin-top:30px"><div class="t">코드 입력 <span class="zh">输入代码</span></div>'+
  '<p class="s">지사장에게 받은 팀 코드를 넣으세요.<br>请输入支社长提供的团队代码。</p>'+
  '<input id="lc" type="password" autocomplete="off" placeholder="코드 代码"><label>내 이름 我的名字 (기록에 남아요 用于记录)</label><input id="ln" value="'+E(ME)+'">'+
  (msg?'<p class="s" style="color:var(--red)">'+E(msg)+'</p>':'')+'<button class="btn wide" id="lb">들어가기 进入</button></div>';
  $('#lb').onclick=function(){
    var c=$('#lc').value.trim();ME=$('#ln').value.trim();ls('gs-me',ME);if(!c)return;
    tryAuth([{code:c},{t:c}],0);
  };
}
function tryAuth(list,i){
  if(i>=list.length)return login('코드가 맞지 않아요 代码不正确');
  AUTH=list[i];
  api('auth').then(function(j){ROLE=j.role;ls('gs-auth',JSON.stringify(AUTH));start(j)}).catch(function(e){
    if(/잠시/.test(e.message))return login(e.message);tryAuth(list,i+1)});
}
function start(j){
  $('#nav').style.display='flex';
  if(!ME){ME=ROLE==='owner'?'지사장':'';ls('gs-me',ME)}
  reload().then(function(){if(ROLE==='owner'&&j&&!j.team){VIEW='set';navOn()}render()});
}
function reload(){return api('data').then(function(j){DB=j.db;ROLE=j.role})}

// ---------- 화면 전환 ----------
function navOn(){[].forEach.call(document.querySelectorAll('nav button'),function(b){b.classList.toggle('on',b.dataset.v===VIEW)})}
[].forEach.call(document.querySelectorAll('nav button'),function(b){b.onclick=function(){VIEW=b.dataset.v;STACK=[];navOn();render()}});
$('#back').onclick=function(){STACK.pop();render()};
$('#rf').onclick=function(){reload().then(function(){render();toast('최신 内容已更新')}).catch(function(e){toast(e.message)})};
function go(fn){STACK.push(fn);render();scrollTo(0,0)}
function render(){
  $('#back').style.display=STACK.length?'block':'none';
  if(STACK.length)return STACK[STACK.length-1]();
  ({trips:vTrips,guests:vGuests,places:vPlaces,set:vSet})[VIEW]();
}
function sheet(h){$('#sh').innerHTML=h;$('#sheet').style.display='flex'}
function closeSheet(){$('#sheet').style.display='none'}
$('#sheet').onclick=function(e){if(e.target.id==='sheet')closeSheet()};

// ---------- 출장 ----------
var CHK=[
 ['info',-14,'출장 정보 수령 · 담당 지정','收集出差信息·指定负责人'],
 ['hotel',-10,'호텔 예약','预订酒店'],
 ['car',-7,'차량 예약 · 공장 일정 확정','订车·确定看厂日程'],
 ['plan',-3,'일정표 공유 (한·중)','发送中韩行程表'],
 ['pick',-1,'기사에게 픽업 재확인','与司机确认接机'],
 ['after',3,'정산 · 식사 기록 정리','费用结算·整理用餐记录']
];
function due(t,c){return c[0]==='after'?addDays(t.to||t.from,c[1]):addDays(t.from,c[1])}
function tripState(t){
  var td=today(),done=0,late=0;
  CHK.forEach(function(c){var ok=t.chk&&t.chk[c[0]];if(ok)done++;else if(t.from&&td>due(t,c))late++});
  var dd='';if(t.from){var n=diff(t.from,td);if(n>0)dd='D-'+n;else if(td<=(t.to||t.from))dd='진행중 进行中';else dd='완료 已结束'}
  return {done:done,late:late,dd:dd};
}
function vTrips(){
  var td=today(),l=live('trips');
  var up=l.filter(function(t){return !t.from||(t.to||t.from)>=td}).sort(function(a,b){return (a.from||'9').localeCompare(b.from||'9')});
  var past=l.filter(function(t){return t.from&&(t.to||t.from)<td}).sort(function(a,b){return b.from.localeCompare(a.from)});
  var h='<button class="btn red wide" id="nt" style="margin:0 0 12px">+ 새 출장 新出差</button>';
  h+='<h2>예정 · 진행 <span class="zh">即将到来</span></h2>'+(up.length?up.map(tripCard).join(''):'<div class="empty">예정된 출장이 없어요 暂无</div>');
  if(past.length)h+='<h2>지난 출장 <span class="zh">历史记录</span></h2>'+past.map(tripCard).join('');
  $('#m').innerHTML=h;
  $('#nt').onclick=function(){CUR={id:uid(),title:'',from:'',to:'',guests:[],chk:{},meals:[]};go(vTrip)};
  bindTap();
}
function tripCard(t){
  var s=tripState(t);
  return '<div class="card tap" data-trip="'+E(t.id)+'"><div class="row"><div class="grow"><div class="t">'+E(t.title||'(제목 없음)')+'</div>'+
  '<div class="s">'+md(t.from)+(t.to&&t.to!==t.from?' ~ '+md(t.to):'')+' · '+E((t.guests||[]).map(gName).join(', ')||'손님 미정')+'</div></div>'+
  '<div style="text-align:right">'+(s.dd?'<span class="badge">'+E(s.dd)+'</span><br>':'')+
  '<span class="badge '+(s.late?'red':s.done===CHK.length?'ok':'')+'">'+s.done+'/'+CHK.length+(s.late?' · 지연 '+s.late:'')+'</span></div></div></div>';
}
function bindTap(){
  [].forEach.call(document.querySelectorAll('[data-trip]'),function(x){x.onclick=function(){CUR=JSON.parse(JSON.stringify(byId('trips',x.dataset.trip)));go(vTrip)}});
  [].forEach.call(document.querySelectorAll('[data-guest]'),function(x){x.onclick=function(){CUR=JSON.parse(JSON.stringify(byId('guests',x.dataset.guest)));go(vGuest)}});
  [].forEach.call(document.querySelectorAll('[data-place]'),function(x){x.onclick=function(){CUR=JSON.parse(JSON.stringify(byId('places',x.dataset.place)));go(vPlace)}});
}
function dl(id,kind){return '<datalist id="'+id+'">'+live('places').filter(function(p){return p.kind===kind}).map(function(p){return '<option value="'+E(p.name)+'">'}).join('')+'</datalist>'}
function inp(id,lab,val,type,ph,list){return '<label>'+lab+'</label><input id="'+id+'" '+(type?'type="'+type+'" ':'')+(list?'list="'+list+'" ':'')+'value="'+E(val)+'" placeholder="'+E(ph||'')+'">'}
function txt(id,lab,val,ph){return '<label>'+lab+'</label><textarea id="'+id+'" placeholder="'+E(ph||'')+'">'+E(val)+'</textarea>'}
function v(id){var x=$('#'+id);return x?x.value.trim():''}
function vTrip(){
  var t=CUR,s=tripState(t),td=today();
  var h='<div class="card"><div class="row"><div class="grow t" style="font-size:17px">'+E(t.title||'새 출장 新出差')+'</div>'+(s.dd?'<span class="badge">'+E(s.dd)+'</span>':'')+'</div>'+
  (t.by?'<div class="s">마지막 저장 '+E(t.by)+' · '+new Date(t.upd).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})+'</div>':'')+'</div>';
  h+='<h2>준비 체크 <span class="zh">准备清单</span></h2><div class="card">'+(t.from?CHK.map(function(c){
    var ok=t.chk&&t.chk[c[0]],d=due(t,c),late=!ok&&td>d;
    return '<div class="chk"><input type="checkbox" data-c="'+c[0]+'"'+(ok?' checked':'')+'><div class="grow"><div>'+c[2]+' <span class="zh">'+c[3]+'</span></div><div class="s">'+(c[1]<0?'D'+c[1]:'D+'+c[1])+' · '+md(d)+(late?' <span class="badge red">지연 延迟</span>':'')+'</div></div></div>';
  }).join(''):'<div class="s">도착일을 넣으면 체크리스트 기한이 계산돼요 填写日期后自动计算期限</div>')+'</div>';
  h+='<h2>기본 정보 <span class="zh">基本信息</span></h2><div class="card">'+
   inp('f_title','출장명 出差名称',t.title,'','예: SPAO MD 공장 방문')+
   '<div class="two"><div>'+inp('f_from','도착일 到达日期',t.from,'date')+'</div><div>'+inp('f_to','출발일 离开日期',t.to,'date')+'</div></div>'+
   '<label>손님 客人</label><div class="chips" id="gch"></div>'+
   '<div class="row" style="margin-top:8px"><input id="ng" class="grow" placeholder="새 손님 이름 新客人姓名"><button class="btn sm ghost" id="ngb">+ 추가</button></div>'+
   inp('f_purpose','목적 目的',t.purpose,'','공장 실사, 품평회 등')+
   inp('f_fac','방문 공장 拜访工厂',t.fac)+
   '<div class="two"><div>'+inp('f_fin','도착 항공편 到达航班',t.fin,'','KE865 10:30')+'</div><div>'+inp('f_fout','출발 항공편 离开航班',t.fout)+'</div></div>'+
   '<div class="two"><div>'+inp('f_owner','담당 负责人',t.owner)+'</div><div><label>비용 처리 费用</label><select id="f_cost">'+['','법인카드 公司卡','개인 후정산 个人报销','지사 부담 支社承担','요청 부서 请求部门'].map(function(o){return '<option'+(o===(t.cost||'')?' selected':'')+'>'+o+'</option>'}).join('')+'</select></div></div></div>';
  h+='<h2>호텔 · 차량 <span class="zh">酒店·用车</span></h2><div class="card">'+
   inp('f_hotel','호텔 酒店',t.hotel,'','','dlh')+dl('dlh','hotel')+
   '<div class="two"><div>'+inp('f_hconf','예약번호 预订号',t.hconf)+'</div><div>'+inp('f_hnote','객실·메모 房型/备注',t.hnote)+'</div></div>'+
   inp('f_car','차량 업체 用车公司',t.car,'','','dlc')+dl('dlc','car')+
   inp('f_cnote','차량 메모 (기사·차번호·시간) 司机/车牌/时间',t.cnote)+'</div>';
  h+='<h2>식사 기록 <span class="zh">用餐记录</span></h2>'+((t.meals||[]).length?(t.meals||[]).slice().sort(function(a,b){return (a.date||'').localeCompare(b.date||'')}).map(mealCard).join(''):'<div class="card s">아직 없어요. 식사 후 1분만 남겨 주세요. 用餐后请花1分钟记录。</div>')+
   '<button class="btn ghost wide" id="am">+ 식사 기록 添加用餐</button>';
  h+='<h2>메모 <span class="zh">备注</span></h2><div class="card">'+txt('f_note','',t.note,'특이사항, 선물, 다음에 참고할 것')+'</div>';
  h+='<button class="btn wide" id="sv">저장 保存</button><button class="btn ghost wide" id="cp">📋 일정표 복사 复制行程 (한·중)</button>'+
   (byId('trips',t.id)?'<button class="btn ghost wide" id="dt" style="color:var(--red)">삭제 删除</button>':'');
  $('#m').innerHTML=h;
  drawChips();
  [].forEach.call(document.querySelectorAll('[data-c]'),function(x){x.onchange=function(){CUR.chk=CUR.chk||{};CUR.chk[x.dataset.c]=x.checked;collect();saveTrip(true)}});
  $('#ngb').onclick=function(){var n=v('ng');if(!n)return;var g={id:uid(),name:n};put('guests',g).then(function(){CUR.guests=(CUR.guests||[]).concat(g.id);$('#ng').value='';drawChips()}).catch(function(e){toast(e.message)})};
  $('#am').onclick=function(){collect();mealForm(null)};
  [].forEach.call(document.querySelectorAll('[data-meal]'),function(x){x.onclick=function(){collect();mealForm(x.dataset.meal)}});
  $('#sv').onclick=function(){collect();saveTrip(false)};
  $('#cp').onclick=function(){collect();copyPlan()};
  if($('#dt'))$('#dt').onclick=function(){if(!confirm('이 출장을 삭제할까요? 确定删除？'))return;CUR.del=true;put('trips',CUR).then(function(){STACK.pop();render();toast('삭제됨 已删除')})};
}
function drawChips(){
  var sel=CUR.guests||[];
  var gs=live('guests').slice().sort(function(a,b){return (sel.indexOf(b.id)>=0)-(sel.indexOf(a.id)>=0)||(a.name||'').localeCompare(b.name||'')});
  $('#gch').innerHTML=gs.length?gs.map(function(g){return '<span class="chip'+(sel.indexOf(g.id)>=0?' on':'')+'" data-g="'+E(g.id)+'">'+E(g.name)+(g.title?' '+E(g.title):'')+'</span>'}).join(''):'<span class="s">손님을 추가하세요 请添加客人</span>';
  [].forEach.call(document.querySelectorAll('[data-g]'),function(x){x.onclick=function(){var id=x.dataset.g,l=CUR.guests||[];CUR.guests=l.indexOf(id)>=0?l.filter(function(y){return y!==id}):l.concat(id);drawChips()}});
}
function collect(){
  if(!$('#f_title'))return;
  var t=CUR;t.title=v('f_title');t.from=v('f_from');t.to=v('f_to')||t.from;t.purpose=v('f_purpose');t.fac=v('f_fac');t.fin=v('f_fin');t.fout=v('f_fout');
  t.owner=v('f_owner');t.cost=v('f_cost');t.hotel=v('f_hotel');t.hconf=v('f_hconf');t.hnote=v('f_hnote');t.car=v('f_car');t.cnote=v('f_cnote');t.note=v('f_note');
}
function saveTrip(quiet){
  if(!CUR.title&&!CUR.from){if(!quiet)toast('출장명이나 날짜를 넣어 주세요 请填写名称或日期');return}
  put('trips',CUR).then(function(it){CUR=JSON.parse(JSON.stringify(it));if(!quiet){toast('저장됨 已保存');render()}}).catch(function(e){toast(e.message)});
}
var RATE={3:'😀 좋아함 很满意',2:'🙂 보통 一般',1:'😐 별로 不太满意'};
function mealCard(m){
  return '<div class="card tap" data-meal="'+E(m.id)+'"><div class="row"><div class="grow"><div class="t">'+E(m.place||'식당 미정')+'</div><div class="s">'+md(m.date)+(m.menu?' · '+E(m.menu):'')+'</div></div>'+(m.rate?'<span class="badge '+(m.rate==3?'ok':m.rate==1?'red':'')+'">'+RATE[m.rate].split(' ').slice(0,2).join(' ')+'</span>':'')+'</div>'+
  (m.mood?'<div class="s">분위기 氛围: '+E(m.mood)+'</div>':'')+(m.who?'<div class="s">반응 反应: '+E(m.who)+'</div>':'')+'</div>';
}
function mealForm(id){
  var m=null;(CUR.meals||[]).forEach(function(x){if(x.id===id)m=x});
  m=m||{id:uid(),date:CUR.from||today()};
  sheet('<div class="t" style="font-size:17px">식사 기록 <span class="zh">用餐记录</span></div>'+
   inp('m_date','날짜 日期',m.date,'date')+inp('m_place','식당 餐厅',m.place,'','','dlf')+dl('dlf','food')+
   inp('m_menu','먹은 메뉴 菜品',m.menu,'','오리구이, 딤섬…')+
   inp('m_mood','분위기 氛围',m.mood,'','룸, 시끄러움, 조용, 술자리…')+
   '<label>전체 반응 整体反应</label><div class="chips">'+[3,2,1].map(function(r){return '<span class="chip'+(m.rate==r?' on':'')+'" data-r="'+r+'">'+RATE[r]+'</span>'}).join('')+'</div>'+
   txt('m_who','누가 뭘 좋아했나 · 안 먹었나 谁喜欢/不吃什么',m.who,'김부장님 마라 좋아함, 이과장님 고수 안 드심')+
   '<button class="btn wide" id="ms">저장 保存</button>'+(id?'<button class="btn ghost wide" id="md" style="color:var(--red)">삭제 删除</button>':'')+'<button class="btn ghost wide" onclick="closeSheet()">닫기 关闭</button>');
  var rate=m.rate||0;
  [].forEach.call(document.querySelectorAll('[data-r]'),function(x){x.onclick=function(){rate=Number(x.dataset.r);[].forEach.call(document.querySelectorAll('[data-r]'),function(y){y.classList.toggle('on',y===x)})}});
  $('#ms').onclick=function(){
    var nm={id:m.id,date:v('m_date'),place:v('m_place'),menu:v('m_menu'),mood:v('m_mood'),rate:rate,who:v('m_who')};
    CUR.meals=(CUR.meals||[]).filter(function(x){return x.id!==m.id}).concat(nm);
    if(nm.place&&!live('places').some(function(p){return p.kind==='food'&&p.name===nm.place}))put('places',{id:uid(),kind:'food',name:nm.place}).catch(function(){});
    closeSheet();saveTrip(false);
  };
  if($('#md'))$('#md').onclick=function(){CUR.meals=(CUR.meals||[]).filter(function(x){return x.id!==m.id});closeSheet();saveTrip(false)};
}
function copyPlan(){
  var t=CUR,gs=(t.guests||[]).map(function(id){var g=byId('guests',id);return g?g.name+(g.title?' '+g.title:''):''}).filter(Boolean).join(', ');
  var L=['【출장 일정 出差行程】'+(t.title||''),'기간 日期: '+(t.from||'')+(t.to&&t.to!==t.from?' ~ '+t.to:'')];
  if(gs)L.push('손님 客人: '+gs);
  if(t.purpose)L.push('목적 目的: '+t.purpose);
  if(t.fin)L.push('도착 到达: '+t.fin);if(t.fout)L.push('출발 离开: '+t.fout);
  if(t.hotel)L.push('호텔 酒店: '+t.hotel+(t.hconf?' (예약번호 '+t.hconf+')':''));
  if(t.car)L.push('차량 用车: '+t.car+(t.cnote?' / '+t.cnote:''));
  if(t.fac)L.push('방문 공장 工厂: '+t.fac);
  if(t.owner)L.push('담당 负责人: '+t.owner);
  var s=L.join('\n');
  (navigator.clipboard?navigator.clipboard.writeText(s):Promise.reject()).then(function(){toast('복사됨 已复制 — 위챗에 붙여넣기')}).catch(function(){sheet('<textarea style="min-height:220px">'+E(s)+'</textarea><button class="btn ghost wide" onclick="closeSheet()">닫기</button>')});
}

// ---------- 손님 ----------
function guestTrips(id){return live('trips').filter(function(t){return (t.guests||[]).indexOf(id)>=0}).sort(function(a,b){return (b.from||'').localeCompare(a.from||'')})}
function vGuests(){
  var q=(ls('gs-q')||'').toLowerCase();
  var gs=live('guests').filter(function(g){return !q||[g.name,g.zh,g.title,g.dept].join(' ').toLowerCase().indexOf(q)>=0});
  gs.sort(function(a,b){var ta=guestTrips(a.id)[0],tb=guestTrips(b.id)[0];return ((tb&&tb.from)||'').localeCompare((ta&&ta.from)||'')||(a.name||'').localeCompare(b.name||'')});
  $('#m').innerHTML='<div class="row" style="margin-bottom:10px"><input id="q" class="grow" placeholder="이름·부서 검색 搜索" value="'+E(q)+'"><button class="btn red" id="ngst">+</button></div>'+
   (gs.length?gs.map(function(g){var tr=guestTrips(g.id);return '<div class="card tap" data-guest="'+E(g.id)+'"><div class="t">'+E(g.name)+' <span class="s">'+E([g.title,g.dept].filter(Boolean).join(' · '))+'</span></div>'+
    '<div class="s">방문 来访 '+tr.length+'회'+(tr[0]&&tr[0].from?' · 최근 '+tr[0].from:'')+'</div>'+(g.no?'<span class="badge red">✕ '+E(g.no)+'</span>':'')+(g.likes?'<span class="badge ok">♥ '+E(g.likes)+'</span>':'')+'</div>'}).join(''):'<div class="empty">손님이 없어요 暂无客人</div>');
  $('#q').oninput=function(){ls('gs-q',this.value);clearTimeout(vGuests.h);vGuests.h=setTimeout(function(){vGuests();var x=$('#q');x.focus();x.setSelectionRange(x.value.length,x.value.length)},250)};
  $('#ngst').onclick=function(){CUR={id:uid(),name:''};go(vGuest)};
  bindTap();
}
function vGuest(){
  var g=CUR,tr=guestTrips(g.id),meals=[];
  tr.forEach(function(t){(t.meals||[]).forEach(function(m){meals.push({m:m,t:t})})});
  meals.sort(function(a,b){return (b.m.date||'').localeCompare(a.m.date||'')});
  var good={},bad={};meals.forEach(function(x){if(!x.m.place)return;if(x.m.rate==3)good[x.m.place]=1;if(x.m.rate==1)bad[x.m.place]=1});
  var h='';
  if(g.name){
    h+='<div class="card must"><div class="t">식사 전에 볼 것 <span class="zh">用餐前必看</span> — '+E(g.name)+' '+E(g.title||'')+'</div>'+
    '<div style="margin-top:6px">'+(g.no?'<span class="badge red">✕ 못 먹음 不吃: '+E(g.no)+'</span>':'<span class="badge">못 먹는 것 미기록</span>')+'</div>'+
    (g.likes?'<div><span class="badge ok">♥ 좋아함 喜欢: '+E(g.likes)+'</span></div>':'')+
    '<div>'+(g.spicy?'<span class="badge">🌶 '+E(g.spicy)+'</span>':'')+(g.drink?'<span class="badge">🍺 '+E(g.drink)+'</span>':'')+'</div>'+
    (Object.keys(good).length?'<div class="s">반응 좋았던 곳 满意的餐厅: '+E(Object.keys(good).join(', '))+'</div>':'')+
    (Object.keys(bad).length?'<div class="s">별로였던 곳 不满意: '+E(Object.keys(bad).join(', '))+'</div>':'')+
    (g.memo?'<div class="note" style="margin-top:8px">'+E(g.memo)+'</div>':'')+'</div>';
    h+='<h2>방문 이력 <span class="zh">来访记录</span> ('+tr.length+')</h2>'+(tr.length?tr.map(tripCard).join(''):'<div class="card s">아직 없어요 暂无</div>');
    if(meals.length)h+='<h2>식사 기록 <span class="zh">用餐记录</span></h2>'+meals.map(function(x){return mealCard(x.m)}).join('');
  }
  h+='<h2>손님 정보 <span class="zh">客人信息</span></h2><div class="card">'+
   '<div class="two"><div>'+inp('g_name','이름 姓名',g.name)+'</div><div>'+inp('g_zh','중국어 표기 中文名',g.zh)+'</div></div>'+
   '<div class="two"><div>'+inp('g_title','직급 职位',g.title,'','부장, 상무')+'</div><div>'+inp('g_dept','부서·브랜드 部门/品牌',g.dept)+'</div></div>'+
   inp('g_likes','좋아하는 음식 喜欢的菜',g.likes,'','딤섬, 해산물, 양꼬치')+
   inp('g_no','못 먹는 음식 · 알레르기 忌口/过敏',g.no,'','고수, 내장, 갑각류')+
   '<div class="two"><div><label>매운맛 辣度</label><select id="g_spicy">'+['','못 먹음 不吃辣','조금 微辣','보통 中辣','좋아함 爱吃辣'].map(function(o){return '<option'+(o===(g.spicy||'')?' selected':'')+'>'+o+'</option>'}).join('')+'</select></div><div>'+inp('g_drink','술 酒',g.drink,'','안 마심 / 맥주 / 白酒 OK')+'</div></div>'+
   txt('g_memo','메모 备注',g.memo,'좌석 선호, 흡연, 쇼핑 관심, 선물, 대화 주제')+'</div>'+
   '<button class="btn wide" id="gs">저장 保存</button>'+(byId('guests',g.id)?'<button class="btn ghost wide" id="gd" style="color:var(--red)">삭제 删除</button>':'');
  $('#m').innerHTML=h;bindTap();
  $('#gs').onclick=function(){
    g.name=v('g_name');if(!g.name)return toast('이름을 넣어 주세요 请填写姓名');
    g.zh=v('g_zh');g.title=v('g_title');g.dept=v('g_dept');g.likes=v('g_likes');g.no=v('g_no');g.spicy=v('g_spicy');g.drink=v('g_drink');g.memo=v('g_memo');
    put('guests',g).then(function(it){CUR=JSON.parse(JSON.stringify(it));toast('저장됨 已保存');render()}).catch(function(e){toast(e.message)});
  };
  if($('#gd'))$('#gd').onclick=function(){if(!confirm('삭제할까요? 确定删除？'))return;g.del=true;put('guests',g).then(function(){STACK.pop();render()})};
}

// ---------- 업체 ----------
var PK={food:['🍽 식당','餐厅'],hotel:['🏨 호텔','酒店'],car:['🚐 차량','用车']};
function placeMeals(name){var r=[];live('trips').forEach(function(t){(t.meals||[]).forEach(function(m){if(m.place===name)r.push({m:m,t:t})})});return r.sort(function(a,b){return (b.m.date||'').localeCompare(a.m.date||'')})}
function vPlaces(){
  var ps=live('places').filter(function(p){return p.kind===PSEG}).sort(function(a,b){return (a.name||'').localeCompare(b.name||'')});
  $('#m').innerHTML='<div class="seg">'+Object.keys(PK).map(function(k){return '<button data-k="'+k+'"'+(k===PSEG?' class="on"':'')+'>'+PK[k][0]+' <span class="zh">'+PK[k][1]+'</span></button>'}).join('')+'</div>'+
   '<button class="btn red wide" id="np" style="margin:0 0 12px">+ '+PK[PSEG][0].split(' ')[1]+' 추가 添加</button>'+
   (ps.length?ps.map(function(p){var ms=PSEG==='food'?placeMeals(p.name):[],g=ms.filter(function(x){return x.m.rate==3}).length;
    return '<div class="card tap" data-place="'+E(p.id)+'"><div class="t">'+E(p.name)+'</div><div class="s">'+E([p.area,p.cuisine,p.price?p.price+' RMB':'',p.phone].filter(Boolean).join(' · '))+'</div>'+
    (ms.length?'<span class="badge">방문 '+ms.length+'회</span>'+(g?'<span class="badge ok">😀 '+g+'</span>':''):'')+'</div>'}).join(''):'<div class="empty">아직 없어요 暂无</div>');
  [].forEach.call(document.querySelectorAll('[data-k]'),function(x){x.onclick=function(){PSEG=x.dataset.k;vPlaces()}});
  $('#np').onclick=function(){CUR={id:uid(),kind:PSEG,name:''};go(vPlace)};
  bindTap();
}
function vPlace(){
  var p=CUR,ms=p.kind==='food'&&p.name?placeMeals(p.name):[];
  var h='<div class="card">'+inp('p_name','이름 名称',p.name)+
   '<label>종류 类别</label><select id="p_kind">'+Object.keys(PK).map(function(k){return '<option value="'+k+'"'+(k===p.kind?' selected':'')+'>'+PK[k][0]+' '+PK[k][1]+'</option>'}).join('')+'</select>'+
   '<div class="two"><div>'+inp('p_area','지역 区域',p.area,'','판위, 톈허, 바이윈')+'</div><div>'+inp('p_cuisine','요리·차종 菜系/车型',p.cuisine,'','광둥요리, 7인승')+'</div></div>'+
   '<div class="two"><div>'+inp('p_price','단가 单价 (RMB)',p.price,'','1인 200 / 하루 800')+'</div><div>'+inp('p_phone','연락처 联系方式',p.phone)+'</div></div>'+
   inp('p_addr','주소 地址',p.addr)+txt('p_memo','메모 备注',p.memo,'룸 있음, 예약 필수, 협약가, 기사 이름')+'</div>'+
   '<button class="btn wide" id="ps">저장 保存</button>'+(byId('places',p.id)?'<button class="btn ghost wide" id="pd" style="color:var(--red)">삭제 删除</button>':'');
  if(ms.length)h+='<h2>이곳 식사 기록 <span class="zh">该餐厅记录</span></h2>'+ms.map(function(x){return '<div class="card"><div class="s">'+E(x.m.date)+' · '+E((x.t.guests||[]).map(gName).join(', '))+'</div>'+mealCard(x.m).replace('class="card tap"','style=""')+'</div>'}).join('');
  $('#m').innerHTML=h;
  $('#ps').onclick=function(){
    var old=p.name;p.name=v('p_name');if(!p.name)return toast('이름을 넣어 주세요');
    p.kind=v('p_kind');p.area=v('p_area');p.cuisine=v('p_cuisine');p.price=v('p_price');p.phone=v('p_phone');p.addr=v('p_addr');p.memo=v('p_memo');
    put('places',p).then(function(it){CUR=JSON.parse(JSON.stringify(it));PSEG=it.kind;toast('저장됨 已保存');render()}).catch(function(e){toast(e.message)});
  };
  if($('#pd'))$('#pd').onclick=function(){if(!confirm('삭제할까요? 确定删除？'))return;p.del=true;put('places',p).then(function(){STACK.pop();render()})};
}

// ---------- 설정 ----------
function vSet(){
  var h='<div class="card">'+inp('s_me','내 이름 我的名字 (저장 기록에 표시)',ME)+'<button class="btn sm" id="s_mes" style="margin-top:8px">저장 保存</button></div>';
  if(ROLE==='owner'){
    h+='<h2>팀 코드 (지사장) <span class="zh">团队代码</span></h2><div class="card"><p class="s">지사원이 이 코드로 들어옵니다. 바꾸면 기존 코드는 바로 막혀요. 6자 이상.</p>'+
     '<input id="s_team" type="text" autocomplete="off" placeholder="새 팀 코드"><button class="btn sm" id="s_teams" style="margin-top:8px">설정</button></div>';
    h+='<h2>가져오기 · 백업</h2><div class="card"><p class="s">Claude가 정리해 준 JSON을 붙여넣으면 같은 id는 덮어쓰고 새 것은 추가합니다.</p>'+
     '<textarea id="s_imp" placeholder="{&quot;guests&quot;:[…], &quot;trips&quot;:[…], &quot;places&quot;:[…]}"></textarea><button class="btn sm" id="s_imps" style="margin-top:8px">가져오기</button> '+
     '<button class="btn sm ghost" id="s_exp" style="margin-top:8px">⬇ 백업 내려받기</button></div>';
  }
  h+='<h2>사용법 <span class="zh">使用说明</span></h2><div class="card s">'+
   '1. 출장 요청이 오면 <b>출장</b>에 새 건을 만들고 도착일·손님·담당을 넣습니다. 收到出差请求后新建，填写日期、客人、负责人。<br>'+
   '2. 체크리스트 기한(D-14~D+3)에 맞춰 체크합니다. 按清单期限逐项勾选。<br>'+
   '3. 식사 후 <b>식사 기록</b>을 1분 안에 남깁니다. 用餐后1分钟内记录。<br>'+
   '4. 다음에 같은 분이 오면 <b>손님</b> 화면의 "식사 전에 볼 것"을 확인합니다. 同一客人再来时，先看"用餐前必看"。</div>';
  h+='<button class="btn ghost wide" id="s_out">로그아웃 退出</button>';
  $('#m').innerHTML=h;
  $('#s_mes').onclick=function(){ME=v('s_me');ls('gs-me',ME);toast('저장됨 已保存')};
  $('#s_out').onclick=function(){ls('gs-auth',null);AUTH=null;login()};
  if(ROLE!=='owner')return;
  $('#s_teams').onclick=function(){api('team',{team:v('s_team')}).then(function(){$('#s_team').value='';toast('팀 코드 설정됨')}).catch(function(e){toast(e.message)})};
  $('#s_imps').onclick=function(){var d;try{d=JSON.parse(v('s_imp'))}catch(e){return toast('JSON 형식이 아니에요')}
    api('import',{db:d}).then(function(j){toast(j.n+'건 가져옴');$('#s_imp').value='';return reload()}).catch(function(e){toast(e.message)})};
  $('#s_exp').onclick=function(){var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(DB,null,1)],{type:'application/json'}));a.download='guest-backup-'+today()+'.json';a.click()};
}

// ---------- 시작 ----------
(function(){
  var a=null;try{a=JSON.parse(ls('gs-auth')||'null')}catch(e){}
  if(!a){var pb=ls('pb-code');if(pb)a={code:pb}}
  if(!a)return login();
  AUTH=a;api('auth').then(function(j){ROLE=j.role;ls('gs-auth',JSON.stringify(AUTH));start(j)}).catch(function(){ls('gs-auth',null);login()});
})();
</script></body></html>`;
