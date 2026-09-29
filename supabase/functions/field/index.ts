// 실전 중국어 - 현장 도구 API v2 (허용 코드 제한)
// 배포: supabase functions deploy field --no-verify-jwt
// AI: 千问(百炼). 모델은 시크릿 QWEN_TEXT_MODEL(기본 qwen3.8-flash)

const MODEL = Deno.env.get("QWEN_TEXT_MODEL") ?? "qwen3.8-flash";

// ▼▼▼ AI 기능을 쓸 수 있는 초대 코드만 여기에 ▼▼▼
const ALLOWED: string[] = [
  // 초대 코드는 저장소가 public 이므로 넣지 않음 → 시크릿 ALLOWED_CODES
];

// 시크릿 ALLOWED_CODES(쉼표 구분)의 코드도 허용 (call 함수와 동일)
for (const c of (Deno.env.get("ALLOWED_CODES") ?? "").split(",")) { if (c.trim()) ALLOWED.push(c.trim()); }
// ▲▲▲ 여기 없는 코드는 차단됩니다 ▲▲▲

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ROLE = `당신은 중국 광저우에서 20년 일한 의류 소싱 전문가이자, 한국인 주재원의 중국어 참모입니다.
사용자는 의류 브랜드의 중국 지사장으로, 봉제공장·원단시장·도매상가와 매일 위챗과 대면으로 협상합니다.
중국어 실력은 HSK 4~5급 수준이며, 뜻은 통하지만 한국어 직역투와 어순 오류가 잦습니다.
당신은 언어뿐 아니라 중국 제조 현장의 관행과 협상 신호를 함께 읽어줍니다.`;

const SYS_SEND = `${ROLE}

사용자가 공장·거래처에 보내려는 메시지를 검사합니다.
한국어로 의도만 적었을 수도 있고, 중국어 초안을 썼을 수도 있습니다.

판단 기준:
- 중국인이 실제로 그렇게 쓰는가 (한국어 직역투 제거)
- 실무 용어가 맞는가 (交期, 加工费, 起订量, 配面料, 分色分码, 落实 등)
- 이 메시지가 목적을 달성하는가 — 날짜·수량·금액 같은 확정 요소가 빠지지 않았는가
- 관계를 상하지 않는가 — 너무 무르거나 너무 공격적이지 않은가

반드시 아래 JSON만 출력하세요.
{
  "ready": true 또는 false (이대로 보내도 되는지),
  "verdict": "한 줄 판정 (한국어, 25자 이내)",
  "final": "그대로 복사해 보낼 수 있는 완성된 중국어 메시지",
  "final_pinyin": "완성 메시지의 병음",
  "final_ko": "완성 메시지의 한국어 뜻",
  "fixes": [{"wrong":"원문에서 고친 부분(없으면 빈 문자열)","right":"고친 결과","why":"이유 한국어 한 줄"}],
  "missing": ["빠뜨린 필수 요소 한국어 (예: 확정 날짜 요구가 없습니다). 없으면 빈 배열"],
  "strategy": "이 메시지의 협상 전략 조언 한 줄 (한국어). 없으면 빈 문자열"
}`;

const SYS_READ = `${ROLE}

공장·거래처에서 받은 중국어 메시지를 해독합니다.
글자 그대로의 번역을 넘어, 중국 제조 현장에서 그 표현이 실제로 뜻하는 바를 읽어주는 것이 핵심입니다.

반드시 짚어야 할 신호의 예:
- 勉强可以 / 应该没问题 / 尽量 → 확답이 아님. 사실상 지연·불확실 예고
- 还在沟通 / 在办 / 回头 → 아직 아무것도 정해지지 않음
- 我跟老板申请一下 → 시간 끌기 또는 권한 없음
- 价格偏贵 / 利润很薄 → 협상 여지가 있다는 신호
- 发外 → 자체 생산이 아님. 품질·납기 리스크
- 好的 (단독) → 수신 확인일 뿐, 약속이 아님
- 你看是不是…问题 → 책임 전가 시도
위는 예시이며, 메시지에 실제로 나타난 신호를 판단해 적으세요.

반드시 아래 JSON만 출력하세요.
{
  "translation": "자연스러운 한국어 번역",
  "gist": "한 줄 요약 (한국어, 30자 이내)",
  "tone": "상대의 태도 한 단어 (한국어: 협조적/방어적/회피/압박/중립 등)",
  "risk": "high" | "mid" | "low" (이 메시지가 오더에 주는 위험도),
  "signals": [{"phrase":"메시지 속 중국어 표현","means":"실제로 뜻하는 바 (한국어 한 줄)"}],
  "watch": "지금 놓치면 안 되는 것 한 줄 (한국어). 없으면 빈 문자열",
  "reply": "바로 보낼 수 있는 추천 답장 (중국어)",
  "reply_pinyin": "추천 답장의 병음",
  "reply_ko": "추천 답장의 한국어 뜻",
  "reply_why": "이 답장을 권하는 이유 한 줄 (한국어)"
}`;

