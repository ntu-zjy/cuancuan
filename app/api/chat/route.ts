import { NextResponse } from "next/server";
import { APICallError, ToolLoopAgent, stepCountIs, tool, type ModelMessage } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";
import type { AgentQuestionForm, ChatMessage, Intent, Scene } from "@/lib/types";

export const runtime = "nodejs";

const SYSTEM_PROMPT = `你是“攒攒”，一个理解关系意图、连接人与机会的中文 Agent。你的语气像敏锐、尊重边界的熟人：简短、具体、不评判。

你的任务是结合全部历史消息，理解五个维度：
1. goal：用户想找到什么人或机会；
2. context：城市、阶段、生活或项目处境；
3. offer：用户可以提供什么；
4. commitment：愿意怎样投入或开始；
5. constraints：边界、必须项和排除项。

规则：
- 不让用户选择技术标签，不做固定问卷；
- 信息不足时，每次只追问一个最关键的缺口，不重复已经理解的内容；
- 至少四个维度清楚时直接整理 intentDraft；对话超过两轮且至少三个维度清楚时也可先生成可修订草稿；
- 不替用户确认意图，不替用户加入任何局；
- 不输出匹配百分比，不夸大确定性；
- startup 包括合作、合伙、招聘、加入团队、项目、客户等；love 包括恋爱、长期关系、交友、兴趣活动等；
- 对外摘要不包含邮箱、电话、微信等敏感联系方式。

你可以使用 ask_user_question 工具发送一张轻量表单，降低用户组织长回答的压力。使用边界：
- 只在用户表达很短、方向模糊，且 1–3 个具体选择能明显降低回答压力时使用；
- 优先用于关系目标、开始方式、投入方式、城市范围或关键边界等容易通过选项回答的问题；
- 每轮最多调用一次，最多 3 个问题；选项保持中性，通常提供“还不确定/都可以”，不要暗示标准答案；
- 敏感、复杂或需要用户自己定义的问题使用 short_text，并允许一句话作答；
- 已经达到生成 Intent 的条件时不要再发表单；用户刚提交过表单后，优先吸收答案并生成草稿或只追问一个剩余缺口；
- 不得用表单重新包装固定五题问卷，也不得要求用户选择 startup/love 等内部标签；
- 调用工具时不再输出下面的 JSON，工具调用本身就是本轮结果；可附一句不超过 30 字的自然引导。

未调用工具时，
只返回合法 JSON，不使用 Markdown 代码块，结构必须是：
{
  "reply": "给用户的自然回复；如果生成草稿，简短说明已经整理好",
  "progress": 0到5的整数,
  "intentDraft": null 或 {
    "title": "一句话标题",
    "summary": "完整但克制的意图摘要",
    "scene": "startup 或 love",
    "target": "想找到什么人或机会",
    "context": "当前处境",
    "offer": "用户能提供什么",
    "commitment": "投入方式",
    "constraints": "边界与排除项",
    "validity": "例如 未来三个月"
  }
}`;

const questionOptionSchema = z.object({
  value: z.string().min(1).max(60),
  label: z.string().min(1).max(60),
  description: z.string().max(100).optional(),
});

const choiceQuestionBase = {
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(100),
  options: z.array(questionOptionSchema).min(2).max(5),
  required: z.boolean().optional(),
  allowOther: z.boolean().optional(),
};

const askUserQuestionInputSchema = z.object({
  title: z.string().min(1).max(80),
  description: z.string().max(180).optional(),
  progress: z.number().int().min(0).max(5),
  questions: z.array(z.discriminatedUnion("type", [
    z.object({ ...choiceQuestionBase, type: z.literal("single_choice") }),
    z.object({ ...choiceQuestionBase, type: z.literal("multi_choice") }),
    z.object({
      id: z.string().min(1).max(40),
      label: z.string().min(1).max(100),
      type: z.literal("short_text"),
      placeholder: z.string().max(100).optional(),
      required: z.boolean().optional(),
      allowOther: z.boolean().optional(),
    }),
  ])).min(1).max(3),
  submitLabel: z.string().max(20).optional(),
});

