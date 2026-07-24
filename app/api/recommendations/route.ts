import { NextResponse } from "next/server";
import { ToolLoopAgent, stepCountIs, tool, type ModelMessage } from "ai";
import { z } from "zod";
import {
  createAgentRoomForIntent,
  deleteAgentMatchIntent,
  getActiveModelConfiguration,
  getUserProfileForSpace,
  listAgentIntentCandidates,
  listEventsForUser,
  logAgentRun,
  saveAgentMatchIntent,
} from "@/lib/database";
import { CHANNELS, isChannel, resolveOpportunityChannel } from "@/lib/channels";
import { isSameOriginRequest } from "@/lib/http-security";
import { configuredProviderOptions, createConfiguredChatModel } from "@/lib/model-runtime";
import { assertParticipationAllowed, requireUserSession } from "@/lib/user-auth";
import type {
  AgentRecruitingRoomDraft,
  Channel,
  Intent,
  Opportunity,
  OpportunityWithRegistration,
} from "@/lib/types";

export const runtime = "nodejs";

const requestSchema = z.object({
  channel: z.string().refine(isChannel),
  intent: z.object({
    title: z.string().trim().min(2).max(100),
    summary: z.string().trim().min(5).max(700),
    target: z.string().trim().min(2).max(300),
    context: z.string().trim().max(300).optional(),
    offer: z.string().trim().min(2).max(300),
    commitment: z.string().trim().max(300).optional(),
    constraints: z.string().trim().max(300).optional(),
    validity: z.string().trim().min(1).max(100),
  }),
});

const recommendationSchema = z.object({
  eventId: z.string(),
  score: z.number().int().min(0).max(100),
  verdict: z.enum(["strong", "possible", "explore"]),
  headline: z.string().max(80),
  reasons: z.array(z.string().max(140)).min(1).max(3),
  complements: z.array(z.string().max(120)).max(3),
  constraints: z.array(z.string().max(140)).max(3),
  nextStep: z.string().max(160),
});

const outputSchema = z.object({
  action: z.enum(["recommended_existing", "created_new", "waiting"]),
  recommendations: z.array(recommendationSchema).max(4),
  message: z.string().max(240),
});

const roomDraftSchema = z.object({
  type: z.string().trim().min(1).max(80),
  title: z.string().trim().min(2).max(120),
  summary: z.string().trim().min(5).max(500),
  description: z.string().trim().min(5).max(1800),
  tags: z.array(z.string().trim().min(1).max(40)).max(10),
  minMembers: z.number().int().min(2).max(100),
  maxMembers: z.number().int().min(2).max(100),
  startsAt: z.string(),
  endsAt: z.string(),
  registrationDeadline: z.string(),
  cancellationDeadline: z.string(),
  city: z.string().trim().min(1).max(80),
  venue: z.string().trim().min(1).max(160),
  address: z.string().trim().max(300),
  price: z.object({
    type: z.enum(["free", "aa", "fixed"]),
    amount: z.number().nonnegative().optional(),
    note: z.string().trim().max(120).optional(),
  }),
  registrationMode: z.enum(["instant", "approval"]),
  agenda: z.array(z.string().trim().min(1).max(240)).max(12),
  notices: z.array(z.string().trim().min(1).max(240)).max(12),
  reason: z.string().trim().max(800),
  observation: z.string().trim().max(800),
  trialPlan: z.object({
    objective: z.string().trim().min(1).max(500),
    roles: z.array(z.string().trim().min(1).max(120)).max(12),
    deadline: z.string(),
    completionCriteria: z.string().trim().min(1).max(500),
    continuationDecision: z.string().trim().max(500).optional(),
  }).optional(),
});

function extractJson(raw: string) {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = fenced || raw;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Agent 未返回合法 JSON");
  return JSON.parse(source.slice(start, end + 1));
}

function safeModelText(value: string) {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[联系方式已隐藏]")
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, "[联系方式已隐藏]")
    .replace(/(?:微信|wechat|weixin|vx|v信)\s*(?:号|id)?\s*[:：]?\s*[a-zA-Z][-_a-zA-Z0-9]{5,19}/gi, "[联系方式已隐藏]");
}

function safeModelList(values: string[]) {
  return values.map(safeModelText);
}

function briefRoom(room: Opportunity) {
  return {
    id: room.id,
    title: safeModelText(room.title),
    summary: safeModelText(room.summary),
    tags: safeModelList(room.tags),
    city: safeModelText(room.city),
    venue: safeModelText(room.venue),
    startsAt: room.startsAt,
    endsAt: room.endsAt,
    registrationMode: room.registrationMode,
    lifecycleStatus: room.lifecycleStatus,
    members: room.members,
    minMembers: room.minMembers,
    maxMembers: room.maxMembers,
  };
}

