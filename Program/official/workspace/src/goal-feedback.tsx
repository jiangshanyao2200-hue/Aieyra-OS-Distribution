import { useState } from "react";
import { ActionButton } from "./ui";

import type { GoalFeedbackNote } from "../shared/goal-feedback.mjs";
export type { GoalFeedbackNote } from "../shared/goal-feedback.mjs";
export { sanitizeGoalFeedback } from "../shared/goal-feedback.mjs";
export function GoalFeedbackPanel({ value, busy, onChange, onSubmit, onDisable }: {
  value: GoalFeedbackNote; busy: boolean; onChange(patch: Partial<GoalFeedbackNote>): void;
  onSubmit(satisfied: boolean): Promise<void>; onDisable(): Promise<void>;
}) {
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  async function act(run: () => Promise<void>) {
    if (pending || busy) return;
    setPending(true); setError("");
    try { await run(); } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setPending(false); }
  }
  return <section className="goal-feedback-panel" aria-label="目标成果反馈" data-goal-feedback={value.checkpointId}
    onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}
    onKeyDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}>
    <p className="goal-feedback-objective" title={value.objective}>{value.objective}</p>
    <p>{value.satisfied ? "已记录满意，这个目标已完成。" : value.submitted ? "反馈已保存，可以沿着连线查看后续成果。" : value.question}</p>
    <label>满意的地方 · 下一轮保留<textarea aria-label="满意并保留的地方" value={value.keep} maxLength={4000}
      placeholder="例如人物气质、构图或配色…" disabled={pending} onChange={e => onChange({ keep: e.target.value, submitted: false, satisfied: false })} /></label>
    <label>需要改进的地方<textarea aria-label="需要改进的地方" value={value.change} maxLength={4000}
      placeholder="描述哪里不满意，以及你希望怎样调整…" disabled={pending} onChange={e => onChange({ change: e.target.value, submitted: false, satisfied: false })} /></label>
    <div className="goal-feedback-actions">
      <ActionButton disabled={busy || pending || value.satisfied} onClick={() => void act(() => onSubmit(true))}>满意，完成目标</ActionButton>
      <ActionButton variant="primary" disabled={busy || pending || !value.change.trim() || value.submitted} onClick={() => void act(() => onSubmit(false))}>按反馈改进</ActionButton>
    </div>
    <button type="button" className="goal-feedback-disable" disabled={pending || busy || value.notesDisabled}
      onClick={() => void act(onDisable)}>{value.notesDisabled ? "后续通过聊天反馈 · 目标记录保留" : "后续通过聊天反馈，不再新建便签"}</button>
    {error ? <p role="alert" className="requirement-node-error">{error}</p> : null}
  </section>;
}
