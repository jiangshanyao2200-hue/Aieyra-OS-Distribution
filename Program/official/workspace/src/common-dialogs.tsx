import { type FormEvent } from "react";
import { Check, Plus, Shield, Trash2, X } from "./studio-icons";
import { type ConfirmDialogDraft, type ImageQuotaDialogState, type ProjectNameDraft, type WritingProposal, yuan } from "./core";
import { ActionButton, DialogShell, Field, SurfaceBody, SurfaceFooter, SurfaceHeader } from "./ui";
import type { ProjectSurface } from "./project-capabilities";

const CLOSE_BUTTON_REASON = "close-button" as const;
const WHEN_IDLE = "when-idle" as const;



export function ProjectNameDialog({
  draft,
  setDraft,
  close,
  submit,
  busy
}: {
  draft: ProjectNameDraft;
  setDraft: (draft: ProjectNameDraft | null) => void;
  close: () => void;
  submit: () => void | Promise<void>;
  busy: boolean;
  projectSurface: ProjectSurface;
}) {
  const isRename = draft.mode === "rename";
  const title = isRename ? "重命名项目" : draft.location === "folder" ? "在文件夹中新建项目" : "新建项目";
  const submitLabel = isRename ? "保存" : "创建";
  const creationEnabled = Boolean(draft.name.trim());
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !creationEnabled) return;
    await submit();
  }

  return (
    <><DialogShell
      surface="project-name"
      ariaLabel={title}
      className={`project-create-dialog ${isRename ? "rename-only" : "with-project-kinds"}`}
      busy={busy}
      closePolicy={{ escape: WHEN_IDLE, backdrop: WHEN_IDLE, [CLOSE_BUTTON_REASON]: WHEN_IDLE }}
      onRequestClose={close}
    >
      {({ requestClose }) => (
        <>
          <SurfaceHeader
            title={title}
            onClose={() => requestClose(CLOSE_BUTTON_REASON)}
            closeLabel={`关闭${title}`}
            closeDisabled={busy}
          />
          <SurfaceBody className="project-create-body">
            <form id="project-name-form" onSubmit={handleSubmit} className="project-create-form">
              <Field label="项目名称">
                <input
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value, error: undefined })}
                  autoFocus
                  maxLength={60}
                  placeholder="例如：产品主视觉"
                />
              </Field>
              {draft.error ? <p role="alert">{draft.error}</p> : null}
            </form>
          </SurfaceBody>
          <SurfaceFooter>
            <ActionButton onClick={() => requestClose("action")} disabled={busy}>取消</ActionButton>
            <ActionButton variant="primary" type="submit" form="project-name-form" busy={busy} disabled={!creationEnabled} icon={<Plus size={16} />}>
              {submitLabel}
            </ActionButton>
          </SurfaceFooter>
        </>
      )}
    </DialogShell></>
  );
}

export function QuotaDialog({
  quota,
  close,
  openAccount
}: {
  quota: ImageQuotaDialogState;
  close: () => void;
  openAccount: () => void;
}) {
  return (
    <DialogShell surface="quota" ariaLabel="余额不足" className="quota-dialog" onRequestClose={close}>
      {({ requestClose }) => (
        <>
          <SurfaceHeader title="余额不足" onClose={() => requestClose(CLOSE_BUTTON_REASON)} />
          <SurfaceBody>
            <div className="quota-summary">
              <strong>
                本次生图需要支付 {yuan(quota.requiredCents)}，
                {quota.balanceCents === null ? "余额以所选 Key 的实时响应为准" : `当前余额 ${yuan(quota.balanceCents)}`}。
              </strong>
              <p>
                请求 {quota.requestedCount} 张，试用额度抵扣 {quota.trialImagesUsed} 张，剩余 {quota.paidImages} 张按 {yuan(quota.imageCostCents)} / 张计费。
              </p>
              <div>
                <span>{quota.deficitCents === null ? "差额" : "还差"}</span>
                <em>{quota.deficitCents === null ? "由所选 Key 的实时响应判定" : yuan(quota.deficitCents)}</em>
              </div>
            </div>
          </SurfaceBody>
          <SurfaceFooter>
            <ActionButton onClick={() => requestClose("action")}>知道了</ActionButton>
            <ActionButton variant="primary" onClick={openAccount} icon={<Shield size={16} />}>打开账户</ActionButton>
          </SurfaceFooter>
        </>
      )}
    </DialogShell>
  );
}

