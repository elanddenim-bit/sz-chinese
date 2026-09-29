# sz-chinese — 실전 중국어 · 광저우 지사장 (공장 실무 중국어 학습 PWA)

## 작업 규칙 (Claude)
- 소유자에게 질문하지 말고 가장 합리적인 해석으로 바로 수정 → main에 커밋·푸시 → 변경 요약만 짧게 보고.
- 예외(먼저 확인): KV/D1/R2 데이터 삭제·스키마 파괴적 변경, 도메인·Worker 이름 변경, 시크릿 추가 필요, 비용 발생. 이 앱에서는 Supabase `trainer` 테이블 구조 변경, `state` 스키마 파괴적 변경(기존 사용자 진도 손실)도 먼저 확인.
- 푸시 = 자동 배포. 문법 오류는 곧 서비스 장애이므로 푸시 전 반드시 검증(아래 "검증").
- 단일 파일 구조 유지. 프레임워크·빌드 도구·npm 의존성 추가 금지.
- 커밋 메시지는 한국어 한 줄.
- [필수] 중국·홍콩 지역에서 Anthropic(Claude API)에 요청하는 경로를 만들지 말 것(Edge Function 포함). AI는 千问(알리바바 百炼). 해외 중계·VPN 등 지역 제한 우회 코드 금지.
- index.html 이 600KB·7,500줄. 전체를 다시 쓰지 말고 필요한 부분만 Edit.
- `audio/*.mp3` 는 건드리지 않는다(추가·삭제·이름변경 금지). 새 음성이 필요하면 mp3 없이 Azure TTS 폴백으로 동작하게 둔다.
- index.html·manifest·아이콘을 바꾸면 `sw.js` 의 `C='szcn-beta-N'` 숫자를 올린다(구캐시 제거). `AUDIO_CACHE='szcn-audio'` 이름은 바꾸지 않는다(오프라인 음성 캐시 날아감).

## 개요
- 광저우·선전 지사장이 공장 현장(실사·단가협상·클레임·위챗·생활·오더진행)에서 쓰는 문장으로 만든 중국어 학습앱. 초대 코드 배포형 BETA(타인도 사용).
- 탭: 홈(ph) · 회화(p0) · 퀴즈(p1) · HSK 단어(p2) · 복습(p3) · 발음(p6) · 현장(p5) · 진척(p4).
- 퀴즈 모드: pick 뜻 고르기 / build 문장 조립 / fill 빈칸 / pattern 패턴 드릴 / number 숫자 듣기.
- 롤플레이(RP): 위챗 분기 대화(노드·선택지·점수), AI 직접 작문 교정 옵션.
- 통화 모드(BETA 3.7~): 롤플레이 화면 상단 📞 카드 → AI 캐릭터와 음성 통화 → 종료 후 발화 전체 교정. 상황 `CALL_SC`(kind life: 택배·배달·디디·식당예약·에어컨수리 / work: 납기·단가·클레임, 그룹 `CALL_GROUPS`), 난이도 `CALL_LV` 1 연습(쉬운 말·힌트 표시·무음 2.2초·7초 막히면 상대가 선택형으로 다시 물음) / 2 보통(힌트 탭·1.6초) / 3 실전(힌트 없음·1.2초). 자막(병음·번역)과 힌트는 `/call/hints` 로 따로 받아 상대 음성 재생 중 준비. 상황별 최근 리뷰 점수(`state.call.score[key]`)가 80(`CALL_KO_SCORE`) 이상이면 힌트는 한국어 뜻만(탭하면 중국어). 통화 화면 상단에 턴 응답 시간(인식·답변·음성·전송) 표시. 리뷰 후 "🔁 교정받은 말로 다시 걸기"(`callRetryTargets`: 틀린 발화 교정문 우선 최대 4개 → `sc.targets`, 통화 중 한국어 뜻 체크리스트·`callSim` 유사도로 ✓, 리뷰가 `targets[]` 채점). 약점 미션(`callPickMission`: `state.gram` 중 2회 이상 틀리고 못 고친 패턴 1개 → `sc.mission`, 상대가 쓸 기회를 만들고 리뷰 `mission[]` 채점, 성공 시 `gram[key].fixed+1`, 끄기 `state.call.missionOff`). 코드 `// 통화 모드` 블록(`call*` 함수).

