// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fs; path; SNAPSHOT_FILE; SCHEMA_VERSION; TYPE_ORDER; finite; positive; clone; hasValue; own; cleanText; sourceMeta; normalizeModalities; modalityLabels; summaryZh; normalizedPrice; roundEstimate; valueScore; exactKey; providerAliases; mapSourceRecords; applyRecord; enrichRow; groupOf; sortRows; enrichRows; buildPriceFromOpenRouter; buildPriceFromLiteLLM; buildPriceFromMetadata; recordFromMetadata; recordFromOpenRouter; loadSnapshot; bundledRecords; bundled; enrichBundledRows
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/model-data-center.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';

// C2 本地模型数据中心。
//
// 这个模块只负责把已经采集到的资料归一化、合并和排序。它不联网，也不
// 接触配置里的 API Key。显式刷新由 provider-settings.cjs 完成，CORE 使用
// 随版本写入的 JSON 快照。未知值始终保留为 null；缺少价格不能推断免费。

const fs = require('node:fs');
const path = require('node:path');

const SNAPSHOT_FILE = path.join(__dirname, 'model_data_center_snapshot.json');
const SCHEMA_VERSION = 1;
const TYPE_ORDER = ['看图', '生图', '音频', '视频', '向量', '重排', '只文本'];

const finite = value => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const positive = value => {
  const n = finite(value);
  return n !== null && n >= 0 ? n : null;
};
const clone = value => value === undefined ? undefined : structuredClone(value);
const hasValue = value => value !== undefined && value !== null && value !== '';
const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);

function cleanText(value) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

function sourceMeta(source, url, fetchedAt, referenceOnly = false) {
  return { source, url: url || null, fetched_at: fetchedAt || null, reference_only: !!referenceOnly };
}

function normalizeModalities(input, output) {
  const inList = Array.isArray(input) ? input.filter(x => typeof x === 'string') : null;
  const outList = Array.isArray(output) ? output.filter(x => typeof x === 'string') : null;
  return { input: inList && inList.length ? [...new Set(inList)] : null, output: outList && outList.length ? [...new Set(outList)] : null };
}

function modalityLabels(modalities) {
  const input = modalities?.input || [];
  const output = modalities?.output || [];
  const all = new Set([...input, ...output].map(x => String(x).toLowerCase()));
  const labels = [];
  if (all.has('image') || all.has('image_url') || all.has('file')) labels.push('看图');
  if (output.some(x => /image|image_url/.test(String(x).toLowerCase()))) labels.push('生图');
  if (all.has('audio')) labels.push('音频');
  if (all.has('video')) labels.push('视频');
  if (all.has('embedding')) labels.push('向量');
  if (all.has('rerank') || all.has('relevance')) labels.push('重排');
  if (!labels.length && (all.size === 0 || (all.size === 1 && all.has('text')))) labels.push('只文本');
  return TYPE_ORDER.filter(label => labels.includes(label));
}

function summaryZh(row) {
  const existing = cleanText(row.summary_zh);
  if (existing && [...existing].length <= 20) return existing;
  const modalities = row.modalities || {};
  const labels = modalityLabels(modalities);
  const name = cleanText(row.name || row.id);
  const facts = [];
  if (labels.includes('生图')) facts.push('图像生成');
  else if (labels.includes('看图')) facts.push('图像理解');
  else if (labels.includes('音频')) facts.push('音频处理');
  else if (labels.includes('视频')) facts.push('视频理解');
  else if (labels.includes('向量')) facts.push('向量表示');
  else if (labels.includes('重排')) facts.push('文本重排');
  else facts.push('文本对话');
  if (row.reasoning === true) facts.push('推理');
  if (row.tool_calls === true) facts.push('工具调用');
  const candidate = facts.join('，');
  if ([...candidate].length <= 20) return candidate;
  if ([...name].length <= 20 && name) return name;
  return [...candidate].slice(0, 20).join('');
}

