import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      const isRelativeWithoutExtension = specifier.startsWith(".") && path.extname(specifier) === "";
      if (!isRelativeWithoutExtension) throw error;
      return nextResolve(`${specifier}.ts`, context);
    }
  },
});

const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "cuancuan-agent-db-"));
process.env.DATABASE_PATH = path.join(temporaryDirectory, "integration.db");

let database;

function futureIso(hoursFromNow) {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
}

function makeIntent(label, target, offer) {
  return {
    title: `${label}的合作意图`,
    summary: `${label}希望基于真实需求找到可以一起行动的人。`,
    scene: "startup",
    channel: "founder",
    target,
    context: "优先在上海线下见面，先完成一次小范围试合作。",
    offer,
    commitment: "未来两周每周可以投入 6 小时。",
    constraints: "先验证合作节奏，不要求立即建立长期关系。",
    validity: "一个月",
    status: "active",
  };
}

function makeRoomProposal() {
  return {
    type: "合作试跑局",
    title: "AI 产品首轮用户验证搭档局",
    summary: "两周内组成一个小组，完成 10 位真实用户的首轮验证。",
    description: "适合已有明确产品方向，愿意用两周完成访谈、原型调整和复盘的人。",
    tags: ["AI 产品", "用户验证", "上海"],
    minMembers: 2,
    maxMembers: 4,
    startsAt: futureIso(72),
    endsAt: futureIso(74),
    registrationDeadline: futureIso(48),
    cancellationDeadline: futureIso(48),
    city: "上海",
    venue: "静安共创空间",
    address: "报名确认后开放详细地址",
    price: {
      type: "free",
      note: "场地由发起人承担",
    },
    registrationMode: "approval",
    agenda: [
      "每人介绍正在验证的问题",
      "确认两周试跑目标与分工",
      "约定下一次复盘时间",
    ],
    notices: ["请带上当前原型或流程图", "不交换联系方式，确认加入后使用局内沟通"],
    reason: "现有公开局没有覆盖这次具体的验证目标，因此由 Agent 发起新的招募。",
    observation: "当前意图中既有产品方向，也有明确时间投入和试跑边界。",
    trialPlan: {
      objective: "两周内共同完成 10 位真实用户访谈和一次结果复盘。",
      roles: ["产品发起人", "原型与工程搭档", "用户研究搭档"],
      deadline: futureIso(24 * 14),
      completionCriteria: "形成访谈记录、改版原型和是否继续合作的共同结论。",
    },
  };
}