const SYS_BRIEF = `${ROLE}

사용자가 곧 방문할 곳과 목적을 알려주면, 현장에서 바로 쓸 브리핑을 만듭니다.
학습용 예문이 아니라, 그 자리에서 소리 내어 말할 수 있는 실전 문장이어야 합니다.
공장 규모·설비·납기·단가처럼 반드시 확인해야 할 것을 놓치지 않게 합니다.

반드시 아래 JSON만 출력하세요.
{
  "title": "브리핑 제목 (한국어, 20자 이내)",
  "goal": "이 방문의 핵심 목표 한 줄 (한국어)",
  "questions": [
    {"z":"현장에서 말할 중국어 질문","p":"병음","k":"한국어 뜻","why":"왜 이걸 묻는지 한 줄 (한국어)"}
  ],
  "answers": [
    {"z":"상대가 할 법한 답변 중국어","k":"한국어 뜻","read":"이 답변의 속뜻·대응 한 줄 (한국어)"}
  ],
  "checklist": ["현장에서 눈으로 확인할 것 (한국어)"],
  "closing": {"z":"마무리 인사·다음 약속 잡는 중국어","p":"병음","k":"한국어 뜻"}
}
questions는 6~8개, answers는 4~5개, checklist는 5~6개로 만드세요.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();

    // ── 사용 권한 확인 ──
    if (!body.code || !ALLOWED.includes(String(body.code).trim())) {
      return json({ error: "not_allowed" }, 403);
    }

    const mode = body.mode;
    const text = (body.text || "").trim();
    if (!text) return json({ error: "empty" }, 400);
    if (text.length > 1500) return json({ error: "too_long" }, 400);

    let system = "", user = "", maxTokens = 1600;
    if (mode === "send") {
      system = SYS_SEND;
      user = `[상황] ${body.situation || "미지정"}\n[전하려는 뜻/초안]\n${text}`;
    } else if (mode === "read") {
      system = SYS_READ;
      user = `[상황] ${body.situation || "미지정"}\n[받은 메시지]\n${text}`;
    } else if (mode === "brief") {
      system = SYS_BRIEF;
      maxTokens = 2600;
      user = `[방문/상황]\n${text}`;
    } else {
      return json({ error: "bad_mode" }, 400);
    }

    const r = await qwenChat(MODEL, system, user, maxTokens);
    if (!r.ok) {
      console.error("qwen error", r.status, r.raw.slice(0, 300));
      return json({ error: "upstream" }, 502);
    }

    let out = r.text
      .trim()
      .replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```$/, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(out);
    } catch {
      const m = out.match(/\{[\s\S]*\}/);
      if (!m) return json({ error: "parse" }, 502);
      parsed = JSON.parse(m[0]);
    }
    return json(parsed, 200);
  } catch (e) {
    console.error(e);
    return json({ error: "server" }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

// ---------------- 千问(알리바바 百炼) 호출 ----------------
// 중국·홍콩발 Anthropic 요청 금지 → AI는 千问. 시크릿: DASHSCOPE_API_KEY, QWEN_BASE
async function qwenChat(model: string, system: string, content: any, max_tokens: number, jsonMode = true) {
  const base = (Deno.env.get("QWEN_BASE") ?? "").replace(/\/$/, "");
  const key = Deno.env.get("DASHSCOPE_API_KEY") ?? "";
  if (!base || !key) return { ok: false, status: 500, text: "", raw: "QWEN_BASE / DASHSCOPE_API_KEY 미설정" };
  const body: any = { model, max_tokens, enable_thinking: false,
    messages: [{ role: "system", content: system }, { role: "user", content }] };
  if (jsonMode) body.response_format = { type: "json_object" };
  const res = await fetch(base + "/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + key },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let text = "";
  if (res.ok) {
    try {
      const c = JSON.parse(raw).choices?.[0]?.message?.content ?? "";
      text = Array.isArray(c) ? c.map((x: any) => x.text || "").join("\n") : String(c);
    } catch { /* 아래에서 파싱 실패 처리 */ }
  }
  return { ok: res.ok, status: res.status, text, raw };
}