const intentAgentTools = {
  ask_user_question: tool({
    description: "向用户展示 1–3 个容易回答的小问题表单。仅在表单比开放式追问明显更省力时使用；信息足够时不要调用。",
    inputSchema: askUserQuestionInputSchema,
  }),
};

function cleanMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is ChatMessage => {
      if (!item || typeof item !== "object") return false;
      const candidate = item as Partial<ChatMessage>;
      return (candidate.role === "user" || candidate.role === "assistant") && typeof candidate.content === "string";
    })
    .map((item) => ({ ...item, content: item.content.slice(0, 4000) }))
    .slice(-24);
}

function extractJson(raw: string) {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = fenced ?? raw;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("模型未返回 JSON");
  return JSON.parse(source.slice(start, end + 1));
}

function validIntent(value: unknown): Intent | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<Intent>;
  if (
    typeof item.title !== "string" ||
    typeof item.summary !== "string" ||
    (item.scene !== "startup" && item.scene !== "love") ||
    typeof item.target !== "string" ||
    typeof item.offer !== "string"
  ) {
    return null;
  }
  return {
    title: item.title.slice(0, 80),
    summary: item.summary.slice(0, 500),
    scene: item.scene,
    target: item.target.slice(0, 220),
    context: item.context?.slice(0, 220) || "还可以继续补充",
    offer: item.offer.slice(0, 220),
    commitment: item.commitment?.slice(0, 220) || "先从一次低压力的交流开始",
    constraints: item.constraints?.slice(0, 220) || "尊重双方节奏和明确边界",
    validity: item.validity?.slice(0, 60) || "未来三个月",
    status: "draft",
  };
}

function createFallbackQuestionForm(scene: Scene, progress: number): AgentQuestionForm {
  if (scene === "love") {
    return {
      toolCallId: `local-question-${Date.now()}`,
      title: "不用一次想完整，先选最接近的",
      description: "这两个答案能帮我理解你更想进入怎样的关系，以及怎样开始会更自然。",
      progress,
      questions: [
        {
          id: "relationship_goal",
          label: "你现在更接近哪种期待？",
          type: "single_choice",
          required: true,
          allowOther: true,
          options: [
            { value: "认真恋爱", label: "认真恋爱", description: "希望关系有长期发展的可能" },
            { value: "先自然认识", label: "先自然认识", description: "先相处，再看关系会走到哪里" },
            { value: "扩大真实社交", label: "扩大真实社交", description: "先认识一些聊得来的人" },
            { value: "还不确定", label: "还不确定", description: "可以边认识边想清楚" },
          ],
        },
        {
          id: "meeting_style",
          label: "怎样开始认识会让你更放松？",
          type: "multi_choice",
          required: true,
          allowOther: true,
          options: [
            { value: "吃饭或散步", label: "吃饭或散步" },
            { value: "一起参加兴趣活动", label: "一起参加兴趣活动" },
            { value: "先线上聊一聊", label: "先线上聊一聊" },
            { value: "从轻松多人局开始", label: "从轻松多人局开始" },
          ],
        },
      ],
      submitLabel: "告诉攒攒",
      status: "pending",
    };
  }

  return {
    toolCallId: `local-question-${Date.now()}`,
    title: "先用两个选择把合作方向说清楚",
    description: "选最接近的即可，之后还可以继续修改。",
    progress,
    questions: [
      {
        id: "collaboration_goal",
        label: "你目前最想先解决什么？",
        type: "single_choice",
        required: true,
        allowOther: true,
        options: [
          { value: "找长期合伙人", label: "找长期合伙人" },
          { value: "招聘关键成员", label: "招聘关键成员" },
          { value: "找短期试合作", label: "找短期试合作" },
          { value: "寻找值得加入的团队", label: "寻找值得加入的团队" },
        ],
      },
      {
        id: "commitment_style",
        label: "你更愿意怎样开始？",
        type: "single_choice",
        required: true,
        allowOther: true,
        options: [
          { value: "先聊一次", label: "先聊一次" },
          { value: "做一个短期小项目", label: "做一个短期小项目" },
          { value: "兼职或周末投入", label: "兼职或周末投入" },
          { value: "可以直接讨论全职", label: "可以直接讨论全职" },
        ],
      },
    ],
    submitLabel: "补充好了",
    status: "pending",
  };
}

