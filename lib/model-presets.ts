export type ModelProviderKind =
  | "stepfun"
  | "openai"
  | "deepseek"
  | "qwen"
  | "moonshot"
  | "zhipu"
  | "custom";

export type ModelProviderPreset = {
  kind: ModelProviderKind;
  label: string;
  baseUrl: string;
  model: string;
  hint: string;
};

export const MODEL_PROVIDER_PRESETS: ModelProviderPreset[] = [
  {
    kind: "stepfun",
    label: "阶跃星辰",
    baseUrl: "https://api.stepfun.com/v1",
    model: "step-3.5-flash-2603",
    hint: "适合中文 Agent 与工具调用",
  },
  {
    kind: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    hint: "OpenAI Chat Completions 兼容接口",
  },
  {
    kind: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    hint: "DeepSeek 官方 OpenAI 兼容接口",
  },
  {
    kind: "qwen",
    label: "通义千问 · 百炼",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    hint: "阿里云百炼中国内地地域",
  },
  {
    kind: "moonshot",
    label: "Moonshot AI",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "moonshot-v1-8k",
    hint: "Moonshot OpenAI 兼容接口",
  },
  {
    kind: "zhipu",
    label: "智谱 AI",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4-flash",
    hint: "智谱开放平台兼容接口",
  },
  {
    kind: "custom",
    label: "自定义平台",
    baseUrl: "",
    model: "",
    hint: "任意 OpenAI-Compatible Chat Completions API",
  },
];

export function getProviderPreset(kind: ModelProviderKind) {
  return MODEL_PROVIDER_PRESETS.find((preset) => preset.kind === kind)
    ?? MODEL_PROVIDER_PRESETS.at(-1)!;
}
