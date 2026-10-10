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
- 통화 모드(BETA 3.7~): 롤플레이 화면 상단 📞 카드 → AI 캐릭터와 음성 통화 → 종료 후 발화 전체 교정. 상황 `CALL_SC`(kind life: 택배·배달·디디·식당예약·에어컨수리·미용실예약 / work: 납기·단가·클레임, 그룹 `CALL_GROUPS`), 난이도 `CALL_LV` 1 연습(쉬운 말·힌트 표시·무음 2.2초·7초 막히면 상대가 선택형으로 다시 물음) / 2 보통(힌트 탭·1.6초) / 3 실전(힌트 없음·1.2초). 자막(병음·번역)과 힌트는 `/call/hints` 로 따로 받아 상대 음성 재생 중 준비. 상황별 최근 리뷰 점수(`state.call.score[key]`)가 80(`CALL_KO_SCORE`) 이상이면 힌트는 한국어 뜻만(탭하면 중국어). 통화 화면 상단에 턴 응답 시간(인식·답변·음성·전송) 표시. 리뷰 후 "🔁 교정받은 말로 다시 걸기"(`callRetryTargets`: 틀린 발화 교정문 우선 최대 4개 → `sc.targets`, 통화 중 한국어 뜻 체크리스트·`callSim` 유사도로 ✓, 리뷰가 `targets[]` 채점). 약점 미션(`callPickMission`: `state.gram` 중 2회 이상 틀리고 못 고친 패턴 1개 → `sc.mission`, 상대가 쓸 기회를 만들고 리뷰 `mission[]` 채점, 성공 시 `gram[key].fixed+1`, 끄기 `state.call.missionOff`). 코드 `// 통화 모드` 블록(`call*` 함수).

## 배포
- 방식: 정적 파일(빌드 없음). GitHub Pages — `elanddenim-bit/sz-chinese` main 푸시 시 자동 배포(github-pages 환경). Cloudflare Pages 아님.
- URL/도메인: 미확인 (코드 내 하드코딩 없음, 전부 상대경로).
- 바인딩: 없음(정적).
- 외부 서비스:
  | 용도 | 값 |
  |---|---|
  | Supabase 동기화 | `SB_URL=https://qmxcfsozzrcdakkiozts.supabase.co`, `SB_KEY=sb_publishable_…`(공개키, index.html 상수) |
  | AI 서버 | Supabase Edge Functions — 같은 프로젝트 cn-trainer(ap-southeast-1), `cfg.ai`=`https://qmxcfsozzrcdakkiozts.supabase.co/functions/v1`. 함수: correct·field·pronounce·tts·vocab(대시보드 편집, 저장소에 소스 없음) + call(`supabase/functions/call/index.ts`) |
- 시크릿: 저장소 내 없음. Supabase Edge Function 시크릿 `AZURE_SPEECH_KEY`·`AZURE_SPEECH_REGION`(pronounce 확인), AI 키는 `DASHSCOPE_API_KEY`(알리바바 百炼) + `QWEN_BASE`(百炼 업무공간 전용 OpenAI 호환 URL), 선택 `QWEN_TURN_MODEL`·`QWEN_REVIEW_MODEL`. `call` 함수는 2026-09-29 Anthropic→千问 전환(저장소 소스). correct·field·vocab도 2026-09-29 千问 전환 후 `supabase/functions/<이름>/index.ts`로 저장소에 추가(초대 코드는 시크릿 `ALLOWED_CODES`로만, 저장소엔 넣지 않음. 대시보드 배포본에는 기존 하드코딩 코드가 남아 있을 수 있음). video 함수 시크릿 `R2_ACCOUNT_ID`·`R2_ACCESS_KEY_ID`·`R2_SECRET_ACCESS_KEY`(2026-10-09 등록), 선택 `VIDEO_ASR_MODEL`·`DASHSCOPE_API_BASE`(기본 QWEN_BASE 의 /compatible-mode/v1 → /api/v1)·`VIDEO_CAP_MIN`·`VIDEO_DAY_MAX`. 선택 시크릿 `QWEN_TEXT_MODEL`(기본 qwen3.8-flash, correct·field), `QWEN_VL_MODEL`(기본 qwen3-vl-plus, vocab). 초대 코드 허용 목록: 기존 5개 함수는 코드 안 `ALLOWED` 배열, call 은 시크릿 `ALLOWED_CODES`(쉼표 구분) — 저장소 파일을 수정 없이 붙여넣어 배포. 초대 코드는 public 저장소에 절대 커밋 금지. 함수는 Verify JWT 꺼져 있음(앱이 Authorization 헤더를 안 보냄).
- GitHub 저장소는 public.
- Edge Function 자동 배포(2026-10-09): `.github/workflows/deploy-functions.yml` — main 푸시에서 `supabase/functions/<이름>/` 이 바뀐 함수만 `supabase functions deploy --no-verify-jwt` 로 배포. GitHub 시크릿 `SUPABASE_ACCESS_TOKEN` 필요(없으면 건너뜀). 수동: Actions → deploy-functions → Run workflow(함수 이름). 저장소에 소스가 없는 pronounce·tts 는 대상 아님. 대시보드 붙여넣기는 토큰 등록 전까지의 대안.