function localFallback(messages: ChatMessage[]) {
  const userMessages = messages.filter((message) => message.role === "user");
  const text = userMessages.map((message) => message.content).join("\n");
  const scene: Scene = /恋爱|伴侣|长期关系|结婚|约会|交友|认识新朋友|兴趣活动|女生|男生|甜妹|对象|喜欢的人/.test(text) ? "love" : "startup";
  const hasGoal = text.trim().length >= 10;
  const hasContext = /北京|上海|广州|深圳|杭州|成都|城市|目前|现在|阶段|已经|正在|团队|工作/.test(text);
  const hasOffer = /我能|可以提供|擅长|经验|资源|能力|负责|做过|我是/.test(text);
  const hasCommitment = /全职|兼职|周末|远程|线下|投入|每周|时间|先聊|见面|试合作/.test(text);
  const hasConstraints = /不考虑|不接受|必须|希望|边界|最好|不要|不能|只想|认真|长期/.test(text);
  const progress = [hasGoal, hasContext, hasOffer, hasCommitment, hasConstraints].filter(Boolean).length;
  const shouldDraft = progress >= 4 || (progress >= 3 && userMessages.length >= 2) || text.length >= 150;
  const lastUserText = userMessages.at(-1)?.content || "";
  const shouldOfferForm = progress <= 2 && lastUserText.length < 100 && !lastUserText.includes("通过快速表单补充");

  if (shouldDraft) {
    const target = scene === "love" ? "认识一位愿意认真了解彼此、关系目标相近的人" : "找到一位目标互补、愿意先通过实际协作验证配合的人";
    const offer = hasOffer ? "把已有经验、能力和真实投入带进关系里" : "愿意坦诚沟通，并在相处或协作中持续补充自己的价值";
    const intent: Intent = {
      title: scene === "love" ? "认真认识一个节奏相近的人" : "寻找能先做事再决定长期关系的伙伴",
      summary:
        scene === "love"
          ? "希望从低压力、真实的交流开始，认识关系目标和生活节奏相近的人；不急于制造结果，但愿意为互相了解投入时间。"
          : "希望认识目标互补的合作伙伴，先围绕一个清楚的小目标验证彼此的做事方式，再决定是否进入更长期的合作。",
      scene,
      target,
      context: hasContext ? "已经说明了当前所在城市或所处阶段" : "当前处境还可以继续补充",
      offer,
      commitment: hasCommitment ? "按已经表达的时间与方式投入" : "先从一次交流或小范围尝试开始",
      constraints: hasConstraints ? "以用户刚刚表达的边界为准，不为匹配放松关键条件" : "尊重双方节奏，不在信息不足时做长期承诺",
      validity: "未来三个月",
      status: "draft",
    };
    return {
      reply: "我先把目前听到的整理成一版。你可以直接改，也可以继续告诉我哪里还不准确。",
      progress: Math.max(progress, 4),
      intentDraft: intent,
      provider: "local" as const,
    };
  }

  if (shouldOfferForm) {
    return {
      reply: "不用组织一大段话，先选几个最接近的答案就好。",
      progress,
      intentDraft: null,
      questionForm: createFallbackQuestionForm(scene, progress),
      provider: "local" as const,
    };
  }

  let question = "你现在最想认识的是怎样的人，或者解决一个怎样的问题？";
  if (hasGoal && !hasContext) question = "这件事发生在怎样的城市或阶段里？这会影响什么样的连接才现实。";
  else if (hasGoal && hasContext && !hasOffer) question = "如果遇到合适的人，你最愿意为这段关系或合作带来什么？";
  else if (hasGoal && hasContext && hasOffer && !hasCommitment) question = "你希望先怎么开始——聊一次、线下见面，还是做一个短期尝试？";
  else if (!hasConstraints && progress >= 3) question = "有什么条件是你不愿意为了匹配而放松的？";

  return {
    reply: `我听到了一部分方向。${question}`,
    progress,
    intentDraft: null,
    provider: "local" as const,
  };
}

