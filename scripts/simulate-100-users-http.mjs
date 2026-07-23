import { eventMatchLimit, EVENT_MATCH_DEFAULT_CONNECTION_CAP } from "../lib/event-matching.ts";
import {
  createBalancedRoster,
  createCompleteNoFitRoster,
  createMixedQualityRoster,
  createSupplyConstrainedRoster,
} from "./event-match-fixtures.mjs";

const DEFAULT_ENDPOINT = "http://127.0.0.1:3000/api/event-match";
const DEFAULT_TIMEOUT_MS = 70_000;
const LOCAL_HOSTS = new Set(["127.0.0.1", "::1", "[::1]", "localhost", "0.0.0.0"]);
const FIXTURES = {
  balanced: {
    label: "供给均衡：每人都有结构化对口",
    createRoster: createBalancedRoster,
    minCoverageRate: 98,
    minDirectPrecision: 100,
  },
  mixed: {
    label: "资料不足：88 人可配、12 人待补充",
    createRoster: createMixedQualityRoster,
    minCoverageRate: 88,
    expectedUnsupportedCount: 12,
    expectedUnconnectedCount: 12,
  },
  "no-counterpart": {
    label: "资料完整但无对口：90 人可配、10 人不强配",
    createRoster: createCompleteNoFitRoster,
    minCoverageRate: 90,
    expectedUnsupportedCount: 10,
    expectedUnconnectedCount: 10,
  },
  capacity: {
    label: "供需失衡：97 个融资需求、3 位投资人",
    createRoster: createSupplyConstrainedRoster,
    minCoverageRate: 12,
    allowCapacityConstrained: true,
    expectedCapacityConstrainedCount: 88,
    expectedMatchCount: 9,
  },
};

