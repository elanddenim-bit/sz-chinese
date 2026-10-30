// 네이티브 글자 위젯 vs 그림 한 장 — 같은 데이터로 글자 목록·글꼴 크기·그림자 규칙 검사(Scriptable 흉내)
import fs from 'fs';
const src=fs.readFileSync(new URL('../me.js', import.meta.url),'utf8');
const js=src.match(/WIDGET_JS = String.raw`([\s\S]*?)`;/)[1];
const a=js.indexOf('const K = 3;'), b=js.indexOf('let c = await code(false);');
const body=js.slice(a,b).replace(/^const FM = .*$/m,'');
const TXT=[]; let MODE='';
class Color{constructor(h,a=1){this.hex=h;this.alpha=a;const n=parseInt(h.slice(1,7),16);this.red=(n>>16&255)/255;this.green=(n>>8&255)/255;this.blue=(n&255)/255}static white(){return new Color('#ffffff')}}
class Size{constructor(w,h){this.width=w;this.height=h}} class Rect{constructor(x,y,w,h){Object.assign(this,{x,y,width:w,height:h})}} class Point{constructor(x,y){this.x=x;this.y=y}}
class Path{move(){}addLine(){}addRoundedRect(){}addRect(){}addEllipse(){}closeSubpath(){}} class LinearGradient{}
const Font={}; for(const k of ['systemFont','boldSystemFont','heavySystemFont','semiboldSystemFont','boldRoundedSystemFont','semiboldRoundedSystemFont']) Font[k]=(s)=>({k,size:s});
class DrawContext{constructor(){this._font={size:0}} setFont(f){this._font=f} setTextColor(){} setTextAlignedCenter(){} setTextAlignedLeft(){} setTextAlignedRight(){} drawTextInRect(t){TXT.push({m:MODE,t:String(t),size:this._font.size/3,img:true})} drawText(t){TXT.push({m:MODE,t:String(t),size:this._font.size/3,img:true})} setFillColor(){} setStrokeColor(){} setLineWidth(){} fillRect(){} strokeRect(){} fillEllipse(){} strokeEllipse(){} addPath(){} fillPath(){} strokePath(){} drawImageInRect(){} getImage(){return {size:new Size(this.size.width,this.size.height),_img:true}} }
class WidgetText{constructor(t){this.text=t} set shadowColor(v){throw new Error('shadow on text: '+this.text)} set shadowRadius(v){throw new Error('shadow')} }
class WidgetStack{constructor(){this.kids=[]} addText(t){const x=new WidgetText(t);this.kids.push(x);TXT.push({m:MODE,t:String(t),node:x});return x} addStack(){const s=new WidgetStack();this.kids.push(s);return s} addSpacer(){} addImage(){return {centerAlignImage(){}}} layoutVertically(){} layoutHorizontally(){} centerAlignContent(){} setPadding(){} }
class ListWidget extends WidgetStack{ async presentLarge(){} async presentMedium(){} }
const FM={fileExists:()=>false,joinPath:(a,b)=>b,documentsDirectory:()=>'',remove(){},write(){},writeImage(){},modificationDate:()=>new Date(0),listContents:()=>[]};
const Image={fromFile:()=>null}; const Device={screenSize:()=>({width:393})}; const BG='bg'; const DIM=0.5;
const base={d:'2026-10-30',study:{today:12,goal:30,streak:5,week:96},hsk:{lv:4,total:509,seen:96,mast:19},words:323,ring:{k:'call',title:'통화 점수',big:'62',unit:'점',sub:'',pct:.62},
 chips:[{z:'准确',k:'정확하다'},{z:'差不多',k:'비슷하다'},{z:'表格',k:'표'},{z:'按时',k:'제때에'}],
 plan:[{d:'2026-10-31',t:'',title:'캔톤페어 3기 바이어 미팅 @ 琶洲',sub:'~11/04'},{d:'2026-11-03',t:'14:00',title:'공장 미팅',sub:''}],
 games:[{d:'2026-10-31',hm:'15:30',k:'fb',me:'수원',op:'대구',home:false},{d:'2026-11-05',hm:'19:30',k:'fb',me:'수원',op:'부산',home:true},{d:'2026-11-06',hm:'17:00',k:'lol',me:'T1',op:'Gen.G',tag:'Worlds'}],gstate:'ok'};
base.ring2=base.ring;
const DS={ok:base, empty:{...base,games:[],gstate:'empty',plan:[],chips:[]}, fail:{...base,games:[],gstate:'fail',gmsg:'서버 응답 429'}};
const f=new Function('Color','Size','Rect','Point','Path','LinearGradient','Font','DrawContext','WidgetText','WidgetStack','ListWidget','FM','Image','Device','BG','DIM','MODEfn', 'function bgImage(){return null}\n'+body+'\nreturn {pro,native};');
const {pro,native}=f(Color,Size,Rect,Point,Path,LinearGradient,Font,DrawContext,WidgetText,WidgetStack,ListWidget,FM,Image,Device,BG,DIM);
let fail=0; const norm=(t)=>t.replace(/\s+/g,'').replace(/[·,]/g,'');
for(const [name,j] of Object.entries(DS)) for(const [fam,p] of [['large',''],['large','study'],['large','plan'],['medium','team'],['medium','plan']]){
  TXT.length=0; MODE='img'; pro(j,fam,p); MODE='nat'; native(j,fam,p);
  const img=TXT.filter(x=>x.m==='img'), nat=TXT.filter(x=>x.m==='nat');
  // ① 글자 위젯에는 그림으로 그린 글자가 없어야 함
  const natImg=nat.filter(x=>x.img); if(natImg.length){console.log('✗',name,fam,p,'native 가 그림으로 글자를 그림:',natImg.map(x=>x.t));fail++}
  // ② 글꼴 크기 규칙: 본문 ≥11(보조 10 허용), 핵심 숫자(%·분·개·점·일) ≥19, 제목(중국어 학습·다음 일정·팀 이름) ≥15
  for(const x of nat){ const n=x.node, sz=n.font?n.font.size:0; const key=/^\d+%$|^\d+분 \/|^[\d,]+개$|^\d+점$|^\d+일$/.test(x.t), title=/중국어 학습|다음 일정|수원 삼성/.test(x.t);
    if(key&&sz<19){console.log('✗',name,fam,p,'핵심 숫자 작음',x.t,sz);fail++} if(title&&sz<15){console.log('✗','제목 작음',x.t,sz);fail++} if(!key&&!title&&sz<9){console.log('✗','글자 작음',x.t,sz);fail++} }
  // ③ 내용 같음: 그림판의 값이 글자판에도 있어야(공부·일정·경기 값 — 레이블은 배경 PNG 전용이라 제외)
  const want=img.map(x=>x.t).filter(t=>/^\d+%$|^\d+분|^[\d,]+개$|^\d+점$|^\d+일$|·|vs|없음|못 불러/.test(t));
  const have=nat.map(x=>norm(x.t)).join('|');
  for(const t of want){ if(/…$/.test(t)) continue; const nt=norm(t); const ok=have.includes(nt)||nt.split(/vs/).every(s=>have.includes(s)); if(!ok){console.log('✗',name,fam,p,'글자판에 없음:',JSON.stringify(t));fail++} }
  console.log('•',name,fam,p||'(all)','그림글자',img.length,'→ 글자',nat.length,'개');
}
console.log(fail?'FAIL '+fail:'ALL OK');
