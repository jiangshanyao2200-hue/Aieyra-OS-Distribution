import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Check,
  Shield
} from "./studio-icons";
import {
  mergeSettings
} from "./core";
import type {
  AppSettings,
  DesktopUpdateInfo
} from "./core";
import {
  ActionButton,
  DialogShell,
  Field,
  InlineNotice,
  SegmentButton,
  SegmentedControl,
  StatusLine,
  SurfaceBody,
  SurfaceHeader,
  SurfaceSection
} from "./ui";
import {
  describeError,
} from "./settings-runtime";

export default function SettingsDrawer({
  settings,
  saveSettings,
  initialUpdateInfo,
  product,
  close
}: {
  settings: AppSettings;
  saveSettings: (settings: AppSettings) => Promise<void>;
  initialUpdateInfo?: DesktopUpdateInfo | null;
  product: ReactNode;
  close: () => void;
}) {
  const [baselineSettings, setBaselineSettings] = useState(() => mergeSettings(settings));
  const [draftSettings, setDraftSettings] = useState(() => mergeSettings(settings));
  const draftSettingsRef = useRef(draftSettings);
  const baselineSettingsRef = useRef(baselineSettings);
  const incomingSettingsKey = JSON.stringify(settings);
  const lastIncomingSettingsKeyRef = useRef(incomingSettingsKey);
  useEffect(() => {
    draftSettingsRef.current = draftSettings;
  }, [draftSettings]);
  useEffect(() => {
    baselineSettingsRef.current = baselineSettings;
  }, [baselineSettings]);
  useEffect(() => {
    if (incomingSettingsKey === lastIncomingSettingsKeyRef.current) return;
    lastIncomingSettingsKeyRef.current = incomingSettingsKey;
    const incoming = mergeSettings(settings);
    // A connection refresh can update the app-level settings while this drawer
    // is open. Adopt it only when the user has no local edits; an active draft
    // must remain untouched until the user explicitly saves or discards it.
    if (JSON.stringify(draftSettingsRef.current) !== JSON.stringify(baselineSettingsRef.current)) return;
    draftSettingsRef.current = incoming;
    baselineSettingsRef.current = incoming;
    setDraftSettings(incoming);
    setBaselineSettings(incoming);
  }, [incomingSettingsKey, settings]);
  const [saving, setSaving] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState("");
  const [settingsMessageError, setSettingsMessageError] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<DesktopUpdateInfo | null>(initialUpdateInfo || null);
  const dirty = JSON.stringify(draftSettings) !== JSON.stringify(baselineSettings);

  function update<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setDraftSettings((current) => ({ ...current, [key]: value }));
    setSettingsMessage("");
  }

  useEffect(() => {
    if (initialUpdateInfo) setUpdateInfo(initialUpdateInfo);
  }, [initialUpdateInfo]);

  useEffect(() => {
    let disposed = false;
    window.aieyraUpdater?.status().then((result) => {
      if (!disposed) setUpdateInfo(result);
    }).catch(() => undefined);
    return () => { disposed = true; };
  }, []);

  async function commitSettings() {
    setSaving(true);
    setSettingsMessage("");
    setSettingsMessageError(false);
    try {
      const normalized = mergeSettings(draftSettings);
      await saveSettings(normalized);
      setDraftSettings(normalized);
      setBaselineSettings(normalized);
      setSettingsMessage("设置已保存");
    } catch (error) {
      setSettingsMessage(describeError(error));
      setSettingsMessageError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <DialogShell
        surface="settings"
        ariaLabel="设置"
        minimizable
        className="settings-drawer"
        busy={saving}
        closeBusy={saving}
        dirty={dirty}
        closePolicy={{ escape: "when-idle", backdrop: "when-idle", ["close-button"]: "when-idle" }}
        onCloseBlocked={(_reason, state) => {
          setSettingsMessage(state.busy
            ? "设置正在保存，请稍候。"
            : "请先保存修改。");
          setSettingsMessageError(false);
        }}
        onRequestClose={close}
      >
        {({ requestClose }) => (
          <>
            <SurfaceHeader
              title="设置"
              onClose={() => requestClose("close-button")}
              closeLabel="关闭设置"
              closeDisabled={saving}
            />
            <SurfaceBody className="settings-surface-body">
              <SurfaceSection className="settings-surface-section" aria-labelledby="settings-appearance-heading">
                <div className="settings-section-header">
                  <h3 id="settings-appearance-heading">外观</h3>
                </div>
                <Field label="界面主题">
                  <SegmentedControl className="theme-options" aria-label="界面主题">
                    {([
                      ["system", "跟随系统"],
                      ["light", "浅色"],
                      ["dark", "深色"]
                    ] as const).map(([value, label]) => (
                      <SegmentButton
                        key={value}
                        type="button"
                        data-theme-choice={value}
                        active={draftSettings.theme === value}
                        onClick={() => update("theme", value)}
                      >
                        {label}
                      </SegmentButton>
                    ))}
                  </SegmentedControl>
                </Field>
              </SurfaceSection>

              <SurfaceSection className="settings-surface-section settings-product-section" aria-labelledby="settings-product-heading">
                {product}
              </SurfaceSection>

              <SurfaceSection className="settings-surface-section settings-update-section" aria-labelledby="settings-update-heading">
                <div className="settings-section-header">
                  <h3 id="settings-update-heading">版本与更新</h3>
                  <span className="settings-update-status">{`当前 ${updateInfo?.currentVersion || "-"}`}</span>
                </div>
                <div className="settings-update-card">
                  <div className="settings-update-version-row">
                    <div>
                      <small>免费开源 · MIT</small>
                      <strong>{`Aieyra Workspace ${updateInfo?.currentVersion || "-"}`}</strong>
                    </div>
                    <span className="settings-update-method installer"><Shield size={13} /><span>手动更新</span></span>
                  </div>
                  <InlineNotice tone="info">需要更新时，请手动运行新版免费安装程序。</InlineNotice>
                </div>
              </SurfaceSection>
              <div className="settings-inline-actions" aria-label="设置操作">
                <ActionButton variant="primary" onClick={() => void commitSettings()} busy={saving} disabled={!dirty} icon={<Check size={15} />}>保存设置</ActionButton>
              </div>
              {settingsMessage || dirty ? <StatusLine className="settings-save-state" tone={settingsMessageError ? "danger" : dirty ? "warning" : "success"} busy={saving} live="polite">
                {settingsMessage || "有未保存修改"}
              </StatusLine> : null}
            </SurfaceBody>
          </>
        )}
      </DialogShell>
    </>
  );
}
