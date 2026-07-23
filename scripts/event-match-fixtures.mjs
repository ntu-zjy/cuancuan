/**
 * Synthetic, non-identifying activity rosters for local and staging checks.
 * These fixtures deliberately live outside the app/database so test runs never
 * create accounts, events, or contact data.
 */
// Each cohort is deliberately narrow: only its expected counterpart carries
// the resource it needs.  This avoids a test that accidentally turns all
// 4,950 possible pairs into candidates through generic wording.
const templates = [
  {
    cohort: "tech-builder",
    expectedCohorts: ["scenario-owner"],
    template: {
      roles: ["工程", "系统集成"], stage: "试点准备", position: "技术负责人",
      needs: ["找场景"], needDetail: "希望进入真实业务流程做一次小范围试点。",
      offers: ["工程能力"], offerDetail: "可以完成轻量系统集成和功能实现。",
    },
  },
  {
    cohort: "scenario-owner",
    expectedCohorts: ["tech-builder"],
    template: {
      roles: ["行业运营", "业务负责人"], stage: "流程梳理", position: "业务创新负责人",
      needs: ["找技术"], needDetail: "需要技术伙伴一起处理一线流程中的具体问题。",
      offers: ["行业场景"], offerDetail: "可协调一线团队共同定义问题与试点边界。",
    },
  },
  {
    cohort: "product-builder",
    expectedCohorts: ["channel-owner"],
    template: {
      roles: ["产品", "设计"], stage: "首批交付", position: "产品负责人",
      needs: ["找客户"], needDetail: "希望找到首批愿意尝试的企业客户。",
      offers: ["产品能力"], offerDetail: "可以完成需求梳理、交互设计和首轮交付。",
    },
  },
  {
    cohort: "channel-owner",
    expectedCohorts: ["product-builder"],
    template: {
      roles: ["销售", "渠道"], stage: "商业拓展", position: "渠道负责人",
      needs: ["找产品"], needDetail: "正在寻找能向客户交付的轻量解决方案。",
      offers: ["客户资源"], offerDetail: "可提供首批客户沟通机会与区域合作渠道。",
    },
  },
  {
    cohort: "fundraising-founder",
    expectedCohorts: ["early-investor"],
    template: {
      roles: ["创业者", "商业化"], stage: "种子轮融资", position: "创始人",
      needs: ["找资金"], needDetail: "正在寻找懂行业的种子轮投资人。",
      offers: ["商业建议"], offerDetail: "可分享早期商业化进展与关键判断问题。",
    },
  },
  {
    cohort: "early-investor",
    expectedCohorts: ["fundraising-founder"],
    template: {
      roles: ["投资", "战略"], stage: "持续看项目", position: "投资经理",
      needs: ["商业建议"], needDetail: "希望交换早期商业化判断和行业观察。",
      offers: ["资金"], offerDetail: "可以提供融资判断与下一轮资源引荐。",
    },
  },
  {
    cohort: "data-partner",
    expectedCohorts: ["healthcare-owner"],
    template: {
      roles: ["数据", "统计"], stage: "合作筹备", position: "数据负责人",
      needs: ["找数据"], needDetail: "希望获得有明确使用边界的业务数据。",
      offers: ["统计分析"], offerDetail: "可完成数据清洗与结果解读。",
    },
  },
  {
    cohort: "healthcare-owner",
    expectedCohorts: ["data-partner"],
    template: {
      roles: ["临床研究", "成果转化"], stage: "试点准备", position: "研究负责人",
      needs: ["看分析思路"], needDetail: "希望了解数据分析能如何帮助研究流程。",
      offers: ["数据合作"], offerDetail: "可协助确定数据使用范围与研究问题。",
    },
  },
  {
    cohort: "growth-owner",
    expectedCohorts: ["content-partner"],
    template: {
      roles: ["增长", "内容"], stage: "渠道探索", position: "增长负责人",
      needs: ["增长"], needDetail: "希望找到擅长内容触达的伙伴一起试新渠道。",
      offers: ["用户研究"], offerDetail: "可整理用户反馈和增长实验结论。",
    },
  },
  {
    cohort: "content-partner",
    expectedCohorts: ["growth-owner"],
    template: {
      roles: ["内容", "社区"], stage: "渠道探索", position: "内容负责人",
      needs: ["分享传播经验"], needDetail: "想交流不同传播方式的实际效果。",
      offers: ["内容流量"], offerDetail: "可协助进行内容分发与社群触达。",
    },
  },
];