export function ConfirmDialog({
  draft,
  busy,
  close,
  submit
}: {
  draft: ConfirmDialogDraft;
  busy: boolean;
  close: () => void;
  submit: () => void;
}) {
  return (
    <DialogShell
      surface="confirm"
      ariaLabel={draft.title}
      className={`confirm-dialog ${draft.tone === "danger" ? "danger" : ""}`}
      busy={busy}
      closePolicy={{ escape: WHEN_IDLE, backdrop: WHEN_IDLE, [CLOSE_BUTTON_REASON]: WHEN_IDLE }}
      onRequestClose={close}
    >
      {({ requestClose }) => (
        <>
          <SurfaceHeader
            eyebrow={draft.eyebrow}
            title={draft.title}
            onClose={() => requestClose(CLOSE_BUTTON_REASON)}
            closeDisabled={busy}
          />
          <SurfaceBody>
            <div className="confirm-summary">
              <strong>{draft.message}</strong>
              {draft.detail ? <p>{draft.detail}</p> : null}
              {draft.tone === "danger" ? <small>此操作不可从 Aieyra Workspace 内恢复。</small> : null}
            </div>
          </SurfaceBody>
          <SurfaceFooter>
            <ActionButton onClick={() => requestClose("action")} disabled={busy}>取消</ActionButton>
            <ActionButton
              variant={draft.tone === "danger" ? "danger" : "primary"}
              onClick={submit}
              busy={busy}
              icon={draft.tone === "danger" ? <Trash2 size={16} /> : <Check size={16} />}
            >
              {draft.confirmLabel}
            </ActionButton>
          </SurfaceFooter>
        </>
      )}
    </DialogShell>
  );
}

export function WritingProposalDialog({
  proposal,
  busy,
  error,
  accept,
  reject
}: {
  proposal: WritingProposal;
  busy: boolean;
  error?: string;
  accept: () => void;
  reject: () => void;
}) {
  const revisionLabel = proposal.expectedRevision > 0
    ? `基于 revision ${proposal.expectedRevision}`
    : "新建写作成果";
  const operationLabel = proposal.operationCount > 0 ? `${proposal.operationCount} 项修改` : "结构化写入";
  const wordLabel = proposal.wordCount > 0 ? `约 ${proposal.wordCount} 字` : "字数待写入";

  return (
    <DialogShell
      surface="writing-proposal"
      ariaLabel="确认 Writing Agent 修改提案"
      className="writing-proposal-dialog"
      busy={busy}
      closePolicy={{ escape: "never", backdrop: "never", [CLOSE_BUTTON_REASON]: "never", action: "never" }}
      onRequestClose={() => undefined}
    >
      <SurfaceHeader
        eyebrow="Writing Agent 提案"
        title={proposal.title || "确认写入内容"}
        description="接受后才会写入目标项目；拒绝不会修改正文或 revision。"
      />
      <SurfaceBody className="writing-proposal-body">
        <div className="writing-proposal-summary">
          <span>{proposal.artifactKind || "document"}</span>
          <span>{proposal.action || "patch"}</span>
          <span>{revisionLabel}</span>
          <span>{operationLabel}</span>
          <span>{wordLabel}</span>
        </div>
        {proposal.summary ? <p className="writing-proposal-description">{proposal.summary}</p> : null}
        {proposal.beforePreview || proposal.afterPreview ? (
          <div className="writing-proposal-previews">
            <section>
              <strong>写入前</strong>
              <pre>{proposal.beforePreview || "（新建内容）"}</pre>
            </section>
            <section>
              <strong>写入后</strong>
              <pre>{proposal.afterPreview || "（无预览）"}</pre>
            </section>
          </div>
        ) : null}
        {error ? <p className="writing-proposal-error" role="alert">{error}</p> : null}
      </SurfaceBody>
      <SurfaceFooter>
        <ActionButton variant="secondary" disabled={busy} onClick={reject} icon={<X size={16} />}>拒绝</ActionButton>
        <ActionButton variant="primary" busy={busy} disabled={busy} onClick={accept} icon={<Check size={16} />}>接受并写入</ActionButton>
      </SurfaceFooter>
    </DialogShell>
  );
}
