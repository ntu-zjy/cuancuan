import { NextResponse } from "next/server";
import { ToolLoopAgent, stepCountIs, type ModelMessage } from "ai";
import { z } from "zod";
import {
  getActiveModelConfiguration,
  logAgentRun,
  type ActiveModelConfiguration,
} from "@/lib/database";
import { configuredProviderOptions, createConfiguredChatModel } from "@/lib/model-runtime";
import type { EventMatch } from "@/lib/types";

export const runtime = "nodejs";

const guestSchema = z.object({
  id: z.string().min(1).max(48),
  roles: z.array(z.string().min(1).max(50)).max(8),
  stage: z.string().max(120),
  position: z.string().max(80),
  needs: z.array(z.string().min(1).max(80)).max(12),
  needDetail: z.string().max(500),
  offers: z.array(z.string().min(1).max(80)).max(12),
  offerDetail: z.string().max(500),
});

const requestSchema = z.object({
  guests: z.array(guestSchema).min(2).max(40),
});

const agentSelectionSchema = z.object({
  requesterId: z.string(),
  providerId: z.string(),
});

const outputSchema = z.object({
  matches: z.array(agentSelectionSchema).min(1).max(8),
});

type SanitizedGuest = z.infer<typeof guestSchema>;

type Candidate = {
  requesterId: string;
  providerId: string;
  strength: 1 | 2 | 3;
  dimensions: string[];
  mutual: boolean;
  reason: string;
};

const signalRules = [
  { label: "技术", need: /找技术|技术落地|技术产品|开发|工程|算法|AI\s*能力/i, offer: /技术能力|算法|工程|开发|原型|AI\s*应用/i },
  { label: "行业场景", need: /找场景|真实场景|行业场景|落地场景|解决方案/i, offer: /行业场景|临床场景|医院资源|供应链|真实订单|试点/i },
  { label: "客户渠道", need: /找客户|获客|找渠道|销售|区域代理|采购/i, offer: /客户资源|渠道资源|销售能力|产业人脉|企业客户|运营商资源/i },
  { label: "数据", need: /找数据|数据资源|需要数据|数据合作/i, offer: /数据合作|数据资源|数据能力|临床数据/i },
  { label: "资金", need: /找资金|融资|投资人|资本/i, offer: /资金|投资|融资资源/i },
  { label: "产品共创", need: /找产品|找合伙人|找伙伴|找队友|共创|合作伙伴/i, offer: /产品能力|产品经理|创业者|原型开发|共研|试合作|商业化经验/i },
  { label: "增长内容", need: /增长|内容|品牌|流量|市场推广/i, offer: /内容流量|增长策略|品牌资源|运营能力/i },
  { label: "行业认知", need: /了解.*发展|了解.*落地|行业研究|商业建议|前沿/i, offer: /行业经验|专家资源|商业建议|临床研究|成果转化|大厂.*落地/i },
] as const;

const themeRules = [
  { label: "医疗方向", pattern: /医疗|临床|医院|药企|心脑血管/i },
  { label: "AI 应用", pattern: /AI|人工智能|算法|机器学习/i },
  { label: "企业服务", pattern: /企业|B2B|采购|运营商/i },
  { label: "产品验证", pattern: /产品|原型|demo|验证|0-1/i },
] as const;

function guestText(guest: SanitizedGuest) {
  return [
    ...guest.roles,
    guest.stage,
    guest.position,
    ...guest.needs,
    guest.needDetail,
    ...guest.offers,
    guest.offerDetail,
  ].join("，");
}

function directDimensions(requester: SanitizedGuest, provider: SanitizedGuest) {
  const needText = [...requester.needs, requester.needDetail].join("，");
  const offerText = [...provider.offers, provider.offerDetail].join("，");
  return signalRules
    .filter((rule) => rule.need.test(needText) && rule.offer.test(offerText))
    .map((rule) => rule.label);
}

function createCandidates(guests: SanitizedGuest[]): Candidate[] {
  const candidates: Candidate[] = [];

  for (let left = 0; left < guests.length; left += 1) {
    for (let right = left + 1; right < guests.length; right += 1) {
      const a = guests[left];
      const b = guests[right];
      const aToB = directDimensions(a, b);
      const bToA = directDimensions(b, a);
      const mutual = aToB.length > 0 && bToA.length > 0;

      if (aToB.length || bToA.length) {
        const requester = aToB.length >= bToA.length ? a : b;
        const provider = requester === a ? b : a;
        const primary = requester === a ? aToB : bToA;
        const reverse = requester === a ? bToA : aToB;
        const dimensions = Array.from(new Set([...primary, ...reverse])).slice(0, 5);
        const score = primary.length * 3 + reverse.length * 2 + (mutual ? 1 : 0);
        const strength: 1 | 2 | 3 = score >= 7 || primary.length >= 2 ? 3 : 2;
        candidates.push({
          requesterId: requester.id,
          providerId: provider.id,
          strength,
          dimensions,
          mutual,
          reason: mutual
            ? `双方在${dimensions.join("、")}上存在双向互补。`
            : `一方的${dimensions.join("、")}需求与另一方可提供的资源直接相接。`,
        });
        continue;
      }

      const themes = themeRules
        .filter((theme) => theme.pattern.test(guestText(a)) && theme.pattern.test(guestText(b)))
        .map((theme) => theme.label);
      if (themes.length > 0) {
        candidates.push({
          requesterId: a.id,
          providerId: b.id,
          strength: 1,
          dimensions: themes.slice(0, 2),
          mutual: false,
          reason: `双方都关注${themes.slice(0, 2).join("、")}，适合先交换具体问题和经验。`,
        });
      }
    }
  }

  return candidates.sort(candidatePriority);
}

