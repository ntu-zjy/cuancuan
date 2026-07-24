import assert from "node:assert/strict";
import {
  createGlobalAgentFixture,
  GLOBAL_SIMULATION_NOW,
  hasContactLikeValue,
} from "./global-agent-fixtures.mjs";

const now = new Date(GLOBAL_SIMULATION_NOW);

function isExpired(intent) {
  return new Date(intent.expiresAt).getTime() <= now.getTime();
}

function hasEnoughContext(user) {
  return Boolean(
    user.intent.status === "confirmed"
    && user.intent.searchKey
    && user.intent.needTags.length > 0
    && user.profile.offerTags.length > 0,
  );
}

function sameCity(user, room) {
  if (!user.intent.hardConstraints.sameCity) return true;
  return user.profile.city === room.city;
}

function safeRoom(room) {
  return {
    id: room.id,
    channel: room.channel,
    city: room.city,
    title: room.title,
    summary: room.summary,
    needTags: [...room.needTags],
    offerTags: [...room.offerTags],
    expiresAt: room.expiresAt,
    memberLimit: room.memberLimit,
  };
}

function publicUser(user) {
  return {
    id: user.id,
    channel: user.channel,
    profile: {
      city: user.profile.city,
      identity: user.profile.identity,
      offerTags: [...user.profile.offerTags],
      matchOptIn: user.profile.matchOptIn,
    },
    intent: {
      status: user.intent.status,
      title: user.intent.title,
      summary: user.intent.summary,
      searchKey: user.intent.searchKey,
      needTags: [...user.intent.needTags],
      offerTags: [...user.intent.offerTags],
      expiresAt: user.intent.expiresAt,
      hardConstraints: { ...user.intent.hardConstraints },
    },
  };
}

/**
 * An in-memory boundary around the tools that an Agent would be allowed to use.
 * The Agent never sees owner IDs, block lists, or contact fields.  The test
 * intentionally keeps this separate from the app/database so it cannot create
 * test users or rooms in any real environment.
 */
export function createInMemoryAgentTools(users) {
  const userById = new Map(users.map((user) => [user.id, user]));
  const rooms = [];
  const traces = [];
  const latestSearch = new Map();
  let roomCounter = 0;

  function record(user, tool, input, output) {
    traces.push({
      userId: user.id,
      tool,
      input: structuredClone(input),
      output: structuredClone(output),
    });
  }

  function userEligibility(user) {
    if (!user.profile.matchOptIn) return "discovery_opt_out";
    if (isExpired(user.intent)) return "intent_expired";
    if (!hasEnoughContext(user)) return "need_more_context";
    return null;
  }

  function pairBlocked(requester, room) {
    const owner = userById.get(room.ownerId);
    if (!owner) return true;
    return requester.profile.blockedUserIds.includes(room.ownerId)
      || owner.profile.blockedUserIds.includes(requester.id);
  }

  function searchRooms(user, input) {
    const eligibility = userEligibility(user);
    if (input.channel !== user.channel) {
      const output = { status: "channel_locked", rooms: [] };
      record(user, "search_rooms", input, output);
      return output;
    }
    if (eligibility) {
      const output = { status: eligibility, rooms: [] };
      record(user, "search_rooms", input, output);
      return output;
    }
    const found = rooms
      .filter((room) => room.channel === user.channel)
      .filter((room) => room.searchKey === input.searchKey)
      .filter((room) => room.ownerId !== user.id)
      .filter((room) => new Date(room.expiresAt).getTime() > now.getTime())
      .filter((room) => sameCity(user, room))
      .filter((room) => !pairBlocked(user, room))
      .slice(0, 4);
    const output = { status: "ok", rooms: found.map(safeRoom) };
    latestSearch.set(user.id, {
      channel: input.channel,
      searchKey: input.searchKey,
      resultCount: found.length,
    });
    record(user, "search_rooms", input, output);
    return output;
  }

  function createRoom(user, input) {
    const eligibility = userEligibility(user);
    if (input.channel !== user.channel) {
      const output = { status: "channel_locked" };
      record(user, "create_room", input, output);
      return output;
    }
    if (eligibility) {
      const output = { status: eligibility };
      record(user, "create_room", input, output);
      return output;
    }
    if (hasContactLikeValue(input)) {
      const output = { status: "sensitive_contact_rejected" };
      record(user, "create_room", input, output);
      return output;
    }
    const previousSearch = latestSearch.get(user.id);
    if (!previousSearch
      || previousSearch.channel !== input.channel
      || previousSearch.searchKey !== input.searchKey) {
      const output = { status: "search_required" };
      record(user, "create_room", input, output);
      return output;
    }
    if (previousSearch.resultCount > 0) {
      const output = { status: "existing_room_found" };
      record(user, "create_room", input, output);
      return output;
    }
    const existing = rooms.find((room) => (
      room.ownerId === user.id
      && room.channel === input.channel
      && room.searchKey === input.searchKey
      && new Date(room.expiresAt).getTime() > now.getTime()
    ));
    if (existing) {
      const output = { status: "idempotent", room: safeRoom(existing) };
      record(user, "create_room", input, output);
      return output;
    }
    const room = {
      id: `sim-room-${String(++roomCounter).padStart(3, "0")}`,
      ownerId: user.id,
      channel: input.channel,
      city: user.profile.city,
      title: user.intent.title,
      summary: user.intent.summary,
      searchKey: user.intent.searchKey,
      needTags: [...user.intent.needTags],
      offerTags: [...user.intent.offerTags],
      expiresAt: user.intent.expiresAt,
      memberLimit: input.memberLimit,
    };
    rooms.push(room);
    const output = { status: "created", room: safeRoom(room) };
    record(user, "create_room", input, output);
    return output;
  }

  return {
    rooms,
    traces,
    toolsFor(user) {
      return {
        search_rooms: (input) => searchRooms(user, input),
        create_room: (input) => createRoom(user, input),
      };
    },
  };
}

