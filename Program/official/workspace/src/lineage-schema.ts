import type { ArtifactKind, ProjectKind } from "./project-capabilities";

export const LINEAGE_PROJECT_KINDS = ["data", "finance"] as const satisfies readonly ProjectKind[];

export const DATA_ARTIFACT_KINDS = [
  "dataset",
  "clean",
  "transform",
  "analysis",
  "chart",
  "report",
  "presentation"
] as const satisfies readonly ArtifactKind[];

export const FINANCE_ARTIFACT_KINDS = [
  "market-data",
  "financial-statement",
  "valuation",
  "portfolio",
  "scenario-workbook",
  "risk-review",
  "finance-report"
] as const satisfies readonly ArtifactKind[];

export type LineageProjectKind = (typeof LINEAGE_PROJECT_KINDS)[number];
export type DataArtifactKind = (typeof DATA_ARTIFACT_KINDS)[number];
export type FinanceArtifactKind = (typeof FINANCE_ARTIFACT_KINDS)[number];
export type LineageArtifactKind = DataArtifactKind | FinanceArtifactKind;
export type LineageArtifactStatus = "running" | "ready" | "stale" | "waiting" | "error" | "cancelled";
export type LineageCell = string | number | boolean | null;

export type LineageColumn = {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "date" | "mixed" | "empty";
  nullable: boolean;
  missingCount: number;
  distinctCount?: number;
};

export type LineageTablePreview = {
  sheetName: string;
  sheetNames: string[];
  columns: LineageColumn[];
  rows: Record<string, LineageCell>[];
  rowIndices: number[];
  totalRows: number;
  totalColumns: number;
  sampled: boolean;
  sampling: {
    strategy: "complete" | "deterministic-stratified";
    sampledRows: number;
    configuredRowBudget: number;
    cellBudget: number;
    byteBudget: number;
    previewBytes: number;
    truncatedCells: number;
  };
  warnings: string[];
};

export type LineageTableWindow = {
  artifactId: string;
  artifactRevision: number;
  sheetName: string;
  columns: LineageColumn[];
  rows: Record<string, LineageCell>[];
  rowOffset: number;
  requestedRowLimit: number;
  returnedRows: number;
  totalRows: number;
  totalColumns: number;
  hasPrevious: boolean;
  hasNext: boolean;
  payloadBytes: number;
};

export type LineageMetric = {
  key: string;
  label: string;
  value: string | number;
  unit?: string;
  note?: string;
  measure?: "market-value";
  scale?: number;
};

export type LineageChartSpec = {
  chartType: "bar" | "line" | "area" | "scatter";
  title: string;
  xColumn: string;
  yColumn: string;
  unit?: string;
  categories: string[];
  values: number[];
  accessibleDescription: string;
};

export type LineagePresentationSlide = {
  id: string;
  title: string;
  bullets: string[];
  speakerNotes?: string;
  chartArtifactId?: string;
  chartFormat?: PresentationChartFormatV1;
  tableRef?: PresentationTableRefV1;
};

export type PresentationChartFormatV1 = {
  legend: "none" | "bottom" | "right";
  dataLabels: "none" | "value";
  axes: "both" | "category" | "value" | "none";
  palette: "theme" | "categorical" | "sequential" | "diverging";
  placement: "auto" | "full" | "left" | "right";
};

export type ReportBlockV1 =
  | { id: string; type: "paragraph"; text: string }
  | { id: string; type: "bullets"; items: string[] }
  | { id: string; type: "metrics"; metricIndexes: number[] }
  | { id: string; type: "sources"; inputArtifactIds: string[] }
  | { id: string; type: "chart"; chartArtifactId: string };

export type ReportSectionV1 = {
  id: string;
  role: "scope" | "findings" | "limitations" | "custom";
  heading: string;
  blocks: ReportBlockV1[];
};

export type ReportDocumentV1 = {
  structureVersion: 1;
  title: string;
  sections: ReportSectionV1[];
};

export type ReportTableColumnV2 = {
  id: string;
  label: string;
  align: "left" | "center" | "right";
};

export type ReportTableRowV2 = {
  id: string;
  cells: string[];
};

export type PresentationTableRefV1 = {
  reportArtifactId: string;
  tableBlockId: string;
  columnIds: string[];
  placement: "full";
};

/**
 * Canonical Report Delivery Deck v1 only names its root Report. Its revision
 * and SHA-256 are frozen by the Presentation provenance and resolved by the
 * main process; they must never be supplied by the Renderer or Agent.
 */