async function requestIntentAgent(apiKey: string, messages: ChatMessage[], abortSignal: AbortSignal) {
  const baseUrl = (process.env.STEP_API_BASE_URL || "https://api.stepfun.com/v1").replace(/\/$/, "");
  const modelName = process.env.STEP_MODEL || "step-3.5-flash";
  const formJustSubmitted = messages.at(-1)?.role === "user"
    && messages.at(-1)?.content.startsWith("我通过快速表单补充了：");
  const stepfun = createOpenAICompatible({
    name: "stepfun",
    apiKey,
    baseURL: baseUrl,
  });
  const agentSettings = {
    id: "cuancuan-intent-agent",
    model: stepfun.chatModel(modelName),
    instructions: SYSTEM_PROMPT,
    temperature: 0.25,
    maxOutputTokens: 1400,
    maxRetries: 0,
    stopWhen: stepCountIs(2),
  };
  const agent = formJustSubmitted
    ? new ToolLoopAgent(agentSettings)
    : new ToolLoopAgent({ ...agentSettings, tools: intentAgentTools });
  const modelMessages: ModelMessage[] = messages.map(({ role, content }) => ({ role, content }));

  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await agent.generate({
        messages: modelMessages,
        abortSignal,
        timeout: 15_000,
      });

      const questionCall = result.staticToolCalls.find(
        (toolCall) => toolCall.toolName === "ask_user_question",
      );
      if (questionCall?.toolName === "ask_user_question") {
        const questionForm: AgentQuestionForm = {
          ...questionCall.input,
          toolCallId: questionCall.toolCallId,
          status: "pending",
        };
        return {
          reply: result.text.trim() || "不用一次想完整，选几个最接近的答案就好。",
          progress: questionForm.progress,
          intentDraft: null,
          questionForm,
          model: modelName,
        };
      }

      if (!result.text.trim()) throw new Error("Agent 未返回文字或工具调用");
      const parsed = extractJson(result.text);
      return {
        reply: typeof parsed.reply === "string" ? parsed.reply.slice(0, 1200) : "我已经理解了一部分，我们继续。",
        progress: Math.max(0, Math.min(5, Number(parsed.progress) || 0)),
        intentDraft: validIntent(parsed.intentDraft),
        questionForm: null,
        model: modelName,
      };
    } catch (error) {
      lastError = error;
      if (abortSignal.aborted) break;
      const retryable = APICallError.isInstance(error) ? error.isRetryable : true;
      if (!retryable || attempt === 1) break;
      await new Promise((resolve) => setTimeout(resolve, 420));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("StepFun request failed");
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const messages = cleanMessages((body as { messages?: unknown }).messages);
  if (!messages.some((message) => message.role === "user")) {
    return NextResponse.json({ error: "请先说说你现在想认识什么人。" }, { status: 400 });
  }

  const apiKey = process.env.STEP_API_KEY;
  if (!apiKey) return NextResponse.json({ ...localFallback(messages), degraded: true });

  try {
    const agentResult = await requestIntentAgent(apiKey, messages, request.signal);
    const result = {
      ...agentResult,
      provider: "stepfun" as const,
    };
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({
      ...localFallback(messages),
      degraded: true,
    });
  }
}
