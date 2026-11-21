import { useEffect, useRef, useState } from "react";
import { Check, ImageIcon, Plus, Send } from "./studio-icons";

import type { AskUserDraft, ReferencePickerCanvasCandidate } from "./core";
import { ActionButton, ButtonBase, DialogShell, Field, SurfaceBody, SurfaceFooter, SurfaceHeader } from "./ui";

const CLOSE_BUTTON_REASON = "close-button" as const;

export default function AskUserDialog({
  draft,
  minimized,
  minimize,
  cancel,
  submit,
  canvasCandidates = [],
}: {
  draft: AskUserDraft;
  minimized: boolean;
  minimize: () => void;
  cancel: () => void;
  submit: (answer: string, selectedOptionId?: string, selectedCanvasCandidateIds?: string[]) => void;
  canvasCandidates?: ReferencePickerCanvasCandidate[];
}) {
  const options = Array.isArray(draft.options) ? draft.options.slice(0, 3) : [];
  const preferenceQuestion = options.some(option => option.id === "preferences-compare");
  const [answer, setAnswer] = useState(draft.suggestedAnswer ?? "");
  const [selectedOptionId, setSelectedOptionId] = useState(() => options.find((option) => option.answer === draft.suggestedAnswer)?.id || "");
  const [selectedCanvasCandidateIds, setSelectedCanvasCandidateIds] = useState<string[]>([]);
  const selectedCanvasCandidates = new Set(selectedCanvasCandidateIds);
  const canvasThumbnailsEnabled = canvasCandidates.length <= 24;
  const canvasCandidateRole = canvasCandidates[0]?.asset.role === "reference" ? "参考图" : "原图";
  const wasMinimizedRef = useRef(minimized);
  const restoreAnswerFocus = wasMinimizedRef.current && !minimized;
  useEffect(() => {
    wasMinimizedRef.current = minimized;
  }, [minimized]);
  if (minimized) return null;
  return (
    <DialogShell
      surface="ask-user"
      ariaLabel={draft.title}
      layerClassName="ask-user-layer"
      className="ask-user-dialog"
      onRequestClose={(reason) => reason === CLOSE_BUTTON_REASON ? cancel() : minimize()}
    >
      {({ requestClose }) => (
        <>
          <SurfaceHeader
            title={draft.title}
            onMinimize={minimize}
            minimizeLabel="最小化等待回复窗口"
            onClose={() => requestClose(CLOSE_BUTTON_REASON)}
            closeLabel="关闭等待回复窗口"
          />
          <SurfaceBody className={`ask-user-body${options.length ? " has-options" : ""}`}>
            <div className="ask-user-copy"><strong>{draft.question}</strong>{draft.detail ? <p>{draft.detail}</p> : null}</div>
            {options.length ? (
              <div className="ask-user-options" role="radiogroup" aria-label="可选方案">
                {options.map((option, optionIndex) => (
                  <ButtonBase
                    key={option.id}
                    type="button"
                    data-autofocus={optionIndex === 0 && !restoreAnswerFocus && !preferenceQuestion ? "true" : undefined}
                    className={`ui-choice-row ask-user-option${selectedOptionId === option.id ? " current" : ""}`}
                    role="radio"
                    aria-checked={selectedOptionId === option.id}
                    onClick={() => {
                      setSelectedOptionId(option.id);
                      setAnswer(option.answer);
                    }}
                  >
                    <span className="ask-user-option-title">
                      <strong>{option.label}</strong>
                      {option.recommended ? <em>建议</em> : null}
                    </span>
                    {option.description ? <small>{option.description}</small> : null}
                  </ButtonBase>
                ))}
              </div>
            ) : null}
            {canvasCandidates.length ? (
              <section className="reference-canvas-candidates ask-user-candidates" aria-label="画布图片候选">
                <header>
                  <div><ImageIcon size={15} /><strong>相关画布{canvasCandidateRole}</strong></div>
                  <span>已选 {selectedCanvasCandidateIds.length}/{canvasCandidates.length}</span>
                </header>
                <div className={canvasThumbnailsEnabled ? "has-thumbnails" : "is-compact"}>
                  {canvasCandidates.map((candidate) => {
                    const selected = selectedCanvasCandidates.has(candidate.id);
                    return (
                      <ButtonBase
                        key={candidate.id}
                        type="button"
                        className={`reference-canvas-candidate${selected ? " selected" : ""}`}
                        aria-pressed={selected}
                        onClick={() => setSelectedCanvasCandidateIds((current) => current.includes(candidate.id)
                          ? current.filter((id) => id !== candidate.id)
                          : [...current, candidate.id])}
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
            <Field className="ask-user-answer-field" label={options.length ? "补充或自定义回复" : "回复"}>
              <textarea
                data-ask-user-answer="true"
                data-autofocus={restoreAnswerFocus || !options.length || preferenceQuestion ? "true" : undefined}
                placeholder={preferenceQuestion ? "可以一起回答，也可以只说你愿意分享的部分。" : undefined}
                value={answer}
                onChange={(event) => {
                  setAnswer(event.target.value);
                  if (options.every((option) => option.answer !== event.target.value)) setSelectedOptionId("");
                }}
                rows={options.length ? 3 : 5}
              />
            </Field>
          </SurfaceBody>
          <SurfaceFooter>
            <ActionButton onClick={cancel}>取消</ActionButton>
            <ActionButton
              variant="primary"
              onClick={() => submit(
                answer.trim() || "已选择画布图片，请按这些素材继续原任务。",
                selectedOptionId || undefined,
                selectedCanvasCandidateIds
              )}
              disabled={!answer.trim() && selectedCanvasCandidateIds.length === 0}
              icon={<Send size={16} />}
            >
              发送给 Agent
            </ActionButton>
          </SurfaceFooter>
        </>
      )}
    </DialogShell>
  );
}
