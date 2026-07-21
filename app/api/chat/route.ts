import { NextResponse } from "next/server";
import { APICallError, ToolLoopAgent, stepCountIs, tool, type ModelMessage } from "ai";
import { z } from "zod";
import {
  getActiveModelConfiguration,
  logAgentRun,
  updateUserProgress,
  type ActiveModelConfiguration,
} from "@/lib/database";
import { configuredProviderOptions, createConfiguredChatModel } from "@/lib/model-runtime";
import { CHANNELS, DEFAULT_CHANNEL, isChannel } from "@/lib/channels";
import type { AgentQuestionForm, Channel, ChatMessage, Intent } from "@/lib/types";

export const runtime = "nodejs";

const CHANNEL_INSTRUCTIONS: Record<Channel, string> = {
  founder: `你是“攒攒合作伙伴”的 AI 创业合作顾问。重点理解：用户是有项目还是找项目、方向与阶段、当前团队、需要的角色、双方能提供的能力、全职或兼职投入、薪资或股权预期、风险边界，以及是否接受先进行两周试合作。成功不是立刻成为合伙人，而是促成一次深聊或真实试合作。`,
  play: `你是“攒攒玩伴”的 AI 组局助手。优先理解这次近期活动：想做什么、什么时候、在哪里、希望几个人、水平或偏好、认真活动还是轻松社交、排除项，以及找不到现成局时是否愿意发起。不要把它聊成长期画像问卷。`,
  love: `你是“攒攒相亲”的 AI 关系匹配顾问。重点理解：关系目标、认识方式、城市与未来居住计划、婚育计划、生活节奏、见面频率、必须条件、排除条件，以及用户能为一段关系提供什么。不要做条件打分，不承诺确定结果。`,
  jobs: `你是“攒攒招聘”的 AI 双向职业顾问。第一步先弄清用户是在招人还是找工作。招聘方重点理解岗位真正解决的问题、必须能力、团队阶段、薪资地点与入职时间；求职者重点理解目标方向、核心能力、公司阶段偏好、薪资地点、风险偏好、入职时间与不能接受的条件。用户侧语言使用岗位、人才候选、双向沟通，不说“加入一个局”。`,
  capital: `你是“攒攒创投”的 AI 投融资对接助手。第一步先弄清用户是项目方、投资方还是生态伙伴。项目方重点理解行业、阶段、产品与数据进展、团队、融资轮次、计划金额、资金用途和时间表；投资方重点理解关注行业、投资阶段、单笔范围、地域、决策流程和明确排除项。你的目标只是促成一次有准备的双向交流，不提供投资建议，不承诺融资成功或投资回报，也不替任何一方完成尽调或做决定。`,
  travel: `你是“攒攒旅友”的 AI 旅行同行顾问。先弄清用户是已有明确计划，还是只确定想出发；重点理解目的地、出发城市、日期和时长、预算、交通住宿、旅行节奏、兴趣偏好、相关经验、安全边界与责任分工。优先促成出发前在公共场所见面并对齐计划。不要代订票或住宿，不要求护照、身份证等敏感信息，不承诺同行者可靠或旅途安全。`,
};

function buildSystemPrompt(channel: Channel) {
  const config = CHANNELS[channel];
  return `你是“攒攒”，一个理解真实意图、帮人攒局的中文 Agent。你的语气像敏锐、尊重边界的熟人：简短、具体、不评判。

当前产品入口是「${config.name}」。${CHANNEL_INSTRUCTIONS[channel]}
只处理当前入口相关的意图，不把其他 Channel 的用户或局混入当前结果；如果用户明显表达其他需求，简短说明更适合的攒攒专业入口。

你的任务是结合全部历史消息，理解五个维度：
1. goal：用户想找到什么人或攒一个什么局；
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
- scene 是内部兼容字段：当前入口固定使用 ${config.scene}；不要让用户选择这个技术标签；
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
    "target": "想找到什么人或攒什么局",
    "context": "当前处境",
    "offer": "用户能提供什么",
    "commitment": "投入方式",
    "constraints": "边界与排除项",
    "validity": "例如 未来三个月"
  }
}`;
}

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

