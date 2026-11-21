import React, { useEffect, useState } from "react";
import { ActionButton, DialogShell, InlineNotice, SurfaceBody, SurfaceFooter, SurfaceHeader } from "./ui";
import type { WritingWorkbenchProps } from "./writing-workbench";
import { prepareModuleCanvas } from "./workspace-module-host";
import "./workspace-modules.css";
export type ModuleStatus = { id: "writing"; state: "missing" | "installed" | "error"; version?: string; bytes?: number; error?: string; development?: boolean };
type Result = { ok: boolean; status?: ModuleStatus; error?: string; canceled?: boolean; url?: string; css?: string };
declare global { interface Window { aieyraModules: { status(): Promise<Result>; install(): Promise<Result>; remove(): Promise<Result>; entry(): Promise<Result> } } }
declare const __AIEYRA_DEV__: boolean;
let moduleStylesheet: HTMLLinkElement | null = null;
let loading: Promise<typeof import("./writing-workbench")> | null = null;
let moduleGeneration = 0;
let cancelStylesheet: (() => void) | null = null;
function resetWritingModule() {
  moduleGeneration++;
  loading = null;
  cancelStylesheet?.();
  moduleStylesheet?.remove();
  moduleStylesheet = null;
}
export function loadWritingModule() {
  if (loading) return loading;
  const generation = moduleGeneration;
  let stylesheet: HTMLLinkElement | null = null;
  const assertCurrent = () => {
    if (generation !== moduleGeneration) throw new Error("工作模块已变化，请重新打开。");
  };
  const attempt = (async () => {
    const entry = await window.aieyraModules.entry();
    assertCurrent();
    if (!entry.ok) throw new Error(entry.error || "请先安装工作模块。");
    await prepareModuleCanvas();
    assertCurrent();
    if (__AIEYRA_DEV__) {
      const module = await import("./writing-workbench");
      assertCurrent();
      return module;
    }
    if (!entry.url || !entry.css) throw new Error("工作模块入口不完整。");
    await new Promise<void>((resolve, reject) => {
      const link = document.createElement("link"); link.rel = "stylesheet"; link.href = entry.css!;
      stylesheet = link;
      const finish = (error?: Error) => {
        clearTimeout(timer);
        link.onload = null; link.onerror = null;
        if (cancelStylesheet === cancel) cancelStylesheet = null;
        if (error) { link.remove(); reject(error); } else resolve();
      };
      const cancel = () => finish(new Error("工作模块已变化，请重新打开。"));
      const timer = setTimeout(() => finish(new Error("工作模块样式加载超时，请重试或重新安装。")), 15000);
      cancelStylesheet = cancel;
      link.onload = () => finish();
      link.onerror = () => finish(new Error("工作模块样式加载失败，请重新安装。"));
      moduleStylesheet = link;
      document.head.append(link);
    });
    assertCurrent();
    const module = await import(/* @vite-ignore */ entry.url) as typeof import("./writing-workbench");
    assertCurrent();
    return module;
  })().catch(error => {
    // An old failed import must not clear the next installation's load/style.
    if (loading === attempt) loading = null;
    stylesheet?.remove();
    if (moduleStylesheet === stylesheet) moduleStylesheet = null;
    throw error;
  });
  loading = attempt;
  return loading;
}
function useModuleRevision() {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const update = () => setRevision(n => n + 1);
    window.addEventListener("aieyra-modules-changed", update);
    return () => window.removeEventListener("aieyra-modules-changed", update);
  }, []);
  return revision;
}
export function ModuleManagerButton() {
  const [open, setOpen] = useState(false);
  return <><ActionButton className="workspace-modules-button" variant="ghost" onClick={() => setOpen(true)}>模块</ActionButton>{open ? <ModuleManager onClose={() => setOpen(false)} /> : null}</>;
}
export function ModuleManager({ onClose }: { onClose(): void }) {
  const [status, setStatus] = useState<ModuleStatus | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { void window.aieyraModules.status().then(r => { setStatus(r.status || null); if (!r.ok) setError(r.error || "模块状态读取失败"); }).catch(e => setError(String(e))); }, []);
  async function act(action: "install" | "remove") {
    setBusy(true); setError("");
    try { const result = await window.aieyraModules[action](); if (!result.ok) throw new Error(result.error); if (result.status) { setStatus(result.status); resetWritingModule(); window.dispatchEvent(new Event("aieyra-modules-changed")); } }
    catch(e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  return <DialogShell surface="workspace-modules" ariaLabel="模块" className="workspace-modules-dialog" busy={busy} onRequestClose={onClose}>
    {({ requestClose }) => <><SurfaceHeader title="模块" description="按需安装，拓展你的创作空间。" onClose={() => requestClose("close-button")} />
    <SurfaceBody><article className="workspace-module-card"><div><h3>画布助手</h3><p>配置模型 · 管理项目 · 调度创作 · 扩展程序</p></div><span>已内置</span></article><article className="workspace-module-card"><div><h3>绘画</h3><p>绘图 · 图片容器 · 无限画布</p></div><span>已内置</span></article>
      <article className="workspace-module-card"><div><h3>工作</h3><p>资料处理 · 小说与论文 · HTML · 分阶段核对</p><small>{status?.development ? (status.state === "installed" ? "当前源码" : "源码不可用") : status?.state === "installed" ? "已安装" : status?.state === "error" ? "需要修复" : "未安装"}{status?.bytes ? ` · ${(status.bytes / 1048576).toFixed(1)} MB` : ""}</small></div>
      <div>{status?.development ? <span>开发模式</span> : status?.state === "installed" ? <ActionButton disabled={busy} onClick={() => void act("remove")}>卸载</ActionButton> : <ActionButton variant="primary" busy={busy} onClick={() => void act("install")}>{status?.state === "error" ? "重新安装" : "安装模块"}</ActionButton>}</div></article>
      <p className="workspace-modules-note">卸载模块会保留你的项目与文档。{status?.development ? "开发模式直接加载当前工作树源码，无需安装模块；源码变更后界面自动更新，主进程变更需重启开发入口。" : "安装时下载与当前版本配套的模块，文档编辑在本机完成。"}</p>
      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
    </SurfaceBody><SurfaceFooter><ActionButton onClick={() => requestClose("action")} disabled={busy}>完成</ActionButton></SurfaceFooter></>}
  </DialogShell>;
}
class ModuleBoundary extends React.Component<{ children: React.ReactNode; onManage(): void }, { error: string }> {
  state = { error: "" };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() { return this.state.error ? <div className="workspace-module-unavailable"><h2>工作模块暂时不可用</h2><p>{this.state.error}</p><ActionButton onClick={this.props.onManage}>管理模块</ActionButton></div> : this.props.children; }
}
export function OptionalWritingWorkbench(props: WritingWorkbenchProps) {
  const [Component, setComponent] = useState<React.ComponentType<WritingWorkbenchProps> | null>(null), [error, setError] = useState(""), [manage, setManage] = useState(false);
  const revision = useModuleRevision();
  useEffect(() => { let active = true; setError(""); setComponent(null); void loadWritingModule().then(async m => { if (!active) return; await props.onRefresh(); if (active) setComponent(() => m.default); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [revision, props.projectId]);
  return <><ModuleBoundary key={`${props.projectId}:${revision}`} onManage={() => setManage(true)}>{Component ? <Component {...props} /> : <div className="workspace-module-unavailable"><h2>{error ? "安装工作模块后继续" : "正在打开工作模块…"}</h2>{error ? <><p>{error}</p><p>已有项目和文档已保留。</p><ActionButton onClick={() => setManage(true)}>管理模块</ActionButton></> : null}</div>}</ModuleBoundary>{manage ? <ModuleManager onClose={() => setManage(false)} /> : null}</>;
}

// The patch review is optional module UI too: a failed import must never reach
// the application root or silently accept/reject an outstanding user decision.
export function OptionalWritingPatchReviewDialog(props: React.ComponentProps<typeof import("./writing-workbench").WritingPatchReviewDialog>) {
  const [Component, setComponent] = useState<React.ComponentType<typeof props> | null>(null);
  const [error, setError] = useState(""), [dismissed, setDismissed] = useState(false), [manage, setManage] = useState(false);
  const revision = useModuleRevision();
  useEffect(() => { let active = true; setError(""); setComponent(null); void loadWritingModule().then(m => { if (active) setComponent(() => m.WritingPatchReviewDialog); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [revision]);
  if (dismissed) return null;
  return <><ModuleBoundary key={revision} onManage={() => setManage(true)}>{Component ? <Component {...props} /> : error ? <DialogShell surface="writing-module-error" ariaLabel="工作模块暂时不可用" onRequestClose={() => setDismissed(true)}>
    {({ requestClose }) => <><SurfaceHeader title="工作模块暂时不可用" onClose={() => requestClose("close-button")} /><SurfaceBody><InlineNotice tone="danger">{error}</InlineNotice><p>待审核的修改已保留，安装模块后会自动重试。</p></SurfaceBody><SurfaceFooter><ActionButton onClick={() => setManage(true)}>管理模块</ActionButton><ActionButton onClick={() => requestClose("action")}>关闭</ActionButton></SurfaceFooter></>}
  </DialogShell> : null}</ModuleBoundary>{manage ? <ModuleManager onClose={() => setManage(false)} /> : null}</>;
}
