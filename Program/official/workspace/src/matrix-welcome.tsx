import { useEffect, useRef, useState } from "react";
import type { MatrixWelcomeResult } from "./core";
import { ActionButton } from "./ui";

type Welcome = MatrixWelcomeResult | { status: "loading"; text?: string; error?: string; model?: string };
export function useMatrixWelcome({ projectId, conversationId, model, identity, active, eligible, connected }: {
  projectId: string; conversationId: string; model: string; identity: string; active: boolean; eligible: boolean; connected: boolean;
}) {
  const key = JSON.stringify([projectId, conversationId, identity, model]);
  const [value, setValue] = useState<{ key: string; result: Welcome } | null>(null);
  const latest = useRef(key); latest.current = key;
  const current = value?.key === key ? value.result : null;
  useEffect(() => {
    if (!active || !eligible || !connected) return;
    let disposed = false;
    setValue(previous => previous?.key === key ? previous : { key, result: { status: "loading" } });
    void window.aieyraAgent!.welcome({ projectId, conversationId, model }).then(result => {
      if (!disposed && latest.current === key) setValue({ key, result });
    }).catch(error => {
      if (!disposed && latest.current === key) setValue({ key, result: { ok: false, status: "error", error: error.message } });
    });
    return () => { disposed = true; };
  }, [key, projectId, conversationId, model, active, eligible, connected]);
  const stop = async () => {
    if (current?.status !== "loading") return;
    await window.aieyraAgent!.welcome({ projectId, conversationId, model, cancel: true });
  };
  return {
    result: !connected ? { ok: true, status: "offline", text: "请在联系人中为画布 Agent 配置模型，然后在这里开始创作。" } as Welcome : current,
    busy: eligible && connected && current?.status === "loading", stop
  };
}

export function MatrixWelcome({ result, connect, name='画布 Agent', avatar }: { result: Welcome | null; connect?: () => void; name?:string; avatar?:string }) {
  const status = result?.status || "loading";
  const text = status === "loading" ? "正在读取程序状态…" : status === "error" ? "暂时没能连接到模型。检查连接后，就可以继续对话。" : status === "stopped" ? "随时告诉我，你想做些什么。" : result?.text;
  return <section className={`matrix-welcome is-${status}`} aria-label={`${name} 欢迎`} aria-live="polite" aria-busy={status === "loading"}>
    <header className="matrix-welcome-identity"><div className="matrix-welcome-mark" aria-hidden="true"><img src={avatar||"./aieyra-workspace.png"} alt="" /></div><div><strong>{name}</strong><span className="matrix-welcome-eyebrow">你的画布伙伴</span></div></header>
    <p className="matrix-welcome-message">{text}</p>
    {status === "ready" ? <small className="matrix-welcome-connected"><i aria-hidden="true" /><span>已连接</span><span className="matrix-welcome-model" title={result?.model}>{result?.model}</span></small> : null}
    {status === "error" && result?.error ? <details className="matrix-welcome-error"><summary>连接详情</summary><p>{result.error}</p></details> : null}
    {status === "offline" || status === "error" ? <ActionButton variant="ghost" onClick={connect}>连接模型</ActionButton> : null}
  </section>;
}