/** Default decision used in this test; callers can replace it with any mocked model decision. */
export async function defaultMockDecision({ user, tools }) {
  const search = await tools.search_rooms({
    channel: user.channel,
    searchKey: user.intent.searchKey,
  });
  if (search.status !== "ok") {
    return {
      outcome: "not_eligible",
      reason: search.status,
      toolCalls: ["search_rooms"],
    };
  }
  if (search.rooms.length > 0) {
    const room = search.rooms[0];
    return {
      outcome: "recommended",
      roomId: room.id,
      reason: `你可带来“${user.profile.offerTags[0]}”，这个局正在找“${room.needTags[0]}”。`,
      toolCalls: ["search_rooms"],
    };
  }
  const creation = await tools.create_room({
    channel: user.channel,
    searchKey: user.intent.searchKey,
    title: user.intent.title,
    memberLimit: user.channel === "play" ? 6 : 3,
  });
  return {
    outcome: creation.status,
    roomId: creation.room?.id,
    reason: creation.status === "created"
      ? "未发现符合当前边界的公开局，已按已确认意图发起一个新局。"
      : creation.status,
    toolCalls: ["search_rooms", "create_room"],
  };
}

/**
 * This is the injection seam for a real test double or a future model adapter.
 * It deliberately gives the decision function only sanitized user data and
 * bounded tools, never direct room storage or other users' profiles.
 */
export async function runAgentJourney({ user, runtime, decide = defaultMockDecision }) {
  return decide({ user: publicUser(user), tools: runtime.toolsFor(user) });
}

