/**
 * Anonymous, in-memory fixtures for exercising the Agent-first "find an
 * existing room, otherwise start one from the already-confirmed intent" flow. They are deliberately
 * not application records: no accounts, contact information, or database rows
 * are created by this fixture.
 */

export const GLOBAL_SIMULATION_NOW = "2026-07-24T12:00:00.000Z";

const channelScenarios = [
  {
    channel: "founder",
    label: "试合作",
    city: "上海",
    creatorIdentity: "项目发起人",
    creatorNeeds: ["工程实现"],
    creatorOffers: ["行业试点"],
    laterIdentity: "技术搭档",
    laterNeeds: ["真实试点"],
    laterOffers: ["工程实现"],
  },
  {
    channel: "play",
    label: "周末运动",
    city: "上海",
    creatorIdentity: "活动发起人",
    creatorNeeds: ["羽毛球玩伴"],
    creatorOffers: ["订场组织"],
    laterIdentity: "运动爱好者",
    laterNeeds: ["固定球局"],
    laterOffers: ["羽毛球经验"],
  },
  {
    channel: "love",
    label: "自然认识",
    city: "上海",
    creatorIdentity: "认真认识的人",
    creatorNeeds: ["自然认识"],
    creatorOffers: ["稳定见面意愿"],
    laterIdentity: "愿意慢慢相处的人",
    laterNeeds: ["认真关系"],
    laterOffers: ["稳定见面意愿"],
  },
  {
    channel: "jobs",
    label: "产品岗位沟通",
    city: "北京",
    creatorIdentity: "招聘方",
    creatorNeeds: ["产品负责人"],
    creatorOffers: ["岗位机会"],
    laterIdentity: "产品候选人",
    laterNeeds: ["产品岗位"],
    laterOffers: ["0到1产品能力"],
  },
  {
    channel: "capital",
    label: "种子轮交流",
    city: "深圳",
    creatorIdentity: "项目方",
    creatorNeeds: ["种子轮资金"],
    creatorOffers: ["早期项目进展"],
    laterIdentity: "早期投资方",
    laterNeeds: ["种子项目"],
    laterOffers: ["早期投资判断"],
  },
  {
    channel: "travel",
    label: "周末短途旅行",
    city: "成都",
    creatorIdentity: "行程发起人",
    creatorNeeds: ["旅行同行者"],
    creatorOffers: ["路线规划"],
    laterIdentity: "旅行爱好者",
    laterNeeds: ["短途出发计划"],
    laterOffers: ["公共交通安排"],
  },
];