function normalizedPrice(input, options = {}) {
  if (!input || typeof input !== 'object') return null;
  const scale = Number.isFinite(options.scale) ? options.scale : 1;
  const rate = finite(options.fx);
  const fx = rate !== null && rate > 0 ? rate : null;
  const convert = key => {
    const n = positive(input[key]);
    if (n === null || options.currency !== 'CNY' && fx === null) return null;
    return n * scale * (options.currency === 'CNY' ? 1 : fx);
  };
  const result = {
    currency: 'CNY', unit: 'million_tokens',
    input: convert('input'), output: convert('output'),
    cache_read: convert('cache_read'), cache_write: convert('cache_write'),
  };
  const original = {
    currency: options.currency || 'USD', unit: 'million_tokens',
    input: positive(input.input), output: positive(input.output),
    cache_read: positive(input.cache_read), cache_write: positive(input.cache_write),
  };
  result.original = original;
  result.fx = options.currency === 'CNY' ? null : { usd_cny: fx, date: options.fxDate || null, source: options.fxSource || null };
  result.source = options.source || null;
  result.tiers = Array.isArray(options.tiers) ? clone(options.tiers) : [];
  result.periods = Array.isArray(options.periods) ? clone(options.periods) : [];
  result.active_period = options.activePeriod || null;
  return result;
}

function roundEstimate(price) {
  const p = price || {};
  const input = positive(p.input), cacheRead = positive(p.cache_read), output = positive(p.output);
  if (input === null || output === null) return { cny: null, input_tokens: 20000, cache_ratio: 0.8, output_tokens: 1000, cache_known: cacheRead !== null, source: 'C2 fixed estimate; price unknown' };
  // 80% of the input is assumed to hit cache. If no cache price is known,
  // use the full input price, which is deliberately conservative.
  const cacheKnown = cacheRead !== null;
  const effectiveInput = cacheKnown ? cacheRead * 0.8 + input * 0.2 : input;
  const cny = (effectiveInput * 20000 + output * 1000) / 1e6;
  return { cny: Number(cny.toFixed(8)), input_tokens: 20000, cache_ratio: 0.8, output_tokens: 1000, cache_known: cacheKnown, source: 'C2 fixed estimate' };
}

function valueScore(agentScore, price) {
  const score = finite(agentScore);
  const input = positive(price?.input), output = positive(price?.output);
  if (score === null || input === null || output === null) return null;
  const composite = (3 * input + output) / 4;
  return composite > 0 ? Number((score / composite).toFixed(8)) : null;
}

function exactKey(provider, id) {
  return `${String(provider || '').toLowerCase()}\u0000${String(id || '')}`;
}

function providerAliases(provider) {
  const p = String(provider || '').toLowerCase();
  if (p === 'alibaba-cn' || p === 'alibaba' || p === 'bailian') return ['alibaba-cn', 'alibaba', 'bailian'];
  if (p === 'google' || p === 'gemini') return ['google', 'gemini'];
  if (p === 'xai' || p === 'grok') return ['xai', 'grok'];
  if (p === 'aieyra-gateway' || p === 'custom' || p === 'aieyra') return ['aieyra-gateway', 'custom', 'aieyra'];
  return [p];
}

function mapSourceRecords(records) {
  const map = new Map();
  for (const record of records || []) {
    if (!record || !record.id) continue;
    const providers = providerAliases(record.provider || record.supplier);
    for (const provider of providers) map.set(exactKey(provider, record.id), record);
  }
  return map;
}

function applyRecord(row, record, options = {}) {
  const out = { ...clone(row) };
  if (!record) return out;
  const source = record.source || options.source || 'catalog';
  const url = record.source_url || options.sourceUrl || null;
  const fetchedAt = record.fetched_at || options.fetchedAt || null;
  const fields = out.field_sources || {};
  const setUnknown = (key, value) => {
    if (!hasValue(value)) return;
    if (!hasValue(out[key]) || out[key] === 0 || out[key] === false && key === 'free') {
      out[key] = clone(value);
      fields[key] = sourceMeta(source, url, fetchedAt, !!record.reference_only);
    }
  };
  setUnknown('name', record.name);
  setUnknown('context_window', positive(record.context_window || record.context_length || record.limit?.context));
  setUnknown('output_limit', positive(record.output_limit || record.max_output || record.limit?.output));
  if (!out.modalities && record.modalities) out.modalities = normalizeModalities(record.modalities.input, record.modalities.output);
  if (!out.modalities && record.architecture) out.modalities = normalizeModalities(record.architecture.input_modalities, record.architecture.output_modalities);
  if (!hasValue(out.tool_calls) && hasValue(record.tool_calls)) setUnknown('tool_calls', record.tool_calls);
  if (!hasValue(out.reasoning) && hasValue(record.reasoning)) setUnknown('reasoning', record.reasoning);
  if (!out.reasoning_options && Array.isArray(record.reasoning_options)) out.reasoning_options = clone(record.reasoning_options);
  if (!out.description && record.description) out.description = cleanText(record.description);
  if (!out.agent_score && record.agent_score) out.agent_score = clone(record.agent_score);
  if (!out.popularity && record.popularity) out.popularity = clone(record.popularity);
  if (!out.price && record.price) out.price = clone(record.price);
  if (!hasValue(out.free) && hasValue(record.free)) out.free = record.free;
  if (record.canonical_model_id && !out.canonical_model_id) out.canonical_model_id = record.canonical_model_id;
  if (record.hugging_face_id && !out.hugging_face_id) out.hugging_face_id = record.hugging_face_id;
  out.field_sources = fields;
  return out;
}

