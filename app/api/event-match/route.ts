import { NextResponse } from "next/server";
import { ToolLoopAgent, stepCountIs, type ModelMessage } from "ai";
import { z } from "zod";
import {
  createEventMatchCandidates,
  EVENT_MATCH_DEFAULT_CONNECTION_CAP,
  EVENT_MATCH_MAX_GUESTS,
  eventMatchLimit,
  fallbackEventMatches,
  isCandidatePair,
  selectCoverageCandidates,
  summarizeEventMatchCoverage,
  type EventMatchCandidate,
  type MatchableEventGuest,
} from "@/lib/event-matching";
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
  guests: z.array(guestSchema).min(2).max(EVENT_MATCH_MAX_GUESTS),
}).superRefine(({ guests }, context) => {
  const ids = new Set<string>();
  guests.forEach((guest, index) => {
    if (ids.has(guest.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "嘉宾 ID 不能重复",
        path: ["guests", index, "id"],
      });
    }
    ids.add(guest.id);
  });
});

const agentSelectionSchema = z.object({
  requesterId: z.string(),
  providerId: z.string(),
});

const outputSchema = z.object({
  matches: z.array(agentSelectionSchema).min(1).max(8),
});

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
  guests: MatchableEventGuest[],
  candidates: EventMatchCandidate[],
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
  // The model prioritises a small grounded shortlist.  The deterministic pass
  // below is intentionally responsible for broad participant coverage.
  const directCandidates = candidates.filter((candidate) => candidate.strength >= 2);
  const priorityCandidates = (directCandidates.length ? directCandidates : candidates)
    .slice(0, 10);
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
    console.warn("[event-match] Model returned no final JSON:", JSON.stringify({
      finishReason: result.finishReason,
      textLength: result.text.length,
      reasoningLength: result.reasoningText?.length ?? 0,
      outputTokens: result.usage.outputTokens,
    }));
  }
  const parsed = outputSchema.parse(extractJson(result.text));
  const seen = new Set<string>();
  const agentMatches: EventMatch[] = [];
  const agentConnectionCounts = new Map<string, number>();

  for (const item of parsed.matches) {
    const pair = `${item.requesterId}::${item.providerId}`;
    const candidate = candidateMap.get(pair);
    if (!candidate || seen.has(pair)) continue;
    if (
      (agentConnectionCounts.get(candidate.requesterId) || 0) >= EVENT_MATCH_DEFAULT_CONNECTION_CAP
      || (agentConnectionCounts.get(candidate.providerId) || 0) >= EVENT_MATCH_DEFAULT_CONNECTION_CAP
    ) continue;
    seen.add(pair);
    const oneMatch = fallbackEventMatches([candidate], guests, 1, "agent-match")[0];
    if (oneMatch) {
      agentMatches.push({ ...oneMatch, id: `agent-match-${agentMatches.length + 1}` });
      agentConnectionCounts.set(candidate.requesterId, (agentConnectionCounts.get(candidate.requesterId) || 0) + 1);
      agentConnectionCounts.set(candidate.providerId, (agentConnectionCounts.get(candidate.providerId) || 0) + 1);
    }
  }
  if (agentMatches.length === 0) throw new Error("Agent 没有返回可验证的候选关系");

  const coveredIds = new Set(agentMatches.flatMap((match) => [match.requesterId, match.providerId]));
  const initialCandidates = candidates.filter((candidate) => agentMatches.some((match) => (
    isCandidatePair(candidate, match.requesterId, match.providerId)
  )));
  const complementCandidates = selectCoverageCandidates(
    candidates,
    guests.map((guest) => guest.id),
    Math.max(0, matchLimit - agentMatches.length),
    { initiallyCovered: coveredIds, excludedPairs: seen, initialCandidates },
  );
  const localComplements = fallbackEventMatches(
    complementCandidates,
    guests,
    matchLimit - agentMatches.length,
    "rule-match",
  );
  return { matches: [...agentMatches, ...localComplements], model: configuration.model };
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: `请导入 2–${EVENT_MATCH_MAX_GUESTS} 位包含需求与资源信息的嘉宾。` }, { status: 400 });
  }

  const guests = parsed.data.guests;
  const candidates = createEventMatchCandidates(guests);
  if (candidates.length === 0) {
    return NextResponse.json({ error: "当前表格里的需求与资源还不足以形成可解释的对接关系。" }, { status: 422 });
  }

  const matchLimit = eventMatchLimit(guests.length);
  const coverageCandidates = selectCoverageCandidates(candidates, guests.map((guest) => guest.id), matchLimit);
  const localMatches = fallbackEventMatches(coverageCandidates, guests, matchLimit);
  const configuration = getActiveModelConfiguration();

  if (!configuration) {
    const coverage = summarizeEventMatchCoverage(guests, candidates, localMatches);
    logAgentRun({
      requestType: "event_match",
      providerName: "本地规则",
      model: "local-fallback",
      status: "degraded",
      durationMs: Date.now() - startedAt,
      metadata: { participantCount: guests.length, matchCount: localMatches.length, coverageRate: coverage.coverageRate },
    });
    return NextResponse.json({
      matches: localMatches,
      coverage,
      provider: "local",
      degraded: true,
      participantCount: guests.length,
    });
  }

  try {
    const result = await requestAgentMatches(configuration, guests, candidates, matchLimit, request.signal);
    const coverage = summarizeEventMatchCoverage(guests, candidates, result.matches);
    logAgentRun({
      requestType: "event_match",
      providerId: configuration.id,
      providerName: configuration.name,
      model: configuration.model,
      status: "success",
      durationMs: Date.now() - startedAt,
      metadata: { participantCount: guests.length, source: configuration.source, matchCount: result.matches.length, coverageRate: coverage.coverageRate },
    });
    return NextResponse.json({
      ...result,
      coverage,
      provider: "agent",
      providerName: configuration.name,
      participantCount: guests.length,
    });
  } catch (error) {
    console.warn("[event-match] Model unavailable; using local candidates:", error instanceof Error ? error.message : "unknown error");
    const coverage = summarizeEventMatchCoverage(guests, candidates, localMatches);
    logAgentRun({
      requestType: "event_match",
      providerId: configuration.id,
      providerName: configuration.name,
      model: configuration.model,
      status: "degraded",
      durationMs: Date.now() - startedAt,
      errorMessage: error instanceof Error ? error.message : "unknown error",
      metadata: { participantCount: guests.length, matchCount: localMatches.length, coverageRate: coverage.coverageRate },
    });
    return NextResponse.json({
      matches: localMatches,
      coverage,
      provider: "local",
      degraded: true,
      participantCount: guests.length,
    });
  }
}