function inspectableRoom(room: Opportunity) {
  return {
    ...briefRoom(room),
    description: safeModelText(room.description),
    price: { ...room.price, note: room.price.note ? safeModelText(room.price.note) : undefined },
    organizer: { role: safeModelText(room.organizer.role), verified: room.organizer.verified },
    agenda: safeModelList(room.agenda),
    notices: safeModelList(room.notices),
    reason: safeModelText(room.reason),
    observation: safeModelText(room.observation),
    trialPlan: room.trialPlan ? {
      ...room.trialPlan,
      objective: safeModelText(room.trialPlan.objective),
      roles: safeModelList(room.trialPlan.roles),
      completionCriteria: safeModelText(room.trialPlan.completionCriteria),
      continuationDecision: room.trialPlan.continuationDecision
        ? safeModelText(room.trialPlan.continuationDecision)
        : undefined,
    } : undefined,
    memberNeedsAndOffers: room.people.map((person) => ({
      summary: safeModelText(person.summary),
      offer: safeModelText(person.offer),
      need: person.need ? safeModelText(person.need) : undefined,
      role: person.role ? safeModelText(person.role) : undefined,
    })),
  };
}

function withoutRegistration(item: OpportunityWithRegistration) {
  const room = { ...item };
  delete room.registration;
  delete room.isHost;
  return room as Opportunity;
}

function modelSafeProfile(profile: NonNullable<ReturnType<typeof getUserProfileForSpace>>) {
  return {
    city: safeModelText(profile.city),
    identity: safeModelText(profile.identity),
    skills: safeModelText(profile.skills),
    offer: safeModelText(profile.offer),
    bio: safeModelText(profile.bio),
  };
}

function modelSafeIntent(intent: Intent): Intent {
  return {
    ...intent,
    title: safeModelText(intent.title),
    summary: safeModelText(intent.summary),
    target: safeModelText(intent.target),
    context: intent.context ? safeModelText(intent.context) : undefined,
    offer: safeModelText(intent.offer),
    commitment: intent.commitment ? safeModelText(intent.commitment) : undefined,
    constraints: intent.constraints ? safeModelText(intent.constraints) : undefined,
    validity: safeModelText(intent.validity),
  };
}

type AgentDecision = {
  action: "recommended_existing" | "created_new" | "waiting";
  recommendations: Opportunity[];
  createdRoom: Opportunity | null;
  message: string;
};