function enrichRow(row, options = {}) {
  const input = { ...clone(row) };
  const provider = options.provider || input.provider || input.catalog_provider;
  const records = options.records instanceof Map ? options.records : mapSourceRecords(options.records || []);
  const record = records.get(exactKey(provider, input.id)) || records.get(exactKey(provider, input.model));
  const out = applyRecord(input, record, options);
  out.modalities = out.modalities || normalizeModalities(out.input_modalities, out.output_modalities);
  out.type_labels = Array.isArray(out.type_labels) && out.type_labels.length ? [...out.type_labels] : modalityLabels(out.modalities);
  if (!out.type_labels.length && out.tool_calls === false) out.type_labels = ['只文本'];
  if (!hasValue(out.free)) out.free = null;
  if (!hasValue(out.agent_score)) out.agent_score = null;
  if (!hasValue(out.popularity)) out.popularity = null;
  if (!out.price) out.price = null;
  out.summary_zh = summaryZh(out);
  out.round_estimate = out.round_estimate || roundEstimate(out.price);
  out.value_score = out.value_score ?? valueScore(out.agent_score?.value ?? out.agent_score, out.price);
  out.unused = out.unused === true || out.tool_calls === false || (out.modalities?.output || []).some(x => x !== 'text' && /image|audio|video|embedding/.test(String(x)));
  out.unused_reason = out.unused_reason ?? (out.tool_calls === false ? '不支持工具调用' : null);
  out.catalog_updated_at = out.catalog_updated_at || options.fetchedAt || null;
  out.catalog_sources = Array.isArray(out.catalog_sources) ? out.catalog_sources : [];
  if (record && sourceMeta(record.source || options.source, record.source_url || options.sourceUrl, record.fetched_at || options.fetchedAt, !!record.reference_only).source) {
    const meta = sourceMeta(record.source || options.source, record.source_url || options.sourceUrl, record.fetched_at || options.fetchedAt, !!record.reference_only);
    if (!out.catalog_sources.some(x => x.source === meta.source && x.url === meta.url)) out.catalog_sources.push(meta);
  }
  return out;
}

function groupOf(row) {
  if (row.retired || row.expiration_date) return 'retired';
  if (row.unused) return 'unused';
  if (row.free === true) return 'free';
  if (row.recommended === true) return 'recommended';
  if (row.value_score !== null && row.value_score !== undefined) return 'value';
  return 'unscored';
}

function sortRows(rows, options = {}) {
  const source = (rows || []).map(row => ({ ...clone(row) }));
  const scored = source.filter(row => row.unused !== true && row.free !== true && row.value_score !== null && row.value_score !== undefined && row.agent_score !== null && row.price);
  const top = new Set(scored.sort((a, b) => (b.value_score - a.value_score) || String(a.id).localeCompare(String(b.id))).slice(0, 3).map(row => row.id));
  for (const row of source) {
    // A free model remains in the free section; the star is reserved for the
    // paid value section so the two visual groups stay unambiguous.
    row.recommended = row.free === true ? false : top.has(row.id);
    row.catalog_group = groupOf(row);
  }
  const groupRank = { free: 0, recommended: 1, value: 2, unscored: 3, retired: 4, unused: 5 };
  const popularity = row => finite(row.popularity?.rank ?? row.popularity_rank) ?? 100000;
  source.sort((a, b) => (groupRank[a.catalog_group] - groupRank[b.catalog_group]) ||
    ((b.value_score ?? -Infinity) - (a.value_score ?? -Infinity)) ||
    (popularity(a) - popularity(b)) || String(a.name || a.id).localeCompare(String(b.name || b.id), 'zh-Hans') || String(a.id).localeCompare(String(b.id)));
  source.forEach((row, index) => { row.sort_index = index; });
  return source;
}

function enrichRows(rows, options = {}) {
  const records = options.records instanceof Map ? options.records : mapSourceRecords(options.records || []);
  const enriched = (rows || []).map(row => enrichRow(row, { ...options, records, provider: options.provider || row.provider }));
  return options.sort === false ? enriched : sortRows(enriched, options);
}

