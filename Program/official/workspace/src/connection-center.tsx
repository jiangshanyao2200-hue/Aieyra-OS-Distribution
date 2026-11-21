import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "./studio-icons";
import OfficialKeyDialog from "./official-key-dialog";
import { Check, Copy, Download, Loader2, PlugZap, Workflow, X } from "./studio-icons";
import { Cloud, CreditCard, KeyRound, LogIn, LogOut, ReceiptText, RefreshCw, Unplug, UserPlus } from "./studio-icons-lazy";
import type {
  AgentProviderChoice,
  AieyraPortalPage,
  AppSettings,
  ConnectionMode,
  ConnectionPublicSnapshot,
  ConnectionResult,
  CustomConnectionDraft,
  CustomConnectionResult,
  ModelAdapter,
  ProviderModelInfo,
  ExternalImageApiActionResult,
  ExternalImageApiStatus,
  OfficialTokenMeta,
  ReasoningEffort,
  ServiceTier,
  ServerKeyStatus,
  ServerUser,
  ServerWallet
} from "./core";
import {
  REASONING_EFFORT_OPTIONS,
  SERVICE_TIER_OPTIONS,
  agentModelsFromList,
  agentModelCapability,
  imageModelsFromList,
  isImageGenerationModelId,
  normalizedAgentRuntimeOptions
} from "./core";
import { OFFICIAL_PORTAL_HOST } from "./official-service";
import ConnectionModelFields from "./connection-model-fields";
import {
  ActionButton,
  ButtonBase,
  DialogShell,
  Field,
  InlineNotice,
  MenuItem,
  MenuSeparator,
  MenuSurface,
  SurfaceBody,
  SurfaceHeader
} from "./ui";

type ConnectionCenterProps = {
  connection: ConnectionPublicSnapshot;
  settings: AppSettings;
  close: () => void;
  onConnectionChange: (connection: ConnectionPublicSnapshot) => void;
  serverUser: ServerUser | null;
  serverWallet: ServerWallet | null;
  serverKeyStatus: ServerKeyStatus | null;
  officialTokens: OfficialTokenMeta[];
  selectedOfficialTokenId: string;
  serverMessage: string;
  refreshOfficialAccount: () => Promise<boolean>;
  openOfficialPortal: (page: AieyraPortalPage) => boolean | Promise<boolean>;
  logoutOfficial: () => Promise<void>;
  initialPanel?: ConnectionCenterPanel;
  panelRequest?: number;
};

const MODE_COPY: Record<ConnectionMode, { label: string }> = {
  local: {
    label: "尚未连接"
  },
  official: {
    label: "Aieyra 官方"
  },
  custom: {
    label: "自定义供应商"
  }
};

type VisibleConnectionMode = Exclude<ConnectionMode, "local">;
export type ConnectionCenterPanel = VisibleConnectionMode | "external";
const CONNECTION_PANELS: ConnectionCenterPanel[] = ["official", "custom", "external"];
const PROVIDER_PRESETS = [
  { id: "custom", name: "自定义 / 第三方中转站", url: "" },
  { id: "deepseek", name: "DeepSeek", url: "https://api.deepseek.com" },
  { id: "openrouter", name: "OpenRouter", url: "https://openrouter.ai/api/v1" },
  { id: "opencode", name: "OpenCode Zen", url: "https://opencode.ai/zen/v1" },
  { id: "opencode-go", name: "OpenCode Go", url: "https://opencode.ai/zen/go/v1" }
];

const PANEL_COPY: Record<ConnectionCenterPanel, { label: string }> = {
  official: MODE_COPY.official,
  custom: MODE_COPY.custom,
  external: {
    label: "外部 API"
  }
};

function connectionStatusLabel(connection: ConnectionPublicSnapshot) {
  if (connection.aiReady) return "AI 已就绪";
  if (connection.phase === "connecting") return "正在连接";
  if (connection.phase === "error") return "需要处理";
  if (connection.mode === "local") return "待连接";
  return "尚未就绪";
}

function resultError(result: ConnectionResult | CustomConnectionResult | null | undefined, fallback: string) {
  return String(result?.error || result?.connection?.error?.message || fallback).trim();
}

function normalizedModels(result: ConnectionResult | CustomConnectionResult | null | undefined) {
  const values = result?.models?.length ? result.models : result?.connection?.models;
  return Array.from(new Set((values ?? []).map((model) => String(model || "").trim()).filter(Boolean)));
}

function accountName(user: ServerUser) {
  return user.name.trim() || user.username || user.account || user.email || "Aieyra 用户";
}

