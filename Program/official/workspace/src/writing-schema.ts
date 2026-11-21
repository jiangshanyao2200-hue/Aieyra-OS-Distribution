import type { ArtifactKind, ProjectKind } from "./project-capabilities";

export const WRITING_ARTIFACT_KINDS = [
  "outline",
  "character",
  "source-document",
  "chapter",
  "review",
  "document"
] as const satisfies readonly ArtifactKind[];

export type WritingArtifactKind = (typeof WRITING_ARTIFACT_KINDS)[number];
export type ArtifactStatus = "draft" | "running" | "ready" | "stale" | "waiting" | "error" | "cancelled";

export type ProvenanceInput = {
  artifactId: string;
  revision: number;
  sha256?: string;
  structureSha256?: string;
};

export type ImportedSourceProvenance = {
  /** Project-relative path below .iiimage/writing/sources; never an absolute user path. */
  relativePath: string;
  originalName: string;
  sha256: string;
  byteLength: number;
  importedAt: string;
  format: "txt" | "markdown" | "html" | "doc" | "docx" | "ppt" | "pptx" | "pdf" | "csv" | "tsv" | "json" | "xlsx";
  mimeType: "text/plain" | "text/markdown" | "text/html" | "application/msword" | "application/vnd.ms-powerpoint" | "application/vnd.openxmlformats-officedocument.presentationml.presentation" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document" | "application/pdf";
  parserVersion?: string;
  canonicalSha256?: string;
  warnings?: string[];
  structure?: {
    pageCount?: number;
    scannedPageCount?: number;
    blockCount?: number;
    headingCount?: number;
    listItemCount?: number;
    tableCount?: number;
    mediaCount?: number;
    externalRelationshipCount?: number;
  };
  pdf?: {
    indexVersion: 1;
    indexSha256: string;
    pageCount: number;
    blockCount: number;
    scannedPageCount: number;
    externalRelationshipCount: number;
  };
};

export type CrossProjectSourceProvenance = {
  sourceProjectId: string;
  sourceProjectKind: "data";
  sourceArtifactId: string;
  sourceArtifactKind: "report";
  sourceRevision: number;
  sourceArtifactSha256: string;
  canonicalMarkdownSha256: string;
  copiedAt: string;
};

export type WritingIllustration = { id: string; relativePath: string; sha256: string; byteLength: number; width: number; height: number; caption: string;
  source: { name: string; sha256: string; projectId?: string; projectName?: string; nodeId?: string; occurrenceId?: string; originNodeId?: string; originTitle?: string } };
export type WritingIllustrationInput = { action: "add" | "replace" | "remove"; artifactId: string; expectedRevision: number; illustrationId?: string; sourceProjectId?: string; nodeId?: string; occurrenceId?: string; assetIndex?: number; expectedSourceSha256?: string; expectedSourceStamp?: string; caption?: string };
export type ProvenanceRecord = {
  illustrations?: WritingIllustration[];
  office?: { relativePath: string; sha256: string; byteLength: number; previewRelativePath: string; previewSha256: string };
  inputs: ProvenanceInput[];
  runId?: string;
  model?: string;
  tool?: string;
  toolVersion?: string;
  promptRevision?: string;
  parameters?: Record<string, string | number | boolean | null>;
  outputSha256?: string;
  generatedAt?: string;
  source?: ImportedSourceProvenance;
  crossProjectSource?: CrossProjectSourceProvenance;
};

export type WritingCitationV1 = {
  id: string;
  targetParagraphId: string;
  sourceArtifactId: string;
  sourceRevision: number;
  sourceSha256: string;
  sourceParagraphId: string;
  sourceParagraphRevision: number;
  sourceParagraphSha256: string;
  sourcePageNumber?: number;
  sourceBlockId?: string;
  sourceBlockSha256?: string;
  sourceTitle: string;
  sourceExcerpt: string;
};

export type WritingCitationRef = {
  sourceArtifactId: string;
  expectedSourceRevision: number;
  sourceParagraphId: string;
  sourcePageNumber?: number;
  sourceBlockId?: string;
  sourceBlockSha256?: string;
};

export type WritingPdfWindowBlock = {
  blockId: string;
  text: string;
  bbox: { x: number; y: number; width: number; height: number };
  blockSha256: string;
};

export type WritingPdfWindowPage = {
  pageNumber: number;
  width: number;
  height: number;
  rotation: number;
  status: "ready" | "scanned";
  textSha256: string;
  blocks: WritingPdfWindowBlock[];
};

export type WritingPdfWindow = {
  artifactId: string;
  revision: number;
  sourceSha256: string;
  pageCount: number;
  pages: WritingPdfWindowPage[];
};

