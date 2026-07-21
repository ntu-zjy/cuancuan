import type { Channel, Opportunity, Scene } from "./types";

export type ChannelConfig = {
  id: Channel;
  path: string;
  name: string;
  shortName: string;
  eyebrow: string;
  headline: string;
  lead: string;
  agentName: string;
  agentRole: string;
  chatHeadline: string;
  welcome: string;
  composerPlaceholder: string;
  discoverLabel: string;
  opportunityLabel: string;
  scene: Scene;
  availability: "open" | "partner" | "preview";
  availabilityLabel: string;
  starters: Array<{ label: string; text: string }>;
  entryPoints: Array<{ label: string; text: string }>;
};

export const DEFAULT_CHANNEL: Channel = "founder";

export const CHANNELS: Record<Channel, ChannelConfig> = {
  founder: {
    id: "founder",
    path: "/founder",
    name: "攒攒合作伙伴",
    shortName: "合作伙伴",
    eyebrow: "AI 创业合作顾问",
    headline: "想找合伙人，\n还是先找人试着做？",
    lead: "说说项目做到哪一步、现在缺什么人、你能提供什么。攒攒帮你找值得先聊，或一起试做两周的伙伴。",
    agentName: "攒攒合作伙伴",
    agentRole: "AI 创业合作顾问",
    chatHeadline: "你想先找到怎样的合作伙伴？",
    welcome: "你好，我是攒攒合作伙伴。你是已经有项目，还是正在找值得加入的项目？可以从现在最想解决的问题说起。",
    composerPlaceholder: "说说项目、阶段，或你想找的合作伙伴…",
    discoverLabel: "合作局",
    opportunityLabel: "合作局",
    scene: "startup",
    availability: "open",
    availabilityLabel: "正在内测",
    starters: [
      { label: "找合伙人", text: "我有一个正在验证的项目，想找一位能长期走下去的合伙人。目前……" },
      { label: "找早期成员", text: "我正在组建早期团队，最缺的关键角色是……我们能提供……" },
      { label: "找试合作", text: "我不急着谈长期合作，想先找人用两周一起完成……" },
    ],
    entryPoints: [
      { label: "目标", text: "正在做什么，准备走到哪一步" },
      { label: "缺口", text: "现在最需要补上的角色或能力" },
      { label: "投入", text: "双方愿意怎样开始和验证配合" },
    ],
  },
  play: {
    id: "play",
    path: "/play",
    name: "攒攒玩伴",
    shortName: "玩伴",
    eyebrow: "AI 组局助手",
    headline: "这周想去哪玩？\n攒攒帮你找搭子。",
    lead: "打球、看展、吃饭、桌游都可以。告诉时间、地点和大概人数，攒攒帮你凑到合适的人。",
    agentName: "攒攒玩伴",
    agentRole: "AI 组局助手",
    chatHeadline: "这次你想攒一个什么局？",
    welcome: "你好，我是攒攒玩伴。你最近想做什么、什么时候有空、希望几个人一起？先说一件这两周真的想发生的事。",
    composerPlaceholder: "说说这周想做什么、何时、在哪…",
    discoverLabel: "发现活动",
    opportunityLabel: "活动局",
    scene: "love",
    availability: "preview",
    availabilityLabel: "体验预览",
    starters: [
      { label: "周末运动", text: "这周末我想找人一起运动，项目和大概水平是……" },
      { label: "看展散步", text: "我想找两三个人轻松看展或散步，时间和区域是……" },
      { label: "吃饭桌游", text: "我想攒一个不尴尬的小饭局或桌游局，希望氛围……" },
    ],
    entryPoints: [
      { label: "想做什么", text: "一件近期真的想发生的活动" },
      { label: "何时何地", text: "时间与生活半径能真正对上" },
      { label: "相处氛围", text: "认真活动还是轻松认识新朋友" },
    ],
  },
  love: {
    id: "love",
    path: "/love",
    name: "攒攒相亲",
    shortName: "相亲",
    eyebrow: "AI 关系匹配顾问",
    headline: "想认真认识一个人？\n先说说你想要怎样的关系。",
    lead: "攒攒会先了解你想要的关系、所在城市和相处节奏，再帮你找双方都愿意见面的人。",
    agentName: "攒攒相亲",
    agentRole: "AI 关系匹配顾问",
    chatHeadline: "你想进入一段怎样的关系？",
    welcome: "你好，我是攒攒关系匹配顾问。比起一张条件清单，我更想先理解你期待怎样的关系，以及怎样开始会让你舒服。",
    composerPlaceholder: "说说你期待的关系与相处节奏…",
    discoverLabel: "认识新局",
    opportunityLabel: "认识局",
    scene: "love",
    availability: "partner",
    availabilityLabel: "合作测试",
    starters: [
      { label: "认真恋爱", text: "我希望认真进入一段有长期可能的关系，对我来说重要的是……" },
      { label: "自然认识", text: "我希望先从低压力的见面开始，再慢慢了解彼此。我更舒服的方式是……" },
      { label: "边界优先", text: "在认识一个人以前，我最希望先说清楚的边界和现实条件是……" },
    ],
    entryPoints: [
      { label: "关系目标", text: "约会、稳定恋爱或婚姻期待" },
      { label: "现实计划", text: "城市、生活节奏与未来安排" },
      { label: "相处方式", text: "希望怎样认识，以及不能忽略的边界" },
    ],
  },
  jobs: {
    id: "jobs",
    path: "/jobs",
    name: "攒攒招聘",
    shortName: "招聘",
    eyebrow: "AI 双向职业顾问",
    headline: "你在招人，\n还是在找工作？",
    lead: "说清岗位要解决什么，或你真正想做什么。攒攒帮你找到值得聊的公司或候选人。",
    agentName: "攒攒招聘",
    agentRole: "AI 双向职业顾问",
    chatHeadline: "你在招人，还是在找下一份工作？",
    welcome: "你好，我是攒攒职业顾问。你是在招人，还是正在寻找下一份工作？我们先从真正想解决的问题说起。",
    composerPlaceholder: "说说岗位问题，或你想去的下一站…",
    discoverLabel: "职业新局",
    opportunityLabel: "职业局",
    scene: "startup",
    availability: "preview",
    availabilityLabel: "筹备中",
    starters: [
      { label: "我在招人", text: "我正在招聘一个关键角色。这个岗位真正要解决的问题是……" },
      { label: "我在找工作", text: "我在寻找下一份工作，真正想做的方向和不能接受的条件是……" },
      { label: "先聊方向", text: "我暂时不急着换工作，但愿意了解这样的团队与岗位方向……" },
    ],
    entryPoints: [
      { label: "双角色", text: "招聘方与求职者分别理解" },
      { label: "真实问题", text: "岗位目标，而不只是职位描述" },
      { label: "双向成立", text: "能力、回报、阶段与风险偏好" },
    ],
  },
  capital: {
    id: "capital",
    path: "/capital",
    name: "攒攒创投",
    shortName: "创投",
    eyebrow: "AI 投融资对接助手",
    headline: "你在找资金，\n还是在找好项目？",
    lead: "说清项目阶段和融资计划，或你的投资方向。攒攒帮双方找到值得聊的人和项目。",
    agentName: "攒攒创投",
    agentRole: "AI 投融资对接助手",
    chatHeadline: "你在找资金，还是在找项目？",
    welcome: "你好，我是攒攒创投。你是正在为项目找资金，还是在寻找值得了解的项目？我们先从当前阶段和方向说起。",
    composerPlaceholder: "说说项目阶段、融资计划或投资方向…",
    discoverLabel: "创投新局",
    opportunityLabel: "创投局",
    scene: "startup",
    availability: "preview",
    availabilityLabel: "体验预览",
    starters: [
      { label: "我在找资金", text: "我的项目正在寻找下一轮资金。目前阶段、已有进展和融资计划是……" },
      { label: "我在找项目", text: "我正在寻找值得进一步了解的项目。关注方向、阶段和单笔范围是……" },
      { label: "先认识同行", text: "我暂时不急着推进交易，想先认识这个方向里的创业者或投资人……" },
    ],
    entryPoints: [
      { label: "当前角色", text: "创业项目、投资方或生态伙伴" },
      { label: "阶段方向", text: "项目进展、投资领域与资金计划" },
      { label: "下一步", text: "先交流、看材料或安排正式会谈" },
    ],
  },
  travel: {
    id: "travel",
    path: "/travel",
    name: "攒攒旅友",
    shortName: "旅友",
    eyebrow: "AI 旅行同行顾问",
    headline: "想去远一点的地方？\n先找对一起出发的人。",
    lead: "告诉攒攒目的地、日期、预算和旅行节奏，找到行程与边界都合得来的同行者。",
    agentName: "攒攒旅友",
    agentRole: "AI 旅行同行顾问",
    chatHeadline: "这次想和怎样的人一起出发？",
    welcome: "你好，我是攒攒旅友。你已经有目的地和日期，还是只确定想出发？我们可以先从这趟旅行最期待的事情说起。",
    composerPlaceholder: "说说想去哪里、什么时候、怎样旅行…",
    discoverLabel: "旅行计划",
    opportunityLabel: "旅行同行",
    scene: "love",
    availability: "preview",
    availabilityLabel: "体验预览",
    starters: [
      { label: "周末短途", text: "我想找人一起周末短途旅行。出发城市、目的地和大概日期是……" },
      { label: "长线旅行", text: "我计划一次一周左右的旅行，希望同行者的预算和旅行节奏是……" },
      { label: "已有路线", text: "我已经做了大致路线，想找愿意一起出发并分担准备工作的人。目前计划是……" },
    ],
    entryPoints: [
      { label: "去哪儿", text: "目的地、出发城市和大致日期" },
      { label: "怎么走", text: "预算、住宿、交通和旅行节奏" },
      { label: "先说清", text: "安全边界、责任分工和必须分开的安排" },
    ],
  },
};

export const CHANNEL_LIST = Object.values(CHANNELS);

export function isChannel(value: string): value is Channel {
  return value in CHANNELS;
}

export function channelForScene(scene: Scene): Channel {
  return scene === "startup" ? "founder" : "play";
}

export function resolveOpportunityChannel(opportunity: Pick<Opportunity, "id" | "scene" | "channel" | "title" | "type" | "tags">): Channel {
  if (opportunity.channel) return opportunity.channel;
  const searchable = [opportunity.id, opportunity.title, opportunity.type, ...opportunity.tags].join(" ");
  if (/恋爱|相亲|长期关系|婚姻|一对一认识/.test(searchable)) return "love";
  if (/招聘|岗位|求职|人才候选|面试/.test(searchable)) return "jobs";
  if (/投融资|融资|投资|基金|资本|路演/.test(searchable)) return "capital";
  if (/旅行|旅友|出发|行程|目的地|短途|长线|自驾/.test(searchable)) return "travel";
  return channelForScene(opportunity.scene);
}