function cloneTemplate(template) {
  return {
    ...template,
    roles: [...template.roles],
    needs: [...template.needs],
    offers: [...template.offers],
  };
}

/** Exactly 100 structured, mutually complementary test guests. */
export function createBalancedRoster() {
  return templates.flatMap(({ cohort, expectedCohorts, template }) => Array.from({ length: 10 }, (_, index) => {
    const member = cloneTemplate(template);
    const serial = String(index + 1).padStart(2, "0");
    return {
      ...member,
      id: `${cohort}-${serial}`,
      name: `模拟嘉宾 ${cohort}-${serial}`,
      tagline: `${cohort} 合成测试样本 ${serial}`,
      company: "攒攒模拟活动",
      cohort,
      expectedCohorts: [...expectedCohorts],
      sourceRow: index + 2,
    };
  }));
}

/** A 100-person roster where the final 12 profiles must remain unforced. */
export function createMixedQualityRoster() {
  const expandedCohorts = new Set(["tech-builder", "scenario-owner", "product-builder", "channel-owner"]);
  const supported = createBalancedRoster().filter((guest) => (
    Number(guest.id.slice(-2)) <= 8 || expandedCohorts.has(guest.cohort)
  ));
  const unsupported = Array.from({ length: 12 }, (_, index) => ({
    id: `incomplete-${String(index + 1).padStart(2, "0")}`,
    name: `信息待补充嘉宾 ${index + 1}`,
    tagline: "合成测试样本：资料不足，不应被强行配对",
    roles: ["探索中"],
    company: "攒攒模拟活动",
    stage: "待补充",
    position: "待补充",
    needs: ["认识新朋友"],
    needDetail: "目前还没想清楚具体想解决的问题。",
    offers: ["愿意交流"],
    offerDetail: "资料待补充。",
    cohort: "incomplete",
    expectedCohorts: [],
    sourceRow: 90 + index,
  }));
  return [...supported, ...unsupported];
}

/** 90 people have explicit counterparts; 10 complete profiles have no compatible supply in this room. */
export function createCompleteNoFitRoster() {
  const supported = createBalancedRoster().filter((guest) => Number(guest.id.slice(-2)) <= 9);
  const noFit = Array.from({ length: 10 }, (_, index) => ({
    id: `community-no-fit-${String(index + 1).padStart(2, "0")}`,
    name: `社区服务嘉宾 ${index + 1}`,
    tagline: "合成测试样本：资料完整，但本场没有对应资源",
    roles: ["社区服务"],
    company: "攒攒模拟活动",
    stage: "公益筹备",
    position: "社区志愿者",
    needs: ["找社区伙伴"],
    needDetail: "希望认识关注城市公益和社区服务的伙伴。",
    offers: ["社区组织"],
    offerDetail: "可以组织小范围公益活动与志愿服务。",
    cohort: "community-no-fit",
    expectedCohorts: [],
    sourceRow: 92 + index,
  }));
  return [...supported, ...noFit];
}

/** A deliberately skewed room: 97 founders compete for only 3 investors. */
export function createSupplyConstrainedRoster() {
  const founders = Array.from({ length: 97 }, (_, index) => ({
    id: `funding-founder-${String(index + 1).padStart(3, "0")}`,
    name: `融资团队 ${index + 1}`,
    tagline: "合成测试样本：明确融资需求",
    roles: ["创业者"],
    company: "攒攒模拟活动",
    stage: "种子融资",
    position: "创始人",
    needs: ["找资金"],
    needDetail: "正在寻找能沟通种子轮方向的资金支持。",
    offers: ["项目介绍"],
    offerDetail: "可提供当前进展和团队介绍。",
    cohort: "funding-founder",
    expectedCohorts: ["seed-investor"],
    sourceRow: index + 2,
  }));
  const investors = Array.from({ length: 3 }, (_, index) => ({
    id: `seed-investor-${String(index + 1).padStart(2, "0")}`,
    name: `种子投资人 ${index + 1}`,
    tagline: "合成测试样本：可提供早期资金判断",
    roles: ["投资"],
    company: "攒攒模拟活动",
    stage: "看早期项目",
    position: "投资经理",
    needs: ["看项目"],
    needDetail: "重点关注种子阶段、有明确问题意识的团队。",
    offers: ["资金"],
    offerDetail: "可以提供早期融资判断和后续沟通机会。",
    cohort: "seed-investor",
    expectedCohorts: ["funding-founder"],
    sourceRow: 99 + index,
  }));
  return [...founders, ...investors];
}
