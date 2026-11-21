import { workspaceReferenceCode } from "../shared/workspace-references.mjs";
import { ProjectTransferMenu } from "./project-transfer-menu";
import { imageAssetThumbnailSrc } from "./core";
import { WritingHtmlCard } from "./writing-html-card";
import { WritingOfficePreview } from "./writing-office-preview";
import { WRITING_DEMAND_CATEGORIES, isNovelRoot, isNovelInternal, novelReviewState, novelParts, artifactText, type NovelCommand } from "../shared/writing-novel.mjs";
import { lazy, Suspense, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpenText, Brain, Check, Download, Plus, RotateCcw, Search, Send, Trash2, WandSparkles, Workflow, X } from "./studio-icons";
import { Clock3, ExternalLink, FileInput, FileText, History, LoaderCircle, PencilLine, ShieldCheck, UserRound, UsersRound } from "./studio-icons-lazy";
import type { WritingAgentPatchProposal } from "./core";
import {
  ActionButton,
  ButtonBase,
  DialogShell,
  Field,
  InlineNotice,
  MenuItem,
  MenuSeparator,
  MenuSummary,
  MenuSurface,
  SurfaceBody,
  SurfaceFooter,
  SurfaceHeader
} from "./ui";
import type {
  WritingArtifactLayout,
  WritingArtifactKind,
  WritingArtifactRecord,
  WritingArtifactViewport,
  WritingCitationRef,
  WritingPdfWindow,
  WritingParagraphPatch,
  WritingReviewFindingV1,
  WritingSessionFields
} from "./writing-schema";
import {
  ArtifactWorkflowCanvas,
  type ArtifactWorkflowContext
} from "./artifact-workflow-canvas";
import {
  completeArtifactWorkflowLayout,
  isPristineArtifactWorkflowViewport
} from "./canvas-platform-viewport";
import { CanvasPlatformEmptyState, useArtifactWorkflowCommit } from "./canvas-platform";
import RichMarkdownMessage from "./markdown";
import { workReviewState } from "../shared/work-review.mjs";
import { WorkReviewPanel, type WorkReviewDecision } from "./work-review-panel";
import writingTemplateRegistry from "virtual:aieyra-writing-template-registry/workbench";
import "./writing-workbench.css";

// Opening the canvas must not initialize or fetch the document editor engine.
const WritingNovelPanel = lazy(() => import("./writing-novel-panel"));
const WritingDocumentEditor = lazy(() => import("./writing-text-editor").then((module) => ({ default: module.WritingDocumentEditor })));

type MaybePromise<T = void> = T | Promise<T>;
const WB_BUTTON = "writing-workbench__button";
const WB_EYEBROW = "writing-workbench__eyebrow";

type ParagraphDraftOrigin = {
  key: string;
  artifactId: string;
  paragraphId: string;
  expectedRevision: number;
  text: string;
};

export type WritingWorkbenchProps = {
  transferProjects?: { id: string; name: string; kind?: string }[];
  onTransfer?: (nodeIds: string[], target: string, mode: "copy" | "move") => Promise<unknown>;
  projectId: string;
  projectName: string;
  template?: string;
  session: WritingSessionFields;
  busy: boolean;
  error?: string;
  onImport: (input?: { paths?: string[]; canvasPosition?: { x: number; y: number } }) => MaybePromise;
  onNovel: (input: NovelCommand) => Promise<WritingArtifactRecord>;
  onWorkReview: (input: WorkReviewDecision) => Promise<void>;
  onOpenOffice: (artifact: WritingArtifactRecord) => Promise<void>;
  onIllustration: (input: import("./writing-schema").WritingIllustrationInput) => Promise<WritingArtifactRecord>;
  onSaveText: (artifactId: string, text: string, expectedRevision: number) => Promise<WritingArtifactRecord>;
  onExportNovel: (novelId: string, revision: number, format: "html" | "docx") => Promise<void>;
  onCreateArtifact: (input: {
    kind: WritingArtifactKind;
    title: string;
    text?: string;
    sourceArtifactIds?: string[];
    attributes?: WritingArtifactRecord["attributes"];
    canvasPosition?: { x: number; y: number };
    summary?: string;
  }) => MaybePromise;
  onConnectArtifacts: (sourceArtifactId: string, targetArtifactId: string, connected?: boolean) => MaybePromise;
  onSelect: (artifactId: string, paragraphId?: string) => MaybePromise;
  onPatch: (artifactId: string, patch: WritingParagraphPatch) => MaybePromise;
  onReadPdfWindow: (input: { artifactId: string; expectedRevision: number; pageNumbers?: number[]; blockIds?: string[] }) => Promise<WritingPdfWindow | null>;
  onRestore: (artifactId: string, expectedRevision: number, revision: number) => MaybePromise;
  onReviewFindingStatus: (artifactId: string, expectedRevision: number, findingId: string, status: "resolved" | "dismissed") => MaybePromise;
  onExport: (artifactId: string, format: "markdown" | "txt" | "html" | "docx" | "pdf") => MaybePromise;
  onRefresh: () => MaybePromise;
  onFocusAgent: () => MaybePromise;
  locateRequest?: { nodeId: string; requestId: string };
  onLocateHandled: (requestId: string) => void;
  onReferenceAgent: (artifactIds: string[]) => MaybePromise;
  onAskAgent: (prompt: string, visiblePrompt?: string) => MaybePromise;
  onCanvasCommit: (projectId: string, layout: WritingArtifactLayout[], viewport: WritingArtifactViewport) => MaybePromise;
  onRegisterDraftCommit?: (commit: (() => Promise<void>) | null) => void;
};

type WritingKindMeta = { label: string; short: string };

type WritingCanvasNodeRole = "writing-request" | "world-building" | "outline" | "character-list" | "character-state" | "chapter" | "review" | "document";

type WritingCanvasCreateDraft = {
  category?: string;
  role: WritingCanvasNodeRole;
  kind: WritingArtifactKind;
  title: string;
  text: string;
  sourceArtifactIds: string[];
  canvasPosition: { x: number; y: number };
  contextNodeId?: string;
};

const WRITING_AI_NEXT_STEPS = [
  ["continue", "继续写作"],
  ["review", "审阅并修订"],
  ["deliver", "整理交付文稿"]
] as const;
const WRITING_EMPTY_DESCRIPTION = "告诉 Agent 想写什么，或导入已有文档。";

type WritingTemplateProfile = {
  id: string;
  label: string;
  requestPlaceholder: string;
  canvasRoles: WritingCanvasNodeRole[];
  kindMeta: Record<WritingArtifactKind, WritingKindMeta>;
};

type WritingTemplateRegistryEntry = {
  id: string;
  label: string;
  requestPlaceholder: string;
  roleMask: number;
  kinds: Record<WritingArtifactKind, WritingKindMeta>;
};

const WRITING_CANVAS_ROLE_VALUES: WritingCanvasNodeRole[] = [
  "writing-request",
  "world-building",
  "outline",
  "character-list",
  "character-state",
  "chapter",
  "review",
  "document"
];

const WRITING_TEMPLATE_REGISTRY = writingTemplateRegistry as unknown as {
  version: number;
  artifactKinds: WritingArtifactKind[];
  templates: WritingTemplateRegistryEntry[];
};

function registryKindMeta(template: WritingTemplateRegistryEntry) {
  return Object.fromEntries(
    Object.entries(template.kinds).map(([kind, value]) => [kind, {
      label: value.label,
      short: value.short
    }])
  ) as Record<WritingArtifactKind, WritingKindMeta>;
}

const WRITING_TEMPLATE_PROFILES = new Map<string, WritingTemplateProfile>(
  WRITING_TEMPLATE_REGISTRY.templates.map((template) => [template.id, {
    id: template.id,
    label: template.label,
    requestPlaceholder: template.requestPlaceholder,
    canvasRoles: WRITING_CANVAS_ROLE_VALUES.filter((_, index) => Boolean(template.roleMask & (1 << index))),
    kindMeta: registryKindMeta(template)
  }])
);

const GENERIC_TEMPLATE = WRITING_TEMPLATE_REGISTRY.templates.find((template) => template.id === "general")
  ?? WRITING_TEMPLATE_REGISTRY.templates[0];
const GENERIC_KIND_META = registryKindMeta(GENERIC_TEMPLATE);

function writingTemplateProfile(value?: string) {
  return WRITING_TEMPLATE_PROFILES.get(String(value || "").trim().toLowerCase())
    ?? WRITING_TEMPLATE_PROFILES.get("general")!;
}

const STATUS_LABELS: Record<WritingArtifactRecord["status"], string> = {
  draft: "草稿",
  running: "处理中",
  ready: "就绪",
  stale: "待更新",
  waiting: "等待",
  error: "错误",
  cancelled: "已取消"
};

const ACTION_LABELS: Record<string, string> = {
  import: "正在导入并校验文件…",
  create: "正在创建并写入 artifact…",
  replace: "正在保存段落 revision…",
  insert: "正在插入段落并创建 revision…",
  delete: "正在删除段落并创建 revision…",
  citation: "正在校验来源并创建 citation revision…",
  "finding-status": "正在更新审校项状态…",
  restore: "正在恢复历史 revision…",
  refresh: "正在刷新 Writing 项目…",
  office: "正在用本机应用打开原件…",
  "export-md": "正在导出 Markdown…",
  "export-txt": "正在导出纯文本…",
  "export-html": "正在导出 HTML…",
  "export-docx": "正在导出 DOCX…",
  "export-pdf": "正在导出 PDF…"
};

const EXPORT_OPTIONS = [
  { format: "markdown", action: "export-md", label: "MD" },
  { format: "txt", action: "export-txt", label: "TXT" },
  { format: "html", action: "export-html", label: "HTML" },
  { format: "docx", action: "export-docx", label: "DOCX" },
  { format: "pdf", action: "export-pdf", label: "PDF", documentOnly: true }
] as const;

const RELATION_LABELS: Record<WritingSessionFields["artifactEdges"][number]["relation"], string> = {
  refines: "细化",
  defines: "定义",
  updates: "状态",
  outlines: "规划",
  describes: "主体约束",
  references: "引用",
  continues: "续写",
  reviews: "审阅",
  assembles: "汇总"
};

const WRITING_NODE_ROLE_KIND: Record<WritingCanvasNodeRole, WritingArtifactKind> = {
  "writing-request": "outline",
  "world-building": "outline",
  outline: "outline",
  "character-list": "character",
  "character-state": "character",
  chapter: "chapter",
  review: "review",
  document: "document"
};

const WRITING_SOURCE_KINDS: Partial<Record<WritingArtifactKind, readonly WritingArtifactKind[]>> = {
  outline: ["outline", "source-document"],
  character: ["outline", "character", "source-document", "chapter"],
  chapter: ["outline", "character", "source-document", "chapter"],
  review: ["outline", "character", "source-document", "chapter"],
  document: ["source-document", "chapter", "review"]
};

const WRITING_REQUIRED_SOURCE_KINDS: Partial<Record<WritingArtifactKind, readonly WritingArtifactKind[]>> = {
  chapter: ["outline", "character", "source-document", "chapter"],
  review: ["chapter"],
  document: ["chapter", "review"]
};

const FINDING_CATEGORY_LABELS: Record<WritingReviewFindingV1["category"], string> = {
  evidence: "证据",
  structure: "结构",
  clarity: "清晰度",
  consistency: "一致性",
  style: "风格",
  grammar: "语法"
};

const FINDING_SEVERITY_LABELS: Record<WritingReviewFindingV1["severity"], string> = {
  info: "建议",
  warning: "需注意",
  error: "需修正"
};

const FINDING_STATUS_LABELS: Record<WritingReviewFindingV1["status"], string> = {
  open: "待处理",
  resolved: "已解决",
  dismissed: "已忽略"
};

function paragraphWordCount(paragraphs: readonly { text: string }[]) {
  const text = paragraphs.map((paragraph) => paragraph.text).join("\n").trim();
  if (!text) return 0;
  const latinWords = text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0;
  const cjkCharacters = text.match(/[\u3400-\u9fff\uf900-\ufaff]/g)?.length ?? 0;
  return latinWords + cjkCharacters;
}

function shortHash(value?: string) {
  return value && value.length >= 10 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value || "—";
}

function formatDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function artifactLabel(
  artifact: WritingArtifactRecord | undefined,
  kindMeta: Record<WritingArtifactKind, WritingKindMeta> = GENERIC_KIND_META
) {
  return artifact ? artifact.title || kindMeta[artifact.kind].label : "未知 artifact";
}

const WRITING_CANVAS_ROLES = new Set<WritingCanvasNodeRole>(WRITING_CANVAS_ROLE_VALUES);

function writingArtifactCanvasRole(
  artifact: WritingArtifactRecord,
  allowedRoles: readonly WritingCanvasNodeRole[] = [...WRITING_CANVAS_ROLES]
): WritingCanvasNodeRole | "source-document" {
  const declared = String(artifact.attributes?.canvasRole || "") as WritingCanvasNodeRole;
  if (allowedRoles.includes(declared) && WRITING_NODE_ROLE_KIND[declared] === artifact.kind) return declared;
  if (artifact.kind === "source-document") return "source-document";
  if (artifact.kind === "character") return "character-list";
  return artifact.kind;
}

