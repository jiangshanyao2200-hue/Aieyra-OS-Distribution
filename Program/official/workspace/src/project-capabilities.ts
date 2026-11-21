import rawRegistry from "../shared/config/project-capabilities.json";

export const PROJECT_SCHEMA_VERSION = 4 as const;
export const PROJECT_KINDS = ["agent", "image", "writing", "data", "finance"] as const;

export type ProjectKind = (typeof PROJECT_KINDS)[number];
export type ProjectCapabilityStatus = "available" | "development" | "planned";
export type ProjectReleaseVisibility = "public" | "development";
export type ProjectSurface = "public" | "development";
/** 画布助手 使用独立时间线；领域项目使用共享无限画布。 */
export type CanvasLayoutPolicy = "infinite-artifact" | "agent-workspace";
export type ResetPolicy = "managed-artifacts";
export type ViewerKind = "image" | "image-layer" | "text" | "markdown" | "revision-diff" | "table" | "analysis" | "chart" | "report" | "presentation" | "finance";

export type ArtifactKind =
  | "image" | "image-container" | "image-layer" | "requirement"
  | "outline" | "character" | "source-document" | "chapter" | "review" | "document"
  | "dataset" | "clean" | "transform" | "analysis" | "chart" | "report" | "presentation"
  | "market-data" | "financial-statement" | "valuation" | "portfolio" | "scenario-workbook" | "risk-review" | "finance-report";

export type ImportRule = {
  extensions: string[];
  mimeTypes?: string[];
  maximumBytes: number;
};

export type ProjectCapabilities = {
  kind: ProjectKind;
  label: string;
  shortLabel: string;
  description: string;
  status: ProjectCapabilityStatus;
  releaseVisibility: ProjectReleaseVisibility;
  canvasLayout: CanvasLayoutPolicy;
  allowedArtifactKinds: readonly ArtifactKind[];
  viewerKinds: readonly ViewerKind[];
};

type ProjectCapabilityRegistry = {
  schemaVersion: number;
  capabilityRevision: string;
  projects: Array<ProjectCapabilities & Record<string, unknown>>;
};

const registry = rawRegistry as ProjectCapabilityRegistry;
const rendererProjects: ProjectCapabilities[] = registry.projects.map((capability) => ({
  kind: capability.kind,
  label: capability.label,
  shortLabel: capability.shortLabel,
  description: capability.description,
  status: capability.status,
  releaseVisibility: capability.releaseVisibility,
  canvasLayout: capability.canvasLayout as CanvasLayoutPolicy,
  allowedArtifactKinds: Array.isArray(capability.allowedArtifactKinds) ? capability.allowedArtifactKinds as ArtifactKind[] : [],
  viewerKinds: Array.isArray(capability.viewerKinds) ? capability.viewerKinds as ViewerKind[] : []
}));
const capabilityByKind = new Map(rendererProjects.map((capability) => [capability.kind, capability]));

if (registry.schemaVersion !== 1 || capabilityByKind.size !== PROJECT_KINDS.length) {
  throw new Error("Project capability registry is incomplete or has an unsupported schema.");
}
for (const kind of PROJECT_KINDS) {
  if (!capabilityByKind.has(kind)) throw new Error(`Project capability is missing: ${kind}`);
}
for (const capability of rendererProjects) {
  if (!(["public", "development"] as const).includes(capability.releaseVisibility)) {
    throw new Error(`Project release visibility is invalid: ${capability.kind}`);
  }
  if (capability.canvasLayout !== (capability.kind === "agent" ? "agent-workspace" : "infinite-artifact")) {
    throw new Error(`Project canvas must use the shared infinite artifact platform: ${capability.kind}`);
  }
}

export const PROJECT_CAPABILITY_REVISION = registry.capabilityRevision;
export const PROJECT_CAPABILITIES = Object.freeze(rendererProjects.map((capability) => Object.freeze({
  ...capability,
  allowedArtifactKinds: Object.freeze([...capability.allowedArtifactKinds]),
  viewerKinds: Object.freeze([...capability.viewerKinds])
})));

export function isProjectKind(value: unknown): value is ProjectKind {
  return typeof value === "string" && (PROJECT_KINDS as readonly string[]).includes(value);
}

export function projectCapabilities(kind: ProjectKind): ProjectCapabilities {
  const capability = capabilityByKind.get(kind);
  if (!capability) throw new Error(`Unsupported project kind: ${kind}`);
  return capability;
}

export function projectKindCreationEnabled(kind: ProjectKind) {
  return projectCapabilities(kind).status === "available";
}

export function projectCapabilityVisible(capability: ProjectCapabilities, surface: ProjectSurface) {
  return capability.status === "available" && (
    capability.releaseVisibility === "public" || surface === "development"
  );
}

export function projectCapabilitiesForSurface(surface: ProjectSurface) {
  return PROJECT_CAPABILITIES.filter((capability) => projectCapabilityVisible(capability, surface));
}

export function projectKindVisible(kind: ProjectKind, surface: ProjectSurface) {
  return projectCapabilityVisible(projectCapabilities(kind), surface);
}