function testToolBoundaries(fixture) {
  const runtime = createInMemoryAgentTools(fixture.users);
  const creator = fixture.creators[0];
  const tools = runtime.toolsFor(creator);

  const noSearch = tools.create_room({
    channel: creator.channel,
    searchKey: creator.intent.searchKey,
    title: creator.intent.title,
    memberLimit: 3,
  });
  assert.equal(noSearch.status, "search_required", "Agent 必须先 search_rooms 才能 create_room。");

  const crossChannel = tools.search_rooms({
    channel: "love",
    searchKey: creator.intent.searchKey,
  });
  assert.equal(crossChannel.status, "channel_locked", "工具不得让 Agent 跨关系空间搜索。");
  assert.equal(crossChannel.rooms.length, 0, "跨频道搜索不得返回任何局。");

  const search = tools.search_rooms({
    channel: creator.channel,
    searchKey: creator.intent.searchKey,
  });
  assert.equal(search.rooms.length, 0, "隔离测试开局不应预置候选局。");
  const unsafeContact = `safety${"@"}invalid.test`;
  const contactAttempt = tools.create_room({
    channel: creator.channel,
    searchKey: creator.intent.searchKey,
    title: creator.intent.title,
    memberLimit: 3,
    arbitraryField: unsafeContact,
  });
  assert.equal(contactAttempt.status, "sensitive_contact_rejected", "工具必须拒绝模型尝试写入联系方式。");
  assert.equal(runtime.rooms.length, 0, "被拒绝的请求不得创建局。");
}

