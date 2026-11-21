import React, { useState } from "react";
import { Check, ImageIcon, Import, Plus, X } from "./studio-icons";
import {
  MAX_AGENT_REFERENCE_IMAGES,
  MAX_AGENT_SOURCE_IMAGES,
  cloneReferenceImages,
  imageAssetSrc,
  mergeReferenceImages
} from "./core";
import type {
  ReferenceImage,
  ReferencePickerDraft
} from "./core";
import {
  ActionButton,
  ButtonBase,
  DialogShell,
  IconActionButton,
  InlineNotice,
  SurfaceBody,
  SurfaceFooter,
  SurfaceHeader
} from "./ui";

const CLOSE_BUTTON_REASON = "close-button" as const;

export function AgentAssetPickerDialog({
  projectId,
  initialSourceImages,
  initialReferenceImages,
  close,
  save
}: {
  projectId: string;
  initialSourceImages: ReferenceImage[];
  initialReferenceImages: ReferenceImage[];
  close: () => void;
  save: (sourceImages: ReferenceImage[], referenceImages: ReferenceImage[]) => void;
}) {
  const [sourceImages, setSourceImages] = useState(() => cloneReferenceImages(initialSourceImages));
  const [referenceImages, setReferenceImages] = useState(() => cloneReferenceImages(initialReferenceImages));
  const [message, setMessage] = useState("");

  async function addImages(role: "source" | "reference") {
    const maximum = role === "source" ? MAX_AGENT_SOURCE_IMAGES : MAX_AGENT_REFERENCE_IMAGES;
    const current = role === "source" ? sourceImages : referenceImages;
    const remaining = maximum - current.length;
    if (remaining <= 0) return;
    const label = role === "source" ? "原图" : "参考图";
    const result = await window.aieyraConfig?.pickReferenceImages?.({
      max: remaining,
      projectId,
      title: `添加${label}`
    });
    if (!result?.ok || result.canceled) {
      if (result && !result.ok) setMessage(result.error ?? `${label}选择失败。`);
      return;
    }
    const incoming = result.images ?? (result.image ? [result.image] : []);
    const update = role === "source" ? setSourceImages : setReferenceImages;
    update((items) => mergeReferenceImages(items, incoming, maximum));
    setMessage(result.truncated ? `${label}已添加到 ${maximum} 张上限。` : "");
  }

  function removeImage(role: "source" | "reference", index: number) {
    const update = role === "source" ? setSourceImages : setReferenceImages;
    update((items) => items.filter((_item, itemIndex) => itemIndex !== index));
    setMessage("");
  }

  const groups = [
    { role: "source" as const, title: "添加原图", images: sourceImages, maximum: MAX_AGENT_SOURCE_IMAGES, icon: <Import size={16} /> },
    { role: "reference" as const, title: "添加参考图", images: referenceImages, maximum: MAX_AGENT_REFERENCE_IMAGES, icon: <ImageIcon size={16} /> }
  ];

  return (
    <DialogShell
      surface="agent-asset-picker"
      ariaLabel="添加图片"
      minimizable
      layerClassName="agent-asset-picker-layer"
      className="agent-asset-picker-dialog"
      onRequestClose={close}
    >
      {({ requestClose }) => (
        <>
          <SurfaceHeader
            title="添加"
            onClose={() => requestClose(CLOSE_BUTTON_REASON)}
            closeLabel="关闭图片添加窗口"
          />
          <SurfaceBody className="agent-asset-picker-body">
            <div className="agent-asset-picker-columns">
              {groups.map((group) => (
                <section className="agent-asset-picker-column" key={group.role} aria-label={group.title}>
                  <header>
                    <div>
                      {group.icon}
                      <h3>{group.title}</h3>
                    </div>
                    <span>{group.images.length}/{group.maximum}</span>
                  </header>
                  <div className="agent-asset-picker-grid">
                    <ButtonBase
                      className="ui-choice-row agent-asset-add-tile"
                      type="button"
                      onClick={() => void addImages(group.role)}
                      disabled={group.images.length >= group.maximum}
                      aria-label={group.title}
                    >
                      <Plus size={24} />
                      <span>选择图片</span>
                    </ButtonBase>
                    {group.images.map((image, index) => (
                      <figure key={image.occurrenceId || `${image.path || image.assetUrl}:${index}`} className="agent-asset-tile">
                        <img src={image.assetUrl || imageAssetSrc({ type: "file", path: image.path })} alt={image.name} loading="lazy" decoding="async" />
                        <figcaption>{image.name}</figcaption>
                        <IconActionButton
                          className="agent-asset-remove"
                          label={`移除${group.role === "source" ? "原图" : "参考图"}`}
                          onClick={() => removeImage(group.role, index)}
                          icon={<X size={13} />}
                        />
                      </figure>
                    ))}
                  </div>
                </section>
              ))}
            </div>
            {message ? <InlineNotice tone="warning">{message}</InlineNotice> : null}
          </SurfaceBody>
          <SurfaceFooter>
            <ActionButton onClick={() => requestClose("action")}>取消</ActionButton>
            <ActionButton variant="primary" onClick={() => save(sourceImages, referenceImages)}>保存</ActionButton>
          </SurfaceFooter>
        </>
      )}
    </DialogShell>
  );
}