export default function ConnectionCenter({
  connection,
  settings,
  close,
  onConnectionChange,
  serverUser,
  serverWallet,
  serverKeyStatus,
  officialTokens,
  selectedOfficialTokenId,
  serverMessage,
  refreshOfficialAccount,
  openOfficialPortal,
  logoutOfficial,
  initialPanel,
  panelRequest
}: ConnectionCenterProps) {
  const [panelMode, setPanelMode] = useState<ConnectionCenterPanel>(initialPanel || (connection.mode === "custom" ? "custom" : "official"));
  const [modeMenu, setModeMenu] = useState<{ x: number; y: number; anchor: HTMLElement } | null>(null);
  useEffect(() => { if (initialPanel) setPanelMode(initialPanel); }, [initialPanel, panelRequest]);
  const [busyAction, setBusyAction] = useState("");
  const actionEpochRef = useRef(0);
  const hydratedCustomConnectionRef = useRef("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [externalApiStatus, setExternalApiStatus] = useState<ExternalImageApiStatus | null>(null);
  const [testedModels, setTestedModels] = useState<string[]>(connection.mode === "custom" ? connection.models : []);
  const [providerDirectory, setProviderDirectory] = useState<ProviderModelInfo[]>(connection.modelDirectory || []);
  const [manualModelsText, setManualModelsText] = useState(connection.modelsSource === "manual" ? connection.models.join("\n") : "");
  const [adapterTexts, setAdapterTexts] = useState<Record<string, string>>({});
  const [officialModelKeyBindings, setOfficialModelKeyBindings] = useState(connection.modelKeyBindings);
  const [officialAgentModel, setOfficialAgentModel] = useState(connection.mode === "official" ? connection.agentModel : "");
  const [officialAgentModelPool, setOfficialAgentModelPool] = useState<string[]>(connection.mode === "official" ? connection.agentModelPool : []);
  const [officialImageModel, setOfficialImageModel] = useState(connection.mode === "official" ? connection.imageModel : "");
  const [officialImageModelPool, setOfficialImageModelPool] = useState<string[]>(connection.mode === "official" ? connection.imageModelPool : []);
  const [officialImageModelNotes, setOfficialImageModelNotes] = useState<Record<string, string>>(connection.mode === "official" ? connection.imageModelNotes : {});
  const selectedKeySignature = officialTokens.filter((token) => token.selected).map((token) => token.id).sort().join(",") || selectedOfficialTokenId;
  const [pendingOfficialTokenIds, setPendingOfficialTokenIds] = useState<string[]>(selectedKeySignature ? selectedKeySignature.split(",") : []);
  const [keyDialogOpen, setKeyDialogOpen] = useState(false);
  const [officialAgentProvider, setOfficialAgentProvider] = useState<AgentProviderChoice>(connection.mode === "official" ? connection.agentProvider : settings.agentProvider);
  const [officialReasoningEffort, setOfficialReasoningEffort] = useState<ReasoningEffort>(connection.mode === "official" ? connection.reasoningEffort : settings.reasoningEffort);
  const [officialServiceTier, setOfficialServiceTier] = useState<ServiceTier>(connection.mode === "official" ? connection.serviceTier : settings.serviceTier);
  const [draft, setDraft] = useState<CustomConnectionDraft>({
    manualModels: connection.mode === "custom" && connection.modelsSource === "manual" ? connection.models : undefined,
    modelAdapters: connection.mode === "custom" ? connection.modelAdapters : {},
    profileId: connection.mode === "custom" ? connection.profileId : undefined,
    profileName: connection.mode === "custom" ? connection.profileName : "我的 API",
    baseUrl: connection.mode === "custom" ? connection.displayBaseUrl : "",
    apiKey: "",
    allowInsecureLan: false,
    persistCredential: true,
    agentProvider: connection.mode === "custom" ? connection.agentProvider : settings.agentProvider,
    agentModel: connection.mode === "custom" ? connection.agentModel : "",
    agentModelPool: connection.mode === "custom" ? connection.agentModelPool : [],
    imageModel: connection.mode === "custom" ? connection.imageModel : "",
    imageModelPool: connection.mode === "custom" ? connection.imageModelPool : [],
    imageModelNotes: connection.mode === "custom" ? connection.imageModelNotes : {},
    reasoningEffort: connection.mode === "custom" ? connection.reasoningEffort : settings.reasoningEffort,
    serviceTier: connection.mode === "custom" ? connection.serviceTier : settings.serviceTier,
    fastMode: connection.mode === "custom" ? connection.fastMode : settings.fastMode
  });
  const adapterText = adapterTexts[draft.agentModel || ""] ?? (draft.modelAdapters?.[draft.agentModel || ""] ? JSON.stringify(draft.modelAdapters[draft.agentModel || ""], null, 2) : "");

  useEffect(() => {
    setPendingOfficialTokenIds(selectedKeySignature ? selectedKeySignature.split(",") : []);
  }, [selectedKeySignature]);

  // Status/account refreshes deserialize new arrays with the same values.
  // Hydrate only when the saved configuration changes, so those refreshes
  // cannot discard a model choice, note or connection draft being edited.
  const modelSelectionSignature = JSON.stringify([
    connection.mode, connection.profileId, connection.agentModel || connection.agentModels[0] || "",
    connection.agentModelPool, connection.imageModel, connection.imageModelPool,
    connection.imageModelNotes, connection.modelKeyBindings, connection.agentProvider, connection.reasoningEffort, connection.serviceTier, connection.fastMode,
  ]);
  const customConfigurationSignature = JSON.stringify([modelSelectionSignature, connection.profileName, connection.displayBaseUrl, connection.modelAdapters, connection.modelsSource]);
  const modelCatalogSignature = JSON.stringify(connection.models);
  useEffect(() => {
    if (connection.mode === "custom") setTestedModels(connection.models);
  }, [connection.mode, modelCatalogSignature]);

  useEffect(() => {
    if (connection.mode !== "custom") {
      hydratedCustomConnectionRef.current = "";
      return;
    }
    if (busyAction || hydratedCustomConnectionRef.current === customConfigurationSignature) return;
    hydratedCustomConnectionRef.current = customConfigurationSignature;
    setAdapterTexts({}); setProviderDirectory(connection.modelDirectory || []);
    setManualModelsText(connection.modelsSource === "manual" ? connection.models.join("\n") : "");
    setDraft((current) => ({
      ...current,
      modelAdapters: connection.modelAdapters,
      manualModels: connection.modelsSource === "manual" ? connection.models : undefined,
      profileId: connection.profileId || current.profileId,
      profileName: connection.profileName || current.profileName,
      baseUrl: connection.displayBaseUrl || current.baseUrl,
      agentModel: connection.agentModel || current.agentModel,
      agentModelPool: connection.agentModelPool,
      imageModel: connection.imageModel || current.imageModel,
      imageModelPool: connection.imageModelPool,
      imageModelNotes: connection.imageModelNotes,
      agentProvider: connection.agentProvider,
      reasoningEffort: connection.reasoningEffort,
      serviceTier: connection.serviceTier,
      fastMode: connection.fastMode
    }));
  }, [busyAction, customConfigurationSignature]);

  useEffect(() => {
    if (connection.mode !== "official") return;
    setOfficialAgentModel(connection.agentModel || connection.agentModels[0] || "");
    setOfficialAgentModelPool(connection.agentModelPool);
    setOfficialImageModel(connection.imageModel || "");
    setOfficialImageModelPool(connection.imageModelPool);
    setOfficialImageModelNotes(connection.imageModelNotes);
    setOfficialModelKeyBindings(connection.modelKeyBindings);
    setOfficialAgentProvider(connection.agentProvider);
    setOfficialReasoningEffort(connection.reasoningEffort);
    setOfficialServiceTier(connection.serviceTier);
  }, [modelSelectionSignature]);

  const availableModels = useMemo(
    () => Array.from(new Set(testedModels ?? [])),
    [testedModels]
  );
  const officialAgentCapability = useMemo(
    () => agentModelCapability(officialAgentModel, officialAgentProvider),
    [officialAgentModel, officialAgentProvider]
  );


  function customDraftForModel(current: CustomConnectionDraft, model: string, provider = current.agentProvider || "OPENAI") {
    const runtime = normalizedAgentRuntimeOptions(model, provider, current.reasoningEffort, current.serviceTier, current.fastMode);
    return {
      ...current,
      agentModel: model,
      agentProvider: runtime.agentProvider,
      reasoningEffort: (runtime.reasoningEffort || "low") as ReasoningEffort,
      serviceTier: runtime.serviceTier,
      fastMode: runtime.fastMode
    };
  }

  async function runConnectionAction<T extends ConnectionResult | CustomConnectionResult>(
    action: string,
    operation: () => Promise<T>,
    successMessage: string
  ) {
    if (busyAction) return null;
    const actionEpoch = actionEpochRef.current + 1;
    actionEpochRef.current = actionEpoch;
    setBusyAction(action);
    setError("");
    setMessage("");
    try {
      const result = await operation();
      if (actionEpochRef.current !== actionEpoch) return result;
      // A Custom test is a non-mutating probe. Its connection field describes
      // the still-active provider and must not overwrite the draft/model list
      // that the probe is about to return.
      if (result?.connection && action !== "test-custom") onConnectionChange(result.connection);
      if (!result?.ok) {
        setError(resultError(result, "连接操作失败，请检查配置后重试。"));
        return result;
      }
      setMessage(successMessage);
      return result;
    } catch (actionError) {
      if (actionEpochRef.current !== actionEpoch) return null;
      setError(actionError instanceof Error ? actionError.message : String(actionError));
      return null;
    } finally {
      if (actionEpochRef.current === actionEpoch) setBusyAction("");
    }
  }

  async function cancelConnectionAction() {
    const bridge = window.aieyraConnection;
    if (!bridge || !busyAction) return;
    actionEpochRef.current += 1;
    try {
      const result = await bridge.cancel();
      if (result?.connection) onConnectionChange(result.connection);
      setError("");
      setMessage(result?.cancelled === false ? "当前没有可取消的连接请求。" : "已取消连接请求，配置与凭证没有被启用。");
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : String(cancelError));
    } finally {
      setBusyAction("");
    }
  }

  async function useOfficialMode() {
    const bridge = window.aieyraConnection;
    if (!bridge) {
      setError("桌面连接桥尚未加载。请重启应用后重试。");
      return;
    }
    const result = await runConnectionAction(
      "official",
      () => bridge.selectMode({ mode: "official" }),
      "官方服务已就绪。"
    );
    setPanelMode("official");
    if (result?.ok) return void refreshOfficialAccount();
    if (!serverUser && result?.errorKind !== "cancelled") void openOfficialPortalAction("login");
  }

  async function openOfficialPortalAction(page: AieyraPortalPage) {
    if (busyAction) return;
    setBusyAction(`official-portal-${page}`);
    setError("");
    setMessage("");
    try {
      const opened = await openOfficialPortal(page);
      if (!opened) {
        setError("无法打开官方账号窗口，请稍后再试。");
        return;
      }
      setMessage(page === "login" || page === "register"
        ? "官方账号页面已打开；登录后自动同步。"
        : "官方账号页面已打开；完成后继续。");
    } catch (portalError) {
      setError(portalError instanceof Error ? portalError.message : String(portalError));
    } finally {
      setBusyAction("");
    }
  }

  const portalAction = (page: AieyraPortalPage, label: string, icon: React.ReactNode, variant: "primary" | "secondary" | "ghost" = "ghost") => (
    <ActionButton variant={variant} onClick={() => void openOfficialPortalAction(page)} disabled={Boolean(busyAction)} icon={icon}>{label}</ActionButton>
  );

  async function fetchOfficialModels() {
    const bridge = window.aieyraServer;
    if (!bridge?.selectOfficialToken) {
      setError("桌面账户桥尚未加载。请重启应用后重试。");
      return;
    }
    const result = await runConnectionAction(
      "select-official-token",
      () => bridge.selectOfficialToken({ tokenIds: pendingOfficialTokenIds }),
      "模型已获取。"
    );
    if (!result?.ok) return;
    setOfficialAgentModel(result.connection.agentModel || result.connection.agentModels[0] || "");
    setOfficialAgentModelPool(result.connection.agentModelPool);
    setOfficialImageModel(result.connection.imageModel || "");
    setOfficialImageModelPool(result.connection.imageModelPool);
    setOfficialImageModelNotes(result.connection.imageModelNotes);
    setOfficialModelKeyBindings(result.connection.modelKeyBindings);
    setOfficialAgentProvider(result.connection.agentProvider);
    setOfficialReasoningEffort(result.connection.reasoningEffort);
    setOfficialServiceTier(result.connection.serviceTier);
    await refreshOfficialAccount();
  }

  async function applyOfficialModels() {
    const bridge = window.aieyraConnection;
    if (!bridge) return;
    if (!officialConnectionReady) {
      setError("当前官方连接尚未恢复，请先连接并加载模型。缓存模型不能直接执行任务。");
      return;
    }
    if (!officialAgentModel) {
      setError("请选择 Agent 模型。");
      return;
    }
    await runConnectionAction(
      "select-official-models",
      () => bridge.selectModels({
        agentModel: officialAgentModel,
        agentModelPool: officialAgentModelPool,
        imageModel: officialImageModel || undefined,
        imageModelPool: officialImageModelPool,
        imageModelNotes: officialImageModelNotes,
        modelKeyBindings: officialModelKeyBindings,
        agentProvider: officialAgentProvider,
        reasoningEffort: officialReasoningEffort,
        serviceTier: officialServiceTier
      }),
      "模型已保存，将用于后续新任务。"
    );
  }

  async function logoutFromOfficial() {
    if (busyAction) return;
    const actionEpoch = actionEpochRef.current + 1;
    actionEpochRef.current = actionEpoch;
    setBusyAction("logout-official");
    setError("");
    try {
      await logoutOfficial();
      const result = await window.aieyraConnection?.status();
      if (result?.connection) onConnectionChange(result.connection);
      if (actionEpochRef.current === actionEpoch) setMessage("已退出 Aieyra；可重新登录或切换自定义供应商。");
      close();
    } catch (logoutError) {
      if (actionEpochRef.current === actionEpoch) setError(logoutError instanceof Error ? logoutError.message : String(logoutError));
    } finally {
      if (actionEpochRef.current === actionEpoch) setBusyAction("");
    }
  }

  async function testCustomConnection() {
    const bridge = window.aieyraConnection;
    if (!bridge) {
      setError("桌面连接桥尚未加载。请重启应用后重试。");
      return;
    }
    const result = await runConnectionAction(
      "test-custom",
      () => bridge.testCustom({ ...draft, agentModel: undefined, imageModel: undefined }),
      "连接验证成功。请选择 Agent 模型；图片项目还可指定图片模型。"
    );
    if (!result?.ok) return;
    const models = normalizedModels(result);
    setProviderDirectory(result.modelDirectory || []);
    const agentModels = agentModelsFromList(models);
    const imageModels = imageModelsFromList(models);
    const preferredImageModel = imageModels.find((model) => /^gpt-image-2\b/i.test(model)) || imageModels.find(isImageGenerationModelId) || "";
    setTestedModels(models);
    setDraft((current) => {
      const availableAgentByKey = new Map(agentModels.map((model) => [model.toLowerCase(), model]));
      const selectedAgentPool = Array.from(new Set([current.agentModel, ...(current.agentModelPool || [])]
        .map((model) => availableAgentByKey.get(String(model || "").toLowerCase()))
        .filter((model): model is string => Boolean(model))));
      const agentModel = selectedAgentPool[0] || agentModels[0] || "";
      return {
        ...customDraftForModel(current, agentModel),
        baseUrl: result.normalizedBaseUrl || current.baseUrl,
        agentModelPool: selectedAgentPool.length ? selectedAgentPool : agentModel ? [agentModel] : [],
        imageModel: imageModels.includes(String(current.imageModel || "")) ? current.imageModel : preferredImageModel,
        imageModelPool: (current.imageModelPool || []).some((model) => imageModels.includes(model))
          ? (current.imageModelPool || []).filter((model) => imageModels.includes(model))
          : preferredImageModel ? [preferredImageModel] : [],
        imageModelNotes: Object.fromEntries(Object.entries(current.imageModelNotes || {}).filter(([model]) => imageModels.includes(model)))
      };
    });
  }

  async function saveCustomConnection() {
    const bridge = window.aieyraConnection;
    if (!bridge) {
      setError("桌面连接桥尚未加载。请重启应用后重试。");
      return;
    }
    if (!draft.agentModel) {
      setError("请先测试连接并选择 Agent 模型。");
      return;
    }
    const result = await runConnectionAction(
      "save-custom",
      () => {
        const adapters: Record<string, ModelAdapter> = { ...draft.modelAdapters };
        for (const [id, text] of Object.entries(adapterTexts)) adapters[id] = text.trim() ? JSON.parse(text) : {};
        return bridge.saveCustom({ ...draft, modelAdapters: adapters });
      },
      "自定义服务已保存并启用。"
    );
    if (!result?.ok) return;
    setPanelMode("custom");
    setTestedModels(normalizedModels(result));
    setDraft((current) => ({ ...current, apiKey: "" }));
  }

  async function activateSavedCustom(profileId?: string) {
    const bridge = window.aieyraConnection;
    if (!bridge) return;
    const result = await runConnectionAction(
      "activate-custom",
      () => bridge.selectMode({ mode: "custom", profileId }),
      "已启用保存的自定义服务。"
    );
    if (result?.ok) setPanelMode("custom");
  }

  async function disconnect() {
    const bridge = window.aieyraConnection;
    if (!bridge) return;
    await runConnectionAction(
      "disconnect",
      () => bridge.disconnect(),
      "已断开当前模型服务。可重新登录 Aieyra 或配置自定义供应商。"
    );
  }

  async function refreshExternalApiStatus(reportError = false) {
    const bridge = window.aieyraExternalApi;
    if (!bridge) {
      if (reportError) setError("本机 Agent API不可用，请重启应用。 ");
      return null;
    }
    try {
      const status = await bridge.status();
      setExternalApiStatus(status);
      if (reportError && !status.running) setError(status.error || "本机 Agent API尚未启动。 ");
      return status;
    } catch (statusError) {
      if (reportError) setError(statusError instanceof Error ? statusError.message : String(statusError));
      return null;
    }
  }

  async function runExternalApiAction(
    action: string,
    operation: () => Promise<ExternalImageApiActionResult>,
    successMessage: string
  ) {
    if (busyAction) return;
    setBusyAction(action);
    setError("");
    setMessage("");
    try {
      const result = await operation();
      if (!result?.ok) {
        setError(result?.error || "操作未完成。 ");
        return;
      }
      if (!result.canceled) setMessage(successMessage);
      if (result.status) setExternalApiStatus(result.status);
      else await refreshExternalApiStatus(false);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setBusyAction("");
    }
  }

  useEffect(() => {
    if (panelMode !== "external") return;
    let active = true;
    void window.aieyraExternalApi?.status().then((status) => {
      if (active) setExternalApiStatus(status);
    }).catch(() => {
      if (active) setExternalApiStatus(null);
    });
    return () => { active = false; };
  }, [panelMode, connection.aiReady, connection.imageModel, connection.imageModels]);

  const modeIcon = (mode: ConnectionMode | ConnectionCenterPanel) => mode === "local"
    ? <Unplug size={19} />
    : mode === "official" ? <Cloud size={19} /> : mode === "external" ? <Workflow size={19} /> : <PlugZap size={19} />;
  const officialConnectionReady = connection.mode === "official"
    && connection.phase === "ready"
    && connection.aiReady
    && connection.credential.configured;
  // Cached models are a hint after restart, not an executable connection.
  const officialAgentModels = officialConnectionReady ? connection.agentModels : [];
  const officialImageModels = officialConnectionReady ? connection.imageModels : [];
  const officialModelsAvailable = officialAgentModels.length + officialImageModels.length > 0;
  const officialUsableTokenCount = officialTokens.filter((token) => token.usable).length;
  const officialBalance = serverWallet?.balanceYuan ?? (serverUser?.balanceCents ?? 0) / 100;
  const modelConfigSettings: AppSettings = {
    ...settings,
    ...(panelMode === "official" ? {
      agentModel: officialAgentModel,
      agentModelPool: officialAgentModelPool,
      imageModel: officialImageModel,
      imageModelPool: officialImageModelPool,
      imageModelNotes: officialImageModelNotes,
      modelKeyBindings: officialModelKeyBindings
    } : {
      agentModel: draft.agentModel || "",
      agentModelPool: draft.agentModelPool || [],
      imageModel: draft.imageModel || "",
      imageModelPool: draft.imageModelPool || [],
      imageModelNotes: draft.imageModelNotes || {},
      modelKeyBindings: undefined
    })
  };

  function commitModelConfig(next: AppSettings) {
    if (panelMode === "official") {
      const runtime = normalizedAgentRuntimeOptions(
        next.agentModel,
        officialAgentProvider,
        officialReasoningEffort,
        officialServiceTier
      );
      setOfficialAgentModel(next.agentModel);
      setOfficialAgentModelPool(next.agentModelPool);
      setOfficialImageModel(next.imageModel);
      setOfficialImageModelPool(next.imageModelPool);
      setOfficialImageModelNotes(next.imageModelNotes);
      setOfficialModelKeyBindings(next.modelKeyBindings);
      setOfficialReasoningEffort((runtime.reasoningEffort || "low") as ReasoningEffort);
      setOfficialServiceTier(runtime.serviceTier);
      return;
    }
    setDraft((current) => customDraftForModel({
      ...current,
      agentModelPool: next.agentModelPool,
      imageModel: next.imageModel,
      imageModelPool: next.imageModelPool,
      imageModelNotes: next.imageModelNotes
    }, next.agentModel));
  }

  useEffect(() => {
    if (panelMode !== "official" || serverUser || busyAction) return;
    void refreshOfficialAccount();
  }, [panelMode, serverUser]);

  return (
    <>
    <DialogShell
      surface="connection-center"
      ariaLabel="AI 与连接"
      minimizable
      className="connection-center-dialog"
      busy={Boolean(busyAction)}
      onRequestClose={close}
    >
      {({ requestClose }) => (
        <>
          <SurfaceHeader
            className="connection-heading"
            title={<ButtonBase className="connection-mode-trigger" aria-label="选择连接方式" aria-haspopup="menu" aria-expanded={Boolean(modeMenu)}
              disabled={Boolean(busyAction)} onClick={(event) => {
                if (modeMenu) {
                  setModeMenu(null);
                  return;
                }
                const rect = event.currentTarget.getBoundingClientRect();
                setModeMenu({ x: rect.left, y: rect.bottom + 6, anchor: event.currentTarget });
              }}>
              {modeIcon(panelMode)}<span>{PANEL_COPY[panelMode].label}</span><ChevronDown size={15} />
            </ButtonBase>}
            onClose={() => requestClose("close-button")}
            closeLabel="关闭 AI 与连接"
            closeDisabled={Boolean(busyAction)}
          >
            <span className={`connection-heading-status ${connection.aiReady ? "is-ready" : ""}`} title={connection.profileName || MODE_COPY[connection.mode].label}>
              {connection.phase === "connecting" ? <Loader2 size={12} className="spin" /> : <i />}{connectionStatusLabel(connection)}
            </span>
          </SurfaceHeader>
          <SurfaceBody className="connection-center-body">
            <section className="connection-mode-panel" data-mode={panelMode}>
              {panelMode === "official" ? (
                <div className="connection-official-panel">
                  {!serverUser ? (
                    <div className="connection-panel-actions connection-auth-actions">
                      <ActionButton variant="primary" onClick={() => void useOfficialMode()} busy={busyAction === "official"} icon={<LogIn size={16} />}>登录 Aieyra</ActionButton>
                      {portalAction("register", "注册 Aieyra", <UserPlus size={16} />, "secondary")}
                    </div>
                  ) : (
                    <>
                      <div className="connection-account-row">
                        <span className="connection-official-avatar">{accountName(serverUser).slice(0, 1).toUpperCase() || "A"}</span>
                        <div className="connection-account-identity" title={serverUser.email || OFFICIAL_PORTAL_HOST}>
                          <strong>{accountName(serverUser)}</strong>
                        </div>
                        <span className="connection-account-balance" title="账户余额">¥{officialBalance.toFixed(2)}</span>
                        <div className="connection-account-actions" aria-label="Aieyra 账户操作">
                        {portalAction("wallet", "购买", <CreditCard size={14} />)}
                        {portalAction("usage", "流水", <ReceiptText size={14} />)}
                        <ActionButton variant="ghost" onClick={() => setKeyDialogOpen(true)} disabled={Boolean(busyAction)} icon={<KeyRound size={14} />}>管理 Key</ActionButton>
                        <ActionButton variant="ghost" className="connection-official-logout" onClick={() => void logoutFromOfficial()} disabled={Boolean(busyAction)} icon={<LogOut size={14} />}>退出登录</ActionButton>
                        </div>
                      </div>
                      <div className="connection-official-fields">
                        <Field label="Aieyra Key">
                          <ButtonBase
                            className="connection-key-selector"
                            aria-label="选择 Aieyra Key"
                            aria-haspopup="dialog"
                            onClick={() => setKeyDialogOpen(true)}
                            disabled={Boolean(busyAction)}
                          >
                            <KeyRound size={15} /><span>{pendingOfficialTokenIds.length ? `已选中 ${pendingOfficialTokenIds.length} 个 Key` : "选择 Key"}</span><ChevronDown size={15} />
                          </ButtonBase>
                        </Field>
                        <ActionButton onClick={fetchOfficialModels} busy={busyAction === "select-official-token"}
                          disabled={!pendingOfficialTokenIds.length || Boolean(busyAction)} icon={<RefreshCw size={15} />}>获取模型</ActionButton>
                      </div>
                      {!officialTokens.length ? (
                        <div className="connection-official-next-step">
                          <span><KeyRound size={16} /></span>
                          <p>暂无可用 Key</p>
                          <ActionButton onClick={() => setKeyDialogOpen(true)} icon={<KeyRound size={15} />}>管理 Key</ActionButton>
                        </div>
                      ) : null}
                      {officialModelsAvailable ? (
                          <>
                            <ConnectionModelFields settings={modelConfigSettings} models={connection.models} routes={connection.modelRoutes}
                              disabled={Boolean(busyAction)} onChange={commitModelConfig} />
                            <div className="connection-runtime-fields connection-runtime-fields-compact has-action" aria-label="Agent 运行参数">
                              <Field label="推理强度">
                                <select
                                  value={officialAgentCapability.supportsReasoning ? officialReasoningEffort : ""}
                                  disabled={Boolean(busyAction) || !officialAgentCapability.supportsReasoning}
                                  onChange={(event) => setOfficialReasoningEffort(event.target.value as ReasoningEffort)}
                                >
                                  {!officialAgentCapability.supportsReasoning ? <option value="">不适用</option> : null}
                                  {REASONING_EFFORT_OPTIONS.filter((option) => officialAgentCapability.reasoningEfforts.includes(option.value)).map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                  ))}
                                </select>
                              </Field>
                              <Field label="服务速度">
                                <select
                                  value={officialServiceTier}
                                  disabled={Boolean(busyAction)}
                                  onChange={(event) => setOfficialServiceTier(event.target.value as ServiceTier)}
                                >
                                  {SERVICE_TIER_OPTIONS.filter((option) => officialAgentCapability.serviceTiers.includes(option.value)).map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                  ))}
                                </select>
                              </Field>
                              <div className="connection-runtime-apply">
                                <ActionButton variant="primary" onClick={applyOfficialModels} busy={busyAction === "select-official-models"} disabled={!officialAgentModel || !officialConnectionReady} icon={<Check size={16} />}>应用</ActionButton>
                              </div>
                            </div>
                          </>
                      ) : null}
                      {officialUsableTokenCount > 0 && !officialConnectionReady ? <InlineNotice tone="warning">连接未就绪</InlineNotice> : null}
                      {officialUsableTokenCount > 0 && serverKeyStatus && !serverKeyStatus.ready ? <InlineNotice tone="warning">模型同步中</InlineNotice> : null}
                    </>
                  )}
                </div>
              ) : null}

              {panelMode === "custom" ? (
                <div className="connection-custom-panel">
                  {connection.profiles?.length ? <Field label="已保存的连接">
                    <select aria-label="已保存的连接" disabled={Boolean(busyAction)} value={connection.mode === "custom" ? connection.profileId : ""}
                      onChange={event => { if (event.target.value) void activateSavedCustom(event.target.value); }}>
                      <option value="" disabled>选择并启用连接</option>
                      {connection.profiles.map(p => <option key={p.profileId} value={p.profileId}>{p.profileName} · {p.modelCount} 个模型</option>)}
                    </select>
                  </Field> : null}
                  <Field label="供应商">
                    <select aria-label="第三方供应商" disabled={Boolean(busyAction)} value={PROVIDER_PRESETS.find(p => p.url === draft.baseUrl)?.id || "custom"}
                      onChange={event => { const preset = PROVIDER_PRESETS.find(p => p.id === event.target.value)!; setTestedModels([]); setProviderDirectory([]); setAdapterTexts({}); setManualModelsText("");
                        setDraft({ ...draft, profileId: `custom:${preset.id}`, profileName: preset.name, baseUrl: preset.url, apiKey: "", agentModel: "", agentModelPool: [], imageModel: "", imageModelPool: [], manualModels: undefined, modelAdapters: {} }); }}>
                      {PROVIDER_PRESETS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </Field>
                  <div className="connection-custom-identity-fields is-single">
                    <Field label="配置名称">
                      <input
                        value={draft.profileName}
                        disabled={Boolean(busyAction)}
                        maxLength={60}
                        placeholder="例如：工作室模型服务"
                        onChange={(event) => setDraft({ ...draft, profileName: event.target.value })}
                      />
                    </Field>
                  </div>
                  <div className="connection-custom-fields">
                    <Field label="Base URL">
                      <input
                        value={draft.baseUrl}
                        disabled={Boolean(busyAction)}
                        spellCheck={false}
                        inputMode="url"
                        placeholder="https://api.example.com/v1"
                        onChange={(event) => {
                          setTestedModels([]); setProviderDirectory([]); setAdapterTexts({}); setManualModelsText("");
                          setDraft(customDraftForModel({
                            ...draft,
                            baseUrl: event.target.value,
                            manualModels: undefined, modelAdapters: {}, agentModelPool: [], imageModelPool: [],
                            imageModel: ""
                          }, ""));
                        }}
                      />
                    </Field>
                    <Field label={connection.mode === "custom" && connection.credential.configured ? "API Key（留空则使用已保存凭证）" : "API Key"}>
                      <input
                        type="password"
                        value={draft.apiKey}
                        disabled={Boolean(busyAction)}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={connection.mode === "custom" && connection.credential.configured ? "已安全配置" : "仅发送到你填写的服务"}
                        onChange={(event) => {
                          setTestedModels([]);
                          setDraft(customDraftForModel({
                            ...draft,
                            apiKey: event.target.value,
                            imageModel: ""
                          }, ""));
                        }}
                      />
                    </Field>
                  </div>

                  <div className="connection-security-options">
                    <label>
                      <input
                        type="checkbox"
                        checked={draft.persistCredential !== false}
                        disabled={Boolean(busyAction)}
                        onChange={(event) => setDraft({ ...draft, persistCredential: event.target.checked })}
                      />
                      <span>使用系统加密保存 Key</span>
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={draft.allowInsecureLan === true}
                        disabled={Boolean(busyAction)}
                        onChange={(event) => {
                          setTestedModels([]);
                          setDraft(customDraftForModel({
                            ...draft,
                            allowInsecureLan: event.target.checked,
                            imageModel: ""
                          }, ""));
                        }}
                      />
                      <span>我确认这是可信的局域网 HTTP 开发服务</span>
                    </label>
                  </div>

                  <div className="connection-test-row">
                    <ActionButton onClick={testCustomConnection} busy={busyAction === "test-custom"} icon={<PlugZap size={15} />}>测试并获取模型</ActionButton>
                    <ActionButton onClick={() => void activateSavedCustom()} busy={busyAction === "activate-custom"}>使用已保存配置</ActionButton>
                  </div>
                  <p className="connection-matrix-help">填写地址和 Key 后获取模型。也可以交给 画布助手：读取目录、询问你的选择，再配置协议、思考和参数。</p>
                  <details className="connection-adapter-details">
                    <summary>手动模型与高级适配</summary>
                    <Field label="手动模型 ID" hint="服务没有模型目录时使用；每行一个准确 ID。">
                      <textarea value={manualModelsText} disabled={Boolean(busyAction)} rows={3} onChange={event => setManualModelsText(event.target.value)} />
                    </Field>
                    <ActionButton disabled={Boolean(busyAction) || !manualModelsText.trim()} onClick={() => {
                      const models = [...new Set(manualModelsText.split(/[\n,]/).map(value => value.trim()).filter(Boolean))];
                      setTestedModels(models); setDraft({ ...customDraftForModel(draft, models[0]), manualModels: models, agentModelPool: [models[0]] });
                    }}>使用手动列表</ActionButton>
                    <Field label={`模型适配 · ${draft.agentModel || "先选择 Agent 模型"}`} hint="留空恢复自动适配。可设置 protocol、reasoning、contextWindow、parameters；画布助手 可代为配置和探测。">
                      <textarea aria-label="模型自定义适配" rows={4} value={adapterText} disabled={Boolean(busyAction)} spellCheck={false}
                        placeholder={'{"protocol":"chat","reasoning":{"mode":"enabled","effort":"high"}}'} onChange={event => setAdapterTexts(current => ({ ...current, [draft.agentModel || ""]: event.target.value }))} />
                    </Field>
                  </details>

                  {availableModels.length ? (
                    <ConnectionModelFields settings={modelConfigSettings} models={availableModels} directory={providerDirectory} keyName={draft.profileName || "自定义 Key"}
                      disabled={Boolean(busyAction)} onChange={commitModelConfig} />
                  ) : null}

                  {availableModels.length ? (
                    <div className="connection-custom-apply" aria-label="保存自定义连接">
                      <div className="connection-runtime-apply">
                        <ActionButton
                          variant="primary"
                          onClick={saveCustomConnection}
                          busy={busyAction === "save-custom"}
                          disabled={!draft.agentModel || !availableModels.length}
                          icon={<Check size={16} />}
                        >
                          保存并启用
                        </ActionButton>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {panelMode === "external" ? (
                <div className="connection-external-panel">
                  <div className={`connection-external-state ${externalApiStatus?.running ? "is-ready" : ""}`}>
                    <span><Workflow size={20} /></span>
                    <div>
                      <small>本机 Agent API · 画布助手 / 工具 / 设置 / 生图</small>
                      <strong>{externalApiStatus?.running ? "已启动" : "未启动"}</strong>
                    </div>
                    <em>{externalApiStatus?.configured ? "生图已就绪" : "生图未配置"}</em>
                  </div>
                  <div className="connection-external-details">
                    <div>
                      <small>地址</small>
                      <code title={externalApiStatus?.baseUrl || undefined}>{externalApiStatus?.baseUrl || "未启动"}</code>
                    </div>
                    <div>
                      <small>生图模型</small>
                      <strong>{externalApiStatus?.imageModel || "未配置"}</strong>
                      <span>{externalApiStatus?.modelCount || 0} 个模型</span>
                    </div>
                  </div>
                  <div className="connection-panel-actions connection-external-actions">
                    <ActionButton
                      variant="primary"
                      icon={<Copy size={15} />}
                      busy={busyAction === "external-copy-prompt"}
                      disabled={!externalApiStatus?.running || !window.aieyraExternalApi}
                      onClick={() => void runExternalApiAction("external-copy-prompt", () => window.aieyraExternalApi!.copyPrompt(), "调用提示词已复制")}
                    >
                      复制调用提示词
                    </ActionButton>
                    <ActionButton
                      icon={<Download size={15} />}
                      busy={busyAction === "external-export-skill"}
                      disabled={!externalApiStatus?.running || !window.aieyraExternalApi}
                      onClick={() => void runExternalApiAction("external-export-skill", () => window.aieyraExternalApi!.exportSkill(), "SKILL.md 已导出")}
                    >
                      导出 SKILL.md
                    </ActionButton>
                  </div>
                </div>
              ) : null}
            </section>

            {panelMode === "custom" && connection.mode === "custom" && connection.credential.configured && !connection.credential.persisted ? (
              <InlineNotice tone="warning" icon={<KeyRound size={15} />}>当前 Key 仅保留在本次运行内；关闭应用后需要重新输入。</InlineNotice>
            ) : null}
            {panelMode === "official" && serverMessage ? <InlineNotice tone="info">{serverMessage}</InlineNotice> : null}
          {error || (panelMode !== "external" && connection.error?.message) || message || ["official", "select-official-token", "test-custom", "save-custom"].includes(busyAction) ? <div className="connection-inline-feedback">
            <div className="connection-feedback" role="status" aria-live="polite" aria-atomic="true"
              data-tone={error || (panelMode !== "external" && connection.error?.message) ? "error" : "success"}>
              {error || (panelMode !== "external" ? connection.error?.message : "") || message}
            </div>
            {["official", "select-official-token", "test-custom", "save-custom"].includes(busyAction) ? (
              <ActionButton variant="ghost" onClick={cancelConnectionAction} icon={<X size={15} />}>取消</ActionButton>
            ) : null}
          </div> : null}
          </SurfaceBody>
        </>
      )}
    </DialogShell>
    {modeMenu ? <MenuSurface {...modeMenu} ariaLabel="连接方式" className="canvas-context-menu connection-mode-menu" onRequestClose={() => setModeMenu(null)}>
      {CONNECTION_PANELS.map((mode) => <MenuItem key={mode} icon={modeIcon(mode)} aria-current={panelMode === mode ? "true" : undefined}
        shortcut={panelMode === mode ? <Check size={14} /> : undefined} onClick={() => {
          setPanelMode(mode);
          setModeMenu(null);
          setError("");
          setMessage("");
        }}>{PANEL_COPY[mode].label}</MenuItem>)}
      {connection.mode !== "local" ? <><MenuSeparator /><MenuItem tone="danger" icon={<Unplug size={15} />} onClick={() => {
        setModeMenu(null);
        void disconnect();
      }}>断开当前连接</MenuItem></> : null}
    </MenuSurface> : null}
    {keyDialogOpen ? <OfficialKeyDialog tokens={officialTokens} selectedIds={pendingOfficialTokenIds} onClose={() => setKeyDialogOpen(false)} onConfirm={(ids) => {
      setPendingOfficialTokenIds(ids);
      setKeyDialogOpen(false);
      setError("");
      setMessage("");
    }} /> : null}
    </>
  );
}