try {
  const {
    createAgentRoomForIntent,
    deleteAgentMatchIntent,
    getDatabase,
    listAgentIntentCandidates,
    listEventsForUser,
    registerOrLoginUser,
    saveAgentMatchIntent,
    setAgentMatchIntentEnabled,
    updateUserProfile,
  } = await import("../lib/database.ts");

  database = getDatabase();

  function registerUser(email, nickname, profile = {}) {
    const user = registerOrLoginUser({
      mode: "register",
      email,
      nickname,
      inviteCode: "CUANCUAN2026",
    });
    return updateUserProfile({
      id: user.id,
      nickname,
      avatar: user.avatar,
      city: profile.city || "上海",
      identity: profile.identity || "独立产品经理",
      skills: profile.skills || "产品设计、用户研究",
      offer: profile.offer || "可以提供用户访谈和原型设计",
      bio: profile.bio || "正在验证一个 AI 协作产品。",
      wechat: profile.wechat || "",
    });
  }

  const requester = registerUser("requester@example.test", "发起人");
  const activeEngineer = registerUser("engineer@example.test", "工程候选人", {
    identity: "全栈工程师",
    skills: "Next.js、Node.js、快速原型",
    offer: "可以在两周内完成可测试原型",
    bio: "微信号 vx: engineer_demo，邮箱 engineer@example.test",
    wechat: "engineer_demo",
  });
  const activeResearcher = registerUser("researcher@example.test", "研究候选人", {
    identity: "用户研究员",
    skills: "访谈设计、可用性测试",
    offer: "可以组织访谈并整理洞察",
    bio: "电话 13800138000",
  });
  const pausedCandidate = registerUser("paused@example.test", "暂停候选人");
  const exitedCandidate = registerUser("exited@example.test", "退出候选人");

  const requesterIntent = saveAgentMatchIntent({
    userId: requester.id,
    channel: "founder",
    intent: makeIntent("发起人", "寻找工程和用户研究搭档", "提供产品方向与首批测试用户"),
  });
  saveAgentMatchIntent({
    userId: activeEngineer.id,
    channel: "founder",
    intent: makeIntent(
      "工程候选人",
      "寻找有真实用户需求的 AI 产品方向，微信 engineer_demo",
      "提供全栈原型开发，联系 engineer@example.test",
    ),
  });
  saveAgentMatchIntent({
    userId: activeResearcher.id,
    channel: "founder",
    intent: makeIntent("研究候选人", "寻找需要首轮用户验证的产品", "提供访谈设计与研究复盘"),
  });
  saveAgentMatchIntent({
    userId: pausedCandidate.id,
    channel: "founder",
    intent: makeIntent("暂停候选人", "寻找产品搭档", "提供渠道资源"),
  });
  saveAgentMatchIntent({
    userId: exitedCandidate.id,
    channel: "founder",
    intent: makeIntent("退出候选人", "寻找产品搭档", "提供设计能力"),
  });

  setAgentMatchIntentEnabled({
    userId: pausedCandidate.id,
    channel: "founder",
    enabled: false,
  });
  deleteAgentMatchIntent(exitedCandidate.id, "founder");

  const candidates = listAgentIntentCandidates({
    userId: requester.id,
    channel: "founder",
    limit: 20,
  });
  assert.equal(candidates.length, 2, "候选池只应包含仍主动参与匹配的两位用户");
  assert.deepEqual(
    new Set(candidates.map((candidate) => candidate.candidateId)),
    new Set([activeEngineer.id, activeResearcher.id]),
    "暂停和退出的用户不能出现在候选池中",
  );

  const candidatePayload = JSON.stringify(candidates);
  assert.doesNotMatch(candidatePayload, /engineer@example\.test/i, "候选池不能暴露邮箱");
  assert.doesNotMatch(candidatePayload, /13800138000/, "候选池不能暴露手机号");
  assert.doesNotMatch(candidatePayload, /engineer_demo/i, "候选池不能暴露微信号");
  for (const candidate of candidates) {
    assert.equal("email" in candidate.profile, false, "匿名候选资料不应包含 email 字段");
    assert.equal("wechat" in candidate.profile, false, "匿名候选资料不应包含 wechat 字段");
    assert.equal("nickname" in candidate.profile, false, "匿名候选资料不应包含 nickname 字段");
  }

  assert.throws(
    () => listAgentIntentCandidates({
      userId: pausedCandidate.id,
      channel: "founder",
    }),
    /请先确认当前关系空间的匹配意图/,
    "暂停匹配的用户不能继续扫描候选池",
  );

  const firstCreation = createAgentRoomForIntent({
    userId: requester.id,
    channel: "founder",
    intent: requesterIntent.intent,
    proposal: makeRoomProposal(),
  });
  const retryCreation = createAgentRoomForIntent({
    userId: requester.id,
    channel: "founder",
    intent: requesterIntent.intent,
    proposal: makeRoomProposal(),
  });

  assert.equal(firstCreation.created, true, "首次执行 Agent 建局工具应创建新局");
  assert.equal(retryCreation.created, false, "同一确认意图重试时不应重复建局");
  assert.equal(retryCreation.event.id, firstCreation.event.id, "幂等重试必须返回同一个局");

  const creationRows = database.prepare(`
    SELECT count(*) AS count
    FROM agent_room_creations
    WHERE user_id = ? AND intent_id = ?
  `).get(requester.id, requesterIntent.id);
  assert.equal(Number(creationRows.count), 1, "同一确认意图只能产生一条 Agent 建局记录");

  const ownerView = listEventsForUser(requester.id)
    .find((event) => event.id === firstCreation.event.id);
  assert.ok(ownerView, "发起人应能看到 Agent 创建的新局");
  assert.equal(ownerView.isHost, true, "发起人应被标记为新局 Host");
  assert.equal(ownerView.registration?.status, "confirmed", "发起人应自动成为已确认成员");

  const lateUser = registerUser("late-user@example.test", "后来用户", {
    city: "杭州",
    identity: "AI 产品设计师",
  });
  const lateUserView = listEventsForUser(lateUser.id)
    .find((event) => event.id === firstCreation.event.id);
  assert.ok(lateUserView, "后续注册用户应能通过 listEventsForUser 发现 Agent 创建的公开新局");
  assert.equal(lateUserView.isHost, false, "后来用户不能被误识别为发起人");
  assert.equal(lateUserView.registration, undefined, "发现公开局不应自动替后来用户报名");
  assert.equal(lateUserView.channel, "founder", "新局应保留原始关系空间");
  assert.equal(lateUserView.visibility, "public", "Agent 创建的新局应进入公开招募");

  console.table([{
    "注册用户": 6,
    "有效匿名候选": candidates.length,
    "暂停用户已排除": !candidates.some((candidate) => candidate.candidateId === pausedCandidate.id),
    "退出用户已排除": !candidates.some((candidate) => candidate.candidateId === exitedCandidate.id),
    "首次建局": firstCreation.created,
    "幂等重试未重复": !retryCreation.created,
    "后来用户可发现": Boolean(lateUserView),
  }]);
  console.log(`SQLite 集成验收通过：${process.env.DATABASE_PATH}`);
} finally {
  database?.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
