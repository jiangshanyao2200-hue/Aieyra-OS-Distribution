import { useEffect, useId, useMemo, useState } from "react";
import { Check, RotateCcw } from "./studio-icons";
import { RefreshCw, ShieldCheck } from "./studio-icons-lazy";
import type {
  ProjectRecoveryAssessment,
  ProjectRecoveryCandidateDescriptor,
  ProjectRecoveryReceiptDescriptor
} from "./core";
import {
  ActionButton,
  DialogShell,
  InlineNotice,
  SurfaceBody,
  SurfaceFooter,
  SurfaceHeader
} from "./ui";
import "./project-recovery-dialog.css";

export type ProjectRecoveryDialogProps = {
  assessment: ProjectRecoveryAssessment;
  busy: boolean;
  onClose: () => void;
  onRefresh: () => void | Promise<void>;
  onRecover: (ids: string[]) => void | Promise<void>;
  onRollback: (transactionId: string) => void | Promise<void>;
};

const CLOSE_BUTTON_REASON = "close-button" as const;
const WHEN_IDLE = "when-idle" as const;
const MAX_SELECTION = 20;

const STATUS_LABELS: Record<ProjectRecoveryCandidateDescriptor["status"], string> = {
  recoverable: "可找回",
  registered: "已登记",
  "unknown-kind": "兼容查看",
  conflict: "存在冲突",
  corrupt: "无法读取",
  unsafe: "安全限制"
};

function byteLabel(byteSize: number) {
  const safeSize = Number.isFinite(byteSize) && byteSize > 0 ? byteSize : 0;
  if (safeSize < 1024) return `${safeSize} B`;
  if (safeSize < 1024 ** 2) return `${(safeSize / 1024).toFixed(1)} KB`;
  if (safeSize < 1024 ** 3) return `${(safeSize / (1024 ** 2)).toFixed(1)} MB`;
  return `${(safeSize / (1024 ** 3)).toFixed(1)} GB`;
}

function countLabel(count: number) {
  const safeCount = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  return `${safeCount} 个文件`;
}

function receiptTimeLabel(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "已完成";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(timestamp);
}

function selectableCandidate(candidate: ProjectRecoveryCandidateDescriptor) {
  return candidate.selectable && candidate.status === "recoverable";
}

function riskLabel(candidate: ProjectRecoveryCandidateDescriptor) {
  if (candidate.status === "recoverable") return "确认后加入项目列表，原目录与内容保持不动。";
  const risks = new Set(candidate.risk);
  if (risks.has("unknown-project-kind")) return "当前版本不识别此项目类型，内容将保持原样。";
  if (risks.has("project-list-missing-directory")) return "项目索引指向的本地目录不存在。";
  if (risks.has("project-list-identity-conflict")) return "项目身份与现有索引冲突，需要手动核对。";
  if (candidate.status === "unsafe") return "目录包含链接、硬链接或不受支持的实体，已停止处理。";
  if (candidate.status === "corrupt") return "项目清单或会话无法安全解析。";
  return "当前项目不能自动恢复。";
}