function candidatePriority(a: Candidate, b: Candidate) {
  return b.strength - a.strength
    || Number(b.mutual) - Number(a.mutual)
    || b.dimensions.length - a.dimensions.length;
}

function selectCoverageCandidates(
  candidates: Candidate[],
  guestIds: string[],
  limit: number,
  initiallyCovered = new Set<string>(),
  excludedPairs = new Set<string>(),
) {
  const covered = new Set(initiallyCovered);
  const selected: Candidate[] = [];
  const available = candidates.filter((candidate) => !excludedPairs.has(`${candidate.requesterId}::${candidate.providerId}`));

  while (selected.length < limit && covered.size < guestIds.length) {
    const best = [...available]
      .filter((candidate) => !selected.includes(candidate))
      .sort((a, b) => {
        const uncoveredA = Number(!covered.has(a.requesterId)) + Number(!covered.has(a.providerId));
        const uncoveredB = Number(!covered.has(b.requesterId)) + Number(!covered.has(b.providerId));
        return uncoveredB - uncoveredA || candidatePriority(a, b);
      })[0];
    if (!best) break;
    const addsCoverage = !covered.has(best.requesterId) || !covered.has(best.providerId);
    if (!addsCoverage) break;
    selected.push(best);
    covered.add(best.requesterId);
    covered.add(best.providerId);
  }

  for (const candidate of available.sort(candidatePriority)) {
    if (selected.length >= limit) break;
    if (!selected.includes(candidate)) selected.push(candidate);
  }
  return selected;
}

function fallbackMatches(candidates: Candidate[], guests: SanitizedGuest[], limit = 12): EventMatch[] {
  const guestMap = new Map(guests.map((guest) => [guest.id, guest]));
  return candidates.slice(0, limit).map((candidate, index) => {
    const requester = guestMap.get(candidate.requesterId);
    const provider = guestMap.get(candidate.providerId);
    const copy = requester && provider ? groundedCopy(candidate, requester, provider) : {
      reason: candidate.reason,
      opening: "先用十分钟交换当前问题和可提供资源，再判断是否值得继续聊。",
    };
    return {
      ...copy,
      id: `local-match-${index + 1}`,
      requesterId: candidate.requesterId,
      providerId: candidate.providerId,
      strength: candidate.strength,
      dimensions: candidate.dimensions,
      mutual: candidate.mutual,
    };
  });
}

function groundedCopy(candidate: Candidate, requester: SanitizedGuest, provider: SanitizedGuest) {
  const needs = requester.needs.slice(0, 2).join("、") || "当前需求";
  const offers = provider.offers.slice(0, 2).join("、") || "可提供资源";
  const dimensions = candidate.dimensions.join("、");
  return {
    reason: `需求方的需求是“${needs}”，资源方可提供“${offers}”；双方在${dimensions}上${candidate.mutual ? "存在双向互补" : "可以形成直接对接"}。`,
    opening: `可以先从“${requester.needs[0] || "当前需求"}”聊起，看看“${provider.offers[0] || "现有资源"}”能否形成一个小型验证。`,
  };
}

function extractJson(raw: string) {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = fenced ?? raw;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Agent 未返回合法 JSON");
  return JSON.parse(source.slice(start, end + 1));
}