function parsePositiveInteger(value, fallback, label) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} 必须是正整数。`);
  return parsed;
}

function resolveEndpoint() {
  const explicitEndpoint = process.env.EVENT_MATCH_URL;
  const configuredBaseUrl = process.env.EVENT_MATCH_BASE_URL;
  const raw = explicitEndpoint
    ?? (configuredBaseUrl ? new URL("/api/event-match", configuredBaseUrl).toString() : DEFAULT_ENDPOINT);
  const endpoint = new URL(raw);
  const isLocal = LOCAL_HOSTS.has(endpoint.hostname.toLowerCase()) || endpoint.hostname.toLowerCase().endsWith(".localhost");

  if (!isLocal && process.env.ALLOW_REMOTE_HTTP_SIMULATION !== "1") {
    throw new Error(
      `为避免误把 100 人模拟请求打到线上，默认只允许本机地址。当前地址为 ${endpoint.origin}。` +
      "如确实要测隔离的预发布环境，请显式设置 ALLOW_REMOTE_HTTP_SIMULATION=1。",
    );
  }
  if (!endpoint.pathname.endsWith("/api/event-match")) {
    throw new Error("EVENT_MATCH_URL 必须指向 /api/event-match。" );
  }
  return endpoint;
}

function resolveFixture() {
  const name = (process.env.EVENT_MATCH_FIXTURE || "balanced").trim().toLowerCase();
  const fixture = FIXTURES[name];
  if (!fixture) {
    throw new Error(`EVENT_MATCH_FIXTURE 仅支持：${Object.keys(FIXTURES).join("、")}。`);
  }
  return { name, ...fixture };
}

function createRequestGuests(roster) {
  return roster.map((guest) => ({
    id: guest.id,
    roles: guest.roles,
    stage: guest.stage,
    position: guest.position,
    needs: guest.needs,
    needDetail: guest.needDetail,
    offers: guest.offers,
    offerDetail: guest.offerDetail,
  }));
}

function responseMessage(raw, response) {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.error === "string") return parsed.error;
  } catch {
    // A reverse proxy may return HTML. Keep the error useful but concise.
  }
  return `${response.status} ${response.statusText}: ${raw.slice(0, 240).replace(/\s+/g, " ")}`;
}

function directPrecision(matches, guests) {
  const guestMap = new Map(guests.map((guest) => [guest.id, guest]));
  const directMatches = matches.filter((match) => Number(match.strength) >= 2);
  const validDirectMatches = directMatches.filter((match) => {
    const requester = guestMap.get(match.requesterId);
    const provider = guestMap.get(match.providerId);
    return requester && provider && (
      requester.expectedCohorts.includes(provider.cohort)
      || provider.expectedCohorts.includes(requester.cohort)
    );
  });
  return directMatches.length === 0 ? 0 : Math.round((validDirectMatches.length / directMatches.length) * 1000) / 10;
}

function assertResponse(payload, guests, minCoverageRate, connectionCap, expectations) {
  if (!payload || typeof payload !== "object") throw new Error("接口没有返回 JSON 对象。");
  if (!Array.isArray(payload.matches) || !payload.coverage || typeof payload.coverage !== "object") {
    throw new Error("接口响应缺少 matches 或 coverage；请确认部署的是支持 100 人覆盖指标的版本。");
  }

  const participantCount = guests.length;
  const expectedLimit = eventMatchLimit(participantCount);
  const coverage = payload.coverage;
  const ids = new Set(guests.map((guest) => guest.id));
  const degree = new Map();
  const pairs = new Set();

  if (payload.participantCount !== participantCount || coverage.participantCount !== participantCount) {
    throw new Error(`接口参与者数量不一致：期望 ${participantCount}，收到 ${payload.participantCount ?? coverage.participantCount}。`);
  }
  if (payload.matches.length > expectedLimit) {
    throw new Error(`接口返回了 ${payload.matches.length} 条关系，超过 ${participantCount} 人场次的关系上限 ${expectedLimit}。`);
  }

  for (const match of payload.matches) {
    if (!ids.has(match.requesterId) || !ids.has(match.providerId) || match.requesterId === match.providerId) {
      throw new Error("接口返回了不存在或自连接的嘉宾关系。");
    }
    const pair = [match.requesterId, match.providerId].sort().join("::");
    if (pairs.has(pair)) throw new Error(`接口返回了重复关系：${pair}`);
    pairs.add(pair);
    degree.set(match.requesterId, (degree.get(match.requesterId) || 0) + 1);
    degree.set(match.providerId, (degree.get(match.providerId) || 0) + 1);
  }

  const maxObservedConnections = Math.max(0, ...degree.values());
  if (maxObservedConnections > connectionCap) {
    throw new Error(`单位嘉宾的实际连接数为 ${maxObservedConnections}，超过上限 ${connectionCap}。`);
  }
  if (coverage.maximumConnectionsForOneGuest > connectionCap) {
    throw new Error(`接口覆盖指标中的最大连接数为 ${coverage.maximumConnectionsForOneGuest}，超过上限 ${connectionCap}。`);
  }
  if (coverage.connectedParticipantCount < Math.ceil(participantCount * minCoverageRate / 100)) {
    throw new Error(`覆盖率不足：${coverage.connectedParticipantCount}/${participantCount}，验收线为 ${minCoverageRate}%。`);
  }

  const unsupported = new Set(Array.isArray(coverage.unsupportedGuestIds) ? coverage.unsupportedGuestIds : []);
  const unconnected = Array.isArray(coverage.unconnectedGuestIds) ? coverage.unconnectedGuestIds : [];
  const capacityConstrained = unconnected
    .filter((id) => !unsupported.has(id));
  if (!expectations.allowCapacityConstrained && capacityConstrained.length > 0) {
    throw new Error(`存在有候选却未覆盖的嘉宾：${capacityConstrained.join("、")}`);
  }
  if (expectations.expectedUnsupportedCount !== undefined && unsupported.size !== expectations.expectedUnsupportedCount) {
    throw new Error(`无有效候选嘉宾数不符合预期：期望 ${expectations.expectedUnsupportedCount}，实际 ${unsupported.size}。`);
  }
  if (expectations.expectedUnconnectedCount !== undefined && unconnected.length !== expectations.expectedUnconnectedCount) {
    throw new Error(`未连接嘉宾数不符合预期：期望 ${expectations.expectedUnconnectedCount}，实际 ${unconnected.length}。`);
  }
  if (expectations.expectedCapacityConstrainedCount !== undefined && capacityConstrained.length !== expectations.expectedCapacityConstrainedCount) {
    throw new Error(`受供给/连接上限影响的嘉宾数不符合预期：期望 ${expectations.expectedCapacityConstrainedCount}，实际 ${capacityConstrained.length}。`);
  }
  if (expectations.expectedMatchCount !== undefined && payload.matches.length !== expectations.expectedMatchCount) {
    throw new Error(`匹配关系数不符合预期：期望 ${expectations.expectedMatchCount}，实际 ${payload.matches.length}。`);
  }
  const measuredDirectPrecision = directPrecision(payload.matches, guests);
  if (expectations.minDirectPrecision !== undefined && measuredDirectPrecision < expectations.minDirectPrecision) {
    throw new Error(`预设对口命中占比不足：验收线 ${expectations.minDirectPrecision}%，实际 ${measuredDirectPrecision}%。`);
  }
  return {
    coverage,
    expectedLimit,
    maxObservedConnections,
    capacityConstrainedCount: capacityConstrained.length,
    directPrecision: measuredDirectPrecision,
  };
}

async function main() {
  const endpoint = resolveEndpoint();
  const timeoutMs = parsePositiveInteger(process.env.EVENT_MATCH_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, "EVENT_MATCH_TIMEOUT_MS");
  const connectionCap = parsePositiveInteger(process.env.MAX_CONNECTIONS_PER_GUEST, EVENT_MATCH_DEFAULT_CONNECTION_CAP, "MAX_CONNECTIONS_PER_GUEST");
  const fixture = resolveFixture();
  const minCoverageRate = parsePositiveInteger(process.env.MIN_COVERAGE_RATE, fixture.minCoverageRate, "MIN_COVERAGE_RATE");
  const sourceGuests = fixture.createRoster();
  const guests = createRequestGuests(sourceGuests);
  if (guests.length !== 100) {
    throw new Error(`模拟样本必须恰好包含 100 位嘉宾，当前为 ${guests.length} 位。`);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();

  console.log(`发送 100 位合成嘉宾到 ${endpoint.origin}${endpoint.pathname}`);
  console.log(`模拟场景：${fixture.name}（${fixture.label}）`);
  console.log("说明：脚本只在内存中生成匿名测试数据，不创建用户、活动或签到数据；服务端会留下 1 条匿名 Agent 运行日志。 ");

  let response;
  let raw = "";
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ guests }),
      signal: controller.signal,
    });
    raw = await response.text();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`请求 ${endpoint.origin} 失败（${Math.round(performance.now() - startedAt)} ms）：${detail}`);
  } finally {
    clearTimeout(timeout);
  }

  const durationMs = Math.round(performance.now() - startedAt);
  if (!response.ok) throw new Error(`接口请求失败：${responseMessage(raw, response)}`);

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error(`接口返回的不是 JSON：${raw.slice(0, 240).replace(/\s+/g, " ")}`);
  }

  const result = assertResponse(payload, sourceGuests, minCoverageRate, connectionCap, fixture);
  const provider = payload.providerName || payload.model || payload.provider || "unknown";
  const degraded = payload.degraded === true || payload.provider === "local";
  console.table([{
    "参与嘉宾": guests.length,
    "模拟场景": fixture.name,
    "匹配关系": payload.matches.length,
    "连接嘉宾": `${result.coverage.connectedParticipantCount}/${guests.length} (${result.coverage.coverageRate}%)`,
    "最大单人连接": result.maxObservedConnections,
    "预设对口命中": `${result.directPrecision}%`,
    "关系上限": result.expectedLimit,
    "受限未连接": result.capacityConstrainedCount,
    "提供方": provider,
    "降级": degraded ? "是（本地规则）" : "否（模型参与）",
    "HTTP 耗时": `${durationMs} ms`,
  }]);

  if (process.env.REQUIRE_AGENT === "1" && degraded) {
    throw new Error("REQUIRE_AGENT=1，但本次请求已降级为本地规则。请检查模型平台、密钥和出网。" );
  }
  console.log("HTTP 模拟通过：覆盖率、关系上限、连接上限和无可避免孤岛均符合验收条件。");
}

main().catch((error) => {
  console.error(`HTTP 模拟失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