function writingArtifactRolePresentation(
  artifact: WritingArtifactRecord,
  kindMeta: Record<WritingArtifactKind, WritingKindMeta>,
  templateProfile: WritingTemplateProfile
) {
  const role = writingArtifactCanvasRole(artifact, templateProfile.canvasRoles);
  const fiction = templateProfile.id === "fiction";
  if (role === "writing-request") return { role, label: "写作需求", short: "需" };
  if (role === "world-building") return { role, label: "故事设定", short: "界" };
  if (role === "character-list") return { role, label: fiction ? "角色列表" : kindMeta.character.label, short: fiction ? "人" : kindMeta.character.short };
  if (role === "character-state") return { role, label: "角色章节状态", short: "态" };
  return { role, label: kindMeta[artifact.kind].label, short: kindMeta[artifact.kind].short };
}

const WRITING_WORKFLOW_COLUMN: Record<WritingArtifactKind, number> = {
  outline: 0,
  character: 0,
  "source-document": 0,
  chapter: 1,
  review: 2,
  document: 3
};

const completeWritingWorkflowLayout = (artifacts: readonly WritingArtifactRecord[], layout: readonly WritingArtifactLayout[]) =>
  completeArtifactWorkflowLayout(artifacts.filter((a) => !isNovelInternal(a)), layout, WRITING_WORKFLOW_COLUMN, 310, 240).map((item) => ({ ...item, width: item.width ?? 276, height: item.height ?? 248 }));

function collisionFreeWritingCanvasPosition(
  desired: { x: number; y: number },
  layout: readonly WritingArtifactLayout[],
  compactContinuation = false
) {
  const nodeWidth = 210;
  const nodeHeight = 92;
  const horizontalStep = nodeWidth + 72;
  const verticalStep = nodeHeight + 36;
  const gap = 24;
  const occupied = layout.map((item) => ({
    left: Number(item.x),
    top: Number(item.y),
    right: Number(item.x) + Number(item.width || nodeWidth),
    bottom: Number(item.y) + Number(item.height || nodeHeight)
  }));
  const placementOrigin = compactContinuation && occupied.length
    ? {
        ...desired,
        // A node-created continuation should grow inside a readable workflow
        // band before expanding farther right. Blank-canvas creation remains
        // completely spatial and keeps the user's exact context position.
        x: Math.min(desired.x, Math.min(...occupied.map((item) => item.left)) + horizontalStep * 3)
      }
    : desired;
  const clear = (candidate: { x: number; y: number }) => occupied.every((item) => (
    candidate.x + nodeWidth + gap <= item.left ||
    candidate.x >= item.right + gap ||
    candidate.y + nodeHeight + gap <= item.top ||
    candidate.y >= item.bottom + gap
  ));
  const rowOffsets = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5];
  for (let column = 0; column < 8; column += 1) {
    for (const row of rowOffsets) {
      const candidate = {
        x: Math.max(-200_000, Math.min(200_000, placementOrigin.x + column * horizontalStep)),
        y: Math.max(-200_000, Math.min(200_000, placementOrigin.y + row * verticalStep))
      };
      if (clear(candidate)) return candidate;
    }
  }
  return {
    x: Math.max(-200_000, Math.min(200_000, placementOrigin.x + horizontalStep * 8)),
    y: Math.max(-200_000, Math.min(200_000, placementOrigin.y))
  };
}

const isImmutableDataReportSnapshot = (artifact?: WritingArtifactRecord) => (
  artifact?.kind === "source-document" && artifact.contentPolicy === "immutable-snapshot"
);