function validIntent(value: unknown, channel: Channel): Intent | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<Intent>;
  if (
    typeof item.title !== "string" ||
    typeof item.summary !== "string" ||
    typeof item.target !== "string" ||
    typeof item.offer !== "string"
  ) {
    return null;
  }
  return {
    title: item.title.slice(0, 80),
    summary: item.summary.slice(0, 500),
    scene: CHANNELS[channel].scene,
    channel,
    target: item.target.slice(0, 220),
    context: item.context?.slice(0, 220) || "还可以继续补充",
    offer: item.offer.slice(0, 220),
    commitment: item.commitment?.slice(0, 220) || "先从一次低压力的交流开始",
    constraints: item.constraints?.slice(0, 220) || "尊重双方节奏和明确边界",
    validity: item.validity?.slice(0, 60) || "未来三个月",
    status: "draft",
  };
}

function createFallbackQuestionForm(channel: Channel, progress: number): AgentQuestionForm {
  if (channel === "capital") {
    return {
      toolCallId: `local-question-${Date.now()}`,
      title: "先确认你站在哪一侧",
      description: "项目方和投资方需要说明的信息不同。",
      progress,
      questions: [
        {
          id: "capital_role",
          label: "你这次主要想做什么？",
          type: "single_choice",
          required: true,
          options: [
            { value: "为项目找资金", label: "为项目找资金" },
            { value: "寻找投资项目", label: "寻找投资项目" },
            { value: "提供创投服务", label: "提供创投服务" },
          ],
        },
        {
          id: "capital_stage",
          label: "目前更接近哪个阶段？",
          type: "single_choice",
          required: true,
          allowOther: true,
          options: [
            { value: "想法或产品验证", label: "想法或产品验证" },
            { value: "已有早期用户", label: "已有早期用户" },
            { value: "已有收入，准备增长", label: "已有收入，准备增长" },
            { value: "成熟项目或后续轮次", label: "成熟项目或后续轮次" },
          ],
        },
      ],
      submitLabel: "继续",
      status: "pending",
    };
  }

  if (channel === "travel") {
    return {
      toolCallId: `local-question-${Date.now()}`,
      title: "先把这趟旅行说具体一点",
      description: "选最接近的就好，路线和日期之后还可以调整。",
      progress,
      questions: [
        {
          id: "travel_plan",
          label: "目的地确定了吗？",
          type: "single_choice",
          required: true,
          allowOther: true,
          options: [
            { value: "已经确定目的地", label: "已经确定" },
            { value: "有几个备选目的地", label: "有几个备选" },
            { value: "只确定想出发", label: "还没决定" },
          ],
        },
        {
          id: "travel_length",
          label: "大概想走多久？",
          type: "single_choice",
          required: true,
          allowOther: true,
          options: [
            { value: "周末短途", label: "周末短途" },
            { value: "三到五天", label: "3–5 天" },
            { value: "一周左右", label: "一周左右" },
            { value: "十天以上长线", label: "长线旅行" },
          ],
        },
      ],
      submitLabel: "告诉攒攒",
      status: "pending",
    };
  }

  if (channel === "play") {
    return {
      toolCallId: `local-question-${Date.now()}`,
      title: "先把这次活动说具体一点",
      description: "选最接近的就好，时间和地点之后还可以调整。",
      progress,
      questions: [
        {
          id: "activity_type",
          label: "你这次更想做什么？",
          type: "single_choice",
          required: true,
          allowOther: true,
          options: [
            { value: "运动", label: "运动" },
            { value: "看展或散步", label: "看展或散步" },
            { value: "吃饭或咖啡", label: "吃饭或咖啡" },
            { value: "桌游或公开活动", label: "桌游或公开活动" },
          ],
        },
        {
          id: "activity_timing",
          label: "大概什么时候？",
          type: "single_choice",
          required: true,
          allowOther: true,
          options: [
            { value: "今天或明天", label: "今天或明天" },
            { value: "本周工作日", label: "本周工作日" },
            { value: "本周末", label: "本周末" },
            { value: "未来两周", label: "未来两周" },
          ],
        },
      ],
      submitLabel: "告诉攒攒",
      status: "pending",
    };
  }

  if (channel === "jobs") {
    return {
      toolCallId: `local-question-${Date.now()}`,
      title: "先确认你站在哪一边",
      description: "我会用不同的问题理解招聘方和求职者。",
      progress,
      questions: [
        {
          id: "job_role",
          label: "你现在的主要需求是？",
          type: "single_choice",
          required: true,
          options: [
            { value: "我在招人", label: "我在招人" },
            { value: "我在找工作", label: "我在找工作" },
            { value: "先了解方向", label: "先了解方向" },
          ],
        },
        {
          id: "job_priority",
          label: "这次最不能模糊的是什么？",
          type: "single_choice",
          required: true,
          allowOther: true,
          options: [
            { value: "工作内容与目标", label: "工作内容与目标" },
            { value: "能力与经验", label: "能力与经验" },
            { value: "薪资与回报", label: "薪资与回报" },
            { value: "地点与入职时间", label: "地点与入职时间" },
          ],
        },
      ],
      submitLabel: "继续",
      status: "pending",
    };
  }

  if (channel === "love") {
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

function localFallback(messages: ChatMessage[], channel: Channel) {
  const userMessages = messages.filter((message) => message.role === "user");
  const text = userMessages.map((message) => message.content).join("\n");
  const scene = CHANNELS[channel].scene;
  const hasGoal = text.trim().length >= 10;
  const hasContext = /北京|上海|广州|深圳|杭州|成都|城市|目前|现在|阶段|已经|正在|团队|工作|目的地|出发地|日期|行程|预算/.test(text);
  const hasOffer = /我能|可以提供|擅长|经验|资源|能力|负责|做过|我是/.test(text);
  const hasCommitment = /全职|兼职|周末|远程|线下|投入|每周|时间|先聊|见面|试合作|出发|旅行|一起订|共同准备/.test(text);
  const hasConstraints = /不考虑|不接受|必须|希望|边界|最好|不要|不能|只想|认真|长期/.test(text);
  const progress = [hasGoal, hasContext, hasOffer, hasCommitment, hasConstraints].filter(Boolean).length;
  const shouldDraft = progress >= 4 || (progress >= 3 && userMessages.length >= 2) || text.length >= 150;
  const lastUserText = userMessages.at(-1)?.content || "";
  const shouldOfferForm = progress <= 2 && lastUserText.length < 100 && !lastUserText.includes("通过快速表单补充");

  if (shouldDraft) {
    const target = channel === "love"
      ? "认识一位愿意认真了解彼此、关系目标相近的人"
      : channel === "play"
        ? "找到时间、地点和活动氛围相容的人一起去玩"
        : channel === "jobs"
          ? "促成一次岗位与人才双方都真实想要的双向选择"
          : channel === "capital"
            ? "找到方向、阶段和计划相互匹配的项目方或投资方"
            : channel === "travel"
              ? "找到目的地、日期、预算和旅行节奏相容的同行者"
          : "找到一位目标互补、愿意先通过实际协作验证配合的人";
    const offer = hasOffer ? "把已有经验、能力和真实投入带进关系里" : "愿意坦诚沟通，并在相处或协作中持续补充自己的价值";
    const intent: Intent = {
      title: channel === "love" ? "认真认识一个节奏相近的人" : channel === "play" ? "攒一个近期真正想参加的小局" : channel === "jobs" ? "攒一个双向成立的职业局" : channel === "capital" ? "攒一个值得继续交流的创投局" : channel === "travel" ? "寻找能把这趟旅程走舒服的旅友" : "寻找能先做事再决定长期关系的伙伴",
      summary:
        channel === "love"
          ? "希望从低压力、真实的交流开始，认识关系目标和生活节奏相近的人；不急于制造结果，但愿意为互相了解投入时间。"
          : channel === "play"
            ? "希望围绕近期真实想做的一件事，找到时间、地点和相处氛围合适的人，组成一个人数不多、边界清楚的小局。"
            : channel === "jobs"
              ? "希望先把岗位目标或职业方向说清楚，再与条件、阶段和期待都相容的一方进行一次有准备的双向沟通。"
              : channel === "capital"
                ? "希望先把项目进展、融资计划或投资方向说清楚，再与阶段和预期相互匹配的一方进行一次有准备的交流。"
                : channel === "travel"
                  ? "希望先把目的地、日期、预算和旅行节奏说清楚，再认识愿意共同准备、尊重彼此边界的同行者。"
              : "希望认识目标互补的合作伙伴，先围绕一个清楚的小目标验证彼此的做事方式，再决定是否进入更长期的合作。",
      scene,
      channel,
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
      questionForm: createFallbackQuestionForm(channel, progress),
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

async function requestIntentAgent(configuration: ActiveModelConfiguration, messages: ChatMessage[], abortSignal: AbortSignal, channel: Channel) {
  const formJustSubmitted = messages.at(-1)?.role === "user"
    && messages.at(-1)?.content.startsWith("我通过快速表单补充了：");
  const agentSettings = {
    id: "cuancuan-intent-agent",
    model: createConfiguredChatModel(configuration),
    instructions: buildSystemPrompt(channel),
    temperature: 0.25,
    maxRetries: 0,
    stopWhen: stepCountIs(2),
    providerOptions: configuredProviderOptions(configuration),
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
          model: configuration.model,
        };
      }

      if (!result.text.trim()) throw new Error("Agent 未返回文字或工具调用");
      const parsed = extractJson(result.text);
      return {
        reply: typeof parsed.reply === "string" ? parsed.reply.slice(0, 1200) : "我已经理解了一部分，我们继续。",
        progress: Math.max(0, Math.min(5, Number(parsed.progress) || 0)),
        intentDraft: validIntent(parsed.intentDraft, channel),
        questionForm: null,
        model: configuration.model,
      };
    } catch (error) {
      lastError = error;
      if (abortSignal.aborted) break;
      const retryable = APICallError.isInstance(error) ? error.isRetryable : true;
      if (!retryable || attempt === 1) break;
      await new Promise((resolve) => setTimeout(resolve, 420));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Model request failed");
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const body = await request.json().catch(() => ({}));
  const requestBody = body as { messages?: unknown; userEmail?: unknown; channel?: unknown };
  const messages = cleanMessages(requestBody.messages);
  const channel = typeof requestBody.channel === "string" && isChannel(requestBody.channel) ? requestBody.channel : DEFAULT_CHANNEL;
  const userEmail = typeof requestBody.userEmail === "string" ? requestBody.userEmail.slice(0, 180) : "";
  if (!messages.some((message) => message.role === "user")) {
    return NextResponse.json({ error: "请先说说你现在想认识什么人。" }, { status: 400 });
  }

  const configuration = getActiveModelConfiguration();
  if (!configuration) {
    const fallback = localFallback(messages, channel);
    if (userEmail) updateUserProgress(userEmail, fallback.progress);
    logAgentRun({
      requestType: "chat",
      providerName: "本地规则",
      model: "local-fallback",
      status: "degraded",
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ ...fallback, degraded: true });
  }

  try {
    const agentResult = await requestIntentAgent(configuration, messages, request.signal, channel);
    if (userEmail) updateUserProgress(userEmail, agentResult.progress);
    logAgentRun({
      requestType: "chat",
      providerId: configuration.id,
      providerName: configuration.name,
      model: configuration.model,
      status: "success",
      durationMs: Date.now() - startedAt,
      metadata: { source: configuration.source },
    });
    const result = {
      ...agentResult,
      provider: "agent" as const,
      providerName: configuration.name,
    };
    return NextResponse.json(result);
  } catch (error) {
    const fallback = localFallback(messages, channel);
    if (userEmail) updateUserProgress(userEmail, fallback.progress);
    logAgentRun({
      requestType: "chat",
      providerId: configuration.id,
      providerName: configuration.name,
      model: configuration.model,
      status: "degraded",
      durationMs: Date.now() - startedAt,
      errorMessage: error instanceof Error ? error.message : "unknown error",
    });
    return NextResponse.json({
      ...fallback,
      degraded: true,
    });
  }
}
