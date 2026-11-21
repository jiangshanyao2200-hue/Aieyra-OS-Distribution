import {
  type CanvasPlatformArtifactWorkflowLayout,
  type CanvasPlatformArtifactWorkflowNode,
  type CanvasPlatformViewport
} from "./canvas-platform-viewport";

export type ArtifactWorkflowViewport = CanvasPlatformViewport;
export type ArtifactWorkflowLayout = CanvasPlatformArtifactWorkflowLayout;
export type ArtifactWorkflowNode = CanvasPlatformArtifactWorkflowNode;

export type ArtifactWorkflowCommitReason = "selection" | "pan" | "zoom" | "node-drag" | "node-resize" | "fit-all" | "fit-selection" | "reset-zoom" | "resize-rebase";

export type ArtifactWorkflowCommit = {
  reason: ArtifactWorkflowCommitReason;
  layout: ArtifactWorkflowLayout[];
  viewport: ArtifactWorkflowViewport;
};