export default function ProjectRecoveryDialog({
  assessment,
  busy,
  onClose,
  onRefresh,
  onRecover,
  onRollback
}: ProjectRecoveryDialogProps) {
  const titleId = useId();
  const selectionHintId = useId();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const candidates = useMemo(
    () => (assessment.candidates ?? []).filter((candidate) => candidate.status !== "registered"),
    [assessment.candidates]
  );
  const selectableIds = useMemo(
    () => new Set(candidates.filter(selectableCandidate).map((candidate) => candidate.id)),
    [candidates]
  );

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => selectableIds.has(id)).slice(0, MAX_SELECTION));
  }, [selectableIds]);

  const selectionLimitReached = selectedIds.length >= MAX_SELECTION;
  const selectedCount = selectedIds.length;
  const hasAssessment = candidates.length > 0 || assessment.committedReceipts.length > 0;

  function toggleCandidate(candidate: ProjectRecoveryCandidateDescriptor) {
    if (busy || !selectableCandidate(candidate)) return;
    setSelectedIds((current) => {
      if (current.includes(candidate.id)) return current.filter((id) => id !== candidate.id);
      if (current.length >= MAX_SELECTION) return current;
      return [...current, candidate.id];
    });
  }

  async function refresh() {
    if (!busy) await onRefresh();
  }

  async function recoverSelected() {
    if (busy || !selectedIds.length) return;
    await onRecover(selectedIds);
  }

  async function rollback(receipt: ProjectRecoveryReceiptDescriptor) {
    if (busy || !receipt.rollbackAvailable) return;
    await onRollback(receipt.transactionId);
  }

  return (
    <DialogShell
      surface="project-recovery"
      ariaLabelledBy={titleId}
      className="project-recovery-dialog"
      busy={busy}
      closePolicy={{ escape: WHEN_IDLE, backdrop: WHEN_IDLE, [CLOSE_BUTTON_REASON]: WHEN_IDLE }}
      onRequestClose={onClose}
    >
      {({ requestClose }) => (
        <>
          <SurfaceHeader
            titleId={titleId}
            eyebrow="本地项目"
            title="找回本地项目"
            description="先盘点，再选择要恢复的项目。"
            onClose={() => requestClose(CLOSE_BUTTON_REASON)}
            closeDisabled={busy}
          />
          <SurfaceBody className="project-recovery-body">
            {assessment.error ? (
              <InlineNotice tone="danger" role="alert">
                {assessment.error}
              </InlineNotice>
            ) : null}

            <div className="project-recovery-overview" aria-label="盘点结果">
              <span><strong>{assessment.total}</strong> 已盘点</span>
              <span className="is-recoverable"><strong>{assessment.recoverable}</strong> 可找回</span>
              <span className={assessment.blocked > 0 ? "is-blocked" : ""}><strong>{assessment.blocked}</strong> 需处理</span>
            </div>

            {!hasAssessment && !assessment.error ? (
              <div className="project-recovery-empty" role="status">
                <ShieldCheck size={18} aria-hidden="true" />
                <div>
                  <strong>没有需要找回的本地项目</strong>
                  <span>此操作不会修改现有项目。</span>
                </div>
              </div>
            ) : null}

            {candidates.length > 0 ? (
              <section className="project-recovery-candidates" aria-labelledby={selectionHintId}>
                <div className="project-recovery-list-heading">
                  <div>
                    <strong id={selectionHintId}>可恢复项目</strong>
                    <small>{selectedCount > 0 ? `已选择 ${selectedCount} 项` : "仅可恢复项可选择"}</small>
                  </div>
                  {selectionLimitReached ? <em>最多 {MAX_SELECTION} 项</em> : null}
                </div>
                <div className="project-recovery-list" role="list">
                  {candidates.map((candidate) => {
                    const selectable = selectableCandidate(candidate);
                    const selected = selectedIds.includes(candidate.id);
                    const disabledByLimit = selectable && !selected && selectionLimitReached;
                    const itemDisabled = !selectable || busy || disabledByLimit;
                    return (
                      <label
                        key={candidate.id}
                        className={`project-recovery-item ${selected ? "is-selected" : ""} ${selectable ? "is-recoverable" : "is-blocked"}`}
                        data-project-recovery-candidate={candidate.id}
                        aria-disabled={itemDisabled || undefined}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={itemDisabled}
                          onChange={() => toggleCandidate(candidate)}
                          aria-describedby={`${candidate.id}-recovery-meta`}
                        />
                        <span className="project-recovery-item-copy">
                          <span className="project-recovery-item-title">
                            <strong>{candidate.name || "未命名项目"}</strong>
                            <em>{STATUS_LABELS[candidate.status]}</em>
                          </span>
                          <small id={`${candidate.id}-recovery-meta`}>
                            {candidate.kind || "未知类型"} · {countLabel(candidate.fileCount)} · {byteLabel(candidate.byteLength)}
                          </small>
                          <span>{riskLabel(candidate)}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {assessment.committedReceipts.length > 0 ? (
              <section className="project-recovery-receipts" aria-labelledby={`${titleId}-receipts`}>
                <div className="project-recovery-list-heading">
                  <div>
                    <strong id={`${titleId}-receipts`}>最近恢复</strong>
                    <small>仅在项目尚未变化时可回滚。</small>
                  </div>
                </div>
                <div className="project-recovery-receipt-list">
                  {assessment.committedReceipts.map((receipt) => (
                    <div key={receipt.transactionId} className="project-recovery-receipt">
                      <div>
                        <strong>{receipt.displayName || "本地项目"}</strong>
                        <small>{receipt.summary || receiptTimeLabel(receipt.completedAt)}</small>
                      </div>
                      {receipt.rollbackAvailable ? (
                        <ActionButton
                          variant="ghost"
                          busy={busy}
                          onClick={() => void rollback(receipt)}
                          icon={<RotateCcw size={14} />}
                        >
                          回滚
                        </ActionButton>
                      ) : <span className="project-recovery-receipt-locked">已锁定</span>}
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </SurfaceBody>
          <SurfaceFooter
            leading={(
              <ActionButton variant="ghost" busy={busy} onClick={() => void refresh()} icon={<RefreshCw size={15} />}>
                重新盘点
              </ActionButton>
            )}
          >
            <ActionButton onClick={() => requestClose("action")} disabled={busy}>取消</ActionButton>
            <ActionButton
              variant="primary"
              busy={busy}
              disabled={selectedCount === 0}
              onClick={() => void recoverSelected()}
              icon={<Check size={16} />}
            >
              恢复所选{selectedCount > 0 ? `（${selectedCount}）` : ""}
            </ActionButton>
          </SurfaceFooter>
        </>
      )}
    </DialogShell>
  );
}