function inFuture(days = 14) {
  return new Date(new Date(GLOBAL_SIMULATION_NOW).getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

function inPast(days = 1) {
  return new Date(new Date(GLOBAL_SIMULATION_NOW).getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function user({
  id,
  channel,
  city,
  identity,
  offerTags,
  searchKey,
  needTags,
  intentOfferTags,
  matchOptIn = true,
  expiresAt = inFuture(),
  hardConstraints = {},
  blockedUserIds = [],
  kind,
  expectedCreatorId,
}) {
  return {
    id,
    kind,
    expectedCreatorId,
    channel,
    profile: {
      city,
      identity,
      offerTags,
      matchOptIn,
      blockedUserIds,
    },
    intent: {
      status: "confirmed",
      title: `${searchKey} · 合成测试意图`,
      summary: "只用于本地 Agent 流程验收的匿名样本。",
      searchKey,
      needTags,
      offerTags: intentOfferTags,
      expiresAt,
      hardConstraints: {
        sameCity: true,
        ...hardConstraints,
      },
    },
  };
}

/**
 * 36 成对的独立用户：前一位确认意图后在没有适配局时由 Agent 发起，后一位在
 * 不同会话中搜索到这个新局。其余 28 位专门覆盖隐私、过期、资料和
 * 硬边界保护。总数固定为 100。
 */
export function createGlobalAgentFixture() {
  const creators = [];
  const laterUsers = [];

  for (let index = 0; index < 36; index += 1) {
    const scenario = channelScenarios[index % channelScenarios.length];
    const serial = String(index + 1).padStart(2, "0");
    const searchKey = `${scenario.channel}-${serial}-${scenario.label}`;
    const creatorId = `global-creator-${serial}`;
    creators.push(user({
      id: creatorId,
      kind: "creator",
      channel: scenario.channel,
      city: scenario.city,
      identity: scenario.creatorIdentity,
      offerTags: scenario.creatorOffers,
      searchKey,
      needTags: scenario.creatorNeeds,
      intentOfferTags: scenario.creatorOffers,
    }));
    laterUsers.push(user({
      id: `global-later-${serial}`,
      kind: "later_discovery",
      expectedCreatorId: creatorId,
      channel: scenario.channel,
      city: scenario.city,
      identity: scenario.laterIdentity,
      offerTags: scenario.laterOffers,
      searchKey,
      needTags: scenario.laterNeeds,
      intentOfferTags: scenario.laterOffers,
    }));
  }

  const optOutUsers = Array.from({ length: 6 }, (_, index) => {
    const scenario = channelScenarios[index % channelScenarios.length];
    return user({
      id: `global-optout-${String(index + 1).padStart(2, "0")}`,
      kind: "opt_out",
      channel: scenario.channel,
      city: scenario.city,
      identity: "未授权发现的匿名用户",
      offerTags: scenario.creatorOffers,
      searchKey: `optout-${scenario.channel}-${index + 1}`,
      needTags: scenario.creatorNeeds,
      intentOfferTags: scenario.creatorOffers,
      matchOptIn: false,
    });
  });

  const expiredUsers = Array.from({ length: 6 }, (_, index) => {
    const scenario = channelScenarios[index % channelScenarios.length];
    return user({
      id: `global-expired-${String(index + 1).padStart(2, "0")}`,
      kind: "expired",
      channel: scenario.channel,
      city: scenario.city,
      identity: "过期意图的匿名用户",
      offerTags: scenario.creatorOffers,
      searchKey: `expired-${scenario.channel}-${index + 1}`,
      needTags: scenario.creatorNeeds,
      intentOfferTags: scenario.creatorOffers,
      expiresAt: inPast(),
    });
  });

  const incompleteUsers = Array.from({ length: 6 }, (_, index) => {
    const scenario = channelScenarios[index % channelScenarios.length];
    return user({
      id: `global-incomplete-${String(index + 1).padStart(2, "0")}`,
      kind: "incomplete",
      channel: scenario.channel,
      city: scenario.city,
      identity: "待补充资料的匿名用户",
      offerTags: [],
      searchKey: "",
      needTags: [],
      intentOfferTags: [],
    });
  });

  const hardConflictUsers = Array.from({ length: 5 }, (_, index) => {
    const creator = creators[index];
    return user({
      id: `global-city-conflict-${String(index + 1).padStart(2, "0")}`,
      kind: "hard_conflict",
      expectedCreatorId: creator.id,
      channel: creator.channel,
      city: "异地",
      identity: "有明确同城边界的匿名用户",
      offerTags: ["互补能力"],
      searchKey: creator.intent.searchKey,
      needTags: ["同城见面"],
      intentOfferTags: ["互补能力"],
      hardConstraints: { sameCity: true },
    });
  });

  const blockedUsers = Array.from({ length: 5 }, (_, index) => {
    const creator = creators[index + 5];
    return user({
      id: `global-blocked-${String(index + 1).padStart(2, "0")}`,
      kind: "blocked",
      expectedCreatorId: creator.id,
      channel: creator.channel,
      city: creator.profile.city,
      identity: "已设置屏蔽关系的匿名用户",
      offerTags: ["互补能力"],
      searchKey: creator.intent.searchKey,
      needTags: ["已知方向"],
      intentOfferTags: ["互补能力"],
      blockedUserIds: [creator.id],
    });
  });

  const users = [
    ...creators,
    ...laterUsers,
    ...optOutUsers,
    ...expiredUsers,
    ...incompleteUsers,
    ...hardConflictUsers,
    ...blockedUsers,
  ];

  if (users.length !== 100) throw new Error(`全局 Agent 测试夹具必须有 100 位用户，实际为 ${users.length}。`);
  return { users, creators, laterUsers, optOutUsers, expiredUsers, incompleteUsers, hardConflictUsers, blockedUsers };
}

export function hasContactLikeValue(value) {
  const serialized = JSON.stringify(value).toLowerCase();
  return /(?:[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|\b(?:wxid|wechat)\b|\b1[3-9]\d{9}\b)/i.test(serialized);
}
