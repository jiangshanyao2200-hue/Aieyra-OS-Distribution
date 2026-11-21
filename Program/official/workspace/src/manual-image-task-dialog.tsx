import React from "react";
import { ImageIcon, Send, X } from "./studio-icons";
import {
  FRAME_OPTIONS,
  IMAGE_COUNT_OPTIONS,
  MAX_REFERENCE_IMAGES,
  qualityOptionsForModel,
  SIZE_PRESETS,
  clipboardHasImage,
  cloneImageTaskDraft,
  computedSizeFor,
  frameOptionsForModel,
  imageAssetSrc,
  qualityLabel,
  sizePresetsForModel
} from "./core";
import type { ImageTaskDraft } from "./core";
import { ActionButton, DialogShell, Field, IconActionButton, SurfaceBody, SurfaceFooter, SurfaceHeader } from "./ui";

export type ManualImageTaskDialogState = {
  draft: ImageTaskDraft;
  worldX: number;
  worldY: number;
  projectId: string;
  forkFromNodeId?: string;
  targetNodeId?: string;
};

export default function ManualImageTaskDialog({ state, setState, imageModel, imageModels, executionBusy, close, openReferencePicker, submit, submitToAgent }: {
  state: ManualImageTaskDialogState;
  setState: React.Dispatch<React.SetStateAction<ManualImageTaskDialogState | null>>;
  imageModel?: string;
  imageModels: string[];
  executionBusy?: boolean;
  close: () => void;
  openReferencePicker: () => void;
  submit: () => void;
  submitToAgent: () => void;
}) {
  const draft = state.draft;
  const selectedModel = draft.model || imageModel;
  const ratioOptions = frameOptionsForModel(draft.resolution, selectedModel);
  const resolutionOptions = sizePresetsForModel(draft.ratio, selectedModel);
  const references = draft.referenceImages ?? [];

  function updateDraft(patch: Partial<ImageTaskDraft>) {
    setState((current) => current
      ? { ...current, draft: cloneImageTaskDraft({ ...current.draft, ...patch }) }
      : current
    );
  }

  function updateRatio(ratio: string) {
    const availableResolutions = sizePresetsForModel(ratio, selectedModel);
    const resolution = availableResolutions.some((option) => option.resolution === draft.resolution)
      ? draft.resolution
      : availableResolutions[0]?.resolution || draft.resolution;
    updateDraft({ ratio, resolution });
  }

  function updateResolution(resolution: string) {
    const availableRatios = frameOptionsForModel(resolution, selectedModel);
    const ratio = availableRatios.some((option) => option.ratio === draft.ratio)
      ? draft.ratio
      : availableRatios[0]?.ratio || draft.ratio;
    updateDraft({ resolution, ratio });
  }

  function removeReference(path: string) {
    updateDraft({ referenceImages: references.filter((image) => image.path !== path) });
  }

  return (
    <DialogShell
      surface="manual-image-task"
      ariaLabel="手动生图"
      minimizable
      layerClassName="manual-image-task-layer"
      className="image-create-dialog manual-image-task-dialog"
      onRequestClose={close}
    >
      {({ requestClose }) => (
        <>
          <SurfaceHeader
            title="手动生图"
            description="描述画面，按需添加参考图。"
            onClose={() => requestClose("close-button")}
          />
          <SurfaceBody className="manual-image-task-body">
            <section className="manual-image-brief">
            <Field className="manual-image-task-prompt" label="画面要求">
              <textarea
                value={draft.prompt}
                onChange={(event) => updateDraft({ prompt: event.target.value })}
                onPaste={(event) => {
                  if (clipboardHasImage(event)) event.preventDefault();
                }}
                placeholder="描述主体、风格、构图、用途和你最在意的质量标准…"
                rows={7}
                autoFocus
              />
            </Field>

            <div className="manual-image-reference-row">
              <ActionButton className="manual-image-reference-button" onClick={openReferencePicker} disabled={references.length >= MAX_REFERENCE_IMAGES} icon={<ImageIcon size={15} />}>
                参考图
                {references.length ? <strong>{references.length}/{MAX_REFERENCE_IMAGES}</strong> : null}
              </ActionButton>
              {references.length ? (
                <div className="manual-image-reference-list" aria-label="已选参考图">
                  {references.map((image) => (
                    <span key={image.path} title={image.name || image.path}>
                      <img src={image.assetUrl || imageAssetSrc({ type: "file", path: image.path })} alt="" loading="lazy" decoding="async" />
                      <em>{image.name || "参考图"}</em>
                      <IconActionButton
                        className="manual-image-reference-remove"
                        label={`移除 ${image.name || "参考图"}`}
                        onClick={() => removeReference(image.path)}
                        icon={<X size={12} />}
                      />
                    </span>
                  ))}
                </div>
              ) : <small>可选，最多 {MAX_REFERENCE_IMAGES} 张</small>}
            </div>

            </section>
            <aside className="manual-image-settings" aria-label="输出设置">
            <Field label="生图模型">
              <select value={draft.model || imageModel || ""} onChange={event => updateDraft({ model: event.target.value })}>
                {[...new Set([draft.model || imageModel || "", ...imageModels].filter(Boolean))].map(model => <option key={model} value={model}>{model}</option>)}
              </select>
            </Field>
            <div className="manual-image-task-controls">
              <Field label="比例">
                <select value={draft.ratio} onChange={(event) => updateRatio(event.target.value)}>
                  {(ratioOptions.length ? ratioOptions : FRAME_OPTIONS).map((option) => (
                    <option key={option.ratio} value={option.ratio}>{option.ratio}</option>
                  ))}
                </select>
              </Field>
              <Field label="分辨率">
                <select value={draft.resolution} onChange={(event) => updateResolution(event.target.value)}>
                  {(resolutionOptions.length ? resolutionOptions : SIZE_PRESETS).map((option) => (
                    <option key={option.resolution} value={option.resolution}>{option.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="质量">
                <select value={draft.quality} onChange={(event) => updateDraft({ quality: event.target.value as ImageTaskDraft["quality"] })}>
                  {qualityOptionsForModel(draft.model || imageModel).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </Field>
              <Field label="张数">
                <select value={String(draft.count)} onChange={(event) => updateDraft({ count: Number(event.target.value) })}>
                  {IMAGE_COUNT_OPTIONS.map((count) => <option key={count} value={count}>{count} 张</option>)}
                </select>
              </Field>
            </div>

            </aside>
          </SurfaceBody>
          <SurfaceFooter leading={<div className="manual-image-task-summary">
            <span>{computedSizeFor(draft.ratio, draft.resolution)}</span>
            <span>{qualityLabel(draft.quality)}</span>
            <span>{draft.count > 1 ? `并行 ${draft.count} 张` : "单张"}</span>
          </div>}>
            <ActionButton onClick={submitToAgent} disabled={executionBusy || !draft.prompt.trim()} icon={<Send size={16} />}>
              交给 Agent 执行
            </ActionButton>
            <ActionButton variant="primary" onClick={submit} disabled={!draft.prompt.trim()} icon={<ImageIcon size={16} />}>
              直接执行
            </ActionButton>
          </SurfaceFooter>
        </>
      )}
    </DialogShell>
  );
}