export function ReferencePickerDialog({ draft, setDraft, projectId, minimize, close, save }: {
  draft: ReferencePickerDraft;
  setDraft: React.Dispatch<React.SetStateAction<ReferencePickerDraft | null>>;
  projectId: string;
  minimize: () => void;
  close: () => void;
  save: () => void;
}) {
  const [message, setMessage] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 9;
  const selectedCanvasIds = new Set(draft.selectedCanvasCandidateIds || []);
  const selectedCanvasCount = selectedCanvasIds.size;
  const fileCapacity = Math.max(0, draft.max - selectedCanvasCount);
  const visibleSlots = Math.min(fileCapacity, draft.images.length + 1);
  const pageCount = Math.max(1, Math.ceil(Math.max(1, visibleSlots) / pageSize));
  const visiblePage = Math.min(page, pageCount - 1);
  const pageStart = visiblePage * pageSize;
  const pageSlots = Math.max(0, Math.min(pageSize, visibleSlots - pageStart));
  const itemLabel = draft.target.kind === "agent-source" || (
    draft.target.kind === "agent-request" && draft.target.role === "source"
  ) ? "原图" : "参考图";
  const remaining = Math.max(0, draft.max - draft.images.length - selectedCanvasCount);
  const minimizable = draft.target.kind === "agent-request";
  const canvasCandidates = draft.canvasCandidates || [];
  const canvasThumbnailsEnabled = canvasCandidates.length <= 48;

  async function addImages() {
    if (remaining <= 0) return;
    const result = await window.aieyraConfig?.pickReferenceImages?.({ max: remaining, projectId, title: `选择${itemLabel}` });
    if (!result?.ok || result.canceled) {
      if (result && !result.ok) setMessage(result.error ?? `${itemLabel}选择失败。`);
      return;
    }
    const incoming = result.images ?? (result.image ? [result.image] : []);
    setDraft((current) => {
      if (!current) return current;
      const selectedCount = new Set(current.selectedCanvasCandidateIds || []).size;
      const currentFileCapacity = Math.max(0, current.max - selectedCount);
      return {
        ...current,
        images: mergeReferenceImages(current.images, incoming, currentFileCapacity),
      };
    });
    if (incoming.length) setPage(Math.min(pageCount - 1, Math.floor(draft.images.length / pageSize)));
    setMessage(result.truncated ? `已添加到上限 ${draft.max} 张。` : incoming.length ? `已添加 ${incoming.length} 张。` : "");
  }

  function removeImage(imageIndex: number) {
    setDraft((current) => current ? { ...current, images: current.images.filter((_image, index) => index !== imageIndex) } : current);
    setMessage("");
  }

  function toggleCanvasCandidate(id: string) {
    setDraft((current) => {
      if (!current) return current;
      const selected = new Set(current.selectedCanvasCandidateIds || []);
      if (selected.has(id)) {
        selected.delete(id);
      } else {
        if (current.images.length + selected.size >= current.max) {
          setMessage(`最多选择 ${current.max} 张${itemLabel}。`);
          return current;
        }
        selected.add(id);
      }
      setMessage("");
      return { ...current, selectedCanvasCandidateIds: [...selected] };
    });
  }

  return (
    <DialogShell
      surface="reference-picker"
      ariaLabel={draft.title}
      layerClassName="reference-picker-layer"
      className="reference-picker-dialog"
      onRequestClose={close}
    >
      {({ requestClose }) => (
        <>
          <SurfaceHeader
            title={draft.title}
            description={draft.detail}
            onMinimize={minimizable ? minimize : undefined}
            minimizeLabel="最小化素材等待窗口"
            onClose={() => requestClose(CLOSE_BUTTON_REASON)}
            closeLabel="关闭素材选择"
          />
          <SurfaceBody className="reference-picker-body">
            {canvasCandidates.length ? (
              <section className="reference-canvas-candidates" aria-label={`从画布选择${itemLabel}`}>
                <header>
                  <div><ImageIcon size={15} /><strong>从当前画布选择</strong></div>
                  <span>已选 {selectedCanvasCount}/{draft.max}</span>
                </header>
                <div className={canvasThumbnailsEnabled ? "has-thumbnails" : "is-compact"}>
                  {canvasCandidates.map((candidate) => {
                    const selected = selectedCanvasIds.has(candidate.id);
                    return (
                      <ButtonBase
                        key={candidate.id}
                        type="button"
                        className={`reference-canvas-candidate${selected ? " selected" : ""}`}
                        aria-pressed={selected}
                        onClick={() => toggleCanvasCandidate(candidate.id)}
                        title={`@${candidate.displayCode} · ${candidate.name}`}
                      >
                        <span className="reference-canvas-preview">
                          {canvasThumbnailsEnabled && candidate.previewSrc
                            ? <img src={candidate.previewSrc} alt="" loading="lazy" decoding="async" />
                            : <ImageIcon size={16} />}
                        </span>
                        <span><strong>@{candidate.displayCode}</strong><small>{candidate.name}</small></span>
                        <i aria-hidden="true">{selected ? <Check size={13} /> : <Plus size={13} />}</i>
                      </ButtonBase>
                    );
                  })}
                </div>
              </section>
            ) : null}
            {fileCapacity > 0 ? (
              <>
                <div className="reference-local-heading">
                  <strong>从电脑添加</strong>
                  <span>{draft.images.length}/{fileCapacity} 张</span>
                </div>
                <div className="reference-grid">
                  {Array.from({ length: pageSlots }, (_item, offset) => {
                    const index = pageStart + offset;
                    const image = draft.images[index];
                    return image ? (
                      <figure key={image.occurrenceId || `${image.path}:${index}`} className="reference-slot filled">
                        <img src={image.assetUrl || imageAssetSrc({ type: "file", path: image.path })} alt={image.name} loading="lazy" decoding="async" />
                        <figcaption>{image.name}</figcaption>
                        <IconActionButton className="reference-slot-remove" label={`移除${itemLabel}`} onClick={() => removeImage(index)} icon={<X size={14} />} />
                      </figure>
                    ) : (
                      <ButtonBase key={`empty-${index}`} className="ui-choice-row reference-slot empty" type="button" onClick={addImages} aria-label={`添加${itemLabel}`}><Plus size={22} /><span>添加{itemLabel}</span></ButtonBase>
                    );
                  })}
                </div>
              </>
            ) : null}
            <div className="reference-picker-status">
              <span>{draft.images.length + selectedCanvasCount}/{draft.max} 张{itemLabel}</span>
              {pageCount > 1 ? (
                <span className="reference-picker-pages">
                  <IconActionButton label="上一页" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={visiblePage === 0} icon={<span aria-hidden="true">‹</span>} />
                  <strong>{visiblePage + 1}/{pageCount}</strong>
                  <IconActionButton label="下一页" onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))} disabled={visiblePage >= pageCount - 1} icon={<span aria-hidden="true">›</span>} />
                </span>
              ) : null}
              {message ? <em>{message}</em> : null}
            </div>
          </SurfaceBody>
          <SurfaceFooter>
            <ActionButton onClick={minimizable ? close : () => requestClose("action")}>取消</ActionButton>
            <ActionButton variant="primary" onClick={save}>保存</ActionButton>
          </SurfaceFooter>
        </>
      )}
    </DialogShell>
  );
}