export function WritingPatchReviewDialog({
  proposal,
  busy,
  error,
  accept,
  reject
}: {
  proposal: WritingAgentPatchProposal;
  busy: boolean;
  error: string;
  accept: () => void | Promise<void>;
  reject: () => void | Promise<void>;
}) {
  return (
    <DialogShell
      surface="writing-patch-review"
      ariaLabel="审阅 Writing Agent 修改提案"
      className="writing-patch-review-dialog"
      busy={busy}
      onRequestClose={() => {
        if (!busy) void reject();
      }}
    >
      {({ requestClose }) => (
        <>
          <SurfaceHeader
            eyebrow="WRITING AGENT · 待你决定"
            title="审阅修改提案"
            description={`${proposal.artifactTitle} · ${GENERIC_KIND_META[proposal.artifactKind].label} · 基线 Revision ${proposal.baseRevision}`}
            onClose={() => requestClose("close-button")}
            closeDisabled={busy}
          />
          <SurfaceBody className="writing-patch-review-body">
            <InlineNotice tone="info">接受前不会修改正文、revision 或项目 session；关闭此窗口等同拒绝。</InlineNotice>
            <section className="writing-patch-review-summary" aria-label="提案摘要">
              <strong>{proposal.summary || "Agent 建议应用以下结构化修改。"}</strong>
              <span>{proposal.operationCount} 项 paragraph 操作</span>
            </section>
            <div className="writing-patch-review-changes" aria-label="修改前后对比">
              {proposal.changes.map((change, index) => (
                <article key={`${change.operation}-${index}`} className={`writing-patch-review-change is-${change.operation}`}>
                  <header>
                    <strong>{change.label}</strong>
                    <span>{change.operation === "replace" ? "修改" : change.operation === "delete" ? "删除" : "新增"}</span>
                  </header>
                  {change.before ? (
                    <div className="writing-patch-review-copy is-before">
                      <small>修改前</small>
                      <pre>{change.before}</pre>
                    </div>
                  ) : null}
                  {change.after ? (
                    <div className="writing-patch-review-copy is-after">
                      <small>修改后</small>
                      <pre>{change.after}</pre>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
            {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
          </SurfaceBody>
          <SurfaceFooter>
            <ActionButton variant="secondary" onClick={() => void reject()} disabled={busy} icon={<X size={15} />}>拒绝并保持原文</ActionButton>
            <ActionButton variant="primary" onClick={() => void accept()} busy={busy} icon={<Check size={15} />}>接受并写入新 revision</ActionButton>
          </SurfaceFooter>
        </>
      )}
    </DialogShell>
  );
}

export default function WritingWorkbench({
  projectId,
  projectName,
  transferProjects = [],
  onTransfer,
  template = "general",
  session,
  busy,
  error,
  onImport,
  onWorkReview,
  onNovel,
  onSaveText,
  onIllustration,
  onExportNovel,
  onCreateArtifact,
  onConnectArtifacts,
  onSelect,
  onPatch,
  onReadPdfWindow,
  onRestore,
  onReviewFindingStatus,
  onExport,
  onFocusAgent,
  onReferenceAgent,
  locateRequest,
  onLocateHandled,
  onOpenOffice,
  onAskAgent,
  onCanvasCommit,
  onRegisterDraftCommit
}: WritingWorkbenchProps) {
  const templateProfile = writingTemplateProfile(template);
  const KIND_META = templateProfile.kindMeta;
  const focusEditorCommit = useRef<(() => Promise<void>) | null>(null);
  const visibleArtifacts = useMemo(() => session.artifacts.filter((a) => !isNovelInternal(a)), [session.artifacts]);
  const paragraphEditorId = useId();
  const insertEditorId = useId();
  const searchId = useId();
  const citationSourceId = useId();
  const citationParagraphId = useId();
  const [pendingAction, setPendingAction] = useState("");
  const [canvasLayout, setCanvasLayout] = useState<WritingArtifactLayout[]>(() => completeWritingWorkflowLayout(session.artifacts, session.artifactLayout));
  const [canvasViewport, setCanvasViewport] = useState<WritingArtifactViewport>(() => ({ ...session.artifactViewport }));
  const canvasViewportRef = useRef<WritingArtifactViewport>({ ...session.artifactViewport });
  const pendingCanvasViewportRef = useRef<WritingArtifactViewport | null>(null);
  const [draftText, setDraftText] = useState("");
  const [draftOrigin, setDraftOrigin] = useState<ParagraphDraftOrigin>({
    key: "",
    artifactId: "",
    paragraphId: "",
    expectedRevision: 0,
    text: ""
  });
  const [insertText, setInsertText] = useState("");
  const [searchText, setSearchText] = useState("");
  const [previewTarget, setPreviewTarget] = useState("");
  const [citationSourceArtifactId, setCitationSourceArtifactId] = useState("");
  const [citationSourceParagraphId, setCitationSourceParagraphId] = useState("");
  const [pdfPageNumber, setPdfPageNumber] = useState(1);
  const [pdfWindow, setPdfWindow] = useState<WritingPdfWindow | null>(null);
  const [pdfBlockId, setPdfBlockId] = useState("");
  const [pdfWindowBusy, setPdfWindowBusy] = useState(false);
  const [pdfWindowError, setPdfWindowError] = useState("");
  const [manualToolsOpen, setManualToolsOpen] = useState(false);
  const [advancedDocument, setAdvancedDocument] = useState(false);
  const [canvasFocusOpen, setCanvasFocusOpen] = useState(false);
  const [canvasFocusHost, setCanvasFocusHost] = useState<HTMLDivElement | null>(null);
  const [focusArtifactId, setFocusArtifactId] = useState("");
  const [focusSectionRequest, setFocusSectionRequest] = useState<{ section: string; sequence: number } | undefined>();
  const [canvasMenu, setCanvasMenu] = useState<ArtifactWorkflowContext | null>(null);
  const [createDraft, setCreateDraft] = useState<WritingCanvasCreateDraft | null>(null);
  const [discardDraftDialogOpen, setDiscardDraftDialogOpen] = useState(false);
  const discardDraftContinuationRef = useRef<(() => void) | null>(null);
  const pendingPdfSelectionRef = useRef<{ artifactId: string; blockId: string; pageNumber: number } | null>(null);

  useEffect(() => {
    pendingCanvasViewportRef.current = null;
    setCanvasFocusOpen(false);
    setManualToolsOpen(false);
    setCanvasMenu(null);
    setCreateDraft(null);
  }, [projectId]);

  useEffect(() => {
    discardDraftContinuationRef.current = null;
    setDiscardDraftDialogOpen(false);
  }, [projectId]);

  useEffect(() => {
    if (canvasFocusOpen && session.artifacts.some((artifact) => artifact.id === focusArtifactId)) return;
    if (session.selectedArtifactId) return;
    setCanvasFocusOpen(false);
    setManualToolsOpen(false);
  }, [session.selectedArtifactId, session.artifacts, canvasFocusOpen, focusArtifactId]);

  const artifactById = useMemo(
    () => new Map(session.artifacts.map((artifact) => [artifact.id, artifact])),
    [session.artifacts]
  );
  const visibleEdges = useMemo(() => {
    const ids = new Set(visibleArtifacts.map((artifact) => artifact.id));
    return [
      ...session.artifactEdges.filter((edge) => ids.has(edge.sourceArtifactId) && ids.has(edge.targetArtifactId) && !artifactById.get(edge.targetArtifactId)?.attributes?.novelId),
      ...visibleArtifacts.filter((artifact) => artifact.kind === "chapter" && ids.has(String(artifact.attributes?.novelId)))
        .map((artifact) => ({ id: `novel-owner-${artifact.id}`, sourceArtifactId: String(artifact.attributes!.novelId), targetArtifactId: artifact.id, relation: "outlines" as const }))
    ];
  }, [visibleArtifacts, session.artifactEdges, artifactById]);
  const workReviews = useMemo(() => new Map(session.artifacts.filter(a => a.attributes?.workReviewRequested).map(a => [a.id, workReviewState(session.artifacts, a)!])), [session.artifacts]);
  const novelCards = useMemo(() => new Map(session.artifacts.filter(isNovelRoot).map((root) => {
    const parts = novelParts(session.artifacts, root.id);
    return [root.id, { count: parts.chapters.length, excerpt: artifactText(parts.sections.synopsis) || artifactText(root), label: novelReviewState(session.artifacts, root).label, sections: (["brief", "synopsis", "outline", "characters", "plot"] as const).map(id => ({ id, ready: Boolean(artifactText(parts.sections[id])) })) }];
  })), [session.artifacts]);
  const selectedArtifact = artifactById.get(canvasFocusOpen && focusArtifactId ? focusArtifactId : session.selectedArtifactId) ?? session.artifacts[0];
  useEffect(() => setAdvancedDocument(false), [selectedArtifact?.id]);
  const selectedImmutableSnapshot = isImmutableDataReportSnapshot(selectedArtifact);
  const importedSource = selectedArtifact?.provenance.source;
  const selectedOffice = Boolean(selectedArtifact?.provenance.office || ["doc", "ppt", "pptx"].includes(importedSource?.format || ""));
  const selectedHtml = importedSource?.format === "html" || selectedArtifact?.attributes?.documentFormat === "html";
  const selectedPdf = selectedArtifact?.kind === "source-document" && importedSource?.format === "pdf" ? selectedArtifact : null;
  const hasExplicitArtifactSelection = Boolean(session.selectedArtifactId && artifactById.has(session.selectedArtifactId));
  const selectedRevision = selectedArtifact?.revisions.find((revision) => previewTarget === `${selectedArtifact.id}:${revision.revision}`);
  const isHistoricalPreview = Boolean(selectedRevision);
  const displayedParagraphs = selectedRevision?.paragraphs ?? selectedArtifact?.paragraphs ?? [];
  const displayedReviewFindings = selectedRevision?.reviewFindings ?? selectedArtifact?.reviewFindings ?? [];
  const selectedParagraph = displayedParagraphs.find((paragraph) => paragraph.id === session.selectedParagraphId)
    ?? displayedParagraphs[0];
  const displayedRevision = selectedRevision?.revision ?? selectedArtifact?.revision ?? 0;
  const displayedUpdatedAt = selectedRevision?.createdAt ?? selectedArtifact?.updatedAt;
  const displayedWordCount = paragraphWordCount(displayedParagraphs);
  const selectedDraftRevision = displayedRevision;
  const selectedDraftKey = selectedArtifact && selectedParagraph
    ? `${selectedArtifact.id}:${selectedDraftRevision}:${selectedParagraph.id}:${isHistoricalPreview ? "history" : "current"}`
    : "";
  const draftDirty = Boolean(draftOrigin.key) && draftText !== draftOrigin.text;
  const draftStale = draftDirty && selectedDraftKey !== draftOrigin.key;
  const actionLocked = busy || Boolean(pendingAction);
  const exportDirty = draftDirty && !selectedImmutableSnapshot;

  const askAgentAboutSelected = (label: string) => {
    if (!selectedArtifact || !hasExplicitArtifactSelection || selectedArtifact.status !== "ready") return;
    const message = `@${workspaceReferenceCode("document", selectedArtifact.id)} ${label}`;
    return onAskAgent(message, message);
  };

  const citationSourceArtifacts = useMemo(() => {
    if (!selectedArtifact || !new Set<WritingArtifactKind>(["chapter", "document"]).has(selectedArtifact.kind)) return [];
    const reachable = new Set<string>();
    const pending = [...selectedArtifact.sourceArtifactIds];
    while (pending.length) {
      const id = pending.pop();
      if (!id || reachable.has(id)) continue;
      reachable.add(id);
      const artifact = artifactById.get(id);
      if (artifact) pending.push(...artifact.sourceArtifactIds);
    }
    return session.artifacts.filter((artifact) => (
      reachable.has(artifact.id) && artifact.kind === "source-document" && artifact.status === "ready"
    ));
  }, [artifactById, selectedArtifact, session.artifacts]);

  const citationSourceArtifact = citationSourceArtifacts.find((artifact) => artifact.id === citationSourceArtifactId)
    ?? citationSourceArtifacts[0];
  const citationSourceParagraph = citationSourceArtifact?.paragraphs.find((paragraph) => paragraph.id === citationSourceParagraphId)
    ?? citationSourceArtifact?.paragraphs[0];
  const citationSourcePdfBlock = citationSourceArtifact?.provenance.source?.format === "pdf" && pdfWindow?.artifactId === citationSourceArtifact.id
    ? pdfWindow.pages.flatMap((page) => page.blocks.map((block) => ({ page, block }))).find(({ block }) => block.blockId === citationSourceParagraphId)?.block
      ?? pdfWindow.pages[0]?.blocks[0]
    : undefined;
  const selectedCitations = selectedParagraph?.citations ?? [];
  const canEditCitations = Boolean(
    selectedArtifact && selectedParagraph && !selectedOffice && !isHistoricalPreview && selectedArtifact.status === "ready"
      && new Set<WritingArtifactKind>(["chapter", "document"]).has(selectedArtifact.kind)
  );
  const citationAlreadyPresent = Boolean(citationSourceArtifact && (
    citationSourceArtifact.provenance.source?.format === "pdf"
      ? citationSourcePdfBlock && selectedCitations.some((citation) => (
        citation.sourceArtifactId === citationSourceArtifact.id
        && citation.sourceRevision === citationSourceArtifact.revision
        && citation.sourceBlockId === citationSourcePdfBlock.blockId
      ))
      : citationSourceParagraph && selectedCitations.some((citation) => (
        citation.sourceArtifactId === citationSourceArtifact.id
        && citation.sourceRevision === citationSourceArtifact.revision
        && citation.sourceParagraphId === citationSourceParagraph.id
      ))
  ));

  useEffect(() => {
    setCanvasLayout(completeWritingWorkflowLayout(session.artifacts, session.artifactLayout));
    const incoming = { ...session.artifactViewport };
    const pending = pendingCanvasViewportRef.current;
    const pendingMatchesIncoming = pending && Math.abs(pending.x - incoming.x) < 0.0001 && Math.abs(pending.y - incoming.y) < 0.0001 && Math.abs(pending.scale - incoming.scale) < 0.0001;
    const authoritativeBlankCanvasReset = session.artifacts.length === 0 &&
      session.artifactLayout.length === 0 &&
      !session.selectedArtifactId && !session.selectedParagraphId &&
      isPristineArtifactWorkflowViewport(incoming);
    if (pendingMatchesIncoming || !pending || authoritativeBlankCanvasReset) {
      pendingCanvasViewportRef.current = null;
      canvasViewportRef.current = incoming;
      setCanvasViewport(incoming);
    }
  }, [session.artifactLayout, session.artifactViewport, session.artifacts, session.selectedArtifactId, session.selectedParagraphId]);

  const handleCanvasViewportChange = useCallback((next: WritingArtifactViewport) => {
    pendingCanvasViewportRef.current = { ...next };
    canvasViewportRef.current = { ...next };
    setCanvasViewport({ ...next });
  }, []);

  const commitCanvas = useArtifactWorkflowCommit(projectId, onCanvasCommit);

  const commitDraftBeforeTransition = useCallback(async () => {
    await focusEditorCommit.current?.();
    if (!draftOrigin.artifactId || !draftOrigin.paragraphId || isHistoricalPreview || !draftDirty) return;
    if (isImmutableDataReportSnapshot(artifactById.get(draftOrigin.artifactId))) return;
    if (busy || pendingAction) throw new Error("Writing 草稿仍在处理中，请稍后再切换项目。");
    setPendingAction("replace");
    try {
      await onPatch(draftOrigin.artifactId, {
        expectedRevision: draftOrigin.expectedRevision,
        operations: [{ op: "replace", paragraphId: draftOrigin.paragraphId, text: draftText }],
        author: "user",
        summary: "切换项目前自动保存当前段落"
      });
    } finally {
      setPendingAction("");
    }
  }, [artifactById, busy, draftDirty, draftOrigin, draftText, isHistoricalPreview, onPatch, pendingAction]);

  // Project switching reads this callback outside the workbench. Register it
  // in the layout phase so a discrete switch immediately after typing cannot
  // observe the previous render's clean-draft closure.
  useLayoutEffect(() => {
    onRegisterDraftCommit?.(commitDraftBeforeTransition);
    return () => onRegisterDraftCommit?.(null);
  }, [commitDraftBeforeTransition, onRegisterDraftCommit]);

  const inboundEdges = useMemo(
    () => selectedArtifact
      ? session.artifactEdges.filter((edge) => edge.targetArtifactId === selectedArtifact.id)
      : [],
    [selectedArtifact, session.artifactEdges]
  );

  const matchingParagraphs = useMemo(() => {
    const query = searchText.trim().toLocaleLowerCase("zh-CN");
    if (!query) return displayedParagraphs;
    return displayedParagraphs.filter((paragraph) => paragraph.text.toLocaleLowerCase("zh-CN").includes(query));
  }, [displayedParagraphs, searchText]);

  useEffect(() => {
    const nextOrigin: ParagraphDraftOrigin = selectedArtifact && selectedParagraph
      ? {
          key: selectedDraftKey,
          artifactId: selectedArtifact.id,
          paragraphId: selectedParagraph.id,
          expectedRevision: selectedDraftRevision,
          text: selectedParagraph.text
        }
      : { key: "", artifactId: "", paragraphId: "", expectedRevision: 0, text: "" };
    if (draftDirty && selectedParagraph?.text !== draftText) return;
    setDraftOrigin(nextOrigin);
    setDraftText(nextOrigin.text);
  }, [selectedDraftKey, selectedParagraph?.text]);

  useEffect(() => {
    setSearchText("");
    setInsertText("");
  }, [selectedArtifact?.id]);

  useEffect(() => {
    const pending = pendingPdfSelectionRef.current;
    const matchedPending = selectedPdf && pending?.artifactId === selectedPdf.id ? pending : null;
    pendingPdfSelectionRef.current = null;
    setPdfWindow(null);
    setPdfBlockId(matchedPending?.blockId ?? "");
    setPdfWindowError("");
    setPdfPageNumber(matchedPending?.pageNumber ?? 1);
  }, [selectedPdf?.id, selectedPdf?.revision]);

  useEffect(() => {
    if (!selectedPdf) return;
    let cancelled = false;
    setPdfWindowBusy(true);
    setPdfWindowError("");
    void onReadPdfWindow({ artifactId: selectedPdf.id, expectedRevision: selectedPdf.revision, pageNumbers: [pdfPageNumber] })
      .then((next) => { if (!cancelled) setPdfWindow(next); })
      .catch((cause) => { if (!cancelled) setPdfWindowError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (!cancelled) setPdfWindowBusy(false); });
    return () => { cancelled = true; };
  }, [onReadPdfWindow, pdfPageNumber, selectedPdf?.id, selectedPdf?.revision]);

  useEffect(() => {
    const source = citationSourceArtifacts.find((artifact) => artifact.id === citationSourceArtifactId)
      ?? citationSourceArtifacts[0];
    setCitationSourceArtifactId(source?.id ?? "");
    setCitationSourceParagraphId((current) => source?.provenance.source?.format === "pdf"
      ? (pdfWindow?.artifactId === source.id && pdfWindow.pages.some((page) => page.blocks.some((block) => block.blockId === current))
        ? current
        : pdfWindow?.artifactId === source.id ? pdfWindow.pages[0]?.blocks[0]?.blockId ?? "" : "")
      : source?.paragraphs.some((paragraph) => paragraph.id === current)
        ? current
        : source?.paragraphs[0]?.id ?? "");
  }, [citationSourceArtifactId, citationSourceArtifacts, pdfWindow]);

  useEffect(() => {
    const source = citationSourceArtifacts.find((artifact) => artifact.id === citationSourceArtifactId)
      ?? citationSourceArtifacts[0];
    if (!source || source.provenance.source?.format !== "pdf" || pdfWindow?.artifactId === source.id) return;
    let cancelled = false;
    setPdfWindowBusy(true);
    setPdfWindowError("");
    void onReadPdfWindow({ artifactId: source.id, expectedRevision: source.revision, pageNumbers: [1] })
      .then((next) => { if (!cancelled) setPdfWindow(next); })
      .catch((cause) => { if (!cancelled) setPdfWindowError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (!cancelled) setPdfWindowBusy(false); });
    return () => { cancelled = true; };
  }, [citationSourceArtifactId, citationSourceArtifacts, onReadPdfWindow, pdfWindow?.artifactId]);

  async function runAction(name: string, action: () => MaybePromise) {
    if (actionLocked) return false;
    setPendingAction(name);
    try {
      await action();
      return true;
    } catch {
      // The parent owns operation errors so one consistent project-level message is shown.
      return false;
    } finally {
      setPendingAction("");
    }
  }

  function discardDraftToDisplayedParagraph() {
    const nextOrigin: ParagraphDraftOrigin = selectedArtifact && selectedParagraph
      ? {
          key: selectedDraftKey,
          artifactId: selectedArtifact.id,
          paragraphId: selectedParagraph.id,
          expectedRevision: selectedDraftRevision,
          text: selectedParagraph.text
        }
      : { key: "", artifactId: "", paragraphId: "", expectedRevision: 0, text: "" };
    setDraftOrigin(nextOrigin);
    setDraftText(nextOrigin.text);
  }

  function continueAfterDiscardingDraft(continuation: () => void) {
    if (!draftDirty) {
      if (focusEditorCommit.current) { void focusEditorCommit.current().then(continuation).catch(() => undefined); return; }
      continuation();
      return;
    }
    discardDraftContinuationRef.current = continuation;
    setDiscardDraftDialogOpen(true);
  }

  function cancelDiscardDraft() {
    discardDraftContinuationRef.current = null;
    setDiscardDraftDialogOpen(false);
  }

  function discardDraftAndContinue() {
    const continuation = discardDraftContinuationRef.current;
    discardDraftContinuationRef.current = null;
    setDiscardDraftDialogOpen(false);
    discardDraftToDisplayedParagraph();
    continuation?.();
  }

  function selectArtifact(
    artifactId: string,
    paragraphId?: string,
    boundRevision: number | null = null,
    sourcePageNumber = 1,
    afterSelect?: () => void
  ) {
    const target = artifactById.get(artifactId);
    const targetPreview = boundRevision && boundRevision !== target?.revision ? `${artifactId}:${boundRevision}` : "";
    const targetParagraphId = paragraphId || target?.paragraphs[0]?.id || "";
    const sameDisplayedTarget = selectedArtifact?.id === artifactId && selectedParagraph?.id === targetParagraphId
      && previewTarget === targetPreview;
    const applySelection = () => {
      if (target?.provenance.source?.format === "pdf" && paragraphId) {
        pendingPdfSelectionRef.current = {
          artifactId,
          blockId: paragraphId,
          pageNumber: Math.max(1, Math.floor(sourcePageNumber) || 1)
        };
      }
      setPreviewTarget(targetPreview);
      if (canvasFocusOpen) setFocusArtifactId(artifactId);
      void onSelect(artifactId, targetParagraphId);
      afterSelect?.();
    };
    // Reopening the same novel can select a different internal section. That
    // transition unmounts its editor just like selecting another document.
    if (sameDisplayedTarget && !afterSelect) applySelection();
    else continueAfterDiscardingDraft(applySelection);
  }

  function previewArtifactRevision(revision: number | null) {
    const targetPreview = revision && selectedArtifact ? `${selectedArtifact.id}:${revision}` : "";
    if (previewTarget === targetPreview) return;
    continueAfterDiscardingDraft(() => setPreviewTarget(targetPreview));
  }

  async function replaceParagraph() {
    if (!draftOrigin.artifactId || !draftOrigin.paragraphId || isHistoricalPreview || !draftDirty) return;
    if (isImmutableDataReportSnapshot(artifactById.get(draftOrigin.artifactId))) return;
    await runAction("replace", () => onPatch(draftOrigin.artifactId, {
      expectedRevision: draftOrigin.expectedRevision,
      operations: [{ op: "replace", paragraphId: draftOrigin.paragraphId, text: draftText }],
      author: "user",
      summary: "人工编辑当前段落"
    }));
  }

  async function insertParagraph() {
    const text = insertText.trim();
    if (!selectedArtifact || !selectedParagraph || selectedImmutableSnapshot || isHistoricalPreview || !text) return;
    const inserted = await runAction("insert", () => onPatch(selectedArtifact.id, {
      expectedRevision: selectedArtifact.revision,
      operations: [{ op: "insert-after", paragraphId: selectedParagraph.id, text }],
      author: "user",
      summary: "在当前段落后插入内容"
    }));
    if (inserted) setInsertText("");
  }

  async function deleteParagraph() {
    if (!selectedArtifact || !selectedParagraph || selectedImmutableSnapshot || isHistoricalPreview) return;
    continueAfterDiscardingDraft(() => {
      void runAction("delete", () => onPatch(selectedArtifact.id, {
        expectedRevision: selectedArtifact.revision,
        operations: [{ op: "delete", paragraphId: selectedParagraph.id }],
        author: "user",
        summary: "删除当前段落"
      }));
    });
  }

  function citationRefsWithout(citationId?: string): WritingCitationRef[] {
    return selectedCitations
      .filter((citation) => citation.id !== citationId)
      .map((citation) => ({
        sourceArtifactId: citation.sourceArtifactId,
        expectedSourceRevision: citation.sourceRevision,
        sourceParagraphId: citation.sourceParagraphId,
        ...(citation.sourcePageNumber ? { sourcePageNumber: citation.sourcePageNumber } : {}),
        ...(citation.sourceBlockId ? { sourceBlockId: citation.sourceBlockId } : {}),
        ...(citation.sourceBlockSha256 ? { sourceBlockSha256: citation.sourceBlockSha256 } : {})
      }));
  }

  async function writeSelectedParagraphCitations(citationRefs: WritingCitationRef[], summary: string) {
    if (!selectedArtifact || !selectedParagraph || !canEditCitations || draftDirty) return;
    await runAction("citation", () => onPatch(selectedArtifact.id, {
      expectedRevision: selectedArtifact.revision,
      operations: [{
        op: "replace",
        paragraphId: selectedParagraph.id,
        text: selectedParagraph.text,
        citationRefs
      }],
      author: "user",
      summary
    }));
  }

  async function addSelectedParagraphCitation() {
    if (!citationSourceArtifact) return;
    if (citationSourceArtifact.provenance.source?.format === "pdf") {
      if (!citationSourcePdfBlock) return;
      await writeSelectedParagraphCitations([
        ...citationRefsWithout(),
        {
          sourceArtifactId: citationSourceArtifact.id,
          expectedSourceRevision: citationSourceArtifact.revision,
          sourceParagraphId: citationSourcePdfBlock.blockId,
          sourcePageNumber: pdfWindow?.pages.find((page) => page.blocks.some((block) => block.blockId === citationSourcePdfBlock.blockId))?.pageNumber,
          sourceBlockId: citationSourcePdfBlock.blockId,
          sourceBlockSha256: citationSourcePdfBlock.blockSha256
        }
      ], "为当前段落增加 PDF 文本块引用");
      return;
    }
    if (!citationSourceParagraph) return;
    const duplicate = selectedCitations.some((citation) => (
      citation.sourceArtifactId === citationSourceArtifact.id
        && citation.sourceRevision === citationSourceArtifact.revision
        && citation.sourceParagraphId === citationSourceParagraph.id
    ));
    if (duplicate) return;
    await writeSelectedParagraphCitations([
      ...citationRefsWithout(),
      {
        sourceArtifactId: citationSourceArtifact.id,
        expectedSourceRevision: citationSourceArtifact.revision,
        sourceParagraphId: citationSourceParagraph.id
      }
    ], "为当前段落增加受控来源引用");
  }

  async function updateFindingStatus(finding: WritingReviewFindingV1, status: "resolved" | "dismissed") {
    if (!selectedArtifact || selectedArtifact.kind !== "review" || selectedArtifact.status !== "ready") return;
    await runAction("finding-status", () => onReviewFindingStatus(
      selectedArtifact.id,
      selectedArtifact.revision,
      finding.id,
      status
    ));
  }

  async function importDocuments() {
    continueAfterDiscardingDraft(() => {
      void runAction("import", onImport);
    });
  }

  async function restoreArtifactRevision(revision: number) {
    if (!selectedArtifact || selectedImmutableSnapshot) return;
    continueAfterDiscardingDraft(() => {
      void runAction("restore", () => onRestore(
        selectedArtifact.id,
        selectedArtifact.revision,
        revision
      )).then((restored) => {
        if (restored) setPreviewTarget("");
      });
    });
  }

  const writingNodeRoleCandidates: Array<{ role: WritingCanvasNodeRole; label: string }> = [
    { role: "writing-request", label: "写作需求" },
    { role: "world-building", label: "故事设定" },
    { role: "outline", label: templateProfile.id === "fiction" ? "故事大纲" : KIND_META.outline.label },
    { role: "character-list", label: templateProfile.id === "fiction" ? "角色列表" : KIND_META.character.label },
    { role: "character-state", label: "角色章节状态" },
    { role: "chapter", label: templateProfile.id === "fiction" ? "章节" : KIND_META.chapter.label },
    { role: "review", label: KIND_META.review.label },
    { role: "document", label: KIND_META.document.label }
  ];
  const writingNodeRoleOptions = writingNodeRoleCandidates.filter((option) => templateProfile.canvasRoles.includes(option.role));

  function defaultCreateDraft(role: WritingCanvasNodeRole, context: ArtifactWorkflowContext | null): WritingCanvasCreateDraft {
    const kind = WRITING_NODE_ROLE_KIND[role];
    const contextualArtifact = context?.nodeId ? artifactById.get(context.nodeId) : undefined;
    const allowedSources = WRITING_SOURCE_KINDS[kind] || [];
    const preferredSource = contextualArtifact && allowedSources.includes(contextualArtifact.kind) && contextualArtifact.status === "ready"
      ? contextualArtifact
      : hasExplicitArtifactSelection && selectedArtifact && allowedSources.includes(selectedArtifact.kind) && selectedArtifact.status === "ready"
        ? selectedArtifact
        : session.artifacts.find((artifact) => allowedSources.includes(artifact.kind) && artifact.status === "ready");
    const chapterNumber = session.artifacts.filter((artifact) => artifact.kind === "chapter").length + 1;
    const sourceLayout = contextualArtifact ? canvasLayout.find((item) => item.artifactId === contextualArtifact.id) : undefined;
    const desiredPosition = sourceLayout
      ? { x: sourceLayout.x + Number(sourceLayout.width || 210) + 72, y: sourceLayout.y }
      : {
          x: Math.max(-200_000, Math.min(200_000, Number(context?.worldX || 120) - 105)),
          y: Math.max(-200_000, Math.min(200_000, Number(context?.worldY || 120) - 46))
        };
    const position = collisionFreeWritingCanvasPosition(desiredPosition, canvasLayout, Boolean(sourceLayout));
    const title = role === "writing-request"
      ? "写作需求"
      : role === "world-building"
        ? "故事设定"
      : role === "outline"
        ? KIND_META.outline.label
      : role === "character-list"
          ? (templateProfile.id === "fiction" ? "角色列表" : KIND_META.character.label)
        : role === "character-state"
          ? `${preferredSource?.title || "当前章节"} · 角色状态`
          : role === "chapter"
            ? (templateProfile.id === "fiction" ? `第 ${chapterNumber} 章` : `${KIND_META.chapter.label} ${chapterNumber}`)
            : role === "review"
              ? `${preferredSource?.title || KIND_META.chapter.label} · ${KIND_META.review.label}`
              : KIND_META.document.label;
    const text = role === "writing-request"
      ? ""
      : role === "world-building"
        ? "# 故事设定\n\n## 时代与地点\n\n\n## 世界规则\n\n\n## 阵营与冲突\n\n\n## 不可违背的设定\n"
      : role === "character-list" && templateProfile.id === "fiction"
        ? "# 角色列表\n\n## 主角\n姓名、目标、动机、缺陷与人物弧光。\n\n## 重要角色\n关系、立场与冲突。\n\n## 角色状态\n记录角色在各章节中的位置与变化。"
      : role === "character-state"
        ? `# ${preferredSource?.title || "当前章节"} · 角色状态\n\n## 出场角色\n\n\n## 本章前状态\n\n\n## 本章变化\n\n\n## 下一章必须延续\n`
      : role === "chapter" && templateProfile.id === "fiction"
          ? `# 第 ${chapterNumber} 章\n\n## 本章目标\n\n\n## 正文\n`
          : "";
    return {
      role,
      kind,
      title,
      text,
      sourceArtifactIds: role !== "writing-request" && preferredSource ? [preferredSource.id] : [],
      canvasPosition: position,
      ...(contextualArtifact ? { contextNodeId: contextualArtifact.id } : {})
    };
  }

  function openCreateNode(role: WritingCanvasNodeRole, context: ArtifactWorkflowContext | null = canvasMenu) {
    setCanvasMenu(null);
    setCreateDraft(defaultCreateDraft(role, context));
  }

  function changeCreateNodeRole(role: WritingCanvasNodeRole) {
    setCreateDraft((current) => {
      const context = current?.contextNodeId
        ? { kind: "node" as const, nodeId: current.contextNodeId, clientX: 0, clientY: 0, worldX: 0, worldY: 0 }
        : null;
      const next = defaultCreateDraft(role, context);
      return current ? { ...next, canvasPosition: current.canvasPosition } : next;
    });
  }

  const createSourceOptions = createDraft
    ? session.artifacts.filter((artifact) => (
        artifact.status === "ready"
        && (WRITING_SOURCE_KINDS[createDraft.kind] || []).includes(artifact.kind)
      ))
    : [];
  const createRequiredSourceKinds = createDraft ? WRITING_REQUIRED_SOURCE_KINDS[createDraft.kind] || [] : [];
  // A blank canvas always starts from a writing request. Downstream artifacts
  // are created from a node so the workflow cannot silently accumulate
  // chapters/reviews/documents without provenance.
  const createAcceptsSource = Boolean(createDraft?.role !== "writing-request" && createDraft?.contextNodeId && (WRITING_SOURCE_KINDS[createDraft.kind] || []).length);
  const createNeedsSource = Boolean(createDraft?.contextNodeId && createRequiredSourceKinds.length > 0);
  const createHasRequiredSource = !createNeedsSource || createDraft?.sourceArtifactIds.some((sourceId) => {
    const source = artifactById.get(sourceId);
    return Boolean(source && createRequiredSourceKinds.includes(source.kind));
  });

  async function submitCreateNode() {
    if (!createDraft) return;
    if (!createHasRequiredSource) return;
    const category = WRITING_DEMAND_CATEGORIES.find((c) => c.id === (createDraft.category || "novel"))!;
    const title = (createDraft.role === "writing-request" ? category.id === "novel" ? "未命名小说" : `${category.label}需求` : createDraft.title.trim()) || writingNodeRoleOptions.find((option) => option.role === createDraft.role)?.label || KIND_META[createDraft.kind].label;
    const text = createDraft.text.trim();
    const created = await runAction("create", () => onCreateArtifact({
      kind: createDraft.kind,
      title,
      text,
      sourceArtifactIds: createDraft.sourceArtifactIds,
      attributes: {
        canvasRole: createDraft.role,
        writingTemplate: createDraft.role === "writing-request" ? category.template
          : artifactById.get(createDraft.contextNodeId || "")?.attributes?.writingTemplate || templateProfile.id,
        ...(createDraft.role === "writing-request" ? { demandCategory: category.id, ...(category.id === "novel" ? { novelRole: "root" } : {}) } : {}),
        ...(createDraft.role === "chapter" ? {
          chapterIndex: session.artifacts.filter((artifact) => artifact.kind === "chapter").length + 1
        } : {})
      },
      canvasPosition: createDraft.canvasPosition,
      summary: `从无限画布创建${writingNodeRoleOptions.find((item) => item.role === createDraft.role)?.label || KIND_META[createDraft.kind].label}`
    }));
    if (created) setCreateDraft(null);
  }

  function referenceCanvasArtifact(artifact: WritingArtifactRecord) {
    setCanvasMenu(null);
    void onReferenceAgent([artifact.id]);
  }

  useEffect(() => {
    if (!locateRequest) return;
    const artifact = artifactById.get(locateRequest.nodeId);
    onLocateHandled(locateRequest.requestId);
    if (artifact) {
      const owner = isNovelInternal(artifact) ? artifactById.get(String(artifact.attributes?.novelId)) : undefined;
      openArtifactFromCanvas(owner || artifact, false, owner ? String(artifact.attributes?.novelSection) : undefined);
    }
  }, [locateRequest]);

  function openArtifactFromCanvas(artifact: WritingArtifactRecord, inspect = false, section?: string) {
    setCanvasMenu(null);
    selectArtifact(artifact.id, artifact.paragraphs[0]?.id, null, 1, () => {
      setFocusArtifactId(artifact.id);
      setFocusSectionRequest(section ? { section, sequence: Date.now() } : undefined);
      setAdvancedDocument(inspect);
      setManualToolsOpen(inspect);
      setCanvasFocusOpen(true);
    });
  }

  function handleWritingCanvasContext(context: ArtifactWorkflowContext) {
    if (canvasFocusOpen || createDraft) return;
    if (context.kind === "node" && context.nodeId) {
      const artifact = artifactById.get(context.nodeId);
      if (artifact) selectArtifact(artifact.id, artifact.paragraphs[0]?.id);
    }
    setCanvasMenu(context);
  }

  const canvasFeedback = busy || pendingAction || (!canvasFocusOpen && error) ? (
    <div className="writing-canvas-feedback" data-writing-canvas-feedback="true">
      {busy || pendingAction ? <span className="writing-canvas-activity" role="status" aria-live="polite"><LoaderCircle size={13} className="is-spinning" />{pendingAction ? ACTION_LABELS[pendingAction] || "保存中" : "Agent 处理中"}</span> : null}
      {!canvasFocusOpen && error ? <span className="writing-canvas-error" data-writing-canvas-error="true" role="alert" title={error}>{error}</span> : null}
    </div>
  ) : null;

  return (
    <section
      className="writing-workbench writing-workbench--canvas-only"
      aria-label={`${projectName || "未命名项目"} · ${templateProfile.label}无限画布`}
      data-writing-template={templateProfile.id}
      data-writing-simple-surface="true"
      data-writing-canvas-only="true"
      data-writing-node-focus-open={canvasFocusOpen ? "true" : "false"}
      data-writing-manual-tools-open={manualToolsOpen ? "true" : "false"}
      data-writing-selected-artifact-id={hasExplicitArtifactSelection ? selectedArtifact?.id || "" : ""}
      data-writing-selected-artifact-revision={hasExplicitArtifactSelection ? selectedArtifact?.revision || "" : ""}
    >
      <span hidden data-writing-manual-tools={manualToolsOpen ? "open" : "closed"} />
      <div className="writing-workbench__workflow-canvas" data-writing-artifact-count={session.artifacts.length}>
          <ArtifactWorkflowCanvas
            kind="writing"
            nodes={visibleArtifacts}
            edges={visibleEdges}
            layout={canvasLayout}
            viewport={canvasViewport}
            selectedNodeId={session.selectedArtifactId}
            defaultNodeSize={{ width: 276, height: 248 }}
            resizable minimumNodeSize={{ width: 240, height: 208 }} maximumNodeSize={{ width: 900, height: 1200 }}
            fitMinimumScale={0.58}
            autoFitOnMount={isPristineArtifactWorkflowViewport(session.artifactViewport)}
            autoFitKey={projectId}
            busy={actionLocked}
            toolbar={canvasFeedback}
            canvasMeta={visibleArtifacts.length ? `${visibleArtifacts.length} 个节点` : "工作"}
            selectionIcon={<BookOpenText size={18} />}
            selectionTitle={hasExplicitArtifactSelection ? selectedArtifact?.title || "写作成果" : "写作成果"}
            selectionDetail={hasExplicitArtifactSelection && selectedArtifact
              ? `${writingArtifactRolePresentation(selectedArtifact, KIND_META, templateProfile).label} · r${selectedArtifact.revision} · ${paragraphWordCount(selectedArtifact.paragraphs)} 字`
              : "已选中"}
            onClearSelection={() => {
              continueAfterDiscardingDraft(() => {
                setPreviewTarget("");
                setCanvasFocusOpen(false);
                setManualToolsOpen(false);
                void onSelect("", "");
              });
            }}
            focusLayerLabel={selectedArtifact && isNovelRoot(selectedArtifact) ? "小说" : "文档"}
            onFocusLayerClose={() => {
              continueAfterDiscardingDraft(() => {
                setCanvasFocusOpen(false);
                setManualToolsOpen(false);
              });
            }}
            focusLayerHostRef={canvasFocusOpen ? setCanvasFocusHost : undefined}
            onFilesDrop={(files, position) => {
              const paths = files.map((file) => { try { return window.aieyraConfig?.pathForDroppedFile?.(file) || ""; } catch { return ""; } }).filter(Boolean);
              if (paths.length) continueAfterDiscardingDraft(() => { void runAction("import", () => onImport({ paths, canvasPosition: position })); });
            }}
            onContextMenu={handleWritingCanvasContext}
            onConnect={onConnectArtifacts}
            onNodeOpen={(artifactId) => {
              const artifact = artifactById.get(artifactId);
              if (artifact) openArtifactFromCanvas(artifact);
            }}
            emptyContent={<CanvasPlatformEmptyState
              ariaLabel="Writing 空白画布入口"
              title="从资料和想法开始"
              description="拖入文件，或告诉 AI 你的目标。AI 会先读资料、补齐关键信息，再逐步交付成果。"
              primaryLabel="告诉 AI 要做什么"
              primaryIcon={<Brain size={15} />}
              onPrimary={() => void onFocusAgent()}
              secondaryLabel="导入文档"
              secondaryIcon={<FileInput size={15} />}
              onSecondary={() => void importDocuments()}
            />}
            onSelect={(artifactId) => {
              const artifact = artifactById.get(artifactId);
              selectArtifact(artifactId, artifact?.paragraphs[0]?.id);
            }}
            onLayoutChange={setCanvasLayout}
            onViewportChange={handleCanvasViewportChange}
            onCommit={commitCanvas}
            renderEdgeLabel={(edge) => <span className="writing-workbench__edge-label">{RELATION_LABELS[edge.relation]}</span>}
            renderNode={(artifact) => {
              const selected = artifact.id === session.selectedArtifactId;
              const presentation = writingArtifactRolePresentation(artifact, KIND_META, templateProfile);
              return (
                <article
                  className={`writing-workbench__artifact-card writing-canvas-preview-card${isNovelRoot(artifact) ? " is-novel" : ""}${selected ? " is-selected" : ""}`}
                  data-artifact-id={artifact.id}
                  data-artifact-kind={artifact.kind}
                  data-reference-code={workspaceReferenceCode("document", artifact.id)}
                  data-writing-canvas-role={presentation.role}
                  data-artifact-status={artifact.status}
                >
                  {Array.isArray(artifact.attributes?.matrixImagePaths) ? <div className="matrix-import-images">{artifact.attributes.matrixImagePaths.slice(0, 6).map(file => <img key={file} src={imageAssetThumbnailSrc({ path: file } as any, 320)} alt="复制的图片" loading="lazy" />)}<span>{artifact.attributes.matrixImagePaths.length} 张图片 · 双击查看节点内容</span></div> : null}
                  <span className={`writing-workbench__kind-icon writing-workbench__kind-icon--${artifact.kind}`} aria-hidden="true">
                    {presentation.short}
                  </span>
                  <span className="writing-workbench__artifact-copy">
                    <strong data-writing-node-title="true">{artifact.title || KIND_META[artifact.kind].label}</strong>
                    <small data-writing-node-meta="true">{isNovelRoot(artifact) ? `小说 · ${novelCards.get(artifact.id)?.count || 0} 章` : artifact.attributes?.novelId ? `章节 · ${artifactById.get(String(artifact.attributes.novelId))?.title || "所属小说已移除"}` : `${WRITING_DEMAND_CATEGORIES.find((c) => c.id === artifact.attributes?.demandCategory)?.label || presentation.label} · ${paragraphWordCount(artifact.paragraphs)} 字`}</small>
                  </span>
                  {artifact.provenance.source?.format === "html" || artifact.attributes?.documentFormat === "html" ? <WritingHtmlCard artifact={artifact} /> : artifact.provenance.office ? <WritingOfficePreview projectId={projectId} artifact={artifact} /> : <p className="writing-canvas-preview-text">{(novelCards.get(artifact.id)?.excerpt || (artifact.paragraphs || []).slice(0, 30).map((paragraph) => paragraph.text.slice(0, 2400)).join("\n\n")).slice(0, 6000).replace(/^#{1,6}\s/gm, "") || "双击打开，开始编辑"}</p>}
                  {isNovelRoot(artifact) ? <div className="writing-canvas-novel-sections" aria-label="小说容器内容">
                    {novelCards.get(artifact.id)?.sections.map(section => <span key={section.id} data-ready={section.ready || undefined}>
                      {({ brief: "需求", synopsis: "简介", outline: "大纲", characters: "角色", plot: "剧情" } as Record<string, string>)[section.id]}<i>{section.ready ? "已整理" : "待整理"}</i>
                    </span>)}
                  </div> : null}
                  {isNovelRoot(artifact) ? <span className="writing-canvas-novel-stage">{novelCards.get(artifact.id)?.label}</span> : null}
                  {workReviews.get(artifact.id) ? <span className="writing-canvas-novel-stage">{workReviews.get(artifact.id)?.confirmed ? "阶段已确认" : "阶段待核对 · 双击打开"}</span> : null}
                  <span className={`writing-workbench__status writing-workbench__status--${artifact.status}`} data-writing-node-status="true" aria-label={`状态：${STATUS_LABELS[artifact.status]}`} title={STATUS_LABELS[artifact.status]}>
                    {artifact.status === "running" ? <LoaderCircle size={11} className="is-spinning" /> : null}
                    {STATUS_LABELS[artifact.status]}
                  </span>
                </article>
              );
            }}
          />
        </div>
      {canvasFocusHost ? createPortal(
      <Suspense fallback={<div className="writing-workbench__inspector-empty" role="status">正在打开文档…</div>}>
      <div className="writing-work-focus">
      {selectedArtifact && isNovelRoot(selectedArtifact) ? <WritingNovelPanel projectId={projectId} onIllustration={onIllustration} key={selectedArtifact.id} root={selectedArtifact} artifacts={session.artifacts} busy={actionLocked}
        onCommand={onNovel} onSaveRoot={(text, revision) => onSaveText(selectedArtifact.id, text, revision)}
        onAskAgent={onAskAgent} sectionRequest={focusSectionRequest} onOpenChapter={(artifact) => openArtifactFromCanvas(artifact)}
        onExport={(format, revision) => onExportNovel(selectedArtifact.id, revision, format)}
        registerCommit={(commit) => { focusEditorCommit.current = commit; }} />
      : selectedArtifact && !selectedOffice && !advancedDocument && !selectedImmutableSnapshot && !selectedPdf && selectedArtifact.kind !== "review" && !selectedArtifact.paragraphs.some((p) => p.citations?.length) ? <div className="writing-file-focus">
        <header><div><span>{selectedArtifact.attributes?.novelId ? `所属小说：${artifactById.get(String(selectedArtifact.attributes.novelId))?.title || "已移除"}` : "文档"}</span><h2>{selectedArtifact.title}</h2></div>
          <div>{selectedArtifact.attributes?.novelId && artifactById.get(String(selectedArtifact.attributes.novelId)) ? <ActionButton onClick={() => openArtifactFromCanvas(artifactById.get(String(selectedArtifact.attributes!.novelId))!)}>返回小说</ActionButton> : null}
          <ActionButton disabled={actionLocked} onClick={() => continueAfterDiscardingDraft(() => { setAdvancedDocument(true); setManualToolsOpen(true); })}>版本与来源</ActionButton>
          <ActionButton disabled={actionLocked} onClick={() => { continueAfterDiscardingDraft(() => { void onExport(selectedArtifact.id, "html"); }); }}>导出 HTML</ActionButton>
          {!selectedHtml ? <ActionButton disabled={actionLocked} onClick={() => { continueAfterDiscardingDraft(() => { void onExport(selectedArtifact.id, "docx"); }); }}>导出 Word</ActionButton> : null}</div></header>
        {selectedArtifact.attributes?.originNovelId && selectedArtifact.attributes.originNovelId !== selectedArtifact.attributes.novelId ? <p className="writing-format-note">原始归属：{artifactById.get(String(selectedArtifact.attributes.originNovelId))?.title || String(selectedArtifact.attributes.originNovelId)}</p> : null}
        <WritingDocumentEditor projectId={projectId} onIllustration={onIllustration} key={selectedArtifact.id} artifact={selectedArtifact} busy={actionLocked} onSave={(text, revision) => onSaveText(selectedArtifact.id, text, revision)} registerCommit={(commit) => { focusEditorCommit.current = commit; }} />
      </div> : <div className={`writing-canvas-focus-content${manualToolsOpen ? " is-actions-open" : ""}`} data-writing-node-focus="true" data-writing-node-actions={manualToolsOpen ? "expanded" : "compact"} data-writing-manual-tools={manualToolsOpen ? "open" : "closed"}>
        {error ? <div className="writing-workbench__error" role="alert">{error}</div> : null}
        <section className="writing-workbench__ai-next" data-writing-ai-default="true" aria-label="Writing Agent 下一步">
          <div>{WRITING_AI_NEXT_STEPS.map(([id, label]) => <ButtonBase key={id} data-writing-ai-action={id} className={`${WB_BUTTON} writing-workbench__button--ghost`} type="button" disabled={actionLocked || !hasExplicitArtifactSelection || selectedArtifact?.status !== "ready"} onClick={() => void Promise.resolve(askAgentAboutSelected(label)).catch(() => undefined)}>{label}</ButtonBase>)}</div>
        </section>
        <main
          className="writing-workbench__document"
          aria-labelledby="writing-document-title"
          data-writing-selected-kind={selectedArtifact?.kind || ""}
        >
          {selectedArtifact ? (
            <>
              <div className="writing-workbench__document-heading">
                <div>
                  <div className="writing-workbench__document-title-row">
                    <span className={`writing-workbench__kind-icon writing-workbench__kind-icon--${selectedArtifact.kind}`} aria-hidden="true">
                      {KIND_META[selectedArtifact.kind].short}
                    </span>
                    <div>
                      <p className={WB_EYEBROW}>{KIND_META[selectedArtifact.kind].label} · REVISION {displayedRevision}</p>
                      <h2 id="writing-document-title">{selectedArtifact.title}</h2>
                    </div>
                  </div>
                  <p>
                    {displayedWordCount} 字 · {displayedParagraphs.length} 段 · 更新于 {formatDate(displayedUpdatedAt)}
                  </p>
                </div>
                <div className="writing-workbench__export-actions">
                  {selectedOffice ? <ActionButton disabled={actionLocked} onClick={() => void runAction("office", () => onOpenOffice(selectedArtifact))}>用本机应用打开原件</ActionButton> : advancedDocument ? <ActionButton disabled={actionLocked} onClick={() => continueAfterDiscardingDraft(() => { setAdvancedDocument(false); setManualToolsOpen(false); setPreviewTarget(""); })}>返回正文编辑</ActionButton> : null}
                  <ButtonBase
                    data-writing-node-actions-toggle="true"
                    data-writing-manual-toggle="true"
                    aria-expanded={manualToolsOpen}
                    className={`${WB_BUTTON} writing-workbench__button--ghost`}
                    type="button"
                    onClick={() => setManualToolsOpen((current) => !current)}
                  >
                    <PencilLine size={14} /> {manualToolsOpen ? "收起操作" : "更多操作"}
                  </ButtonBase>
                  {manualToolsOpen ? EXPORT_OPTIONS.filter((option) => (!selectedHtml || option.format !== "docx") && (!("documentOnly" in option) || selectedArtifact.kind === "document") && (!selectedOffice || ["markdown", "txt", "html"].includes(option.format) || (option.format === "docx" && selectedArtifact.provenance.office?.relativePath.endsWith(".docx")))).map((option) => (
                    <ButtonBase
                      key={option.format}
                      type="button"
                      data-writing-export-format={option.format}
                      className={`${WB_BUTTON} writing-workbench__button--ghost`}
                      title={selectedArtifact.status !== "ready" ? "只有就绪 artifact 可以导出" : `导出 ${option.label}`}
                      disabled={actionLocked || exportDirty || isHistoricalPreview || selectedArtifact.status !== "ready"}
                      onClick={() => void runAction(option.action, () => onExport(selectedArtifact.id, option.format))}
                    >
                      <Download size={14} /> {selectedOffice && option.format !== "docx" ? `正文 ${option.label}` : option.label}
                    </ButtonBase>
                  )) : null}
                </div>
              </div>

              {!hasExplicitArtifactSelection ? (
                <div className="writing-workbench__preview-banner" role="status">
                  <BookOpenText size={14} />
                  当前仅预览第一个 artifact；Writing Agent 尚未选中它。
                  <ButtonBase type="button" onClick={() => selectArtifact(selectedArtifact.id, selectedArtifact.paragraphs[0]?.id)}>
                    设为当前 artifact
                  </ButtonBase>
                </div>
              ) : null}

              {isHistoricalPreview ? (
                <div className="writing-workbench__preview-banner" role="status">
                  <History size={14} />
                  正在预览 revision {selectedRevision?.revision}，历史正文只读。
                  <ButtonBase type="button" onClick={() => previewArtifactRevision(null)}>返回当前版本</ButtonBase>
                </div>
              ) : null}

              {selectedImmutableSnapshot ? (
                <p className="writing-workbench__muted" data-writing-immutable-snapshot="true">Data 报告快照 · 只读</p>
              ) : null}

              <div className="writing-workbench__search">
                <Search size={14} aria-hidden="true" />
                <label className="writing-workbench__sr-only" htmlFor={searchId}>搜索当前文档段落</label>
                <input
                  id={searchId}
                  type="search"
                  value={searchText}
                  placeholder="搜索当前文档…"
                  onChange={(event) => setSearchText(event.target.value)}
                />
                {searchText ? <span>{matchingParagraphs.length} 个匹配段落</span> : null}
              </div>

              {selectedPdf ? (
                <section className="writing-workbench__pdf-reader" aria-label="PDF 页级来源阅读器">
                  <div className="writing-workbench__pdf-reader-heading">
                    <div>
                      <p className={WB_EYEBROW}>PDF SOURCE WINDOW</p>
                      <h3>受控页级阅读</h3>
                    </div>
                    <span>revision {selectedPdf.revision} · {selectedPdf.provenance.source?.pdf?.pageCount || 0} 页</span>
                  </div>
                  <div className="writing-workbench__pdf-controls">
                    <ButtonBase type="button" className={`${WB_BUTTON} writing-workbench__button--ghost`} disabled={pdfWindowBusy || pdfPageNumber <= 1} onClick={() => setPdfPageNumber((value) => Math.max(1, value - 1))}>上一页</ButtonBase>
                    <label>第 <input aria-label="PDF 页码" type="number" min={1} max={selectedPdf.provenance.source?.pdf?.pageCount || 1} value={pdfPageNumber} onChange={(event) => setPdfPageNumber(Math.min(selectedPdf.provenance.source?.pdf?.pageCount || 1, Math.max(1, Number(event.target.value) || 1)))} /> 页</label>
                    <ButtonBase type="button" className={`${WB_BUTTON} writing-workbench__button--ghost`} disabled={pdfWindowBusy || pdfPageNumber >= (selectedPdf.provenance.source?.pdf?.pageCount || 1)} onClick={() => setPdfPageNumber((value) => Math.min(selectedPdf.provenance.source?.pdf?.pageCount || 1, value + 1))}>下一页</ButtonBase>
                  </div>
                  {pdfWindowError ? <InlineNotice tone="danger">{pdfWindowError}</InlineNotice> : null}
                  {pdfWindowBusy ? <p className="writing-workbench__muted">正在读取当前页的受控文本块…</p> : null}
                  {pdfWindow?.pages[0] ? (
                    <div className="writing-workbench__pdf-page" data-pdf-page={pdfWindow.pages[0].pageNumber}>
                      <div className="writing-workbench__pdf-page-meta">第 {pdfWindow.pages[0].pageNumber} 页 · {pdfWindow.pages[0].status === "scanned" ? "扫描页，未执行 OCR" : `${pdfWindow.pages[0].blocks.length} 个文本块`} · {pdfWindow.pages[0].width.toFixed(0)} × {pdfWindow.pages[0].height.toFixed(0)}</div>
                      {pdfWindow.pages[0].blocks.length ? pdfWindow.pages[0].blocks.map((block) => (
                        <ButtonBase type="button" key={block.blockId} data-pdf-block-id={block.blockId} aria-pressed={pdfBlockId === block.blockId} className={`writing-workbench__pdf-block${pdfBlockId === block.blockId ? " is-selected" : ""}`} onClick={() => setPdfBlockId(block.blockId)}>
                          <span>{block.text}</span>
                          <small>{shortHash(block.blockSha256)}</small>
                        </ButtonBase>
                      )) : <p className="writing-workbench__muted">此页没有可提取的原生文本。</p>}
                    </div>
                  ) : null}
                </section>
              ) : null}

              <div className="writing-workbench__paragraphs" aria-label="文档段落">
                {matchingParagraphs.length ? matchingParagraphs.map((paragraph, index) => {
                  const selected = hasExplicitArtifactSelection && paragraph.id === session.selectedParagraphId;
                  const paragraphNumber = displayedParagraphs.findIndex((item) => item.id === paragraph.id) + 1;
                  const selectParagraph = () => {
                    if (!isHistoricalPreview) selectArtifact(selectedArtifact.id, paragraph.id);
                  };
                  return (
                    <div
                      className={`writing-workbench__paragraph${selected ? " is-selected" : ""}`}
                      key={paragraph.id}
                      data-writing-paragraph-id={paragraph.id}
                      onClick={(event) => {
                        const target = event.target;
                        if (target instanceof Element && target.closest("a, button, input, textarea, select, [contenteditable='true']")) return;
                        selectParagraph();
                      }}
                    >
                      <ButtonBase
                        type="button"
                        className="writing-workbench__paragraph-select"
                        data-writing-paragraph-id={paragraph.id}
                        aria-label={`选择第 ${paragraphNumber || index + 1} 段`}
                        aria-pressed={selected}
                        disabled={isHistoricalPreview}
                        onClick={selectParagraph}
                      >
                        <span className="writing-workbench__paragraph-number">{paragraphNumber || index + 1}</span>
                      </ButtonBase>
                      <div className="writing-workbench__paragraph-markdown markdown-body" data-writing-markdown-reader="true">
                        <RichMarkdownMessage content={paragraph.text || "（空段落）"} />
                      </div>
                      <small>
                        {paragraph.citations?.length ? <span className="writing-workbench__citation-count">{paragraph.citations.length} 引用</span> : null}
                        r{paragraph.revision}
                      </small>
                    </div>
                  );
                }) : (
                  <div className="writing-workbench__empty-document">
                    <FileText size={26} />
                    <strong>{searchText ? "没有匹配段落" : "正文尚无可显示段落"}</strong>
                    <span>{searchText ? "换一个关键词继续搜索。" : "新建 artifact 时提供初始内容，或重新导入源文件。"}</span>
                  </div>
                )}
              </div>

              {selectedParagraph && (selectedArtifact.kind === "chapter" || selectedArtifact.kind === "document") ? (
                <section className="writing-workbench__evidence" aria-labelledby="writing-evidence-title">
                  <div className="writing-workbench__evidence-heading">
                    <div>
                      <p className={WB_EYEBROW}>SOURCE-GROUNDED CITATIONS</p>
                      <h3 id="writing-evidence-title">选中段落的来源</h3>
                    </div>
                    <span>{selectedCitations.length} / 16</span>
                  </div>
                  {selectedCitations.length ? (
                    <div className="writing-workbench__citation-list">
                      {selectedCitations.map((citation) => (
                        <article key={citation.id} className="writing-workbench__citation" data-citation-id={citation.id}>
                          <ButtonBase
                            type="button"
                            className="writing-workbench__citation-jump"
                            onClick={() => selectArtifact(citation.sourceArtifactId, citation.sourceParagraphId, citation.sourceRevision, citation.sourcePageNumber)}
                          >
                            <ExternalLink size={13} />
                            <span>
                              <strong>{citation.sourceTitle}</strong>
                              <small>revision {citation.sourceRevision} · {shortHash(citation.sourceSha256)}</small>
                            </span>
                          </ButtonBase>
                          <p>{citation.sourceExcerpt || "（来源段落为空）"}</p>
                          {manualToolsOpen && !isHistoricalPreview ? (
                            <ButtonBase
                              type="button"
                              className="writing-workbench__citation-remove"
                              disabled={actionLocked || draftDirty || !canEditCitations}
                              onClick={() => void writeSelectedParagraphCitations(
                                citationRefsWithout(citation.id),
                                "移除当前段落的受控来源引用"
                              )}
                              aria-label={`移除来源 ${citation.sourceTitle}`}
                              title="移除此引用"
                            >
                              <X size={13} />
                            </ButtonBase>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  ) : <p className="writing-workbench__muted">当前段落还没有受控来源引用。</p>}

                  {manualToolsOpen && !isHistoricalPreview ? (
                    <div className="writing-workbench__citation-add" aria-label="增加受控来源引用">
                      <label htmlFor={citationSourceId}>资料</label>
                      <select
                        id={citationSourceId}
                        value={citationSourceArtifact?.id ?? ""}
                        disabled={actionLocked || !canEditCitations || !citationSourceArtifacts.length}
                        onChange={(event) => {
                          const source = citationSourceArtifacts.find((artifact) => artifact.id === event.target.value);
                          setCitationSourceArtifactId(event.target.value);
                          setCitationSourceParagraphId(source?.paragraphs[0]?.id ?? "");
                        }}
                      >
                        {!citationSourceArtifacts.length ? <option value="">没有可达的就绪资料</option> : null}
                        {citationSourceArtifacts.map((artifact) => (
                          <option key={artifact.id} value={artifact.id}>{artifact.title} · r{artifact.revision}</option>
                        ))}
                      </select>
                      <label htmlFor={citationParagraphId}>段落</label>
                      {citationSourceArtifact?.provenance.source?.format === "pdf" ? (
                        <select
                          id={citationParagraphId}
                          value={citationSourcePdfBlock?.blockId ?? ""}
                          disabled={actionLocked || !canEditCitations || !citationSourcePdfBlock}
                          onChange={(event) => setCitationSourceParagraphId(event.target.value)}
                        >
                          {(pdfWindow?.artifactId === citationSourceArtifact.id ? pdfWindow.pages.flatMap((page) => page.blocks.map((block) => ({ page, block }))) : []).map(({ page, block }) => (
                            <option key={block.blockId} value={block.blockId}>
                              第 {page.pageNumber} 页 · {block.text.replace(/\s+/g, " ").slice(0, 64) || "（空块）"}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <select
                          id={citationParagraphId}
                          value={citationSourceParagraph?.id ?? ""}
                          disabled={actionLocked || !canEditCitations || !citationSourceArtifact?.paragraphs.length}
                          onChange={(event) => setCitationSourceParagraphId(event.target.value)}
                        >
                          {(citationSourceArtifact?.paragraphs ?? []).map((paragraph, index) => (
                            <option key={paragraph.id} value={paragraph.id}>
                              {index + 1}. {paragraph.text.replace(/\s+/g, " ").slice(0, 72) || "（空段落）"}
                            </option>
                          ))}
                        </select>
                      )}
                      <ButtonBase
                        type="button"
                        className={`${WB_BUTTON} writing-workbench__button--ghost`}
                        disabled={actionLocked || draftDirty || !canEditCitations || (citationSourceArtifact?.provenance.source?.format === "pdf" ? !citationSourcePdfBlock : !citationSourceParagraph) || citationAlreadyPresent || selectedCitations.length >= 16}
                        onClick={() => void addSelectedParagraphCitation()}
                      >
                        <Plus size={13} /> {citationAlreadyPresent ? "已引用" : citationSourceArtifact?.provenance.source?.format === "pdf" ? "引用此页块" : "引用此段"}
                      </ButtonBase>
                    </div>
                  ) : null}
                  {selectedArtifact.status !== "ready" ? (
                    <p className="writing-workbench__evidence-warning">当前 artifact 为“{STATUS_LABELS[selectedArtifact.status]}”，来源结构只读；请先从最新上游重建。</p>
                  ) : null}
                </section>
              ) : null}

              {selectedArtifact.kind === "review" ? (
                <section className="writing-workbench__findings" aria-labelledby="writing-findings-title">
                  <div className="writing-workbench__evidence-heading">
                    <div>
                      <p className={WB_EYEBROW}>STRUCTURED REVIEW</p>
                      <h3 id="writing-findings-title">结构化审校项</h3>
                    </div>
                    <span>{displayedReviewFindings.filter((finding) => finding.status === "open").length} 待处理 · {displayedReviewFindings.length} 总计</span>
                  </div>
                  {displayedReviewFindings.length ? (
                    <div className="writing-workbench__finding-list">
                      {displayedReviewFindings.map((finding) => {
                        const target = artifactById.get(finding.targetArtifactId);
                        return (
                          <article
                            key={finding.id}
                            className={`writing-workbench__finding is-${finding.severity} is-${finding.status}`}
                            data-finding-id={finding.id}
                            data-finding-status={finding.status}
                          >
                            <header>
                              <span>{FINDING_CATEGORY_LABELS[finding.category]} · {FINDING_SEVERITY_LABELS[finding.severity]}</span>
                              <em>{FINDING_STATUS_LABELS[finding.status]}</em>
                            </header>
                            <p>{finding.message}</p>
                            {finding.suggestion ? <blockquote>{finding.suggestion}</blockquote> : null}
                            <footer>
                              <ButtonBase type="button" onClick={() => selectArtifact(finding.targetArtifactId, finding.targetParagraphId, finding.targetRevision)}>
                                <ExternalLink size={12} /> {artifactLabel(target, KIND_META)} · r{finding.targetRevision}
                              </ButtonBase>
                              {finding.status === "open" && !isHistoricalPreview ? (
                                <span>
                                  <ButtonBase
                                    type="button"
                                    disabled={actionLocked || selectedArtifact.status !== "ready"}
                                    onClick={() => void updateFindingStatus(finding, "resolved")}
                                  >
                                    <Check size={12} /> 标记解决
                                  </ButtonBase>
                                  <ButtonBase
                                    type="button"
                                    disabled={actionLocked || selectedArtifact.status !== "ready"}
                                    onClick={() => void updateFindingStatus(finding, "dismissed")}
                                  >
                                    <X size={12} /> 忽略
                                  </ButtonBase>
                                </span>
                              ) : <span className="writing-workbench__finding-done"><ShieldCheck size={12} /> {FINDING_STATUS_LABELS[finding.status]}</span>}
                            </footer>
                          </article>
                        );
                      })}
                    </div>
                  ) : <p className="writing-workbench__muted">当前审阅还没有结构化 finding；Agent 可在审校时生成并绑定真实正文段落。</p>}
                </section>
              ) : null}

              {selectedParagraph && !selectedOffice && !isHistoricalPreview && !selectedImmutableSnapshot ? (
                <section className="writing-workbench__paragraph-editor" aria-labelledby="paragraph-editor-title">
                  <div className="writing-workbench__editor-heading">
                    <div>
                      <p className={WB_EYEBROW}>PARAGRAPH PATCH</p>
                      <h3 id="paragraph-editor-title">编辑选中段落</h3>
                    </div>
                    <span>expected revision {draftDirty ? draftOrigin.expectedRevision : selectedArtifact.revision}</span>
                  </div>
                  {draftDirty ? (
                    <div className="writing-workbench__preview-banner writing-workbench__preview-banner--draft" role="alert">
                      <PencilLine size={14} />
                      {draftStale
                        ? "磁盘 revision 已变化；本地草稿仍被保留。保存会触发冲突保护，请先复制草稿或放弃后重新合并。"
                        : "当前段落有尚未保存的本地修改。切换 artifact 或 revision 前会要求确认。"}
                      <ButtonBase type="button" onClick={discardDraftToDisplayedParagraph}>放弃本地修改</ButtonBase>
                    </div>
                  ) : null}
                  <label className="writing-workbench__sr-only" htmlFor={paragraphEditorId}>段落正文</label>
                  <textarea
                    id={paragraphEditorId}
                    value={draftText}
                    rows={7}
                    disabled={actionLocked}
                    onChange={(event) => setDraftText(event.target.value)}
                  />
                  <div className="writing-workbench__editor-actions">
                    <ButtonBase
                      type="button"
                      className={`${WB_BUTTON} writing-workbench__button--primary`}
                      disabled={actionLocked || !draftDirty}
                      onClick={() => void replaceParagraph()}
                    >
                      <Check size={14} /> 保存为新 revision
                    </ButtonBase>
                    {manualToolsOpen ? <ButtonBase
                      type="button"
                      className={`${WB_BUTTON} writing-workbench__button--danger`}
                      disabled={actionLocked || displayedParagraphs.length <= 1}
                      onClick={() => void deleteParagraph()}
                    >
                      <Trash2 size={14} /> 删除此段
                    </ButtonBase> : null}
                  </div>

                  {manualToolsOpen ? <div className="writing-workbench__insert-editor">
                    <label htmlFor={insertEditorId}>在选中段落后插入</label>
                    <textarea
                      id={insertEditorId}
                      value={insertText}
                      rows={3}
                      placeholder="输入一个新段落…"
                      disabled={actionLocked}
                      onChange={(event) => setInsertText(event.target.value)}
                    />
                    <ButtonBase
                      type="button"
                      className={`${WB_BUTTON} writing-workbench__button--ghost`}
                      disabled={actionLocked || !insertText.trim()}
                      onClick={() => void insertParagraph()}
                    >
                      <Plus size={14} /> 插入并创建 revision
                    </ButtonBase>
                  </div> : null}
                </section>
              ) : null}
            </>
          ) : (
            <div className="writing-workbench__empty-document writing-workbench__empty-document--workspace">
              <BookOpenText size={34} />
              <strong>从第一个真实 artifact 开始</strong>
              <span>{WRITING_EMPTY_DESCRIPTION}</span>
              <ButtonBase
                type="button"
                className={`${WB_BUTTON} writing-workbench__button--primary`}
                disabled={actionLocked}
                onClick={() => void importDocuments()}
              >
                <FileInput size={15} /> 导入资料
              </ButtonBase>
            </div>
          )}
        </main>

        {manualToolsOpen ? <aside className="writing-workbench__inspector" aria-label="版本与来源">
          {selectedArtifact ? (
            <>
              <section>
                <div className="writing-workbench__panel-heading">
                  <div>
                    <p className={WB_EYEBROW}>PROVENANCE</p>
                    <h2>来源与状态</h2>
                  </div>
                  <UsersRound size={17} aria-hidden="true" />
                </div>
                <dl className="writing-workbench__facts">
                  <div><dt>状态</dt><dd>{STATUS_LABELS[selectedArtifact.status]}</dd></div>
                  <div><dt>当前 revision</dt><dd>{selectedArtifact.revision}</dd></div>
                  <div><dt>内容 SHA</dt><dd title={selectedArtifact.contentSha256}>{shortHash(selectedArtifact.contentSha256)}</dd></div>
                  <div><dt>结构 SHA</dt><dd title={selectedArtifact.structureSha256}>{shortHash(selectedArtifact.structureSha256)}</dd></div>
                  <div><dt>受控路径</dt><dd title={selectedArtifact.relativePath}>{selectedArtifact.relativePath || "尚未写入"}</dd></div>
                  <div><dt>工具 / 模型</dt><dd>{selectedArtifact.provenance.tool || "人工编辑"}{selectedArtifact.provenance.model ? ` · ${selectedArtifact.provenance.model}` : ""}</dd></div>
                  {importedSource ? (
                    <div>
                      <dt>{importedSource.format === "docx" ? "DOCX 来源" : "导入来源"}</dt>
                      <dd>
                        {importedSource.originalName}
                        {importedSource.structure ? ` · ${importedSource.structure.blockCount} 块 / ${importedSource.structure.headingCount} 标题 / ${importedSource.structure.tableCount} 表格` : ""}
                        {importedSource.warnings?.length ? ` · ${importedSource.warnings.join("；")}` : ""}
                      </dd>
                    </div>
                  ) : null}
                </dl>

                <div className="writing-workbench__inbound">
                  <h3>输入关系</h3>
                  {inboundEdges.length ? inboundEdges.map((edge) => (
                    <ButtonBase type="button" key={edge.id} onClick={() => selectArtifact(edge.sourceArtifactId, undefined, edge.sourceRevision)}>
                      <span>{RELATION_LABELS[edge.relation]}</span>
                      <strong>{artifactLabel(artifactById.get(edge.sourceArtifactId), KIND_META)}</strong>
                      <small>source r{edge.sourceRevision}</small>
                    </ButtonBase>
                  )) : <p>这是起点 artifact，或尚未绑定上游来源。</p>}
                </div>
              </section>

              <section className="writing-workbench__history">
                <div className="writing-workbench__panel-heading">
                  <div>
                    <p className={WB_EYEBROW}>REVISION HISTORY</p>
                    <h2>版本历史</h2>
                  </div>
                  <History size={17} aria-hidden="true" />
                </div>
                <div className="writing-workbench__revision-list">
                  {[...selectedArtifact.revisions]
                    .sort((left, right) => right.revision - left.revision)
                    .map((revision) => {
                      const current = revision.revision === selectedArtifact.revision;
                      return (
                        <article className={`writing-workbench__revision${current ? " is-current" : ""}`} key={revision.revision}>
                          <div>
                            <strong>Revision {revision.revision}</strong>
                            {current ? <span>当前</span> : null}
                          </div>
                          <p>{revision.summary || `${revision.author === "agent" ? "Agent" : revision.author === "import" ? "导入" : "人工"}保存的版本`}</p>
                          <small><Clock3 size={11} /> {formatDate(revision.createdAt)} · {shortHash(revision.contentSha256)}</small>
                          <div className="writing-workbench__revision-actions">
                            <ButtonBase type="button" onClick={() => previewArtifactRevision(revision.revision)}>预览</ButtonBase>
                            {!current && !selectedImmutableSnapshot ? (
                              <ButtonBase
                                type="button"
                                disabled={actionLocked}
                                onClick={() => void restoreArtifactRevision(revision.revision)}
                              >
                                <RotateCcw size={12} /> 恢复
                              </ButtonBase>
                            ) : null}
                          </div>
                        </article>
                      );
                    })}
                  {!selectedArtifact.revisions.length ? <p className="writing-workbench__muted">保存或导入后会在这里出现可恢复 revision。</p> : null}
                </div>
              </section>
            </>
          ) : (
            <div className="writing-workbench__inspector-empty">
              <UserRound size={24} />
              <p>选择 artifact 后显示来源、SHA 与 revision。</p>
            </div>
          )}
        </aside> : null}
      </div>}
      {selectedArtifact && workReviews.get(selectedArtifact.id) ? <WorkReviewPanel key={selectedArtifact.id} review={workReviews.get(selectedArtifact.id)!} busy={actionLocked} onDecide={async input => {
        await focusEditorCommit.current?.();
        await onWorkReview(input);
        const message = `@${workspaceReferenceCode("document", input.artifactId)} ${input.action === "confirm" ? `当前阶段已在节点中确认。${input.feedback?.trim() ? `我的补充：${input.feedback.trim()}。` : ""}请读取最新核对状态，按已确认目标继续；目标已完成时直接交付。` : `我的修改意见：${input.feedback}。请针对当前阶段修订后再次交我核对。`}`;
        await onAskAgent(message, message);
      }} /> : null}
      </div></Suspense>, canvasFocusHost) : null}
      {canvasMenu ? (
        <MenuSurface
          className="canvas-context-menu writing-canvas-context-menu"
          x={canvasMenu.clientX}
          y={canvasMenu.clientY}
          ariaLabel={canvasMenu.kind === "canvas" ? "写作画布菜单" : "写作节点菜单"}
          data-writing-context-menu={canvasMenu.kind}
          onRequestClose={() => setCanvasMenu(null)}
        >
          {canvasMenu.kind !== "canvas" && canvasMenu.nodeId && onTransfer ? <ProjectTransferMenu projects={transferProjects} sourceId={projectId} onTransfer={(target, mode) => { const id = canvasMenu.nodeId!; setCanvasMenu(null); void runAction("transfer", async () => { await onTransfer([id], target, mode); }); }} /> : null}
          {canvasMenu.kind === "canvas" ? (
            <>
              <MenuItem data-writing-canvas-action="agent-create" data-writing-focus-agent="true" icon={<Brain size={15} />} onClick={() => { setCanvasMenu(null); void onFocusAgent(); }}>
                告诉 AI 要做什么
              </MenuItem>
              <MenuItem icon={<FileInput size={15} />} onClick={() => { setCanvasMenu(null); void importDocuments(); }}>
                导入文档
              </MenuItem>
            </>
          ) : (() => {
            const artifact = canvasMenu.nodeId ? artifactById.get(canvasMenu.nodeId) : undefined;
            if (!artifact) return null;
            if (isNovelRoot(artifact) || artifact.attributes?.novelId) return <>
              <MenuSummary title={artifact.title}>{isNovelRoot(artifact) ? "小说" : "章节"}</MenuSummary>
              <MenuItem icon={<BookOpenText size={15} />} onClick={() => openArtifactFromCanvas(artifact)}>打开编辑</MenuItem>
              <MenuItem icon={<Send size={15} />} onClick={() => referenceCanvasArtifact(artifact)}>引用到 Agent</MenuItem>
              <MenuSeparator /><MenuItem icon={<Brain size={15} />} onClick={() => { setCanvasMenu(null); void onFocusAgent(); }}>与 AI 讨论下一步</MenuItem>
            </>;
            const rolePresentation = writingArtifactRolePresentation(artifact, KIND_META, templateProfile);
            const canCreateOutline = (WRITING_SOURCE_KINDS.outline || []).includes(artifact.kind);
            const canCreateCharacter = (WRITING_SOURCE_KINDS.character || []).includes(artifact.kind);
            const canContinueChapter = (WRITING_SOURCE_KINDS.chapter || []).includes(artifact.kind);
            const incomingEdges = session.artifactEdges.filter((edge) => edge.targetArtifactId === artifact.id);
            const requiredSourceKinds = WRITING_REQUIRED_SOURCE_KINDS[artifact.kind] || [];
            return (
              <>
                <MenuSummary title={artifact.title || KIND_META[artifact.kind].label}>
                  {rolePresentation.label} · revision {artifact.revision}
                </MenuSummary>
                <MenuItem icon={<Send size={15} />} disabled={artifact.status !== "ready"} onClick={() => referenceCanvasArtifact(artifact)}>
                  引用到 Agent
                </MenuItem>
                <MenuItem icon={<BookOpenText size={15} />} onClick={() => openArtifactFromCanvas(artifact)}>
                  打开成果
                </MenuItem>
                {artifact.provenance.office ? <MenuItem icon={<History size={15} />} onClick={() => openArtifactFromCanvas(artifact, true)}>版本与来源</MenuItem> : null}
                <MenuSeparator />
                {templateProfile.id === "fiction" && canCreateOutline ? (
                  <MenuItem icon={<Workflow size={15} />} disabled={artifact.status !== "ready"} onClick={() => openCreateNode("world-building", canvasMenu)}>
                    从这里创建故事设定
                  </MenuItem>
                ) : null}
                {canCreateOutline ? (
                  <MenuItem icon={<Workflow size={15} />} disabled={artifact.status !== "ready"} onClick={() => openCreateNode("outline", canvasMenu)}>
                    从这里创建{templateProfile.id === "fiction" ? "故事大纲" : KIND_META.outline.label}
                  </MenuItem>
                ) : null}
                {canCreateCharacter ? (
                  <MenuItem icon={<UsersRound size={15} />} disabled={artifact.status !== "ready"} onClick={() => openCreateNode("character-list", canvasMenu)}>
                    从这里创建{templateProfile.id === "fiction" ? "角色列表" : KIND_META.character.label}
                  </MenuItem>
                ) : null}
                {canContinueChapter ? (
                  <MenuItem icon={<WandSparkles size={15} />} disabled={artifact.status !== "ready"} onClick={() => openCreateNode("chapter", canvasMenu)}>
                    {artifact.kind === "chapter" && templateProfile.id === "fiction" ? "创建下一章" : `创建${KIND_META.chapter.label}`}
                  </MenuItem>
                ) : null}
                {artifact.kind === "chapter" ? (
                  <>
                    {templateProfile.id === "fiction" ? (
                      <MenuItem icon={<UsersRound size={15} />} disabled={artifact.status !== "ready"} onClick={() => openCreateNode("character-state", canvasMenu)}>
                        记录本章角色状态
                      </MenuItem>
                    ) : null}
                    <MenuItem icon={<Check size={15} />} disabled={artifact.status !== "ready"} onClick={() => openCreateNode("review", canvasMenu)}>
                      创建{KIND_META.review.label}
                    </MenuItem>
                  </>
                ) : null}
                {artifact.kind === "review" || artifact.kind === "chapter" ? (
                  <MenuItem icon={<Download size={15} />} disabled={artifact.status !== "ready"} onClick={() => openCreateNode("document", canvasMenu)}>
                    汇总为{KIND_META.document.label}
                  </MenuItem>
                ) : null}
                {incomingEdges.length ? <MenuSeparator /> : null}
                {incomingEdges.map((edge) => {
                  const source = artifactById.get(edge.sourceArtifactId);
                  const remainingSourceKinds = incomingEdges
                    .filter((candidate) => candidate.id !== edge.id)
                    .map((candidate) => artifactById.get(candidate.sourceArtifactId)?.kind)
                    .filter((kind): kind is WritingArtifactKind => Boolean(kind));
                  const canDisconnect = !requiredSourceKinds.length || remainingSourceKinds.some((kind) => requiredSourceKinds.includes(kind));
                  return (
                    <MenuItem
                      key={edge.id}
                      icon={<Trash2 size={15} />}
                      disabled={actionLocked || !canDisconnect}
                      onClick={() => {
                        setCanvasMenu(null);
                        void Promise.resolve(onConnectArtifacts(edge.sourceArtifactId, artifact.id, false)).catch(() => undefined);
                      }}
                    >
                      断开「{source?.title || "上游节点"}」
                    </MenuItem>
                  );
                })}
              </>
            );
          })()}
        </MenuSurface>
      ) : null}
      {discardDraftDialogOpen ? (
        <DialogShell
          surface="writing-discard-draft"
          ariaLabel="放弃未保存的段落修改"
          className="confirm-dialog writing-discard-draft-dialog"
          dialogDataAttributes={{ "data-writing-discard-dialog": "true" }}
          layerLevel="nested"
          onRequestClose={cancelDiscardDraft}
        >
          {({ requestClose }) => (
            <>
              <SurfaceHeader
                title="放弃未保存的修改？"
                description="当前段落还没有保存。"
                onClose={() => requestClose("close-button")}
                closeLabel="继续编辑当前段落"
              />
              <SurfaceBody>
                <div className="confirm-summary">
                  <strong>放弃修改后，再继续刚才的操作。</strong>
                  <p>选择继续编辑会保留当前草稿。</p>
                </div>
              </SurfaceBody>
              <SurfaceFooter>
                <ActionButton data-autofocus onClick={() => requestClose("action")}>继续编辑</ActionButton>
                <ActionButton variant="danger" icon={<Trash2 size={15} />} onClick={discardDraftAndContinue}>放弃并继续</ActionButton>
              </SurfaceFooter>
            </>
          )}
        </DialogShell>
      ) : null}
      {createDraft ? (
        <DialogShell
          surface="writing-node-create"
          ariaLabel="创建写作节点"
          className="writing-node-dialog"
          dialogDataAttributes={{ "data-writing-create-dialog": "true", "data-writing-create-kind": createDraft.kind, "data-writing-create-role": createDraft.role }}
          busy={actionLocked}
          onRequestClose={() => setCreateDraft(null)}
        >
          {({ requestClose }) => (
            <>
              <SurfaceHeader
                title={createDraft.role === "writing-request" ? "创建需求" : "创建写作内容"}
                description={createDraft.contextNodeId
                  ? "新内容会保留来源连线，并放在当前画布位置。"
                  : "先写下目标；创建后可交给 Agent 生成结构、正文和成稿。"}
                onClose={() => requestClose("close-button")}
                closeDisabled={actionLocked}
              />
              <SurfaceBody className="writing-node-dialog__body">
                <div className="writing-node-dialog__fields">
                  {createDraft.contextNodeId ? (
                    <Field label="类型">
                      <select
                        className="ui-control"
                        value={createDraft.role}
                        disabled={actionLocked}
                        onChange={(event) => changeCreateNodeRole(event.target.value as WritingCanvasNodeRole)}
                      >
                        {writingNodeRoleOptions.map((option) => <option key={option.role} value={option.role}>{option.label}</option>)}
                      </select>
                    </Field>
                  ) : null}
                  {createDraft.role === "writing-request" ? <Field label="类别"><div className="writing-demand-categories" role="radiogroup" aria-label="需求类别">{WRITING_DEMAND_CATEGORIES.map((category) => <ButtonBase type="button" key={category.id} role="radio" aria-checked={(createDraft.category || "novel") === category.id} onClick={() => setCreateDraft({ ...createDraft, category: category.id })}>{category.label}</ButtonBase>)}</div></Field> : <Field label="名称">
                    <input
                      className="ui-control"
                      data-autofocus
                      value={createDraft.title}
                      placeholder="自动使用类型名称，也可以自定义"
                      maxLength={240}
                      disabled={actionLocked}
                      onChange={(event) => setCreateDraft((current) => current ? { ...current, title: event.target.value } : current)}
                    />
                  </Field>}
                  <Field className="writing-node-dialog__content" label={createDraft.role === "writing-request" ? "需求" : "初始内容"}>
                    <textarea
                      className="ui-control"
                      rows={8}
                      value={createDraft.text}
                      placeholder={createDraft.role === "writing-request" ? "描述你整体想做什么。小说只需写下你的想法，Agent 会先与你核对。" : "可留空，之后交给 Agent 继续。"}
                      disabled={actionLocked}
                      onChange={(event) => setCreateDraft((current) => current ? { ...current, text: event.target.value } : current)}
                    />
                  </Field>
                </div>
                {createAcceptsSource ? (
                  <section className="writing-node-dialog__sources" aria-label="写作节点上游">
                    <div>
                      <strong>上游节点</strong>
                      <span>{createDraft.sourceArtifactIds.length ? `已选择 ${createDraft.sourceArtifactIds.length} 个` : createNeedsSource ? "至少选择一个" : "可选"}</span>
                    </div>
                    {createSourceOptions.length ? (
                      <div className="writing-node-dialog__source-list">
                        {createSourceOptions.map((artifact) => {
                          const checked = createDraft.sourceArtifactIds.includes(artifact.id);
                          return (
                            <label key={artifact.id} className={checked ? "is-selected" : ""}>
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={actionLocked}
                                onChange={() => setCreateDraft((current) => current ? {
                                  ...current,
                                  sourceArtifactIds: checked
                                    ? current.sourceArtifactIds.filter((id) => id !== artifact.id)
                                    : [...current.sourceArtifactIds, artifact.id]
                                } : current)}
                              />
                              <span><strong>{artifact.title}</strong><small>{KIND_META[artifact.kind].label} · r{artifact.revision}</small></span>
                            </label>
                          );
                        })}
                      </div>
                    ) : createNeedsSource ? <InlineNotice tone="warning">先创建写作需求、{KIND_META.outline.label}、{KIND_META.character.label}、资料或前一{KIND_META.chapter.label}，再创建这个节点。</InlineNotice> : <p className="writing-workbench__muted">当前还没有可连接的上游节点；可以先作为根节点创建。</p>}
                  </section>
                ) : null}
                {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
              </SurfaceBody>
              <SurfaceFooter>
                <ActionButton variant="ghost" onClick={() => requestClose("action")} disabled={actionLocked}>取消</ActionButton>
                <ActionButton
                  variant="primary"
                  icon={<Plus size={15} />}
                  busy={pendingAction === "create"}
                   disabled={actionLocked || !createHasRequiredSource || (createDraft.role === "writing-request" && !createDraft.text.trim())}
                  onClick={() => void submitCreateNode()}
                >
                  创建到画布
                </ActionButton>
              </SurfaceFooter>
            </>
          )}
        </DialogShell>
      ) : null}
    </section>
  );
}
