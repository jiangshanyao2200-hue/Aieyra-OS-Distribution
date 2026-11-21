import { Trash2 } from "./studio-icons";
import {
  ActionButton,
  ButtonBase,
  DialogShell,
  InlineNotice,
  SurfaceBody,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceSection
} from "./ui";

export type ProjectResetLevel = "conversation" | "canvas" | "all";

export type ProjectResetDraft = {
  level?: ProjectResetLevel;
  confirmAll?: boolean;
  busy?: boolean;
  error?: string;
};

export default function ProjectResetDialog({
  draft,
  projectName,
  projectKind,
  close,
  reset,
  back
}: {
  draft: ProjectResetDraft;
  projectName: string;
  projectKind?: string;
  close: () => void;
  reset: (level: ProjectResetLevel) => void | Promise<void>;
  back: () => void;
}) {
  const busy = draft.busy === true;
  const writing = projectKind === "writing";
  const lineage = projectKind === "data" || projectKind === "finance";
  return (
    <DialogShell surface="project-reset" ariaLabel="重置当前项目" className="project-reset-dialog" onRequestClose={() => !busy && close()}>
      {({ requestClose }) => (
        <>
          <SurfaceHeader
            title={draft.confirmAll ? "再次确认全部重置" : "重置当前项目"}
            description={projectName}
            onClose={() => requestClose("close-button")}
            closeLabel="关闭重置项目"
            closeDisabled={busy}
          />
          <SurfaceBody className="project-reset-body">
            {draft.confirmAll ? (
              <SurfaceSection className="project-reset-final-warning">
                <strong>这会清空当前项目的本地记录、画布和程序托管文件。</strong>
                <p>画布 Agent 的跨项目聊天历史保留。</p>
                <p>{writing
                  ? "将删除项目内托管的来源文档、写作副本、历史版本与导出文件；项目文件夹、项目清单和目录中的其他用户文件会保留。"
                  : lineage
                    ? "将删除项目内托管的数据来源、分析成果历史版本与导出文件；项目文件夹、项目清单和目录中的其他用户文件会保留。"
                    : "将删除项目内托管的图片成果、素材副本与缩略图缓存；项目文件夹、项目清单和目录中的其他用户文件会保留。"}</p>
                <InlineNotice tone="danger">此操作无法撤销。请确认项目中需要保留的成果已经另行导出。</InlineNotice>
              </SurfaceSection>
            ) : (
              <div className="project-reset-options">
                <ButtonBase className="ui-choice-row" data-ui-choice-layout="list" type="button" onClick={() => void reset("conversation")} disabled={busy}>
                  <span>1</span>
                  <div><strong>仅重置本项目记录</strong><small>{writing
                    ? "清空当前对话、历史记录、摘要与对话记忆；保留写作成果、关系和托管文档。"
                    : lineage
                      ? "清空当前对话、历史记录、摘要与对话记忆；保留分析成果、关系和托管文件。"
                      : "清空本项目的本地记录和引用；保留画布、图片与画布 Agent 的跨项目聊天历史。"}</small></div>
                </ButtonBase>
                <ButtonBase className="ui-choice-row" data-ui-choice-layout="list" type="button" onClick={() => void reset("canvas")} disabled={busy}>
                  <span>2</span>
                  <div><strong>重置本项目记录和画布</strong><small>{writing
                    ? "同时清空写作成果的画布投影、关系与布局；项目内托管的写作文件仍会保留。"
                    : lineage
                      ? "同时清空分析成果的画布投影、关系与布局；项目内托管的来源与历史版本仍会保留。"
                      : "同时清空画布节点与关系；项目托管图片文件仍保留在磁盘。"}</small></div>
                </ButtonBase>
                <ButtonBase className="ui-choice-row danger" data-ui-choice-layout="list" type="button" onClick={() => void reset("all")} disabled={busy}>
                  <span>3</span>
                  <div><strong>全部重置</strong><small>{writing
                    ? "再清理托管的来源文档、写作副本、历史版本与导出文件，项目文件夹本身保留。"
                    : lineage
                      ? "再清理托管的数据来源、分析成果历史版本与导出文件，项目文件夹本身保留。"
                      : "再清理项目托管输出、导入副本与缩略图缓存，项目文件夹本身保留。"}</small></div>
                </ButtonBase>
              </div>
            )}
            {draft.error ? <InlineNotice tone="danger">{draft.error}</InlineNotice> : null}
          </SurfaceBody>
          {draft.confirmAll ? (
            <SurfaceFooter>
              <ActionButton variant="secondary" onClick={back} disabled={busy}>返回选择</ActionButton>
              <ActionButton variant="danger" busy={busy} icon={<Trash2 size={15} />} onClick={() => void reset("all")}>确认全部重置</ActionButton>
            </SurfaceFooter>
          ) : null}
        </>
      )}
    </DialogShell>
  );
}