export type PresentationReportRefV1 = {
  reportArtifactId: string;
};

export type PresentationDeliverySlideBaseV3 = {
  id: string;
  /** Optional presenter-only note; deterministic export owns its rendering. */
  speakerNotes?: string;
};

export type PresentationCoverSlideV3 = PresentationDeliverySlideBaseV3 & {
  type: "cover";
  title: string;
  subtitle?: string;
};

export type PresentationReportBlocksSlideV3 = PresentationDeliverySlideBaseV3 & {
  type: "report-blocks";
  title?: string;
  /** 1-3 canonical paragraph/bullets/metrics/callout/sources block IDs. */
  blockIds: string[];
};

export type PresentationChartSlideV3 = PresentationDeliverySlideBaseV3 & {
  type: "chart";
  title?: string;
  /** Canonical chart block ID in the root ReportDocumentV2. */
  reportBlockId: string;
  chartFormat: PresentationChartFormatV1;
};

export type PresentationTableSlideV3 = PresentationDeliverySlideBaseV3 & {
  type: "table";
  title?: string;
  /** Existing provenance-bound Report table reference; no cells are submitted. */
  tableRef: PresentationTableRefV1;
};

export type PresentationProvenanceSlideV3 = PresentationDeliverySlideBaseV3 & {
  type: "provenance";
  title?: string;
};

export type PresentationDeliverySlideV3 =
  | PresentationCoverSlideV3
  | PresentationReportBlocksSlideV3
  | PresentationChartSlideV3
  | PresentationTableSlideV3
  | PresentationProvenanceSlideV3;

export type ReportBlockV2 =
  | ReportBlockV1
  | { id: string; type: "table"; caption: string; columns: ReportTableColumnV2[]; rows: ReportTableRowV2[] }
  | { id: string; type: "callout"; tone: "note" | "insight" | "warning"; title: string; text: string };

export type ReportSectionV2 = Omit<ReportSectionV1, "blocks"> & {
  blocks: ReportBlockV2[];
};

export type ReportDocumentV2 = {
  structureVersion: 2;
  title: string;
  sections: ReportSectionV2[];
};

export type ReportDocument = ReportDocumentV1 | ReportDocumentV2;

export type PresentationStructureV1 = {
  structureVersion: 1;
  theme: "paper" | "midnight" | "slate";
  slides: LineagePresentationSlide[];
};

export type PresentationStructureV2 = Omit<PresentationStructureV1, "structureVersion"> & {
  structureVersion: 2;
};

export type PresentationStructureV3 = {
  structureVersion: 3;
  theme: "paper" | "midnight" | "slate";
  /** Exactly one canonical Report root; its revision/SHA live in provenance. */
  reportRef: PresentationReportRefV1;
  /** Maximum 24 authored slides; runtime may deterministically add continuation pages. */
  slides: PresentationDeliverySlideV3[];
};

export type PresentationStructure = PresentationStructureV1 | PresentationStructureV2 | PresentationStructureV3;

export type FinanceContext = {
  asOf: string;
  sourceName: string;
  sourceUrl?: string;
  currency: string;
  unit: string;
  timezone: string;
  disclaimer: string;
};

export type FinanceScenarioWorkbookSourceV1 = {
  artifactId: string;
  kind: "valuation" | "portfolio";
  title: string;
  revision: number;
  sha256: string;
  finance: FinanceContext;
};

export type FinanceScenarioWorkbookFactV1 = {
  id: string;
  sourceArtifactId: string;
  label: string;
  value: number;
  measure: "market-value";
  unit: string;
  scale: number;
};

export type FinanceScenarioAssumptionV1 = {
  id: "baseline" | "upside" | "stress";
  label: string;
  adjustmentPercent: number;
};

export type FinanceScenarioValueV1 = {
  sourceArtifactId: string;
  value: number;
};

export type FinanceScenarioV1 = FinanceScenarioAssumptionV1 & {
  values: FinanceScenarioValueV1[];
};

export type FinanceScenarioInferenceV1 = {
  id: string;
  kind: "ranking" | "range";
  text: string;
  sourceArtifactIds: string[];
};

export type FinanceScenarioWorkbookV1 = {
  structureVersion: 1;
  title: string;
  metric: {
    key: "marketCap" | "marketValue";
    label: string;
    measure: "market-value";
    unit: string;
    scale: number;
    direction: "higher-is-upside";
    scenarioRule: "relative-linear";
  };
  sources: FinanceScenarioWorkbookSourceV1[];
  facts: FinanceScenarioWorkbookFactV1[];
  assumptions: FinanceScenarioAssumptionV1[];
  scenarios: FinanceScenarioV1[];
  inferences: FinanceScenarioInferenceV1[];
  risks: string[];
  limitations: string[];
};

