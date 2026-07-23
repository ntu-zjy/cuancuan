import type { EventGuest, EventMatch } from "./types";

/**
 * The browser, API route and simulation all use this module.  Keeping the
 * deterministic part of matching here prevents a demo test from accidentally
 * exercising different logic than the live product.
 */
export const EVENT_MATCH_MAX_GUESTS = 120;
export const EVENT_MATCH_DEFAULT_CONNECTION_CAP = 3;

export type MatchableEventGuest = Pick<
  EventGuest,
  "id" | "roles" | "stage" | "position" | "needs" | "needDetail" | "offers" | "offerDetail"
>;

export type EventMatchCandidate = {
  requesterId: string;
  providerId: string;
  strength: 1 | 2 | 3;
  dimensions: string[];
  mutual: boolean;
  reason: string;
};

export type EventMatchCoverage = {
  participantCount: number;
  candidateCount: number;
  directCandidateCount: number;
  matchCount: number;
  connectedParticipantCount: number;
  directConnectedParticipantCount: number;
  coverageRate: number;
  directCoverageRate: number;
  mutualMatchCount: number;
  strongMatchCount: number;
  unsupportedGuestIds: string[];
  unconnectedGuestIds: string[];
  maximumConnectionsForOneGuest: number;
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

function guestText(guest: MatchableEventGuest) {
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

export function directMatchDimensions(requester: MatchableEventGuest, provider: MatchableEventGuest) {
  const needText = [...requester.needs, requester.needDetail].join("，");
  const offerText = [...provider.offers, provider.offerDetail].join("，");
  return signalRules
    .filter((rule) => rule.need.test(needText) && rule.offer.test(offerText))
    .map((rule) => rule.label);
}

export function candidatePriority(a: EventMatchCandidate, b: EventMatchCandidate) {
  return b.strength - a.strength
    || Number(b.mutual) - Number(a.mutual)
    || b.dimensions.length - a.dimensions.length;
}

/** Creates only grounded, explainable pairs.  A weak pair means a shared topic, not a claimed resource match. */
export function createEventMatchCandidates(guests: MatchableEventGuest[]): EventMatchCandidate[] {
  const candidates: EventMatchCandidate[] = [];

  for (let left = 0; left < guests.length; left += 1) {
    for (let right = left + 1; right < guests.length; right += 1) {
      const a = guests[left];
      const b = guests[right];
      const aToB = directMatchDimensions(a, b);
      const bToA = directMatchDimensions(b, a);
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

function candidateKey(candidate: Pick<EventMatchCandidate, "requesterId" | "providerId">) {
  return `${candidate.requesterId}::${candidate.providerId}`;
}

/**
 * A coverage-first greedy pass.  It deliberately never invents an edge just
 * to make a percentage look good: people without any candidate remain visible
 * in the returned audit as unsupported.
 */
export function selectCoverageCandidates(
  candidates: EventMatchCandidate[],
  guestIds: string[],
  limit: number,
  options: {
    initiallyCovered?: Set<string>;
    excludedPairs?: Set<string>;
    initialCandidates?: EventMatchCandidate[];
    connectionCap?: number;
  } = {},
) {
  const covered = new Set(options.initiallyCovered);
  const selected: EventMatchCandidate[] = [];
  const excludedPairs = options.excludedPairs ?? new Set<string>();
  const available = candidates.filter((candidate) => !excludedPairs.has(candidateKey(candidate)));
  const connectionCap = options.connectionCap ?? EVENT_MATCH_DEFAULT_CONNECTION_CAP;
  const connectionCounts = new Map<string, number>();
  (options.initialCandidates ?? []).forEach((candidate) => {
    connectionCounts.set(candidate.requesterId, (connectionCounts.get(candidate.requesterId) || 0) + 1);
    connectionCounts.set(candidate.providerId, (connectionCounts.get(candidate.providerId) || 0) + 1);
  });
  const canSelect = (candidate: EventMatchCandidate) => (
    (connectionCounts.get(candidate.requesterId) || 0) < connectionCap
    && (connectionCounts.get(candidate.providerId) || 0) < connectionCap
  );
  const add = (candidate: EventMatchCandidate) => {
    selected.push(candidate);
    covered.add(candidate.requesterId);
    covered.add(candidate.providerId);
    connectionCounts.set(candidate.requesterId, (connectionCounts.get(candidate.requesterId) || 0) + 1);
    connectionCounts.set(candidate.providerId, (connectionCounts.get(candidate.providerId) || 0) + 1);
  };

  while (selected.length < limit && covered.size < guestIds.length) {
    const best = [...available]
      .filter((candidate) => !selected.includes(candidate) && canSelect(candidate))
      .sort((a, b) => {
        const uncoveredA = Number(!covered.has(a.requesterId)) + Number(!covered.has(a.providerId));
        const uncoveredB = Number(!covered.has(b.requesterId)) + Number(!covered.has(b.providerId));
        const degreeA = (connectionCounts.get(a.requesterId) || 0) + (connectionCounts.get(a.providerId) || 0);
        const degreeB = (connectionCounts.get(b.requesterId) || 0) + (connectionCounts.get(b.providerId) || 0);
        return uncoveredB - uncoveredA || degreeA - degreeB || candidatePriority(a, b);
      })[0];
    if (!best) break;
    const addsCoverage = !covered.has(best.requesterId) || !covered.has(best.providerId);
    if (!addsCoverage) break;
    add(best);
  }

  for (const candidate of available.sort((a, b) => {
    const degreeA = (connectionCounts.get(a.requesterId) || 0) + (connectionCounts.get(a.providerId) || 0);
    const degreeB = (connectionCounts.get(b.requesterId) || 0) + (connectionCounts.get(b.providerId) || 0);
    return degreeA - degreeB || candidatePriority(a, b);
  })) {
    if (selected.length >= limit) break;
    if (!selected.includes(candidate) && canSelect(candidate)) add(candidate);
  }
  return selected;
}

/**
 * On a 100-person activity, 24 edges can never cover the room.  The budget is
 * sized to cover everybody who has a grounded candidate, plus room for higher
 * quality alternates, while still keeping the operator's action list usable.
 */
export function eventMatchLimit(guestCount: number) {
  const coverageFloor = Math.ceil(guestCount / 2);
  const qualityReserve = Math.ceil(guestCount * 0.15);
  return Math.min(80, Math.max(12, coverageFloor + qualityReserve));
}

function groundedCopy(candidate: EventMatchCandidate, requester: MatchableEventGuest, provider: MatchableEventGuest) {
  const needs = requester.needs.slice(0, 2).join("、") || "当前需求";
  const offers = provider.offers.slice(0, 2).join("、") || "可提供资源";
  const dimensions = candidate.dimensions.join("、");
  return {
    reason: `需求方的需求是“${needs}”，资源方可提供“${offers}”；双方在${dimensions}上${candidate.mutual ? "存在双向互补" : "可以形成直接对接"}。`,
    opening: `可以先从“${requester.needs[0] || "当前需求"}”聊起，看看“${provider.offers[0] || "现有资源"}”能否形成一个小型验证。`,
  };
}

export function fallbackEventMatches(candidates: EventMatchCandidate[], guests: MatchableEventGuest[], limit: number, idPrefix = "local-match"): EventMatch[] {
  const guestMap = new Map(guests.map((guest) => [guest.id, guest]));
  return candidates.slice(0, limit).flatMap((candidate, index) => {
    const requester = guestMap.get(candidate.requesterId);
    const provider = guestMap.get(candidate.providerId);
    if (!requester || !provider) return [];
    const copy = groundedCopy(candidate, requester, provider);
    return [{
      ...copy,
      id: `${idPrefix}-${index + 1}`,
      requesterId: candidate.requesterId,
      providerId: candidate.providerId,
      strength: candidate.strength,
      dimensions: candidate.dimensions,
      mutual: candidate.mutual,
    }];
  });
}

export function summarizeEventMatchCoverage(
  guests: MatchableEventGuest[],
  candidates: EventMatchCandidate[],
  matches: EventMatch[],
): EventMatchCoverage {
  const candidateGuestIds = new Set(candidates.flatMap((candidate) => [candidate.requesterId, candidate.providerId]));
  const connectedIds = new Set(matches.flatMap((match) => [match.requesterId, match.providerId]));
  const directConnectedIds = new Set(matches
    .filter((match) => match.strength >= 2)
    .flatMap((match) => [match.requesterId, match.providerId]));
  const connectionCounts = new Map<string, number>();
  matches.forEach((match) => {
    connectionCounts.set(match.requesterId, (connectionCounts.get(match.requesterId) || 0) + 1);
    connectionCounts.set(match.providerId, (connectionCounts.get(match.providerId) || 0) + 1);
  });
  const participantCount = guests.length;
  const safeRate = (count: number) => participantCount === 0 ? 0 : Math.round((count / participantCount) * 1000) / 10;

  return {
    participantCount,
    candidateCount: candidates.length,
    directCandidateCount: candidates.filter((candidate) => candidate.strength >= 2).length,
    matchCount: matches.length,
    connectedParticipantCount: connectedIds.size,
    directConnectedParticipantCount: directConnectedIds.size,
    coverageRate: safeRate(connectedIds.size),
    directCoverageRate: safeRate(directConnectedIds.size),
    mutualMatchCount: matches.filter((match) => match.mutual).length,
    strongMatchCount: matches.filter((match) => match.strength === 3).length,
    unsupportedGuestIds: guests.filter((guest) => !candidateGuestIds.has(guest.id)).map((guest) => guest.id),
    unconnectedGuestIds: guests.filter((guest) => !connectedIds.has(guest.id)).map((guest) => guest.id),
    maximumConnectionsForOneGuest: Math.max(0, ...connectionCounts.values()),
  };
}

export function isCandidatePair(candidate: EventMatchCandidate, requesterId: string, providerId: string) {
  return candidate.requesterId === requesterId && candidate.providerId === providerId;
}
