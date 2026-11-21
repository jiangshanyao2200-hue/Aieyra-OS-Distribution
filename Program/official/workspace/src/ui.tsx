import React, { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Loader2, Minus, X } from "./studio-icons";
import type { OverflowTooltipState } from "./core";
import { DialogMinimizeContext, registerMinimizedWindow, unregisterMinimizedWindow, useDialogMinimize } from "./window-manager";
export class ErrorBoundary extends React.Component<{
    children: React.ReactNode;
}, {
    error: Error | null;
}> {
    state: {
        error: Error | null;
    } = { error: null };
    static getDerivedStateFromError(error: Error) {
        return { error };
    }
    componentDidCatch(error: Error) {
        console.error("Aieyra Workspace main UI error", error);
        window.dispatchEvent(new CustomEvent("workspace-error", { detail: { stage: "render", error } }));
    }
    render() {
        if (this.state.error) {
            return (<div className="fatal-screen">
          <div>
            <span className="eyebrow">Main Error</span>
            <h1>Aieyra Workspace 界面启动失败</h1>
            <p>{this.state.error.message}</p>
            <ActionButton onClick={() => window.location.reload()}>
              重新加载
            </ActionButton>
          </div>
        </div>);
        }
        return this.props.children;
    }
}
export type DialogCloseReason = "escape" | "backdrop" | "close-button" | "action";
export type DialogClosePolicy = "always" | "when-idle" | "when-clean" | "when-idle-and-clean" | "never";
export type DialogCloseState = {
    busy: boolean;
    dirty: boolean;
};
export type DialogLayerLevel = "dialog" | "nested";
export type DialogShellControls = {
    requestClose: (reason?: DialogCloseReason) => boolean;
};
export type DialogDataAttributes = {
    [name: `data-${string}`]: string | number | boolean | undefined;
};
export type DialogShellProps = {
    surface: string;
    ariaLabel?: string;
    ariaLabelledBy?: string;
    className?: string;
    layerClassName?: string;
    backdropClassName?: string;
    busy?: boolean;
    closeBusy?: boolean;
    dirty?: boolean;
    layerLevel?: DialogLayerLevel;
    closePolicy?: Partial<Record<DialogCloseReason, DialogClosePolicy>>;
    onRequestClose: (reason: DialogCloseReason) => void;
    onCloseBlocked?: (reason: DialogCloseReason, state: DialogCloseState) => void;
    portal?: boolean;
    embedded?: boolean;
    minimizable?: boolean;
    layerDataAttributes?: DialogDataAttributes;
    backdropDataAttributes?: DialogDataAttributes;
    dialogDataAttributes?: DialogDataAttributes;
    children: React.ReactNode | ((controls: DialogShellControls) => React.ReactNode);
};
export type DrawerShellProps = DialogShellProps;
const SurfaceDockContext = createContext<{
    target: HTMLElement | null;
    active: boolean;
} | null>(null);
export function SurfaceDock({ target, active, children }: {
    target: HTMLElement | null;
    active: boolean;
    children: React.ReactNode;
}) {
    return <SurfaceDockContext.Provider value={{ target, active }}>{children}</SurfaceDockContext.Provider>;
}
const dialogStack: Array<{
    token: symbol;
    layerLevel: DialogLayerLevel;
}> = [];
function topDialogToken() {
    for (let index = dialogStack.length - 1; index >= 0; index -= 1) {
        if (dialogStack[index]?.layerLevel === "nested")
            return dialogStack[index]?.token;
    }
    return dialogStack[dialogStack.length - 1]?.token;
}
const FOCUSABLE_SELECTOR = [
    "button:not([disabled])",
    "[href]",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])"
].join(",");
let recentSurfaceActivator: {
    element: HTMLElement;
    at: number;
} | null = null;
if (typeof document !== "undefined") {
    const recordActivator = (event: MouseEvent) => {
        const target = event.target instanceof Element
            ? event.target.closest<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")
            : null;
        if (target)
            recentSurfaceActivator = { element: target, at: Date.now() };
    };
    document.addEventListener("click", recordActivator, true);
    (import.meta as ImportMeta & {
        hot?: {
            dispose: (callback: () => void) => void;
        };
    }).hot?.dispose(() => document.removeEventListener("click", recordActivator, true));
}
function joinClassNames(...names: Array<string | false | null | undefined>) {
    return names.filter(Boolean).join(" ");
}
function closePolicyAllows(policy: DialogClosePolicy, state: DialogCloseState) {
    if (policy === "always")
        return true;
    if (policy === "when-idle")
        return !state.busy;
    if (policy === "when-clean")
        return !state.dirty;
    if (policy === "when-idle-and-clean")
        return !state.busy && !state.dirty;
    return false;
}
function focusableElements(root: HTMLElement) {
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
        const style = window.getComputedStyle(element);
        return style.visibility !== "hidden" && style.display !== "none" && element.getClientRects().length > 0;
    });
}
export function DialogShell({ surface, ariaLabel, ariaLabelledBy, className, layerClassName, backdropClassName, busy = false, closeBusy, dirty = false, layerLevel = "dialog", closePolicy, onRequestClose, onCloseBlocked, portal = true, embedded = false, minimizable = false, layerDataAttributes, backdropDataAttributes, dialogDataAttributes, children }: DialogShellProps) {
    const dock = useContext(SurfaceDockContext);
    const docked = Boolean(dock && layerLevel !== "nested");
    const dockActive = !docked || dock?.active;
    const dockTarget = docked ? dock?.target : null;
    const [minimized, setMinimized] = useState(false);
    const minimizeId = minimizable && !docked && layerLevel === "dialog" ? `dialog:${surface}` : null;
    const dialogRef = useRef<HTMLElement | null>(null);
    const stackTokenRef = useRef(Symbol(surface));
    const restoreFocusRef = useRef<HTMLElement | null>((() => {
        if (typeof document === "undefined")
            return null;
        const recentActivator = recentSurfaceActivator;
        if (recentActivator?.element.isConnected && Date.now() - recentActivator.at <= 1500) {
            return recentActivator.element;
        }
        return document.activeElement instanceof HTMLElement ? document.activeElement : null;
    })());
    const closeBusyState = closeBusy ?? busy;
    const latestRef = useRef({ busy: closeBusyState, dirty, closePolicy, onRequestClose, onCloseBlocked });
    latestRef.current = { busy: closeBusyState, dirty, closePolicy, onRequestClose, onCloseBlocked };
    const requestClose = useCallback((reason: DialogCloseReason = "action") => {
        if (reason === "escape")
            return false;
        if (reason === "backdrop" && !docked && topDialogToken() !== stackTokenRef.current)
            return false;
        const latest = latestRef.current;
        const state = { busy: latest.busy, dirty: latest.dirty };
        const fallbackPolicy: DialogClosePolicy = reason === "action" ? "always" : "when-idle";
        const policy = latest.closePolicy?.[reason] ?? fallbackPolicy;
        const allowed = closePolicyAllows(policy, state);
        if (!allowed) {
            latest.onCloseBlocked?.(reason, state);
            return false;
        }
        const restoreTarget = restoreFocusRef.current;
        if (restoreTarget?.isConnected)
            restoreTarget.focus({ preventScroll: true });
        latest.onRequestClose(reason);
        return true;
    }, [docked]);
    useEffect(() => {
        if (!minimizeId)
            return;
        if (minimized) {
            registerMinimizedWindow({
                id: minimizeId,
                title: ariaLabel || surface,
                restore: () => setMinimized(false),
                close: () => requestClose("close-button")
            });
        }
        else {
            unregisterMinimizedWindow(minimizeId);
        }
        return () => unregisterMinimizedWindow(minimizeId);
    }, [minimizeId, minimized, ariaLabel, surface, requestClose]);
    useLayoutEffect(() => {
        if (!dockActive || (docked && !dockTarget) || minimized)
            return;
        const token = stackTokenRef.current;
        if (!docked)
            dialogStack.push({ token, layerLevel });
        window.dispatchEvent(new CustomEvent('workspace-modal-change', { detail: { open: dialogStack.length > 0 } }));
        const focusDialog = () => {
            const dialog = dialogRef.current;
            if (!dialog || (!docked && topDialogToken() !== token))
                return;
            if (document.activeElement?.closest('[role="menu"], [data-escape-local]'))
                return;
            const preferred = dialog.querySelector<HTMLElement>("[data-autofocus], [data-workflow-focus-autofocus], [autofocus]");
            const target = preferred ?? focusableElements(dialog)[0] ?? dialog;
            target.focus({ preventScroll: true });
        };
        focusDialog();
        const focusFrame = window.requestAnimationFrame(focusDialog);
        function handleKeyDown(event: KeyboardEvent) {
            const dialog = dialogRef.current;
            if (!dialog)
                return;
            if (event.defaultPrevented || (event.target instanceof Element && event.target.closest('[role="menu"], [data-escape-local]')))
                return;
            if (docked ? dialogStack.length > 0 || !dialog.contains(document.activeElement) : topDialogToken() !== token)
                return;
            if (event.key === "Escape" && !event.isComposing) {
                if ((event.target as HTMLElement | null)?.closest("[data-escape-local]"))
                    return;
                event.preventDefault();
                event.stopPropagation();
                requestClose("escape");
                return;
            }
            if (docked || event.key !== "Tab")
                return;
            const focusable = focusableElements(dialog);
            if (!focusable.length) {
                event.preventDefault();
                dialog.focus({ preventScroll: true });
                return;
            }
            const active = document.activeElement;
            const currentIndex = focusable.indexOf(active as HTMLElement);
            const nextIndex = event.shiftKey
                ? currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1
                : currentIndex < 0 || currentIndex === focusable.length - 1 ? 0 : currentIndex + 1;
            if (currentIndex < 0 || (event.shiftKey && currentIndex === 0) || (!event.shiftKey && currentIndex === focusable.length - 1)) {
                event.preventDefault();
                focusable[nextIndex]?.focus({ preventScroll: true });
            }
        }
        document.addEventListener("keydown", handleKeyDown, true);
        return () => {
            window.cancelAnimationFrame(focusFrame);
            document.removeEventListener("keydown", handleKeyDown, true);
            const stackIndex = dialogStack.findIndex((entry) => entry.token === token);
            if (stackIndex >= 0)
                dialogStack.splice(stackIndex, 1);
            window.dispatchEvent(new CustomEvent('workspace-modal-change', { detail: { open: dialogStack.length > 0 } }));
            const restoreTarget = docked ? null : restoreFocusRef.current;
            const remainingTop = topDialogToken();
            window.requestAnimationFrame(() => {
                if (topDialogToken() !== remainingTop || !restoreTarget?.isConnected)
                    return;
                const active = document.activeElement;
                if (active instanceof HTMLElement && active !== document.body && active.isConnected && active.closest('[role="dialog"]'))
                    return;
                restoreTarget.focus({ preventScroll: true });
            });
        };
    }, [layerLevel, requestClose, docked, dockActive, dockTarget, minimized]);
    const content = (<div {...layerDataAttributes} className={joinClassNames(!embedded && !docked && "dialog-layer", "ui-surface-layer", docked && "ui-docked-surface", layerClassName)} hidden={minimized || (docked && !dockActive)} data-ui-surface-layer={surface} data-ui-layer-level={layerLevel} data-ui-layout={docked ? "docked" : embedded ? "embedded" : "viewport"} data-ui-busy={busy ? "true" : "false"} data-ui-dirty={dirty ? "true" : "false"}>
      {!docked ? <div {...backdropDataAttributes} className={joinClassNames("ui-surface-backdrop", backdropClassName)} aria-hidden="true" onPointerDown={(event) => {
                if (event.currentTarget !== event.target)
                    return;
                event.preventDefault();
                event.stopPropagation();
            }} onClick={(event) => {
                if (event.currentTarget !== event.target)
                    return;
                event.preventDefault();
                event.stopPropagation();
            }} onDoubleClick={(event) => {
                if (event.currentTarget !== event.target)
                    return;
                event.preventDefault();
                event.stopPropagation();
                requestClose("backdrop");
            }}/> : null}
      <section {...dialogDataAttributes} ref={dialogRef} className={joinClassNames("ui-surface", className)} role={docked ? "region" : "dialog"} aria-modal={docked ? undefined : true} aria-label={ariaLabel} aria-labelledby={ariaLabelledBy} aria-busy={busy || undefined} data-ui-surface={surface} data-ui-docked={docked ? "true" : undefined} data-ui-busy={busy ? "true" : "false"} data-ui-dirty={dirty ? "true" : "false"} tabIndex={-1} onPointerDown={embedded ? (event) => event.stopPropagation() : undefined}>
        <DialogMinimizeContext.Provider value={minimizeId ? { minimize: () => setMinimized(true) } : null}>
          {typeof children === "function" ? children({ requestClose }) : children}
        </DialogMinimizeContext.Provider>
      </section>
    </div>);
    if (docked)
        return dockTarget ? createPortal(content, dockTarget) : null;
    return portal ? createPortal(content, document.body) : content;
}
export function DrawerShell({ className, layerClassName, backdropClassName, ...props }: DrawerShellProps) {
    return (<DialogShell {...props} className={joinClassNames("ui-drawer", className)} layerClassName={joinClassNames("ui-drawer-layer", layerClassName)} backdropClassName={joinClassNames("ui-drawer-backdrop", backdropClassName)}/>);
}
export function SurfaceHeader({ title, titleId, eyebrow, description, onMinimize, minimizeLabel = "最小化", minimizeDisabled = false, onClose, closeLabel = "关闭", closeDisabled = false, closeClassName, closeIcon, className, children }: {
    title: React.ReactNode;
    titleId?: string;
    eyebrow?: React.ReactNode;
    description?: React.ReactNode;
    onMinimize?: () => void;
    minimizeLabel?: string;
    minimizeDisabled?: boolean;
    onClose?: () => void;
    closeLabel?: string;
    closeDisabled?: boolean;
    closeClassName?: string;
    closeIcon?: React.ReactNode;
    className?: string;
    children?: React.ReactNode;
}) {
    const generatedId = useId();
    const dialogMinimize = useDialogMinimize();
    const minimizeHandler = onMinimize ?? dialogMinimize?.minimize;
    return (<header className={joinClassNames("ui-surface-header", className)}>
      <div className="ui-surface-heading">
        {eyebrow ? <span className="ui-surface-eyebrow">{eyebrow}</span> : null}
        <h2 id={titleId ?? generatedId}>{title}</h2>
        {description ? <p className="ui-surface-description">{description}</p> : null}
      </div>
      {children || minimizeHandler ? (<div className="ui-surface-header-actions">
          {children}
          {minimizeHandler ? (<ButtonBase className="ui-surface-close ui-surface-minimize" type="button" onClick={minimizeHandler} aria-label={minimizeLabel} title={minimizeLabel} disabled={minimizeDisabled}>
              <Minus size={18}/>
            </ButtonBase>) : null}
        </div>) : null}
      {onClose ? (<ButtonBase className={joinClassNames("ui-surface-close", closeClassName)} type="button" onClick={onClose} aria-label={closeLabel} title={closeLabel} disabled={closeDisabled}>
          {closeIcon ?? <X size={18}/>}
        </ButtonBase>) : null}
    </header>);
}
export function SurfaceBody({ className, children }: {
    className?: string;
    children: React.ReactNode;
}) {
    return <div className={joinClassNames("ui-surface-body", className)}>{children}</div>;
}
export function SurfaceFooter({ className, leading, children }: {
    className?: string;
    leading?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (<footer className={joinClassNames("ui-surface-footer", className)}>
      {leading ? <div className="ui-surface-footer-leading">{leading}</div> : <span className="ui-surface-footer-spacer"/>}
      <div className="ui-surface-footer-actions">{children}</div>
    </footer>);
}
export function SurfaceSection({ className, ...sectionProps }: React.HTMLAttributes<HTMLElement>) {
    return (<section {...sectionProps} className={joinClassNames("ui-surface-section", className)} data-ui-section="true"/>);
}
export function Field({ label, hint, error, className, children, ...labelProps }: Omit<React.LabelHTMLAttributes<HTMLLabelElement>, "children"> & {
    label: React.ReactNode;
    hint?: React.ReactNode;
    error?: React.ReactNode;
    children: React.ReactNode;
}) {
    const supportingText = error ?? hint;
    return (<label {...labelProps} className={joinClassNames("ui-field", className)} data-ui-field="true" data-ui-invalid={error ? "true" : "false"}>
      <span className="ui-field-label">{label}</span>
      {children}
      {supportingText ? (<small className={joinClassNames("ui-field-message", error ? "is-error" : undefined)}>{supportingText}</small>) : null}
    </label>);
}
export function CheckboxControl({ label, indicator, className, inputProps, ...labelProps }: Omit<React.LabelHTMLAttributes<HTMLLabelElement>, "children"> & {
    label: string;
    indicator?: React.ReactNode;
    inputProps: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">;
}) {
    return (<label {...labelProps} className={joinClassNames("ui-checkbox-control", className)} data-ui-checkbox-control="true">
      <input {...inputProps} type="checkbox" aria-label={inputProps["aria-label"] ?? label}/>
      <span aria-hidden="true">{inputProps.checked ? indicator : null}</span>
    </label>);
}
export function CodeField({ label, hint, error, fieldClassName, labelHidden = false, fill = false, className, ...textareaProps }: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "children"> & {
    label: React.ReactNode;
    hint?: React.ReactNode;
    error?: React.ReactNode;
    fieldClassName?: string;
    labelHidden?: boolean;
    fill?: boolean;
}) {
    return (<Field className={joinClassNames("ui-code-field", labelHidden && "is-label-hidden", fill && "is-fill", fieldClassName)} label={label} hint={hint} error={error}>
      <textarea {...textareaProps} className={joinClassNames("ui-control", "ui-code-field-control", className)} data-ui-control="code"/>
    </Field>);
}
export type UiFeedbackTone = "neutral" | "info" | "success" | "warning" | "danger";
export function InlineNotice({ tone = "info", icon, className, children, role, ...noticeProps }: React.HTMLAttributes<HTMLDivElement> & {
    tone?: UiFeedbackTone;
    icon?: React.ReactNode;
}) {
    return (<div {...noticeProps} className={joinClassNames("ui-inline-notice", `ui-tone-${tone}`, className)} data-ui-notice="true" data-ui-tone={tone} role={role ?? (tone === "danger" ? "alert" : "note")}>
      {icon ? <span className="ui-inline-notice-icon" aria-hidden="true">{icon}</span> : null}
      <div className="ui-inline-notice-copy">{children}</div>
    </div>);
}
export function StatusLine({ tone = "neutral", busy = false, icon, live = "off", className, children, role, ...statusProps }: React.HTMLAttributes<HTMLDivElement> & {
    tone?: UiFeedbackTone;
    busy?: boolean;
    icon?: React.ReactNode;
    live?: "off" | "polite" | "assertive";
}) {
    return (<div {...statusProps} className={joinClassNames("ui-status-line", `ui-tone-${tone}`, busy && "is-busy", className)} data-ui-status="true" data-ui-tone={tone} data-ui-busy={busy ? "true" : "false"} role={role ?? (live === "off" ? undefined : "status")} aria-live={live === "off" ? undefined : live} aria-atomic={live === "off" ? undefined : true}>
      {busy ? <Loader2 size={14} className="spin" aria-hidden="true"/> : icon}
      <span>{children}</span>
    </div>);
}
export function ButtonBase({ type = "button", className, ...buttonProps }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
    return <button {...buttonProps} type={type} className={joinClassNames("ui-button-base", className)}/>;
}
export function MenuItem({ tone = "default", busy = false, icon, shortcut, className, children, disabled, ...buttonProps }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    tone?: "default" | "danger";
    busy?: boolean;
    icon?: React.ReactNode;
    shortcut?: React.ReactNode;
}) {
    return (<ButtonBase {...buttonProps} className={joinClassNames("ui-menu-item", tone === "danger" && "ui-menu-item-danger", className)} disabled={disabled || busy} role={buttonProps.role ?? "menuitem"} tabIndex={buttonProps.tabIndex ?? -1} aria-busy={busy || undefined} data-ui-menu-item="true" data-ui-tone={tone}>
      <span className="ui-menu-item-icon" aria-hidden="true">
        {busy ? <Loader2 size={15} className="spin"/> : icon}
      </span>
      <span className="ui-menu-item-label">{children}</span>
      {shortcut ? <kbd className="ui-menu-item-shortcut">{shortcut}</kbd> : <span className="ui-menu-item-trailing"/>}
    </ButtonBase>);
}
export function MenuSeparator({ className }: {
    className?: string;
}) {
    return <div className={joinClassNames("ui-menu-separator", className)} role="separator"/>;
}
export function MenuSummary({ title, className, children }: {
    title: React.ReactNode;
    className?: string;
    children?: React.ReactNode;
}) {
    return (<div className={joinClassNames("ui-menu-summary", className)} data-ui-menu-summary="true">
      <strong>{title}</strong>
      {children ? <span>{children}</span> : null}
    </div>);
}
export function MenuGroup({ label, description, icon, defaultOpen = false, className, children, }: {
    label: React.ReactNode;
    description?: React.ReactNode;
    icon?: React.ReactNode;
    defaultOpen?: boolean;
    className?: string;
    children: React.ReactNode;
}) {
    const [open, setOpen] = useState(defaultOpen);
    return (<div className={joinClassNames("ui-menu-group", open && "open", className)} data-ui-menu-group="true">
      <ButtonBase className="ui-menu-group-trigger" role="menuitem" tabIndex={-1} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((current) => !current)} onKeyDown={(event) => {
            if (event.key === "ArrowRight" && !open) {
                event.preventDefault();
                setOpen(true);
            }
            else if (event.key === "ArrowLeft" && open) {
                event.preventDefault();
                setOpen(false);
            }
        }}>
        <span className="ui-menu-item-icon" aria-hidden="true">{icon}</span>
        <span className="ui-menu-group-label">
          <strong>{label}</strong>
          {description ? <small>{description}</small> : null}
        </span>
        <ChevronDown className="ui-menu-group-chevron" size={14} aria-hidden="true"/>
      </ButtonBase>
      {open ? <div className="ui-menu-group-items" role="group">{children}</div> : null}
    </div>);
}
export function ActionButton({ variant = "secondary", busy = false, icon, className, children, disabled, ...buttonProps }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "secondary" | "danger" | "ghost";
    busy?: boolean;
    icon?: React.ReactNode;
}) {
    return (<ButtonBase {...buttonProps} type={buttonProps.type ?? "button"} className={joinClassNames("ui-action-button", `ui-action-${variant}`, className)} disabled={disabled || busy} aria-busy={busy || undefined} data-ui-control="action" data-ui-variant={variant}>
      {busy ? <Loader2 size={15} className="spin" aria-hidden="true"/> : icon}
      <span>{children}</span>
    </ButtonBase>);
}
export function IconActionButton({ label, icon, className, title, ...buttonProps }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    label: string;
    icon: React.ReactNode;
}) {
    return (<ButtonBase {...buttonProps} type={buttonProps.type ?? "button"} className={joinClassNames("ui-icon-action", className)} aria-label={buttonProps["aria-label"] ?? label} title={title ?? label} data-ui-control="icon">
      {icon}
    </ButtonBase>);
}
export function SegmentedControl({ className, role = "group", ...groupProps }: React.HTMLAttributes<HTMLDivElement>) {
    return (<div {...groupProps} role={role} className={joinClassNames("ui-segmented-control", className)} data-ui-control-group="segmented"/>);
}
export function SegmentButton({ active = false, className, ...buttonProps }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    active?: boolean;
}) {
    return (<ButtonBase {...buttonProps} className={joinClassNames("ui-segment-action", active && "active", className)} aria-pressed={buttonProps["aria-pressed"] ?? active} data-ui-control="segment" data-ui-active={active ? "true" : "false"}/>);
}
export function SearchField({ label, icon, className, inputProps }: {
    label: string;
    icon?: React.ReactNode;
    className?: string;
    inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
}) {
    const generatedId = useId();
    const inputId = inputProps?.id || generatedId;
    return (<label className={joinClassNames("ui-search-field", className)} htmlFor={inputId} data-ui-search-field="true">
      <span className="sr-only">{label}</span>
      {icon ? <span className="ui-search-field-icon" aria-hidden="true">{icon}</span> : null}
      <input {...inputProps} id={inputId} aria-label={inputProps?.["aria-label"] ?? label} type={inputProps?.type ?? "search"}/>
    </label>);
}
export type MenuSurfaceProps = React.HTMLAttributes<HTMLDivElement> & {
    x: number;
    y: number;
    ariaLabel: string;
    onRequestClose: () => void;
    viewportGap?: number;
    anchor?: HTMLElement | null;
};
export function MenuSurface({ x, y, ariaLabel, onRequestClose, anchor, viewportGap = 12, className, children, style, onKeyDown, ...surfaceProps }: MenuSurfaceProps) {
    const menuRef = useRef<HTMLDivElement | null>(null);
    const restoreFocusRef = useRef<HTMLElement | null>(null);
    const [placement, setPlacement] = useState(() => ({ left: x, top: y, maxHeight: 320 }));
    const placeFromMeasurement = useCallback(() => {
        const menu = menuRef.current;
        if (!menu)
            return;
        const width = Math.max(1, menu.offsetWidth);
        const height = Math.max(1, menu.scrollHeight);
        const availableWidth = Math.max(1, window.innerWidth - viewportGap * 2);
        const availableHeight = Math.max(1, window.innerHeight - viewportGap * 2);
        const left = Math.round(Math.min(Math.max(viewportGap, x), viewportGap + Math.max(0, availableWidth - width)));
        const top = Math.round(Math.min(Math.max(viewportGap, y), viewportGap + Math.max(0, availableHeight - Math.min(height, availableHeight))));
        const maxHeight = Math.max(120, Math.floor(window.innerHeight - top - viewportGap));
        setPlacement((current) => current.left === left && current.top === top && current.maxHeight === maxHeight
            ? current
            : { left, top, maxHeight });
    }, [viewportGap, x, y]);
    useLayoutEffect(() => {
        placeFromMeasurement();
    }, [children, placeFromMeasurement]);
    useEffect(() => {
        const menu = menuRef.current;
        if (!menu)
            return;
        restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const buttons = [...menu.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')];
        buttons[0]?.focus({ preventScroll: true });
        const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(placeFromMeasurement);
        observer?.observe(menu);
        window.addEventListener("resize", placeFromMeasurement);
        return () => {
            observer?.disconnect();
            window.removeEventListener("resize", placeFromMeasurement);
            const restoreTarget = restoreFocusRef.current;
            if (restoreTarget?.isConnected)
                restoreTarget.focus({ preventScroll: true });
        };
    }, [placeFromMeasurement]);
    useEffect(() => {
        function handleOutsidePointer(event: PointerEvent) {
            if (menuRef.current?.contains(event.target as Node) || anchor?.contains(event.target as Node))
                return;
            onRequestClose();
        }
        function handleDismissal(event: Event) {
            if (event.type === "scroll" && event.target instanceof Node && menuRef.current?.contains(event.target))
                return;
            if (event.type === "scroll" && anchor && event.target instanceof Element && !event.target.contains(anchor))
                return;
            onRequestClose();
        }
        document.addEventListener("pointerdown", handleOutsidePointer, true);
        document.addEventListener("scroll", handleDismissal, true);
        window.addEventListener("blur", handleDismissal);
        return () => {
            document.removeEventListener("pointerdown", handleOutsidePointer, true);
            document.removeEventListener("scroll", handleDismissal, true);
            window.removeEventListener("blur", handleDismissal);
        };
    }, [onRequestClose, anchor]);
    function focusMenuItem(targetIndex: number) {
        const menu = menuRef.current;
        const items = [...(menu?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)') ?? [])];
        if (!items.length)
            return;
        const index = (targetIndex + items.length) % items.length;
        const target = items[index];
        if (!menu || !target)
            return;
        target.focus({ preventScroll: true });
        const menuRect = menu.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const visibleTop = menuRect.top + menu.clientTop;
        const visibleBottom = visibleTop + menu.clientHeight;
        if (targetRect.top < visibleTop) {
            menu.scrollTop -= visibleTop - targetRect.top;
        }
        else if (targetRect.bottom > visibleBottom) {
            menu.scrollTop += targetRect.bottom - visibleBottom;
        }
    }
    function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
        onKeyDown?.(event);
        if (event.defaultPrevented)
            return;
        if (event.key === "Escape" || event.key === "Tab") {
            event.preventDefault();
            event.stopPropagation();
            onRequestClose();
            return;
        }
        const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)') ?? [])];
        const currentIndex = items.findIndex((item) => item === document.activeElement);
        if (event.key === "ArrowDown") {
            event.preventDefault();
            focusMenuItem(currentIndex + 1);
        }
        else if (event.key === "ArrowUp") {
            event.preventDefault();
            focusMenuItem(currentIndex <= 0 ? items.length - 1 : currentIndex - 1);
        }
        else if (event.key === "Home") {
            event.preventDefault();
            focusMenuItem(0);
        }
        else if (event.key === "End") {
            event.preventDefault();
            focusMenuItem(items.length - 1);
        }
    }
    if (typeof document === "undefined")
        return null;
    return createPortal(<div {...surfaceProps} ref={menuRef} className={joinClassNames("ui-menu-surface", className)} role="menu" aria-label={ariaLabel} data-ui-menu-surface="true" data-escape-local style={{ ...style, left: placement.left, top: placement.top, maxHeight: placement.maxHeight }} onKeyDown={handleKeyDown} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}>
      {children}
    </div>, document.body);
}
function elementHasHiddenText(element: HTMLElement) {
    const style = window.getComputedStyle(element);
    const clamp = style.getPropertyValue("-webkit-line-clamp");
    return (element.scrollWidth > element.clientWidth + 1 ||
        element.scrollHeight > element.clientHeight + 1 ||
        (clamp && clamp !== "none" && element.scrollHeight > element.clientHeight + 1));
}
function normalizeTooltipText(text: string) {
    return text.replace(/\s+/g, " ").trim();
}
function findOverflowTooltipTarget(source: EventTarget | null) {
    if (!(source instanceof Element))
        return null;
    const explicit = source.closest<HTMLElement>("[data-overflow-tooltip]");
    return explicit && elementHasHiddenText(explicit) ? explicit : null;
}
function getOverflowTooltipText(element: HTMLElement) {
    return normalizeTooltipText(element.dataset.overflowTooltip || element.textContent || "");
}
export function OverflowTooltipLayer() {
    const [tooltip, setTooltip] = useState<OverflowTooltipState | null>(null);
    const targetRef = useRef<HTMLElement | null>(null);
    const timerRef = useRef<number | null>(null);
    useEffect(() => {
        function clearPending() {
            if (timerRef.current !== null) {
                window.clearTimeout(timerRef.current);
                timerRef.current = null;
            }
        }
        function hide() {
            clearPending();
            targetRef.current = null;
            setTooltip(null);
        }
        function handlePointerOver(event: PointerEvent) {
            const target = findOverflowTooltipTarget(event.target);
            if (!target || target === targetRef.current)
                return;
            clearPending();
            setTooltip(null);
            targetRef.current = target;
            timerRef.current = window.setTimeout(() => {
                const current = targetRef.current;
                if (!current || current !== target || !document.contains(current) || !current.matches(":hover"))
                    return;
                const text = getOverflowTooltipText(current);
                if (!text || !elementHasHiddenText(current))
                    return;
                const rect = current.getBoundingClientRect();
                const placement: OverflowTooltipState["placement"] = rect.bottom + 148 < window.innerHeight ? "bottom" : "top";
                const rawX = rect.left + rect.width / 2;
                const x = Math.max(188, Math.min(window.innerWidth - 188, rawX));
                const y = placement === "bottom" ? Math.min(window.innerHeight - 18, rect.bottom + 10) : Math.max(18, rect.top - 10);
                setTooltip({ text, x, y, placement });
            }, 3000);
        }
        function handlePointerOut(event: PointerEvent) {
            const current = targetRef.current;
            if (!current)
                return;
            const next = event.relatedTarget as Node | null;
            if (next && current.contains(next))
                return;
            hide();
        }
        document.addEventListener("pointerover", handlePointerOver, true);
        document.addEventListener("pointerout", handlePointerOut, true);
        window.addEventListener("scroll", hide, true);
        window.addEventListener("resize", hide);
        window.addEventListener("keydown", hide);
        return () => {
            clearPending();
            document.removeEventListener("pointerover", handlePointerOver, true);
            document.removeEventListener("pointerout", handlePointerOut, true);
            window.removeEventListener("scroll", hide, true);
            window.removeEventListener("resize", hide);
            window.removeEventListener("keydown", hide);
        };
    }, []);
    if (!tooltip)
        return null;
    return (<div className={`overflow-tooltip ${tooltip.placement}`} style={{ left: tooltip.x, top: tooltip.y }} role="tooltip">
      {tooltip.text}
    </div>);
}
function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}
const FLOATING_DIALOG_SELECTOR = ".ui-surface[data-ui-surface]:not([data-ui-docked='true']), .image-viewer, .reference-picker-dialog:not([data-ui-surface]), .ask-user-dialog:not([data-ui-surface]), .node-editor-dialog, .region-redraw-dialog, .layer-group-viewer";
const FLOATING_DIALOG_HANDLE_SELECTOR = ".ui-surface[data-ui-surface]:not([data-ui-docked='true']) > .ui-surface-header, .image-viewer > header, .reference-picker-dialog > header, .ask-user-dialog > header, .node-editor-dialog > header, .region-redraw-dialog > header, .layer-group-viewer > header";
const FLOATING_DIALOG_INTERACTIVE_SELECTOR = "button, input, textarea, select, a, [role='button']";
const FLOATING_DIALOG_MIN_SIZES = [
    { selector: ".node-editor-dialog", width: 920 },
    { selector: ".region-redraw-dialog", width: 760 },
    { selector: ".layer-group-viewer", width: 680 },
    { selector: ".reference-picker-dialog", width: 620 },
    { selector: ".ask-user-dialog", width: 480 },
    { selector: ".image-viewer", width: 640 }
];
function floatingDialogMinimumSize(dialog: HTMLElement) {
    const rule = FLOATING_DIALOG_MIN_SIZES.find((item) => dialog.matches(item.selector)) ?? { width: 320 };
    const maxWidth = Math.max(1, window.innerWidth - 16);
    const maxHeight = Math.max(1, window.innerHeight - 16);
    return {
        width: Math.min(rule.width, maxWidth),
        maxWidth,
        maxHeight
    };
}
function enforceFloatingDialogMinimumSize(dialog: HTMLElement) {
    if (dialog.dataset.uiDocked === "true")
        return false;
    if (dialog.matches(".ui-drawer") && dialog.dataset.uiFloatingPositioned !== "true")
        return false;
    const minimum = floatingDialogMinimumSize(dialog);
    const resizable = window.getComputedStyle(dialog).resize !== "none";
    if (!resizable && dialog.dataset.uiClampH === "1") {
        dialog.style.removeProperty("height");
        delete dialog.dataset.uiClampH;
    }
    const rect = dialog.getBoundingClientRect();
    const nextWidth = clamp(rect.width, minimum.width, minimum.maxWidth);
    const nextHeight = Math.min(rect.height, minimum.maxHeight);
    let changed = false;
    if (Math.abs(rect.width - nextWidth) > 0.5) {
        dialog.style.width = `${Math.round(nextWidth)}px`;
        changed = true;
    }
    if (rect.height > minimum.maxHeight + 0.5) {
        dialog.style.height = `${Math.round(nextHeight)}px`;
        if (!resizable)
            dialog.dataset.uiClampH = "1";
        changed = true;
    }
    if (dialog.style.position === "fixed") {
        const nextLeft = clamp(rect.left, 8, Math.max(8, window.innerWidth - nextWidth - 8));
        const nextTop = clamp(rect.top, 8, Math.max(8, window.innerHeight - nextHeight - 8));
        if (Math.abs(nextLeft - rect.left) > 0.5) {
            dialog.style.left = `${Math.round(nextLeft)}px`;
            changed = true;
        }
        if (Math.abs(nextTop - rect.top) > 0.5) {
            dialog.style.top = `${Math.round(nextTop)}px`;
            changed = true;
        }
    }
    return changed;
}
export function useFloatingDialogInteractions() {
    useEffect(() => {
        let activeCleanup: (() => void) | null = null;
        let resizeFrame = 0;
        const observedDialogs = new Set<HTMLElement>();
        const pendingResizeDialogs = new Set<HTMLElement>();
        const resizeObserver = typeof ResizeObserver === "undefined"
            ? null
            : new ResizeObserver((entries) => {
                for (const entry of entries) {
                    if (entry.target instanceof HTMLElement)
                        pendingResizeDialogs.add(entry.target);
                }
                if (resizeFrame)
                    return;
                resizeFrame = window.requestAnimationFrame(() => {
                    resizeFrame = 0;
                    const dialogs = [...pendingResizeDialogs];
                    pendingResizeDialogs.clear();
                    dialogs.forEach((dialog) => {
                        if (dialog.isConnected)
                            enforceFloatingDialogMinimumSize(dialog);
                    });
                });
            });
        function observeFloatingDialog(dialog: HTMLElement) {
            if (observedDialogs.has(dialog))
                return;
            observedDialogs.add(dialog);
            resizeObserver?.observe(dialog);
        }
        function unobserveFloatingDialog(dialog: HTMLElement) {
            if (!observedDialogs.delete(dialog))
                return;
            pendingResizeDialogs.delete(dialog);
            resizeObserver?.unobserve(dialog);
        }
        function unobserveRemovedDialogs(node: Node) {
            if (!(node instanceof Element))
                return;
            if (node instanceof HTMLElement && node.matches(FLOATING_DIALOG_SELECTOR))
                unobserveFloatingDialog(node);
            node.querySelectorAll<HTMLElement>(FLOATING_DIALOG_SELECTOR).forEach(unobserveFloatingDialog);
        }
        function observeAddedDialogs(node: Node) {
            if (!(node instanceof Element))
                return;
            const dialogs = [
                ...(node instanceof HTMLElement && node.matches(FLOATING_DIALOG_SELECTOR) ? [node] : []),
                ...node.querySelectorAll<HTMLElement>(FLOATING_DIALOG_SELECTOR)
            ];
            dialogs.forEach((dialog) => {
                enforceFloatingDialogMinimumSize(dialog);
                observeFloatingDialog(dialog);
            });
        }
        function enforceAllFloatingDialogs() {
            document.querySelectorAll<HTMLElement>(FLOATING_DIALOG_SELECTOR).forEach((dialog) => {
                enforceFloatingDialogMinimumSize(dialog);
                observeFloatingDialog(dialog);
            });
        }
        function beginFloatingDrag(event: PointerEvent) {
            const rawTarget = event.target instanceof Element ? event.target : null;
            if (event.button !== 0) {
                return;
            }
            const target = rawTarget instanceof HTMLElement ? rawTarget : rawTarget?.parentElement ?? null;
            if (!target) {
                return;
            }
            if (target.closest(FLOATING_DIALOG_INTERACTIVE_SELECTOR)) {
                return;
            }
            const handle = target.closest(FLOATING_DIALOG_HANDLE_SELECTOR) as HTMLElement | null;
            if (!handle) {
                return;
            }
            const dialog = handle.closest(FLOATING_DIALOG_SELECTOR) as HTMLElement | null;
            if (!dialog) {
                return;
            }
            const activeDialog = dialog;
            activeCleanup?.();
            const rect = activeDialog.getBoundingClientRect();
            const offsetX = event.clientX - rect.left;
            const offsetY = event.clientY - rect.top;
            const clampLeft = (left: number) => clamp(left, 8, Math.max(8, window.innerWidth - rect.width - 8));
            const clampTop = (top: number) => clamp(top, 8, Math.max(8, window.innerHeight - rect.height - 8));
            event.preventDefault();
            activeDialog.classList.add("floating-dialog-moving");
            document.body.classList.add("floating-dialog-dragging");
            activeDialog.style.position = "fixed";
            activeDialog.dataset.uiFloatingPositioned = "true";
            activeDialog.style.left = `${Math.round(clampLeft(rect.left))}px`;
            activeDialog.style.top = `${Math.round(clampTop(rect.top))}px`;
            activeDialog.style.width = `${Math.round(rect.width)}px`;
            if (window.getComputedStyle(activeDialog).resize !== "none") {
                activeDialog.style.height = `${Math.round(rect.height)}px`;
            }
            activeDialog.style.margin = "0";
            activeDialog.style.transform = "none";
            activeDialog.style.removeProperty("z-index");
            enforceFloatingDialogMinimumSize(activeDialog);
            function move(moveEvent: Event) {
                const dragEvent = moveEvent as PointerEvent;
                moveEvent.preventDefault();
                activeDialog.style.left = `${Math.round(clampLeft(dragEvent.clientX - offsetX))}px`;
                activeDialog.style.top = `${Math.round(clampTop(dragEvent.clientY - offsetY))}px`;
            }
            function end() {
                activeDialog.classList.remove("floating-dialog-moving");
                document.body.classList.remove("floating-dialog-dragging");
                window.removeEventListener(moveEventName, move);
                window.removeEventListener(endEventName, end);
                window.removeEventListener(cancelEventName, end);
                window.removeEventListener("blur", end);
                activeCleanup = null;
            }
            const moveEventName = "pointermove";
            const endEventName = "pointerup";
            const cancelEventName = "pointercancel";
            activeCleanup = end;
            window.addEventListener(moveEventName, move, { passive: false });
            window.addEventListener(endEventName, end);
            window.addEventListener(cancelEventName, end);
            window.addEventListener("blur", end);
        }
        function beginPointerDrag(event: PointerEvent) {
            beginFloatingDrag(event);
        }
        document.addEventListener("pointerdown", beginPointerDrag, true);
        enforceAllFloatingDialogs();
        const mutationObserver = new MutationObserver((records) => {
            records.forEach((record) => {
                record.removedNodes.forEach(unobserveRemovedDialogs);
                record.addedNodes.forEach(observeAddedDialogs);
            });
        });
        mutationObserver.observe(document.body, { childList: true, subtree: true });
        window.addEventListener("resize", enforceAllFloatingDialogs);
        return () => {
            activeCleanup?.();
            if (resizeFrame)
                window.cancelAnimationFrame(resizeFrame);
            pendingResizeDialogs.clear();
            observedDialogs.clear();
            resizeObserver?.disconnect();
            mutationObserver.disconnect();
            window.removeEventListener("resize", enforceAllFloatingDialogs);
            document.removeEventListener("pointerdown", beginPointerDrag, true);
        };
    }, []);
}
