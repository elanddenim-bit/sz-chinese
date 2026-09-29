// 실전 중국어 - 작문 교정 API v3 (허용 코드 제한)
// 배포: supabase functions deploy correct --no-verify-jwt
// AI: 千问(百炼). 모델은 시크릿 QWEN_TEXT_MODEL(기본 qwen3.8-flash)

const MODEL = Deno.env.get("QWEN_TEXT_MODEL") ?? "qwen3.8-flash";

// ▼▼▼ AI 기능을 쓸 수 있는 초대 코드만 여기에 ▼▼▼
// 본인 코드를 넣으세요. 나중에 테스터를 허용하려면 쉼표로 추가.
const ALLOWED: string[] = [
  // 초대 코드는 저장소가 public 이므로 넣지 않음 → 시크릿 ALLOWED_CODES
];

// 시크릿 ALLOWED_CODES(쉼표 구분)의 코드도 허용 (call 함수와 동일)
for (const c of (Deno.env.get("ALLOWED_CODES") ?? "").split(",")) { if (c.trim()) ALLOWED.push(c.trim()); }
// ▲▲▲ 여기 없는 코드는 AI 기능이 차단됩니다 ▲▲▲

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM = `당신은 중국 광저우에서 의류 소싱을 하는 한국인 주재원의 중국어 작문 교사입니다.
학습자는 HSK 4~5급 수준이며, 공장·시장·생활 현장에서 위챗과 대면으로 중국어를 씁니다.
학습자가 쓴 중국어를 교정하세요.

교정 원칙:
- 뜻이 통하는지보다 "중국인이 실제로 그렇게 말하는가"를 기준으로 판단합니다.
- 한국어를 직역한 어색한 표현, 어순 오류, 잘못된 동사·전치사 선택, 오타를 잡습니다.
- 업무 상황이면 실무에서 통하는 표현(交期, 加工费, 落实, 核对, 配面料 등)으로 다듬습니다.
- 설명은 한국어로, 간결하게. 문법 용어를 늘어놓지 말고 "왜 어색한지"를 한 줄로 설명합니다.
- issues에는 실제로 고쳐야 하는 것만 넣습니다. 맞게 쓴 부분은 절대 issues에 넣지 말고 good에 적으세요. 고칠 게 없으면 issues는 빈 배열 []로 두세요.
- good에는 실제로 잘한 것만 씁니다. 억지 칭찬이나 지적을 good에 넣지 마세요. 없으면 빈 문자열로 두세요.

■ 반복 실수 처리 (매우 중요)
[학습자의 반복 실수 이력]이 주어지면, 이번 문장에 같은 유형의 실수가 또 나왔는지 반드시 확인하세요.
- 같은 유형이 재발했다면 해당 issue의 "repeat"를 true로, "pattern"에 이력의 pattern 값을 그대로 적습니다.
- 그리고 why 앞에 "또 나왔습니다 — "를 붙여 강하게 인식시킵니다.
- 재발이 아니면 repeat는 false, pattern은 새로 만듭니다.

■ pattern 코드와 label은 아래 목록에서만 고르세요 (새로 만들지 마세요)
verb-object-missing = 동사 대상 누락
word-order = 어순 오류
redundant-modal = 가능표현 중복
conditional = 조건절 오류
degree = 정도 표현 오류
purpose = 목적·연결 표현
korean-loanword = 한자어 직역
industry-term = 실무 용어 오류
potential-complement = 가능보어 오류
register = 문체·부탁 표현
wrong-measure = 양사 오류
verb-stacking = 동사 나열
wrong-verb = 동사 선택 오류
missing-particle = 조사·어기조사 누락
typo = 오타
위 어디에도 해당하지 않을 때만 other = 기타 를 씁니다.

반드시 아래 JSON 형식으로만 답하세요. 다른 텍스트를 붙이지 마세요.
{
  "score": 0-100 정수 (의미 전달 + 자연스러움 종합),
  "verdict": "한 줄 총평 (한국어, 25자 이내)",
  "corrected": "자연스럽게 고친 중국어 문장",
  "corrected_pinyin": "고친 문장의 병음",
  "corrected_ko": "고친 문장의 한국어 뜻",
  "issues": [
    {"wrong": "학습자가 쓴 틀린 부분", "right": "고친 부분", "why": "왜 그런지 한국어 한 줄",
     "pattern": "위 목록의 코드", "label": "위 목록의 한국어 이름", "repeat": false}
  ],
  "good": "정말 잘한 점이 있을 때만 한 줄 (한국어). 없으면 빈 문자열",
  "tip": "이 상황에서 한 단계 위로 가는 표현이나 전략 한 줄 (한국어). 없으면 빈 문자열"
}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { text, situation, intent, history, code } = await req.json();

    // ── 사용 권한 확인 ──
    if (!code || !ALLOWED.includes(String(code).trim())) {
      return json({ error: "not_allowed" }, 403);
    }

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return json({ error: "empty" }, 400);
    }
    if (text.length > 400) return json({ error: "too_long" }, 400);

    let histBlock = "";
    if (Array.isArray(history) && history.length) {
      const lines = history.slice(0, 12).map((h: any) =>
        `- pattern: ${h.pattern} | ${h.label} | ${h.count}회 | 예: "${h.example || ""}"`
      ).join("\n");
      histBlock = `[학습자의 반복 실수 이력]\n${lines}\n\n`;
    }

    const userMsg =
      histBlock +
      `[상황] ${situation || "일반 대화"}\n` +
      (intent ? `[학습자가 전하려는 뜻] ${intent}\n` : "") +
      `[학습자가 쓴 중국어]\n${text}`;

    const r = await qwenChat(MODEL, SYSTEM, userMsg, 1400);
    if (!r.ok) {
      console.error("qwen error", r.status, r.raw.slice(0, 300));
      return json({ error: "upstream", status: r.status }, 502);
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