## 파일 구조
- `index.html` — 전체 앱(CSS 14–653행, HTML, 단일 `<script>` 875행~).
- `supabase/functions/call/index.ts` — 통화 모드 Edge Function 소스. 정적 앱과 무관, Pages 로 공개되므로 초대 코드·키를 넣지 말 것.
- `supabase/functions/video/index.ts` — 영상 섀도잉 Edge Function(R2 SigV4 서명은 외부 라이브러리 없이 직접 구현, AWS 테스트 벡터로 검증).
- `voice/` — sz-voice Worker(`worker.js` 라우팅·중계·음성 복제, `agent.js` 박비서 도구·화면, `usage.js` 앱 사용량 수집·사용량판, `quest.js` 주말 탐험 퀘스트, `shorts.js` 숏츠 공방, `edit.js` 편집실 화면, `icon-180/192/512.png` 박비서 홈 화면 아이콘(소유자 지정 일러스트, Data 규칙으로 import), `wrangler.toml`). 정적 앱과 별개로 Workers Builds 가 배포.
- `sw.js` — 서비스워커. 앱셸 네트워크 우선·캐시 폴백, `/audio/*.mp3` 는 캐시 우선(`szcn-audio`).
- `manifest.json` — PWA(이름 "실전 중국어 - 광저우 지사장", 테마 #1664B0).
- `audio/<8자리 hex>.mp3` — 원어민 음성 약 3,700개. 파일명 = `fnv(문장 텍스트)` (FNV-1a 32bit, UTF-8, 소문자 hex 8자리 패딩).
- `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `.DS_Store`(불필요, 커밋되어 있음).

## 아키텍처 / API
- 음성 재생 `speak(t)`: 텍스트가 `AUDIO_SET`(=`collectSentences()` + `ITEMS` 중 kind:'word' 의 z)에 있으면 `audio/`+fnv(t)+`.mp3` → 실패 시 Azure TTS(`cfg.ai`+`/tts`) → 실패 시 브라우저 speechSynthesis(zh-CN).
- `prefetchAudio()` 로 mp3 를 `szcn-audio` 캐시에 선다운로드. iOS 자동재생 제한 때문에 `unlockAudio()`·`azPrefetch()` 가 존재 — 탭 직후 동기 재생 흐름을 깨지 말 것.
- AI 서버 호출(모두 POST JSON, `code`=초대코드 `cfg.sid` 동봉):
  - `{ai}/correct` {text, code, situation, intent, history} — 작문 교정(롤플레이·드릴)
  - `{ai}/field` {mode, text, code, situation} — 현장 탭
  - `{ai}/vocab` {code, images[]} — 이미지로 단어 추출 / {code, text, known?[]} — 위챗·메일 대화 붙여넣기 → 현장 표현 8~15개(2026-10-09, HSK 탭 '💬 대화 붙여넣기' `vcPasteOpen`, 결과는 사진과 같은 `vcReview`→`state.deck.words`). text 모드는 `QWEN_TEXT_MODEL`. 대시보드에 vocab 재배포해야 동작(구버전은 '사진이 없습니다.' → 앱이 재배포 안내)
  - `{ai}/pronounce` {code, text, audio(base64)} — 발음 평가(합격선 `PR_PASS=80`)
  - `{ai}/tts` {code, text} → 오디오 blob(400B 미만이면 실패 처리)
  - 통화 모드(서버 기준 `cfg.call` 없으면 `cfg.ai`): `/call/ping` {code}, `/call/say` {code,text,sc}, `/call/turn` {code,audio(16kHz WAV b64),sc{…,level,kind,me},history,n} → {heard,reply:{z},end,audio,sec,usage,timing{stt,llm,tts}}(턴 응답은 중국어만 — 지연 단축) (`stuck:true` 면 오디오 없이 다시 묻기), `/call/hints` {code,sc,history,line,noHints} → {sub:{p,k},hints[]}(상대 대사 자막+힌트, 상대 음성 재생 중 `callFetchExtras`로 받음), `/call/review` {code,sc,turns}. 서버 소스는 `supabase/functions/call/index.ts`(대시보드 Code 탭에 그대로 붙여넣어 배포, 초대 코드는 시크릿 ALLOWED_CODES). 미배포면 앱은 "통화 서버 미배포" 안내. 테이블 `call_usage`(SQL은 파일 주석)를 범용 카운터로 사용: 월 STT 초(상한 `CALL_CAP_MIN` 240분) + 코드별 하루 턴·리뷰 수(`CALL_DAY_TURNS` 300(턴+힌트), `CALL_DAY_REVIEWS` 20, 초과 시 429 daily). 테이블 없으면 상한 전부 미적용. 앱은 전송 전 앞뒤 무음을 잘라(`callTrimWav`) STT 사용 초를 줄이고, 리뷰 전문은 최근 10건만 state 에 보관(`callPrune`).
  - 영상 섀도잉(2026-10-09, HSK 탭 '🎬 영상 섀도잉' `vdOpen`): `{ai}/video/upload` {code,type,size,name}→{key,put}(R2 서명 PUT, 앱이 XHR로 직접 업로드) → `/video/start` {code,key}→{task}(百炼 파일 전사, 기본 `fun-asr`) → `/video/poll` {code,task,known}→{status, dur, sents[{t0,t1,z,p,k}], words[]}(완료 시 千问이 병음·뜻·표현 정리, kind work=업무 실무 표현 / life=드라마·애니·생활 구어 표현) · `/video/url` {code,key}→재생용 서명 GET. 서버 소스 `supabase/functions/video/index.ts`(대시보드에 이름 `video`로 그대로 붙여넣기, Verify JWT 끔). 버킷 R2 `sz-chinese-video`(APAC, CORS: github.io 오리진 PUT/GET/HEAD). 키 = `<초대코드 해시>/<시각>-<랜덤>.<확장자>`(다른 코드 영상 접근 차단). 상한: `call_usage` 의 `vid:YYYY-MM`(월 전사 초, `VIDEO_CAP_MIN` 기본 120분)·`vday:날짜:해시`(코드당 하루 `VIDEO_DAY_MAX` 기본 15개). 앱은 5분·200MB 초과 영상을 올리지 않음. 처리 중 앱을 닫으면 localStorage `szcn-vid-pend` 로 이어 받기. 표현 담기는 `vcReview` 재사용.
  - sz-voice(2026-10-09, `voice/worker.js`, Cloudflare Worker `sz-voice`, 도메인 voice.zhnote.net, Workers Builds Root directory `voice`): 앱 상수 `VOICE_URL_DEF`(⚙ `cfg.voice` 로 덮어쓰기 가능).
    - ⚡ 실시간 통화: 통화 시작 화면 `#clRt` → `rtDial()` → `wss://voice…/rt?code=` 중계 → 百炼 Qwen-Omni 실시간(`RT_MODEL` 기본 qwen3.8-omni-flash-realtime, 업무공간 주소 `DASHSCOPE_WS_HOST` 필수 — 공용 dashscope.aliyuncs.com 은 2026-09-30부터 신기능 미지원). 마이크 16k PCM16(ScriptProcessor 다운샘플) → `input_audio_buffer.append`, 출력 24k PCM(`response.audio.delta`)은 조각별 BufferSource 대신 연속 버퍼(`mkPcm`/`pcmPush`)에 이어 붙여 마이크 ScriptProcessor 출력에서 직접 보간 재생(`pcmPull`, 150ms 선버퍼 — 조각별 재생은 iOS 48k 변환 경계마다 지지직), 박비서도 같은 방식, server_vad(난이도별 무음 900/700/500ms). 기본은 상대가 말하는 동안 마이크 전송 안 함(스피커 에코로 스스로 끊김 방지), '끼어들기' 체크 시 `response.cancel`. 끊으면 `callS.turns` 를 기존 `callHang()`→`/call/review` 로 넘겨 같은 리뷰. 코드당 하루 `RT_DAY_MIN`(기본 30분, KV `rt:날짜:해시`), 한 통화 10분.
    - 🗣 내 목소리: 발음 탭 카드(`mvCardHtml`) → 15초 녹음(MediaRecorder m4a) → `/voice/enroll`(百炼 임시 저장소 oss:// 업로드 → CosyVoice `voice-enrollment` create_voice, `TTS_MODEL` 기본 cosyvoice-v3.5-plus, 이전 목소리 삭제) → `/voice/status` OK 면 `state.myVoice={on,voice,st}`. 켜져 있으면 `speak()` 가 중국어 문장을 `/voice/tts`(CosyVoice WebSocket run-task, R2 `tts/<voice>/<fnv>.mp3` 캐시)로 재생, 실패 시 원래 음성(`mvBypass`).
    - 🎙 박비서(2026-10-09, `voice/agent.js`): `https://voice.zhnote.net/` 단독 화면(초대 코드 1회 입력, localStorage `pb-code`). `/agent` WebSocket — `/rt` 와 같은 중계지만 서버가 `session.created` 에 `session.update`(지시문·`AGENT_TOOLS`)를 직접 보내고 앱의 session.update 는 무시. 모델의 `response.function_call_arguments.done` 을 서버가 `runTool()` 로 실행 → `conversation.item.create{function_call_output}` + `response.create`, 앱에는 `agent.tool` 이벤트로 표시. 도구: get_weather(Open-Meteo 지오코딩+예보), convert_currency(Frankfurter), find_place·plan_route(서비스 바인딩 `DIDI`→didi-address `/api/places`·`/api/route`, 시크릿 `DIDI_ACCESS_KEY`), trip_info(스페인 일정 상수 `SPAIN`), now. 앱 → `{type:'agent.gps',loc}` 로 현재 위치(WGS84). 응답은 한국어. 하루 사용량은 실시간 통화와 같은 KV 상한.
    - 📊 앱 사용량판(2026-10-10, `voice/usage.js`): `https://voice.zhnote.net/usage`(박비서 화면 우상단 📊). 주인 전용 — 처음 연 초대 코드의 해시를 KV `usage:owner` 에 고정, 다른 코드는 `not_owner`. 수집 `POST /u`(sendBeacon text/plain JSON `{app,c:{기능:횟수},sec,w?}`, IP당 분당 30회, 응답 204) → KV `u:<중국날짜>:<앱>:<임의>` 값 없이 메타데이터 `{c,s,w}`(list 한 번으로 집계, get 없음), 120일 TTL. 앱 목록·기능 이름표 `APPS`(szcn·rt·pb·didi·threepark·spain). szcn·rt·pb 는 초대 코드 해시 `w` 로 주인 것만 집계(다른 베타 사용자는 인원수만). 실시간 통화·박비서는 서버가 통화 끝에 기록(도구별 횟수 포함). 실전 중국어는 `uT(기능)`/`uFlush()`(index.html, voiceUrl 바로 아래) — 탭 이동·롤플레이·통화·영상·붙여넣기·발음·내 목소리·현장 AI, 화면이 숨겨질 때 한 번 전송. 학습 분·문제 수는 Supabase trainer `stats.days` 를 서버가 읽어 표시. 다른 저장소(didi-address·threepark·threepark-spain)도 같은 `/u` 로 보냄. 새 기능을 기록하려면 앱에서 `uT('키')` + `APPS[앱].f` 에 이름표 추가. KV 무료 쓰기 하루 1000회 안에서 동작(화면 숨김마다 1회).
    - 🧭 주말 탐험 퀘스트(2026-10-10, `voice/quest.js`): `https://voice.zhnote.net/quest`(박비서 헤더 🧭). 누구랑(`who` duo 부부 둘이 기본 / solo 혼자 — 소유자 요청으로 아이 동반 아닌 어른용 미션)·기분(`MOODS` mix·nature·food·culture·street → 高德 키워드, 카페·찻집 포함)·반경(3/5/10/20km) 고르고 현재 위치(WGS84) → `POST /quest/new` → 서비스 바인딩 `DIDI` 의 `/api/poi`(高德 주변 검색, 키워드당 8곳, 지도 서명 `ms` 포함) + Open-Meteo 오늘 날씨 → 千问(`QUEST_MODEL` 기본 qwen3.8-flash, `https://<DASHSCOPE_WS_HOST>/compatible-mode/v1`, JSON 모드, enable_thinking:false)이 후보 중 3곳·사진 미션·현지 중국어 한 마디·점수(10/20/30) 작성. 이미 다녀온 곳(`hist[].pid`) 제외, 코드당 하루 `QUEST_DAY_MAX`(기본 6)회. `POST /quest/check {qid,image(1280px JPEG data URL)}` → 千问 VL(`QUEST_VL_MODEL` 기본 qwen3-vl-plus) 판정 → 통과 시 R2 `quest/<코드해시>/<날짜>-<qid>.jpg`·점수·카테고리·배지(`BADGES` 11개), 실패 시 다시 찍기 또는 `/quest/honor`(점수 절반). KV `quest:<코드해시>` 문서 하나 {cur, pts, badges, hist(200), cats, gen, weeks}. 사진은 `/quest/img?k&s`(HMAC 서명), 지도는 `/quest/map`(디디 `/api/map` 중계), 高德 장소 사진은 `/quest/photo?u`(autonavi·amap·alicdn 호스트만, 캐시). 사용량판 앱 `quest`. 현지 중국어 🔊 는 `GET /quest/say?h&t&s`(서명) → CosyVoice 기본 음성(`QUEST_VOICE` 기본 longxiaochun_v2, `QUEST_TTS_MODEL` 기본 cosyvoice-v2) → 실패 시 내 목소리 → R2 `tts/quest/<hmac>.mp3` 캐시, 화면은 렌더 때 음성을 미리 받아(`prefetchSay`: /quest/say → 실패 시 Supabase `tts`(Azure, 같은 초대 코드) → objectURL) 탭 순간 바로 재생, 아직 준비 중이면 탭 안에서 무음으로 Audio 를 깨운 뒤 같은 요소로 재생, 둘 다 실패하면 브라우저 speechSynthesis + 실패 이유 토스트(서버 502 본문에 원인).
    - 🎬 숏츠 공방(2026-10-10, `voice/shorts.js`, 주인 전용 — `usage:owner` 와 같은 주인): `https://voice.zhnote.net/shorts`(박비서 헤더 🎬). 광저우 생활 숏츠. 한국 시청자 관점(소유자 요청 2026-10-10: 중국 문화 해설 말고 한국인에게 재밌거나 쓸모 있는 것) — 프롬프트는 한국어, 공통 규칙 `KR_RULES`(한국 비교·원화 환산·꿀팁·반전 중 하나 이상, 중국어 단어 최소화), 각도 `ANGLES`(mix·compare·price·tip·shock·food·life, 화면 칩, localStorage `sh-ang`), 환율은 Frankfurter CNY→KRW. ① `/shorts/ideas {angle}` 千问(`enable_search`, 실패 시 검색 없이)이 한국 뉴스·커뮤니티 관심사와 주말 탐험 기록 참고해 주제 5개 ② `/shorts/script {topic,sec 30|45|60,angle}` → 장면 5/7/9개 `{cap(화면 큰 글씨), say(한국어 내레이션), img(중문 그림 설명, 글자 없음), move}` + 제목·설명·태그, KV `shorts:<코드해시>`(목록 40)·`shorts:<코드해시>:<id>`(120일) ③ `/shorts/asset` img=通义万相 문생도 비동기(`SHORTS_T2I_MODEL` 기본 wan2.5-t2i-preview, 720*1280), vid=사진→영상 비동기(`SHORTS_I2V_MODEL` 기본 wan2.5-i2v-preview, `SHORTS_I2V_RES` 480P, `SHORTS_I2V_SEC` 5, 그림을 base64 로 넘김), say=qwen3-tts-flash 한국어(`SHORTS_VOICE` 기본 Cherry, 실패 시 내 목소리 CosyVoice) → `/shorts/poll` 완료 시 R2 `shorts/<코드해시>/<id>/<n>.jpg|mp4|wav|mp3`. 소재 키는 결정적 경로라 초안 문서를 고치지 않음(`/shorts/load` 가 R2 list 로 찾음). 하루 상한 `SHORTS_IMG_DAY` 40·`SHORTS_VID_DAY` 6(KV `shorts:cost:<날짜>`, 화면 상단에 추정 위안). ④ 렌더는 브라우저 720×1280 캔버스+MediaRecorder(켄 번스·클립·페이드, 큰 글씨 위 18%, 자막 66% — 숏츠 하단 UI 가리지 않게), 내레이션 길이+0.35초씩. ⑤ `/shorts/save?id`(헤더 x-code, 본문 영상) → R2 `final.mp4|webm` → `/shorts/yt/upload {privacy}` 가 리프레시 토큰으로 resumable 업로드(categoryId 19, `containsSyntheticMedia:true`, 제목에 #Shorts). 유튜브 연결: `/shorts/yt/start` → 구글 동의 → `GET /shorts/yt/cb`(state KV 15분) → KV `yt:<코드해시>` {refresh, channel}. 시크릿 `YT_CLIENT_ID`·`YT_CLIENT_SECRET`(Google Cloud OAuth 웹 클라이언트, 리디렉션 URI `https://voice.zhnote.net/shorts/yt/cb`, 동의 화면 '프로덕션'이어야 리프레시 토큰이 7일 뒤 만료되지 않음). `/shorts/file?k&s` 는 HMAC 서명 + Range(iOS 동영상). 사용량판 앱 `shorts`. 구글 OAuth 브랜딩(앱 게시)용 공개 페이지 `/about`·`/privacy`·`/terms`(`legalPage`, 승인된 도메인 zhnote.net).
    - 🎥 편집실(2026-10-10, `voice/edit.js` `EDIT_HTML`, `GET /edit`, 숏츠 공방 맨 위 빨간 버튼): 내가 찍은 클립으로 숏츠. **원본 영상은 서버로 안 보냄** — 폰이 objectURL 로 열어 클립당 2~8장(합계 최대 40) 384px JPEG 캡처만 `POST /shorts/plan {topic,sec,angle,clips[{dur,name}],frames[{c,t,img}]}` → 千问 VL(`SHORTS_VL_MODEL` 기본 qwen3-vl-plus, 프레임마다 "[클립 n · t초]" 라벨)이 `segments[{clip,start,end,cap,say}]`(첫 구간 훅, 1.5~6초, 1초당 내레이션 4자 이내, 사진에 없는 사실 금지)+제목·설명·태그 → 초안 `kind:'mine'`(clips·scenes{clip,s,e,cap,say}·opts{fit crop|full, orig 0|0.3|1, narr, subs}). 편집: 구간 클립·시작·끝·순서·복제·삭제, ▶ 미리보기. 내레이션은 렌더 직전 `/shorts/asset say`(문장 바뀐 구간만 다시). 렌더는 폰 캔버스 720×1280 — 구간마다 seek→재생→`firstFrame`(requestVideoFrameCallback, 없으면 readyState≥3, 최대 0.9초)으로 실제 프레임 확인 뒤 `MediaRecorder.resume()`, 사이엔 `pause()`. 컷 전환은 검은 페이드 대신 앞 구간 마지막 화면 스냅샷을 0.25초 겹쳐 사라지게(소유자 지적 2026-10-10: 검은 화면 끼임), 프레임 준비 전엔 스냅샷 표시. 내레이션 목소리 `opts.voice`: Cherry(AI 여성)·Ethan(AI 남성)·mine(CosyVoice 복제, 미등록이면 Cherry)·rec(구간마다 🎙 직접 녹음, MediaRecorder 오디오, 메모리에만 — 화면 닫으면 사라짐); `/shorts/asset say {voice}`, 구간 객체에 `_narr{key=voice|문장}`·`_rec` 로 순서 바꿔도 유지, 원본 소리는 `createMediaElementSource`→게인, 내레이션이 구간보다 길면 마지막 화면 유지. iOS: 렌더 버튼 탭 순간 모든 클립을 소리 켠 채 play→pause 로 깨움(이후 비동기 재생 허용), 실패 시 음소거로 재생. 전체 보기 흐린 배경은 `ctx.filter` 대신 24×42 캔버스 축소→확대(사파리 호환). 업로드는 숏츠와 같은 `/shorts/save`→`/shorts/yt/upload`(`synthetic` = AI 내레이션 사용 여부로 `containsSyntheticMedia`). 이어서 편집(`/edit?id=`)은 같은 클립을 같은 순서로 다시 고르게 함. qwen 호출은 400 이면 response_format 빼고 재시도, JSON 앞뒤 잡문 허용.
    - Worker 시크릿: `DASHSCOPE_API_KEY`, `DASHSCOPE_WS_HOST`, `ALLOWED_CODES`, `DIDI_ACCESS_KEY`, (유튜브) `YT_CLIENT_ID`, `YT_CLIENT_SECRET`. 바인딩 KV `KV`(sz-voice), R2 `R2`(sz-chinese-video), 서비스 `DIDI`(didi-address).
  - 초대 코드에 AI 권한이 없으면 서버가 거부 → UI 문구 "이 초대 코드는 AI … 사용할 수 없습니다".
- Supabase REST: `GET {SB_URL}/rest/v1/trainer?id=eq.<sid>&select=data`, `POST …/trainer` (Prefer: resolution=merge-duplicates) body `[{id:sid,data:state,updated_at}]`.

## 데이터
- localStorage:
  - `szcn-trainer-v1` — state `{prog:{}, stats:{total,correct,days:{YYYY-MM-DD:{n,c,min,sq,m,am,mv,pm}}}, mastered, myWords:{}, rp:{}, gram:{}, ptDone:{}, goals:{min:220,sent:60,quiz:200,mast:35}, pron:{…}, call:{level:1|2|3, score:{key:최근점수}, missionOff, log:[{id,key,lv,lat,ko,peek,targets?,retryOf?,mission?,d,dur,turns:[{r:'me'|'npc',z,p,k,sec}],review}] (최근 20건, 오디오 미저장), usage:{'YYYY-MM':{c:통화초,p:발음초}}, subs}, vid:[{key,d,name,kind:'work'|'life',dur,s:[[t0,t1,z,p,k]],w:[{z,p,k,ex}]}](최근 12개, 영상 원본은 R2)}` — `call` 은 `callState()` 가 지연 초기화
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
- 색상(2026-10-09 소유자 지정 개인 팔레트): Aegean Sky `#1664B0`(헤더·푸터 `--sky`, 강조 `--red`) · Sandy Linen `#EFE8DE`(바탕 `--bg`) · Scarlet Bikini `#D21624`(헤더 아래 줄 `--wash`, 경고 `--danger`·`--c2`). `--navy:#1A2330`은 글자색 겸 진한 버튼 바탕(딥 잉크). 시나리오 색 `--c0..c5`는 구분용으로 유지. theme-color·manifest `#1664B0`. 아이콘 = 헤더 말풍선 로고를 이 팔레트로(파랑 바탕·리넨 말풍선·스칼렛 점).
- 모바일(아이폰·아이패드) 우선, 하단 탭바, 바텀시트(`#sheet`), 모달(`#cfgModal`, `#welModal`).
- E·LAND CI 레드(#D51030)를 쓰지 않는 개인 브랜드형 디자인 — 위 개인 팔레트 유지.

## 주의사항 / 알려진 이슈
- Supabase 접근 정책(RLS) 미확인. 인증·권한 관련 변경은 소유자 확인 후 진행.
- correct·field·pronounce·tts·vocab 소스는 저장소에 없음(Supabase 대시보드에만 있음). 스펙 변경 시 대시보드 코드를 받아서 수정.
- Supabase 무료 플랜은 1주일간 DB 활동이 적으면 프로젝트 일시정지(2026-10-08 국경절 연휴 뒤 실제 발생 → 동기화·AI 전부 중단, 대시보드 Resume project 로 복구). `.github/workflows/supabase-keepalive.yml` 이 매일 공개키로 trainer 를 조회해 방지, 실패 시 GitHub 알림.
- `.DS_Store` 커밋되어 있음(삭제 무해).
- `sw.js` 는 index.html 등 앱셸을 네트워크 우선으로 받으므로 배포 즉시 반영되나, 캐시 이름을 올려야 구버전 캐시 정리.
- 중국 본토에서 `*.supabase.co` VPN 없이 접속 가능 여부 미확인(2026-10-08 빨간 점·통화 음성 실패는 네트워크가 아니라 프로젝트 일시정지가 원인이었음). 동기화·통화 요청은 10초 타임아웃(`sbFetch`), 실패 원인은 `syncErr`로 ⚙ 모달에 표시. 실패 시 로컬 저장으로 동작.

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