function buildPriceFromOpenRouter(model, fx, fxDate, source = 'openrouter') {
  if (!model?.pricing) return null;
  const values = { input: model.pricing.prompt, output: model.pricing.completion, cache_read: model.pricing.input_cache_read, cache_write: model.pricing.input_cache_write };
  if (!Object.values(values).some(hasValue)) return null;
  return normalizedPrice(values, { scale: 1e6, fx, fxDate, fxSource: 'open.er-api.com', source, currency: 'USD' });
}

function buildPriceFromLiteLLM(model, fx, fxDate) {
  if (!model || typeof model !== 'object') return null;
  const values = { input: model.input_cost_per_token, output: model.output_cost_per_token, cache_read: model.cache_read_input_token_cost, cache_write: model.cache_write_input_token_cost };
  if (!Object.values(values).some(hasValue)) return null;
  return normalizedPrice(values, { scale: 1e6, fx, fxDate, fxSource: 'open.er-api.com', source: 'litellm', currency: 'USD' });
}

function buildPriceFromMetadata(model) {
  const currency = model?.cost?.currency_options?.CNY;
  if (currency) {
    const values = { input: currency.input, output: currency.output, cache_read: currency.cache_read, cache_write: currency.cache_write };
    return normalizedPrice(values, { currency: 'CNY', source: 'llm-metadata' });
  }
  const values = model?.cost && { input: model.cost.input, output: model.cost.output, cache_read: model.cost.cache_read, cache_write: model.cost.cache_write };
  return values && Object.values(values).some(hasValue) ? normalizedPrice(values, { scale: 1, source: 'llm-metadata', currency: 'USD', fx: null }) : null;
}

function recordFromMetadata(provider, model, fetchedAt) {
  if (!model) return null;
  const modalities = normalizeModalities(model.modalities?.input, model.modalities?.output);
  return { provider, id: model.id, name: model.name, description: model.description, limit: model.limit,
    context_window: model.limit?.context, output_limit: model.limit?.output, tool_calls: model.tool_call,
    reasoning: model.reasoning, reasoning_options: model.reasoning_options, modalities,
    canonical_model_id: model.canonical_model_id, price: buildPriceFromMetadata(model),
    source: 'llm-metadata', source_url: 'https://basellm.github.io/llm-metadata/api/i18n/zh/all.json', fetched_at: fetchedAt };
}

function recordFromOpenRouter(model, popularityRank, fx, fxDate, fetchedAt) {
  if (!model) return null;
  const modalities = normalizeModalities(model.architecture?.input_modalities, model.architecture?.output_modalities);
  return { provider: 'openrouter', id: model.id, name: model.name, description: model.description,
    context_window: model.context_length, output_limit: model.top_provider?.max_completion_tokens,
    tool_calls: model.supported_parameters?.includes('tools'), reasoning: model.reasoning,
    modalities, canonical_model_id: model.canonical_slug, hugging_face_id: model.hugging_face_id,
    price: buildPriceFromOpenRouter(model, fx, fxDate),
    agent_score: model.benchmarks?.artificial_analysis?.agentic_index == null ? null : { value: model.benchmarks.artificial_analysis.agentic_index, index: 'agentic_index', source: 'Artificial Analysis', url: 'https://artificialanalysis.ai/' },
    popularity: popularityRank ? { rank: popularityRank, source: 'OpenRouter', url: 'https://openrouter.ai/rankings' } : null,
    source: 'openrouter', source_url: 'https://openrouter.ai/api/v1/models', fetched_at: fetchedAt };
}

function loadSnapshot(file = SNAPSHOT_FILE) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

let bundledRecords;
function bundled() {
  if (bundledRecords) return bundledRecords;
  const snapshot = loadSnapshot();
  bundledRecords = mapSourceRecords(snapshot?.models || []);
  return bundledRecords;
}

function enrichBundledRows(rows, options = {}) {
  const records = options.records || bundled();
  return enrichRows(rows, { ...options, records });
}

module.exports = {
  SCHEMA_VERSION, SNAPSHOT_FILE, TYPE_ORDER, cleanText, normalizeModalities, modalityLabels,
  summaryZh, normalizedPrice, roundEstimate, valueScore, exactKey, mapSourceRecords,
  applyRecord, enrichRow, enrichRows, sortRows, buildPriceFromOpenRouter, buildPriceFromLiteLLM,
  buildPriceFromMetadata, recordFromMetadata, recordFromOpenRouter, loadSnapshot, bundled,
  enrichBundledRows,
};
