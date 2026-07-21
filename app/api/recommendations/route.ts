import { NextResponse } from "next/server";
import { ToolLoopAgent, stepCountIs, tool, type ModelMessage } from "ai";
import { z } from "zod";
import {
  getActiveModelConfiguration,
  getUserProfileForSpace,
  listEventsForUser,
  logAgentRun,
} from "@/lib/database";
import { configuredProviderOptions, createConfiguredChatModel } from "@/lib/model-runtime";
import { isChannel, resolveOpportunityChannel } from "@/lib/channels";
import { assertParticipationAllowed, requireUserSession } from "@/lib/user-auth";
import type { Channel, Intent, MatchInsight, Opportunity, OpportunityWithRegistration } from "@/lib/types";

export const runtime = "nodejs";

const requestSchema = z.object({
  channel: z.string().refine(isChannel),
  intent: z.object({
    title: z.string().max(100),
    summary: z.string().max(700),
    target: z.string().max(300),
    context: z.string().max(300).optional(),
    offer: z.string().max(300),
    commitment: z.string().max(300).optional(),
    constraints: z.string().max(300).optional(),
    validity: z.string().max(100),
  }),
});

const outputSchema = z.object({
  recommendations: z.array(z.object({
    eventId: z.string(),
    score: z.number().int().min(0).max(100),
    verdict: z.enum(["strong", "possible", "explore"]),
    headline: z.string().max(80),
    reasons: z.array(z.string().max(140)).min(1).max(3),
    complements: z.array(z.string().max(120)).max(3),
    constraints: z.array(z.string().max(140)).max(3),
    nextStep: z.string().max(160),
  })).max(4),
});

function extractJson(raw: string) {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = fenced || raw;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Agent 未返回合法 JSON");
  return JSON.parse(source.slice(start, end + 1));
}

function tokens(value: string) {
  const normalized = value.toLowerCase().replace(/[，。；、：,.!?\s]+/g, "");
  const result = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) result.add(normalized.slice(index, index + 2));
  return result;
}

function overlap(left: string, right: string) {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  let matches = 0;
  a.forEach((token) => { if (b.has(token)) matches += 1; });
  return matches / Math.max(1, Math.min(a.size, b.size));
}

function localInsight(intent: Intent, profile: NonNullable<ReturnType<typeof getUserProfileForSpace>>, room: Opportunity): MatchInsight {
  const roomNeed = `${room.title} ${room.summary} ${room.description} ${room.tags.join(" ")} ${room.people.map((person) => person.need || "").join(" ")}`;
  const roomOffer = `${room.people.map((person) => `${person.offer} ${person.summary}`).join(" ")} ${room.observation}`;
  const goalFit = overlap(`${intent.target} ${intent.summary}`, roomNeed);
  const offerFit = overlap(`${intent.offer} ${profile.offer} ${profile.skills}`, roomNeed);
  const complementFit = overlap(`${intent.target} ${intent.context || ""}`, roomOffer);
  const sameCity = !profile.city || profile.city === room.city || room.city.includes(profile.city) || profile.city.includes(room.city);
  const openSeats = room.members < room.maxMembers;
  let score = 42 + Math.round(goalFit * 22 + offerFit * 18 + complementFit * 14);
  if (sameCity) score += 6;
  if (!openSeats) score -= 18;
  if (room.registrationMode === "approval") score += 2;
  score = Math.max(20, Math.min(96, score));
  const reasons = [
    `你的目标是“${intent.target.slice(0, 48)}”，这个局正在推进“${room.title}”。`,
  ];
  if (offerFit > 0.04 || profile.offer) reasons.push(`你能带来的“${(intent.offer || profile.offer).slice(0, 46)}”可以补充当前成员。`);
  if (sameCity) reasons.push(`${room.city}的时间与地点可继续确认，不需要跨城开始。`);
  const constraints: string[] = [];
  if (!sameCity) constraints.push(`你填写的城市是${profile.city}，这个局在${room.city}，需要先确认远程或出行安排。`);
  if (!openSeats) constraints.push("当前正式名额已满，只能先进入候补。");
  if (intent.constraints) constraints.push(`加入前应再次确认你的边界：“${intent.constraints.slice(0, 64)}”。`);
  return {
    score,
    verdict: score >= 78 ? "strong" : score >= 58 ? "possible" : "explore",
    headline: score >= 78 ? "目标与当前缺口形成了具体互补" : score >= 58 ? "有值得验证的共同方向" : "适合先交换一次具体问题",
    reasons: reasons.slice(0, 3),
    complements: [room.people[0]?.offer ? `现有成员可提供：${room.people[0].offer}` : room.observation].slice(0, 2),
    constraints: constraints.slice(0, 3),
    nextStep: room.registrationMode === "approval" ? "申请时说明你能承担的具体部分，并先确认一次 20 分钟交流。" : "先确认时间地点，再用一次低压力见面验证是否合拍。",
    source: "local",
  };
}

function sanitizeRoom(room: Opportunity) {
  return {
    id: room.id,
    title: room.title,
    summary: room.summary,
    description: room.description,
    tags: room.tags,
    city: room.city,
    venue: room.venue,
    startsAt: room.startsAt,
    registrationMode: room.registrationMode,
    members: room.members,
    minMembers: room.minMembers,
    maxMembers: room.maxMembers,
    organizer: { role: room.organizer.role, verified: room.organizer.verified },
    people: room.people.map((person) => ({ summary: person.summary, offer: person.offer, need: person.need, role: person.role })),
  };
}

