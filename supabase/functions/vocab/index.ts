// supabase/functions/vocab/index.ts
// 단어 학습 자료 사진 → 앱 단어 JSON (千问 Vision, 알리바바 百炼)
// 요청: POST { code, images:[{media_type,data}], hint? }
// 응답: { ok, day, words:[{z,p,k,ex:{z,p,k}}] }

const ALLOWED: string[] = [
  // 초대 코드는 저장소가 public 이므로 넣지 않음 → 시크릿 ALLOWED_CODES
];

// 시크릿 ALLOWED_CODES(쉼표 구분)의 코드도 허용 (call 함수와 동일)
for (const c of (Deno.env.get("ALLOWED_CODES") ?? "").split(",")) { if (c.trim()) ALLOWED.push(c.trim()); }

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const SYSTEM =
  "당신은 중국어 학습 자료 사진에서 단어를 뽑아 JSON으로 바꾸는 변환기입니다. " +
  "설명, 인사말, 코드펜스 없이 JSON 객체 하나만 출력합니다.";

const RULES = `이 사진은 중국어 단어 학습 자료입니다. 아래 규칙대로 단어를 추출하세요.

1. 사진에 있는 중국어 단어·표현을 빠짐없이 뽑습니다. 간체자로 적습니다.
2. 병음은 성조 부호를 붙입니다 (예: chǎng, zhǔyào, pǐnlèi). 성조 숫자 표기는 쓰지 않습니다.
3. 한국어 뜻은 20자 이내로 간결하게. 여러 뜻이면 가운뎃점으로 구분합니다 (예: 확정·실행).
4. 예문은 사진에 있는 예문을 그대로 옮기지 말고 반드시 새로 만듭니다.
   광저우 의류 소싱 현장에서 실제로 쓸 법한 문장으로 만듭니다.
   상황은 공장·원단시장·위챗 대화·식당·택시 중에서 단어에 어울리는 것을 고릅니다.
   길이는 한자 8~18자. 과장되거나 교과서 같은 문장은 피하고, 실제로 오갈 법한 말투로 씁니다.
5. 예문 병음도 성조 부호를 붙이고, 문장 첫 글자만 대문자로 씁니다.
6. 사진에 Day 번호나 과 번호가 보이면 day에 숫자만 넣고, 없으면 null.
7. 사람 이름·공장명·금액이 사진에 있으면 예문에 쓰지 않습니다.

출력 형식 (이 JSON 객체 하나만):
{"day":3,"words":[{"z":"品类","p":"pǐnlèi","k":"품목·카테고리","ex":{"z":"你们厂主要做什么品类？","p":"Nǐmen chǎng zhǔyào zuò shénme pǐnlèi?","k":"공장 주력 품목이 뭐예요?"}}]}`;

function pickJson(t: string): any {
  let s = (t || "").trim();
  s = s.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  return JSON.parse(s);
}

function clean(s: unknown, max: number): string {
  return String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const MODEL = Deno.env.get("QWEN_VL_MODEL") ?? "qwen3-vl-plus";

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "요청 본문을 읽지 못했습니다." }, 400);
  }

  const code = payload?.code;
  const images = payload?.images;
  const hint = clean(payload?.hint, 120);

  if (!ALLOWED.includes(code)) {
    return json({ error: "이 코드로는 사진 단어 추출을 사용할 수 없습니다." }, 403);
  }
  if (!Array.isArray(images) || !images.length) {
    return json({ error: "사진이 없습니다." }, 400);
  }
  if (images.length > 4) {
    return json({ error: "사진은 한 번에 4장까지입니다." }, 400);
  }

  const content: any[] = [];
  for (const im of images) {
    const mt = String(im?.media_type || "");
    const data = String(im?.data || "");
    if (!/^image\/(jpeg|png|webp|gif)$/.test(mt) || !data) {
      return json({ error: "사진 형식을 읽지 못했습니다." }, 400);
    }
    if (data.length > 5_500_000) {
      return json({ error: "사진 용량이 너무 큽니다." }, 400);
    }
    content.push({ type: "image_url", image_url: { url: `data:${mt};base64,${data}` } });
  }
  content.push({ type: "text", text: RULES + (hint ? `\n\n참고: ${hint}` : "") });

  let r: { ok: boolean; status: number; text: string; raw: string };
  try {
    r = await qwenChat(MODEL, SYSTEM, content, 4000, false);
  } catch (e) {
    return json({ error: "AI 서버 연결 실패", detail: String(e) }, 502);
  }
  if (!r.ok) {
    return json({ error: `AI 오류 ${r.status}`, detail: r.raw.slice(0, 400) }, 502);
  }
  const text = r.text;

  let parsed: any;
  try {
    parsed = pickJson(text);
  } catch {
    return json({ error: "단어를 읽지 못했습니다. 사진을 더 밝게 찍어 다시 시도해 주세요.", detail: text.slice(0, 300) }, 502);
  }

  const seen: Record<string, boolean> = {};
  const words = (parsed.words || [])
    .map((w: any) => {
      const z = clean(w?.z, 24);
      if (!z || !/[\u4e00-\u9fff]/.test(z) || seen[z]) return null;
      seen[z] = true;
      const ex = w?.ex || {};
      const exz = clean(ex?.z, 60);
      return {
        z,
        p: clean(w?.p, 60),
        k: clean(w?.k, 40),
        ex: exz ? { z: exz, p: clean(ex?.p, 140), k: clean(ex?.k, 80) } : null,
      };
    })
    .filter(Boolean)
    .slice(0, 60);

  if (!words.length) {
    return json({ ok: false, message: "사진에서 단어를 찾지 못했습니다. 글자가 잘 보이게 다시 찍어 주세요." });
  }

  const day = Number.isFinite(parsed.day) ? parsed.day : null;

  return json({ ok: true, day, model: MODEL, words });
});

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
