import {
  createEventMatchCandidates,
  eventMatchLimit,
  fallbackEventMatches,
  selectCoverageCandidates,
  summarizeEventMatchCoverage,
} from "../lib/event-matching.ts";
import {
  createBalancedRoster,
  createCompleteNoFitRoster,
  createMixedQualityRoster,
  createSupplyConstrainedRoster,
} from "./event-match-fixtures.mjs";

function percent(numerator, denominator) {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 1000) / 10;
}

function formatGuestIds(ids, previewSize = 12) {
  if (ids.length === 0) return "无";
  const preview = ids.slice(0, previewSize).join("、");
  return ids.length > previewSize ? `${ids.length} 人（前 ${previewSize} 位：${preview}…）` : preview;
}

function evaluate(label, guests, { allowCapacityConstrained = false } = {}) {
  if (guests.length !== 100) {
    throw new Error(`${label} 必须恰好包含 100 位嘉宾，当前为 ${guests.length} 位。`);
  }
  const candidates = createEventMatchCandidates(guests);
  const selected = selectCoverageCandidates(candidates, guests.map((guest) => guest.id), eventMatchLimit(guests.length));
  const matches = fallbackEventMatches(selected, guests, selected.length, `${label}-match`);
  const summary = summarizeEventMatchCoverage(guests, candidates, matches);
  const guestMap = new Map(guests.map((guest) => [guest.id, guest]));
  const connectedIds = new Set(matches.flatMap((match) => [match.requesterId, match.providerId]));
  const candidateDensity = percent(candidates.length, (guests.length * (guests.length - 1)) / 2);
  const directMatches = matches.filter((match) => match.strength >= 2);
  const validDirectMatches = directMatches.filter((match) => {
    const requester = guestMap.get(match.requesterId);
    const provider = guestMap.get(match.providerId);
    return Boolean(requester && provider && (
      requester.expectedCohorts.includes(provider.cohort)
      || provider.expectedCohorts.includes(requester.cohort)
    ));
  }).length;
  const precision = percent(validDirectMatches, directMatches.length);
  const expectedParticipants = guests.filter((guest) => guest.expectedCohorts.length > 0).length;
  const expectedParticipantCoverage = percent(
    guests.filter((guest) => guest.expectedCohorts.length > 0 && connectedIds.has(guest.id)).length,
    expectedParticipants,
  );
  const capacityConstrainedGuestIds = summary.unconnectedGuestIds.filter((id) => !summary.unsupportedGuestIds.includes(id));

  console.log(`\n${"=".repeat(74)}`);
  console.log(`100 人现场攒攒模拟：${label}`);
  console.log(`${"=".repeat(74)}`);
  console.table([{
    "输入嘉宾": guests.length,
    "候选关系": summary.candidateCount,
    "候选密度": `${candidateDensity}%`,
    "直接互补候选": summary.directCandidateCount,
    "输出关系": summary.matchCount,
    "已连接嘉宾": `${summary.connectedParticipantCount}/${summary.participantCount} (${summary.coverageRate}%)`,
    "直接连接嘉宾": `${summary.directConnectedParticipantCount}/${summary.participantCount} (${summary.directCoverageRate}%)`,
    "双向互补": summary.mutualMatchCount,
    "优先对接": summary.strongMatchCount,
    "最大单人连接数": summary.maximumConnectionsForOneGuest,
    "预设对口命中占比": `${precision}%`,
  }]);
  console.log(`暂未进入关系图的嘉宾：${formatGuestIds(summary.unconnectedGuestIds)}`);
  console.log(`资料不足或无有效候选的人：${formatGuestIds(summary.unsupportedGuestIds)}`);
  console.log(`受当前供给或连接上限影响、仍有候选但未连上的人：${formatGuestIds(capacityConstrainedGuestIds)}`);
  console.log(`预期可匹配嘉宾覆盖：${expectedParticipantCoverage}%`);

  if (!allowCapacityConstrained && capacityConstrainedGuestIds.length > 0) {
    throw new Error(`${label} 存在“有候选却没被选中”的可避免孤岛。`);
  }
  return { summary, expectedParticipantCoverage, candidateDensity, capacityConstrainedGuestIds, directPrecision: precision, matches };
}

const balanced = evaluate("balanced-100（每人都有一个结构化对口）", createBalancedRoster());
const mixed = evaluate("mixed-quality-100（88 人可配，12 人资料不足）", createMixedQualityRoster());
const completeNoFit = evaluate("complete-no-fit-100（90 人可配，10 人资料完整但本场无对口）", createCompleteNoFitRoster());
const constrained = evaluate("supply-constrained-100（97 个融资需求，对应 3 位投资人）", createSupplyConstrainedRoster(), {
  allowCapacityConstrained: true,
});

if (balanced.summary.coverageRate < 98 || balanced.expectedParticipantCoverage < 98) {
  throw new Error("balanced-100 未达到 ≥98% 覆盖的验收线。");
}
if (balanced.candidateDensity > 35) {
  throw new Error(`balanced-100 候选密度为 ${balanced.candidateDensity}%，测试样本过于稠密，无法有效衡量匹配质量。`);
}
if (balanced.directPrecision !== 100) {
  throw new Error(`balanced-100 的预设对口命中占比为 ${balanced.directPrecision}%，应为 100%。`);
}
if (mixed.summary.unconnectedGuestIds.length !== mixed.summary.unsupportedGuestIds.length) {
  throw new Error("mixed-quality-100 出现了可避免孤岛。");
}
if (completeNoFit.summary.unconnectedGuestIds.length !== 10 || completeNoFit.summary.unsupportedGuestIds.length !== 10) {
  throw new Error("complete-no-fit-100 应保留 10 位资料完整但本场无对口的嘉宾，而不是强行匹配。");
}
if (constrained.summary.maximumConnectionsForOneGuest !== 3 || constrained.matches.length !== 9) {
  throw new Error("supply-constrained-100 未正确执行每人最多 3 条连接的供给上限。");
}
if (constrained.capacityConstrainedGuestIds.length !== 88) {
  throw new Error(`supply-constrained-100 预期有 88 位供给受限嘉宾未进入关系图，实际为 ${constrained.capacityConstrainedGuestIds.length}。`);
}

console.log("\n模拟通过：在供给均衡时，规则层会优先覆盖每位有依据的嘉宾；资料不足或本场无对口的人不会被硬凑；当供给显著失衡时，连接上限会明确暴露未被服务的人数。\n");
