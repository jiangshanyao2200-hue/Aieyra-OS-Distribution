import { useState } from "react";
import { Star } from "./studio-icons";
import { Search } from "./studio-icons";
import {
  agentModelsFromList,
  imageModelsFromList,
  isImageGenerationModelId,
  normalizeAgentModelPoolSelection,
  selectedAgentModelsFromSettings,
  selectedImageModelsFromSettings,
  setPrimaryAgentModelSelection,
  setPrimaryImageModelSelection,
  toggleImageModelSelection,
  type AppSettings,
  type ModelKeyRoute,
  type ProviderModelInfo,
} from "./core";
import { IconActionButton, SearchField } from "./ui";
import { ModelNoteAction } from "./model-note-action";

export default function ConnectionModelFields({ settings, models, routes = [], directory = [], keyName = "API Key", disabled, onChange }: {
  settings: AppSettings;
  models: string[];
  routes?: ModelKeyRoute[];
  directory?: ProviderModelInfo[];
  keyName?: string;
  disabled: boolean;
  onChange: (settings: AppSettings) => void;
}) {
  const [queries, setQueries] = useState({ agent: "", image: "" });
  const modelInfo = new Map(directory.map(item => [item.id, item]));

  function toggleAgent(model: string) {
    const selected = selectedAgentModelsFromSettings(settings);
    const exists = selected.some((item) => item.toLowerCase() === model.toLowerCase());
    if (exists && selected.length === 1) return;
    const pool = exists
      ? selected.filter((item) => item.toLowerCase() !== model.toLowerCase())
      : [...selected, model];
    const primary = pool.find((item) => item.toLowerCase() === settings.agentModel.toLowerCase()) || pool[0] || "";
    onChange(normalizeAgentModelPoolSelection({ ...settings, agentModel: primary, agentModelPool: pool }));
  }

  return (
    <div className="connection-model-columns">
      {(["agent", "image"] as const).map((kind) => {
        const modelCatalog = kind === "agent" ? agentModelsFromList(models) : imageModelsFromList(models);
        const catalog = modelCatalog.flatMap(model => {
          const matches = routes.filter(route => route.model.toLowerCase() === model.toLowerCase());
          return matches.length ? matches : [{ model, tokenId: "", tokenName: keyName }];
        });
        const bindings = settings.modelKeyBindings?.[kind] || {};
        const selectedToken = (model: string) => bindings[model.toLowerCase()] || catalog.find(route => route.model.toLowerCase() === model.toLowerCase())?.tokenId || "";
        const selected = kind === "agent" ? selectedAgentModelsFromSettings(settings) : selectedImageModelsFromSettings(settings);
        const primary = kind === "agent" ? settings.agentModel : settings.imageModel;
        const title = kind === "agent" ? "Agent 模型" : "生图模型";
        const rank = (model: string) => model.toLowerCase() === primary.toLowerCase() ? 0
          : selected.some(item => item.toLowerCase() === model.toLowerCase()) ? 1
          : kind === "image" && isImageGenerationModelId(model) ? 2 : 3;
        const filtered = catalog.filter(route => `${route.model} ${route.tokenName}`.toLowerCase().includes(queries[kind].trim().toLowerCase()))
          .sort((a, b) => rank(a.model) - rank(b.model));
        return (
          <section className="connection-model-column" data-model-kind={kind} aria-label={title} key={kind}>
            <header><strong>{title}</strong><SearchField label={`搜索${title}`} icon={<Search size={14} />} inputProps={{
              value: queries[kind],
              placeholder: "搜索模型",
              disabled,
              onChange: (event) => setQueries((current) => ({ ...current, [kind]: event.target.value })),
            }} /><span className="connection-model-count" aria-live="polite">已选 {selected.length}/{catalog.length}</span></header>
            <div className="connection-model-options">
              {filtered.map(({ model, tokenId, tokenName }) => {
                const info = modelInfo.get(model);
                const checked = selected.some(item => item.toLowerCase() === model.toLowerCase()) && selectedToken(model) === tokenId;
                const isPrimary = checked && model.toLowerCase() === primary.toLowerCase();
                const choose = () => {
                  if (!tokenId) { if (kind === "agent") toggleAgent(model); else onChange(toggleImageModelSelection(settings, model)); return; }
                  const nextBindings = { agent: { ...settings.modelKeyBindings?.agent }, image: { ...settings.modelKeyBindings?.image },
                    [kind]: { ...bindings, [model.toLowerCase()]: tokenId } };
                  let next: AppSettings = { ...settings, modelKeyBindings: nextBindings };
                  const inPool = selected.some(item => item.toLowerCase() === model.toLowerCase());
                  if (kind === "agent") {
                    if (checked && selected.length > 1) {
                      next = normalizeAgentModelPoolSelection({ ...next, agentModel: isPrimary ? selected.find(item => item !== model)! : settings.agentModel,
                        agentModelPool: selected.filter(item => item.toLowerCase() !== model.toLowerCase()) });
                    } else if (!inPool) next = normalizeAgentModelPoolSelection({ ...next, agentModelPool: [...selected, model] });
                  } else if (checked || !inPool) next = toggleImageModelSelection(next, model);
                  onChange(next);
                };
                return (
                  <div className={`connection-model-row${checked ? " is-selected" : ""}`} data-model={model} data-key-id={tokenId} key={`${model}:${tokenId}`}>
                    <label className="connection-model-choice">
                      <input type="checkbox" checked={checked} disabled={disabled} aria-label={`选择 ${model}`} title={`${model} · ${tokenName}`}
                        onChange={choose} />
                      <span>
                        <strong>{model}</strong>
                        <small>{info?.name || tokenName}{info?.contextWindow ? ` · ${Math.round(info.contextWindow / 1000)}K` : ""}{info?.supportsTools === false ? " · 无工具能力" : ""}</small>
                      </span>
                    </label>
                    {kind === "image" && checked ? <ModelNoteAction model={model}
                      value={settings.imageModelNotes[model] || ""} disabled={disabled}
                      onChange={value => onChange({ ...settings, imageModelNotes: { ...settings.imageModelNotes, [model]: value } })}
                    /> : null}
                    {checked ? <IconActionButton
                      className="connection-model-primary"
                      label={`设 ${model} 为主模型`}
                      title={isPrimary ? `${model} 是主模型` : `设 ${model} 为主模型`}
                      icon={<Star size={15} fill={isPrimary ? "currentColor" : "none"} />}
                      aria-pressed={isPrimary}
                      disabled={disabled}
                      onClick={() => onChange(kind === "agent"
                        ? setPrimaryAgentModelSelection(settings, model)
                        : setPrimaryImageModelSelection(settings, model))}
                    /> : null}
                  </div>
                );
              })}
              {!filtered.length ? <p className="connection-model-empty">{catalog.length ? "没有匹配的模型" : "暂无可用模型"}</p> : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}