async function runMatchingAgent(input: {
  configuration: NonNullable<ReturnType<typeof getActiveModelConfiguration>>;
  userId: string;
  channel: Channel;
  intent: Intent;
  profile: NonNullable<ReturnType<typeof getUserProfileForSpace>>;
  rooms: Opportunity[];
  signal: AbortSignal;
}): Promise<AgentDecision> {
  const roomMap = new Map(input.rooms.map((room) => [room.id, room]));
  const searchedRoomIds = new Set<string>();
  let roomsSearched = false;
  let peopleSearched = false;
  let createdRoom: Opportunity | null = null;

  const anonymousCandidates = listAgentIntentCandidates({
    userId: input.userId,
    channel: input.channel,
    limit: 100,
  });
  const anonymousCandidatePool = anonymousCandidates.map((candidate, index) => ({
    candidateId: `candidate-${index + 1}`,
    channel: candidate.channel,
    profile: candidate.profile,
    intent: candidate.intent,
    expiresAt: candidate.expiresAt,
    updatedAt: candidate.updatedAt,
  }));

  const tools = {
    search_rooms: tool({
      description: "搜索当前关系空间内已经存在且可发现的真实局。返回资料供 Agent 自主判断，不做固定匹配评分。",
      inputSchema: z.object({
        searchIntent: z.string().trim().min(1).max(300),
        city: z.string().trim().max(80).optional(),
        openOnly: z.boolean().optional(),
        offset: z.number().int().min(0).max(1000).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      execute: async ({ searchIntent, city, openOnly, offset, limit }) => {
        roomsSearched = true;
        const eligibleRooms = input.rooms
          .filter((room) => !city || room.city.includes(city) || city.includes(room.city))
          .filter((room) => openOnly === false || room.members < room.maxMembers);
        const start = offset || 0;
        const matchingRooms = eligibleRooms.slice(start, start + (limit || 100));
        matchingRooms.forEach((room) => searchedRoomIds.add(room.id));
        return {
          searchIntent,
          total: eligibleRooms.length,
          offset: start,
          count: matchingRooms.length,
          rooms: matchingRooms.map(briefRoom),
        };
      },
    }),
    search_people: tool({
      description: "搜索当前关系空间内明确授权、仍在有效期内的匿名用户意图。只用于判断新局能否招募到互补成员；不能自动拉人入局。",
      inputSchema: z.object({
        searchIntent: z.string().trim().min(1).max(300),
        offset: z.number().int().min(0).max(100).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      execute: async ({ searchIntent, offset, limit }) => {
        peopleSearched = true;
        const start = offset || 0;
        const candidates = anonymousCandidatePool.slice(start, start + (limit || 100));
        return {
          searchIntent,
          total: anonymousCandidatePool.length,
          offset: start,
          count: candidates.length,
          candidates,
          privacyNote: "候选人保持匿名；不得在最终响应中输出 candidateId 或个人资料。",
        };
      },
    }),
    inspect_room: tool({
      description: "深入查看 search_rooms 本轮已经返回的候选局。不能越权读取未搜索到的局。",
      inputSchema: z.object({ eventId: z.string() }),
      execute: async ({ eventId }) => {
        if (!searchedRoomIds.has(eventId)) return { status: "not_searched", error: "请先通过 search_rooms 获取该局。" };
        const room = roomMap.get(eventId);
        return room
          ? { status: "found", room: inspectableRoom(room) }
          : { status: "not_found", error: "这个局已经不存在。" };
      },
    }),
    create_room: tool({
      description: "当 Agent 搜索并判断现有局均不合适时，为当前用户的已确认意图发起一个公开招募局。模型不能指定用户、频道或幂等键。",
      inputSchema: roomDraftSchema,
      execute: async (proposal) => {
        if (!roomsSearched || !peopleSearched) {
          return {
            status: "search_required",
            error: "建局前必须先调用 search_rooms 和 search_people。",
          };
        }
        try {
          const result = createAgentRoomForIntent({
            userId: input.userId,
            channel: input.channel,
            intent: input.intent,
            proposal: proposal as AgentRecruitingRoomDraft,
          });
          createdRoom = result.event;
          return {
            status: result.created ? "created" : "already_created",
            room: briefRoom(result.event),
          };
        } catch (error) {
          return {
            status: "rejected",
            error: error instanceof Error ? error.message : "建局方案未通过服务端校验。",
          };
        }
      },
    }),
  };

  const agent = new ToolLoopAgent({
    id: "cuancuan-global-matching-agent",
    model: createConfiguredChatModel(input.configuration),
    tools,
    stopWhen: stepCountIs(8),
    maxRetries: 0,
    temperature: 0.15,
    providerOptions: configuredProviderOptions(input.configuration),
    instructions: `你是攒攒的全局匹配与组局 Agent。当前关系空间固定为 ${input.channel}，不得跨空间搜索或使用其他空间资料。

你的工作不是套用程序预设的匹配规则，而是使用工具读取当前环境后自主判断：
1. 必须先调用 search_rooms，搜索已经存在的局。
2. 必须调用 search_people，了解当前空间内已授权的匿名意图供给；候选只用于判断招募可能，不得自动加入、点名或泄露。
3. 对值得进一步判断的现有局调用 inspect_room，结合用户目标、供给、现实边界和局内缺口做整体判断。
4. 如果有真正适合当前确认意图的现有局，推荐它们，不要创建重复的新局。
5. 如果搜索后没有合适的现有局，并且当前信息足以形成一个可执行方案，必须调用 create_room 发起公开招募局。标题、时间、人数、费用、日程和边界都应来自当前意图与资料；所有时间使用 ISO 8601，且必须在当前时间之后。
6. 如果当前信息不足以负责任地推荐或建局，选择 waiting，并说明最关键的缺口。

不要使用固定阈值决定推荐或建局，不输出“匹配概率”，不索取或输出联系方式。推荐中的 score 仅是你对多个已核验候选的相对排序判断，不能替代事实理由。

最终只返回合法 JSON：
{"action":"recommended_existing|created_new|waiting","recommendations":[{"eventId":"search_rooms 返回的真实 id","score":0到100的整数,"verdict":"strong|possible|explore","headline":"一句判断","reasons":["引用具体事实"],"complements":["具体互补点"],"constraints":["待确认边界"],"nextStep":"低风险下一步"}],"message":"告诉用户 Agent 实际做了什么"}

调用 create_room 成功后，action 必须为 created_new，recommendations 应为空。`,
  });

  const messages: ModelMessage[] = [{
    role: "user",
    content: JSON.stringify({
      currentTime: new Date().toISOString(),
      relationshipSpace: input.channel,
      confirmedIntent: modelSafeIntent(input.intent),
      profile: modelSafeProfile(input.profile),
      availableRoomCount: input.rooms.length,
      authorizedAnonymousIntentCount: anonymousCandidatePool.length,
    }),
  }];

  const result = await agent.generate({
    messages,
    abortSignal: input.signal,
    timeout: 30_000,
  });
  if (!roomsSearched || !peopleSearched) {
    throw new Error("Agent 未完成现有局与授权意向的工具搜索。");
  }

  let parsed: z.infer<typeof outputSchema>;
  try {
    parsed = outputSchema.parse(extractJson(result.text));
  } catch (error) {
    if (createdRoom) {
      return {
        action: "created_new",
        recommendations: [],
        createdRoom,
        message: "Agent 已完成搜索，并按确认意图发起了一个新局。",
      };
    }
    throw error;
  }

  if (createdRoom) {
    return {
      action: "created_new",
      recommendations: [],
      createdRoom,
      message: parsed.message || "Agent 已完成搜索，并按确认意图发起了一个新局。",
    };
  }

  const recommendations: Opportunity[] = [];
  for (const item of parsed.recommendations) {
    if (!searchedRoomIds.has(item.eventId)) continue;
    const room = roomMap.get(item.eventId);
    if (!room) continue;
    recommendations.push({
      ...room,
      matchInsight: {
        score: item.score,
        verdict: item.verdict,
        headline: item.headline,
        reasons: item.reasons,
        complements: item.complements,
        constraints: item.constraints,
        nextStep: item.nextStep,
        source: "agent",
      },
    });
  }

  return {
    action: recommendations.length > 0 ? "recommended_existing" : "waiting",
    recommendations,
    createdRoom: null,
    message: parsed.message,
  };
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "请求来源无效。" }, { status: 403 });
  }

  const startedAt = Date.now();
  try {
    const session = await requireUserSession();
    assertParticipationAllowed(session);
    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "匹配意图不完整。" }, { status: 400 });

    const channel = parsed.data.channel as Channel;
    const profile = getUserProfileForSpace(session.id, channel);
    if (!profile) return NextResponse.json({ error: "请先完善资料。" }, { status: 404 });

    const intent: Intent = {
      ...parsed.data.intent,
      scene: CHANNELS[channel].scene,
      channel,
      status: "active",
    };
    const storedIntent = saveAgentMatchIntent({
      userId: session.id,
      channel,
      intent,
      matchingEnabled: true,
    });

    const rooms = (listEventsForUser(session.id) as OpportunityWithRegistration[])
      .filter((room) => resolveOpportunityChannel(room) === channel)
      .filter((room) => room.visibility !== "invite_only")
      .filter((room) => room.lifecycleStatus !== "cancelled" && room.lifecycleStatus !== "completed")
      .map(withoutRegistration);

    const configuration = getActiveModelConfiguration();
    if (!configuration) {
      logAgentRun({
        requestType: "recommendation",
        providerName: "未配置",
        model: "none",
        status: "degraded",
        durationMs: Date.now() - startedAt,
        metadata: { channel, rooms: rooms.length, intentSaved: true },
      });
      return NextResponse.json({
        action: "waiting",
        recommendations: [],
        createdRoom: null,
        message: "这份意图已经进入匹配池，但当前 Agent 尚未配置，暂时没有替你作出推荐或建局决定。",
      });
    }

    try {
      const decision = await runMatchingAgent({
        configuration,
        userId: session.id,
        channel,
        intent: storedIntent.intent,
        profile,
        rooms,
        signal: request.signal,
      });
      logAgentRun({
        requestType: "recommendation",
        providerId: configuration.id,
        providerName: configuration.name,
        model: configuration.model,
        status: "success",
        durationMs: Date.now() - startedAt,
        metadata: {
          channel,
          rooms: rooms.length,
          action: decision.action,
          recommendations: decision.recommendations.length,
          createdRoomId: decision.createdRoom?.id || "",
        },
      });
      return NextResponse.json(decision, { status: decision.action === "created_new" ? 201 : 200 });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "unknown error";
      logAgentRun({
        requestType: "recommendation",
        providerId: configuration.id,
        providerName: configuration.name,
        model: configuration.model,
        status: "degraded",
        durationMs: Date.now() - startedAt,
        errorMessage,
        metadata: { channel, rooms: rooms.length, intentSaved: true },
      });
      return NextResponse.json({
        action: "waiting",
        recommendations: [],
        createdRoom: null,
        message: "这份意图已经保存，但 Agent 本轮没有完成搜索与建局。稍后可以继续让它处理。",
      });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "暂时无法完成匹配。" },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "请求来源无效。" }, { status: 403 });
  }
  try {
    const session = await requireUserSession();
    const channelValue = new URL(request.url).searchParams.get("channel") || "";
    if (!isChannel(channelValue)) {
      return NextResponse.json({ error: "关系空间无效。" }, { status: 400 });
    }
    deleteAgentMatchIntent(session.id, channelValue);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "登录状态已失效，请重新进入攒攒。" }, { status: 401 });
  }
}
