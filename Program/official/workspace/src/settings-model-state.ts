export type ModelCacheSource = "network" | "memory" | "disk" | "stale";

export type ModelLoadNotice = {
  message: string;
  tone: "info" | "warning";
  empty: boolean;
};

export function completeModelCatalog(settings: {
  models?: string[];
  imageModels?: string[];
  agentModels?: string[];
}) {
  return [
    ...(settings.models ?? []),
    ...(settings.imageModels ?? []),
    ...(settings.agentModels ?? [])
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((value, index, list) => list.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index);
}

export function describeModelLoadError(error: unknown) {
  const detail = (error instanceof Error ? error.message : String(error || "未知错误")).trim() || "未知错误";
  if (/(?:401|403|鉴权|认证|登录|授权|unauth|forbidden|invalid\s*(?:api\s*)?key|token)/i.test(detail)) {
    return `鉴权失败：${detail}`;
  }
  if (/(?:网络|连接|超时|timeout|timed\s*out|network|fetch|econn|enotfound|socket|dns)/i.test(detail)) {
    return `网络请求失败：${detail}`;
  }
  return `获取模型失败：${detail}`;
}

export function modelLoadNotice(
  settings: { cacheSource?: ModelCacheSource; serviceReady?: boolean },
  modelCount: number
): ModelLoadNotice {
  const count = Math.max(0, Math.floor(Number(modelCount) || 0));
  if (!count) {
    return {
      message: settings.serviceReady === false
        ? "尚未连接模型服务"
        : "未获取到模型",
      tone: "warning",
      empty: true
    };
  }
  if (settings.serviceReady === false) {
    return {
      message: `已读取 ${count} 个模型`,
      tone: "warning",
      empty: false
    };
  }
  return {
    message: `已获取 ${count} 个模型`,
    tone: settings.cacheSource === "stale" ? "warning" : "info",
    empty: false
  };
}