export type LineageProvenanceInput = {
  artifactId: string;
  revision: number;
  sha256: string;
};

export type LineageManagedSource = {
  relativePath: string;
  originalName: string;
  sha256: string;
  byteLength: number;
  importedAt: string;
};

export type LineageManagedSourceHistoryEntry = LineageManagedSource & {
  artifactRevision: number;
};

export type LineageProvenance = {
  inputs: LineageProvenanceInput[];
  tool: string;
  toolVersion: string;
  generatedAt: string;
  outputSha256?: string;
  /** Runtime-normalized recipe parameters. Nested arrays/objects are bounded and schema-validated in lineage-runtime. */
  parameters?: Record<string, unknown>;
  source?: LineageManagedSource;
  sourceHistory?: LineageManagedSourceHistoryEntry[];
};

export type LineageArtifactPayload = {
  preview?: LineageTablePreview;
  metrics?: LineageMetric[];
  chart?: LineageChartSpec;
  markdown?: string;
  document?: ReportDocument;
  html?: string;
  /** V1/V2 legacy slide form or the V3 canonical delivery-deck slide union. */
  slides?: Array<LineagePresentationSlide | PresentationDeliverySlideV3>;
  theme?: "paper" | "midnight" | "slate";
  /** V3 Presentation content is reference-only; resolved content remains stored-only. */
  structureVersion?: 1 | 2 | 3;
  reportRef?: PresentationReportRefV1;
  workbook?: FinanceScenarioWorkbookV1;
  finance?: FinanceContext;
  warnings?: string[];
  operation?: string;
  [key: string]: unknown;
};

export type LineageArtifactDescriptor = {
  id: string;
  projectId: string;
  projectKind: LineageProjectKind;
  kind: LineageArtifactKind;
  title: string;
  status: LineageArtifactStatus;
  revision: number;
  relativePath: string;
  mimeType: string;
  contentSha256: string;
  byteLength: number;
  sourceArtifactIds: string[];
  provenance: LineageProvenance;
  createdAt: string;
  updatedAt: string;
  rowCount?: number;
  columnCount?: number;
  sheetNames?: string[];
  attributes?: Record<string, string | number | boolean | string[] | null>;
  finance?: FinanceContext;
};

/** Hydrated renderer form. Full authoritative payload remains in a controlled file. */
export type LineageArtifactRecord = LineageArtifactDescriptor & {
  payload?: LineageArtifactPayload;
};

export type LineageArtifactEdge = {
  id: string;
  sourceArtifactId: string;
  targetArtifactId: string;
  relation: "derived-from" | "analyzes" | "visualizes" | "reports" | "presents" | "values" | "reviews";
  sourceRevision: number;
  createdAt: string;
};

export type LineageArtifactLayout = {
  artifactId: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
};

export type LineageArtifactViewport = {
  x: number;
  y: number;
  scale: number;
};

export type LineageSessionFields = {
  schemaVersion: 4;
  projectKind: LineageProjectKind;
  lineageRevision: 1;
  lineageArtifacts: LineageArtifactRecord[];
  lineageEdges: LineageArtifactEdge[];
  lineageLayout: LineageArtifactLayout[];
  lineageViewport: LineageArtifactViewport;
  selectedLineageArtifactId: string;
};

export type PersistedLineageSessionFields = Omit<LineageSessionFields, "lineageArtifacts"> & {
  lineageArtifacts: LineageArtifactDescriptor[];
};

export type LineageOperation =
  | "clean"
  | "transform"
  | "analysis"
  | "chart"
  | "report"
  | "presentation"
  | "valuation"
  | "portfolio"
  | "scenario-workbook"
  | "risk-review"
  | "finance-report";

export type LineageBridgeResult = {
  ok: boolean;
  canceled?: boolean;
  unchanged?: boolean;
  runId?: string;
  staleArtifactIds?: string[];
  projectId?: string;
  session?: LineageSessionFields & Record<string, unknown>;
  artifact?: LineageArtifactRecord;
  tableWindow?: LineageTableWindow;
  receipt?: {
    artifactId: string;
    revision: number;
    format: string;
    path?: string;
    relativePath?: string;
    sha256: string;
    byteLength: number;
  };
  error?: string;
  code?: string;
  warnings?: string[];
};
