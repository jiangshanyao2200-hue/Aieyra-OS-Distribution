import type { ReactNode } from "react";
import { X } from "./studio-icons";
import { ButtonBase } from "./ui";

type CanvasPlatformSelectionIndicatorProps = {
  icon: ReactNode;
  title: string;
  detail: string;
  fullText?: string;
  kind?: string;
  count?: number;
  ids?: readonly string[];
  displayOnly?: boolean;
  onFocus: () => void;
  onClear?: () => void;
};

/** Lazy selection HUD shared by Image and typed artifact canvases. */
export default function CanvasPlatformSelectionIndicator({
  icon,
  title,
  detail,
  fullText = `${title} · ${detail}`,
  kind = "artifact",
  count = 1,
  ids = [],
  displayOnly = false,
  onFocus,
  onClear
}: CanvasPlatformSelectionIndicatorProps) {
  return (
    <div
      className={`canvas-selection-indicator is-${kind}`}
      data-canvas-platform-selection="true"
      data-selection-kind={kind}
      data-selection-count={count}
      data-selection-ids={ids.join(" ")}
      aria-label={`当前选中：${fullText}`}
      title={fullText}
    >
      {displayOnly ? <span className="canvas-selection-indicator-icon" aria-hidden="true">{icon}</span> : <ButtonBase
        type="button"
        className="canvas-selection-indicator-icon canvas-selection-indicator-focus"
        data-workflow-fit="selection"
        onClick={onFocus}
        aria-label="聚焦当前选中成果"
        title="聚焦当前选中成果"
      >
        {icon}
      </ButtonBase>}
      <div className="canvas-selection-indicator-copy">
        <span>当前选中</span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </div>
      {onClear ? (
        <ButtonBase type="button" className="canvas-selection-indicator-clear" onClick={onClear} aria-label="取消当前选中" title="取消当前选中">
          <X size={14} />
        </ButtonBase>
      ) : <span className="canvas-selection-indicator-spacer" aria-hidden="true" />}
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        当前选中：{fullText}
      </span>
    </div>
  );
}