async function requestAgentMatches(
  configuration: ActiveModelConfiguration,
  guests: SanitizedGuest[],
  candidates: Candidate[],
  matchLimit: number,
  abortSignal: AbortSignal,
) {
  const agent = new ToolLoopAgent({
    id: "cuancuan-event-match-agent",
    model: createConfiguredChatModel(configuration),
    instructions: `你是攒攒的活动现场对接 Agent。你只根据匿名候选关系，挑出最值得现场优先引荐的 3–5 组合作关系。

规则：
- 不得猜测候选以外的关系，不得虚构资源、身份或承诺；
- requesterId 是提出需求的一方，providerId 是能提供对应资源的一方；
- 你只负责选择关系，不改写强度、维度、理由或资源事实；
- 联系方式、真实姓名不在输入中，也不得索取；
- 只返回合法 JSON，不使用 Markdown。

返回结构：
{"matches":[{"requesterId":"...","providerId":"..."}]}`,
    temperature: 0.15,
    maxRetries: 0,
    stopWhen: stepCountIs(1),
    providerOptions: configuredProviderOptions(configuration),
  });

  const guestMap = new Map(guests.map((guest) => [guest.id, guest]));
  const priorityCandidates = [...candidates].sort(candidatePriority).slice(0, 8);
  const candidateMap = new Map(priorityCandidates.map((candidate) => [
    `${candidate.requesterId}::${candidate.providerId}`,
    candidate,
  ]));
  const messages: ModelMessage[] = [{
    role: "user",
    content: JSON.stringify({
      candidates: priorityCandidates.map((candidate) => {
        const requester = guestMap.get(candidate.requesterId)!;
        const provider = guestMap.get(candidate.providerId)!;
        return {
          ...candidate,
          requesterNeeds: requester.needs,
          requesterNeedDetail: requester.needDetail.slice(0, 180),
          providerOffers: provider.offers,
          providerOfferDetail: provider.offerDetail.slice(0, 180),
          reverseNeeds: candidate.mutual ? provider.needs : [],
          reverseOffers: candidate.mutual ? requester.offers : [],
        };
      }),
    }),
  }];
  const result = await agent.generate({ messages, abortSignal, timeout: 25_000 });
  if (!result.text.includes("{")) {
    console.warn("[event-match] StepFun returned no final JSON:", JSON.stringify({
      finishReason: result.finishReason,
      textLength: result.text.length,
      reasoningLength: result.reasoningText?.length ?? 0,
      outputTokens: result.usage.outputTokens,
    }));
  }
  const parsed = outputSchema.parse(extractJson(result.text));
  const seen = new Set<string>();
  const agentMatches: EventMatch[] = [];

  for (const item of parsed.matches) {
    const pair = `${item.requesterId}::${item.providerId}`;
    const candidate = candidateMap.get(pair);
    if (!candidate || seen.has(pair)) continue;
    seen.add(pair);
    const requester = guestMap.get(item.requesterId)!;
    const provider = guestMap.get(item.providerId)!;
    const copy = groundedCopy(candidate, requester, provider);
    agentMatches.push({
      ...copy,
      requesterId: item.requesterId,
      providerId: item.providerId,
      strength: candidate.strength,
      dimensions: candidate.dimensions,
      mutual: candidate.mutual,
      id: `agent-match-${agentMatches.length + 1}`,
    });
  }
  if (agentMatches.length === 0) throw new Error("Agent 没有返回可验证的候选关系");

  const coveredIds = new Set(agentMatches.flatMap((match) => [match.requesterId, match.providerId]));
  const complementCandidates = selectCoverageCandidates(
    candidates,
    guests.map((guest) => guest.id),
    Math.max(0, matchLimit - agentMatches.length),
    coveredIds,
    seen,
  );
  const localComplements = fallbackMatches(complementCandidates, guests, matchLimit - agentMatches.length)
    .map((match, index) => ({ ...match, id: `rule-match-${index + 1}` }));
  return { matches: [...agentMatches, ...localComplements], model: configuration.model };
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "请导入 2–40 位包含需求与资源信息的嘉宾。" }, { status: 400 });
  }

  const guests = parsed.data.guests;
  const candidates = createCandidates(guests);
  if (candidates.length === 0) {
    return NextResponse.json({ error: "当前表格里的需求与资源还不足以形成可解释的对接关系。" }, { status: 422 });
  }
  const matchLimit = Math.min(24, Math.max(12, Math.ceil(guests.length * 0.6)));
  const coverageCandidates = selectCoverageCandidates(
    candidates,
    guests.map((guest) => guest.id),
    matchLimit,
  );

  const configuration = getActiveModelConfiguration();
  if (!configuration) {
    logAgentRun({
      requestType: "event_match",
      providerName: "本地规则",
      model: "local-fallback",
      status: "degraded",
      durationMs: Date.now() - startedAt,
      metadata: { participantCount: guests.length },
    });
    return NextResponse.json({
      matches: fallbackMatches(coverageCandidates, guests, matchLimit),
      provider: "local",
      degraded: true,
      participantCount: guests.length,
    });
  }

  try {
    const result = await requestAgentMatches(configuration, guests, candidates, matchLimit, request.signal);
    logAgentRun({
      requestType: "event_match",
      providerId: configuration.id,
      providerName: configuration.name,
      model: configuration.model,
      status: "success",
      durationMs: Date.now() - startedAt,
      metadata: { participantCount: guests.length, source: configuration.source },
    });
    return NextResponse.json({
      ...result,
      provider: "agent",
      providerName: configuration.name,
      participantCount: guests.length,
    });
  } catch (error) {
    console.warn("[event-match] Model unavailable; using local candidates:", error instanceof Error ? error.message : "unknown error");
    logAgentRun({
      requestType: "event_match",
      providerId: configuration.id,
      providerName: configuration.name,
      model: configuration.model,
      status: "degraded",
      durationMs: Date.now() - startedAt,
      errorMessage: error instanceof Error ? error.message : "unknown error",
      metadata: { participantCount: guests.length },
    });
    return NextResponse.json({
      matches: fallbackMatches(coverageCandidates, guests, matchLimit),
      provider: "local",
      degraded: true,
      participantCount: guests.length,
    });
  }
}