async function agentInsights(
  configuration: NonNullable<ReturnType<typeof getActiveModelConfiguration>>,
  channel: Channel,
  intent: Intent,
  profile: NonNullable<ReturnType<typeof getUserProfileForSpace>>,
  rooms: Opportunity[],
  signal: AbortSignal,
) {
  const roomMap = new Map(rooms.map((room) => [room.id, room]));
  const tools = {
    search_rooms: tool({
      description: "在当前关系空间中按城市、关键词、时间和开放名额搜索真实局。必须先调用。",
      inputSchema: z.object({ keywords: z.array(z.string()).max(8), city: z.string().optional(), openOnly: z.boolean().default(true) }),
      execute: async ({ keywords, city, openOnly }) => rooms
        .filter((room) => !city || room.city.includes(city) || city.includes(room.city))
        .filter((room) => !openOnly || room.members < room.maxMembers)
        .map((room) => ({ room, relevance: overlap(keywords.join(" "), `${room.title} ${room.summary} ${room.tags.join(" ")}`) }))
        .sort((a, b) => b.relevance - a.relevance)
        .slice(0, 6)
        .map(({ room }) => sanitizeRoom(room)),
    }),
    inspect_room: tool({
      description: "查看一个候选局的成员缺口、边界、日程和具体资源。只能查看 search_rooms 返回的局。",
      inputSchema: z.object({ eventId: z.string() }),
      execute: async ({ eventId }) => {
        const room = roomMap.get(eventId);
        return room ? sanitizeRoom(room) : { error: "room_not_found" };
      },
    }),
  };
  const agent = new ToolLoopAgent({
    id: "cuancuan-recommendation-agent",
    model: createConfiguredChatModel(configuration),
    tools,
    stopWhen: stepCountIs(5),
    maxRetries: 0,
    temperature: 0.15,
    providerOptions: configuredProviderOptions(configuration),
    instructions: `你是攒攒的局匹配 Agent。当前关系空间固定为 ${channel}，绝不能跨空间搜索或使用其他空间资料。
你必须先调用 search_rooms，再对最相关候选调用 inspect_room。判断时分别检查：目标一致、能力互补、城市时间可行、投入方式、硬性边界、多人组合缺口。
推荐理由必须引用输入中的具体事实，不得使用“目标相近、节奏合适”这类空话；不输出匹配概率，不索取或泄露联系方式。
最终只返回合法 JSON：{"recommendations":[{"eventId":"...","score":0到100的整数,"verdict":"strong|possible|explore","headline":"一句判断","reasons":["具体事实"],"complements":["互补点"],"constraints":["待确认边界"],"nextStep":"低风险下一步"}]}`,
  });
  const messages: ModelMessage[] = [{
    role: "user",
    content: JSON.stringify({
      relationshipSpace: channel,
      intent,
      profile: { city: profile.city, identity: profile.identity, skills: profile.skills, offer: profile.offer, bio: profile.bio },
      availableRoomCount: rooms.length,
    }),
  }];
  const result = await agent.generate({ messages, abortSignal: signal, timeout: 25_000 });
  const parsed = outputSchema.parse(extractJson(result.text));
  const recommendations: Opportunity[] = [];
  for (const item of parsed.recommendations) {
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
  return recommendations;
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    const session = await requireUserSession();
    assertParticipationAllowed(session);
    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "匹配意图不完整。" }, { status: 400 });
    const channel = parsed.data.channel as Channel;
    const profile = getUserProfileForSpace(session.id, channel);
    if (!profile) return NextResponse.json({ error: "请先完善资料。" }, { status: 404 });
    const intent: Intent = { ...parsed.data.intent, scene: channel === "love" || channel === "play" || channel === "travel" ? "love" : "startup", channel };
    const rooms = (listEventsForUser(session.id) as OpportunityWithRegistration[])
      .filter((room) => resolveOpportunityChannel(room) === channel)
      .filter((room) => room.visibility !== "invite_only")
      .map((item) => {
        const room = { ...item };
        delete room.registration;
        return room as Opportunity;
      });
    const local = rooms
      .map((room) => ({ ...room, matchInsight: localInsight(intent, profile, room) }))
      .sort((a, b) => (b.matchInsight?.score || 0) - (a.matchInsight?.score || 0))
      .slice(0, 4);
    const configuration = getActiveModelConfiguration();
    if (!configuration || rooms.length === 0) {
      logAgentRun({ requestType: "recommendation", providerName: "本地解释引擎", model: "local-fallback", status: "degraded", durationMs: Date.now() - startedAt, metadata: { channel, candidates: rooms.length } });
      return NextResponse.json({ recommendations: local, provider: "local", degraded: true });
    }
    try {
      const recommendations = await agentInsights(configuration, channel, intent, profile, rooms, request.signal);
      logAgentRun({ requestType: "recommendation", providerId: configuration.id, providerName: configuration.name, model: configuration.model, status: "success", durationMs: Date.now() - startedAt, metadata: { channel, candidates: rooms.length } });
      return NextResponse.json({ recommendations: recommendations.length ? recommendations : local, provider: recommendations.length ? "agent" : "local" });
    } catch (error) {
      logAgentRun({ requestType: "recommendation", providerId: configuration.id, providerName: configuration.name, model: configuration.model, status: "degraded", durationMs: Date.now() - startedAt, errorMessage: error instanceof Error ? error.message : "unknown error", metadata: { channel, candidates: rooms.length } });
      return NextResponse.json({ recommendations: local, provider: "local", degraded: true });
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "暂时无法完成匹配。" }, { status: 400 });
  }
}