async function runMainSimulation() {
  const fixture = createGlobalAgentFixture();
  testToolBoundaries(fixture);
  const runtime = createInMemoryAgentTools(fixture.users);
  const outcomes = new Map();

  for (const user of fixture.users) {
    outcomes.set(user.id, await runAgentJourney({ user, runtime }));
  }

  const createdByOwner = new Map(runtime.rooms.map((room) => [room.ownerId, room]));
  const expectedCreatedRooms = fixture.creators.length
    + fixture.hardConflictUsers.length
    + fixture.blockedUsers.length;
  assert.equal(runtime.rooms.length, expectedCreatedRooms, "确认意图且没有合适现有局的用户应各创建一个局。");
  assert.equal(new Set(runtime.rooms.map((room) => room.id)).size, runtime.rooms.length, "不得出现重复局 ID。");
  assert.equal(new Set(runtime.rooms.map((room) => `${room.ownerId}:${room.searchKey}`)).size, runtime.rooms.length, "同一用户同一意图不得重复建局。");

  for (const creator of fixture.creators) {
    assert.equal(outcomes.get(creator.id)?.outcome, "created", `${creator.id} 应在没有候选时发起新局。`);
    assert.ok(createdByOwner.get(creator.id), `${creator.id} 的新局不存在。`);
  }

  for (const later of fixture.laterUsers) {
    const result = outcomes.get(later.id);
    const expectedRoom = createdByOwner.get(later.expectedCreatorId);
    assert.equal(result?.outcome, "recommended", `${later.id} 应搜索到先前用户发起的新局。`);
    assert.equal(result?.roomId, expectedRoom?.id, `${later.id} 不应被引到其他用户或跨频道的局。`);
    assert.match(result?.reason || "", /可带来|正在找/, "推荐必须给出具体互补理由。");
  }

  for (const user of fixture.optOutUsers) {
    assert.equal(outcomes.get(user.id)?.reason, "discovery_opt_out", "未授权发现的用户不得进入匹配或发起流程。");
  }
  for (const user of fixture.expiredUsers) {
    assert.equal(outcomes.get(user.id)?.reason, "intent_expired", "过期意图不得继续发现或发起新局。");
  }
  for (const user of fixture.incompleteUsers) {
    assert.equal(outcomes.get(user.id)?.reason, "need_more_context", "资料不足时 Agent 应先补充，而非硬凑或建局。");
  }
  for (const user of fixture.hardConflictUsers) {
    const result = outcomes.get(user.id);
    assert.notEqual(result?.outcome, "recommended", "同城硬边界冲突时不得推荐已有局。");
    assert.equal(result?.outcome, "created", "没有满足同城边界的局时，Agent 应基于已确认意图发起新局。");
  }
  for (const user of fixture.blockedUsers) {
    const result = outcomes.get(user.id);
    assert.notEqual(result?.outcome, "recommended", "已屏蔽关系不得被 Agent 推荐。 ");
    assert.equal(result?.outcome, "created", "不能推荐已屏蔽关系时，Agent 应为当前确认意图发起新局。");
  }

  const replayOutcomes = [];
  for (const creator of fixture.creators) {
    replayOutcomes.push(await runAgentJourney({ user: creator, runtime }));
  }
  assert.ok(replayOutcomes.every((result) => result.outcome === "idempotent"), "同一已确认意图重试必须复用原局。 ");
  assert.equal(runtime.rooms.length, expectedCreatedRooms, "重试不得产生重复局。 ");

  // This duplicate probe represents a later confirmed intent whose preceding
  // search already found a suitable room.
  const duplicateProbeUser = fixture.laterUsers[0];
  const duplicateProbe = await runAgentJourney({
    user: duplicateProbeUser,
    runtime,
    decide: async ({ user, tools }) => {
      const search = await tools.search_rooms({ channel: user.channel, searchKey: user.intent.searchKey });
      assert.ok(search.rooms.length > 0, "重复建局探针应先发现已有局。");
      return {
        outcome: (await tools.create_room({
          channel: user.channel,
          searchKey: user.intent.searchKey,
          title: user.intent.title,
          memberLimit: 3,
        })).status,
      };
    },
  });
  assert.equal(duplicateProbe.outcome, "existing_room_found", "模型即便忽略搜索结果，也不得基于已有候选重复建局。 ");
  assert.equal(runtime.rooms.length, expectedCreatedRooms, "重复建局探针不得改变局数量。 ");

  for (const room of runtime.rooms) {
    assert.equal(hasContactLikeValue(room), false, "内存新局不得携带联系方式。 ");
    assert.ok(fixture.users.some((user) => user.id === room.ownerId), "只有已确认且符合工具边界的合成用户可以创建局。");
  }
  for (const trace of runtime.traces) {
    assert.equal(hasContactLikeValue(trace.output), false, "Agent 工具输出不得含联系方式。 ");
  }

  const traceByUser = new Map();
  for (const trace of runtime.traces) {
    const entries = traceByUser.get(trace.userId) || [];
    entries.push(trace);
    traceByUser.set(trace.userId, entries);
  }
  for (const [userId, traces] of traceByUser) {
    const createIndex = traces.findIndex((trace) => trace.tool === "create_room");
    if (createIndex >= 0) {
      const searchIndex = traces.findIndex((trace) => trace.tool === "search_rooms");
      assert.ok(searchIndex >= 0 && searchIndex < createIndex, `${userId} 的 create_room 必须发生在 search_rooms 之后。`);
    }
  }

  const counter = (kind) => fixture.users.filter((user) => user.kind === kind).length;
  const summary = {
    users: fixture.users.length,
    initialCreatedRooms: expectedCreatedRooms,
    laterUsersDiscoveringNewRoom: fixture.laterUsers.length,
    optOutProtected: counter("opt_out"),
    expiredProtected: counter("expired"),
    incompleteDeferred: counter("incomplete"),
    hardConflictsRejected: counter("hard_conflict"),
    blockedRelationshipsRejected: counter("blocked"),
    toolCalls: runtime.traces.length,
  };
  return summary;
}

runMainSimulation().then((summary) => {
  console.log("\n100 位独立注册用户的 Agent-first 全局流程模拟通过：");
  console.table([{
    "合成用户": summary.users,
    "无候选后新建局": summary.initialCreatedRooms,
    "后来用户发现新局": summary.laterUsersDiscoveringNewRoom,
    "未授权发现保护": summary.optOutProtected,
    "过期意图保护": summary.expiredProtected,
    "资料不足先补充": summary.incompleteDeferred,
    "硬边界不推荐": summary.hardConflictsRejected,
    "屏蔽关系不推荐": summary.blockedRelationshipsRejected,
    "受控工具调用": summary.toolCalls,
  }]);
  console.log("验收范围：同频道、无敏感联系方式、确认意图后先搜索再自主发起、同意图幂等、已有局不重复创建。\n");
}).catch((error) => {
  console.error(`全局 Agent 模拟失败：${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exitCode = 1;
});
