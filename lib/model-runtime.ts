import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ActiveModelConfiguration } from "./database";

export function createConfiguredChatModel(configuration: ActiveModelConfiguration) {
  const providerName = configuration.providerKind === "custom"
    ? "custom"
    : configuration.providerKind;
  const provider = createOpenAICompatible({
    name: providerName,
    apiKey: configuration.apiKey,
    baseURL: configuration.baseUrl,
  });
  return provider.chatModel(configuration.model);
}

export function configuredProviderOptions(configuration: ActiveModelConfiguration) {
  if (configuration.providerKind !== "stepfun") return undefined;
  return { stepfun: { reasoningEffort: "low" } };
}