export type WritingReviewFindingV1 = {
  id: string;
  targetArtifactId: string;
  targetRevision: number;
  targetSha256: string;
  targetParagraphId: string;
  category: "evidence" | "structure" | "clarity" | "consistency" | "style" | "grammar";
  severity: "info" | "warning" | "error";
  status: "open" | "resolved" | "dismissed";
  message: string;
  suggestion?: string;
};

export type WritingParagraph = {
  id: string;
  text: string;
  revision: number;
  citations?: WritingCitationV1[];
};

export type WritingRevision = {
  revision: number;
  parentRevision: number;
  createdAt: string;
  author: "user" | "agent" | "import";
  contentSha256: string;
  structureSha256?: string;
  byteLength: number;
  mimeType: "text/plain" | "text/markdown";
  paragraphs: WritingParagraph[];
  reviewFindings?: WritingReviewFindingV1[];
  summary?: string;
  provenance?: ProvenanceRecord;
  contentPolicy?: "immutable-snapshot";
};

export type WritingArtifactDescriptor = {
  id: string;
  kind: WritingArtifactKind;
  title: string;
  status: ArtifactStatus;
  projectId: string;
  relativePath?: string;
  mimeType?: "text/plain" | "text/markdown";
  sourceArtifactIds: string[];
  provenance: ProvenanceRecord;
  createdAt: string;
  updatedAt: string;
  revision: number;
  contentSha256: string;
  structureSha256?: string;
  byteLength?: number;
  attributes?: Record<string, string | number | boolean | string[] | null>;
  contentPolicy?: "immutable-snapshot";
};

/** Renderer-hydrated form. Paragraph bodies and revision snapshots live on disk, not in session.json. */
export type WritingArtifactRecord = WritingArtifactDescriptor & {
  paragraphs: WritingParagraph[];
  revisions: WritingRevision[];
  reviewFindings?: WritingReviewFindingV1[];
};

export type WritingArtifactEdge = {
  id: string;
  sourceArtifactId: string;
  targetArtifactId: string;
  relation: "refines" | "defines" | "updates" | "outlines" | "describes" | "references" | "continues" | "reviews" | "assembles";
  sourceRevision: number;
  createdAt: string;
};

export type WritingArtifactLayout = {
  artifactId: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
};

export type WritingArtifactViewport = {
  x: number;
  y: number;
  scale: number;
};

export type WritingSessionFields = {
  schemaVersion: 4;
  projectKind: Extract<ProjectKind, "writing">;
  artifacts: WritingArtifactRecord[];
  artifactEdges: WritingArtifactEdge[];
  artifactLayout: WritingArtifactLayout[];
  artifactViewport: WritingArtifactViewport;
  selectedArtifactId: string;
  selectedParagraphId: string;
};

/** Persisted session form: identity/layout/provenance only; hydrate from controlled files on load. */
export type PersistedWritingSessionFields = Omit<WritingSessionFields, "artifacts"> & {
  artifacts: WritingArtifactDescriptor[];
};

export type WritingParagraphPatchOperation =
  | { op: "replace"; paragraphId: string; text: string; citationRefs?: WritingCitationRef[]; citations?: WritingCitationV1[] }
  | { op: "insert-after"; paragraphId: string; newParagraphId?: string; text: string; citationRefs?: WritingCitationRef[]; citations?: WritingCitationV1[] }
  | { op: "delete"; paragraphId: string };

export type WritingParagraphPatch = {
  expectedRevision: number;
  operations: WritingParagraphPatchOperation[];
  author?: "user" | "agent";
  summary?: string;
  provenance?: Partial<ProvenanceRecord>;
};

export type WritingExportReceipt = {
  path: string;
  format: "markdown" | "txt" | "html" | "docx" | "pdf";
  mimeType: "text/plain" | "text/markdown" | "text/html" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document" | "application/pdf";
  revision: number;
  byteLength: number;
  sha256: string;
  artifactId: string;
  inputContentSha256: string;
  inputStructureSha256: string;
  citationCount: number;
  sourceManifest: Array<{
    sourceArtifactId: string;
    sourceRevision: number;
    sourceSha256: string;
    sourceTitle: string;
  }>;
  provenance: {
    inputArtifactId: string;
    inputRevision: number;
    inputSha256: string;
    inputStructureSha256: string;
    tool: "document_export";
    toolVersion: string;
    generatedAt: string;
  };
  inspection?: {
    entryCount?: number;
    uncompressedBytes?: number;
    paragraphCount?: number;
    tableCount?: number;
    externalRelationshipCount?: number;
    visibleText?: string;
    sha256?: string;
    byteLength?: number;
    pageCount?: number;
    canonicalTextSha256?: string;
    canonicalByteLength?: number;
    verifiedTokenCount?: number;
    generatorVersion?: string;
    parserVersion?: string;
  };
  label?: string;
};

export type WritingReviewFindingStatusUpdate = {
  expectedRevision: number;
  findingId: string;
  status: "resolved" | "dismissed";
};