## 배포
- 방식: 정적 파일(빌드 없음). GitHub Pages — `elanddenim-bit/sz-chinese` main 푸시 시 자동 배포(github-pages 환경). Cloudflare Pages 아님.
- URL/도메인: 미확인 (코드 내 하드코딩 없음, 전부 상대경로).
- 바인딩: 없음(정적).
- 외부 서비스:
  | 용도 | 값 |
  |---|---|
  | Supabase 동기화 | `SB_URL=https://qmxcfsozzrcdakkiozts.supabase.co`, `SB_KEY=sb_publishable_…`(공개키, index.html 상수) |
  | AI 서버 | Supabase Edge Functions — 같은 프로젝트 cn-trainer(ap-southeast-1), `cfg.ai`=`https://qmxcfsozzrcdakkiozts.supabase.co/functions/v1`. 함수: correct·field·pronounce·tts·vocab(대시보드 편집, 저장소에 소스 없음) + call(`supabase/functions/call/index.ts`) |
- 시크릿: 저장소 내 없음. Supabase Edge Function 시크릿 `AZURE_SPEECH_KEY`·`AZURE_SPEECH_REGION`(pronounce 확인), AI 키는 `DASHSCOPE_API_KEY`(알리바바 百炼) + `QWEN_BASE`(百炼 업무공간 전용 OpenAI 호환 URL), 선택 `QWEN_TURN_MODEL`·`QWEN_REVIEW_MODEL`. `call` 함수는 2026-09-29 Anthropic→千问 전환(저장소 소스). correct·field·vocab도 2026-09-29 千问 전환 후 `supabase/functions/<이름>/index.ts`로 저장소에 추가(초대 코드는 시크릿 `ALLOWED_CODES`로만, 저장소엔 넣지 않음. 대시보드 배포본에는 기존 하드코딩 코드가 남아 있을 수 있음). 선택 시크릿 `QWEN_TEXT_MODEL`(기본 qwen3.8-flash, correct·field), `QWEN_VL_MODEL`(기본 qwen3-vl-plus, vocab). 초대 코드 허용 목록: 기존 5개 함수는 코드 안 `ALLOWED` 배열, call 은 시크릿 `ALLOWED_CODES`(쉼표 구분) — 저장소 파일을 수정 없이 붙여넣어 배포. 초대 코드는 public 저장소에 절대 커밋 금지. 함수는 Verify JWT 꺼져 있음(앱이 Authorization 헤더를 안 보냄).
- GitHub 저장소는 public.

