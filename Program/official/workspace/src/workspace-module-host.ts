import * as react from "react";
import * as jsx from "react/jsx-runtime";
import * as reactDom from "react-dom";
import * as ui from "./ui";
import * as mentions from "./image-mention-context";
import * as canvasPlatform from "./canvas-platform";
import * as viewport from "./canvas-platform-viewport";
import * as references from "../shared/workspace-references.mjs";
let artifactCanvas: typeof import("./artifact-workflow-canvas") | undefined;
let canvasLoading: Promise<void> | undefined;
// The base owns the generic interaction shell, loaded only when needed. Image
// containers keep their domain adapter and use the same viewport/platform APIs.
export function prepareModuleCanvas() {
  return canvasLoading ||= import("./artifact-workflow-canvas").then(module => {
    // Native ESM namespaces cannot be frozen (their export descriptors are
    // non-configurable). Freeze the public projection, not the namespace.
    artifactCanvas = Object.freeze({ ArtifactWorkflowCanvas: module.ArtifactWorkflowCanvas });
  }).catch(error => { canvasLoading = undefined; throw error; });
}
// Optional first-party modules share the base UI contract, including modal stack
// and React identity. They cannot replace the base's project/file/licence IPC.
if (!("__aieyraModuleHost" in window)) Object.defineProperty(window, "__aieyraModuleHost", {
  value: Object.freeze({ apiVersion: 2, react, jsx, reactDom, ui, mentions, canvasPlatform, viewport, references,
    get artifactCanvas() {
      if (!artifactCanvas) throw new Error("画布基座尚未就绪。");
      return artifactCanvas;
    }
  }), configurable: false, writable: false
});
