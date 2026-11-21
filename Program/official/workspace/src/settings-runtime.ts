import type { ServerPublicSettings } from "./core";
import { isImageGenerationModelId } from "./core";
import { completeModelCatalog } from "./settings-model-state";
export { describeModelLoadError as modelLoadErrorMessage, modelLoadNotice } from "./settings-model-state";

export function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error || "未知错误");
}

export async function fetchServerModelSettings(forceRefresh = false): Promise<ServerPublicSettings> {
  if (!window.aieyraServer?.models) throw new Error("账户服务暂未提供模型列表。");
  const result = await window.aieyraServer.models({ forceRefresh });
  if (!result.ok) throw new Error(result.error ?? "模型列表拉取失败。");
  return result.settings ?? {};
}

export function fullServerModelList(serverSettings: ServerPublicSettings) {
  return completeModelCatalog(serverSettings);
}

export function preferredAgentModelFromList(models: string[] = []) {
  return models.find((model) => /^gpt-6-astra(?:[-.:]|$)/i.test(model)) ?? models.find((model) => /^gpt-5\.6\b/i.test(model)) ?? models.find((model) => /^gpt-5\.5\b/i.test(model)) ?? models[0] ?? "";
}

export function preferredImageModelFromList(models: string[] = []) {
  return models.find((model) => /^gpt-image-2\b/i.test(model)) ?? models.find(isImageGenerationModelId) ?? "";
}