## 파일 구조
- `index.html` — 전체 앱(CSS 14–653행, HTML, 단일 `<script>` 875행~).
- `supabase/functions/call/index.ts` — 통화 모드 Edge Function 소스. 정적 앱과 무관, Pages 로 공개되므로 초대 코드·키를 넣지 말 것.
- `sw.js` — 서비스워커. 앱셸 네트워크 우선·캐시 폴백, `/audio/*.mp3` 는 캐시 우선(`szcn-audio`).
- `manifest.json` — PWA(이름 "실전 중국어 - 광저우 지사장", 테마 #1B1F22).
- `audio/<8자리 hex>.mp3` — 원어민 음성 약 3,700개. 파일명 = `fnv(문장 텍스트)` (FNV-1a 32bit, UTF-8, 소문자 hex 8자리 패딩).
- `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `.DS_Store`(불필요, 커밋되어 있음).

## 아키텍처 / API
- 음성 재생 `speak(t)`: 텍스트가 `AUDIO_SET`(=`collectSentences()` + `ITEMS` 중 kind:'word' 의 z)에 있으면 `audio/`+fnv(t)+`.mp3` → 실패 시 Azure TTS(`cfg.ai`+`/tts`) → 실패 시 브라우저 speechSynthesis(zh-CN).
- `prefetchAudio()` 로 mp3 를 `szcn-audio` 캐시에 선다운로드. iOS 자동재생 제한 때문에 `unlockAudio()`·`azPrefetch()` 가 존재 — 탭 직후 동기 재생 흐름을 깨지 말 것.
- AI 서버 호출(모두 POST JSON, `code`=초대코드 `cfg.sid` 동봉):
  - `{ai}/correct` {text, code, situation, intent, history} — 작문 교정(롤플레이·드릴)
  - `{ai}/field` {mode, text, code, situation} — 현장 탭
  - `{ai}/vocab` {code, images[]} — 이미지로 단어 추출
  - `{ai}/pronounce` {code, text, audio(base64)} — 발음 평가(합격선 `PR_PASS=80`)
  - `{ai}/tts` {code, text} → 오디오 blob(400B 미만이면 실패 처리)
  - 통화 모드(서버 기준 `cfg.call` 없으면 `cfg.ai`): `/call/ping` {code}, `/call/say` {code,text,sc}, `/call/turn` {code,audio(16kHz WAV b64),sc{…,level,kind,me},history,n} → {heard,reply:{z},end,audio,sec,usage,timing{stt,llm,tts}}(턴 응답은 중국어만 — 지연 단축) (`stuck:true` 면 오디오 없이 다시 묻기), `/call/hints` {code,sc,history,line,noHints} → {sub:{p,k},hints[]}(상대 대사 자막+힌트, 상대 음성 재생 중 `callFetchExtras`로 받음), `/call/review` {code,sc,turns}. 서버 소스는 `supabase/functions/call/index.ts`(대시보드 Code 탭에 그대로 붙여넣어 배포, 초대 코드는 시크릿 ALLOWED_CODES). 미배포면 앱은 "통화 서버 미배포" 안내. 테이블 `call_usage`(SQL은 파일 주석)를 범용 카운터로 사용: 월 STT 초(상한 `CALL_CAP_MIN` 240분) + 코드별 하루 턴·리뷰 수(`CALL_DAY_TURNS` 300(턴+힌트), `CALL_DAY_REVIEWS` 20, 초과 시 429 daily). 테이블 없으면 상한 전부 미적용. 앱은 전송 전 앞뒤 무음을 잘라(`callTrimWav`) STT 사용 초를 줄이고, 리뷰 전문은 최근 10건만 state 에 보관(`callPrune`).
  - 초대 코드에 AI 권한이 없으면 서버가 거부 → UI 문구 "이 초대 코드는 AI … 사용할 수 없습니다".
- Supabase REST: `GET {SB_URL}/rest/v1/trainer?id=eq.<sid>&select=data`, `POST …/trainer` (Prefer: resolution=merge-duplicates) body `[{id:sid,data:state,updated_at}]`.

## 데이터
- localStorage:
  - `szcn-trainer-v1` — state `{prog:{}, stats:{total,correct,days:{YYYY-MM-DD:{n,c,min,sq,m,am,mv,pm}}}, mastered, myWords:{}, rp:{}, gram:{}, ptDone:{}, goals:{min:220,sent:60,quiz:200,mast:35}, pron:{…}, call:{level:1|2|3, score:{key:최근점수}, missionOff, log:[{id,key,lv,lat,ko,peek,targets?,retryOf?,mission?,d,dur,turns:[{r:'me'|'npc',z,p,k,sec}],review}] (최근 20건, 오디오 미저장), usage:{'YYYY-MM':{c:통화초,p:발음초}}, subs}}` — `call` 은 `callState()` 가 지연 초기화
  - `szcn-trainer-cfg` — `{sid, ai, call?}`
  - `szcn-trainer-bak` — `{t, state}` 자동백업(점수가 더 클 때만 갱신)
- Supabase 테이블 `trainer(id text PK = 초대코드, data jsonb, updated_at)`.
- 덮어쓰기 방지: `stScore = total*10 + Σminutes`. 로컬 점수가 서버의 50% 미만이면 업로드 차단(saveGuard, 주황 점). 병합은 점수 큰 쪽 채택(`mergePick`).
- 콘텐츠 상수(index.html 내): `DATA`(시나리오 6개 × {i,q,p,k,a:[{t:std|real|coll,z,p,k}]}), `SCEN_NAMES/SCEN_NOTES`, `TOKS/TOKPY`(문장 조립 토큰), `FILLS`, `PATTERNS`, `NUMDRILL/NUMDRILL2`, `RP`(롤플레이 {id,title,setting,start,maxPts,keys,nodes}), 단어 `W4/W4B/W4C`(HSK4), `W5/W5B/W5C`(HSK5), `W301/S301`(301구), `W7`(실무 어휘 biz). 단어 행 형식 `[중문, 병음, 한국어뜻]`.
- `ITEMS[id]={id,kind,lv,z,p,k}` — id 접두어로 출처 구분(w7-0 등). 진도 `state.prog` 가 이 id 를 키로 쓴다 → 기존 배열 중간 삽입·삭제 시 id 가 밀려 사용자 진도가 꼬임. 항목 추가는 배열 끝에.

## 도메인 규칙
- 대상: 의류 OEM 공장 실무(우븐/니트, 단가, 납기, 클레임, 위챗). 공장 측 "시간끌기·역제안" 패턴을 듣기 훈련하는 것이 핵심 가치.
- 답변 태그: std 표준 / real 실전형(조건·회피·역제안) / coll 구어체.
- 병음은 성조 기호 표기. 한국어 뜻은 존댓말 자연어.
- 문장 텍스트를 1글자라도 바꾸면 fnv 해시가 바뀌어 해당 mp3 매칭이 끊긴다(→ Azure TTS/브라우저 TTS로 재생). 오탈자 수정 외에는 기존 문장 변경 자제.

## UI 규칙
- 한국어 UI, 중국어는 `.zh` 클래스. 폰트는 시스템 폰트만 사용(실제 렌더링: 중문 PingFang SC, 한글 Apple SD Gothic Neo). Noto는 CSS에 이름만 있고 로드하지 않음.
- 외부 폰트·CDN 추가 금지 — 중국 본토에서 VPN 없이 열려야 함(Google Fonts 요청 하나로 페이지가 멈춤).
- 수정은 필요한 부분만 Edit → main 푸시. 전체 HTML 재출력 하지 않음.
- 데이터: 기기별 localStorage + 초대 코드 기준 Supabase 동기화(아이패드·아이폰 통합). `state` 호환 유지, 스키마 변경 시 마이그레이션 포함.
- 색상 토큰(`:root`): `--navy:#1B1F22`(헤더), `--red:#2E4A73`(이름과 달리 블루 계열 강조색), `--danger:#C8352E`, `--ok:#1E7F4F`, `--bg:#F3F2EE`, `--wash:#8FA6C4`. 시나리오 색 `--c0..c5`(실사 인디고/협상 앰버/클레임 레드/위챗 그린/생활 퍼플/오더 딥그린) + `--cNbg`.
- 모바일(아이폰·아이패드) 우선, 하단 탭바, 바텀시트(`#sheet`), 모달(`#cfgModal`, `#welModal`).
- E·LAND CI 레드(#D51030)를 쓰지 않는 개인 브랜드형 디자인 — 유지.

## 주의사항 / 알려진 이슈
- Supabase 접근 정책(RLS) 미확인. 인증·권한 관련 변경은 소유자 확인 후 진행.
- correct·field·pronounce·tts·vocab 소스는 저장소에 없음(Supabase 대시보드에만 있음). 스펙 변경 시 대시보드 코드를 받아서 수정.
- `.DS_Store` 커밋되어 있음(삭제 무해).
- `sw.js` 는 index.html 등 앱셸을 네트워크 우선으로 받으므로 배포 즉시 반영되나, 캐시 이름을 올려야 구버전 캐시 정리.
- 중국 본토에서 `*.supabase.co`·AI 서버 접속 가능 여부 미확인. 실패 시 로컬 저장으로 동작(설계상 허용).

## 검증
```bash
# 저장소 루트에서 실행
# 인라인 스크립트 문법 검사
node -e "const h=require('fs').readFileSync('index.html','utf8');let i=0;for(const m of h.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)){i++;new (require('vm').Script)(m[1])}console.log('script OK',i)"
node --check sw.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'));console.log('manifest OK')"
# 특정 문장의 mp3 존재 확인 (fnv 해시)
node -e "let h=0x811c9dc5;for(const c of new TextEncoder().encode(process.argv[1])){h^=c;h=Math.imul(h,0x01000193)>>>0}const f='audio/'+h.toString(16).padStart(8,'0')+'.mp3';console.log(f,require('fs').existsSync(f))" "我们主要做针织，T恤、卫衣、卫裤这些都可以。"
```
