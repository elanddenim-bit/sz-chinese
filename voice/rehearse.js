// 📞 내 상황 리허설(2026-10-23 소유자 — 내일 실제로 할 통화를 한 줄 적으면 그 상황으로 통화 연습)
// POST /rehearse/plan {code, text, kind?} → 千问이 실전 중국어 통화 모드 상황 한 벌을 만든다(앱이 state.call.custom 에 저장).
const host = (env) => (env.DASHSCOPE_WS_HOST || "dashscope.aliyuncs.com").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
const rerr = (message, status = 400) => Object.assign(new Error(message), { code: "rehearse", status });
const VOICES = { m: "zh-CN-YunjianNeural", f: "zh-CN-XiaoxiaoNeural", o: "zh-CN-YunyangNeural" };

async function qwen(env, sys, user) {
  const call = async (fmt) => {
    const r = await fetch("https://" + host(env) + "/compatible-mode/v1/chat/completions", {
      method: "POST", headers: { authorization: "Bearer " + env.DASHSCOPE_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ model: env.REHEARSE_MODEL || "qwen-plus", temperature: 0.5, enable_thinking: false, ...(fmt ? { response_format: { type: "json_object" } } : {}),
        messages: [{ role: "system", content: sys }, { role: "user", content: user }] }),
    });
    if (r.status === 400 && fmt) return call(false);
    const j = await r.json();
    if (!r.ok) {
      if (env.REHEARSE_MODEL == null && r.status >= 400) { // qwen-plus 가 막혀 있으면 빠른 모델로
        const r2 = await fetch("https://" + host(env) + "/compatible-mode/v1/chat/completions", { method: "POST", headers: { authorization: "Bearer " + env.DASHSCOPE_API_KEY, "content-type": "application/json" },
          body: JSON.stringify({ model: env.QUEST_MODEL || "qwen3.8-flash", temperature: 0.5, enable_thinking: false, messages: [{ role: "system", content: sys }, { role: "user", content: user }] }) });
        const j2 = await r2.json();
        if (!r2.ok) throw rerr("千问 오류: " + ((j2.error && j2.error.message) || r2.status), 502);
        const s2 = String(j2.choices[0].message.content); return JSON.parse(s2.slice(s2.indexOf("{"), s2.lastIndexOf("}") + 1));
      }
      throw rerr("千问 오류: " + ((j.error && j.error.message) || r.status), 502);
    }
    const s = String(j.choices[0].message.content);
    return JSON.parse(s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1));
  };
  return call(true);
}

const SYS = `你是中文口语陪练的场景设计师。用户是在广州工作的韩国服装公司分公司负责人"朴总"（中文HSK4~5，口语弱），管理广东约37家合作工厂（针织/梭织），也在广州生活。
用户会用一句话（多半是韩语）描述明天真实要打的电话。请把它变成一个电话角色扮演场景，让AI扮演电话那头的人。
要求：
- kind: 工厂/供应商/业务 → "work"；快递、外卖、滴滴、房东、维修、餐厅等生活 → "life"。
- 对方要像真实的中国对手：工作场景会拖延、找理由、反提条件（但讲道理，最后可以商量）；生活场景说话快、口语化。
- 用户给出的数字、款式、数量、日期必须原样用上，不要编造用户没给的关键数字（可以合理补充对方的说法）。
- 判断谁先打电话：一般是朴总打过去，对方接电话先开口（open 就是对方接起电话的第一句，自然、短）。如果描述是对方打来，open 就是对方的来电开场。
只输出 JSON：
{"kind":"work|life","icon":"一个emoji","title":"韩语标题 ≤14字","setting":"韩语 2~3句：状况+我的目标",
"npc":"中文：对方身份（公司/职位/性格）","sex":"m|f","persona":"中文：对方的立场、会用的拖延/理由/反提条件、在什么情况下松口（3~5句）",
"goal":"韩语：目标步骤，用 → 连接（3~4步）",
"open":{"z":"对方第一句中文","p":"拼音带声调","k":"韩语意思"},
"hints":[{"z":"朴总可以说的中文（HSK4~5能说出口的口语，短）","p":"拼音带声调","k":"韩语意思"}]}
hints 3个，按通话顺序（开口说明来意 → 核心要求 → 收尾确认）。`;

export async function rehearseApi(env, path, b, h) {
  if (path !== "/rehearse/plan") throw rerr("없는 경로", 404);
  const text = String(b.text || "").trim().slice(0, 400);
  if (text.length < 4) throw rerr("상황을 한 줄 이상 적어 주세요.");
  const d = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10), k = "rh:" + d + ":" + h;
  const n = +(await env.KV.get(k)) || 0, max = +(env.REHEARSE_DAY_MAX || 20);
  if (n >= max) throw rerr("오늘은 상황 만들기를 " + max + "번 다 썼어요. 내일 다시 해 주세요.", 429);
  const kind = b.kind === "life" || b.kind === "work" ? b.kind : "";
  const j = await qwen(env, SYS, "用户的描述：" + text + (kind ? "\n（用户指定类型：" + kind + "）" : ""));
  await env.KV.put(k, String(n + 1), { expirationTtl: 2 * 86400 });
  const s = (v, m) => String(v || "").trim().slice(0, m);
  const line = (o) => o && o.z ? { z: s(o.z, 120), p: s(o.p, 200), k: s(o.k, 160) } : null;
  const open = line(j.open);
  if (!open) throw rerr("상황을 만들지 못했어요. 조금 더 구체적으로 적어 주세요.", 502);
  return {
    kind: kind || (j.kind === "life" ? "life" : "work"), icon: s(j.icon, 4) || "📞", title: s(j.title, 24) || "내 상황 리허설",
    setting: s(j.setting, 400) || text, npc: s(j.npc, 120), persona: s(j.persona, 600), goal: s(j.goal, 200),
    voice: VOICES[j.sex === "f" ? "f" : "m"], open, hints: (Array.isArray(j.hints) ? j.hints : []).map(line).filter(Boolean).slice(0, 4), src: text,
  };
}
