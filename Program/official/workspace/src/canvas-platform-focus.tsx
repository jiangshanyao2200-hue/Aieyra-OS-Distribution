import type { ReactNode } from "react";
import { X } from "./studio-icons";
import { ButtonBase, DialogShell } from "./ui";

export type CanvasPlatformFocusCloseReason = "backdrop" | "escape" | "close-button";

type CanvasPlatformFocusSurfaceProps = {
  label: string;
  children?: ReactNode;
  eyebrow?: string;
  bodyRef?: (element: HTMLDivElement | null) => void;
  onRequestClose?: (reason: CanvasPlatformFocusCloseReason) => void;
};

/**
 * Canvas-owned modal surface shared by every artifact canvas. Keeping this
 * focus contract in the lazy artifact chunk prevents domain-only dialog logic
 * from increasing the Image-first startup bundle.
 */
export default function CanvasPlatformFocusSurface({
  label,
  children,
  eyebrow = "",
  bodyRef,
  onRequestClose
}: CanvasPlatformFocusSurfaceProps) {
  return (
    <DialogShell
      surface="canvas-artifact-focus"
      ariaLabel={label}
      className="canvas-platform-focus-dialog artifact-workflow-focus-dialog"
      layerClassName="canvas-platform-focus-layer artifact-workflow-focus-layer"
      backdropClassName="canvas-platform-focus-backdrop artifact-workflow-focus-backdrop"
      portal={false}
      embedded
      layerDataAttributes={{
        "data-canvas-platform-focus": "true",
        "data-workflow-focus-layer": "true",
        "data-workflow-focus-mode": "popup"
      }}
      backdropDataAttributes={{ "data-workflow-focus-backdrop": "true" }}
      dialogDataAttributes={{ "data-workflow-focus-dialog": "true" }}
      closePolicy={onRequestClose ? undefined : {
        backdrop: "never",
        escape: "never",
        "close-button": "never"
      }}
      onRequestClose={(reason) => {
        if (reason === "backdrop" || reason === "escape" || reason === "close-button") onRequestClose?.(reason);
      }}
    >
      {({ requestClose }) => (
        <>
          <header className="canvas-platform-focus-header artifact-workflow-focus-dialog-header ui-surface-header">
            <div className="ui-surface-heading">
              {eyebrow ? <span className="ui-surface-eyebrow">{eyebrow}</span> : null}
              <h2>{label}</h2>
            </div>
            {onRequestClose ? (
              <ButtonBase
                type="button"
                className="canvas-platform-focus-close artifact-workflow-focus-close ui-surface-close"
                data-workflow-focus-close="true"
                aria-label="关闭成果弹窗"
                title="关闭弹窗"
                onClick={() => requestClose("close-button")}
              >
                <X size={15} />
              </ButtonBase>
            ) : null}
          </header>
          <div
            ref={bodyRef}
            className="canvas-platform-focus-body artifact-workflow-focus-dialog-body ui-surface-body"
            data-workflow-focus-dialog-body="true"
          >
            {children}
          </div>
        </>
      )}
    </DialogShell>
  );
}
