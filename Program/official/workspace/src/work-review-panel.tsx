import { useEffect, useRef, useState, type ReactNode } from "react";
import type { WorkReviewState } from "../shared/work-review.mjs";
import { ActionButton } from "./ui";
export type WorkReviewDecision = { artifactId: string; reviewKey: string; action: "confirm" | "revise"; feedback?: string };
export function StageReviewDisclosure({ title, summary, children, collapseKey, artifactId }: {
  title: string; summary: string; children: ReactNode; collapseKey: string; artifactId?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [collapseKey]);
  return <details className="work-review-panel" data-work-review={artifactId} open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary className="work-review-summary" aria-label="展开或收起阶段核对">
      <strong>{title}</strong><span title={summary}>{summary}</span><small>{expanded ? "收起" : "展开核对"}</small>
    </summary>
    <div className="work-review-body">{children}</div>
  </details>;
}
export function WorkReviewPanel({ review, busy, onDecide }: { review: WorkReviewState; busy: boolean; onDecide(input: WorkReviewDecision): Promise<void> }) {
  const [feedback, setFeedback] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  async function submit(action: "confirm" | "revise") {
    if (submitting.current || busy) return;
    submitting.current = true;
    setPending(true); setError("");
    try { await onDecide({ artifactId: review.artifactId, reviewKey: review.reviewKey, action, feedback }); setFeedback(""); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { submitting.current = false; setPending(false); }
  }
  return <StageReviewDisclosure artifactId={review.artifactId} collapseKey={`${review.artifactId}:${review.reviewKey}:${review.confirmed}`}
    title={review.confirmed ? "本阶段已确认" : review.changed ? "当前版本待核对" : "本阶段待核对"} summary={review.question}>
    <p>{review.question}</p><small>下一步：{review.nextStep}</small>
    {review.feedback ? <p>你的反馈：{review.feedback}</p> : null}
    {!review.confirmed ? <><textarea aria-label="阶段修改意见" placeholder="需要调整的内容，可以直接写在这里…" value={feedback} maxLength={2000} disabled={pending || busy} onChange={event => setFeedback(event.target.value)} />
      <div className="work-review-actions"><ActionButton disabled={pending || busy || !feedback.trim()} onClick={() => void submit("revise")}>提出修改</ActionButton>
        <ActionButton variant="primary" disabled={pending || busy} onClick={() => void submit("confirm")}>确认并继续</ActionButton></div></> : null}
    {error ? <p role="alert">{error}</p> : null}
  </StageReviewDisclosure>;
}
