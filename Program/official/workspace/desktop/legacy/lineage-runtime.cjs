"use strict";

const path = require("node:path");
const {
  closeSync,
  constants: fsConstants,
  copyFileSync,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  writeSync
} = require("node:fs");
const { createHash, randomUUID } = require("node:crypto");
const { Worker } = require("node:worker_threads");
const ExcelJS = require("exceljs");
const PptxGenJS = require("pptxgenjs");
const JSZip = require("jszip");
const sharp = require("sharp");

const LINEAGE_FORMAT_VERSION = 1;
const LINEAGE_REVISION = 1;
const LINEAGE_MUTATION_JOURNAL_FORMAT = "iiimage-lineage-mutation-journal";
const LINEAGE_MUTATION_JOURNAL_VERSION = 2;
const LINEAGE_MUTATION_JOURNAL_FILE = "mutation-journal.json";
const LINEAGE_MUTATION_PHASES = new Set(["prepared", "artifact-writing", "artifacts-committed", "session-writing"]);
const LINEAGE_MUTATION_PHASE_ORDER = Object.freeze({ prepared: 0, "artifact-writing": 1, "artifacts-committed": 2, "session-writing": 3 });
const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
const MAX_SOURCE_HISTORY_ENTRIES = 256;
const MAX_ARTIFACT_BYTES = 48 * 1024 * 1024;
const MAX_OPERATION_OPTIONS_BYTES = 64 * 1024;
const MAX_ARTIFACTS = 2000;
const MAX_EDGES = 8000;
const PREVIEW_MAX_ROWS = 2000;
const PREVIEW_MAX_CELLS = 24000;
const PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
const PREVIEW_CELL_CHARS = 512;
const TABLE_WINDOW_MAX_ROWS = 500;
const TABLE_WINDOW_MAX_COLUMNS = 24;
const TABLE_WINDOW_MAX_BYTES = 1024 * 1024;
const TABLE_WINDOW_MAX_COLUMN_KEY_CHARS = 180;
const TABLE_WINDOW_MAX_REQUEST_BYTES = 24 * 1024;
const MAX_TABLE_ROWS = 100000;
const MAX_TABLE_COLUMNS = 256;
const MAX_TABLE_CELLS = 2000000;
const MAX_CELL_CHARS = 32768;
const MAX_CONTENT_METRICS = 2048;
const MAX_CONTENT_WARNINGS = 2048;
const MAX_CHART_POINTS = 2000;
const MAX_PRESENTATION_SLIDES = 200;
const MAX_SLIDE_BULLETS = 50;
const MAX_REPORT_SECTIONS = 80;
const MAX_REPORT_BLOCKS = 400;
const MAX_REPORT_BLOCK_BULLETS = 50;
const MAX_REPORT_TABLE_COLUMNS = 8;
const MAX_REPORT_TABLE_ROWS = 24;
const MAX_REPORT_TABLE_CELLS = 512;
const MAX_PRESENTATION_TABLE_COLUMNS = 6;
const MAX_PRESENTATION_TABLE_ROWS = 24;
const MAX_PRESENTATION_TABLE_CELLS = 512;
const MAX_REPORT_DOCUMENT_BYTES = 96 * 1024;
const DELIVERY_DECK_STRUCTURE_VERSION = 3;
const MAX_DELIVERY_DECK_AUTHORED_SLIDES = 24;
const MAX_DELIVERY_DECK_RENDERED_PAGES = 72;
const MAX_DELIVERY_DECK_BLOCK_REFS = 3;
const MAX_DELIVERY_DECK_BYTES = 64 * 1024;
const MAX_FINDINGS = 200;
const MAX_MARKDOWN_CHARS = 1000000;
const MAX_HTML_CHARS = 1500000;
const LINEAGE_MUTATION_JOURNAL_MAX_BYTES = 256 * 1024;
const dataArtifactKinds = new Set(["dataset", "clean", "transform", "analysis", "chart", "report", "presentation"]);
const financeArtifactKinds = new Set(["market-data", "financial-statement", "valuation", "portfolio", "scenario-workbook", "risk-review", "finance-report"]);
const lineageProjectKinds = new Set(["data", "finance"]);
const importExtensions = new Set([".csv", ".tsv", ".json", ".xlsx"]);
const financeImportKinds = new Set(["market-data", "financial-statement", "portfolio"]);

const operationKind = Object.freeze({
  clean: "clean",
  transform: "transform",
  analysis: "analysis",
  chart: "chart",
  report: "report",
  presentation: "presentation",
  valuation: "valuation",
  portfolio: "portfolio",
  "scenario-workbook": "scenario-workbook",
  "risk-review": "risk-review",
  "finance-report": "finance-report"
});

const sourceRules = Object.freeze({
  data: {
    clean: { minimum: 1, maximum: 1, allowed: new Set(["dataset", "clean", "transform"]) },
    transform: { minimum: 1, maximum: 2, allowed: new Set(["dataset", "clean", "transform"]) },
    analysis: { minimum: 1, maximum: 1, allowed: new Set(["dataset", "clean", "transform"]) },
    chart: { minimum: 1, maximum: 1, allowed: new Set(["dataset", "clean", "transform"]) },
    report: { minimum: 1, maximum: 24, allowed: new Set(["analysis", "chart"]) },
    presentation: { minimum: 1, maximum: 24, allowed: new Set(["report", "chart"]) }
  },
  finance: {
    valuation: { minimum: 1, maximum: 1, allowed: new Set(["market-data", "financial-statement"]) },
    portfolio: { minimum: 1, maximum: 1, allowed: new Set(["market-data", "portfolio"]) },
    "scenario-workbook": { minimum: 2, maximum: 12, allowed: new Set(["valuation", "portfolio"]) },
    "risk-review": { minimum: 1, maximum: 24, allowed: new Set(["valuation", "portfolio"]) },
    "finance-report": { minimum: 1, maximum: 24, allowed: new Set(["financial-statement", "valuation", "portfolio", "risk-review"]) }
  }
});

const sourceKindsByTargetKind = Object.freeze({
  clean: sourceRules.data.clean.allowed,
  transform: sourceRules.data.transform.allowed,
  analysis: sourceRules.data.analysis.allowed,
  chart: sourceRules.data.chart.allowed,
  report: sourceRules.data.report.allowed,
  presentation: sourceRules.data.presentation.allowed,
  valuation: sourceRules.finance.valuation.allowed,
  portfolio: sourceRules.finance.portfolio.allowed,
  "scenario-workbook": sourceRules.finance["scenario-workbook"].allowed,
  "risk-review": sourceRules.finance["risk-review"].allowed,
  "finance-report": sourceRules.finance["finance-report"].allowed
});

const dataStaleRecoveryOperationByKind = Object.freeze({
  clean: "clean",
  transform: "transform",
  analysis: "analysis",
  chart: "chart",
  report: "report",
  presentation: "presentation"
});
const MAX_DATA_STALE_RECOVERY_STEPS = 20;

const operationOptionKeys = Object.freeze({
  clean: new Set(["trimStrings", "removeEmptyRows", "deduplicate"]),
  transform: new Set([
    "mode",
    "columns", "filterColumn", "filterValue", "sortColumn", "sortDirection", "limit",
    "computedColumns",
    "groupBy", "aggregations",
    "rowKeys", "pivotColumn", "valueColumn", "aggregation",
    "leftKey", "rightKey", "joinType", "rightPrefix"
  ]),
  analysis: new Set(),
  chart: new Set(["xColumn", "yColumn", "chartType", "title", "unit"]),
  report: new Set(["title", "template"]),
  presentation: new Set(["title", "subtitle", "template"]),
  valuation: new Set(["revenueColumn", "netIncomeColumn", "sharesColumn", "priceColumn"]),
  portfolio: new Set(["symbolColumn", "quantityColumn", "priceColumn", "costColumn"]),
  "scenario-workbook": new Set(["title", "metricKey", "upsidePercent", "stressPercent"]),
  "risk-review": new Set(),
  "finance-report": new Set(["title"])
});

const dataDeliveryTemplates = new Set(["standard", "executive", "research"]);
const financeContextIdentityKeys = Object.freeze(["asOf", "sourceName", "sourceUrl", "currency", "unit", "timezone"]);
const financeScenarioComparableKeys = Object.freeze(["asOf", "currency", "unit", "timezone"]);
const financeMetricScaleByUnit = Object.freeze({
  "1": 1,
  base: 1,
  one: 1,
  ones: 1,
  unit: 1,
  units: 1,
  yuan: 1,
  "元": 1,
  thousand: 1_000,
  thousands: 1_000,
  "千": 1_000,
  "千元": 1_000,
  "万": 10_000,
  "万元": 10_000,
  million: 1_000_000,
  millions: 1_000_000,
  "百万": 1_000_000,
  "百万元": 1_000_000,
  "亿": 100_000_000,
  "亿元": 100_000_000,
  billion: 1_000_000_000,
  billions: 1_000_000_000,
  "十亿元": 1_000_000_000
});
const controlledFinanceMetricScales = new Set(Object.values(financeMetricScaleByUnit));
const financeScenarioMetricPolicies = Object.freeze({
  marketCap: Object.freeze({ direction: "higher-is-upside", scenarioRule: "relative-linear" }),
  marketValue: Object.freeze({ direction: "higher-is-upside", scenarioRule: "relative-linear" })
});
const financeScenarioLimitations = Object.freeze([
  "V1 不执行汇率、单位、时区或估值口径转换；不一致来源会被拒绝。",
  "V1 不接入实时行情、网页抓取、券商账户或交易执行。",
  "乐观与压力情景是明确假设，不是预测、目标价、收益承诺或买卖建议。"
]);
const financeScenarioFixedRisks = Object.freeze([
  "情景仅按受控百分比线性调整共同指标，未建模相关性、流动性或尾部事件。",
  "来源可能延迟或不完整，任何结论都必须结合原始 artifact 复核。"
]);

function cleanOneLine(value, maximum = 240) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function finiteDataNumber(value) {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function assertPlainDataObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} 必须是普通对象。`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} 必须是普通对象。`);
  if (Object.getOwnPropertySymbols(value).length) throw new Error(`${label} 不得包含 Symbol 字段。`);
  const names = Object.getOwnPropertyNames(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const name of names) {
    const descriptor = descriptors[name];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw new Error(`${label}.${name} 必须是普通数据字段。`);
  }
  return value;
}

function assertDenseDataArray(value, maximum, label, minimum = 0) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length) {
    throw new Error(`${label} 必须是数组。`);
  }
  if (!Number.isSafeInteger(value.length) || value.length < minimum || value.length > maximum) {
    throw new Error(`${label} 必须包含 ${minimum}-${maximum} 项。`);
  }
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== value.length + 1 || names[names.length - 1] !== "length") throw new Error(`${label} 必须是无额外字段的稠密数组。`);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw new Error(`${label}[${index}] 必须是普通数据项。`);
  }
  return value;
}

function boundedContentText(value, maximum, label, options = {}) {
  if (typeof value !== "string") throw new Error(`${label} 必须是字符串。`);
  if (value.length > maximum || value.includes("\u0000")) throw new Error(`${label} 超过长度限制或包含 NUL。`);
  if (options.nonempty && !value) throw new Error(`${label} 不能为空。`);
  return value;
}

function safeContentInteger(value, maximum, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new Error(`${label} 必须是 0-${maximum} 的安全整数。`);
  return value;
}

function validateContentStringArray(value, maximumItems, maximumChars, label, options = {}) {
  const items = assertDenseDataArray(value, maximumItems, label, options.minimum || 0);
  return items.map((item, index) => boundedContentText(item, maximumChars, `${label}[${index}]`, { nonempty: options.nonemptyItems === true }));
}

function validateLineageWarnings(value, label = "Lineage content.warnings") {
  return validateContentStringArray(value, MAX_CONTENT_WARNINGS, 1000, label);
}

function validateLineageTable(value, label = "Lineage content.table") {
  const table = assertPlainDataObject(value, label);
  const allowed = new Set(["sheetName", "sheetNames", "columns", "rows", "totalRows", "totalColumns", "warnings"]);
  assertOnlyKeys(table, allowed, label);
  for (const key of allowed) if (!Object.hasOwn(table, key)) throw new Error(`${label}.${key} 缺失。`);
  const sheetName = boundedContentText(table.sheetName, 160, `${label}.sheetName`, { nonempty: true });
  const sheetNames = validateContentStringArray(table.sheetNames, 128, 160, `${label}.sheetNames`, { minimum: 1, nonemptyItems: true });
  if (new Set(sheetNames).size !== sheetNames.length || !sheetNames.includes(sheetName)) throw new Error(`${label}.sheetNames 必须唯一并包含当前 sheetName。`);
  const rows = assertDenseDataArray(table.rows, MAX_TABLE_ROWS, `${label}.rows`);
  const columns = assertDenseDataArray(table.columns, MAX_TABLE_COLUMNS, `${label}.columns`);
  const columnKeys = new Set();
  for (const [index, candidate] of columns.entries()) {
    const columnLabel = `${label}.columns[${index}]`;
    const column = assertPlainDataObject(candidate, columnLabel);
    assertOnlyKeys(column, new Set(["key", "label", "type", "nullable", "missingCount", "distinctCount"]), columnLabel);
    for (const key of ["key", "label", "type", "nullable", "missingCount"]) {
      if (!Object.hasOwn(column, key)) throw new Error(`${columnLabel}.${key} 缺失。`);
    }
    const key = boundedContentText(column.key, 180, `${columnLabel}.key`, { nonempty: true });
    if (!/^[\p{L}\p{N}_-]+$/u.test(key) || key === "." || key === ".." || columnKeys.has(key)) throw new Error(`${columnLabel}.key 非法或重复。`);
    columnKeys.add(key);
    boundedContentText(column.label, 160, `${columnLabel}.label`, { nonempty: true });
    if (!["string", "number", "boolean", "date", "mixed", "empty"].includes(column.type)) throw new Error(`${columnLabel}.type 无效。`);
    if (typeof column.nullable !== "boolean") throw new Error(`${columnLabel}.nullable 必须是布尔值。`);
    safeContentInteger(column.missingCount, rows.length, `${columnLabel}.missingCount`);
    if (Object.hasOwn(column, "distinctCount")) safeContentInteger(column.distinctCount, rows.length, `${columnLabel}.distinctCount`);
  }
  for (const [rowIndex, candidate] of rows.entries()) {
    const rowLabel = `${label}.rows[${rowIndex}]`;
    const row = assertPlainDataObject(candidate, rowLabel);
    for (const key of Object.keys(row)) {
      if (!columnKeys.has(key)) throw new Error(`${rowLabel} 包含未声明列：${key}`);
      const cell = row[key];
      if (cell === null || typeof cell === "boolean") continue;
      if (typeof cell === "number" && Number.isFinite(cell)) continue;
      if (typeof cell === "string" && cell.length <= MAX_CELL_CHARS && !cell.includes("\u0000")) continue;
      throw new Error(`${rowLabel}.${key} 单元格类型或大小无效。`);
    }
  }
  const totalRows = safeContentInteger(table.totalRows, MAX_TABLE_ROWS, `${label}.totalRows`);
  const totalColumns = safeContentInteger(table.totalColumns, MAX_TABLE_COLUMNS, `${label}.totalColumns`);
  if (totalRows !== rows.length || totalColumns !== columns.length) throw new Error(`${label} totalRows/totalColumns 必须与完整表格一致。`);
  if (totalRows * totalColumns > MAX_TABLE_CELLS) throw new Error(`${label} 超过 ${MAX_TABLE_CELLS} 个单元格的安全预算。`);
  validateLineageWarnings(table.warnings, `${label}.warnings`);
  return table;
}

function validateLineageMetrics(value, label = "Lineage content.metrics") {
  const metrics = assertDenseDataArray(value, MAX_CONTENT_METRICS, label);
  for (const [index, candidate] of metrics.entries()) {
    const metricLabel = `${label}[${index}]`;
    const metric = assertPlainDataObject(candidate, metricLabel);
    assertOnlyKeys(metric, new Set(["key", "label", "value", "unit", "note", "measure", "scale"]), metricLabel);
    for (const key of ["key", "label", "value"]) if (!Object.hasOwn(metric, key)) throw new Error(`${metricLabel}.${key} 缺失。`);
    boundedContentText(metric.key, 240, `${metricLabel}.key`, { nonempty: true });
    boundedContentText(metric.label, 240, `${metricLabel}.label`, { nonempty: true });
    if (!(typeof metric.value === "number" && Number.isFinite(metric.value)) && typeof metric.value !== "string") throw new Error(`${metricLabel}.value 必须是有限数字或字符串。`);
    if (typeof metric.value === "string") boundedContentText(metric.value, MAX_CELL_CHARS, `${metricLabel}.value`);
    if (Object.hasOwn(metric, "unit")) boundedContentText(metric.unit, 80, `${metricLabel}.unit`);
    if (Object.hasOwn(metric, "note")) boundedContentText(metric.note, 2000, `${metricLabel}.note`);
    const hasMeasure = Object.hasOwn(metric, "measure");
    const hasScale = Object.hasOwn(metric, "scale");
    if (hasMeasure !== hasScale || (hasMeasure && !Object.hasOwn(metric, "unit"))) throw new Error(`${metricLabel} 语义必须同时包含 measure、unit 与 scale。`);
    if (hasMeasure) {
      if (!Object.hasOwn(financeScenarioMetricPolicies, metric.key)) throw new Error(`${metricLabel}.key 不支持受控 Finance metric 语义。`);
      if (boundedContentText(metric.measure, 80, `${metricLabel}.measure`, { nonempty: true }) !== "market-value") throw new Error(`${metricLabel}.measure 无效。`);
      if (typeof metric.value !== "number") throw new Error(`${metricLabel}.value 使用 Finance metric 语义时必须是有限数字。`);
      boundedContentText(metric.unit, 80, `${metricLabel}.unit`, { nonempty: true });
      if (!Number.isSafeInteger(metric.scale) || !controlledFinanceMetricScales.has(metric.scale)) throw new Error(`${metricLabel}.scale 不是受控 Finance 数值尺度。`);
    }
  }
  return metrics;
}

function validateLineageColumnProfiles(value, label = "Lineage content.columnProfiles") {
  const profiles = assertDenseDataArray(value, MAX_TABLE_COLUMNS, label);
  const numericKeys = new Set(["min", "max", "mean", "median", "p25", "p75"]);
  for (const [index, candidate] of profiles.entries()) {
    const profileLabel = `${label}[${index}]`;
    const profile = assertPlainDataObject(candidate, profileLabel);
    assertOnlyKeys(profile, new Set(["key", "label", "type", "count", "missing", "distinct", ...numericKeys]), profileLabel);
    for (const key of ["key", "label", "type", "count", "missing", "distinct"]) if (!Object.hasOwn(profile, key)) throw new Error(`${profileLabel}.${key} 缺失。`);
    const key = boundedContentText(profile.key, 180, `${profileLabel}.key`, { nonempty: true });
    if (!/^[\p{L}\p{N}_-]+$/u.test(key)) throw new Error(`${profileLabel}.key 无效。`);
    boundedContentText(profile.label, 160, `${profileLabel}.label`, { nonempty: true });
    if (!["string", "number", "boolean", "date", "mixed", "empty"].includes(profile.type)) throw new Error(`${profileLabel}.type 无效。`);
    const count = safeContentInteger(profile.count, MAX_TABLE_ROWS, `${profileLabel}.count`);
    const missing = safeContentInteger(profile.missing, count, `${profileLabel}.missing`);
    const distinct = safeContentInteger(profile.distinct, count - missing, `${profileLabel}.distinct`);
    void distinct;
    for (const numericKey of numericKeys) {
      if (Object.hasOwn(profile, numericKey) && !(typeof profile[numericKey] === "number" && Number.isFinite(profile[numericKey]))) throw new Error(`${profileLabel}.${numericKey} 必须是有限数字。`);
    }
  }
  return profiles;
}

function validateLineageChart(value, label = "Lineage content.chart") {
  const chart = assertPlainDataObject(value, label);
  assertOnlyKeys(chart, new Set(["chartType", "title", "xColumn", "yColumn", "unit", "categories", "values", "accessibleDescription"]), label);
  for (const key of ["chartType", "title", "xColumn", "yColumn", "categories", "values", "accessibleDescription"]) if (!Object.hasOwn(chart, key)) throw new Error(`${label}.${key} 缺失。`);
  if (!["bar", "line", "area", "scatter"].includes(chart.chartType)) throw new Error(`${label}.chartType 无效。`);
  boundedContentText(chart.title, 240, `${label}.title`, { nonempty: true });
  for (const key of ["xColumn", "yColumn"]) {
    const columnKey = boundedContentText(chart[key], 180, `${label}.${key}`, { nonempty: true });
    if (!/^[\p{L}\p{N}_-]+$/u.test(columnKey)) throw new Error(`${label}.${key} 无效。`);
  }
  if (Object.hasOwn(chart, "unit")) boundedContentText(chart.unit, 80, `${label}.unit`);
  const categories = validateContentStringArray(chart.categories, MAX_CHART_POINTS, 120, `${label}.categories`, { minimum: 1, nonemptyItems: true });
  const values = assertDenseDataArray(chart.values, MAX_CHART_POINTS, `${label}.values`, 1);
  if (categories.length !== values.length) throw new Error(`${label}.categories 与 values 必须同长。`);
  for (const [index, item] of values.entries()) if (!(typeof item === "number" && Number.isFinite(item))) throw new Error(`${label}.values[${index}] 必须是有限数字。`);
  boundedContentText(chart.accessibleDescription, 2000, `${label}.accessibleDescription`, { nonempty: true });
  return chart;
}

const defaultPresentationChartFormat = Object.freeze({
  legend: "none", dataLabels: "none", axes: "both", palette: "theme", placement: "auto"
});

function validatePresentationChartFormat(value, label = "Presentation chartFormat") {
  const format = assertPlainDataObject(value, label);
  const keys = ["legend", "dataLabels", "axes", "palette", "placement"];
  assertOnlyKeys(format, new Set(keys), label);
  for (const key of keys) if (!Object.hasOwn(format, key)) throw new Error(`${label}.${key} 缺失。`);
  if (!["none", "bottom", "right"].includes(format.legend)) throw new Error(`${label}.legend 无效。`);
  if (!["none", "value"].includes(format.dataLabels)) throw new Error(`${label}.dataLabels 无效。`);
  if (!["both", "category", "value", "none"].includes(format.axes)) throw new Error(`${label}.axes 无效。`);
  if (!["theme", "categorical", "sequential", "diverging"].includes(format.palette)) throw new Error(`${label}.palette 无效。`);
  if (!["auto", "full", "left", "right"].includes(format.placement)) throw new Error(`${label}.placement 无效。`);
  return format;
}

function validatePresentationTableRef(value, label = "Presentation tableRef") {
  const ref = assertPlainDataObject(value, label);
  assertOnlyKeys(ref, new Set(["reportArtifactId", "tableBlockId", "columnIds", "placement"]), label);
  for (const key of ["reportArtifactId", "tableBlockId", "columnIds", "placement"]) if (!Object.hasOwn(ref, key)) throw new Error(`${label}.${key} 缺失。`);
  strictLineageId(ref.reportArtifactId, `${label}.reportArtifactId`);
  strictLineageId(ref.tableBlockId, `${label}.tableBlockId`);
  const columnIds = assertDenseDataArray(ref.columnIds, MAX_PRESENTATION_TABLE_COLUMNS, `${label}.columnIds`, 1);
  const known = new Set();
  for (const [index, value] of columnIds.entries()) {
    const id = strictLineageId(value, `${label}.columnIds[${index}]`);
    if (known.has(id)) throw new Error(`${label}.columnIds 重复。`);
    known.add(id);
  }
  if (ref.placement !== "full") throw new Error(`${label}.placement 仅支持 full。`);
  return ref;
}

function validatePresentationTableSnapshot(value, label = "Presentation table") {
  const table = assertPlainDataObject(value, label);
  assertOnlyKeys(table, new Set(["reportArtifactId", "reportRevision", "reportSha256", "tableBlockId", "caption", "columns", "rows"]), label);
  for (const key of ["reportArtifactId", "reportRevision", "reportSha256", "tableBlockId", "caption", "columns", "rows"]) if (!Object.hasOwn(table, key)) throw new Error(`${label}.${key} 缺失。`);
  strictLineageId(table.reportArtifactId, `${label}.reportArtifactId`);
  strictLineageId(table.tableBlockId, `${label}.tableBlockId`);
  if (!Number.isSafeInteger(table.reportRevision) || table.reportRevision < 1) throw new Error(`${label}.reportRevision 无效。`);
  if (!/^[a-f0-9]{64}$/.test(String(table.reportSha256 || ""))) throw new Error(`${label}.reportSha256 无效。`);
  boundedContentText(table.caption, 240, `${label}.caption`, { nonempty: true });
  const columns = assertDenseDataArray(table.columns, MAX_PRESENTATION_TABLE_COLUMNS, `${label}.columns`, 1);
  const columnIds = new Set();
  for (const [index, value] of columns.entries()) {
    const columnLabel = `${label}.columns[${index}]`;
    const column = assertPlainDataObject(value, columnLabel);
    assertOnlyKeys(column, new Set(["id", "label", "align"]), columnLabel);
    for (const key of ["id", "label", "align"]) if (!Object.hasOwn(column, key)) throw new Error(`${columnLabel}.${key} 缺失。`);
    const id = strictLineageId(column.id, `${columnLabel}.id`);
    if (columnIds.has(id)) throw new Error(`${label}.columns.id 重复。`);
    columnIds.add(id);
    boundedContentText(column.label, 120, `${columnLabel}.label`, { nonempty: true });
    if (!["left", "center", "right"].includes(column.align)) throw new Error(`${columnLabel}.align 无效。`);
  }
  const rows = assertDenseDataArray(table.rows, MAX_PRESENTATION_TABLE_ROWS, `${label}.rows`, 1);
  const rowIds = new Set();
  for (const [index, value] of rows.entries()) {
    const rowLabel = `${label}.rows[${index}]`;
    const row = assertPlainDataObject(value, rowLabel);
    assertOnlyKeys(row, new Set(["id", "cells"]), rowLabel);
    for (const key of ["id", "cells"]) if (!Object.hasOwn(row, key)) throw new Error(`${rowLabel}.${key} 缺失。`);
    const id = strictLineageId(row.id, `${rowLabel}.id`);
    if (rowIds.has(id)) throw new Error(`${label}.rows.id 重复。`);
    rowIds.add(id);
    const cells = assertDenseDataArray(row.cells, MAX_PRESENTATION_TABLE_COLUMNS, `${rowLabel}.cells`);
    if (cells.length !== columns.length) throw new Error(`${rowLabel}.cells 必须与 columns 等宽。`);
    for (const [cellIndex, cell] of cells.entries()) boundedContentText(cell, 240, `${rowLabel}.cells[${cellIndex}]`);
  }
  return table;
}

function validateDeliveryCitation(value, label = "Delivery citation") {
  const citation = assertPlainDataObject(value, label);
  assertOnlyKeys(citation, new Set(["reportArtifactId", "reportRevision", "reportSha256", "blockIds"]), label);
  for (const key of ["reportArtifactId", "reportRevision", "reportSha256", "blockIds"]) if (!Object.hasOwn(citation, key)) throw new Error(`${label}.${key} 缺失。`);
  strictLineageId(citation.reportArtifactId, `${label}.reportArtifactId`);
  if (!Number.isSafeInteger(citation.reportRevision) || citation.reportRevision < 1) throw new Error(`${label}.reportRevision 无效。`);
  if (!/^[a-f0-9]{64}$/.test(String(citation.reportSha256 || ""))) throw new Error(`${label}.reportSha256 无效。`);
  const ids = assertDenseDataArray(citation.blockIds, MAX_DELIVERY_DECK_BLOCK_REFS, `${label}.blockIds`);
  const known = new Set();
  for (const [index, value] of ids.entries()) {
    const id = strictLineageId(value, `${label}.blockIds[${index}]`);
    if (known.has(id)) throw new Error(`${label}.blockIds 重复。`);
    known.add(id);
  }
  return citation;
}

function validateDeliveryResolvedBlock(value, label = "Delivery resolvedBlock") {
  const block = assertPlainDataObject(value, label);
  const fields = {
    paragraph: ["id", "type", "text"],
    bullets: ["id", "type", "items"],
    metrics: ["id", "type", "metrics"],
    sources: ["id", "type", "inputArtifactIds"],
    callout: ["id", "type", "tone", "title", "text"]
  };
  if (!fields[block.type]) throw new Error(`${label}.type 无效。`);
  assertOnlyKeys(block, new Set(fields[block.type]), label);
  strictLineageId(block.id, `${label}.id`);
  for (const key of fields[block.type]) if (!Object.hasOwn(block, key)) throw new Error(`${label}.${key} 缺失。`);
  if (block.type === "paragraph") boundedContentText(block.text, 10000, `${label}.text`, { nonempty: true });
  if (block.type === "bullets") validateContentStringArray(block.items, MAX_REPORT_BLOCK_BULLETS, 2000, `${label}.items`, { minimum: 1, nonemptyItems: true });
  if (block.type === "metrics") {
    const metrics = assertDenseDataArray(block.metrics, MAX_CONTENT_METRICS, `${label}.metrics`, 1);
    for (const [index, metric] of metrics.entries()) validateLineageMetrics([metric], `${label}.metrics[${index}]`);
  }
  if (block.type === "sources") {
    const ids = assertDenseDataArray(block.inputArtifactIds, 24, `${label}.inputArtifactIds`, 1);
    for (const [index, id] of ids.entries()) strictLineageId(id, `${label}.inputArtifactIds[${index}]`);
  }
  if (block.type === "callout") {
    if (!["note", "insight", "warning"].includes(block.tone)) throw new Error(`${label}.tone 无效。`);
    boundedContentText(block.title, 160, `${label}.title`, { nonempty: true });
    boundedContentText(block.text, 4000, `${label}.text`, { nonempty: true });
  }
  return block;
}

function validateDeliveryDeckSlides(value, label = "Presentation delivery slides", allowStored = true) {
  const slides = assertDenseDataArray(value, MAX_DELIVERY_DECK_AUTHORED_SLIDES, label, 1);
  const ids = new Set();
  for (const [index, candidate] of slides.entries()) {
    const slideLabel = `${label}[${index}]`;
    const slide = assertPlainDataObject(candidate, slideLabel);
    const base = ["id", "type", "title", "speakerNotes"];
    const fields = {
      cover: ["subtitle"],
      "report-blocks": ["blockIds"],
      chart: ["reportBlockId", "chartFormat"],
      table: ["tableRef"],
      provenance: []
    };
    if (!fields[slide.type]) throw new Error(`${slideLabel}.type 无效。`);
    const stored = allowStored ? ["resolvedBlocks", "chart", "table", "citation"] : [];
    const allowedBase = slide.type === "cover" ? base : base.filter((key) => key !== "subtitle");
    assertOnlyKeys(slide, new Set([...allowedBase, ...fields[slide.type], ...stored]), slideLabel);
    for (const key of ["id", "type"]) if (!Object.hasOwn(slide, key)) throw new Error(`${slideLabel}.${key} 缺失。`);
    if (slide.type === "cover" && !Object.hasOwn(slide, "title")) throw new Error(`${slideLabel}.title 缺失。`);
    const id = strictLineageId(slide.id, `${slideLabel}.id`);
    if (ids.has(id)) throw new Error(`${slideLabel}.id 重复。`);
    ids.add(id);
    if (Object.hasOwn(slide, "title")) boundedContentText(slide.title, 240, `${slideLabel}.title`, { nonempty: true });
    if (Object.hasOwn(slide, "subtitle")) boundedContentText(slide.subtitle, 240, `${slideLabel}.subtitle`, { nonempty: true });
    if (Object.hasOwn(slide, "speakerNotes")) boundedContentText(slide.speakerNotes, 10000, `${slideLabel}.speakerNotes`);
    if (slide.type === "report-blocks") {
      const blockIds = assertDenseDataArray(slide.blockIds, MAX_DELIVERY_DECK_BLOCK_REFS, `${slideLabel}.blockIds`, 1);
      const known = new Set();
      for (const [blockIndex, value] of blockIds.entries()) {
        const blockId = strictLineageId(value, `${slideLabel}.blockIds[${blockIndex}]`);
        if (known.has(blockId)) throw new Error(`${slideLabel}.blockIds 重复。`);
        known.add(blockId);
      }
    }
    if (slide.type === "chart") {
      strictLineageId(slide.reportBlockId, `${slideLabel}.reportBlockId`);
      validatePresentationChartFormat(slide.chartFormat, `${slideLabel}.chartFormat`);
    }
    if (slide.type === "table") validatePresentationTableRef(slide.tableRef, `${slideLabel}.tableRef`);
    if (allowStored) {
      if (!Object.hasOwn(slide, "citation")) throw new Error(`${slideLabel}.citation 缺少受控快照。`);
      validateDeliveryCitation(slide.citation, `${slideLabel}.citation`);
      if (slide.type === "report-blocks" || slide.type === "provenance") {
        const blocks = assertDenseDataArray(slide.resolvedBlocks, MAX_DELIVERY_DECK_BLOCK_REFS, `${slideLabel}.resolvedBlocks`, slide.type === "report-blocks" ? 1 : 0);
        for (const [blockIndex, block] of blocks.entries()) validateDeliveryResolvedBlock(block, `${slideLabel}.resolvedBlocks[${blockIndex}]`);
      } else if (Object.hasOwn(slide, "resolvedBlocks")) throw new Error(`${slideLabel}.resolvedBlocks 不适用于 ${slide.type}。`);
      if (slide.type === "chart") validateLineageChart(slide.chart, `${slideLabel}.chart`);
      else if (Object.hasOwn(slide, "chart")) throw new Error(`${slideLabel}.chart 不适用于 ${slide.type}。`);
      if (slide.type === "table") validatePresentationTableSnapshot(slide.table, `${slideLabel}.table`);
      else if (Object.hasOwn(slide, "table")) throw new Error(`${slideLabel}.table 不适用于 ${slide.type}。`);
      if (slide.type === "cover" && slide.citation.blockIds.length !== 0) throw new Error(`${slideLabel}.citation.blockIds 必须为空。`);
      if (slide.type === "report-blocks" && JSON.stringify(slide.citation.blockIds) !== JSON.stringify(slide.blockIds)) throw new Error(`${slideLabel}.citation.blockIds 必须与 blockIds 一致。`);
      if (slide.type === "chart" && (slide.citation.blockIds.length !== 1 || slide.citation.blockIds[0] !== slide.reportBlockId)) throw new Error(`${slideLabel}.citation.blockIds 必须精确绑定 reportBlockId。`);
      if (slide.type === "table" && (slide.citation.blockIds.length !== 1 || slide.citation.blockIds[0] !== slide.tableRef.tableBlockId)) throw new Error(`${slideLabel}.citation.blockIds 必须精确绑定 tableBlockId。`);
      if (slide.type === "provenance" && JSON.stringify(slide.citation.blockIds) !== JSON.stringify(slide.resolvedBlocks.map((block) => block.id))) throw new Error(`${slideLabel}.citation.blockIds 必须与 provenance resolvedBlocks 一致。`);
    }
  }
  return slides;
}

function validateDeliveryDeck(value, label = "Presentation delivery deck", allowStored = true) {
  const deck = assertPlainDataObject(value, label);
  assertOnlyKeys(deck, new Set(["structureVersion", "theme", "reportRef", "slides"]), label);
  for (const key of ["structureVersion", "theme", "reportRef", "slides"]) if (!Object.hasOwn(deck, key)) throw new Error(`${label}.${key} 缺失。`);
  if (deck.structureVersion !== DELIVERY_DECK_STRUCTURE_VERSION) throw new Error(`${label}.structureVersion 必须为 ${DELIVERY_DECK_STRUCTURE_VERSION}。`);
  if (!["paper", "midnight", "slate"].includes(deck.theme)) throw new Error(`${label}.theme 无效。`);
  const reportRef = assertPlainDataObject(deck.reportRef, `${label}.reportRef`);
  assertOnlyKeys(reportRef, new Set(["reportArtifactId"]), `${label}.reportRef`);
  strictLineageId(reportRef.reportArtifactId, `${label}.reportRef.reportArtifactId`);
  const slides = validateDeliveryDeckSlides(deck.slides, `${label}.slides`, allowStored);
  const authoredProjection = {
    structureVersion: deck.structureVersion,
    theme: deck.theme,
    reportRef: deck.reportRef,
    slides: deck.slides.map(({ resolvedBlocks: _resolvedBlocks, chart: _chart, table: _table, citation: _citation, ...slide }) => slide)
  };
  if (Buffer.byteLength(JSON.stringify(authoredProjection), "utf8") > MAX_DELIVERY_DECK_BYTES) throw new Error(`${label} authored 引用结构超过 64 KiB 安全上限。`);
  return { ...deck, slides };
}

function validateLineageSlides(value, label = "Lineage content.slides", allowStoredSnapshots = true) {
  const slides = assertDenseDataArray(value, MAX_PRESENTATION_SLIDES, label, 1);
  const ids = new Set();
  let tableCellCount = 0;
  for (const [index, candidate] of slides.entries()) {
    const slideLabel = `${label}[${index}]`;
    const slide = assertPlainDataObject(candidate, slideLabel);
    assertOnlyKeys(slide, new Set(["id", "title", "bullets", "speakerNotes", "chartArtifactId", "chartFormat", "tableRef", ...(allowStoredSnapshots ? ["chart", "table"] : [])]), slideLabel);
    for (const key of ["id", "title", "bullets"]) if (!Object.hasOwn(slide, key)) throw new Error(`${slideLabel}.${key} 缺失。`);
    const id = strictLineageId(slide.id, `${slideLabel}.id`);
    if (ids.has(id)) throw new Error(`${slideLabel}.id 重复。`);
    ids.add(id);
    boundedContentText(slide.title, 240, `${slideLabel}.title`, { nonempty: true });
    validateContentStringArray(slide.bullets, MAX_SLIDE_BULLETS, 1000, `${slideLabel}.bullets`);
    if (Object.hasOwn(slide, "speakerNotes")) boundedContentText(slide.speakerNotes, 10000, `${slideLabel}.speakerNotes`);
    if (Object.hasOwn(slide, "chartArtifactId")) strictLineageId(slide.chartArtifactId, `${slideLabel}.chartArtifactId`);
    if (Object.hasOwn(slide, "chartFormat")) validatePresentationChartFormat(slide.chartFormat, `${slideLabel}.chartFormat`);
    if (Object.hasOwn(slide, "chart")) {
      validateLineageChart(slide.chart, `${slideLabel}.chart`);
    } else if (allowStoredSnapshots && Object.hasOwn(slide, "chartArtifactId")) throw new Error(`${slideLabel}.chartArtifactId 缺少受控 chart 快照。`);
    if (Object.hasOwn(slide, "chartFormat") && !Object.hasOwn(slide, "chartArtifactId") && !Object.hasOwn(slide, "chart")) throw new Error(`${slideLabel}.chartFormat 缺少 chart 引用。`);
    if (Object.hasOwn(slide, "tableRef")) {
      const ref = validatePresentationTableRef(slide.tableRef, `${slideLabel}.tableRef`);
      if (slide.bullets.length) throw new Error(`${slideLabel}.tableRef 页面不能同时包含 bullets。`);
      if (["chartArtifactId", "chartFormat", "chart"].some((key) => Object.hasOwn(slide, key))) throw new Error(`${slideLabel}.tableRef 页面不能同时包含 chart。`);
      if (allowStoredSnapshots && !Object.hasOwn(slide, "table")) throw new Error(`${slideLabel}.tableRef 缺少受控 table 快照。`);
      if (Object.hasOwn(slide, "table")) {
        const table = validatePresentationTableSnapshot(slide.table, `${slideLabel}.table`);
        if (table.reportArtifactId !== ref.reportArtifactId || table.tableBlockId !== ref.tableBlockId) throw new Error(`${slideLabel}.table 与 tableRef 身份不一致。`);
        if (JSON.stringify(table.columns.map((column) => column.id)) !== JSON.stringify(ref.columnIds)) throw new Error(`${slideLabel}.table 列与 tableRef 不一致。`);
        tableCellCount += table.columns.length * table.rows.length;
        if (tableCellCount > MAX_PRESENTATION_TABLE_CELLS) throw new Error(`${label} 表格单元格超过安全上限。`);
      }
    } else if (Object.hasOwn(slide, "table")) throw new Error(`${slideLabel}.table 缺少 tableRef。`);
  }
  return slides;
}

function validateReportDocument(value, label = "Lineage content.document") {
  const document = assertPlainDataObject(value, label);
  assertOnlyKeys(document, new Set(["structureVersion", "title", "sections"]), label);
  for (const key of ["structureVersion", "title", "sections"]) if (!Object.hasOwn(document, key)) throw new Error(`${label}.${key} 缺失。`);
  if (![1, 2].includes(document.structureVersion)) throw new Error(`${label}.structureVersion 必须为 1 或 2。`);
  boundedContentText(document.title, 240, `${label}.title`, { nonempty: true });
  const sections = assertDenseDataArray(document.sections, MAX_REPORT_SECTIONS, `${label}.sections`, 1);
  const sectionIds = new Set();
  let blockCount = 0;
  const blockIds = new Set();
  let tableCellCount = 0;
  for (const [sectionIndex, candidate] of sections.entries()) {
    const sectionLabel = `${label}.sections[${sectionIndex}]`;
    const section = assertPlainDataObject(candidate, sectionLabel);
    assertOnlyKeys(section, new Set(["id", "role", "heading", "blocks"]), sectionLabel);
    for (const key of ["id", "role", "heading", "blocks"]) if (!Object.hasOwn(section, key)) throw new Error(`${sectionLabel}.${key} 缺失。`);
    const id = strictLineageId(section.id, `${sectionLabel}.id`);
    if (sectionIds.has(id)) throw new Error(`${sectionLabel}.id 重复。`);
    sectionIds.add(id);
    if (!["scope", "findings", "limitations", "custom"].includes(section.role)) throw new Error(`${sectionLabel}.role 无效。`);
    boundedContentText(section.heading, 240, `${sectionLabel}.heading`, { nonempty: true });
    const blocks = assertDenseDataArray(section.blocks, MAX_REPORT_BLOCKS, `${sectionLabel}.blocks`);
    blockCount += blocks.length;
    if (blockCount > MAX_REPORT_BLOCKS) throw new Error(`${label}.blocks 超过安全上限。`);
    for (const [blockIndex, blockValue] of blocks.entries()) {
      const blockLabel = `${sectionLabel}.blocks[${blockIndex}]`;
      const block = assertPlainDataObject(blockValue, blockLabel);
      assertOnlyKeys(block, new Set(["id", "type", "text", "items", "metricIndexes", "inputArtifactIds", "chartArtifactId", "caption", "columns", "rows", "tone", "title"]), blockLabel);
      const id = strictLineageId(block.id, `${blockLabel}.id`);
      if (blockIds.has(id)) throw new Error(`${blockLabel}.id 重复。`);
      blockIds.add(id);
      const allowedTypes = document.structureVersion === 1
        ? ["paragraph", "bullets", "metrics", "sources", "chart"]
        : ["paragraph", "bullets", "metrics", "sources", "chart", "table", "callout"];
      if (!allowedTypes.includes(block.type)) throw new Error(`${blockLabel}.type 无效。`);
      const fields = {
        paragraph: ["id", "type", "text"], bullets: ["id", "type", "items"], metrics: ["id", "type", "metricIndexes"],
        sources: ["id", "type", "inputArtifactIds"], chart: ["id", "type", "chartArtifactId"],
        table: ["id", "type", "caption", "columns", "rows"], callout: ["id", "type", "tone", "title", "text"]
      }[block.type];
      if (Object.keys(block).length !== fields.length || fields.some((key) => !Object.hasOwn(block, key))) throw new Error(`${blockLabel} 字段与 type 不匹配。`);
      if (block.type === "paragraph") {
        boundedContentText(block.text, 10000, `${blockLabel}.text`, { nonempty: true });
      } else if (block.type === "bullets") {
        validateContentStringArray(block.items, MAX_REPORT_BLOCK_BULLETS, 2000, `${blockLabel}.items`, { minimum: 1, nonemptyItems: true });
      } else if (block.type === "metrics") {
        const indexes = assertDenseDataArray(block.metricIndexes, MAX_CONTENT_METRICS, `${blockLabel}.metricIndexes`, 1);
        const known = new Set();
        for (const [index, metricIndex] of indexes.entries()) {
          if (!Number.isSafeInteger(metricIndex) || metricIndex < 0 || known.has(metricIndex)) throw new Error(`${blockLabel}.metrics.metricIndexes[${index}] 无效或重复。`);
          known.add(metricIndex);
        }
      } else if (block.type === "sources" || block.type === "chart") {
        if (block.type === "sources") {
          const ids = assertDenseDataArray(block.inputArtifactIds, 24, `${blockLabel}.inputArtifactIds`, 1);
          const known = new Set();
          for (const [index, artifactId] of ids.entries()) {
            const id = strictLineageId(artifactId, `${blockLabel}.inputArtifactIds[${index}]`);
            if (known.has(id)) throw new Error(`${blockLabel}.inputArtifactIds 重复。`);
            known.add(id);
          }
        } else strictLineageId(block.chartArtifactId, `${blockLabel}.chartArtifactId`);
      } else if (block.type === "table") {
        boundedContentText(block.caption, 240, `${blockLabel}.caption`, { nonempty: true });
        const columns = assertDenseDataArray(block.columns, MAX_REPORT_TABLE_COLUMNS, `${blockLabel}.columns`, 1);
        const columnIds = new Set();
        for (const [columnIndex, columnValue] of columns.entries()) {
          const columnLabel = `${blockLabel}.columns[${columnIndex}]`;
          const column = assertPlainDataObject(columnValue, columnLabel);
          assertOnlyKeys(column, new Set(["id", "label", "align"]), columnLabel);
          for (const key of ["id", "label", "align"]) if (!Object.hasOwn(column, key)) throw new Error(`${columnLabel}.${key} 缺失。`);
          const columnId = strictLineageId(column.id, `${columnLabel}.id`);
          if (columnIds.has(columnId)) throw new Error(`${blockLabel}.columns.id 重复。`);
          columnIds.add(columnId);
          boundedContentText(column.label, 120, `${columnLabel}.label`, { nonempty: true });
          if (!["left", "center", "right"].includes(column.align)) throw new Error(`${columnLabel}.align 无效。`);
        }
        const rows = assertDenseDataArray(block.rows, MAX_REPORT_TABLE_ROWS, `${blockLabel}.rows`, 1);
        const rowIds = new Set();
        tableCellCount += columns.length * rows.length;
        if (tableCellCount > MAX_REPORT_TABLE_CELLS) throw new Error(`${label} 表格单元格超过安全上限。`);
        for (const [rowIndex, rowValue] of rows.entries()) {
          const rowLabel = `${blockLabel}.rows[${rowIndex}]`;
          const row = assertPlainDataObject(rowValue, rowLabel);
          assertOnlyKeys(row, new Set(["id", "cells"]), rowLabel);
          for (const key of ["id", "cells"]) if (!Object.hasOwn(row, key)) throw new Error(`${rowLabel}.${key} 缺失。`);
          const rowId = strictLineageId(row.id, `${rowLabel}.id`);
          if (rowIds.has(rowId)) throw new Error(`${blockLabel}.rows.id 重复。`);
          rowIds.add(rowId);
          const cells = assertDenseDataArray(row.cells, MAX_REPORT_TABLE_COLUMNS, `${rowLabel}.cells`);
          if (cells.length !== columns.length) throw new Error(`${rowLabel}.cells 必须与 columns 等宽。`);
          for (const [cellIndex, cell] of cells.entries()) boundedContentText(cell, 240, `${rowLabel}.cells[${cellIndex}]`);
        }
      } else {
        if (!["note", "insight", "warning"].includes(block.tone)) throw new Error(`${blockLabel}.tone 无效。`);
        boundedContentText(block.title, 160, `${blockLabel}.title`, { nonempty: true });
        boundedContentText(block.text, 4000, `${blockLabel}.text`, { nonempty: true });
      }
    }
  }
  if (Buffer.byteLength(JSON.stringify(document), "utf8") > MAX_REPORT_DOCUMENT_BYTES) throw new Error(`${label} 超过 96 KiB 安全上限。`);
  return document;
}

function reportDocumentV2(value, label = "Lineage content.document") {
  const document = validateReportDocument(value, label);
  return document.structureVersion === 2 ? document : { ...document, structureVersion: 2 };
}

function presentationTableSnapshotFromReport(source, reportContent, refInput, label = "Presentation tableRef") {
  const ref = validatePresentationTableRef(refInput, label);
  if (!source || source.kind !== "report" || source.status !== "ready") throw new Error(`${label}.reportArtifactId 必须引用 ready report artifact。`);
  const document = validateReportDocument(reportContent?.document, `${label} report document`);
  if (document.structureVersion !== 2) throw new Error(`${label}.reportArtifactId 必须引用 ReportDocumentV2。`);
  const block = document.sections.flatMap((section) => section.blocks).find((candidate) => candidate.type === "table" && candidate.id === ref.tableBlockId);
  if (!block) throw new Error(`${label}.tableBlockId 未定位到 canonical Report table。`);
  const requested = new Set(ref.columnIds);
  const columns = block.columns.filter((column) => requested.has(column.id));
  if (columns.length !== requested.size) throw new Error(`${label}.columnIds 包含未知列。`);
  const indexes = columns.map((column) => block.columns.findIndex((candidate) => candidate.id === column.id));
  const canonicalRef = { ...ref, columnIds: columns.map((column) => column.id) };
  const table = {
    reportArtifactId: source.id,
    reportRevision: source.revision,
    reportSha256: source.contentSha256,
    tableBlockId: block.id,
    caption: block.caption,
    columns: columns.map((column) => ({ ...column })),
    rows: block.rows.map((row) => ({ id: row.id, cells: indexes.map((index) => row.cells[index]) }))
  };
  validatePresentationTableSnapshot(table, `${label} snapshot`);
  return { ref: canonicalRef, table };
}

function materializePresentationSlides(projectRoot, slidesInput, sources, provenanceInputs, label = "Presentation structure.slides") {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const snapshotById = new Map(provenanceInputs.map((input) => [input.artifactId, input]));
  return validateLineageSlides(slidesInput, label, false).map((slide, index) => {
    const next = { ...slide };
    if (slide.chartArtifactId) {
      const source = sourceById.get(slide.chartArtifactId);
      const snapshot = snapshotById.get(slide.chartArtifactId);
      if (!source || source.kind !== "chart" || source.status !== "ready" || !snapshot || source.revision !== snapshot.revision || source.contentSha256 !== snapshot.sha256) {
        throw new Error(`Presentation slide #${index + 1} chartArtifactId 未引用当前 provenance 授权的 ready chart artifact。`);
      }
      next.chart = readArtifactContent(projectRoot, source).chart;
    }
    if (slide.tableRef) {
      const source = sourceById.get(slide.tableRef.reportArtifactId);
      const snapshot = snapshotById.get(slide.tableRef.reportArtifactId);
      if (!source || source.kind !== "report" || source.status !== "ready" || !snapshot || source.revision !== snapshot.revision || source.contentSha256 !== snapshot.sha256) {
        throw new Error(`Presentation slide #${index + 1} tableRef 未引用当前 provenance 授权的 ready report artifact。`);
      }
      const resolved = presentationTableSnapshotFromReport(source, readArtifactContent(projectRoot, source), slide.tableRef, `Presentation slide #${index + 1}.tableRef`);
      next.tableRef = resolved.ref;
      next.table = resolved.table;
    }
    return next;
  });
}

function deliveryCitation(root, blockIds = []) {
  return {
    reportArtifactId: root.id,
    reportRevision: root.revision,
    reportSha256: root.contentSha256,
    blockIds: [...blockIds]
  };
}

function resolvedDeliveryBlock(block, metrics) {
  if (block.type === "paragraph") return { id: block.id, type: block.type, text: block.text };
  if (block.type === "bullets") return { id: block.id, type: block.type, items: [...block.items] };
  if (block.type === "metrics") return { id: block.id, type: block.type, metrics: block.metricIndexes.map((index) => reportMetricAt(metrics, index)) };
  if (block.type === "sources") return { id: block.id, type: block.type, inputArtifactIds: [...block.inputArtifactIds] };
  if (block.type === "callout") return { id: block.id, type: block.type, tone: block.tone, title: block.title, text: block.text };
  throw new Error(`Delivery Deck report block ${block.id} 类型不允许。`);
}

function controlledRevisionContent(projectRoot, descriptor, snapshot, label) {
  if (!descriptor || !snapshot || descriptor.revision !== snapshot.revision || descriptor.contentSha256 !== snapshot.sha256) throw new Error(`${label} 未引用当前 provenance 授权 artifact。`);
  const revisionPath = artifactRevisionPath(projectRoot, descriptor.id, snapshot.revision);
  if (!existsSync(revisionPath) || controlledLineageFileSha(revisionPath, projectRoot, label) !== snapshot.sha256) throw new Error(`${label} revision/SHA 快照无效。`);
  let stored;
  try { stored = JSON.parse(readFileSync(revisionPath, "utf8")); } catch { throw new Error(`${label} revision JSON 损坏。`); }
  if (stored?.formatVersion !== LINEAGE_FORMAT_VERSION || stored?.artifactId !== descriptor.id || stored?.projectId !== descriptor.projectId || stored?.projectKind !== descriptor.projectKind || Number(stored?.revision) !== snapshot.revision) throw new Error(`${label} 不是受控 revision 快照。`);
  return validateLineageStoredContent(stored.content, descriptor.kind, descriptor.projectKind, descriptor.finance);
}

function materializeDeliveryDeck(projectRoot, deckInput, sources, provenanceInputs, allArtifacts, label = "Presentation delivery deck") {
  const deck = validateDeliveryDeck(deckInput, label, false);
  const directById = new Map(sources.map((source) => [source.id, source]));
  const snapshotById = new Map(provenanceInputs.map((input) => [input.artifactId, input]));
  const allById = new Map((allArtifacts || sources).map((source) => [source.id, source]));
  const root = directById.get(deck.reportRef.reportArtifactId);
  const rootSnapshot = snapshotById.get(deck.reportRef.reportArtifactId);
  if (!root || root.kind !== "report" || root.status !== "ready" || !rootSnapshot || root.revision !== rootSnapshot.revision || root.contentSha256 !== rootSnapshot.sha256) {
    throw new Error("Delivery Deck reportRef 必须引用当前 presentation provenance 授权的唯一 ready Report。" );
  }
  if (sources.filter((source) => source.kind === "report").length !== 1) throw new Error("Delivery Deck 必须且只能有一个 ready ReportDocumentV2 根来源。" );
  const rootContent = controlledRevisionContent(projectRoot, root, rootSnapshot, "Delivery Deck root Report");
  const document = validateReportDocument(rootContent.document, "Delivery Deck root Report document");
  if (document.structureVersion !== 2) throw new Error("Delivery Deck reportRef 必须引用 ReportDocumentV2。" );
  const blocksById = new Map(document.sections.flatMap((section) => section.blocks).map((block) => [block.id, block]));
  const reportSources = new Map(root.provenance.inputs.map((input) => [input.artifactId, input]));
  const resolveChart = (reportBlockId, slideLabel) => {
    const block = blocksById.get(reportBlockId);
    if (!block || block.type !== "chart") throw new Error(`${slideLabel}.reportBlockId 必须引用 root Report 的 chart block。`);
    const chart = allById.get(block.chartArtifactId);
    const snapshot = reportSources.get(block.chartArtifactId);
    if (!chart || chart.kind !== "chart" || chart.status !== "ready" || !snapshot) throw new Error(`${slideLabel}.reportBlockId 未引用 root Report provenance 授权的 ready chart。`);
    return controlledRevisionContent(projectRoot, chart, snapshot, `${slideLabel} chart`).chart;
  };
  const resolvedSlides = deck.slides.map((slide, index) => {
    const slideLabel = `${label}.slides[${index}]`;
    let citation = deliveryCitation(root, slide.type === "report-blocks" ? slide.blockIds : slide.type === "chart" ? [slide.reportBlockId] : []);
    const next = { ...slide, citation };
    if (slide.type === "report-blocks") {
      const selected = slide.blockIds.map((id) => blocksById.get(id));
      if (selected.some((block) => !block || !["paragraph", "bullets", "metrics", "callout", "sources"].includes(block.type))) throw new Error(`${slideLabel}.blockIds 只能引用 root Report 的 paragraph/bullets/metrics/callout/sources blocks。`);
      next.resolvedBlocks = selected.map((block) => resolvedDeliveryBlock(block, rootContent.metrics));
    } else if (slide.type === "chart") {
      next.chart = resolveChart(slide.reportBlockId, slideLabel);
    } else if (slide.type === "table") {
      if (slide.tableRef.reportArtifactId !== root.id) throw new Error(`${slideLabel}.tableRef.reportArtifactId 必须等于 Delivery Deck root Report。`);
      const resolved = presentationTableSnapshotFromReport(root, rootContent, slide.tableRef, `${slideLabel}.tableRef`);
      next.tableRef = resolved.ref;
      next.table = resolved.table;
      citation = deliveryCitation(root, [resolved.ref.tableBlockId]);
      next.citation = citation;
    } else if (slide.type === "provenance") {
      const sourceBlock = document.sections.flatMap((section) => section.blocks).find((block) => block.type === "sources");
      next.resolvedBlocks = sourceBlock ? [resolvedDeliveryBlock(sourceBlock, rootContent.metrics)] : [];
      citation = deliveryCitation(root, next.resolvedBlocks.map((block) => block.id));
      next.citation = citation;
    }
    return next;
  });
  return { structureVersion: DELIVERY_DECK_STRUCTURE_VERSION, theme: deck.theme, reportRef: { reportArtifactId: root.id }, slides: resolvedSlides };
}

function validateLineageFindings(value, label = "Lineage content.findings") {
  const findings = assertDenseDataArray(value, MAX_FINDINGS, label);
  for (const [index, candidate] of findings.entries()) {
    const findingLabel = `${label}[${index}]`;
    const finding = assertPlainDataObject(candidate, findingLabel);
    assertOnlyKeys(finding, new Set(["severity", "title", "detail"]), findingLabel);
    for (const key of ["severity", "title", "detail"]) if (!Object.hasOwn(finding, key)) throw new Error(`${findingLabel}.${key} 缺失。`);
    if (!["high", "medium", "low", "unknown", "info"].includes(finding.severity)) throw new Error(`${findingLabel}.severity 无效。`);
    boundedContentText(finding.title, 240, `${findingLabel}.title`, { nonempty: true });
    boundedContentText(finding.detail, 2000, `${findingLabel}.detail`, { nonempty: true });
  }
  return findings;
}

function validateLineageAssumptions(value, label = "Lineage content.assumptions") {
  const assumptions = assertPlainDataObject(value, label);
  const keys = ["revenueKey", "incomeKey", "sharesKey", "priceKey"];
  assertOnlyKeys(assumptions, new Set(keys), label);
  for (const key of keys) {
    if (!Object.hasOwn(assumptions, key)) throw new Error(`${label}.${key} 缺失。`);
    boundedContentText(assumptions[key], 180, `${label}.${key}`);
  }
  return assumptions;
}

function finiteScenarioNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1e15) throw new Error(`${label} 必须是绝对值不超过 1e15 的有限数值。`);
  return value;
}

function scenarioAdjustedValue(value, adjustmentPercent) {
  const adjusted = Number((value * (1 + adjustmentPercent / 100)).toFixed(6));
  if (!Number.isFinite(adjusted) || Math.abs(adjusted) > 1e15) throw new Error("Finance scenario 计算结果超出有限数值预算。" );
  return adjusted;
}

function canonicalScenarioInferences(facts, metric) {
  const ranked = [...facts].sort((left, right) => right.value - left.value || left.sourceArtifactId.localeCompare(right.sourceArtifactId, "en"));
  const highest = ranked[0];
  const lowest = ranked[ranked.length - 1];
  const spread = Number((highest.value - lowest.value).toFixed(6));
  return [
    {
      id: "ranking",
      kind: "ranking",
      text: `按 ${metric.label} 的基准事实排序，${highest.label} 最高，${lowest.label} 最低。`,
      sourceArtifactIds: ranked.map((fact) => fact.sourceArtifactId)
    },
    {
      id: "range",
      kind: "range",
      text: `${metric.label} 的基准区间差为 ${spread} ${metric.unit}（scale=${metric.scale}）。`,
      sourceArtifactIds: highest.sourceArtifactId === lowest.sourceArtifactId ? [highest.sourceArtifactId] : [highest.sourceArtifactId, lowest.sourceArtifactId]
    }
  ];
}

function validateFinanceScenarioWorkbook(value, label = "Lineage content.workbook") {
  const workbook = assertPlainDataObject(value, label);
  const keys = new Set(["structureVersion", "title", "metric", "sources", "facts", "assumptions", "scenarios", "inferences", "risks", "limitations"]);
  assertOnlyKeys(workbook, keys, label);
  for (const key of keys) if (!Object.hasOwn(workbook, key)) throw new Error(`${label}.${key} 缺失。`);
  if (workbook.structureVersion !== 1) throw new Error(`${label}.structureVersion 必须为 1。`);
  boundedContentText(workbook.title, 240, `${label}.title`, { nonempty: true });

  const metric = assertPlainDataObject(workbook.metric, `${label}.metric`);
  const metricKeys = ["key", "label", "measure", "unit", "scale", "direction", "scenarioRule"];
  assertOnlyKeys(metric, new Set(metricKeys), `${label}.metric`);
  for (const key of metricKeys) if (!Object.hasOwn(metric, key)) throw new Error(`${label}.metric.${key} 缺失。`);
  for (const key of ["key", "label", "measure", "unit", "direction", "scenarioRule"]) boundedContentText(metric[key], key === "key" ? 80 : 160, `${label}.metric.${key}`, { nonempty: true });
  if (!/^[\p{L}\p{N}_-]+$/u.test(metric.key)) throw new Error(`${label}.metric.key 无效。`);
  const metricPolicy = Object.hasOwn(financeScenarioMetricPolicies, metric.key) ? financeScenarioMetricPolicies[metric.key] : null;
  if (!metricPolicy || metric.measure !== "market-value" || metric.direction !== metricPolicy.direction || metric.scenarioRule !== metricPolicy.scenarioRule) {
    throw new Error(`${label}.metric 不符合受控非负市值情景策略。`);
  }
  if (!/^[A-Z]{3}$/.test(metric.unit)) throw new Error(`${label}.metric.unit 必须是三位 ISO 币种代码。`);
  if (!Number.isSafeInteger(metric.scale) || !controlledFinanceMetricScales.has(metric.scale)) throw new Error(`${label}.metric.scale 不是受控 Finance 数值尺度。`);

  const sources = assertDenseDataArray(workbook.sources, 12, `${label}.sources`, 2);
  const orderedSourceIds = sources.map((source) => String(source?.artifactId || ""));
  if (JSON.stringify(orderedSourceIds) !== JSON.stringify([...orderedSourceIds].sort((left, right) => left.localeCompare(right, "en")))) {
    throw new Error(`${label}.sources 必须按 artifactId canonical 排序。`);
  }
  const sourceIds = new Set();
  for (const [index, candidate] of sources.entries()) {
    const sourceLabel = `${label}.sources[${index}]`;
    const source = assertPlainDataObject(candidate, sourceLabel);
    assertOnlyKeys(source, new Set(["artifactId", "kind", "title", "revision", "sha256", "finance"]), sourceLabel);
    for (const key of ["artifactId", "kind", "title", "revision", "sha256", "finance"]) if (!Object.hasOwn(source, key)) throw new Error(`${sourceLabel}.${key} 缺失。`);
    const artifactId = strictLineageId(source.artifactId, `${sourceLabel}.artifactId`);
    if (sourceIds.has(artifactId)) throw new Error(`${label}.sources 包含重复 artifact。`);
    sourceIds.add(artifactId);
    if (!["valuation", "portfolio"].includes(source.kind)) throw new Error(`${sourceLabel}.kind 无效。`);
    boundedContentText(source.title, 240, `${sourceLabel}.title`, { nonempty: true });
    if (!Number.isSafeInteger(source.revision) || source.revision < 1) throw new Error(`${sourceLabel}.revision 无效。`);
    if (!/^[a-f0-9]{64}$/.test(source.sha256)) throw new Error(`${sourceLabel}.sha256 无效。`);
    const sourceFinance = canonicalFinanceContent(source.finance, `${sourceLabel}.finance`);
    const expectedScale = financeScaleForUnit(sourceFinance.unit);
    if (sourceFinance.currency !== metric.unit || expectedScale === null || expectedScale !== metric.scale) {
      throw new Error(`${sourceLabel}.finance 与共同指标的 unit/scale 不一致或单位尺度未知。`);
    }
  }

  const facts = assertDenseDataArray(workbook.facts, 12, `${label}.facts`, 2);
  if (facts.length !== sources.length) throw new Error(`${label}.facts 必须与 sources 一一对应。`);
  for (const [index, candidate] of facts.entries()) {
    const factLabel = `${label}.facts[${index}]`;
    const fact = assertPlainDataObject(candidate, factLabel);
    const factKeys = ["id", "sourceArtifactId", "label", "value", "measure", "unit", "scale"];
    assertOnlyKeys(fact, new Set(factKeys), factLabel);
    for (const key of factKeys) if (!Object.hasOwn(fact, key)) throw new Error(`${factLabel}.${key} 缺失。`);
    if (fact.id !== sources[index].artifactId || fact.sourceArtifactId !== sources[index].artifactId) throw new Error(`${factLabel} 身份或顺序与 sources 不一致。`);
    boundedContentText(fact.label, 240, `${factLabel}.label`, { nonempty: true });
    finiteScenarioNumber(fact.value, `${factLabel}.value`);
    if (fact.value < 0 || fact.measure !== metric.measure || fact.scale !== metric.scale) throw new Error(`${factLabel} 必须使用共同指标的非负 measure/scale。`);
    if (boundedContentText(fact.unit, 160, `${factLabel}.unit`, { nonempty: true }) !== metric.unit) throw new Error(`${factLabel}.unit 与共同指标不一致。`);
  }

  const assumptions = assertDenseDataArray(workbook.assumptions, 3, `${label}.assumptions`, 3);
  const assumptionIds = ["baseline", "upside", "stress"];
  for (const [index, candidate] of assumptions.entries()) {
    const assumptionLabel = `${label}.assumptions[${index}]`;
    const assumption = assertPlainDataObject(candidate, assumptionLabel);
    assertOnlyKeys(assumption, new Set(["id", "label", "adjustmentPercent"]), assumptionLabel);
    if (assumption.id !== assumptionIds[index]) throw new Error(`${assumptionLabel}.id 或顺序无效。`);
    boundedContentText(assumption.label, 80, `${assumptionLabel}.label`, { nonempty: true });
    finiteScenarioNumber(assumption.adjustmentPercent, `${assumptionLabel}.adjustmentPercent`);
  }
  if (assumptions[0].adjustmentPercent !== 0 || assumptions[1].adjustmentPercent <= 0 || assumptions[1].adjustmentPercent > 200 || assumptions[2].adjustmentPercent <= -100 || assumptions[2].adjustmentPercent >= 0) {
    throw new Error(`${label}.assumptions 情景百分比无效。`);
  }

  const scenarios = assertDenseDataArray(workbook.scenarios, 3, `${label}.scenarios`, 3);
  for (const [scenarioIndex, candidate] of scenarios.entries()) {
    const scenarioLabel = `${label}.scenarios[${scenarioIndex}]`;
    const scenario = assertPlainDataObject(candidate, scenarioLabel);
    assertOnlyKeys(scenario, new Set(["id", "label", "adjustmentPercent", "values"]), scenarioLabel);
    const assumption = assumptions[scenarioIndex];
    if (scenario.id !== assumption.id || scenario.label !== assumption.label || scenario.adjustmentPercent !== assumption.adjustmentPercent) throw new Error(`${scenarioLabel} 与 assumptions 不一致。`);
    const values = assertDenseDataArray(scenario.values, 12, `${scenarioLabel}.values`, 2);
    if (values.length !== facts.length) throw new Error(`${scenarioLabel}.values 必须与 facts 一一对应。`);
    for (const [valueIndex, valueCandidate] of values.entries()) {
      const valueLabel = `${scenarioLabel}.values[${valueIndex}]`;
      const entry = assertPlainDataObject(valueCandidate, valueLabel);
      assertOnlyKeys(entry, new Set(["sourceArtifactId", "value"]), valueLabel);
      if (entry.sourceArtifactId !== facts[valueIndex].sourceArtifactId || entry.value !== scenarioAdjustedValue(facts[valueIndex].value, assumption.adjustmentPercent)) {
        throw new Error(`${valueLabel} 不是事实与假设的 canonical 计算结果。`);
      }
    }
  }

  const inferences = assertDenseDataArray(workbook.inferences, 8, `${label}.inferences`, 1);
  for (const [index, candidate] of inferences.entries()) {
    const inferenceLabel = `${label}.inferences[${index}]`;
    const inference = assertPlainDataObject(candidate, inferenceLabel);
    assertOnlyKeys(inference, new Set(["id", "kind", "text", "sourceArtifactIds"]), inferenceLabel);
    strictLineageId(inference.id, `${inferenceLabel}.id`);
    if (!["ranking", "range"].includes(inference.kind)) throw new Error(`${inferenceLabel}.kind 无效。`);
    boundedContentText(inference.text, 2000, `${inferenceLabel}.text`, { nonempty: true });
    const ids = validateContentStringArray(inference.sourceArtifactIds, 12, 180, `${inferenceLabel}.sourceArtifactIds`, { minimum: 1, nonemptyItems: true });
    if (new Set(ids).size !== ids.length || ids.some((id) => !sourceIds.has(id))) throw new Error(`${inferenceLabel}.sourceArtifactIds 无效。`);
  }
  if (JSON.stringify(inferences) !== JSON.stringify(canonicalScenarioInferences(facts, metric))) throw new Error(`${label}.inferences 不是 canonical 推断。`);
  validateContentStringArray(workbook.risks, 100, 1000, `${label}.risks`, { minimum: 1, nonemptyItems: true });
  validateContentStringArray(workbook.limitations, 40, 1000, `${label}.limitations`, { minimum: 1, nonemptyItems: true });
  return workbook;
}

function scenarioWorkbookTable(workbook) {
  const scenarioById = new Map(workbook.scenarios.map((scenario) => [scenario.id, scenario]));
  const valueByScenario = (id, sourceArtifactId) => scenarioById.get(id)?.values.find((entry) => entry.sourceArtifactId === sourceArtifactId)?.value;
  const rows = workbook.sources.map((source) => ({
    asset: source.title,
    baseline: valueByScenario("baseline", source.artifactId),
    upside: valueByScenario("upside", source.artifactId),
    stress: valueByScenario("stress", source.artifactId),
    source: source.finance.sourceName,
    as_of: source.finance.asOf
  }));
  const columns = [
    ["asset", "标的", "string"],
    ["baseline", `基准 · ${workbook.metric.label} · ${workbook.metric.unit} · scale=${workbook.metric.scale}`, "number"],
    ["upside", `乐观 · ${workbook.metric.label} · ${workbook.metric.unit} · scale=${workbook.metric.scale}`, "number"],
    ["stress", `压力 · ${workbook.metric.label} · ${workbook.metric.unit} · scale=${workbook.metric.scale}`, "number"],
    ["source", "来源", "string"],
    ["as_of", "AS OF", "date"]
  ].map(([key, columnLabel, type]) => ({ key, label: columnLabel, type, nullable: false, missingCount: 0, distinctCount: new Set(rows.map((row) => row[key])).size }));
  return { sheetName: "Scenarios", sheetNames: ["Scenarios"], columns, rows, totalRows: rows.length, totalColumns: columns.length, warnings: workbook.risks };
}

function scenarioWorkbookMarkdown(workbook, finance) {
  const assumptions = Object.fromEntries(workbook.assumptions.map((item) => [item.id, item]));
  const scenarioById = new Map(workbook.scenarios.map((scenario) => [scenario.id, new Map(scenario.values.map((entry) => [entry.sourceArtifactId, entry.value]))]));
  const lines = [
    `# ${markdownEscape(workbook.title)}`,
    "",
    `- 截止时间：${markdownEscape(finance.asOf)}`,
    `- 币种 / 单位：${markdownEscape(finance.currency)} / ${markdownEscape(finance.unit)}`,
    `- 时区：${markdownEscape(finance.timezone)}`,
    `- 共同指标：${markdownEscape(workbook.metric.label)}（measure=${markdownEscape(workbook.metric.measure)}, unit=${markdownEscape(workbook.metric.unit)}, scale=${workbook.metric.scale}）`,
    "",
    "## 情景矩阵",
    "",
    `| 标的 | 基准 | 乐观 (${assumptions.upside.adjustmentPercent}%) | 压力 (${assumptions.stress.adjustmentPercent}%) | 来源 |`,
    "| --- | ---: | ---: | ---: | --- |"
  ];
  for (const source of workbook.sources) {
    lines.push(`| ${markdownEscape(source.title)} | ${scenarioById.get("baseline").get(source.artifactId)} | ${scenarioById.get("upside").get(source.artifactId)} | ${scenarioById.get("stress").get(source.artifactId)} | ${markdownEscape(source.finance.sourceName)} |`);
  }
  lines.push("", "## 事实", "");
  workbook.facts.forEach((fact) => lines.push(`- ${markdownEscape(fact.label)}：${fact.value}（measure=${markdownEscape(fact.measure)}, unit=${markdownEscape(fact.unit)}, scale=${fact.scale}；source=${markdownEscape(fact.sourceArtifactId)}）`));
  lines.push("", "## 假设", "");
  workbook.assumptions.forEach((assumption) => lines.push(`- ${markdownEscape(assumption.label)}：${assumption.adjustmentPercent}%`));
  lines.push("", "## 推断", "");
  workbook.inferences.forEach((inference) => lines.push(`- ${markdownEscape(inference.text)}`));
  lines.push("", "## 风险", "");
  workbook.risks.forEach((risk) => lines.push(`- ${markdownEscape(risk)}`));
  lines.push("", "## 局限", "");
  workbook.limitations.forEach((limitation) => lines.push(`- ${markdownEscape(limitation)}`));
  lines.push("", `> ${markdownEscape(finance.disclaimer)}`);
  return lines.join("\n");
}

function scenarioWorkbookHtml(workbook, finance) {
  const table = scenarioWorkbookTable(workbook);
  const assumptions = Object.fromEntries(workbook.assumptions.map((item) => [item.id, item]));
  const rows = table.rows.map((row) => `<tr><th scope="row">${escapeHtml(row.asset)}</th><td>${row.baseline}</td><td>${row.upside}</td><td>${row.stress}</td><td>${escapeHtml(row.source)}</td><td>${escapeHtml(row.as_of)}</td></tr>`).join("");
  const list = (items) => `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(workbook.title)}</title><style>body{font:16px/1.65 system-ui,sans-serif;max-width:1080px;margin:48px auto;padding:0 24px;color:#172033}h1,h2{line-height:1.25}dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}dt{font-size:12px;color:#64748b}dd{margin:4px 0 0;font-weight:650}table{width:100%;border-collapse:collapse;margin:20px 0}th,td{border:1px solid #cbd5e1;padding:8px 10px;text-align:right}th:first-child,td:first-child,th:nth-last-child(-n+2),td:nth-last-child(-n+2){text-align:left}blockquote{border-left:4px solid #d4a548;padding:12px 16px;background:#fff8e8}</style></head><body><article data-finance-scenario-workbook-version="1"><h1>${escapeHtml(workbook.title)}</h1><dl><div><dt>AS OF</dt><dd>${escapeHtml(finance.asOf)}</dd></div><div><dt>币种 / 单位</dt><dd>${escapeHtml(finance.currency)} / ${escapeHtml(finance.unit)}</dd></div><div><dt>时区</dt><dd>${escapeHtml(finance.timezone)}</dd></div><div><dt>共同指标</dt><dd>${escapeHtml(workbook.metric.label)} (measure=${escapeHtml(workbook.metric.measure)}, unit=${escapeHtml(workbook.metric.unit)}, scale=${workbook.metric.scale})</dd></div></dl><h2>情景矩阵</h2><table><thead><tr><th scope="col">标的</th><th scope="col">基准</th><th scope="col">乐观 (${assumptions.upside.adjustmentPercent}%)</th><th scope="col">压力 (${assumptions.stress.adjustmentPercent}%)</th><th scope="col">来源</th><th scope="col">AS OF</th></tr></thead><tbody>${rows}</tbody></table><h2>事实</h2>${list(workbook.facts.map((fact) => `${fact.label}：${fact.value} (measure=${fact.measure}, unit=${fact.unit}, scale=${fact.scale}; source=${fact.sourceArtifactId})`))}<h2>假设</h2>${list(workbook.assumptions.map((item) => `${item.label}：${item.adjustmentPercent}%`))}<h2>推断</h2>${list(workbook.inferences.map((item) => item.text))}<h2>风险</h2>${list(workbook.risks)}<h2>局限</h2>${list(workbook.limitations)}<blockquote>${escapeHtml(finance.disclaimer)}</blockquote></article></body></html>`;
}

function canonicalFinanceContent(value, label = "Lineage content.finance") {
  const finance = assertPlainDataObject(value, label);
  const canonical = normalizeFinanceContext(finance, true);
  const actualKeys = Object.keys(finance);
  const canonicalKeys = Object.keys(canonical);
  if (actualKeys.length !== canonicalKeys.length || canonicalKeys.some((key) => !Object.hasOwn(finance, key) || finance[key] !== canonical[key])) {
    throw new Error(`${label} 不是规范 Finance context。`);
  }
  return canonical;
}

function validateLineageStoredContent(value, kindInput, projectKindInput, expectedFinance) {
  const content = assertPlainDataObject(value, "Lineage stored.content");
  const projectKind = String(projectKindInput || "");
  const kind = String(kindInput || "");
  if (!lineageProjectKinds.has(projectKind) || !allowedKinds(projectKind).has(kind)) throw new Error("Lineage stored.content 项目类型或 artifact kind 无效。" );
  const allowedOperations = kind === "portfolio" && projectKind === "finance"
    ? new Set(["import", "portfolio"])
    : new Set([kind === "dataset" || ["market-data", "financial-statement"].includes(kind) ? "import" : kind]);
  const operation = boundedContentText(content.operation, 80, "Lineage stored.content.operation", { nonempty: true });
  if (!allowedOperations.has(operation)) throw new Error(`Lineage stored.content operation=${operation} 与 ${projectKind}/${kind} 不匹配。`);

  const fieldSets = {
    import: ["operation", "table", "warnings", ...(projectKind === "finance" ? ["finance"] : [])],
    clean: ["operation", "table", "metrics", "warnings"],
    transform: ["operation", "table", "metrics", "warnings"],
    analysis: ["operation", "metrics", "columnProfiles", "warnings"],
    chart: ["operation", "chart", "warnings"],
    report: ["operation", "markdown", "html", "document", "metrics", "warnings"],
    presentation: ["operation", "theme", "slides", "warnings", "structureVersion", "reportRef"],
    valuation: ["operation", "metrics", "finance", "warnings", "assumptions"],
    portfolio: ["operation", "table", "metrics", "finance", "warnings"],
    "scenario-workbook": ["operation", "workbook", "table", "markdown", "html", "finance", "warnings"],
    "risk-review": ["operation", "finance", "findings", "metrics", "warnings"],
    "finance-report": ["operation", "markdown", "metrics", "finance", "warnings"]
  };
  const required = fieldSets[operation];
  const presentationV3 = operation === "presentation" && content.structureVersion === DELIVERY_DECK_STRUCTURE_VERSION;
  assertOnlyKeys(content, new Set(required), "Lineage stored.content");
  for (const key of required) {
    // Legacy reports/presentations predate structured documents, semantic HTML and themes.
    const legacyReport = operation === "report" && (!content.document || content.document.structureVersion === 1);
    if (!Object.hasOwn(content, key) && !(
      (operation === "report" && key === "document") ||
      (operation === "report" && key === "html" && legacyReport) ||
       (operation === "presentation" && key === "theme") ||
       (operation === "presentation" && !presentationV3 && ["structureVersion", "reportRef"].includes(key))
    )) {
      throw new Error(`Lineage stored.content.${key} 缺失。`);
    }
  }
  if (Object.hasOwn(content, "table")) validateLineageTable(content.table);
  if (Object.hasOwn(content, "metrics")) validateLineageMetrics(content.metrics);
  if (Object.hasOwn(content, "columnProfiles")) validateLineageColumnProfiles(content.columnProfiles);
  if (Object.hasOwn(content, "chart")) validateLineageChart(content.chart);
  if (Object.hasOwn(content, "markdown")) boundedContentText(content.markdown, MAX_MARKDOWN_CHARS, "Lineage content.markdown");
  if (Object.hasOwn(content, "html")) boundedContentText(content.html, MAX_HTML_CHARS, "Lineage content.html");
  if (Object.hasOwn(content, "document")) validateReportDocument(content.document);
  if (Object.hasOwn(content, "workbook")) validateFinanceScenarioWorkbook(content.workbook);
  if (Object.hasOwn(content, "theme") && !["paper", "midnight", "slate"].includes(content.theme)) throw new Error("Lineage content.theme 无效。");
  if (operation === "presentation" && presentationV3) {
    validateDeliveryDeck({ structureVersion: content.structureVersion, theme: content.theme, reportRef: content.reportRef, slides: content.slides }, "Lineage delivery deck");
  } else {
    if (Object.hasOwn(content, "structureVersion") || Object.hasOwn(content, "reportRef")) throw new Error("PresentationStructureV1/V2 不得包含 Delivery Deck V3 字段。");
    if (Object.hasOwn(content, "slides")) validateLineageSlides(content.slides);
  }
  if (Object.hasOwn(content, "findings")) validateLineageFindings(content.findings);
  if (Object.hasOwn(content, "warnings")) validateLineageWarnings(content.warnings);
  if (Object.hasOwn(content, "assumptions")) validateLineageAssumptions(content.assumptions);
  if (projectKind === "finance") {
    const finance = canonicalFinanceContent(content.finance);
    if (expectedFinance !== undefined && expectedFinance !== null) {
      const expected = normalizeFinanceContext(expectedFinance, true);
      const mismatches = [...financeContextIdentityKeys, "disclaimer"].filter((key) => String(finance[key] || "") !== String(expected[key] || ""));
      if (mismatches.length) throw new Error(`Lineage content.finance 与 descriptor.finance 不一致：${mismatches.join(", ")}。`);
    }
  } else if (Object.hasOwn(content, "finance")) {
    throw new Error("Data artifact 不得包含 Finance context。" );
  }
  if (operation === "report" && content.document?.structureVersion === 2) {
    const canonicalMarkdown = reportMarkdownFromDocument(content.document, content.metrics);
    const canonicalHtml = reportHtmlFromDocument(content.document, content.metrics);
    if (content.markdown !== canonicalMarkdown) throw new Error("Lineage Report V2 markdown 不是受控结构的 canonical 输出。");
    if (content.html !== canonicalHtml) throw new Error("Lineage Report V2 html 不是受控结构的 canonical 输出。");
  }
  if (operation === "scenario-workbook") {
    const canonicalTable = scenarioWorkbookTable(content.workbook);
    const aggregateFinance = aggregateScenarioFinanceContext(content.workbook.sources.map((source) => normalizeFinanceContext(source.finance, true)));
    if (JSON.stringify(content.finance) !== JSON.stringify(aggregateFinance)) throw new Error("Finance scenario workbook finance 不是来源的 canonical 聚合口径。");
    if (JSON.stringify(content.warnings) !== JSON.stringify(content.workbook.risks)) throw new Error("Finance scenario workbook warnings 必须等于 canonical risks。" );
    if (JSON.stringify(content.table) !== JSON.stringify(canonicalTable)) throw new Error("Finance scenario workbook table 不是 canonical 输出。");
    if (content.markdown !== scenarioWorkbookMarkdown(content.workbook, content.finance)) throw new Error("Finance scenario workbook markdown 不是 canonical 输出。");
    if (content.html !== scenarioWorkbookHtml(content.workbook, content.finance)) throw new Error("Finance scenario workbook html 不是 canonical 输出。");
  }
  return content;
}

function safeId(value, prefix = "artifact") {
  const source = cleanOneLine(value, 180);
  const cleaned = source.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^[.-]+|[.-]+$/g, "");
  return cleaned || `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function strictLineageId(value, label = "Lineage artifactId") {
  const raw = String(value || "").trim();
  if (!raw || raw !== safeId(raw, "invalid") || raw === "." || raw === "..") throw new Error(`${label} 无效。`);
  return raw;
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function assertOnlyKeys(value, allowed, label) {
  const unexpected = Object.keys(objectValue(value)).filter((key) => !allowed.has(key));
  if (unexpected.length) throw new Error(`${label} 包含未知字段：${unexpected.join(", ")}`);
}

function boundedOptionText(value, maximum, label) {
  if (typeof value !== "string") throw new Error(`${label} 必须是字符串。`);
  const cleaned = cleanOneLine(value, maximum);
  if (value !== cleaned) throw new Error(`${label} 包含控制字符、首尾空白或超过长度限制。`);
  return cleaned;
}

const transformModes = new Set(["basic", "compute", "group", "pivot", "join"]);
const computedOperators = new Set(["add", "subtract", "multiply", "divide", "percent", "concat"]);
const aggregationOperators = new Set(["count", "sum", "average", "min", "max", "distinct-count"]);

function requiredOptionText(value, maximum, label) {
  const cleaned = boundedOptionText(value, maximum, label);
  if (!cleaned) throw new Error(`${label} 不能为空。`);
  return cleaned;
}

function normalizedOutputColumnKey(value, label) {
  const key = requiredOptionText(value, 80, label);
  if (!/^[\p{L}\p{N}_-]+$/u.test(key) || key === "." || key === "..") throw new Error(`${label} 只能包含文字、数字、下划线或连字符。`);
  return key;
}

function normalizedOptionTextArray(value, maximumItems, label) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximumItems) throw new Error(`${label} 必须包含 1-${maximumItems} 项。`);
  const output = value.map((item, index) => requiredOptionText(item, 180, `${label} #${index + 1}`));
  if (new Set(output).size !== output.length) throw new Error(`${label} 不得包含重复列。`);
  return output;
}

function normalizedBasicColumns(value) {
  if (!Array.isArray(value) || value.length > 256) throw new Error("transform.columns 必须是至多 256 个列名。" );
  return [...new Set(value.map((item) => boundedOptionText(item, 180, "transform.columns")))];
}

function normalizeComputedColumns(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) throw new Error("transform.computedColumns 必须包含 1-16 项。" );
  const keys = new Set();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`transform.computedColumns #${index + 1} 必须是对象。`);
    assertOnlyKeys(entry, new Set(["key", "label", "operator", "leftColumn", "rightColumn", "rightValue", "separator", "precision"]), `transform.computedColumns #${index + 1}`);
    const key = normalizedOutputColumnKey(entry.key, `transform.computedColumns #${index + 1}.key`);
    if (keys.has(key)) throw new Error(`transform.computedColumns 输出列重复：${key}`);
    keys.add(key);
    const operator = requiredOptionText(entry.operator, 32, `transform.computedColumns #${index + 1}.operator`);
    if (!computedOperators.has(operator)) throw new Error(`transform.computedColumns #${index + 1}.operator 无效。`);
    const leftColumn = requiredOptionText(entry.leftColumn, 180, `transform.computedColumns #${index + 1}.leftColumn`);
    const hasRightColumn = Object.hasOwn(entry, "rightColumn") && String(entry.rightColumn || "") !== "";
    const hasRightValue = Object.hasOwn(entry, "rightValue");
    if (hasRightColumn === hasRightValue) throw new Error(`transform.computedColumns #${index + 1} 必须且只能提供 rightColumn 或 rightValue。`);
    const normalized = {
      key,
      label: Object.hasOwn(entry, "label") ? requiredOptionText(entry.label, 160, `transform.computedColumns #${index + 1}.label`) : key,
      operator,
      leftColumn
    };
    if (hasRightColumn) normalized.rightColumn = requiredOptionText(entry.rightColumn, 180, `transform.computedColumns #${index + 1}.rightColumn`);
    if (hasRightValue) {
      if (typeof entry.rightValue === "number") {
        if (!Number.isFinite(entry.rightValue)) throw new Error(`transform.computedColumns #${index + 1}.rightValue 必须是有限数值。`);
        normalized.rightValue = entry.rightValue;
      } else if (typeof entry.rightValue === "string") {
        normalized.rightValue = boundedOptionText(entry.rightValue, 1000, `transform.computedColumns #${index + 1}.rightValue`);
      } else throw new Error(`transform.computedColumns #${index + 1}.rightValue 只能是字符串或数值。`);
    }
    if (Object.hasOwn(entry, "separator")) normalized.separator = boundedOptionText(entry.separator, 40, `transform.computedColumns #${index + 1}.separator`);
    if (Object.hasOwn(entry, "precision")) {
      const precision = Number(entry.precision);
      if (!Number.isSafeInteger(precision) || precision < 0 || precision > 12) throw new Error(`transform.computedColumns #${index + 1}.precision 必须在 0-12 之间。`);
      normalized.precision = precision;
    }
    return normalized;
  });
}

function normalizeAggregations(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 24) throw new Error("transform.aggregations 必须包含 1-24 项。" );
  const keys = new Set();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`transform.aggregations #${index + 1} 必须是对象。`);
    assertOnlyKeys(entry, new Set(["column", "operator", "outputKey", "label"]), `transform.aggregations #${index + 1}`);
    const operator = requiredOptionText(entry.operator, 32, `transform.aggregations #${index + 1}.operator`);
    if (!aggregationOperators.has(operator)) throw new Error(`transform.aggregations #${index + 1}.operator 无效。`);
    const column = Object.hasOwn(entry, "column") ? boundedOptionText(entry.column, 180, `transform.aggregations #${index + 1}.column`) : "";
    if (operator !== "count" && !column) throw new Error(`transform.aggregations #${index + 1}.column 不能为空。`);
    const outputKey = normalizedOutputColumnKey(entry.outputKey, `transform.aggregations #${index + 1}.outputKey`);
    if (keys.has(outputKey)) throw new Error(`transform.aggregations 输出列重复：${outputKey}`);
    keys.add(outputKey);
    return {
      column,
      operator,
      outputKey,
      label: Object.hasOwn(entry, "label") ? requiredOptionText(entry.label, 160, `transform.aggregations #${index + 1}.label`) : outputKey
    };
  });
}

function normalizeTransformOptions(source) {
  const mode = Object.hasOwn(source, "mode") ? requiredOptionText(source.mode, 32, "transform.mode") : "basic";
  if (!transformModes.has(mode)) throw new Error("transform.mode 只能是 basic、compute、group、pivot 或 join。" );
  const common = new Set(["mode", "limit"]);
  const allowedByMode = {
    basic: new Set([...common, "columns", "filterColumn", "filterValue", "sortColumn", "sortDirection"]),
    compute: new Set([...common, "computedColumns"]),
    group: new Set([...common, "groupBy", "aggregations", "sortColumn", "sortDirection"]),
    pivot: new Set([...common, "rowKeys", "pivotColumn", "valueColumn", "aggregation"]),
    join: new Set([...common, "leftKey", "rightKey", "joinType", "rightPrefix"])
  };
  assertOnlyKeys(source, allowedByMode[mode], `transform mode=${mode}`);
  const output = {};
  if (Object.hasOwn(source, "mode")) output.mode = mode;
  for (const key of ["filterColumn", "sortColumn", "pivotColumn", "valueColumn", "leftKey", "rightKey", "rightPrefix"]) {
    if (Object.hasOwn(source, key)) output[key] = requiredOptionText(source[key], 180, `transform.${key}`);
  }
  // Preserve the shipped basic transform contract: [] means all columns and duplicates are de-duplicated.
  if (Object.hasOwn(source, "columns")) output.columns = normalizedBasicColumns(source.columns);
  if (Object.hasOwn(source, "filterValue")) {
    if (typeof source.filterValue !== "string") throw new Error("transform.filterValue 必须是字符串。" );
    output.filterValue = boundedOptionText(source.filterValue, 1000, "transform.filterValue");
  }
  if (Object.hasOwn(source, "sortDirection")) {
    if (!["asc", "desc"].includes(source.sortDirection)) throw new Error("transform.sortDirection 只能是 asc 或 desc。" );
    output.sortDirection = source.sortDirection;
  }
  if (Object.hasOwn(source, "limit")) {
    const limit = Number(source.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100000) throw new Error("transform.limit 必须在 1-100000 之间。" );
    output.limit = limit;
  }
  if (mode === "compute") output.computedColumns = normalizeComputedColumns(source.computedColumns);
  if (mode === "group") {
    output.groupBy = normalizedOptionTextArray(source.groupBy, 8, "transform.groupBy");
    output.aggregations = normalizeAggregations(source.aggregations);
  }
  if (mode === "pivot") {
    output.rowKeys = normalizedOptionTextArray(source.rowKeys, 8, "transform.rowKeys");
    output.pivotColumn = requiredOptionText(source.pivotColumn, 180, "transform.pivotColumn");
    output.valueColumn = requiredOptionText(source.valueColumn, 180, "transform.valueColumn");
    output.aggregation = requiredOptionText(source.aggregation, 32, "transform.aggregation");
    if (!aggregationOperators.has(output.aggregation)) throw new Error("transform.aggregation 无效。" );
  }
  if (mode === "join") {
    output.leftKey = requiredOptionText(source.leftKey, 180, "transform.leftKey");
    output.rightKey = requiredOptionText(source.rightKey, 180, "transform.rightKey");
    output.joinType = Object.hasOwn(source, "joinType") ? requiredOptionText(source.joinType, 24, "transform.joinType") : "inner";
    if (!["inner", "left", "right", "full"].includes(output.joinType)) throw new Error("transform.joinType 只能是 inner、left、right 或 full。" );
    output.rightPrefix = Object.hasOwn(source, "rightPrefix") ? normalizedOutputColumnKey(source.rightPrefix, "transform.rightPrefix") : "right";
  }
  return output;
}

function normalizeOperationOptions(operation, value = {}) {
  const allowed = operationOptionKeys[operation];
  if (!allowed) throw new Error(`未知 lineage operation options：${operation || "empty"}`);
  if (value !== undefined && value !== null && (typeof value !== "object" || Array.isArray(value))) {
    throw new Error(`${operation} options 必须是对象。`);
  }
  const source = objectValue(value);
  let serialized;
  try { serialized = JSON.stringify(source); } catch { throw new Error(`${operation} options 无法序列化。`); }
  if (Buffer.byteLength(serialized, "utf8") > MAX_OPERATION_OPTIONS_BYTES) throw new Error(`${operation} options 超过安全大小限制。`);
  assertOnlyKeys(source, allowed, `${operation} options`);
  if (operation === "transform") return normalizeTransformOptions(source);
  const output = {};
  if (operation === "report" || operation === "presentation") {
    const template = Object.hasOwn(source, "template") ? source.template : "standard";
    if (typeof template !== "string" || !dataDeliveryTemplates.has(template)) {
      throw new Error(`${operation}.template 只能是 standard、executive 或 research。`);
    }
    output.template = template;
  }
  const textKeys = ["filterColumn", "sortColumn", "xColumn", "yColumn", "title", "subtitle", "unit", "revenueColumn", "netIncomeColumn", "sharesColumn", "priceColumn", "symbolColumn", "quantityColumn", "costColumn", "metricKey"];
  for (const key of textKeys) {
    if (Object.hasOwn(source, key)) output[key] = boundedOptionText(source[key], key === "title" || key === "subtitle" ? 240 : 180, `${operation}.${key}`);
  }
  for (const key of ["trimStrings", "removeEmptyRows", "deduplicate"]) {
    if (!Object.hasOwn(source, key)) continue;
    if (typeof source[key] !== "boolean") throw new Error(`${operation}.${key} 必须是布尔值。`);
    output[key] = source[key];
  }
  if (Object.hasOwn(source, "chartType")) {
    if (!["bar", "line", "area", "scatter"].includes(source.chartType)) throw new Error("chart.chartType 无效。" );
    output.chartType = source.chartType;
  }
  if (operation === "scenario-workbook") {
    if (!output.metricKey) throw new Error("scenario-workbook.metricKey 不能为空。" );
    const upsidePercent = Number(source.upsidePercent);
    const stressPercent = Number(source.stressPercent);
    if (!Number.isFinite(upsidePercent) || upsidePercent <= 0 || upsidePercent > 200) throw new Error("scenario-workbook.upsidePercent 必须大于 0 且不超过 200。" );
    if (!Number.isFinite(stressPercent) || stressPercent <= -100 || stressPercent >= 0) throw new Error("scenario-workbook.stressPercent 必须大于 -100 且小于 0。" );
    output.upsidePercent = upsidePercent;
    output.stressPercent = stressPercent;
  }
  return output;
}

function operationOptionsForWorker(operation, value = {}) {
  if (value !== undefined && value !== null && (typeof value !== "object" || Array.isArray(value))) {
    throw new Error(`${operation} options 必须是对象。`);
  }
  const source = { ...objectValue(value) };
  if (Object.hasOwn(source, "structureVersion")) {
    if (!["report", "presentation"].includes(operation) || (operation === "report" ? ![1, 2].includes(source.structureVersion) : ![1, 2, DELIVERY_DECK_STRUCTURE_VERSION].includes(source.structureVersion))) {
      throw new Error(`${operation}.structureVersion provenance 元数据无效。`);
    }
    delete source.structureVersion;
  }
  if (Object.hasOwn(source, "reportRichBlocksVersion")) {
    if (operation !== "report" || source.reportRichBlocksVersion !== 1) throw new Error(`${operation}.reportRichBlocksVersion provenance 元数据无效。`);
    delete source.reportRichBlocksVersion;
  }
  if (Object.hasOwn(source, "presentationChartFormatVersion")) {
    if (operation !== "presentation" || source.presentationChartFormatVersion !== 1) throw new Error(`${operation}.presentationChartFormatVersion provenance 元数据无效。`);
    delete source.presentationChartFormatVersion;
  }
  const presentationStructureVersion = source.presentationStructureVersion;
  if (Object.hasOwn(source, "presentationStructureVersion")) {
    if (operation !== "presentation" || ![2, DELIVERY_DECK_STRUCTURE_VERSION].includes(presentationStructureVersion)) throw new Error(`${operation}.presentationStructureVersion provenance 元数据无效。`);
    delete source.presentationStructureVersion;
  }
  if (Object.hasOwn(source, "presentationTablePageVersion")) {
    if (operation !== "presentation" || source.presentationTablePageVersion !== 1 || presentationStructureVersion !== 2) {
      throw new Error(`${operation}.presentationTablePageVersion provenance 元数据无效。`);
    }
    delete source.presentationTablePageVersion;
  }
  if (Object.hasOwn(source, "reportDeliveryDeckVersion")) {
    if (operation !== "presentation" || source.reportDeliveryDeckVersion !== 1 || presentationStructureVersion !== DELIVERY_DECK_STRUCTURE_VERSION) {
      throw new Error(`${operation}.reportDeliveryDeckVersion provenance 元数据无效。`);
    }
    delete source.reportDeliveryDeckVersion;
  }
  return normalizeOperationOptions(operation, source);
}

function nowIso() {
  return new Date().toISOString();
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256File(filePath) {
  return sha256Bytes(readFileSync(filePath));
}

function lineageFailure(code, message) {
  return Object.assign(new Error(message), { code });
}

function normalizedRelative(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
}

function isInside(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function assertInside(candidate, root, label = "路径") {
  if (!isInside(candidate, root) || path.resolve(candidate) === path.resolve(root)) throw new Error(`${label}越出项目受控目录。`);
  return path.resolve(candidate);
}

function ensureDirectorySafe(directory, root) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(directory);
  if (resolved !== resolvedRoot) assertInside(resolved, resolvedRoot, "目录");
  mkdirSync(resolved, { recursive: true });
  let cursor = resolved;
  const stop = resolvedRoot;
  while (true) {
    const info = lstatSync(cursor);
    if (info.isSymbolicLink()) throw new Error("项目受控目录包含符号链接，已拒绝。" );
    if (cursor === stop) break;
    cursor = path.dirname(cursor);
  }
  return resolved;
}

const hardLinkUnsupportedCodes = new Set(["ENOSYS", "ENOTSUP", "EOPNOTSUPP", "EXDEV"]);

function hardLinkIsUnavailable(error, targetPath) {
  const code = String(error?.code || "");
  if (hardLinkUnsupportedCodes.has(code)) return true;
  return process.platform === "win32" && ["EINVAL", "EPERM"].includes(code) && !existsSync(targetPath);
}

function hasStableFileIdentity(info) {
  const device = info?.dev;
  const inode = info?.ino;
  if (typeof device === "bigint" && typeof inode === "bigint") return device >= 0n && inode > 0n;
  return Number.isSafeInteger(device) && Number.isSafeInteger(inode) && inode > 0;
}

function sameFileIdentity(left, right) {
  return hasStableFileIdentity(left) && hasStableFileIdentity(right) &&
    typeof left.dev === typeof right.dev && typeof left.ino === typeof right.ino &&
    left.dev === right.dev && left.ino === right.ino;
}

function fileIdentityConflicts(left, right) {
  const leftHasIdentity = hasStableFileIdentity(left);
  const rightHasIdentity = hasStableFileIdentity(right);
  if (!leftHasIdentity && !rightHasIdentity) return false;
  return !leftHasIdentity || !rightHasIdentity || !sameFileIdentity(left, right);
}

const EXPORT_CLEANUP_ATTEMPTS = 3;

function runSynchronousCheckpoint(checkpoint, stage, detail) {
  if (typeof checkpoint !== "function") return undefined;
  const result = checkpoint(stage, Object.freeze(detail));
  if (result && typeof result.then === "function") throw new Error(`${stage} checkpoint 必须同步完成。`);
  return result;
}

function safeErrorCode(error) {
  const code = String(error?.code || "UNKNOWN").toUpperCase();
  return /^[A-Z0-9_-]{1,80}$/.test(code) ? code : "UNKNOWN";
}

function recoveryEntry(kind, filePath, action, status = "pending") {
  const entry = Object.freeze({ kind, fileName: path.basename(filePath), action, status });
  return { entry, path: filePath };
}

function exportRecoveryFailure(code, message, cause, entries) {
  const normalizedEntries = (Array.isArray(entries) ? entries : []).filter(Boolean);
  const names = normalizedEntries.map((item) => item.entry.fileName).filter(Boolean);
  const failure = lineageFailure(code, `${message}${names.length ? `（受控恢复项：${names.join("、")}）` : ""}`);
  if (cause) Object.defineProperty(failure, "cause", { value: cause, configurable: true, enumerable: false });
  Object.defineProperty(failure, "recoveryPaths", {
    value: normalizedEntries.map((item) => item.path),
    configurable: true,
    enumerable: false
  });
  const cleanupPending = normalizedEntries.some((item) => !["clean", "restored"].includes(item.entry.status));
  failure.recovery = Object.freeze({
    cleanupPending,
    entries: Object.freeze(normalizedEntries.map((item) => item.entry))
  });
  return failure;
}

function lstatIdentityOrNull(filePath) {
  try {
    return lstatSync(filePath, { bigint: true });
  } catch (error) {
    if (String(error?.code || "") === "ENOENT") return null;
    throw error;
  }
}

function controlledCleanup(filePath, expectedIdentity, options, purpose) {
  let attempts = 0;
  let lastError = null;
  while (attempts < EXPORT_CLEANUP_ATTEMPTS) {
    const current = lstatIdentityOrNull(filePath);
    if (!current) {
      return { status: attempts > 0 ? "clean-after-retry" : "absent", attempts, pending: false, purpose, fileName: path.basename(filePath) };
    }
    if (!current.isFile() || current.isSymbolicLink() || !sameFileIdentity(current, expectedIdentity)) {
      return { status: "identity-changed", attempts, pending: true, purpose, fileName: path.basename(filePath), errorCode: "IDENTITY_CHANGED" };
    }
    attempts += 1;
    try {
      runSynchronousCheckpoint(options?.unlinkCheckpoint, purpose, {
        attempt: attempts,
        fileName: path.basename(filePath),
        targetPath: filePath
      });
      unlinkSync(filePath);
      return { status: attempts > 1 ? "clean-after-retry" : "clean", attempts, pending: false, purpose, fileName: path.basename(filePath) };
    } catch (error) {
      lastError = error;
    }
  }
  return {
    status: "residue",
    attempts,
    pending: true,
    purpose,
    fileName: path.basename(filePath),
    errorCode: safeErrorCode(lastError)
  };
}

function noteworthyCleanup(result) {
  return result && (result.pending || result.status === "clean-after-retry") ? result : null;
}

function mergeCleanupRecords(...groups) {
  const records = groups.flat().filter(Boolean);
  return {
    cleanupPending: records.some((record) => record.pending),
    cleanupRetried: records.some((record) => record.status === "clean-after-retry"),
    cleanupRecords: records
  };
}

function cleanupFailureFromResult(cause, filePath, result, kind = "partial-final") {
  const entry = recoveryEntry(kind, filePath, result?.status === "identity-changed" ? "inspect-and-restore" : "remove-controlled-residue", result?.status || "pending");
  const code = result?.status === "identity-changed" ? "LINEAGE_EXPORT_RESTORE_REQUIRED" : "LINEAGE_EXPORT_CLEANUP_INCOMPLETE";
  const message = result?.status === "identity-changed"
    ? "导出失败后检测到目标身份变化，已停止破坏性清理并要求受控恢复。"
    : "导出失败且受控残留清理未完成，需按恢复项处理。";
  return exportRecoveryFailure(code, message, cause, [entry]);
}

function nextExportRecoveryPath(filePath, label) {
  return `${filePath}.recovery-${label}-${process.pid}-${randomUUID()}`;
}

function restoreDetachedRecoveryNoOverwrite(recoveryPath, targetPath, recoveryIdentity, options) {
  let method = "hardlink-no-overwrite-atomic";
  try {
    linkSync(recoveryPath, targetPath);
  } catch (error) {
    if (String(error?.code || "") === "EEXIST") return { restored: false, occupied: true, cleanupRecords: [] };
    if (!hardLinkIsUnavailable(error, targetPath)) throw error;
    method = "exclusive-copy-non-overwrite-degraded";
    try {
      copyFileSync(recoveryPath, targetPath, fsConstants.COPYFILE_EXCL);
    } catch (copyError) {
      if (String(copyError?.code || "") === "EEXIST") return { restored: false, occupied: true, cleanupRecords: [] };
      throw copyError;
    }
  }
  const sourceAfterRestore = lstatSync(recoveryPath, { bigint: true });
  const targetAfterRestore = lstatSync(targetPath, { bigint: true });
  if (!sameFileIdentity(sourceAfterRestore, recoveryIdentity)) {
    throw exportRecoveryFailure(
      "LINEAGE_EXPORT_RESTORE_REQUIRED",
      "受控恢复源身份发生变化，已停止清理。",
      null,
      [recoveryEntry("recovery-source", recoveryPath, "inspect-and-restore")]
    );
  }
  if (
    !targetAfterRestore.isFile() || targetAfterRestore.isSymbolicLink() ||
    (method === "hardlink-no-overwrite-atomic" && !sameFileIdentity(targetAfterRestore, recoveryIdentity)) ||
    (method !== "hardlink-no-overwrite-atomic" && targetAfterRestore.size !== sourceAfterRestore.size)
  ) {
    throw exportRecoveryFailure(
      "LINEAGE_EXPORT_RESTORE_REQUIRED",
      "受控恢复结果身份无效，已保留恢复源。",
      null,
      [recoveryEntry("recovery-source", recoveryPath, "inspect-and-restore")]
    );
  }
  const cleanupResult = controlledCleanup(recoveryPath, recoveryIdentity, options, "restored-recovery");
  return {
    restored: true,
    occupied: false,
    method,
    cleanupRecords: [noteworthyCleanup(cleanupResult)].filter(Boolean)
  };
}

function cleanupFailedExclusiveTarget(filePath, identity, options, cause) {
  const recoveryPath = nextExportRecoveryPath(filePath, "partial");
  try {
    renameSync(filePath, recoveryPath);
  } catch (error) {
    if (String(error?.code || "") === "ENOENT") return;
    throw exportRecoveryFailure(
      "LINEAGE_EXPORT_CLEANUP_INCOMPLETE",
      "导出失败且无法隔离部分目标，需受控检查。",
      cause,
      [recoveryEntry("partial-final", filePath, "isolate-before-removal")]
    );
  }
  const detachedIdentity = lstatSync(recoveryPath, { bigint: true });
  if (sameFileIdentity(detachedIdentity, identity)) {
    const cleanupResult = controlledCleanup(recoveryPath, identity, options, "exclusive-failure-recovery");
    if (cleanupResult.pending) throw cleanupFailureFromResult(cause, recoveryPath, cleanupResult, "partial-final-recovery");
    return;
  }
  let restore = null;
  try {
    restore = restoreDetachedRecoveryNoOverwrite(recoveryPath, filePath, detachedIdentity, options);
  } catch (restoreError) {
    if (restoreError?.code === "LINEAGE_EXPORT_RESTORE_REQUIRED") throw restoreError;
    throw exportRecoveryFailure(
      "LINEAGE_EXPORT_RESTORE_REQUIRED",
      "导出失败清理时检测到其他文件身份，且无覆盖恢复失败。",
      cause,
      [recoveryEntry("detached-foreign-final", recoveryPath, "restore-without-overwrite")]
    );
  }
  const pendingRecord = restore.cleanupRecords.find((record) => record.pending);
  const status = restore.restored && !pendingRecord ? "restored" : pendingRecord?.status || "pending";
  throw exportRecoveryFailure(
    "LINEAGE_EXPORT_RESTORE_REQUIRED",
    restore.occupied
      ? "导出失败清理时检测到竞争目标；未覆盖该目标，并保留了受控恢复文件。"
      : "导出失败清理时检测到其他文件身份；已执行无覆盖恢复并停止继续清理。",
    cause,
    [recoveryEntry("detached-foreign-final", recoveryPath, restore.occupied ? "restore-without-overwrite" : "verify-restored-target", status)]
  );
}

function writeExclusiveTarget(filePath, bytes, options) {
  let descriptor = null;
  let identity = null;
  let failure = null;
  try {
    descriptor = openSync(filePath, "wx");
    identity = fstatSync(descriptor, { bigint: true });
    runSynchronousCheckpoint(options?.exclusiveCheckpoint, "after-open", { targetPath: filePath, byteLength: bytes.byteLength });
    if (options?.exclusiveFaultStage === "write") {
      writeFileSync(descriptor, bytes.subarray(0, Math.max(1, Math.floor(bytes.byteLength / 2))));
      runSynchronousCheckpoint(options?.exclusiveCheckpoint, "after-partial-write", { targetPath: filePath, byteLength: bytes.byteLength });
      throw new Error("injected exclusive fallback write failure");
    }
    writeFileSync(descriptor, bytes);
    runSynchronousCheckpoint(options?.exclusiveCheckpoint, "before-fsync", { targetPath: filePath, byteLength: bytes.byteLength });
    if (options?.exclusiveFaultStage === "fsync") throw new Error("injected exclusive fallback fsync failure");
    fsyncSync(descriptor);
    if (options?.exclusiveFaultStage === "close") {
      closeSync(descriptor);
      descriptor = null;
      throw new Error("injected exclusive fallback close failure");
    }
    closeSync(descriptor);
    descriptor = null;
    runSynchronousCheckpoint(options?.exclusiveCheckpoint, "after-close", { targetPath: filePath, byteLength: bytes.byteLength });
    const published = lstatSync(filePath, { bigint: true });
    if (
      !published.isFile() || published.isSymbolicLink() || published.nlink !== 1n ||
      published.size !== BigInt(bytes.byteLength) || fileIdentityConflicts(published, identity)
    ) throw new Error("独占导出文件发布后身份不一致。" );
    return identity;
  } catch (error) {
    failure = error;
  }
  if (descriptor !== null) {
    try {
      closeSync(descriptor);
    } catch (closeError) {
      if (!failure) failure = closeError;
      else Object.defineProperty(failure, "closeFailure", { value: closeError, configurable: true, enumerable: false });
    }
    descriptor = null;
  }
  if (identity) cleanupFailedExclusiveTarget(filePath, identity, options, failure);
  throw failure;
}

function targetAlreadyExistsFailure(cause) {
  const failure = lineageFailure("LINEAGE_EXPORT_TARGET_EXISTS", "导出目标在最终发布前已存在，已拒绝覆盖。" );
  if (cause) failure.cause = cause;
  return failure;
}

function injectedLinkFailure(options) {
  const code = String(options?.linkFaultCode || "").toUpperCase();
  if (!code) return null;
  const failure = new Error(`injected no-overwrite link failure: ${code}`);
  failure.code = code;
  return failure;
}

function publishNewNoOverwriteFile(temporary, temporaryIdentity, resolved, bytes, options) {
  let linked = false;
  if (options?.forceExclusiveFallback !== true) {
    try {
      const injectedFailure = injectedLinkFailure(options);
      if (injectedFailure) throw injectedFailure;
      linkSync(temporary, resolved);
      linked = true;
    } catch (error) {
      if (String(error?.code || "") === "EEXIST") throw targetAlreadyExistsFailure(error);
      if (!hardLinkIsUnavailable(error, resolved)) throw error;
    }
  }
  let finalIdentity = null;
  let method = "exclusive-non-overwrite-degraded";
  let visibility = "degraded-visible-before-fsync";
  if (linked) {
    finalIdentity = lstatSync(resolved, { bigint: true });
    if (!sameFileIdentity(finalIdentity, temporaryIdentity)) {
      throw exportRecoveryFailure(
        "LINEAGE_EXPORT_RESTORE_REQUIRED",
        "导出已建立最终目录项，但发布身份校验失败，需受控恢复。",
        null,
        [recoveryEntry("published-staging", temporary, "inspect-before-removal")]
      );
    }
    method = "hardlink-no-overwrite-atomic";
    visibility = "atomic";
  } else {
    try {
      finalIdentity = writeExclusiveTarget(resolved, bytes, options);
    } catch (error) {
      if (String(error?.code || "") === "EEXIST") throw targetAlreadyExistsFailure(error);
      throw error;
    }
  }
  const stagingCleanup = controlledCleanup(temporary, temporaryIdentity, options, "published-staging");
  const cleanup = mergeCleanupRecords(noteworthyCleanup(stagingCleanup));
  const finalAfterCleanup = lstatSync(resolved, { bigint: true });
  const stagingAfterCleanup = lstatIdentityOrNull(temporary);
  const managedHardlinkResidue = Boolean(
    linked && stagingAfterCleanup && sameFileIdentity(stagingAfterCleanup, temporaryIdentity)
  );
  const expectedFinalNlink = managedHardlinkResidue ? 2n : 1n;
  if (
    !finalAfterCleanup.isFile() || finalAfterCleanup.isSymbolicLink() ||
    finalAfterCleanup.size !== BigInt(bytes.byteLength) ||
    finalAfterCleanup.nlink !== expectedFinalNlink ||
    !sameFileIdentity(finalAfterCleanup, finalIdentity)
  ) {
    throw exportRecoveryFailure(
      "LINEAGE_EXPORT_RESTORE_REQUIRED",
      "导出已经提交，但最终文件身份随后发生变化，需受控核验。",
      null,
      [recoveryEntry("published-final", resolved, "inspect-published-result")]
    );
  }
  return {
    committed: true,
    method,
    visibility,
    finalIdentity,
    expectedFinalNlink: Number(expectedFinalNlink),
    ...cleanup
  };
}

function atomicWrite(filePath, bytes, root, options = {}) {
  const resolved = assertInside(filePath, root, "写入目标");
  ensureDirectorySafe(path.dirname(resolved), root);
  const payload = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const requireTargetAbsent = options?.requireTargetAbsent === true;
  const beforePublish = options?.beforePublish;
  if (beforePublish !== undefined && typeof beforePublish !== "function") throw new Error("写入发布 checkpoint 必须是函数。" );
  const temporary = `${resolved}.tmp-${process.pid}-${randomUUID()}`;
  let descriptor = null;
  let temporaryIdentity = null;
  let publication = null;
  let failure = null;
  try {
    descriptor = openSync(temporary, "wx");
    temporaryIdentity = fstatSync(descriptor, { bigint: true });
    writeFileSync(descriptor, payload);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    if (beforePublish) {
      const checkpointResult = beforePublish(Object.freeze({ targetPath: resolved, byteLength: payload.byteLength }));
      if (checkpointResult && typeof checkpointResult.then === "function") throw new Error("写入发布 checkpoint 必须同步完成。" );
    }
    if (requireTargetAbsent) {
      publication = publishNewNoOverwriteFile(temporary, temporaryIdentity, resolved, payload, options);
    } else {
      runSynchronousCheckpoint(options?.renameCheckpoint, "before-rename", {
        targetPath: resolved,
        temporaryPath: temporary,
        byteLength: payload.byteLength
      });
      renameSync(temporary, resolved);
      const finalIdentity = lstatSync(resolved, { bigint: true });
      if (
        !finalIdentity.isFile() || finalIdentity.isSymbolicLink() || finalIdentity.nlink !== 1n ||
        finalIdentity.size !== BigInt(payload.byteLength) || !sameFileIdentity(finalIdentity, temporaryIdentity)
      ) {
        throw exportRecoveryFailure(
          "LINEAGE_EXPORT_RESTORE_REQUIRED",
          "原子替换已经执行，但最终目录项身份无法确认，需受控核验。",
          null,
          [recoveryEntry("published-final", resolved, "inspect-published-result")]
        );
      }
      publication = {
        committed: true,
        method: "rename-replace-atomic",
        visibility: "atomic",
        finalIdentity,
        expectedFinalNlink: 1,
        cleanupPending: false,
        cleanupRetried: false,
        cleanupRecords: []
      };
    }
  } catch (error) {
    failure = error;
  }
  if (descriptor !== null) {
    try {
      closeSync(descriptor);
    } catch (closeError) {
      if (!failure) failure = closeError;
      else Object.defineProperty(failure, "closeFailure", { value: closeError, configurable: true, enumerable: false });
    }
    descriptor = null;
  }
  if (failure) {
    if (temporaryIdentity) {
      const cleanupResult = controlledCleanup(temporary, temporaryIdentity, options, "failed-staging");
      if (cleanupResult.pending) throw cleanupFailureFromResult(failure, temporary, cleanupResult, "failed-staging");
    }
    throw failure;
  }
  if (!publication?.committed) {
    throw lineageFailure("LINEAGE_EXPORT_RESTORE_REQUIRED", "写入结束但发布状态不明确，已停止继续处理。" );
  }
  return options?.returnPublicationResult === true
    ? { path: resolved, publication }
    : resolved;
}

function atomicWriteJson(filePath, value, root) {
  return atomicWrite(filePath, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"), root);
}

function lineageRoot(projectRoot) {
  return path.join(path.resolve(projectRoot), ".iiimage", "lineage");
}

function artifactRelativePath(artifactId) {
  return `.iiimage/lineage/artifacts/${safeId(artifactId)}/current.json`;
}

function artifactAbsolutePath(projectRoot, relativePath) {
  const normalized = normalizedRelative(relativePath);
  if (!/^\.iiimage\/lineage\/artifacts\/[a-zA-Z0-9._-]+\/current\.json$/.test(normalized)) {
    throw new Error("Lineage artifact 路径不符合受控结构。" );
  }
  return assertInside(path.join(projectRoot, ...normalized.split("/")), projectRoot, "Artifact 路径");
}

function artifactRevisionPath(projectRoot, artifactId, revision) {
  const currentPath = artifactAbsolutePath(projectRoot, artifactRelativePath(artifactId));
  const numericRevision = Number(revision);
  if (!Number.isSafeInteger(numericRevision) || numericRevision < 1) throw lineageFailure("LINEAGE_JOURNAL_INVALID", "Lineage revision 无效。" );
  return assertInside(path.join(path.dirname(currentPath), "revisions", `r${numericRevision}.json`), projectRoot, "Artifact revision 路径");
}

function lineageMutationJournalPath(projectRoot) {
  return assertInside(path.join(lineageRoot(projectRoot), LINEAGE_MUTATION_JOURNAL_FILE), projectRoot, "Lineage journal 路径");
}

function strictLineageJournalSnapshot(value, label, allowNull = false) {
  if (allowNull && (value === null || value === undefined)) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw lineageFailure("LINEAGE_JOURNAL_INVALID", `${label} 无效。`);
  const allowed = new Set(["artifactId", "relativePath", "revision", "sha256"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw lineageFailure("LINEAGE_JOURNAL_INVALID", `${label} 包含未知字段。`);
  const artifactId = String(value.artifactId || "");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,179}$/.test(artifactId)) throw lineageFailure("LINEAGE_JOURNAL_INVALID", `${label} artifactId 无效。`);
  const relativePath = normalizedRelative(value.relativePath);
  if (relativePath !== artifactRelativePath(artifactId)) throw lineageFailure("LINEAGE_JOURNAL_INVALID", `${label} 路径与 artifactId 不一致。`);
  const revision = Number(value.revision);
  if (!Number.isSafeInteger(revision) || revision < 1) throw lineageFailure("LINEAGE_JOURNAL_INVALID", `${label} revision 无效。`);
  const sha256 = String(value.sha256 || "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw lineageFailure("LINEAGE_JOURNAL_INVALID", `${label} SHA-256 无效。`);
  return { artifactId, relativePath, revision, sha256 };
}

function strictLineageMutationKind(value, label = "Lineage mutation kind") {
  const kind = String(value || "").trim();
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(kind)) throw lineageFailure("LINEAGE_JOURNAL_INVALID", `${label} 无效。`);
  return kind;
}

function strictLineageJournalSource(value, label, allowNull = false) {
  if (allowNull && (value === null || value === undefined)) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw lineageFailure("LINEAGE_JOURNAL_INVALID", `${label} 无效。`);
  const allowed = new Set(["relativePath", "sha256", "byteLength", "existedBefore"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw lineageFailure("LINEAGE_JOURNAL_INVALID", `${label} 包含未知字段。`);
  const relativePath = normalizedRelative(value.relativePath);
  const sha256 = String(value.sha256 || "").toLowerCase();
  const byteLength = Number(value.byteLength);
  if (
    !/^\.iiimage\/lineage\/sources\/[a-f0-9]{12}-[^/]+$/i.test(relativePath) ||
    !/^[a-f0-9]{64}$/.test(sha256) ||
    !Number.isSafeInteger(byteLength) ||
    byteLength < 1 ||
    byteLength > MAX_SOURCE_BYTES ||
    typeof value.existedBefore !== "boolean"
  ) throw lineageFailure("LINEAGE_JOURNAL_INVALID", `${label} 身份无效。`);
  return { relativePath, sha256, byteLength, existedBefore: value.existedBefore };
}

function strictLineageJournalSourceHistory(value, label, allowNull = false) {
  if (allowNull && (value === null || value === undefined)) return null;
  try {
    return normalizeLineageSourceHistory(value, label);
  } catch (error) {
    throw lineageFailure("LINEAGE_JOURNAL_INVALID", error instanceof Error ? error.message : `${label} 无效。`);
  }
}

function strictLineageMutationJournal(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw lineageFailure("LINEAGE_JOURNAL_INVALID", "Lineage mutation journal 无效。" );
  const allowed = new Set(["format", "version", "projectId", "projectKind", "mutationKind", "phase", "mutations"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw lineageFailure("LINEAGE_JOURNAL_INVALID", "Lineage mutation journal 包含未知字段。" );
  const inputVersion = Number(value.version);
  if (value.format !== LINEAGE_MUTATION_JOURNAL_FORMAT || ![1, LINEAGE_MUTATION_JOURNAL_VERSION].includes(inputVersion)) {
    throw lineageFailure("LINEAGE_JOURNAL_INVALID", "Lineage mutation journal 格式或版本无效。" );
  }
  const projectId = String(value.projectId || "");
  if (!projectId || projectId.length > 180 || /[\u0000-\u001f\u007f]/.test(projectId)) throw lineageFailure("LINEAGE_JOURNAL_INVALID", "Lineage journal projectId 无效。" );
  const projectKind = String(value.projectKind || "");
  if (!lineageProjectKinds.has(projectKind)) throw lineageFailure("LINEAGE_JOURNAL_INVALID", "Lineage journal projectKind 无效。" );
  const mutationKind = strictLineageMutationKind(value.mutationKind);
  const phase = String(value.phase || "");
  if (!LINEAGE_MUTATION_PHASES.has(phase)) throw lineageFailure("LINEAGE_JOURNAL_INVALID", "Lineage journal phase 无效。" );
  if (!Array.isArray(value.mutations) || value.mutations.length < 1 || value.mutations.length > 20) {
    throw lineageFailure("LINEAGE_JOURNAL_INVALID", "Lineage mutation journal 必须包含 1-20 个 mutation。" );
  }
  const usedIds = new Set();
  const mutations = value.mutations.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw lineageFailure("LINEAGE_JOURNAL_INVALID", `Lineage journal mutation #${index + 1} 无效。`);
    const mutationAllowed = new Set(["artifactId", "mutationKind", "previous", "committed", "source", "previousSourceHistory", "committedSourceHistory"]);
    if (Object.keys(candidate).some((key) => !mutationAllowed.has(key))) throw lineageFailure("LINEAGE_JOURNAL_INVALID", `Lineage journal mutation #${index + 1} 包含未知字段。`);
    const artifactId = strictLineageId(candidate.artifactId, `Lineage journal artifactId #${index + 1}`);
    if (usedIds.has(artifactId)) throw lineageFailure("LINEAGE_JOURNAL_INVALID", `Lineage journal artifactId 重复：${artifactId}`);
    usedIds.add(artifactId);
    const entryMutationKind = strictLineageMutationKind(candidate.mutationKind, `Lineage journal mutation kind #${index + 1}`);
    const previous = strictLineageJournalSnapshot(candidate.previous, `Lineage journal previous #${index + 1}`, true);
    const committed = strictLineageJournalSnapshot(candidate.committed, `Lineage journal committed #${index + 1}`, true);
    const source = strictLineageJournalSource(candidate.source, `Lineage journal source #${index + 1}`, true);
    const previousSourceHistory = strictLineageJournalSourceHistory(candidate.previousSourceHistory, `Lineage journal previous source history #${index + 1}`, true);
    const committedSourceHistory = strictLineageJournalSourceHistory(candidate.committedSourceHistory, `Lineage journal committed source history #${index + 1}`, true);
    if (previous && previous.artifactId !== artifactId) throw lineageFailure("LINEAGE_JOURNAL_INVALID", "Lineage journal previous artifactId 不一致。" );
    if (committed && committed.artifactId !== artifactId) throw lineageFailure("LINEAGE_JOURNAL_INVALID", "Lineage journal committed artifactId 不一致。" );
    if (committed && previous && committed.revision !== previous.revision + 1) throw lineageFailure("LINEAGE_JOURNAL_INVALID", "Lineage journal revision 不连续。" );
    if (committed && !previous && committed.revision !== 1) throw lineageFailure("LINEAGE_JOURNAL_INVALID", "新 Lineage artifact 必须从 revision 1 开始。" );
    if (previousSourceHistory && (!previous || previousSourceHistory.at(-1)?.artifactRevision !== previous.revision)) {
      throw lineageFailure("LINEAGE_JOURNAL_INVALID", `Lineage journal previous source history 与 revision 不一致：${artifactId}`);
    }
    if (committedSourceHistory && (!committed || committedSourceHistory.at(-1)?.artifactRevision !== committed.revision)) {
      throw lineageFailure("LINEAGE_JOURNAL_INVALID", `Lineage journal committed source history 与 revision 不一致：${artifactId}`);
    }
    if (previousSourceHistory && committedSourceHistory) {
      const prefix = committedSourceHistory.slice(0, previousSourceHistory.length);
      if (committedSourceHistory.length !== previousSourceHistory.length + 1 || JSON.stringify(prefix) !== JSON.stringify(previousSourceHistory)) {
        throw lineageFailure("LINEAGE_JOURNAL_INVALID", `Lineage journal source history 不是 append-only：${artifactId}`);
      }
    }
    if (!previousSourceHistory && previous && committedSourceHistory) {
      throw lineageFailure("LINEAGE_JOURNAL_INVALID", `Lineage journal 不能为无来源历史的既有 artifact 补造历史：${artifactId}`);
    }
    if (source && committedSourceHistory) {
      const latest = committedSourceHistory.at(-1);
      if (latest.relativePath !== source.relativePath || latest.sha256 !== source.sha256 || latest.byteLength !== source.byteLength) {
        throw lineageFailure("LINEAGE_JOURNAL_INVALID", `Lineage journal source 与 committed source history 不一致：${artifactId}`);
      }
    }
    return { artifactId, mutationKind: entryMutationKind, previous, committed, source, previousSourceHistory, committedSourceHistory };
  });
  if (["artifacts-committed", "session-writing"].includes(phase) && mutations.some((mutation) => !mutation.committed)) {
    throw lineageFailure("LINEAGE_JOURNAL_INVALID", `Lineage journal phase=${phase} 但存在未提交 artifact。`);
  }
  return { format: value.format, version: LINEAGE_MUTATION_JOURNAL_VERSION, projectId, projectKind, mutationKind, phase, mutations };
}

function readLineageMutationJournal(projectRoot) {
  const journalPath = lineageMutationJournalPath(projectRoot);
  if (!existsSync(journalPath)) return null;
  const info = lstatSync(journalPath);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 2 || info.size > LINEAGE_MUTATION_JOURNAL_MAX_BYTES) {
    throw lineageFailure("LINEAGE_JOURNAL_INVALID", "Lineage mutation journal 文件身份或大小无效。" );
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(journalPath, "utf8"));
  } catch {
    throw lineageFailure("LINEAGE_JOURNAL_INVALID", "Lineage mutation journal JSON 损坏。" );
  }
  return strictLineageMutationJournal(parsed);
}

function writeLineageMutationJournal(projectRoot, value, options = {}) {
  const journal = strictLineageMutationJournal(value);
  const existing = readLineageMutationJournal(projectRoot);
  if (options.create === true && existing) throw lineageFailure("LINEAGE_JOURNAL_CONFLICT", "Lineage 项目已有未恢复 mutation journal。" );
  if (options.create !== true && !existing) throw lineageFailure("LINEAGE_JOURNAL_MISSING", "Lineage mutation journal 不存在，无法推进阶段。" );
  if (existing) {
    if (existing.projectId !== journal.projectId || existing.projectKind !== journal.projectKind || existing.mutationKind !== journal.mutationKind) {
      throw lineageFailure("LINEAGE_JOURNAL_CONFLICT", "Lineage mutation journal 身份在推进期间变化。" );
    }
    if (journal.mutations.length !== existing.mutations.length || journal.mutations.some((mutation, index) => {
      const before = existing.mutations[index];
      return !before || mutation.artifactId !== before.artifactId || mutation.mutationKind !== before.mutationKind || JSON.stringify(mutation.previous) !== JSON.stringify(before.previous) || JSON.stringify(mutation.previousSourceHistory) !== JSON.stringify(before.previousSourceHistory);
    })) throw lineageFailure("LINEAGE_JOURNAL_CONFLICT", "Lineage mutation journal 计划在推进期间变化。" );
    if (LINEAGE_MUTATION_PHASE_ORDER[journal.phase] < LINEAGE_MUTATION_PHASE_ORDER[existing.phase]) {
      throw lineageFailure("LINEAGE_JOURNAL_CONFLICT", "Lineage mutation journal phase 不得回退。" );
    }
    for (let index = 0; index < existing.mutations.length; index += 1) {
      const before = existing.mutations[index];
      const after = journal.mutations[index];
      if (before.committed && JSON.stringify(before.committed) !== JSON.stringify(after.committed)) throw lineageFailure("LINEAGE_JOURNAL_CONFLICT", "Lineage committed 快照在推进期间变化。" );
      if (before.source && JSON.stringify(before.source) !== JSON.stringify(after.source)) throw lineageFailure("LINEAGE_JOURNAL_CONFLICT", "Lineage source 快照在推进期间变化。" );
      if (before.committedSourceHistory && JSON.stringify(before.committedSourceHistory) !== JSON.stringify(after.committedSourceHistory)) throw lineageFailure("LINEAGE_JOURNAL_CONFLICT", "Lineage committed source history 在推进期间变化。" );
    }
  } else {
    for (const mutation of journal.mutations) {
      const currentPath = artifactAbsolutePath(projectRoot, artifactRelativePath(mutation.artifactId));
      const artifactDirectory = path.dirname(currentPath);
      if (!mutation.previous) {
        if (existsSync(artifactDirectory)) throw lineageFailure("LINEAGE_JOURNAL_CONFLICT", `Lineage 新 artifact 目标已存在：${mutation.artifactId}`);
        continue;
      }
      const currentSha = controlledLineageFileSha(currentPath, projectRoot, "Lineage current");
      const previousRevisionPath = artifactRevisionPath(projectRoot, mutation.artifactId, mutation.previous.revision);
      const previousRevisionSha = controlledLineageFileSha(previousRevisionPath, projectRoot, "Lineage previous revision");
      if (currentSha !== mutation.previous.sha256 || previousRevisionSha !== mutation.previous.sha256) {
        throw lineageFailure("LINEAGE_JOURNAL_CONFLICT", `Lineage previous 磁盘快照不一致：${mutation.artifactId}`);
      }
      const targetRevisionPath = artifactRevisionPath(projectRoot, mutation.artifactId, mutation.previous.revision + 1);
      if (existsSync(targetRevisionPath)) throw lineageFailure("LINEAGE_JOURNAL_CONFLICT", `Lineage 目标 revision 已存在：${mutation.artifactId}`);
    }
  }
  const serialized = `${JSON.stringify(journal, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > LINEAGE_MUTATION_JOURNAL_MAX_BYTES) throw lineageFailure("LINEAGE_JOURNAL_INVALID", "Lineage mutation journal 超过大小限制。" );
  atomicWriteJson(lineageMutationJournalPath(projectRoot), journal, projectRoot);
  return journal;
}

function clearLineageMutationJournal(projectRoot, projectId) {
  const journal = readLineageMutationJournal(projectRoot);
  if (!journal) return false;
  if (journal.projectId !== String(projectId || "")) throw lineageFailure("LINEAGE_JOURNAL_CONFLICT", "拒绝清理其他项目的 Lineage mutation journal。" );
  rmSync(lineageMutationJournalPath(projectRoot));
  return true;
}

function lineageJournalSnapshotFromDescriptor(value) {
  if (!value || typeof value !== "object") return null;
  return strictLineageJournalSnapshot({
    artifactId: value.id,
    relativePath: value.relativePath,
    revision: value.revision,
    sha256: value.contentSha256
  }, "Lineage session artifact");
}

function lineageJournalSourceHistoryFromDescriptor(value) {
  if (!value || typeof value !== "object") return null;
  const provenance = objectValue(value.provenance);
  if (Array.isArray(provenance.sourceHistory)) {
    return strictLineageJournalSourceHistory(provenance.sourceHistory, `Lineage artifact ${String(value.id || "")} source history`);
  }
  if (provenance.source && typeof provenance.source === "object") {
    const revision = Number(value.revision);
    if (!Number.isSafeInteger(revision) || revision < 1) throw lineageFailure("LINEAGE_JOURNAL_INVALID", "Lineage source history projection revision 无效。");
    return strictLineageJournalSourceHistory([{ artifactRevision: revision, ...provenance.source }], `Lineage artifact ${String(value.id || "")} legacy source history`);
  }
  return null;
}

function sameLineageJournalSnapshot(left, right) {
  return Boolean(left && right) &&
    left.artifactId === right.artifactId &&
    left.relativePath === right.relativePath &&
    left.revision === right.revision &&
    left.sha256 === right.sha256;
}

function controlledLineageFileSha(filePath, projectRoot, label) {
  assertInside(filePath, projectRoot, label);
  if (!existsSync(filePath)) return "";
  const info = lstatSync(filePath);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 2 || info.size > MAX_ARTIFACT_BYTES) {
    throw lineageFailure("LINEAGE_JOURNAL_CONFLICT", `${label} 文件身份或大小无效。`);
  }
  return sha256File(filePath);
}

function controlledLineageSourcePath(projectRoot, relativePath) {
  const normalized = normalizedRelative(relativePath);
  if (!/^\.iiimage\/lineage\/sources\/[a-f0-9]{12}-[^/]+$/i.test(normalized)) throw lineageFailure("LINEAGE_JOURNAL_INVALID", "Lineage source 路径无效。" );
  return assertInside(path.join(projectRoot, ...normalized.split("/")), projectRoot, "Lineage source 路径");
}

function cleanupLineageAtomicTemps(targetPath, projectRoot) {
  const directory = path.dirname(assertInside(targetPath, projectRoot, "Lineage 临时文件目标"));
  if (!existsSync(directory)) return 0;
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw lineageFailure("LINEAGE_JOURNAL_CONFLICT", "Lineage 临时文件目录身份无效。" );
  const prefix = `${path.basename(targetPath)}.tmp-`;
  let removed = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.name.startsWith(prefix)) continue;
    if (!/^.+\.tmp-\d+-[a-f0-9-]{16,}$/i.test(entry.name) || !entry.isFile() || entry.isSymbolicLink()) {
      throw lineageFailure("LINEAGE_JOURNAL_CONFLICT", `Lineage 出现未知临时文件：${entry.name}`);
    }
    rmSync(assertInside(path.join(directory, entry.name), projectRoot, "Lineage 临时文件"));
    removed += 1;
  }
  return removed;
}

function recoverLineageMutationJournal(projectRoot, session, project = {}) {
  const resolvedRoot = path.resolve(projectRoot);
  const journalPath = lineageMutationJournalPath(resolvedRoot);
  cleanupLineageAtomicTemps(journalPath, resolvedRoot);
  const journal = readLineageMutationJournal(resolvedRoot);
  if (!journal) return { recovered: false, action: "none", mutationCount: 0 };
  if (journal.projectId !== String(project.id || "") || journal.projectKind !== String(project.kind || "")) {
    throw lineageFailure("LINEAGE_JOURNAL_CONFLICT", "Lineage mutation journal 与目标项目身份不一致，已停止恢复。" );
  }
  const rawArtifacts = Array.isArray(session?.lineageArtifacts) ? session.lineageArtifacts : [];
  const rawById = new Map();
  for (const artifact of rawArtifacts) {
    const id = strictLineageId(artifact?.id, "Lineage recovery session artifactId");
    if (rawById.has(id)) throw lineageFailure("LINEAGE_JOURNAL_CONFLICT", `Lineage session artifactId 重复：${id}`);
    rawById.set(id, artifact);
  }
  const states = journal.mutations.map((mutation) => {
    const artifact = rawById.get(mutation.artifactId) || null;
    const sessionSnapshot = artifact ? lineageJournalSnapshotFromDescriptor(artifact) : null;
    const sessionSourceHistory = artifact ? lineageJournalSourceHistoryFromDescriptor(artifact) : null;
    if (mutation.committed && sameLineageJournalSnapshot(sessionSnapshot, mutation.committed) && (!mutation.committedSourceHistory || JSON.stringify(sessionSourceHistory) === JSON.stringify(mutation.committedSourceHistory))) return { state: "committed", mutation, artifact };
    if ((mutation.previous ? sameLineageJournalSnapshot(sessionSnapshot, mutation.previous) : sessionSnapshot === null) && (!mutation.previousSourceHistory || JSON.stringify(sessionSourceHistory) === JSON.stringify(mutation.previousSourceHistory))) return { state: "previous", mutation, artifact };
    throw lineageFailure("LINEAGE_JOURNAL_CONFLICT", `Lineage session 与 journal 快照不一致：${mutation.artifactId}`);
  });
  const committedCount = states.filter((item) => item.state === "committed").length;
  if (committedCount && committedCount !== states.length) throw lineageFailure("LINEAGE_JOURNAL_CONFLICT", "Lineage session 只引用了部分 journal mutation，已停止猜测恢复。" );

  const inspectSource = (mutation, requirePresent) => {
    if (!mutation.source) return;
    const sourcePath = controlledLineageSourcePath(resolvedRoot, mutation.source.relativePath);
    if (!existsSync(sourcePath)) {
      if (requirePresent) throw lineageFailure("LINEAGE_JOURNAL_CONFLICT", `Lineage source 文件缺失：${mutation.artifactId}`);
      return;
    }
    const info = lstatSync(sourcePath);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== mutation.source.byteLength || sha256File(sourcePath) !== mutation.source.sha256) {
      throw lineageFailure("LINEAGE_JOURNAL_CONFLICT", `Lineage source 文件与 journal 不一致：${mutation.artifactId}`);
    }
  };

  const inspectCommittedFiles = (mutation) => {
    if (!mutation.committed) throw lineageFailure("LINEAGE_JOURNAL_CONFLICT", `Lineage committed 快照缺失：${mutation.artifactId}`);
    const currentPath = artifactAbsolutePath(resolvedRoot, mutation.committed.relativePath);
    const revisionPath = artifactRevisionPath(resolvedRoot, mutation.artifactId, mutation.committed.revision);
    cleanupLineageAtomicTemps(currentPath, resolvedRoot);
    cleanupLineageAtomicTemps(revisionPath, resolvedRoot);
    if (controlledLineageFileSha(currentPath, resolvedRoot, "Lineage current") !== mutation.committed.sha256 || controlledLineageFileSha(revisionPath, resolvedRoot, "Lineage committed revision") !== mutation.committed.sha256) {
      throw lineageFailure("LINEAGE_JOURNAL_CONFLICT", `Lineage committed 文件无法由 journal 证明：${mutation.artifactId}`);
    }
    inspectSource(mutation, true);
    if (mutation.source) {
      const descriptorSource = objectValue(rawById.get(mutation.artifactId)?.provenance).source;
      if (!descriptorSource || normalizedRelative(descriptorSource.relativePath) !== mutation.source.relativePath || String(descriptorSource.sha256 || "").toLowerCase() !== mutation.source.sha256 || Number(descriptorSource.byteLength) !== mutation.source.byteLength) {
        throw lineageFailure("LINEAGE_JOURNAL_CONFLICT", `Lineage session source 与 journal 不一致：${mutation.artifactId}`);
      }
    }
    if (mutation.committedSourceHistory) {
      const descriptorHistory = lineageJournalSourceHistoryFromDescriptor(rawById.get(mutation.artifactId));
      if (JSON.stringify(descriptorHistory) !== JSON.stringify(mutation.committedSourceHistory)) {
        throw lineageFailure("LINEAGE_JOURNAL_CONFLICT", `Lineage session source history 与 journal 不一致：${mutation.artifactId}`);
      }
    }
  };

  if (committedCount === states.length) {
    for (const { mutation } of states) inspectCommittedFiles(mutation);
    clearLineageMutationJournal(resolvedRoot, journal.projectId);
    return { recovered: true, action: "journal-cleared-after-session-commit", mutationCount: states.length };
  }

  for (const { mutation } of [...states].reverse()) {
    if (mutation.committed) {
      const currentPath = artifactAbsolutePath(resolvedRoot, mutation.committed.relativePath);
      const committedRevisionPath = artifactRevisionPath(resolvedRoot, mutation.artifactId, mutation.committed.revision);
      cleanupLineageAtomicTemps(currentPath, resolvedRoot);
      cleanupLineageAtomicTemps(committedRevisionPath, resolvedRoot);
      const currentSha = controlledLineageFileSha(currentPath, resolvedRoot, "Lineage current");
      const committedRevisionSha = controlledLineageFileSha(committedRevisionPath, resolvedRoot, "Lineage committed revision");
      if (committedRevisionSha && committedRevisionSha !== mutation.committed.sha256) throw lineageFailure("LINEAGE_JOURNAL_CONFLICT", `Lineage committed revision SHA 冲突：${mutation.artifactId}`);
      if (currentSha && currentSha !== mutation.committed.sha256 && (!mutation.previous || currentSha !== mutation.previous.sha256)) throw lineageFailure("LINEAGE_JOURNAL_CONFLICT", `Lineage current SHA 冲突：${mutation.artifactId}`);
      if (mutation.previous) {
        const previousRevisionPath = artifactRevisionPath(resolvedRoot, mutation.artifactId, mutation.previous.revision);
        cleanupLineageAtomicTemps(previousRevisionPath, resolvedRoot);
        if (controlledLineageFileSha(previousRevisionPath, resolvedRoot, "Lineage previous revision") !== mutation.previous.sha256) throw lineageFailure("LINEAGE_JOURNAL_CONFLICT", `Lineage previous revision 缺失：${mutation.artifactId}`);
        if (currentSha !== mutation.previous.sha256) atomicWrite(currentPath, readFileSync(previousRevisionPath), resolvedRoot);
        if (committedRevisionSha) rmSync(committedRevisionPath);
      } else {
        if (currentSha) rmSync(currentPath);
        if (committedRevisionSha) rmSync(committedRevisionPath);
        const revisionsDirectory = path.dirname(committedRevisionPath);
        const artifactDirectory = path.dirname(currentPath);
        if (existsSync(revisionsDirectory)) {
          const remaining = readdirSync(revisionsDirectory);
          if (remaining.length) throw lineageFailure("LINEAGE_JOURNAL_CONFLICT", `Lineage 新 artifact revisions 目录含未知文件：${mutation.artifactId}`);
          rmdirSync(revisionsDirectory);
        }
        if (existsSync(artifactDirectory)) {
          const remaining = readdirSync(artifactDirectory);
          if (remaining.length) throw lineageFailure("LINEAGE_JOURNAL_CONFLICT", `Lineage 新 artifact 目录含未知文件：${mutation.artifactId}`);
          rmdirSync(artifactDirectory);
        }
      }
    } else if (mutation.previous) {
      const currentPath = artifactAbsolutePath(resolvedRoot, mutation.previous.relativePath);
      const previousRevisionPath = artifactRevisionPath(resolvedRoot, mutation.artifactId, mutation.previous.revision);
      if (controlledLineageFileSha(currentPath, resolvedRoot, "Lineage current") !== mutation.previous.sha256 || controlledLineageFileSha(previousRevisionPath, resolvedRoot, "Lineage previous revision") !== mutation.previous.sha256) {
        throw lineageFailure("LINEAGE_JOURNAL_CONFLICT", `Lineage prepared previous 快照不一致：${mutation.artifactId}`);
      }
    } else {
      const artifactDirectory = path.dirname(artifactAbsolutePath(resolvedRoot, artifactRelativePath(mutation.artifactId)));
      if (existsSync(artifactDirectory)) throw lineageFailure("LINEAGE_JOURNAL_CONFLICT", `Lineage prepared 新 artifact 目录异常存在：${mutation.artifactId}`);
    }
    inspectSource(mutation, false);
    if (mutation.source && !mutation.source.existedBefore) {
      const sourcePath = controlledLineageSourcePath(resolvedRoot, mutation.source.relativePath);
      if (existsSync(sourcePath)) rmSync(sourcePath);
    }
  }
  clearLineageMutationJournal(resolvedRoot, journal.projectId);
  return { recovered: true, action: "artifact-rollback", mutationCount: states.length };
}

function allowedKinds(projectKind) {
  if (projectKind === "data") return dataArtifactKinds;
  if (projectKind === "finance") return financeArtifactKinds;
  throw new Error(`不支持的 lineage 项目类型：${projectKind}`);
}

function normalizeFinanceContext(value = {}, required = true) {
  const source = objectValue(value);
  assertOnlyKeys(source, new Set(["asOf", "sourceName", "sourceUrl", "currency", "unit", "timezone", "disclaimer"]), "Finance context");
  const rawAsOf = cleanOneLine(source.asOf, 64);
  let asOf = "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(rawAsOf)) {
    const parsed = new Date(`${rawAsOf}T00:00:00.000Z`);
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === rawAsOf) asOf = rawAsOf;
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(rawAsOf)) {
    const parsed = Date.parse(rawAsOf);
    if (Number.isFinite(parsed)) asOf = new Date(parsed).toISOString();
  }
  const sourceName = cleanOneLine(source.sourceName, 200);
  let sourceUrl = "";
  const rawSourceUrl = cleanOneLine(source.sourceUrl, 500);
  const currency = cleanOneLine(source.currency, 24).toUpperCase();
  const unit = cleanOneLine(source.unit, 40);
  const timezone = cleanOneLine(source.timezone, 80);
  if (required && (!asOf || !sourceName || !currency || !unit || !timezone)) {
    throw new Error("Finance artifact 必须提供 as-of、来源、币种、单位与时区。" );
  }
  if (rawAsOf && !asOf) throw new Error("Finance as-of 必须是真实 ISO 日期或带时区的 ISO 时间。" );
  if (currency && !/^[A-Z]{3}$/.test(currency)) throw new Error("Finance 币种必须使用三位 ISO 代码。" );
  if (timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date(0));
    } catch {
      throw new Error("Finance 时区必须是有效的 IANA timezone。" );
    }
  }
  if (rawSourceUrl) {
    let parsed;
    try {
      parsed = new URL(rawSourceUrl);
    } catch {
      throw new Error("Finance 来源 URL 无效。" );
    }
    if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) {
      throw new Error("Finance 来源 URL 只允许无凭证的 HTTPS 地址。" );
    }
    parsed.hash = "";
    sourceUrl = parsed.toString();
  }
  const context = {
    asOf,
    sourceName,
    ...(sourceUrl ? { sourceUrl } : {}),
    currency,
    unit,
    timezone,
    disclaimer: "仅供信息与研究，不构成投资建议；市场数据可能延迟或不完整。"
  };
  return context;
}

function financeContextMismatchFields(left, right) {
  return financeContextIdentityKeys.filter((key) => String(left?.[key] || "") !== String(right?.[key] || ""));
}

function financeScaleForUnit(value) {
  const unit = cleanOneLine(value, 40).toLowerCase();
  return Object.hasOwn(financeMetricScaleByUnit, unit) ? financeMetricScaleByUnit[unit] : null;
}

function aggregateScenarioFinanceContext(contexts) {
  if (contexts.length < 2) throw new Error("scenario-workbook 至少需要两个 Finance 来源。" );
  const inherited = contexts[0];
  for (const context of contexts.slice(1)) {
    const mismatches = financeScenarioComparableKeys.filter((key) => String(inherited?.[key] || "") !== String(context?.[key] || ""));
    if (mismatches.length) throw new Error(`Finance scenario 来源口径不一致：${mismatches.join(", ")}。`);
  }
  return normalizeFinanceContext({
    asOf: inherited.asOf,
    sourceName: `${contexts.length} 个受控 Finance 来源`,
    currency: inherited.currency,
    unit: inherited.unit,
    timezone: inherited.timezone
  }, true);
}

function scenarioWorkerText(value, maximum) {
  return String(value ?? "").replace(/\u0000/g, "").slice(0, maximum);
}

function canonicalScenarioWorkbookFromSources(sourcesInput, optionsInput = {}) {
  const sources = [...sourcesInput].sort((left, right) => String(left?.id || "").localeCompare(String(right?.id || ""), "en"));
  if (sources.length < 2 || sources.length > 12) throw new Error("scenario-workbook 需要 2-12 个来源。" );
  const options = objectValue(optionsInput);
  const metricKey = cleanOneLine(options.metricKey, 80);
  const metricPolicy = Object.hasOwn(financeScenarioMetricPolicies, metricKey) ? financeScenarioMetricPolicies[metricKey] : null;
  const upsidePercent = Number(options.upsidePercent);
  const stressPercent = Number(options.stressPercent);
  if (!metricPolicy) throw new Error("scenario-workbook 仅支持非负市值指标 marketCap 或 marketValue。" );
  if (!Number.isFinite(upsidePercent) || upsidePercent <= 0 || upsidePercent > 200) throw new Error("scenario-workbook upsidePercent 无效。" );
  if (!Number.isFinite(stressPercent) || stressPercent <= -100 || stressPercent >= 0) throw new Error("scenario-workbook stressPercent 无效。" );

  const contexts = sources.map((source) => canonicalFinanceContent(source.finance || source.content?.finance, `scenario-workbook 来源 ${source.id} finance`));
  const finance = aggregateScenarioFinanceContext(contexts);
  const snapshots = [];
  const facts = [];
  let sharedMetric = null;
  for (const [index, source] of sources.entries()) {
    if (!["valuation", "portfolio"].includes(source.kind)) throw new Error(`scenario-workbook 不支持来源类型 ${source.kind}。`);
    const metrics = validateLineageMetrics(source.content?.metrics, `scenario-workbook 来源 ${source.id} metrics`);
    const matches = metrics.filter((metric) => metric.key === metricKey);
    if (matches.length !== 1) throw new Error(`scenario-workbook 来源 ${source.title || source.id} 必须且只能包含一个 metric=${metricKey}。`);
    const sourceMetric = matches[0];
    if (typeof sourceMetric.value !== "number" || !Number.isFinite(sourceMetric.value) || sourceMetric.value < 0 || sourceMetric.value > 1e15) {
      throw new Error(`scenario-workbook 来源 ${source.title || source.id} 的 metric=${metricKey} 必须是非负有限数值。`);
    }
    const metricLabel = scenarioWorkerText(sourceMetric.label || metricKey, 160);
    const metricMeasure = scenarioWorkerText(sourceMetric.measure || "", 80);
    const metricUnit = scenarioWorkerText(sourceMetric.unit || "", 160);
    const expectedScale = financeScaleForUnit(contexts[index].unit);
    if (expectedScale === null) throw new Error(`scenario-workbook 来源 ${source.title || source.id} 的 Finance unit=${contexts[index].unit} 没有受控 scale 映射。`);
    if (metricMeasure !== "market-value" || !Object.hasOwn(sourceMetric, "scale") || !Number.isSafeInteger(sourceMetric.scale) || !controlledFinanceMetricScales.has(sourceMetric.scale)) {
      throw new Error(`scenario-workbook 来源 ${source.title || source.id} 的 metric=${metricKey} 缺少受控 measure/unit/scale。`);
    }
    if (!metricUnit || metricUnit !== contexts[index].currency || sourceMetric.scale !== expectedScale) {
      throw new Error(`scenario-workbook 来源 ${source.title || source.id} 的 metric=${metricKey} unit/scale 与 Finance context 不一致。`);
    }
    if (!sharedMetric) {
      sharedMetric = {
        key: metricKey,
        label: metricLabel,
        measure: metricMeasure,
        unit: metricUnit,
        scale: sourceMetric.scale,
        direction: metricPolicy.direction,
        scenarioRule: metricPolicy.scenarioRule
      };
    } else {
      if (metricLabel !== sharedMetric.label) throw new Error(`scenario-workbook metric=${metricKey} 标签不一致。`);
      if (metricMeasure !== sharedMetric.measure || metricUnit !== sharedMetric.unit || sourceMetric.scale !== sharedMetric.scale) {
        throw new Error(`scenario-workbook metric=${metricKey} measure/unit/scale 不一致。`);
      }
    }
    const title = scenarioWorkerText(source.title || source.kind, 240);
    snapshots.push({
      artifactId: source.id,
      kind: source.kind,
      title,
      revision: source.revision,
      sha256: source.sha256,
      finance: contexts[index]
    });
    facts.push({
      id: source.id,
      sourceArtifactId: source.id,
      label: title,
      value: sourceMetric.value,
      measure: metricMeasure,
      unit: metricUnit,
      scale: sourceMetric.scale
    });
  }

  const assumptions = [
    { id: "baseline", label: "基准", adjustmentPercent: 0 },
    { id: "upside", label: "乐观", adjustmentPercent: upsidePercent },
    { id: "stress", label: "压力", adjustmentPercent: stressPercent }
  ];
  const scenarios = assumptions.map((assumption) => ({
    ...assumption,
    values: facts.map((fact) => ({ sourceArtifactId: fact.sourceArtifactId, value: scenarioAdjustedValue(fact.value, assumption.adjustmentPercent) }))
  }));
  const upstreamRisks = sources.flatMap((source) => validateLineageWarnings(source.content?.warnings, `scenario-workbook 来源 ${source.id} warnings`)
    .map((warning) => `${scenarioWorkerText(source.title || source.kind, 120)}：${scenarioWorkerText(warning, 800)}`))
    .filter(Boolean)
    .slice(0, 80);
  const workbook = {
    structureVersion: 1,
    title: cleanOneLine(options.title || "多标的情景工作簿", 240),
    metric: sharedMetric,
    sources: snapshots,
    facts,
    assumptions,
    scenarios,
    inferences: canonicalScenarioInferences(facts, sharedMetric),
    risks: [...upstreamRisks, ...financeScenarioFixedRisks].slice(0, 100),
    limitations: [...financeScenarioLimitations]
  };
  validateFinanceScenarioWorkbook(workbook, "Canonical Finance scenario workbook");
  return { workbook, finance };
}

function canonicalScenarioWorkbookContentFromSources(sourcesInput, optionsInput = {}) {
  const canonical = canonicalScenarioWorkbookFromSources(sourcesInput, optionsInput);
  return {
    operation: "scenario-workbook",
    workbook: canonical.workbook,
    table: scenarioWorkbookTable(canonical.workbook),
    markdown: scenarioWorkbookMarkdown(canonical.workbook, canonical.finance),
    html: scenarioWorkbookHtml(canonical.workbook, canonical.finance),
    finance: canonical.finance,
    warnings: canonical.workbook.risks
  };
}

function financeContextForOperationSources(sources, inputFinance, operation = "") {
  const contexts = sources.map((source) => normalizeFinanceContext(source.finance, true));
  if (!contexts.length) throw new Error("Finance operation 缺少可验证的来源口径。" );
  if (operation === "scenario-workbook") {
    const aggregate = aggregateScenarioFinanceContext(contexts);
    if (inputFinance !== undefined && inputFinance !== null) {
      const requested = normalizeFinanceContext(inputFinance, true);
      const mismatches = financeContextIdentityKeys.filter((key) => String(aggregate?.[key] || "") !== String(requested?.[key] || ""));
      if (mismatches.length) throw new Error(`input.finance 不得覆盖 scenario-workbook 聚合口径：${mismatches.join(", ")}。`);
    }
    return aggregate;
  }
  const inherited = contexts[0];
  for (const context of contexts.slice(1)) {
    const mismatches = financeContextMismatchFields(inherited, context);
    if (mismatches.length) throw new Error(`Finance 多来源口径不一致：${mismatches.join(", ")}。`);
  }
  if (inputFinance !== undefined && inputFinance !== null) {
    const requested = normalizeFinanceContext(inputFinance, true);
    const mismatches = financeContextMismatchFields(inherited, requested);
    if (mismatches.length) throw new Error(`input.finance 不得覆盖来源口径：${mismatches.join(", ")}。`);
  }
  return inherited;
}

function assertScenarioWorkbookControlledRoots(session, sources) {
  const byId = new Map(session.lineageArtifacts.map((artifact) => [artifact.id, artifact]));
  const allRootShas = new Set();
  for (const directSource of sources) {
    const pending = [directSource.id];
    const visited = new Set();
    const directRoots = new Set();
    while (pending.length) {
      const currentId = pending.pop();
      if (!currentId || visited.has(currentId)) continue;
      visited.add(currentId);
      const current = byId.get(currentId);
      if (!current) throw new Error(`scenario-workbook provenance 来源缺失：${currentId}`);
      const rootSha = String(current.provenance?.source?.sha256 || "");
      if (rootSha) directRoots.add(rootSha);
      for (const sourceId of current.sourceArtifactIds || []) pending.push(sourceId);
    }
    if (!directRoots.size) throw new Error(`scenario-workbook 来源 ${directSource.id} 无法追溯到受控本地输入。`);
    directRoots.forEach((sha) => allRootShas.add(sha));
  }
  if (allRootShas.size < 2) throw new Error("scenario-workbook 至少需要两个不同 SHA 的受控本地输入。" );
  return [...allRootShas].sort();
}

function emptyLineageSession(projectKind = "data") {
  if (!lineageProjectKinds.has(projectKind)) throw new Error("Lineage session 类型无效。" );
  return {
    schemaVersion: 4,
    projectKind,
    lineageRevision: LINEAGE_REVISION,
    lineageArtifacts: [],
    lineageEdges: [],
    lineageLayout: [],
    lineageViewport: { x: 40, y: 40, scale: 1 },
    selectedLineageArtifactId: ""
  };
}

function normalizeLineageSourceRef(value, label = "Lineage provenance source") {
  const source = objectValue(value);
  assertOnlyKeys(source, new Set(["relativePath", "originalName", "sha256", "byteLength", "importedAt"]), label);
  const relativePath = normalizedRelative(source.relativePath);
  const sourceSha = String(source.sha256 || "").toLowerCase();
  const byteLength = Number(source.byteLength);
  const importedAt = cleanOneLine(source.importedAt || "", 80);
  const originalName = path.basename(cleanOneLine(source.originalName, 240));
  if (!/^\.iiimage\/lineage\/sources\/[a-f0-9]{12}-[^/]+$/i.test(relativePath) || !originalName || !/^[a-f0-9]{64}$/.test(sourceSha) || !Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > MAX_SOURCE_BYTES || Number.isNaN(Date.parse(importedAt))) {
    throw new Error(`${label} 身份无效。`);
  }
  return { relativePath, originalName, sha256: sourceSha, byteLength, importedAt };
}

function normalizeLineageSourceHistory(value, label = "Lineage provenance.sourceHistory") {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_SOURCE_HISTORY_ENTRIES) throw new Error(`${label} 必须包含 1-${MAX_SOURCE_HISTORY_ENTRIES} 项。`);
  return value.map((candidate, index) => {
    const entry = objectValue(candidate);
    assertOnlyKeys(entry, new Set(["artifactRevision", "relativePath", "originalName", "sha256", "byteLength", "importedAt"]), `${label} #${index + 1}`);
    const artifactRevision = Number(entry.artifactRevision);
    if (!Number.isSafeInteger(artifactRevision) || artifactRevision < 1) throw new Error(`${label} #${index + 1} artifactRevision 无效。`);
    const { artifactRevision: _artifactRevision, ...sourceRef } = entry;
    return { artifactRevision, ...normalizeLineageSourceRef(sourceRef, `${label} #${index + 1}`) };
  });
}

function sourceRefFromHistoryEntry(entry) {
  if (!entry) return null;
  const { artifactRevision: _artifactRevision, ...source } = entry;
  return source;
}

function normalizeProvenance(value = {}) {
  const source = objectValue(value);
  assertOnlyKeys(source, new Set(["inputs", "tool", "toolVersion", "generatedAt", "outputSha256", "parameters", "source", "sourceHistory"]), "Lineage provenance");
  if (source.inputs !== undefined && !Array.isArray(source.inputs)) throw new Error("Lineage provenance.inputs 必须是数组。" );
  if ((source.inputs || []).length > 64) throw new Error("Lineage provenance.inputs 超过 64 项。" );
  const inputIds = new Set();
  const inputs = (source.inputs || []).map((input, index) => {
    const candidate = objectValue(input);
    assertOnlyKeys(candidate, new Set(["artifactId", "revision", "sha256"]), `Lineage provenance input #${index + 1}`);
    const artifactId = strictLineageId(candidate.artifactId, `Lineage provenance input #${index + 1}`);
    if (inputIds.has(artifactId)) throw new Error(`Lineage provenance input 重复：${artifactId}`);
    inputIds.add(artifactId);
    const revision = Number(candidate.revision);
    const sha256 = String(candidate.sha256 || "").toLowerCase();
    if (!Number.isSafeInteger(revision) || revision < 1 || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error(`Lineage provenance input #${index + 1} revision/SHA 无效。`);
    return { artifactId, revision, sha256 };
  });
  const tool = cleanOneLine(source.tool || "unknown", 80);
  const toolVersion = cleanOneLine(source.toolVersion || "lineage-v1", 80);
  const generatedAt = cleanOneLine(source.generatedAt || nowIso(), 80);
  if (!tool || !toolVersion || Number.isNaN(Date.parse(generatedAt))) throw new Error("Lineage provenance tool/generatedAt 无效。" );
  const normalized = {
    inputs,
    tool,
    toolVersion,
    generatedAt
  };
  if (source.parameters !== undefined) {
    const parameters = objectValue(source.parameters);
    let serialized;
    try { serialized = JSON.stringify(parameters); } catch { throw new Error("Lineage provenance parameters 无法序列化。" ); }
    if (Buffer.byteLength(serialized, "utf8") > MAX_OPERATION_OPTIONS_BYTES) throw new Error("Lineage provenance parameters 过大。" );
    normalized.parameters = { ...parameters };
  }
  if (source.outputSha256 !== undefined) {
    const outputSha256 = String(source.outputSha256 || "").toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(outputSha256)) throw new Error("Lineage provenance outputSha256 无效。" );
    normalized.outputSha256 = outputSha256;
  }
  if (source.source && typeof source.source === "object") {
    normalized.source = normalizeLineageSourceRef(source.source);
  }
  if (source.sourceHistory !== undefined) normalized.sourceHistory = normalizeLineageSourceHistory(source.sourceHistory);
  return normalized;
}

function normalizeLineageAttributes(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Lineage attributes 必须是对象。" );
  const entries = Object.entries(value);
  if (entries.length > 80) throw new Error("Lineage attributes 超过 80 个字段。" );
  const normalized = {};
  for (const [rawKey, rawValue] of entries) {
    const key = cleanOneLine(rawKey, 80);
    if (!key || key !== rawKey) throw new Error("Lineage attributes 字段名无效。" );
    if (rawValue === null || typeof rawValue === "boolean") normalized[key] = rawValue;
    else if (typeof rawValue === "number" && Number.isFinite(rawValue)) normalized[key] = rawValue;
    else if (typeof rawValue === "string") normalized[key] = boundedOptionText(rawValue, 1000, `Lineage attributes.${key}`);
    else if (Array.isArray(rawValue) && rawValue.length <= 128 && rawValue.every((item) => typeof item === "string")) {
      normalized[key] = rawValue.map((item) => boundedOptionText(item, 240, `Lineage attributes.${key}`));
    } else throw new Error(`Lineage attributes.${key} 类型或大小无效。`);
  }
  const serialized = JSON.stringify(normalized);
  if (Buffer.byteLength(serialized, "utf8") > MAX_OPERATION_OPTIONS_BYTES) throw new Error("Lineage attributes 超过安全大小限制。" );
  return normalized;
}

function sanitizeDescriptor(value, projectKind, projectId) {
  const source = objectValue(value);
  const kind = cleanOneLine(source.kind, 60);
  if (!allowedKinds(projectKind).has(kind)) throw new Error(`Lineage artifact kind 无效：${kind || "empty"}`);
  const id = strictLineageId(source.id, "Lineage artifactId");
  const relativePath = artifactRelativePath(id);
  if (String(source.projectKind || "") !== projectKind) throw new Error(`Lineage artifact ${id} projectKind 越界或缺失。`);
  if (projectId && String(source.projectId || "") !== projectId) throw new Error(`Lineage artifact ${id} projectId 越界或缺失。`);
  if (source.relativePath && normalizedRelative(source.relativePath) !== relativePath) throw new Error(`Lineage artifact ${id} 路径身份不一致。`);
  const contentSha256 = String(source.contentSha256 || "").toLowerCase();
  const revision = Number(source.revision);
  const byteLength = Number(source.byteLength);
  if (!/^[a-f0-9]{64}$/.test(contentSha256) || !Number.isSafeInteger(revision) || revision < 1 || !Number.isSafeInteger(byteLength) || byteLength < 2 || byteLength > MAX_ARTIFACT_BYTES) {
    throw new Error(`Lineage artifact ${id} revision/SHA/大小无效。`);
  }
  if (!Array.isArray(source.sourceArtifactIds) || source.sourceArtifactIds.length > 64) throw new Error(`Lineage artifact ${id} 来源列表无效。`);
  const sourceArtifactIds = source.sourceArtifactIds.map((sourceId) => strictLineageId(sourceId, `Lineage artifact ${id} source`));
  if (new Set(sourceArtifactIds).size !== sourceArtifactIds.length) throw new Error(`Lineage artifact ${id} 包含重复来源。`);
  const title = cleanOneLine(source.title || "", 240);
  const createdAt = cleanOneLine(source.createdAt || "", 80);
  const updatedAt = cleanOneLine(source.updatedAt || "", 80);
  if (!title || Number.isNaN(Date.parse(createdAt)) || Number.isNaN(Date.parse(updatedAt))) throw new Error(`Lineage artifact ${id} 标题或时间戳无效。`);
  const provenance = normalizeProvenance(source.provenance);
  const importableRootKinds = projectKind === "data" ? new Set(["dataset"]) : financeImportKinds;
  const importedRoot = sourceArtifactIds.length === 0 && importableRootKinds.has(kind);
  if ((provenance.source || provenance.sourceHistory) && !importedRoot) throw new Error(`Lineage artifact ${id} 只有受控根来源可携带 source/sourceHistory。`);
  if (provenance.sourceHistory) {
    if (!provenance.source) throw new Error(`Lineage artifact ${id} sourceHistory 缺少当前 source。`);
    let previousRevision = 0;
    const paths = new Set();
    const shas = new Set();
    for (const entry of provenance.sourceHistory) {
      if (entry.artifactRevision <= previousRevision || entry.artifactRevision > revision) throw new Error(`Lineage artifact ${id} sourceHistory revision 顺序无效。`);
      if (paths.has(entry.relativePath.toLowerCase()) || shas.has(entry.sha256)) throw new Error(`Lineage artifact ${id} sourceHistory 包含重复来源。`);
      previousRevision = entry.artifactRevision;
      paths.add(entry.relativePath.toLowerCase());
      shas.add(entry.sha256);
    }
    const latest = provenance.sourceHistory.at(-1);
    if (latest.artifactRevision !== revision || JSON.stringify(sourceRefFromHistoryEntry(latest)) !== JSON.stringify(provenance.source)) {
      throw new Error(`Lineage artifact ${id} 当前 source 与 sourceHistory 尾项不一致。`);
    }
  }
  const descriptor = {
    id,
    projectId: String(projectId || source.projectId || "").slice(0, 180),
    projectKind,
    kind,
    title,
    status: ["running", "ready", "stale", "waiting", "error", "cancelled"].includes(String(source.status)) ? String(source.status) : "ready",
    revision,
    relativePath,
    mimeType: cleanOneLine(source.mimeType || "application/json", 100),
    contentSha256,
    byteLength,
    sourceArtifactIds,
    provenance,
    createdAt,
    updatedAt
  };
  if (Number.isFinite(Number(source.rowCount))) descriptor.rowCount = Math.max(0, Math.floor(Number(source.rowCount)));
  if (Number.isFinite(Number(source.columnCount))) descriptor.columnCount = Math.max(0, Math.floor(Number(source.columnCount)));
  if (Array.isArray(source.sheetNames)) descriptor.sheetNames = source.sheetNames.map((name) => cleanOneLine(name, 160)).filter(Boolean).slice(0, 128);
  const attributes = normalizeLineageAttributes(source.attributes);
  if (attributes) descriptor.attributes = attributes;
  if (projectKind === "finance") descriptor.finance = normalizeFinanceContext(source.finance, true);
  return descriptor;
}

function relationForKind(kind) {
  if (["clean", "transform"].includes(kind)) return "derived-from";
  if (["analysis", "valuation", "portfolio"].includes(kind)) return kind === "valuation" ? "values" : "analyzes";
  if (kind === "chart") return "visualizes";
  if (["report", "scenario-workbook", "finance-report"].includes(kind)) return "reports";
  if (kind === "presentation") return "presents";
  if (kind === "risk-review") return "reviews";
  return "derived-from";
}

function deriveEdges(artifacts) {
  const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const edges = [];
  for (const target of artifacts) {
    for (const sourceId of target.sourceArtifactIds || []) {
      const source = byId.get(sourceId);
      if (!source) continue;
      edges.push({
        id: `edge-${sha256Bytes(Buffer.from(`${source.id}\0${target.id}\0${relationForKind(target.kind)}`)).slice(0, 20)}`,
        sourceArtifactId: source.id,
        targetArtifactId: target.id,
        relation: relationForKind(target.kind),
        sourceRevision: target.provenance.inputs.find((input) => input.artifactId === source.id)?.revision || source.revision,
        createdAt: target.createdAt
      });
    }
  }
  if (edges.length > MAX_EDGES) throw new Error(`Lineage edge 超过 ${MAX_EDGES} 条安全上限。`);
  return edges;
}

function assertLineageDag(artifacts) {
  const outgoing = new Map(artifacts.map((artifact) => [artifact.id, []]));
  for (const artifact of artifacts) {
    for (const sourceId of artifact.sourceArtifactIds) outgoing.get(sourceId)?.push(artifact.id);
  }
  const states = new Map();
  const stack = [];
  const visit = (artifactId) => {
    const state = states.get(artifactId) || 0;
    if (state === 2) return;
    if (state === 1) {
      const cycleStart = stack.indexOf(artifactId);
      const cycle = [...stack.slice(Math.max(0, cycleStart)), artifactId].join(" -> ");
      throw new Error(`Lineage graph 必须是 DAG，检测到环：${cycle}`);
    }
    states.set(artifactId, 1);
    stack.push(artifactId);
    for (const targetId of outgoing.get(artifactId) || []) visit(targetId);
    stack.pop();
    states.set(artifactId, 2);
  };
  for (const artifact of artifacts) visit(artifact.id);
}

function validateSuppliedLineageEdges(value, derivedEdges) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > MAX_EDGES) throw new Error("Lineage lineageEdges 必须是受限数组。" );
  const relations = new Set(["derived-from", "analyzes", "visualizes", "reports", "presents", "values", "reviews"]);
  const suppliedByPair = new Map();
  const suppliedIds = new Set();
  for (const [index, candidate] of value.entries()) {
    const edge = objectValue(candidate);
    assertOnlyKeys(edge, new Set(["id", "sourceArtifactId", "targetArtifactId", "relation", "sourceRevision", "createdAt"]), `Lineage edge #${index + 1}`);
    const id = strictLineageId(edge.id, `Lineage edge #${index + 1} id`);
    const sourceArtifactId = strictLineageId(edge.sourceArtifactId, `Lineage edge #${index + 1} source`);
    const targetArtifactId = strictLineageId(edge.targetArtifactId, `Lineage edge #${index + 1} target`);
    const relation = String(edge.relation || "");
    const sourceRevision = Number(edge.sourceRevision);
    const createdAt = cleanOneLine(edge.createdAt || "", 80);
    if (!relations.has(relation) || sourceArtifactId === targetArtifactId || !Number.isSafeInteger(sourceRevision) || sourceRevision < 1 || Number.isNaN(Date.parse(createdAt))) throw new Error(`Lineage edge #${index + 1} 身份无效。`);
    const pair = `${sourceArtifactId}\0${targetArtifactId}`;
    if (suppliedIds.has(id) || suppliedByPair.has(pair)) throw new Error(`Lineage edge #${index + 1} 重复。`);
    suppliedIds.add(id);
    suppliedByPair.set(pair, { id, sourceArtifactId, targetArtifactId, relation, sourceRevision, createdAt });
  }
  if (suppliedByPair.size !== derivedEdges.length) throw new Error("Lineage lineageEdges 与 artifact 来源图数量不一致。" );
  for (const expected of derivedEdges) {
    const actual = suppliedByPair.get(`${expected.sourceArtifactId}\0${expected.targetArtifactId}`);
    if (!actual || JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Lineage edge 与受控来源快照不一致：${expected.sourceArtifactId} -> ${expected.targetArtifactId}`);
  }
}

function lineageLayoutColumn(kind) {
  const columns = {
    dataset: 0, clean: 1, transform: 1, analysis: 2, chart: 3, report: 3, presentation: 3,
    "market-data": 0, "financial-statement": 0, valuation: 1, portfolio: 1, "scenario-workbook": 2, "risk-review": 2, "finance-report": 3
  };
  return columns[kind] ?? 0;
}

function defaultLayout(kind, index) {
  const column = lineageLayoutColumn(kind);
  // Labels move above an edge when its inline gap is too narrow. Existing
  // persisted coordinates remain authoritative; only missing/new nodes use
  // this projection, and every peer receives a distinct vertical slot.
  return { x: 64 + column * 220, y: 64 + Math.max(0, index) * 112 };
}

function sanitizeLineageViewport(value) {
  const source = value && typeof value === "object" ? value : {};
  const x = Number(source.x);
  const y = Number(source.y);
  const scale = Number(source.scale);
  return {
    x: Number.isFinite(x) ? Math.max(-400000, Math.min(400000, x)) : 40,
    y: Number.isFinite(y) ? Math.max(-400000, Math.min(400000, y)) : 40,
    scale: Number.isFinite(scale) ? Math.max(0.2, Math.min(2.5, scale)) : 1
  };
}

function sanitizeLineageSession(session, project = {}) {
  const source = session && typeof session === "object" ? session : {};
  const projectKind = String(project.kind || source.projectKind || "data");
  if (!lineageProjectKinds.has(projectKind)) throw new Error("当前项目不是 Data/Finance 项目。" );
  const projectId = String(project.id || "").slice(0, 180);
  if (source.projectKind !== undefined && String(source.projectKind) !== projectKind) throw new Error("Lineage session projectKind 与项目不一致。" );
  if (source.lineageRevision !== undefined && Number(source.lineageRevision) !== LINEAGE_REVISION) throw new Error("Lineage session revision 无效。" );
  if (source.lineageArtifacts !== undefined && !Array.isArray(source.lineageArtifacts)) throw new Error("Lineage lineageArtifacts 必须是数组。" );
  if ((source.lineageArtifacts || []).length > MAX_ARTIFACTS) throw new Error(`Lineage artifact 超过 ${MAX_ARTIFACTS} 个安全上限。`);
  const artifacts = [];
  const known = new Set();
  for (const candidate of (Array.isArray(source.lineageArtifacts) ? source.lineageArtifacts : [])) {
    const descriptor = sanitizeDescriptor(candidate, projectKind, projectId);
    if (known.has(descriptor.id)) throw new Error(`Lineage artifactId 重复：${descriptor.id}`);
    known.add(descriptor.id);
    if (candidate?.payload && typeof candidate.payload === "object") descriptor.payload = candidate.payload;
    artifacts.push(descriptor);
  }
  const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  for (const artifact of artifacts) {
    const allowedSources = sourceKindsByTargetKind[artifact.kind];
    for (const id of artifact.sourceArtifactIds) {
      const sourceArtifact = artifactById.get(id);
      if (!sourceArtifact) throw new Error(`Lineage artifact ${artifact.id} 引用了不存在的来源：${id}`);
      if (id === artifact.id) throw new Error(`Lineage artifact ${artifact.id} 不得引用自身。`);
      if (!allowedSources?.has(sourceArtifact.kind)) throw new Error(`Lineage artifact ${artifact.id} 不允许使用 ${sourceArtifact.kind} 作为来源。`);
    }
    const provenanceById = new Map(artifact.provenance.inputs.map((input) => [input.artifactId, input]));
    if (provenanceById.size !== artifact.sourceArtifactIds.length || artifact.sourceArtifactIds.some((id) => !provenanceById.has(id))) {
      throw new Error(`Lineage artifact ${artifact.id} 的 provenance inputs 与来源图不一致。`);
    }
    for (const sourceId of artifact.sourceArtifactIds) {
      const input = provenanceById.get(sourceId);
      const sourceArtifact = artifactById.get(sourceId);
      if (input.revision > sourceArtifact.revision || (input.revision === sourceArtifact.revision && input.sha256 !== sourceArtifact.contentSha256)) {
        throw new Error(`Lineage artifact ${artifact.id} 的来源 revision/SHA 快照无效：${sourceId}`);
      }
    }
  }
  assertLineageDag(artifacts);
  const lineageEdges = deriveEdges(artifacts);
  validateSuppliedLineageEdges(source.lineageEdges, lineageEdges);
  const layoutById = new Map();
  if (source.lineageLayout !== undefined && !Array.isArray(source.lineageLayout)) throw new Error("Lineage lineageLayout 必须是数组。" );
  if ((source.lineageLayout || []).length > MAX_ARTIFACTS) throw new Error("Lineage lineageLayout 超过安全上限。" );
  for (const item of (Array.isArray(source.lineageLayout) ? source.lineageLayout : [])) {
    const artifactId = strictLineageId(item?.artifactId, "Lineage layout artifactId");
    if (!known.has(artifactId)) throw new Error(`Lineage layout 引用了不存在的 artifact：${artifactId}`);
    if (layoutById.has(artifactId)) throw new Error(`Lineage layout artifactId 重复：${artifactId}`);
    const x = Number(item?.x);
    const y = Number(item?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`Lineage layout 坐标无效：${artifactId}`);
    layoutById.set(artifactId, {
      artifactId,
      x: Math.max(-200000, Math.min(200000, x)),
      y: Math.max(-200000, Math.min(200000, y)),
      ...(Number.isFinite(Number(item?.width)) ? { width: Math.max(160, Math.min(1200, Number(item.width))) } : {}),
      ...(Number.isFinite(Number(item?.height)) ? { height: Math.max(100, Math.min(1200, Number(item.height))) } : {})
    });
  }
  const columnCounts = new Map();
  for (const artifact of artifacts) {
    const column = lineageLayoutColumn(artifact.kind);
    const index = columnCounts.get(column) || 0;
    columnCounts.set(column, index + 1);
    if (layoutById.has(artifact.id)) continue;
    layoutById.set(artifact.id, { artifactId: artifact.id, ...defaultLayout(artifact.kind, index) });
  }
  const selectedRaw = String(source.selectedLineageArtifactId || "").trim();
  const selected = selectedRaw ? strictLineageId(selectedRaw, "Lineage selected artifactId") : "";
  if (selected && !known.has(selected)) throw new Error(`Lineage selected artifact 不存在：${selected}`);
  return {
    schemaVersion: 4,
    projectKind,
    lineageRevision: LINEAGE_REVISION,
    lineageArtifacts: artifacts,
    lineageEdges,
    lineageLayout: [...layoutById.values()],
    lineageViewport: sanitizeLineageViewport(source.lineageViewport),
    selectedLineageArtifactId: known.has(selected) ? selected : ""
  };
}

function deterministicPreviewIndices(totalRows, budget) {
  const count = Math.min(totalRows, Math.max(0, Math.floor(budget)));
  if (count >= totalRows) return Array.from({ length: totalRows }, (_, index) => index);
  if (count <= 1) return count ? [0] : [];
  if (count < 8) return Array.from({ length: count }, (_, index) => Math.round(index * (totalRows - 1) / (count - 1)));
  const head = Math.max(1, Math.floor(count * 0.2));
  const tail = Math.max(1, Math.floor(count * 0.1));
  const middle = count - head - tail;
  const middleLength = Math.max(1, totalRows - head - tail);
  const indices = Array.from({ length: head }, (_, index) => index);
  for (let index = 0; index < middle; index += 1) {
    indices.push(head + Math.min(middleLength - 1, Math.floor((index + 0.5) * middleLength / middle)));
  }
  for (let index = totalRows - tail; index < totalRows; index += 1) indices.push(index);
  return [...new Set(indices)].sort((left, right) => left - right);
}

function createLineageTablePreview(table) {
  const totalRows = table.totalRows;
  const totalColumns = table.totalColumns;
  const configuredRowBudget = Math.min(
    PREVIEW_MAX_ROWS,
    totalRows,
    Math.max(1, Math.floor(PREVIEW_MAX_CELLS / Math.max(1, totalColumns)))
  );
  let rowBudget = configuredRowBudget;
  let rowIndices = [];
  let rows = [];
  let previewBytes = 0;
  let truncatedCells = 0;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    rowIndices = deterministicPreviewIndices(totalRows, rowBudget);
    truncatedCells = 0;
    rows = rowIndices.map((rowIndex) => Object.fromEntries(table.columns.map((column) => {
      const value = table.rows[rowIndex]?.[column.key] ?? null;
      if (typeof value === "string" && value.length > PREVIEW_CELL_CHARS) {
        truncatedCells += 1;
        return [column.key, `${value.slice(0, PREVIEW_CELL_CHARS - 1)}…`];
      }
      return [column.key, value];
    })));
    previewBytes = Buffer.byteLength(JSON.stringify(rows), "utf8");
    if (previewBytes <= PREVIEW_MAX_BYTES || rowBudget <= 1) break;
    rowBudget = Math.max(1, Math.min(rowBudget - 1, Math.floor(rowBudget * PREVIEW_MAX_BYTES / previewBytes * 0.9)));
  }
  const sampled = rows.length < totalRows;
  return {
    sheetName: table.sheetName,
    sheetNames: table.sheetNames,
    columns: table.columns,
    rows,
    rowIndices,
    totalRows,
    totalColumns,
    sampled,
    sampling: {
      strategy: sampled ? "deterministic-stratified" : "complete",
      sampledRows: rows.length,
      configuredRowBudget,
      cellBudget: PREVIEW_MAX_CELLS,
      byteBudget: PREVIEW_MAX_BYTES,
      previewBytes,
      truncatedCells
    },
    warnings: table.warnings.slice(0, 100)
  };
}

function createLineageTableWindow(table, input = {}) {
  const request = assertPlainDataObject(input, "Table window request");
  const requestKeys = Object.keys(request);
  const allowedRequestKeys = new Set(["expectedArtifactRevision", "rowOffset", "rowLimit", "columnKeys"]);
  if (requestKeys.length > allowedRequestKeys.size || requestKeys.some((key) => !allowedRequestKeys.has(key))) throw new Error("Table window request 包含未知字段。");
  const rowOffset = request.rowOffset;
  const rowLimit = request.rowLimit;
  if (!Number.isSafeInteger(rowOffset) || rowOffset < 0 || (table.totalRows > 0 && rowOffset >= table.totalRows) || (table.totalRows === 0 && rowOffset !== 0)) {
    throw new Error("Table window rowOffset 超出权威表格范围。");
  }
  if (!Number.isSafeInteger(rowLimit) || rowLimit < 1 || rowLimit > TABLE_WINDOW_MAX_ROWS) {
    throw new Error(`Table window rowLimit 必须为 1-${TABLE_WINDOW_MAX_ROWS}。`);
  }
  const requestedKeys = request.columnKeys === undefined
    ? table.columns.slice(0, TABLE_WINDOW_MAX_COLUMNS).map((column) => column.key)
    : request.columnKeys;
  if (!Array.isArray(requestedKeys) || requestedKeys.length < 1 || requestedKeys.length > TABLE_WINDOW_MAX_COLUMNS) {
    throw new Error(`Table window columnKeys 必须包含 1-${TABLE_WINDOW_MAX_COLUMNS} 个列 key。`);
  }
  assertDenseDataArray(requestedKeys, TABLE_WINDOW_MAX_COLUMNS, "Table window columnKeys", 1);
  const columnKeys = requestedKeys.map((value) => {
    if (typeof value !== "string" || !value || value.length > TABLE_WINDOW_MAX_COLUMN_KEY_CHARS || value !== value.trim() || value.includes("\u0000") || !/^[\p{L}\p{N}_-]+$/u.test(value)) {
      throw new Error(`Table window columnKeys 必须是长度不超过 ${TABLE_WINDOW_MAX_COLUMN_KEY_CHARS} 的规范列 key。`);
    }
    return value;
  });
  if (new Set(columnKeys).size !== columnKeys.length) throw new Error("Table window columnKeys 必须是非空且不重复的列 key。");
  const requestBytes = Buffer.byteLength(JSON.stringify({ expectedArtifactRevision: request.expectedArtifactRevision, rowOffset, rowLimit, columnKeys }), "utf8");
  if (requestBytes > TABLE_WINDOW_MAX_REQUEST_BYTES) throw new Error("Table window request 超过安全字节预算。");
  const columnByKey = new Map(table.columns.map((column) => [column.key, column]));
  const columns = columnKeys.map((key) => {
    const column = columnByKey.get(key);
    if (!column) throw new Error("Table window 包含未知列 key。");
    return column;
  });
  const end = Math.min(table.totalRows, rowOffset + rowLimit);
  const rows = [];
  for (let index = rowOffset; index < end; index += 1) {
    rows.push(Object.fromEntries(columns.map((column) => [column.key, table.rows[index]?.[column.key] ?? null])));
  }
  const base = {
    sheetName: table.sheetName,
    columns,
    rows,
    rowOffset,
    requestedRowLimit: rowLimit,
    totalRows: table.totalRows,
    totalColumns: table.totalColumns
  };
  while (base.rows.length > 1 && Buffer.byteLength(JSON.stringify(base), "utf8") > TABLE_WINDOW_MAX_BYTES) base.rows.pop();
  const payloadBytes = Buffer.byteLength(JSON.stringify(base), "utf8");
  if (payloadBytes > TABLE_WINDOW_MAX_BYTES) throw lineageFailure("LINEAGE_TABLE_WINDOW_TOO_LARGE", "单行表格窗口超过 1 MiB Renderer 安全预算。");
  return {
    ...base,
    returnedRows: base.rows.length,
    hasPrevious: rowOffset > 0,
    hasNext: rowOffset + base.rows.length < table.totalRows,
    payloadBytes
  };
}

function artifactContentForRenderer(content, kind, projectKind, expectedFinance) {
  const validated = validateLineageStoredContent(content, kind, projectKind, expectedFinance);
  const payload = {
    operation: validated.operation,
    ...(Array.isArray(validated.metrics) ? { metrics: validated.metrics.slice(0, 200) } : {}),
    ...(validated.chart ? { chart: validated.chart } : {}),
    ...(typeof validated.markdown === "string" ? { markdown: validated.markdown } : {}),
    ...(validated.document ? { document: validated.document } : {}),
    ...(validated.workbook ? { workbook: validated.workbook } : {}),
    ...(validated.theme ? { theme: validated.theme } : {}),
    ...(Array.isArray(validated.slides) ? validated.structureVersion === DELIVERY_DECK_STRUCTURE_VERSION
      ? {
          structureVersion: DELIVERY_DECK_STRUCTURE_VERSION,
          reportRef: validated.reportRef,
          slides: validated.slides.map(({ chart: _chart, table: _table, resolvedBlocks: _resolvedBlocks, citation: _citation, ...slide }) => slide)
        }
      : { slides: validated.slides.map(({ table: _table, ...slide }) => slide) }
      : {}),
    ...(validated.finance ? { finance: validated.finance } : {}),
    ...(Array.isArray(validated.warnings) ? { warnings: validated.warnings.slice(0, 100) } : {})
  };
  if (validated.table) payload.preview = createLineageTablePreview(validated.table);
  if (Array.isArray(validated.columnProfiles)) payload.columnProfiles = validated.columnProfiles;
  if (Array.isArray(validated.findings)) payload.findings = validated.findings;
  if (validated.assumptions) payload.assumptions = validated.assumptions;
  return payload;
}

function markdownEscape(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/([`*_{}\[\]<>#+|])/g, "\\$1")
    .replace(/\r?\n/g, " ");
}

function reportMetricAt(metrics, index) {
  const metric = metrics[index];
  if (!metric) throw new Error("Report metrics block 只能引用当前 metrics 索引。");
  return metric;
}

function reportMarkdownFromDocument(document, metrics) {
  const toneLabels = { note: "提示", insight: "洞察", warning: "注意" };
  const lines = [`# ${markdownEscape(document.title)}`, ""];
  for (const section of document.sections) {
    lines.push(`## ${markdownEscape(section.heading)}`, "");
    for (const block of section.blocks) {
      if (block.type === "paragraph") lines.push(markdownEscape(block.text), "");
      else if (block.type === "bullets") { block.items.forEach((item) => lines.push(`- ${markdownEscape(item)}`)); lines.push(""); }
      else if (block.type === "metrics") {
        lines.push("| 指标 | 数值 | 说明 |", "| --- | ---: | --- |");
        block.metricIndexes.forEach((index) => {
          const metric = reportMetricAt(metrics, index);
          lines.push(`| ${markdownEscape(metric.label)} | ${markdownEscape(metric.value)}${metric.unit ? ` ${markdownEscape(metric.unit)}` : ""} | ${markdownEscape(metric.note || "")} |`);
        });
        lines.push("");
      } else if (block.type === "sources") {
        block.inputArtifactIds.forEach((id) => lines.push(`- 来源 artifact：${markdownEscape(id)}`));
        lines.push("");
      } else if (block.type === "chart") {
        lines.push(`图表 artifact：${markdownEscape(block.chartArtifactId)}。`, "");
      } else if (block.type === "table") {
        lines.push(`表：${markdownEscape(block.caption)}`, "");
        lines.push(`| ${block.columns.map((column) => markdownEscape(column.label)).join(" | ")} |`);
        lines.push(`| ${block.columns.map((column) => column.align === "center" ? ":---:" : column.align === "right" ? "---:" : ":---").join(" | ")} |`);
        block.rows.forEach((row) => lines.push(`| ${row.cells.map((cell) => markdownEscape(cell)).join(" | ")} |`));
        lines.push("");
      } else if (block.type === "callout") {
        lines.push(`> [${toneLabels[block.tone]}] ${markdownEscape(block.title)}`);
        lines.push(`> ${markdownEscape(block.text)}`, "");
      }
    }
  }
  return lines.join("\n").trimEnd();
}

function reportHtmlFromDocument(document, metrics) {
  const toneLabels = { note: "提示", insight: "洞察", warning: "注意" };
  const body = [];
  body.push(`<article data-report-structure-version="2"><h1>${escapeHtml(document.title)}</h1>`);
  for (const section of document.sections) {
    body.push(`<section data-section-id="${escapeHtml(section.id)}" data-role="${escapeHtml(section.role)}"><h2>${escapeHtml(section.heading)}</h2>`);
    for (const block of section.blocks) {
      const blockId = escapeHtml(block.id);
      if (block.type === "paragraph") body.push(`<p data-block-id="${blockId}">${escapeHtml(block.text)}</p>`);
      else if (block.type === "bullets") body.push(`<ul data-block-id="${blockId}" data-report-block="bullets">${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`);
      else if (block.type === "metrics") {
        const rows = block.metricIndexes.map((index) => {
          const metric = reportMetricAt(metrics, index);
          return `<tr><th scope="row">${escapeHtml(metric.label)}</th><td>${escapeHtml(metric.value)}${metric.unit ? ` ${escapeHtml(metric.unit)}` : ""}</td><td>${escapeHtml(metric.note || "")}</td></tr>`;
        }).join("");
        body.push(`<table data-block-id="${blockId}" data-report-block="metrics"><caption>指标</caption><thead><tr><th scope="col">指标</th><th scope="col">数值</th><th scope="col">说明</th></tr></thead><tbody>${rows}</tbody></table>`);
      } else if (block.type === "sources") {
        body.push(`<ul data-block-id="${blockId}" data-report-block="sources">${block.inputArtifactIds.map((id) => `<li data-artifact-id="${escapeHtml(id)}">来源 artifact：${escapeHtml(id)}</li>`).join("")}</ul>`);
      } else if (block.type === "chart") {
        body.push(`<figure data-block-id="${blockId}" data-report-block="chart" data-chart-artifact-id="${escapeHtml(block.chartArtifactId)}"><figcaption>图表 artifact：${escapeHtml(block.chartArtifactId)}</figcaption></figure>`);
      } else if (block.type === "table") {
        const head = block.columns.map((column) => `<th scope="col" data-align="${column.align}">${escapeHtml(column.label)}</th>`).join("");
        const rows = block.rows.map((row) => `<tr data-row-id="${escapeHtml(row.id)}">${row.cells.map((cell, index) => `<td data-align="${block.columns[index].align}">${escapeHtml(cell)}</td>`).join("")}</tr>`).join("");
        body.push(`<table data-block-id="${blockId}" data-report-block="table"><caption>${escapeHtml(block.caption)}</caption><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`);
      } else if (block.type === "callout") {
        body.push(`<aside data-block-id="${blockId}" data-report-block="callout" data-tone="${block.tone}"><h3><span>${toneLabels[block.tone]}：</span>${escapeHtml(block.title)}</h3><p>${escapeHtml(block.text)}</p></aside>`);
      }
    }
    body.push("</section>");
  }
  body.push("</article>");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(document.title)}</title><style>body{font:16px/1.7 system-ui,sans-serif;max-width:960px;margin:48px auto;padding:0 24px;color:#172033}h1,h2,h3{line-height:1.25}table{width:100%;border-collapse:collapse;margin:20px 0}caption{text-align:left;font-weight:700;margin-bottom:8px}th,td{border:1px solid #cbd5e1;padding:8px 10px;text-align:left;vertical-align:top}[data-align=center]{text-align:center}[data-align=right]{text-align:right}aside{border-left:4px solid #d4a548;padding:12px 16px;background:#fff8e8}figure{margin:20px 0;padding:16px;border:1px solid #cbd5e1}</style></head><body>${body.join("")}</body></html>`;
}

function canonicalLineageContentForWrite(contentInput, kind) {
  const content = { ...assertPlainDataObject(contentInput, "Lineage write content") };
  if (kind === "report" && content.document) {
    const document = reportDocumentV2(content.document);
    const metrics = validateLineageMetrics(content.metrics);
    content.document = document;
    content.markdown = reportMarkdownFromDocument(document, metrics);
    content.html = reportHtmlFromDocument(document, metrics);
  }
  if (kind === "presentation" && Array.isArray(content.slides)) {
    content.slides = content.slides.map((slide) => {
      const hasChart = Boolean(slide?.chartArtifactId || slide?.chart);
      if (!hasChart || slide.chartFormat) return slide;
      return { ...slide, chartFormat: { ...defaultPresentationChartFormat } };
    });
  }
  return content;
}

function validateStructureReferences(kind, content, sources, provenanceInputs) {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const snapshotById = new Map(provenanceInputs.map((input) => [input.artifactId, input]));
  const authorized = (artifactId, label, chartOnly = false) => {
    const source = sourceById.get(artifactId);
    const snapshot = snapshotById.get(artifactId);
    if (!source || !snapshot || source.revision !== snapshot.revision || source.contentSha256 !== snapshot.sha256) throw new Error(`${label} 未引用当前 provenance 授权 artifact。`);
    if (source.status !== "ready") throw lineageFailure("LINEAGE_SOURCE_NOT_READY", `${label} 引用了 ${source.status || "unknown"} artifact，请先重算：${source.title || source.id}`);
    if (chartOnly && source.kind !== "chart") throw new Error(`${label} 必须引用 chart artifact。`);
    return source;
  };
  let deliveryRoot = null;
  let deliveryBlocksById = null;
  let deliveryMetrics = null;
  if (kind === "presentation" && content.structureVersion === DELIVERY_DECK_STRUCTURE_VERSION) {
    deliveryRoot = authorized(content.reportRef.reportArtifactId, "Delivery Deck reportRef");
    if (deliveryRoot.kind !== "report") throw new Error("Delivery Deck reportRef 必须引用 report artifact。" );
    if (sources.filter((source) => source.kind === "report").length !== 1) throw new Error("Delivery Deck 必须且只能有一个 ready ReportDocumentV2 根来源。" );
    const document = validateReportDocument(deliveryRoot.payload?.document, "Delivery Deck root Report document");
    if (document.structureVersion !== 2) throw new Error("Delivery Deck reportRef 必须引用 ReportDocumentV2。" );
    deliveryMetrics = validateLineageMetrics(deliveryRoot.payload?.metrics);
    deliveryBlocksById = new Map(document.sections.flatMap((section) => section.blocks).map((block) => [block.id, block]));
  }
  if (kind === "report" && content.document) {
    const document = validateReportDocument(content.document);
    const metrics = validateLineageMetrics(content.metrics);
    for (const section of document.sections) for (const block of section.blocks) {
      if (block.type === "metrics") for (const index of block.metricIndexes) if (index >= metrics.length) throw new Error("Report metrics block 只能引用当前 metrics 索引。");
      if (block.type === "sources") for (const artifactId of block.inputArtifactIds) authorized(artifactId, "Report sources block");
      if (block.type === "chart") authorized(block.chartArtifactId, "Report chart block", true);
    }
  }
  if (kind === "scenario-workbook") {
    const workbook = validateFinanceScenarioWorkbook(content.workbook, "Finance scenario workbook");
    if (workbook.sources.length !== sources.length || workbook.sources.length !== provenanceInputs.length) throw new Error("Finance scenario workbook source 快照数量与 provenance 不一致。" );
    for (const snapshot of workbook.sources) {
      const source = authorized(snapshot.artifactId, "Finance scenario workbook source");
      if (!["valuation", "portfolio"].includes(source.kind) || snapshot.kind !== source.kind || snapshot.title !== source.title || snapshot.revision !== source.revision || snapshot.sha256 !== source.contentSha256 || JSON.stringify(snapshot.finance) !== JSON.stringify(source.finance)) {
        throw new Error(`Finance scenario workbook source 快照与权威 artifact 不一致：${snapshot.artifactId}`);
      }
    }
  }
  if (kind === "presentation") for (const [index, slide] of content.slides.entries()) {
    if (content.structureVersion === DELIVERY_DECK_STRUCTURE_VERSION) {
      const root = deliveryRoot;
      if (!slide.citation || slide.citation.reportArtifactId !== root.id || slide.citation.reportRevision !== root.revision || slide.citation.reportSha256 !== root.contentSha256) {
        throw new Error(`Delivery Deck slide #${index + 1} citation 与 root Report revision/SHA 不一致。`);
      }
      if (slide.type === "report-blocks") {
        const selected = slide.blockIds.map((blockId) => deliveryBlocksById.get(blockId));
        if (selected.some((block) => !block || !["paragraph", "bullets", "metrics", "callout", "sources"].includes(block.type))) {
          throw new Error(`Delivery Deck slide #${index + 1} blockIds 未定位到 root Report 的可交付 block。`);
        }
        const expectedBlocks = selected.map((block) => resolvedDeliveryBlock(block, deliveryMetrics));
        if (JSON.stringify(slide.resolvedBlocks) !== JSON.stringify(expectedBlocks)) throw new Error(`Delivery Deck slide #${index + 1} resolvedBlocks 与冻结 root Report 不一致。`);
      }
      if (slide.type === "table") {
        if (slide.tableRef.reportArtifactId !== root.id) throw new Error(`Delivery Deck slide #${index + 1} tableRef 必须等于 root Report。`);
        const expectedTable = presentationTableSnapshotFromReport(root, root.payload, slide.tableRef, `Delivery Deck slide #${index + 1}.tableRef`);
        if (!slide.table || JSON.stringify(slide.tableRef) !== JSON.stringify(expectedTable.ref) || JSON.stringify(slide.table) !== JSON.stringify(expectedTable.table)) {
          throw new Error(`Delivery Deck slide #${index + 1} table 快照与 root Report 不一致。`);
        }
      }
      if (slide.type === "chart") {
        const block = deliveryBlocksById.get(slide.reportBlockId);
        if (block?.type !== "chart") throw new Error(`Delivery Deck slide #${index + 1} reportBlockId 未定位到 root Report chart。`);
        const rootChartSnapshot = root.provenance.inputs.find((input) => input.artifactId === block.chartArtifactId);
        const presentationChartSnapshot = snapshotById.get(block.chartArtifactId);
        if (!rootChartSnapshot || !presentationChartSnapshot || rootChartSnapshot.revision !== presentationChartSnapshot.revision || rootChartSnapshot.sha256 !== presentationChartSnapshot.sha256) {
          throw new Error(`Delivery Deck slide #${index + 1} chart 的 Report/Presentation provenance 不一致。`);
        }
        const chart = authorized(block.chartArtifactId, `Delivery Deck slide #${index + 1} chart`, true);
        if (JSON.stringify(slide.chart) !== JSON.stringify(chart.payload?.chart)) throw new Error(`Delivery Deck slide #${index + 1} chart 快照与授权 artifact 不一致。`);
      }
      if (slide.type === "provenance") {
        const sourceBlock = [...deliveryBlocksById.values()].find((block) => block.type === "sources");
        const expectedBlocks = sourceBlock ? [resolvedDeliveryBlock(sourceBlock, deliveryMetrics)] : [];
        if (JSON.stringify(slide.resolvedBlocks) !== JSON.stringify(expectedBlocks)) throw new Error(`Delivery Deck slide #${index + 1} provenance 快照与冻结 root Report 不一致。`);
      }
      continue;
    }
    if (slide.chartArtifactId) {
      const source = authorized(slide.chartArtifactId, `Presentation slide #${index + 1} chartArtifactId`, true);
      if (!slide.chart || JSON.stringify(slide.chart) !== JSON.stringify(source.payload?.chart)) throw new Error(`Presentation slide #${index + 1} chart 快照与授权 artifact 不一致。`);
    } else if (slide.chart) throw new Error(`Presentation slide #${index + 1} 新写入不得使用内嵌 legacy chart。`);
    if (slide.tableRef) {
      const source = authorized(slide.tableRef.reportArtifactId, `Presentation slide #${index + 1} tableRef`);
      if (source.kind !== "report") throw new Error(`Presentation slide #${index + 1} tableRef 必须引用 report artifact。`);
      const resolved = presentationTableSnapshotFromReport(source, source.payload, slide.tableRef, `Presentation slide #${index + 1}.tableRef`);
      if (!slide.table || JSON.stringify(slide.tableRef) !== JSON.stringify(resolved.ref) || JSON.stringify(slide.table) !== JSON.stringify(resolved.table)) {
        throw new Error(`Presentation slide #${index + 1} table 快照与授权 Report revision 不一致。`);
      }
    } else if (slide.table) throw new Error(`Presentation slide #${index + 1} 新写入不得使用无引用 table 快照。`);
  }
}

function readArtifactContent(projectRoot, descriptor, sourceArtifacts = undefined) {
  const filePath = artifactAbsolutePath(projectRoot, descriptor.relativePath);
  if (!existsSync(filePath)) throw new Error(`Artifact 文件缺失：${descriptor.title}`);
  const info = lstatSync(filePath);
  if (!info.isFile() || info.isSymbolicLink() || info.size !== descriptor.byteLength || info.size < 2 || info.size > MAX_ARTIFACT_BYTES) throw new Error(`Artifact 文件身份或大小无效：${descriptor.title}`);
  const bytes = readFileSync(filePath);
  const digest = sha256Bytes(bytes);
  if (digest !== descriptor.contentSha256) throw new Error(`Artifact SHA 校验失败：${descriptor.title}`);
  let stored;
  try { stored = JSON.parse(bytes.toString("utf8")); } catch { throw new Error(`Artifact JSON 损坏：${descriptor.title}`); }
  if (
    stored?.formatVersion !== LINEAGE_FORMAT_VERSION ||
    stored?.artifactId !== descriptor.id ||
    stored?.projectId !== descriptor.projectId ||
    stored?.projectKind !== descriptor.projectKind ||
    stored?.kind !== descriptor.kind ||
    Number(stored?.revision) !== descriptor.revision ||
    !stored?.content || typeof stored.content !== "object"
  ) throw new Error(`Artifact 元数据与受控文件不一致：${descriptor.title}`);
  const content = validateLineageStoredContent(stored.content, descriptor.kind, descriptor.projectKind, descriptor.finance);
  if (content.table) {
    if (descriptor.rowCount !== undefined && descriptor.rowCount !== content.table.totalRows) throw new Error(`Artifact rowCount 与内容不一致：${descriptor.title}`);
    if (descriptor.columnCount !== undefined && descriptor.columnCount !== content.table.totalColumns) throw new Error(`Artifact columnCount 与内容不一致：${descriptor.title}`);
  }
  if (descriptor.kind === "scenario-workbook") validateScenarioWorkbookSourceBinding(projectRoot, descriptor, content, sourceArtifacts);
  return content;
}

function readLineageTableWindow(projectInput, descriptor, input = {}) {
  const project = validateProject(projectInput, "data");
  const sanitized = sanitizeDescriptor(descriptor, project.kind, project.id);
  if (!sanitized) throw new Error("Lineage artifact descriptor 无效。");
  const expectedRevision = input.expectedArtifactRevision;
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new Error("Table window expectedArtifactRevision 无效。");
  if (expectedRevision !== sanitized.revision) {
    throw lineageFailure("LINEAGE_TABLE_WINDOW_REVISION_CONFLICT", "表格已更新，请基于最新 revision 重新打开完整浏览。");
  }
  const content = readArtifactContent(project.path, sanitized);
  if (!content.table) throw lineageFailure("LINEAGE_TABLE_WINDOW_UNAVAILABLE", "当前 artifact 不包含可浏览的权威表格。");
  const result = {
    artifactId: sanitized.id,
    artifactRevision: sanitized.revision,
    ...createLineageTableWindow(content.table, input)
  };
  while (result.rows.length > 1 && Buffer.byteLength(JSON.stringify(result), "utf8") > TABLE_WINDOW_MAX_BYTES) result.rows.pop();
  result.returnedRows = result.rows.length;
  result.hasNext = result.rowOffset + result.returnedRows < result.totalRows;
  result.payloadBytes = Buffer.byteLength(JSON.stringify({ ...result, payloadBytes: 0 }), "utf8");
  result.payloadBytes = Buffer.byteLength(JSON.stringify(result), "utf8");
  if (result.payloadBytes > TABLE_WINDOW_MAX_BYTES) throw lineageFailure("LINEAGE_TABLE_WINDOW_TOO_LARGE", "表格窗口超过 1 MiB Renderer 安全预算。");
  return result;
}

function verifyLineageArtifactSource(projectRoot, descriptor) {
  const history = descriptor.provenance?.sourceHistory || (descriptor.provenance?.source ? [{ artifactRevision: descriptor.revision, ...descriptor.provenance.source }] : []);
  for (const source of history) {
    const sourcePath = controlledLineageSourcePath(projectRoot, source.relativePath);
    if (!existsSync(sourcePath)) throw new Error(`Artifact 受控来源缺失：${descriptor.title} r${source.artifactRevision}`);
    const info = lstatSync(sourcePath);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== source.byteLength || info.size < 1 || info.size > MAX_SOURCE_BYTES || sha256File(sourcePath) !== source.sha256) {
      throw new Error(`Artifact 受控来源 SHA/大小校验失败：${descriptor.title} r${source.artifactRevision}`);
    }
  }
}

function verifyLineageInputRevision(projectRoot, sourceDescriptor, input) {
  if (!sourceDescriptor || typeof sourceDescriptor !== "object") throw new Error(`Lineage provenance source descriptor 缺失：${input?.artifactId || "unknown"}`);
  const revisionPath = artifactRevisionPath(projectRoot, sourceDescriptor.id, input.revision);
  if (!existsSync(revisionPath)) throw new Error(`Lineage provenance revision 缺失：${sourceDescriptor.id} r${input.revision}`);
  const info = lstatSync(revisionPath);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 2 || info.size > MAX_ARTIFACT_BYTES) throw new Error(`Lineage provenance revision 身份无效：${sourceDescriptor.id} r${input.revision}`);
  const bytes = readFileSync(revisionPath);
  if (sha256Bytes(bytes) !== input.sha256) throw new Error(`Lineage provenance revision SHA 失败：${sourceDescriptor.id} r${input.revision}`);
  let stored;
  try { stored = JSON.parse(bytes.toString("utf8")); } catch { throw new Error(`Lineage provenance revision JSON 损坏：${sourceDescriptor.id} r${input.revision}`); }
  if (
    stored?.formatVersion !== LINEAGE_FORMAT_VERSION ||
    stored?.artifactId !== sourceDescriptor.id ||
    stored?.projectId !== sourceDescriptor.projectId ||
    stored?.projectKind !== sourceDescriptor.projectKind ||
    stored?.kind !== sourceDescriptor.kind ||
    Number(stored?.revision) !== input.revision ||
    !stored?.content || typeof stored.content !== "object"
  ) throw new Error(`Lineage provenance revision 元数据不一致：${sourceDescriptor.id} r${input.revision}`);
  const content = validateLineageStoredContent(stored.content, sourceDescriptor.kind, sourceDescriptor.projectKind);
  return { stored, content, bytes };
}

function validateScenarioWorkbookSourceBinding(projectRoot, descriptor, content, sourceArtifacts) {
  if (!Array.isArray(sourceArtifacts)) throw new Error("Finance scenario workbook 读取缺少当前项目的权威 source descriptors。" );
  const workbook = validateFinanceScenarioWorkbook(content.workbook, "Finance scenario workbook source binding");
  if (descriptor.provenance?.tool !== "scenario-workbook") throw new Error("Finance scenario workbook provenance.tool 无效。" );
  const candidates = new Map();
  for (const candidate of sourceArtifacts) {
    const source = sanitizeDescriptor(candidate, descriptor.projectKind, descriptor.projectId);
    if (candidates.has(source.id)) throw new Error(`Finance scenario workbook source descriptor 重复：${source.id}`);
    candidates.set(source.id, source);
  }
  const inputs = [...descriptor.provenance.inputs].sort((left, right) => left.artifactId.localeCompare(right.artifactId, "en"));
  const inputIds = inputs.map((input) => input.artifactId);
  if (
    inputs.length !== workbook.sources.length ||
    JSON.stringify(descriptor.sourceArtifactIds) !== JSON.stringify(inputIds) ||
    JSON.stringify(workbook.sources.map((source) => source.artifactId)) !== JSON.stringify(inputIds)
  ) throw new Error("Finance scenario workbook sources 与 canonical provenance 顺序不一致。" );

  const snapshotById = new Map(workbook.sources.map((source) => [source.artifactId, source]));
  const boundSources = inputs.map((input) => {
    const source = candidates.get(input.artifactId);
    if (!source || !["valuation", "portfolio"].includes(source.kind)) throw new Error(`Finance scenario workbook 来源缺失或类型无效：${input.artifactId}`);
    const snapshot = snapshotById.get(input.artifactId);
    if (!snapshot || snapshot.kind !== source.kind || snapshot.revision !== input.revision || snapshot.sha256 !== input.sha256) {
      throw new Error(`Finance scenario workbook source 快照与 provenance 不一致：${input.artifactId}`);
    }
    if (source.revision === input.revision && snapshot.title !== source.title) {
      throw new Error(`Finance scenario workbook source 标题与当前 revision descriptor 不一致：${input.artifactId}`);
    }
    const revision = verifyLineageInputRevision(projectRoot, source, input);
    const finance = canonicalFinanceContent(revision.content.finance, `Finance scenario workbook 来源 ${input.artifactId} finance`);
    if (JSON.stringify(snapshot.finance) !== JSON.stringify(finance)) {
      throw new Error(`Finance scenario workbook source Finance context 与历史 revision 不一致：${input.artifactId}`);
    }
    return {
      id: source.id,
      kind: source.kind,
      title: snapshot.title,
      revision: input.revision,
      sha256: input.sha256,
      finance,
      content: revision.content
    };
  });
  const parameters = objectValue(descriptor.provenance.parameters);
  if (cleanOneLine(parameters.title, 240) !== descriptor.title) throw new Error("Finance scenario workbook title 与 provenance parameters 不一致。" );
  const canonical = canonicalScenarioWorkbookContentFromSources(boundSources, parameters);
  if (JSON.stringify(content) !== JSON.stringify(canonical)) throw new Error("Finance scenario workbook content 未逐字绑定历史来源。" );
  return content;
}

function hydrateLineageSession(session, projectRoot, project = {}) {
  const sanitized = sanitizeLineageSession(session, project);
  const byId = new Map(sanitized.lineageArtifacts.map((descriptor) => [descriptor.id, descriptor]));
  const verifiedInputs = new Set();
  for (const descriptor of sanitized.lineageArtifacts) {
    verifyLineageArtifactSource(projectRoot, descriptor);
    for (const input of descriptor.provenance.inputs) {
      const key = `${input.artifactId}\0${input.revision}\0${input.sha256}`;
      if (verifiedInputs.has(key)) continue;
      verifyLineageInputRevision(projectRoot, byId.get(input.artifactId), input);
      verifiedInputs.add(key);
    }
  }
  return {
    ...sanitized,
    lineageArtifacts: sanitized.lineageArtifacts.map((descriptor) => ({
      ...descriptor,
      payload: artifactContentForRenderer(readArtifactContent(projectRoot, descriptor, sanitized.lineageArtifacts), descriptor.kind, descriptor.projectKind, descriptor.finance)
    }))
  };
}

function dehydrateLineageSession(session, project = {}) {
  const sanitized = sanitizeLineageSession(session, project);
  return {
    ...sanitized,
    lineageArtifacts: sanitized.lineageArtifacts.map(({ payload: _payload, ...descriptor }) => descriptor)
  };
}

function lineageSessionHasContent(session) {
  return Array.isArray(session?.lineageArtifacts) && session.lineageArtifacts.length > 0;
}

function runLineageWorker(task, options = {}) {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) return reject(options.signal.reason instanceof Error ? options.signal.reason : Object.assign(new Error("任务已取消。"), { code: "ABORT_ERR" }));
    const workerModulePath = path.join(__dirname, "lineage-worker.cjs");
    // Use a tiny eval bootstrap so Electron can load the worker module through
    // its ASAR-aware require hook. Keeping the evolving worker inside app.asar
    // makes same-runtime Restart updates atomic instead of leaving an old
    // app.asar.unpacked sidecar behind.
    const worker = new Worker(`require(${JSON.stringify(workerModulePath)});`, {
      eval: true,
      workerData: task
    });
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener?.("abort", onAbort);
      callback(value);
    };
    const onAbort = () => {
      void worker.terminate();
      finish(reject, options.signal.reason instanceof Error ? options.signal.reason : Object.assign(new Error("任务已取消。"), { code: "ABORT_ERR" }));
    };
    options.signal?.addEventListener?.("abort", onAbort, { once: true });
    worker.once("message", (message) => {
      void worker.terminate();
      if (message?.ok) finish(resolve, message.result);
      else finish(reject, Object.assign(new Error(cleanOneLine(message?.error || "Lineage worker 执行失败。", 1000)), { code: message?.code }));
    });
    worker.once("error", (error) => finish(reject, error));
    worker.once("exit", (code) => {
      if (!settled && code !== 0) finish(reject, new Error(`Lineage worker 异常退出（${code}）。`));
    });
  });
}

function copyControlledSource(projectRoot, sourcePath, options = {}) {
  const rawSourcePath = String(sourcePath || "").trim();
  if (!rawSourcePath) throw new Error("导入文件路径为空。" );
  const absolute = path.resolve(rawSourcePath);
  if (!existsSync(absolute)) throw new Error("导入文件不存在。" );
  const before = lstatSync(absolute);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error("导入目标必须是普通文件，不能是链接。" );
  if (before.size <= 0 || before.size > MAX_SOURCE_BYTES) throw new Error(`导入文件必须在 1 B 至 ${MAX_SOURCE_BYTES / 1024 / 1024} MB 之间。`);
  const extension = path.extname(absolute).toLowerCase();
  if (!importExtensions.has(extension)) throw new Error("只支持 CSV、TSV、JSON 和 XLSX。" );
  const sourceBytes = readFileSync(absolute);
  const after = lstatSync(absolute);
  if (!after.isFile() || after.isSymbolicLink() || before.size !== after.size || before.mtimeMs !== after.mtimeMs || sourceBytes.byteLength !== before.size) {
    throw new Error("导入文件在读取期间发生变化。" );
  }
  const beforeDigest = sha256Bytes(sourceBytes);
  const safeBase = path.basename(absolute).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").slice(0, 160) || `source${extension}`;
  const targetDir = ensureDirectorySafe(path.join(lineageRoot(projectRoot), "sources"), projectRoot);
  const target = path.join(targetDir, `${beforeDigest.slice(0, 12)}-${safeBase}`);
  const existedBefore = existsSync(target);
  if (existedBefore) {
    const targetInfo = lstatSync(target);
    if (!targetInfo.isFile() || targetInfo.isSymbolicLink() || targetInfo.size !== sourceBytes.byteLength || sha256File(target) !== beforeDigest) {
      throw new Error("受控来源路径已存在但身份或 SHA 不一致。" );
    }
  }
  const relativePath = normalizedRelative(path.relative(projectRoot, target));
  const journalSource = { relativePath, sha256: beforeDigest, byteLength: sourceBytes.byteLength, existedBefore };
  if (typeof options.beforeSourceCommit === "function") options.beforeSourceCommit(Object.freeze(journalSource));
  if (!existedBefore) atomicWrite(target, sourceBytes, projectRoot);
  const afterDigest = sha256File(target);
  if (afterDigest !== beforeDigest) {
    if (!existedBefore) try { unlinkSync(target); } catch {}
    throw new Error("导入文件在复制期间发生变化，SHA 校验失败。" );
  }
  return {
    path: target,
    relativePath,
    originalName: path.basename(absolute),
    sha256: beforeDigest,
    byteLength: sourceBytes.byteLength,
    importedAt: nowIso(),
    existedBefore
  };
}

function descriptorFromStored(project, input, storedBytes, relativePath) {
  const content = input.content || {};
  const table = content.table && typeof content.table === "object" ? content.table : null;
  const descriptor = {
    id: input.id,
    projectId: project.id,
    projectKind: project.kind,
    kind: input.kind,
    title: cleanOneLine(input.title || input.kind, 240),
    status: "ready",
    revision: input.revision,
    relativePath,
    mimeType: "application/vnd.iiimage.lineage+json",
    contentSha256: sha256Bytes(storedBytes),
    byteLength: storedBytes.byteLength,
    sourceArtifactIds: input.sources.map((source) => source.id),
    provenance: {
      inputs: input.sources.map((source) => ({ artifactId: source.id, revision: source.revision, sha256: source.contentSha256 })),
      tool: cleanOneLine(input.tool || input.kind, 80),
      toolVersion: "lineage-v1",
      generatedAt: input.generatedAt,
      parameters: input.parameters && typeof input.parameters === "object" ? { ...input.parameters } : {}
    },
    createdAt: input.createdAt,
    updatedAt: input.generatedAt,
    ...(table ? { rowCount: table.totalRows ?? table.rows?.length ?? 0, columnCount: table.totalColumns ?? table.columns?.length ?? 0, sheetNames: table.sheetNames || [] } : {}),
    ...(input.attributes !== undefined ? { attributes: normalizeLineageAttributes(input.attributes) } : {}),
    ...(project.kind === "finance" ? { finance: normalizeFinanceContext(content.finance || input.finance, true) } : {})
  };
  if (input.sourceFile) {
    descriptor.provenance.source = input.sourceFile;
    descriptor.provenance.sourceHistory = normalizeLineageSourceHistory(
      input.sourceHistory || [{ artifactRevision: input.revision, ...input.sourceFile }],
      `Lineage artifact ${input.id} sourceHistory`
    );
  }
  descriptor.provenance.outputSha256 = descriptor.contentSha256;
  return descriptor;
}

function writeLineageArtifact(project, input, options = {}) {
  const projectRoot = path.resolve(project.path);
  if (!allowedKinds(project.kind).has(String(input.kind || ""))) throw new Error(`Lineage artifact kind 无效：${input.kind || "empty"}`);
  const id = input.id ? strictLineageId(input.id, "Lineage 写入 artifactId") : safeId("", input.kind);
  const revision = Number(input.revision || 1);
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error("Lineage 写入 revision 无效。" );
  const generatedAt = nowIso();
  const content = validateLineageStoredContent(
    canonicalLineageContentForWrite(input.content, input.kind),
    input.kind,
    project.kind,
    project.kind === "finance" ? input.finance : undefined
  );
  if (input.kind === "report" && !content.document) throw new Error("新 report 必须包含 ReportDocumentV2。");
  validateStructureReferences(input.kind, content, input.sources || [], (input.sources || []).map((source) => ({ artifactId: source.id, revision: source.revision, sha256: source.contentSha256 })));
  const stored = {
    formatVersion: LINEAGE_FORMAT_VERSION,
    artifactId: id,
    projectId: project.id,
    projectKind: project.kind,
    kind: input.kind,
    revision,
    generatedAt,
    content
  };
  let serialized;
  try { serialized = JSON.stringify(stored, null, 2); } catch { throw new Error("Lineage artifact 内容无法序列化。" ); }
  const bytes = Buffer.from(`${serialized}\n`, "utf8");
  if (bytes.byteLength > MAX_ARTIFACT_BYTES) throw new Error(`Lineage artifact 超过 ${MAX_ARTIFACT_BYTES / 1024 / 1024} MB 安全上限。`);
  const relativePath = artifactRelativePath(id);
  const currentPath = artifactAbsolutePath(projectRoot, relativePath);
  const revisionPath = artifactRevisionPath(projectRoot, id, revision);
  const parameters = {
    ...objectValue(input.parameters),
    ...(input.kind === "report" && content.document?.structureVersion === 2 ? { reportRichBlocksVersion: 1 } : {}),
    ...(input.kind === "presentation" && content.structureVersion === DELIVERY_DECK_STRUCTURE_VERSION
      ? { presentationStructureVersion: DELIVERY_DECK_STRUCTURE_VERSION, reportDeliveryDeckVersion: 1 }
      : {
          ...(input.kind === "presentation" && content.slides?.some((slide) => slide.chartFormat) ? { presentationChartFormatVersion: 1 } : {}),
          ...(input.kind === "presentation" && content.slides?.some((slide) => slide.tableRef) ? { presentationStructureVersion: 2, presentationTablePageVersion: 1 } : {})
        })
  };
  const descriptor = descriptorFromStored(project, {
    ...input,
    content,
    parameters,
    id,
    revision,
    generatedAt,
    createdAt: input.createdAt || generatedAt
  }, bytes, relativePath);
  const expectedPrevious = Object.hasOwn(options, "expectedPrevious") ? options.expectedPrevious : null;
  if (expectedPrevious) {
    const previous = lineageJournalSnapshotFromDescriptor(expectedPrevious);
    if (previous.artifactId !== id || previous.revision + 1 !== revision) throw new Error("Lineage 写入 previous 快照与目标 revision 不连续。" );
    const previousRevisionPath = artifactRevisionPath(projectRoot, id, previous.revision);
    if (controlledLineageFileSha(currentPath, projectRoot, "Lineage current") !== previous.sha256 || controlledLineageFileSha(previousRevisionPath, projectRoot, "Lineage previous revision") !== previous.sha256) {
      throw lineageFailure("LINEAGE_REVISION_CONFLICT", `Lineage previous 磁盘快照不一致：${id}`);
    }
  } else {
    const artifactDirectory = path.dirname(currentPath);
    if (revision !== 1 || existsSync(artifactDirectory)) throw lineageFailure("LINEAGE_REVISION_CONFLICT", `Lineage 新 artifact 目标已存在或 revision 非 1：${id}`);
  }
  if (existsSync(revisionPath)) throw lineageFailure("LINEAGE_REVISION_CONFLICT", `Lineage revision 已存在：${id} r${revision}`);
  if (typeof options.beforeCommit === "function") options.beforeCommit(descriptor);
  atomicWrite(revisionPath, bytes, projectRoot);
  atomicWrite(currentPath, bytes, projectRoot);
  if (typeof options.afterCommit === "function") options.afterCommit(descriptor);
  return { ...descriptor, payload: artifactContentForRenderer(content, descriptor.kind, descriptor.projectKind, descriptor.finance) };
}

function validateProject(project, expectedKind) {
  if (!project || !lineageProjectKinds.has(String(project.kind))) throw new Error("Lineage 项目无效。" );
  if (expectedKind && project.kind !== expectedKind) throw new Error(`当前项目不是 ${expectedKind} 项目。`);
  if (!project.id || !project.path) throw new Error("Lineage 项目缺少身份或路径。" );
  mkdirSync(path.resolve(project.path), { recursive: true });
  return project;
}

async function importLineageArtifact(projectInput, input = {}, options = {}) {
  const project = validateProject(projectInput);
  let sourceFile = null;
  try {
  sourceFile = copyControlledSource(project.path, input.path, options);
  const content = await runLineageWorker({ operation: "parse", filePath: sourceFile.path }, options);
  let kind = project.kind === "data" ? "dataset" : cleanOneLine(input.kind || "market-data", 60);
  if (project.kind === "finance" && !financeImportKinds.has(kind)) throw new Error("Finance 导入类型只支持 market-data、financial-statement 或 portfolio。" );
  const finance = project.kind === "finance" ? normalizeFinanceContext(input.finance, true) : null;
  if (finance) content.finance = finance;
  const id = input.id ? strictLineageId(input.id, "Lineage 导入 artifactId") : safeId("", kind);
  return writeLineageArtifact(project, {
    id,
    kind,
    title: cleanOneLine(input.title || path.basename(sourceFile.originalName, path.extname(sourceFile.originalName)), 240),
    revision: 1,
    sources: [],
    content,
    sourceFile: {
      relativePath: sourceFile.relativePath,
      originalName: sourceFile.originalName,
      sha256: sourceFile.sha256,
      byteLength: sourceFile.byteLength,
      importedAt: sourceFile.importedAt
    },
    sourceHistory: [{
      artifactRevision: 1,
      relativePath: sourceFile.relativePath,
      originalName: sourceFile.originalName,
      sha256: sourceFile.sha256,
      byteLength: sourceFile.byteLength,
      importedAt: sourceFile.importedAt
    }],
    finance,
    tool: "data_import",
    parameters: { extension: path.extname(sourceFile.originalName).toLowerCase(), importedKind: kind }
  }, { ...options, expectedPrevious: null });
  } catch (error) {
    if (sourceFile && !sourceFile.existedBefore && existsSync(sourceFile.path)) {
      try {
        const info = lstatSync(sourceFile.path);
        if (!info.isFile() || info.isSymbolicLink() || info.size !== sourceFile.byteLength || sha256File(sourceFile.path) !== sourceFile.sha256) throw new Error("Lineage 失败导入的受控来源身份已变化，拒绝清理。" );
        rmSync(sourceFile.path);
      } catch (cleanupError) {
        throw lineageFailure("LINEAGE_SOURCE_ROLLBACK_FAILED", `${error instanceof Error ? error.message : String(error)}；来源文件回滚失败：${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
      }
    }
    throw error;
  }
}

async function refreshLineageDataRootArtifact(projectInput, currentDescriptor, input = {}, options = {}) {
  const project = validateProject(projectInput, "data");
  const current = sanitizeDescriptor(currentDescriptor, project.kind, project.id);
  const expectedRevision = Number(input.expectedArtifactRevision);
  if (current.kind !== "dataset" || current.sourceArtifactIds.length || !current.provenance?.source) {
    throw lineageFailure("LINEAGE_SOURCE_REFRESH_TARGET_INVALID", "只能刷新带受控来源的 Data 根 dataset。");
  }
  if (current.status !== "ready") throw lineageFailure("LINEAGE_SOURCE_REFRESH_TARGET_NOT_READY", "只能刷新 ready 的 Data 根 dataset。");
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw lineageFailure("LINEAGE_SOURCE_REFRESH_EXPECTED_REVISION_REQUIRED", "刷新 Data 根来源必须提供当前 expectedArtifactRevision。");
  if (expectedRevision !== current.revision) throw lineageFailure("LINEAGE_SOURCE_REFRESH_REVISION_CONFLICT", `Data 根 dataset 已从 revision ${expectedRevision} 更新，请基于当前 revision ${current.revision} 重试。`);
  const currentSourceHistory = current.provenance.sourceHistory || (current.revision === 1 ? [{ artifactRevision: 1, ...current.provenance.source }] : null);
  if (!currentSourceHistory) throw lineageFailure("LINEAGE_SOURCE_HISTORY_MISSING", "该 dataset 缺少可证明的历史来源，拒绝猜测刷新。");
  if (currentSourceHistory.length >= MAX_SOURCE_HISTORY_ENTRIES) throw lineageFailure("LINEAGE_SOURCE_HISTORY_LIMIT", `Data 根来源历史已达到 ${MAX_SOURCE_HISTORY_ENTRIES} 项上限。`);
  let sourceFile = null;
  try {
    sourceFile = copyControlledSource(project.path, input.path, options);
    if (sourceFile.sha256 === current.provenance.source.sha256) {
      throw lineageFailure("LINEAGE_SOURCE_UNCHANGED", "所选文件内容与当前 dataset 来源一致，未创建新 revision。");
    }
    const content = await runLineageWorker({ operation: "parse", filePath: sourceFile.path }, options);
    const sourceRef = {
      relativePath: sourceFile.relativePath,
      originalName: sourceFile.originalName,
      sha256: sourceFile.sha256,
      byteLength: sourceFile.byteLength,
      importedAt: sourceFile.importedAt
    };
    return writeLineageArtifact(project, {
      id: current.id,
      kind: current.kind,
      title: current.title,
      revision: current.revision + 1,
      createdAt: current.createdAt,
      sources: [],
      content,
      sourceFile: sourceRef,
      sourceHistory: [...currentSourceHistory, { artifactRevision: current.revision + 1, ...sourceRef }],
      tool: "data_source_refresh",
      parameters: { extension: path.extname(sourceFile.originalName).toLowerCase(), refreshedRoot: true }
    }, { ...options, expectedPrevious: current });
  } catch (error) {
    if (sourceFile && !sourceFile.existedBefore && existsSync(sourceFile.path)) {
      try {
        const info = lstatSync(sourceFile.path);
        if (!info.isFile() || info.isSymbolicLink() || info.size !== sourceFile.byteLength || sha256File(sourceFile.path) !== sourceFile.sha256) throw new Error("Lineage 失败刷新的受控来源身份已变化，拒绝清理。");
        rmSync(sourceFile.path);
      } catch (cleanupError) {
        throw lineageFailure("LINEAGE_SOURCE_ROLLBACK_FAILED", `${error instanceof Error ? error.message : String(error)}；来源文件回滚失败：${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
      }
    }
    throw error;
  }
}

function sourceArtifactsForOperation(session, project, operation, sourceArtifactIds) {
  const rule = sourceRules[project.kind]?.[operation];
  if (!rule) throw new Error(`${project.kind} 项目不支持 ${operation}。` );
  const sanitized = hydrateLineageSession(session, project.path, project);
  const byId = new Map(sanitized.lineageArtifacts.map((artifact) => [artifact.id, artifact]));
  const ids = [...new Set((Array.isArray(sourceArtifactIds) ? sourceArtifactIds : []).map((id) => strictLineageId(id, "来源 artifactId")))];
  if (ids.length < rule.minimum || ids.length > rule.maximum) throw new Error(`${operation} 需要 ${rule.minimum}-${rule.maximum} 个来源 artifact。` );
  const sources = ids.map((id) => {
    const artifact = byId.get(id);
    if (!artifact) throw new Error(`来源 artifact 不存在：${id}`);
    if (artifact.status !== "ready") {
      throw lineageFailure("LINEAGE_SOURCE_NOT_READY", `来源 artifact 当前为 ${artifact.status || "unknown"}，请先重算后再用于 ${operation}：${artifact.title || id}`);
    }
    if (!rule.allowed.has(artifact.kind)) throw new Error(`${operation} 不允许使用 ${artifact.kind} 作为来源。` );
    return artifact;
  });
  if (operation === "report" && !sources.some((source) => source.kind === "analysis")) throw new Error("Data report 至少需要一个 analysis artifact。" );
  if (operation === "presentation" && !sources.some((source) => source.kind === "report")) throw new Error("Presentation 至少需要一个 report artifact。" );
  if (operation === "scenario-workbook") {
    assertScenarioWorkbookControlledRoots(sanitized, sources);
    sources.sort((left, right) => left.id.localeCompare(right.id, "en"));
  }
  return { sanitized, sources };
}

function lineageArtifactReaches(session, startId, targetId) {
  const outgoing = new Map(session.lineageArtifacts.map((artifact) => [artifact.id, []]));
  for (const artifact of session.lineageArtifacts) {
    for (const sourceId of artifact.sourceArtifactIds) outgoing.get(sourceId)?.push(artifact.id);
  }
  const pending = [startId];
  const visited = new Set();
  while (pending.length) {
    const current = pending.pop();
    if (current === targetId) return true;
    if (!current || visited.has(current)) continue;
    visited.add(current);
    for (const next of outgoing.get(current) || []) pending.push(next);
  }
  return false;
}

function dataStaleRecoveryFailure(code, message) {
  const stableCode = `LINEAGE_STALE_RECOVERY_${code}`;
  return lineageFailure(stableCode, `${stableCode}: ${message}`);
}

function compareLineageArtifactIds(leftInput, rightInput) {
  const left = String(leftInput || "");
  const right = String(rightInput || "");
  return left < right ? -1 : left > right ? 1 : 0;
}

function dataStaleRecoveryProject(projectInput) {
  const project = projectInput && typeof projectInput === "object" && !Array.isArray(projectInput) ? projectInput : null;
  if (!project || project.kind !== "data" || !String(project.id || "").trim() || !String(project.path || "").trim()) {
    throw dataStaleRecoveryFailure("PROJECT_INVALID", "受控 stale recovery 仅支持具备身份和路径的 Data 项目。");
  }
  return project;
}

function dataStaleRecoveryReplayInput(artifact) {
  const operation = dataStaleRecoveryOperationByKind[artifact?.kind];
  if (!operation) {
    throw dataStaleRecoveryFailure("ARTIFACT_KIND_UNSUPPORTED", `artifact 不支持受控 stale recovery：${artifact?.id || "unknown"}`);
  }
  const tool = cleanOneLine(artifact?.provenance?.tool, 80);
  if (tool !== operation) {
    throw dataStaleRecoveryFailure("TOOL_BLOCKED", `artifact ${artifact.id} 的 provenance.tool=${tool || "missing"} 不能安全回放 ${operation}。`);
  }
  let options;
  try {
    options = operationOptionsForWorker(operation, artifact.provenance?.parameters || {});
  } catch (error) {
    throw dataStaleRecoveryFailure("RECIPE_INVALID", `artifact ${artifact.id} 的记录配方不再符合 ${operation} 闭合 schema：${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    operation,
    artifactId: artifact.id,
    expectedArtifactRevision: artifact.revision,
    sourceArtifactIds: [...artifact.sourceArtifactIds],
    title: artifact.title,
    options,
    ...(artifact.finance ? { finance: artifact.finance } : {})
  };
}

/**
 * Read-only, deterministic recovery planner. It intentionally derives every
 * replay field from the hydrated authoritative session; callers cannot supply
 * source IDs, recipes, or ordering. Main executes returned steps in order
 * inside one mutation transaction and advances a working session per step.
 */
function planLineageDataStaleRecovery(projectInput, session, input = {}) {
  const project = dataStaleRecoveryProject(projectInput);
  const request = assertPlainDataObject(input, "Data stale recovery request");
  assertOnlyKeys(request, new Set(["projectId", "artifactId", "expectedArtifactRevision"]), "Data stale recovery request");
  if (String(request.projectId || "") !== project.id) {
    throw dataStaleRecoveryFailure("PROJECT_MISMATCH", "Data stale recovery projectId 与受控项目不一致。");
  }
  const artifactId = strictLineageId(request.artifactId, "Data stale recovery artifactId");
  const expectedArtifactRevision = Number(request.expectedArtifactRevision);
  if (!Number.isSafeInteger(expectedArtifactRevision) || expectedArtifactRevision < 1) {
    throw dataStaleRecoveryFailure("EXPECTED_REVISION_REQUIRED", "Data stale recovery 必须提供正安全整数 expectedArtifactRevision。");
  }

  let hydrated;
  try {
    hydrated = hydrateLineageSession(session, project.path, project);
  } catch (error) {
    throw dataStaleRecoveryFailure("STATE_INVALID", `Data stale recovery 无法验证当前权威 session：${error instanceof Error ? error.message : String(error)}`);
  }
  if (hydrated.selectedLineageArtifactId !== artifactId) {
    throw dataStaleRecoveryFailure("ROOT_NOT_SELECTED", "Data stale recovery 只能从当前选中的根 dataset 开始。");
  }
  const byId = new Map(hydrated.lineageArtifacts.map((artifact) => [artifact.id, artifact]));
  const root = byId.get(artifactId);
  if (!root || root.kind !== "dataset" || root.status !== "ready" || root.sourceArtifactIds.length !== 0 || !root.provenance?.source) {
    throw dataStaleRecoveryFailure("ROOT_INVALID", "Data stale recovery 只能从当前 ready 且带受控来源的根 dataset 开始。");
  }
  if (root.revision !== expectedArtifactRevision) {
    throw dataStaleRecoveryFailure("REVISION_CONFLICT", `Data 根 dataset 已从 revision ${expectedArtifactRevision} 更新，请基于当前 revision ${root.revision} 重新确认。`);
  }

  const outgoing = new Map(hydrated.lineageArtifacts.map((artifact) => [artifact.id, []]));
  for (const artifact of hydrated.lineageArtifacts) {
    for (const sourceId of artifact.sourceArtifactIds) outgoing.get(sourceId)?.push(artifact.id);
  }
  for (const descendants of outgoing.values()) descendants.sort(compareLineageArtifactIds);
  const visited = new Set([root.id]);
  const pending = [root.id];
  const staleIds = new Set();
  while (pending.length) {
    const currentId = pending.shift();
    for (const descendantId of outgoing.get(currentId) || []) {
      if (visited.has(descendantId)) continue;
      visited.add(descendantId);
      pending.push(descendantId);
      if (byId.get(descendantId)?.status === "stale") staleIds.add(descendantId);
    }
  }
  if (staleIds.size === 0) return { rootArtifact: root, steps: [] };
  if (staleIds.size > MAX_DATA_STALE_RECOVERY_STEPS) {
    throw dataStaleRecoveryFailure("STEP_LIMIT", `Data stale recovery 包含 ${staleIds.size} 个 stale descendants，v1 单事务最多支持 ${MAX_DATA_STALE_RECOVERY_STEPS} 个。`);
  }

  // A reachable ready descendant is only trustworthy when every provenance
  // tuple still binds its current ready source. This accepts branches already
  // recovered after the root refresh, while failing closed on legacy or
  // externally-corrupted sessions that merely claim an old branch is ready.
  for (const descendantId of visited) {
    if (descendantId === root.id) continue;
    const artifact = byId.get(descendantId);
    if (!artifact || artifact.status !== "ready") continue;
    const provenanceInputs = new Map(artifact.provenance.inputs.map((entry) => [entry.artifactId, entry]));
    if (provenanceInputs.size !== artifact.sourceArtifactIds.length) {
      throw dataStaleRecoveryFailure("READY_DESCENDANT_OUTDATED", `ready artifact ${descendantId} 的 provenance inputs 与来源图不一致。`);
    }
    for (const sourceId of artifact.sourceArtifactIds) {
      const source = byId.get(sourceId);
      const snapshot = provenanceInputs.get(sourceId);
      if (
        !source || !snapshot || source.status !== "ready" ||
        snapshot.revision !== source.revision || snapshot.sha256 !== source.contentSha256
      ) {
        throw dataStaleRecoveryFailure("READY_DESCENDANT_OUTDATED", `ready artifact ${descendantId} 尚未绑定当前来源 ${sourceId}。`);
      }
    }
  }

  const dependencies = new Map();
  const dependents = new Map();
  const replayById = new Map();
  for (const plannedId of [...staleIds].sort(compareLineageArtifactIds)) {
    const artifact = byId.get(plannedId);
    if (!artifact || artifact.status !== "stale" || artifact.projectId !== project.id || artifact.projectKind !== "data") {
      throw dataStaleRecoveryFailure("ARTIFACT_INVALID", `stale recovery artifact 无效或越过项目边界：${plannedId}`);
    }
    const provenanceInputs = new Map(artifact.provenance.inputs.map((entry) => [entry.artifactId, entry]));
    if (provenanceInputs.size !== artifact.sourceArtifactIds.length) {
      throw dataStaleRecoveryFailure("PROVENANCE_MISMATCH", `artifact ${plannedId} 的 provenance inputs 与来源图不一致。`);
    }
    const plannedDependencies = new Set();
    for (const sourceId of artifact.sourceArtifactIds) {
      const source = byId.get(sourceId);
      const snapshot = provenanceInputs.get(sourceId);
      if (!source || !snapshot || source.projectId !== project.id || source.projectKind !== "data") {
        throw dataStaleRecoveryFailure("PROVENANCE_MISMATCH", `artifact ${plannedId} 的来源 ${sourceId} 缺失、越界或缺少 provenance 快照。`);
      }
      if (source.status === "stale") {
        if (!staleIds.has(sourceId)) {
          throw dataStaleRecoveryFailure("STALE_INPUT_OUTSIDE_CLOSURE", `artifact ${plannedId} 还依赖本次根来源闭包外的 stale 输入：${sourceId}`);
        }
        plannedDependencies.add(sourceId);
        const downstream = dependents.get(sourceId) || [];
        downstream.push(plannedId);
        dependents.set(sourceId, downstream);
        continue;
      }
      if (source.status !== "ready") {
        throw dataStaleRecoveryFailure("INPUT_NOT_READY", `artifact ${plannedId} 的来源 ${sourceId} 当前为 ${source.status || "unknown"}。`);
      }
      // The refreshed root intentionally differs from its descendants' old
      // provenance tuple. Every other ready source must still bind exactly to
      // the current descriptor; otherwise recovery would blend another hidden
      // update into this root-scoped request.
      if (sourceId !== root.id && (snapshot.revision !== source.revision || snapshot.sha256 !== source.contentSha256)) {
        throw dataStaleRecoveryFailure("PROVENANCE_MISMATCH", `artifact ${plannedId} 的 ready 来源 ${sourceId} revision/SHA 与当前权威 descriptor 不一致。`);
      }
    }
    dependencies.set(plannedId, plannedDependencies);
    replayById.set(plannedId, dataStaleRecoveryReplayInput(artifact));
  }

  for (const entries of dependents.values()) entries.sort(compareLineageArtifactIds);
  const ready = [...staleIds].filter((id) => (dependencies.get(id)?.size || 0) === 0).sort(compareLineageArtifactIds);
  const orderedIds = [];
  while (ready.length) {
    const nextId = ready.shift();
    orderedIds.push(nextId);
    for (const dependentId of dependents.get(nextId) || []) {
      const remaining = dependencies.get(dependentId);
      remaining.delete(nextId);
      if (remaining.size === 0) {
        ready.push(dependentId);
        ready.sort(compareLineageArtifactIds);
      }
    }
  }
  if (orderedIds.length !== staleIds.size) {
    throw dataStaleRecoveryFailure("CYCLE", "Data stale recovery 闭包无法形成 source-first 拓扑顺序。");
  }
  return {
    rootArtifact: root,
    steps: orderedIds.map((id) => ({ artifact: byId.get(id), operation: replayById.get(id).operation, replayInput: replayById.get(id) }))
  };
}

async function createLineageArtifact(projectInput, session, input = {}, options = {}) {
  const project = validateProject(projectInput);
  const operation = cleanOneLine(input.operation, 80);
  const kind = operationKind[operation];
  if (!kind || !allowedKinds(project.kind).has(kind)) throw new Error(`${project.kind} 项目不支持 ${operation || "空操作"}。` );
  const { sanitized, sources } = sourceArtifactsForOperation(session, project, operation, input.sourceArtifactIds);
  const requestedId = input.artifactId === undefined || input.artifactId === null || input.artifactId === ""
    ? ""
    : strictLineageId(input.artifactId, "目标 artifactId");
  const existing = requestedId ? sanitized.lineageArtifacts.find((artifact) => artifact.id === requestedId) : null;
  if (requestedId && !existing) throw new Error("要重算的目标 artifact 不存在。" );
  if (existing && existing.kind !== kind) throw new Error(`${operation} 不能覆盖 ${existing.kind} artifact。` );
  const hasExpectedRevision = Object.hasOwn(input, "expectedArtifactRevision");
  if (existing && !hasExpectedRevision) {
    throw lineageFailure("LINEAGE_RECIPE_EXPECTED_REVISION_REQUIRED", `重算 ${existing.title || existing.id} 必须显式提供 expectedArtifactRevision=${existing.revision}。`);
  }
  if (hasExpectedRevision) {
    const expectedRevision = Number(input.expectedArtifactRevision);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new Error("Lineage expectedArtifactRevision 必须是正安全整数。" );
    if (!existing || existing.revision !== expectedRevision) {
      throw lineageFailure("LINEAGE_RECIPE_REVISION_CONFLICT", `Lineage 配方已从 revision ${expectedRevision} 更新，请基于当前 revision ${existing?.revision || 0} 重新确认。`);
    }
  }
  if (existing) {
    for (const source of sources) {
      if (source.id === existing.id) throw new Error("Lineage 重算不得把目标 artifact 自身作为来源。" );
      if (lineageArtifactReaches(sanitized, existing.id, source.id)) throw new Error(`Lineage 重算来源 ${source.id} 是目标 ${existing.id} 的下游，会形成环。`);
    }
  }
  const requestedNewId = input.id === undefined || input.id === null || input.id === "" ? "" : strictLineageId(input.id, "新 artifactId");
  const id = existing?.id || requestedNewId || safeId("", kind);
  if (!existing && sanitized.lineageArtifacts.some((artifact) => artifact.id === id)) throw new Error(`Lineage 新 artifactId 已存在：${id}`);
  const sourcePayloads = sources.map((artifact) => ({
    id: artifact.id,
    kind: artifact.kind,
    title: artifact.title,
    revision: artifact.revision,
    sha256: artifact.contentSha256,
    finance: artifact.finance,
    content: readArtifactContent(project.path, artifact)
  }));
  const workerOptions = operationOptionsForWorker(operation, input.options);
  const requestedTitle = cleanOneLine(input.title, 240);
  const optionTitle = operationOptionKeys[operation]?.has("title") ? cleanOneLine(workerOptions.title, 240) : "";
  const workerTitleFollowsArtifact = ["report", "presentation", "scenario-workbook", "finance-report"].includes(operation);
  const artifactTitle = requestedTitle || (workerTitleFollowsArtifact ? optionTitle : "") || cleanOneLine(existing?.title || defaultTitle(kind), 240);
  if (workerTitleFollowsArtifact) workerOptions.title = artifactTitle;
  else if (operation === "chart" && requestedTitle && !optionTitle) workerOptions.title = requestedTitle;
  if (operation === "transform") {
    const expectedSources = workerOptions.mode === "join" ? 2 : 1;
    if (sources.length !== expectedSources) throw new Error(`transform mode=${workerOptions.mode || "basic"} 需要 ${expectedSources} 个来源 artifact。`);
  }
  if (project.kind === "finance") Object.assign(workerOptions, financeContextForOperationSources(sources, input.finance, operation));
  let content = await runLineageWorker({ operation, sources: sourcePayloads, options: workerOptions }, options);
  if (kind === "presentation") {
    const provenanceInputs = sources.map((source) => ({ artifactId: source.id, revision: source.revision, sha256: source.contentSha256 }));
    if (content.structureVersion === DELIVERY_DECK_STRUCTURE_VERSION) {
      const deck = materializeDeliveryDeck(project.path, { structureVersion: content.structureVersion, theme: content.theme, reportRef: content.reportRef, slides: content.slides }, sources, provenanceInputs, sources, "Presentation worker Delivery Deck");
      content = { ...content, ...deck };
    } else {
      const requestedSlides = assertDenseDataArray(content.slides, MAX_PRESENTATION_SLIDES, "Presentation worker slides", 1).map(({ chart: _chart, table: _table, ...slide }) => slide);
      content = canonicalLineageContentForWrite({
        ...content,
        slides: materializePresentationSlides(project.path, requestedSlides, sources, provenanceInputs, "Presentation worker slides")
      }, "presentation");
    }
  }
  if (kind === "scenario-workbook") {
    const canonical = canonicalScenarioWorkbookFromSources(sourcePayloads, workerOptions);
    const workerWorkbook = validateFinanceScenarioWorkbook(content.workbook, "Finance scenario worker workbook");
    const workerFinance = canonicalFinanceContent(content.finance, "Finance scenario worker finance");
    if (JSON.stringify(workerWorkbook) !== JSON.stringify(canonical.workbook) || JSON.stringify(workerFinance) !== JSON.stringify(canonical.finance)) {
      throw new Error("Finance scenario worker 输出未绑定 canonical 来源事实。" );
    }
    content = {
      operation: "scenario-workbook",
      workbook: canonical.workbook,
      table: scenarioWorkbookTable(canonical.workbook),
      markdown: scenarioWorkbookMarkdown(canonical.workbook, canonical.finance),
      html: scenarioWorkbookHtml(canonical.workbook, canonical.finance),
      finance: canonical.finance,
      warnings: canonical.workbook.risks
    };
  }
  validateStructureReferences(kind, content, sources, sources.map((source) => ({ artifactId: source.id, revision: source.revision, sha256: source.contentSha256 })));
  return writeLineageArtifact(project, {
    id,
    kind,
    title: artifactTitle,
    revision: existing ? existing.revision + 1 : 1,
    createdAt: existing?.createdAt,
    sources,
    content,
    finance: project.kind === "finance" ? content.finance : null,
    tool: operation,
    parameters: workerOptions
  }, { ...options, expectedPrevious: existing || null });
}

async function editLineageArtifactStructure(projectInput, currentSession, request = {}, options = {}) {
  const project = validateProject(projectInput, "data");
  const input = assertPlainDataObject(request, "Lineage structure edit request");
  assertOnlyKeys(input, new Set(["projectId", "runId", "artifactId", "expectedArtifactRevision", "structure"]), "Lineage structure edit request");
  if (String(input.projectId || "") !== project.id) throw new Error("Lineage structure edit projectId 不匹配。");
  if (typeof input.runId !== "string" || !input.runId.trim() || input.runId.length > 160) throw new Error("Lineage structure edit runId 无效。");
  if (options.signal?.aborted) throw (options.signal.reason instanceof Error ? options.signal.reason : Object.assign(new Error("数据任务已取消。"), { code: "ABORT_ERR" }));
  const artifactId = strictLineageId(input.artifactId, "Lineage structure edit artifactId");
  const expectedRevision = Number(input.expectedArtifactRevision);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new Error("Lineage structure edit expectedArtifactRevision 必须是正安全整数。");
  const sanitized = hydrateLineageSession(currentSession, project.path, project);
  const artifact = sanitized.lineageArtifacts.find((item) => item.id === artifactId);
  if (!artifact || !["report", "presentation"].includes(artifact.kind) || artifact.status !== "ready") throw new Error("仅 ready 的 report/presentation artifact 可编辑结构。");
  if (artifact.revision !== expectedRevision) throw lineageFailure("LINEAGE_STRUCTURE_REVISION_CONFLICT", `Lineage 结构已从 revision ${expectedRevision} 更新，请基于当前 revision ${artifact.revision} 重新确认。`);
  const sourceById = new Map(sanitized.lineageArtifacts.map((item) => [item.id, item]));
  const sources = artifact.sourceArtifactIds.map((id) => sourceById.get(id));
  if (sources.some((source) => !source)) throw new Error("Lineage structure edit provenance 来源缺失。");
  const content = readArtifactContent(project.path, artifact);
  let nextContent;
  if (artifact.kind === "report") {
    const document = reportDocumentV2(input.structure, "Report structure");
    const reportContent = { operation: "report", document, metrics: content.metrics, warnings: content.warnings };
    validateStructureReferences("report", reportContent, sources, artifact.provenance.inputs);
    nextContent = {
      ...reportContent,
      markdown: reportMarkdownFromDocument(document, content.metrics),
      html: reportHtmlFromDocument(document, content.metrics)
    };
  } else {
    const structure = assertPlainDataObject(input.structure, "Presentation structure");
    if (structure.structureVersion === DELIVERY_DECK_STRUCTURE_VERSION) {
      const deck = materializeDeliveryDeck(project.path, structure, sources, artifact.provenance.inputs, sanitized.lineageArtifacts, "Presentation Delivery Deck");
      nextContent = {
        operation: "presentation",
        structureVersion: DELIVERY_DECK_STRUCTURE_VERSION,
        theme: deck.theme,
        reportRef: deck.reportRef,
        slides: deck.slides,
        warnings: content.warnings
      };
    } else {
      assertOnlyKeys(structure, new Set(["structureVersion", "theme", "slides"]), "Presentation structure");
      if (![1, 2].includes(structure.structureVersion)) throw new Error("Presentation structure.structureVersion 必须为 1 或 2。");
      if (!["paper", "midnight", "slate"].includes(structure.theme)) throw new Error("Presentation structure.theme 无效。");
      const requestedSlides = validateLineageSlides(structure.slides, "Presentation structure.slides", false);
      if (structure.structureVersion === 1 && requestedSlides.some((slide) => slide.tableRef)) throw new Error("PresentationStructureV1 不支持 tableRef；请升级为 structureVersion=2。");
      const slides = materializePresentationSlides(project.path, requestedSlides, sources, artifact.provenance.inputs);
      nextContent = canonicalLineageContentForWrite({ operation: "presentation", theme: structure.theme, slides, warnings: content.warnings }, "presentation");
    }
  }
  validateStructureReferences(artifact.kind, nextContent, sources, artifact.provenance.inputs);
  if (options.signal?.aborted) throw (options.signal.reason instanceof Error ? options.signal.reason : Object.assign(new Error("数据任务已取消。"), { code: "ABORT_ERR" }));
  const { presentationStructureVersion: _presentationStructureVersion, presentationTablePageVersion: _presentationTablePageVersion, presentationChartFormatVersion: _presentationChartFormatVersion, reportDeliveryDeckVersion: _reportDeliveryDeckVersion, ...basePresentationParameters } = objectValue(artifact.provenance.parameters);
  return writeLineageArtifact(project, {
    id: artifact.id,
    kind: artifact.kind,
    title: artifact.kind === "report" ? nextContent.document.title : artifact.title,
    revision: artifact.revision + 1,
    createdAt: artifact.createdAt,
    sources,
    content: nextContent,
    tool: "structure-edit",
    parameters: {
       ...basePresentationParameters,
      structureVersion: artifact.kind === "presentation" && nextContent.structureVersion === DELIVERY_DECK_STRUCTURE_VERSION ? DELIVERY_DECK_STRUCTURE_VERSION : 2,
       ...(artifact.kind === "report" ? { reportRichBlocksVersion: 1 } : nextContent.structureVersion === DELIVERY_DECK_STRUCTURE_VERSION
         ? { presentationStructureVersion: DELIVERY_DECK_STRUCTURE_VERSION, reportDeliveryDeckVersion: 1 }
         : { presentationChartFormatVersion: 1, presentationStructureVersion: 2, ...(nextContent.slides.some((slide) => slide.tableRef) ? { presentationTablePageVersion: 1 } : {}) })
    }
  }, { ...options, expectedPrevious: artifact });
}

function defaultTitle(kind) {
  const labels = {
    dataset: "数据集", clean: "清洗结果", transform: "变换结果", analysis: "分析结果", chart: "数据图表", report: "分析报告", presentation: "演示文稿",
    "market-data": "市场数据", "financial-statement": "财务报表", valuation: "估值分析", portfolio: "组合分析", "scenario-workbook": "多标的情景工作簿", "risk-review": "风险复核", "finance-report": "财经报告"
  };
  return `${labels[kind] || kind} ${new Date().toLocaleString("zh-CN", { hour12: false })}`;
}

function markDownstreamStale(artifacts) {
  const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const next = artifacts.map((artifact) => ({ ...artifact }));
  const nextById = new Map(next.map((artifact) => [artifact.id, artifact]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const artifact of next) {
      if (!artifact.sourceArtifactIds.length || artifact.status === "stale") continue;
      const stale = artifact.sourceArtifactIds.some((sourceId) => {
        const source = nextById.get(sourceId);
        const originalSource = byId.get(sourceId);
        const snapshot = artifact.provenance.inputs.find((input) => input.artifactId === sourceId);
        return !source || source.status === "stale" || !snapshot || snapshot.revision !== source.revision || snapshot.sha256 !== source.contentSha256 || originalSource?.status === "stale";
      });
      if (stale) {
        artifact.status = "stale";
        changed = true;
      }
    }
  }
  return next;
}

function lineageSessionWithArtifact(session, project, artifact) {
  const sanitized = sanitizeLineageSession(session, project);
  const artifacts = markDownstreamStale([
    ...sanitized.lineageArtifacts.filter((item) => item.id !== artifact.id),
    artifact
  ]);
  const existingLayout = sanitized.lineageLayout.find((item) => item.artifactId === artifact.id);
  const sameColumnIndex = artifacts.filter((item) => lineageLayoutColumn(item.kind) === lineageLayoutColumn(artifact.kind) && item.id !== artifact.id).length;
  return sanitizeLineageSession({
    ...sanitized,
    lineageArtifacts: artifacts,
    lineageEdges: undefined,
    lineageLayout: [
      ...sanitized.lineageLayout.filter((item) => item.artifactId !== artifact.id),
      existingLayout || { artifactId: artifact.id, ...defaultLayout(artifact.kind, sameColumnIndex) }
    ],
    selectedLineageArtifactId: artifact.id
  }, project);
}

function readLineageArtifact(projectInput, descriptor, sourceArtifacts = undefined) {
  const project = validateProject(projectInput);
  const sanitized = sanitizeDescriptor(descriptor, project.kind, project.id);
  if (!sanitized) throw new Error("Lineage artifact descriptor 无效。" );
  return { ...sanitized, payload: artifactContentForRenderer(readArtifactContent(project.path, sanitized, sourceArtifacts), sanitized.kind, sanitized.projectKind, sanitized.finance) };
}

function csvEscape(value) {
  const raw = value === null || value === undefined ? "" : String(value);
  const text = typeof value === "string" && /^[\s\u0000-\u001f\u007f-\u009f]*[=+\-@]/u.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function tableCsv(table) {
  const columns = table.columns || [];
  return [
    columns.map((column) => csvEscape(column.label)).join(","),
    ...(table.rows || []).map((row) => columns.map((column) => csvEscape(row?.[column.key])).join(","))
  ].join("\r\n");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function reportHtml(markdown, title) {
  const body = String(markdown || "").split(/\r?\n/).map((line) => {
    if (line.startsWith("# ")) return `<h1>${escapeHtml(line.slice(2))}</h1>`;
    if (line.startsWith("## ")) return `<h2>${escapeHtml(line.slice(3))}</h2>`;
    if (line.startsWith("- ")) return `<p>• ${escapeHtml(line.slice(2))}</p>`;
    if (line.startsWith("> ")) return `<blockquote>${escapeHtml(line.slice(2))}</blockquote>`;
    return line.trim() ? `<p>${escapeHtml(line)}</p>` : "";
  }).join("\n");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font:16px/1.7 system-ui,sans-serif;max-width:960px;margin:48px auto;padding:0 24px;color:#172033}h1,h2{line-height:1.25}blockquote{border-left:4px solid #d4a548;padding:12px 16px;background:#fff8e8}</style></head><body>${body}</body></html>`;
}

function chartSvg(chart) {
  const width = 1280;
  const height = 720;
  const margin = { left: 92, right: 48, top: 92, bottom: 120 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const chartType = ["bar", "line", "area", "scatter"].includes(chart?.chartType) ? chart.chartType : "bar";
  const rawCategories = Array.isArray(chart?.categories) ? chart.categories : [];
  const chartPoints = (Array.isArray(chart?.values) ? chart.values : [])
    .map((value, index) => ({ value: finiteDataNumber(value), category: rawCategories[index] ?? String(index + 1) }))
    .filter((point) => point.value !== null)
    .slice(0, 2000);
  const values = chartPoints.map((point) => point.value);
  const categories = chartPoints.map((point) => point.category);
  const minimum = Math.min(0, ...values);
  const maximum = Math.max(0, ...values);
  const range = maximum - minimum || 1;
  const y = (value) => margin.top + plotHeight - ((value - minimum) / range) * plotHeight;
  const baseline = y(0);
  const step = plotWidth / Math.max(1, values.length);
  const points = values.map((value, index) => ({
    x: margin.left + index * step + step * 0.5,
    y: y(value),
    value,
    category: categories[index] ?? String(index + 1)
  }));
  const bars = points.map((point, index) => {
    const x = margin.left + index * step + step * 0.12;
    const barWidth = Math.max(2, step * 0.76);
    const top = Math.min(point.y, baseline);
    const barHeight = Math.max(1, Math.abs(baseline - point.y));
    return `<g><rect x="${x.toFixed(2)}" y="${top.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${barHeight.toFixed(2)}" rx="4" fill="#3b82f6"/><title>${escapeHtml(point.category)}: ${point.value}</title></g>`;
  }).join("");
  const pointList = points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
  const dots = points.map((point) => `<g><circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${chartType === "scatter" ? 7 : 4.5}" fill="#2563eb" stroke="#ffffff" stroke-width="2"/><title>${escapeHtml(point.category)}: ${point.value}</title></g>`).join("");
  let marks = bars;
  if (chartType === "line") marks = `${points.length > 1 ? `<polyline points="${pointList}" fill="none" stroke="#2563eb" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>` : ""}${dots}`;
  else if (chartType === "area") {
    const areaPoints = points.length ? `${points[0].x.toFixed(2)},${baseline.toFixed(2)} ${pointList} ${points[points.length - 1].x.toFixed(2)},${baseline.toFixed(2)}` : "";
    marks = `${areaPoints ? `<polygon points="${areaPoints}" fill="#93c5fd" fill-opacity="0.55"/><polyline points="${pointList}" fill="none" stroke="#2563eb" stroke-width="4" stroke-linejoin="round"/>` : ""}${dots}`;
  } else if (chartType === "scatter") marks = dots;
  const labels = categories.map((category, index) => {
    if (categories.length > 20 && index % Math.ceil(categories.length / 20) !== 0) return "";
    const x = margin.left + index * step + step * 0.5;
    return `<text x="${x.toFixed(2)}" y="${height - 72}" text-anchor="end" transform="rotate(-35 ${x.toFixed(2)} ${height - 72})" font-size="16" fill="#526175">${escapeHtml(String(category).slice(0, 24))}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" data-chart-type="${chartType}" aria-label="${escapeHtml(chart?.accessibleDescription || chart?.title || "Chart")}"><rect width="100%" height="100%" fill="#f8fafc"/><text x="${margin.left}" y="52" font-size="30" font-family="system-ui,sans-serif" font-weight="700" fill="#172033">${escapeHtml(chart?.title || "Chart")}</text><line x1="${margin.left}" x2="${width - margin.right}" y1="${baseline.toFixed(2)}" y2="${baseline.toFixed(2)}" stroke="#94a3b8"/>${marks}${labels}</svg>`;
}

function generatedExportBuffer(value, format) {
  let bytes = null;
  if (Buffer.isBuffer(value)) bytes = value;
  else if (value instanceof ArrayBuffer) bytes = Buffer.from(value);
  else if (ArrayBuffer.isView(value)) bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (!bytes || bytes.byteLength <= 0) throw new Error(`${format.toUpperCase()} 生成结果不是有效 Buffer。`);
  return bytes;
}

async function writeXlsx(table) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(cleanOneLine(table.sheetName || "Data", 31) || "Data");
  sheet.columns = (table.columns || []).map((column) => ({ header: column.label, key: column.key, width: Math.min(40, Math.max(12, String(column.label).length + 4)) }));
  for (const row of table.rows || []) sheet.addRow(row);
  return generatedExportBuffer(await workbook.xlsx.writeBuffer(), "xlsx");
}

function financeSourceUrlForExport(value) {
  if (!value) return "";
  try {
    const url = new URL(String(value));
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function scenarioWorkbookXlsxSheets(artifact, content) {
  const workbook = validateFinanceScenarioWorkbook(content.workbook, "Scenario XLSX workbook");
  const scenarioById = new Map(workbook.scenarios.map((scenario) => [scenario.id, new Map(scenario.values.map((entry) => [entry.sourceArtifactId, entry.value]))]));
  const sourceById = new Map(workbook.sources.map((source) => [source.artifactId, source]));
  const sheets = [
    {
      name: "Scenarios",
      rows: [
        ["Source Artifact", "Asset", "Metric Key", "Metric Label", "Measure", "Unit", "Scale", "Baseline", "Upside", "Stress", "Source Name", "AS OF", "Currency", "Timezone"],
        ...workbook.sources.map((source) => [
          source.artifactId, source.title, workbook.metric.key, workbook.metric.label, workbook.metric.measure, workbook.metric.unit, workbook.metric.scale,
          scenarioById.get("baseline").get(source.artifactId), scenarioById.get("upside").get(source.artifactId), scenarioById.get("stress").get(source.artifactId),
          source.finance.sourceName, source.finance.asOf, source.finance.currency, source.finance.timezone
        ])
      ]
    },
    {
      name: "Facts",
      rows: [
        ["Fact ID", "Source Artifact", "Label", "Value", "Measure", "Unit", "Scale"],
        ...workbook.facts.map((fact) => [fact.id, fact.sourceArtifactId, fact.label, fact.value, fact.measure, fact.unit, fact.scale])
      ]
    },
    {
      name: "Assumptions",
      rows: [
        ["Assumption ID", "Label", "Adjustment Percent", "Direction", "Scenario Rule"],
        ...workbook.assumptions.map((assumption) => [assumption.id, assumption.label, assumption.adjustmentPercent, workbook.metric.direction, workbook.metric.scenarioRule])
      ]
    },
    {
      name: "Inferences",
      rows: [
        ["Inference ID", "Kind", "Text", "Evidence Source Artifacts"],
        ...workbook.inferences.map((inference) => [inference.id, inference.kind, inference.text, inference.sourceArtifactIds.join(",")])
      ]
    },
    {
      name: "Risks",
      rows: [
        ["Category", "Index", "Text"],
        ...workbook.risks.map((text, index) => ["risk", index + 1, text]),
        ...workbook.limitations.map((text, index) => ["limitation", index + 1, text])
      ]
    },
    {
      name: "Provenance",
      rows: [
        ["Record Type", "Artifact ID", "Kind", "Title", "Revision", "SHA-256", "AS OF", "Source Name", "Source URL", "Currency", "Unit", "Timezone"],
        ["workbook", artifact.id, artifact.kind, artifact.title, artifact.revision, artifact.contentSha256, content.finance.asOf, content.finance.sourceName, "", content.finance.currency, content.finance.unit, content.finance.timezone],
        ...artifact.provenance.inputs.map((input) => {
          const source = sourceById.get(input.artifactId);
          if (!source || source.revision !== input.revision || source.sha256 !== input.sha256) throw new Error(`Scenario XLSX provenance source 不一致：${input.artifactId}`);
          return ["source", source.artifactId, source.kind, source.title, source.revision, source.sha256, source.finance.asOf, source.finance.sourceName, financeSourceUrlForExport(source.finance.sourceUrl), source.finance.currency, source.finance.unit, source.finance.timezone];
        }),
        ["parameter", "title", "", String(artifact.provenance.parameters?.title || ""), "", "", "", "", "", "", "", ""],
        ["parameter", "metricKey", "", String(artifact.provenance.parameters?.metricKey || ""), "", "", "", "", "", "", "", ""],
        ["parameter", "upsidePercent", "", Number(artifact.provenance.parameters?.upsidePercent), "", "", "", "", "", "", "", ""],
        ["parameter", "stressPercent", "", Number(artifact.provenance.parameters?.stressPercent), "", "", "", "", "", "", "", ""]
      ]
    }
  ];
  return sheets;
}

async function deterministicOfficeZip(bytes, format) {
  const input = await JSZip.loadAsync(bytes);
  const output = new JSZip();
  const fixedDate = new Date("1980-01-01T00:00:00.000Z");
  for (const name of Object.keys(input.files).sort((left, right) => left.localeCompare(right, "en"))) {
    const entry = input.files[name];
    if (entry.dir) output.file(name, Buffer.alloc(0), { dir: true, date: fixedDate });
    else output.file(name, await entry.async("nodebuffer"), { binary: true, date: fixedDate, compression: "DEFLATE", compressionOptions: { level: 9 } });
  }
  return generatedExportBuffer(await output.generateAsync({ type: "nodebuffer", platform: "DOS", compression: "DEFLATE", compressionOptions: { level: 9 } }), format);
}

async function writeScenarioWorkbookXlsx(artifact, content) {
  const workbook = new ExcelJS.Workbook();
  const fixedDate = new Date("1980-01-01T00:00:00.000Z");
  workbook.creator = "Aieyra Workspace";
  workbook.lastModifiedBy = "Aieyra Workspace";
  workbook.created = fixedDate;
  workbook.modified = fixedDate;
  workbook.calcProperties.fullCalcOnLoad = false;
  for (const definition of scenarioWorkbookXlsxSheets(artifact, content)) {
    const sheet = workbook.addWorksheet(definition.name, { views: [{ state: "frozen", ySplit: 1 }] });
    definition.rows.forEach((row) => sheet.addRow(row));
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
    sheet.getRow(1).alignment = { vertical: "middle", wrapText: true };
    sheet.columns.forEach((column) => {
      const values = column.values.slice(1).map((value) => String(value ?? ""));
      column.width = Math.min(52, Math.max(12, ...values.map((value) => value.length + 2)));
    });
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: definition.rows[0].length } };
  }
  const bytes = generatedExportBuffer(await workbook.xlsx.writeBuffer(), "xlsx");
  return deterministicOfficeZip(bytes, "xlsx");
}

function presentationTheme(theme) {
  return {
    paper: { background: "F8FAFC", title: "172033", body: "334155", foot: "64748B" },
    midnight: { background: "0F172A", title: "F8FAFC", body: "CBD5E1", foot: "94A3B8" },
    slate: { background: "E2E8F0", title: "0F172A", body: "334155", foot: "475569" }
  }[theme] || null;
}

const PRESENTATION_FOOTER_TEXT = "Aieyra Workspace · 可追溯演示";
const MAX_RENDERED_PRESENTATION_PAGES = 600;
const PRESENTATION_TABLE_ROWS_PER_PAGE = 12;
const PRESENTATION_LAYOUT = Object.freeze({
  slide: Object.freeze({ x: 0, y: 0, w: 13.333, h: 7.5 }),
  title: Object.freeze({ x: 0.72, y: 0.52, w: 11.9, h: 0.68 }),
  footer: Object.freeze({ x: 0.72, y: 7.05, w: 4.5, h: 0.22 }),
  citation: Object.freeze({ x: 5.35, y: 7.05, w: 7.25, h: 0.22 }),
  tableCaption: Object.freeze({ x: 0.85, y: 1.34, w: 11.65, h: 0.32 }),
  table: Object.freeze({ x: 0.85, y: 1.78, w: 11.65, h: 4.94 }),
  text: Object.freeze({ x: 0.9, y: 1.45, w: 11.5, h: 5.25 }),
  rightText: Object.freeze({ x: 8.55, y: 1.45, w: 3.95, h: 5.25 }),
  leftText: Object.freeze({ x: 0.78, y: 1.45, w: 4.0, h: 5.25 }),
  chart: Object.freeze({ x: 0.85, y: 1.42, w: 11.65, h: 5.35 }),
  leftChart: Object.freeze({ x: 0.78, y: 1.45, w: 7.48, h: 5.25 }),
  rightChart: Object.freeze({ x: 5.02, y: 1.45, w: 7.48, h: 5.25 })
});

const PRESENTATION_CHART_PALETTES = Object.freeze({
  categorical: Object.freeze(["2563EB", "059669", "D97706", "DC2626", "7C3AED", "0891B2"]),
  sequential: Object.freeze(["0369A1", "0EA5E9", "7DD3FC", "BAE6FD"]),
  diverging: Object.freeze(["DC2626", "F59E0B", "CBD5E1", "60A5FA", "2563EB"])
});

function presentationChartColors(format, themePalette) {
  return format.palette === "theme"
    ? [themePalette.title, themePalette.body, themePalette.foot]
    : [...PRESENTATION_CHART_PALETTES[format.palette]];
}

function presentationChartLayout(format, hasBullets) {
  if (format.placement === "full") return "chart";
  if (format.placement === "left") return "chart-left";
  if (format.placement === "right") return "chart-right";
  return hasBullets ? "chart-right" : "chart";
}

function presentationTextRect(layout) {
  return layout === "chart-left" ? PRESENTATION_LAYOUT.rightText : layout === "chart-right" ? PRESENTATION_LAYOUT.leftText : PRESENTATION_LAYOUT.text;
}

function presentationChartRect(layout) {
  return layout === "chart-left" ? PRESENTATION_LAYOUT.leftChart : layout === "chart-right" ? PRESENTATION_LAYOUT.rightChart : PRESENTATION_LAYOUT.chart;
}

function presentationTextWidthUnits(value) {
  let units = 0;
  for (const character of String(value ?? "")) {
    if (character === " ") units += 0.55;
    else if (/^[\u0000-\u007f]$/.test(character)) {
      if (/^[MW@#%&]$/.test(character)) units += 1.4;
      else if (/^[ilI1.,:;'|!]$/.test(character)) units += 0.55;
      else units += 1;
    } else units += 2;
  }
  return units;
}

function presentationSingleLineText(value, rect, fontSize, label) {
  const raw = String(value ?? "");
  const text = cleanOneLine(raw, 1000);
  const capacity = Math.floor((rect.w * 72 / fontSize) * 1.9);
  if (!text || raw !== text || presentationTextWidthUnits(text) > capacity) {
    throw lineageFailure("LINEAGE_PRESENTATION_LAYOUT_OVERFLOW", `${label} 无法在固定可读字号下完整排入单行文本框，请缩短内容后重试。`);
  }
  return text;
}

function presentationFixedText(descriptor) {
  return {
    title: presentationSingleLineText(descriptor.title, PRESENTATION_LAYOUT.title, 26, `Presentation slide ${descriptor.id} 标题`),
    tableCaption: descriptor.table
      ? presentationSingleLineText(descriptor.table.caption, PRESENTATION_LAYOUT.tableCaption, 12, `Presentation slide ${descriptor.id} 表格标题`)
      : null,
    citation: descriptor.citation
      ? presentationSingleLineText(deliveryCitationText(descriptor.citation), PRESENTATION_LAYOUT.citation, 7.5, `Presentation slide ${descriptor.id} 引用`)
      : null
  };
}

function presentationBulletLineCost(value, charactersPerLine) {
  return String(value).replace(/\r\n?/g, "\n").split("\n")
    .reduce((total, line) => total + Math.max(1, Math.ceil([...line].length / charactersPerLine)), 0) + 0.45;
}

function takePresentationBullets(items, charactersPerLine, maximumLines, allowEmpty = false) {
  const selected = [];
  let usedLines = 0;
  for (const item of items) {
    const itemLines = presentationBulletLineCost(item, charactersPerLine);
    if (itemLines > maximumLines) {
      if (allowEmpty && selected.length === 0) break;
      throw lineageFailure("LINEAGE_PRESENTATION_LAYOUT_OVERFLOW", "单条演示要点无法在可读字号下完整排入页面，请拆分该要点后重试。" );
    }
    if (selected.length && usedLines + itemLines > maximumLines) break;
    selected.push(item);
    usedLines += itemLines;
  }
  return selected;
}

function presentationTableRowHeight(cells, columnCount, label) {
  const charactersPerLine = Math.max(8, Math.floor(72 / Math.max(1, columnCount)));
  const lines = Math.max(1, ...cells.map((cell) => String(cell).replace(/\r\n?/g, "\n").split("\n").reduce((count, line) => count + Math.max(1, Math.ceil([...line].length / charactersPerLine)), 0)));
  const height = Math.max(0.34, 0.16 + lines * 0.19);
  if (height > PRESENTATION_LAYOUT.table.h - 0.34) throw lineageFailure("LINEAGE_PRESENTATION_LAYOUT_OVERFLOW", `${label} 无法在可读字号下完整排入表格页，请缩短内容或减少列。`);
  return Number(height.toFixed(3));
}

function presentationTablePages(descriptor, table) {
  const headerHeight = presentationTableRowHeight(table.columns.map((column) => column.label), table.columns.length, `Presentation slide ${descriptor.id} 表头`);
  const pages = [];
  let rows = [];
  let rowHeights = [];
  let used = headerHeight;
  const flush = () => {
    if (!rows.length) return;
    pages.push({ rows, rowHeights: [headerHeight, ...rowHeights] });
    rows = [];
    rowHeights = [];
    used = headerHeight;
  };
  for (const [index, row] of table.rows.entries()) {
    const height = presentationTableRowHeight(row.cells, table.columns.length, `Presentation slide ${descriptor.id} 第 ${index + 1} 行`);
    if (rows.length && (rows.length >= PRESENTATION_TABLE_ROWS_PER_PAGE || used + height > PRESENTATION_LAYOUT.table.h)) flush();
    if (used + height > PRESENTATION_LAYOUT.table.h) throw lineageFailure("LINEAGE_PRESENTATION_LAYOUT_OVERFLOW", `Presentation slide ${descriptor.id} 第 ${index + 1} 行无法完整排入表格页。`);
    rows.push(row);
    rowHeights.push(height);
    used += height;
  }
  flush();
  return pages;
}

function paginatePresentationSlides(slides, chartForSlide, tableForSlide) {
  const pages = [];
  for (const descriptor of slides) {
    const chart = chartForSlide(descriptor);
    const table = tableForSlide(descriptor);
    if (table) {
      const chunks = presentationTablePages(descriptor, table);
      for (const [continuationIndex, chunk] of chunks.entries()) {
        const tableRect = { ...PRESENTATION_LAYOUT.table, h: Number(chunk.rowHeights.reduce((sum, height) => sum + height, 0).toFixed(3)) };
        pages.push({
          id: `${descriptor.id}--page-${continuationIndex + 1}`, sourceSlideId: descriptor.id, continuationIndex,
          title: continuationIndex ? `${descriptor.title}（续 ${continuationIndex + 1}）` : descriptor.title,
          bullets: [], table: { ...table, rows: chunk.rows }, tableRowHeights: chunk.rowHeights, tableRect, layout: "table",
          ...(continuationIndex === 0 && descriptor.speakerNotes ? { speakerNotes: descriptor.speakerNotes } : {})
        });
      }
      if (pages.length > MAX_RENDERED_PRESENTATION_PAGES) throw lineageFailure("LINEAGE_PRESENTATION_LAYOUT_OVERFLOW", `演示分页超过 ${MAX_RENDERED_PRESENTATION_PAGES} 页安全上限，请拆分 artifact 后导出。`);
      continue;
    }
    const chartFormat = chart ? validatePresentationChartFormat(descriptor.chartFormat || defaultPresentationChartFormat, `Presentation slide ${descriptor.id}.chartFormat`) : null;
    const remaining = [...descriptor.bullets];
    let continuationIndex = 0;
    if (chart) {
      const preferredLayout = presentationChartLayout(chartFormat, remaining.length > 0);
      const firstBullets = preferredLayout === "chart" ? [] : takePresentationBullets(remaining, 28, 13, true);
      remaining.splice(0, firstBullets.length);
      pages.push({
        id: `${descriptor.id}--page-1`, sourceSlideId: descriptor.id, continuationIndex,
        title: descriptor.title, bullets: firstBullets, chart, chartFormat,
        layout: preferredLayout,
        ...(descriptor.speakerNotes ? { speakerNotes: descriptor.speakerNotes } : {})
      });
      continuationIndex += 1;
    }
    while (remaining.length) {
      const pageBullets = takePresentationBullets(remaining, 72, 15);
      remaining.splice(0, pageBullets.length);
      pages.push({
        id: `${descriptor.id}--page-${continuationIndex + 1}`, sourceSlideId: descriptor.id, continuationIndex,
        title: descriptor.title, bullets: pageBullets, layout: "text",
        ...(!chart && continuationIndex === 0 && descriptor.speakerNotes ? { speakerNotes: descriptor.speakerNotes } : {})
      });
      continuationIndex += 1;
    }
    if (!chart && descriptor.bullets.length === 0) {
      pages.push({
        id: `${descriptor.id}--page-1`, sourceSlideId: descriptor.id, continuationIndex: 0,
        title: descriptor.title, bullets: [], layout: "text",
        ...(descriptor.speakerNotes ? { speakerNotes: descriptor.speakerNotes } : {})
      });
    }
    if (pages.length > MAX_RENDERED_PRESENTATION_PAGES) {
      throw lineageFailure("LINEAGE_PRESENTATION_LAYOUT_OVERFLOW", `演示分页超过 ${MAX_RENDERED_PRESENTATION_PAGES} 页安全上限，请拆分 artifact 后导出。`);
    }
  }
  return pages;
}

function deliveryCitationText(citation) {
  return `Report ${citation.reportArtifactId} · r${citation.reportRevision} · sha:${citation.reportSha256.slice(0, 12)}${citation.blockIds.length ? ` · blocks:${citation.blockIds.join(",")}` : ""}`;
}

function deliveryBlockBullets(blocks) {
  const bullets = [];
  for (const block of blocks || []) {
    if (block.type === "paragraph") bullets.push(block.text);
    else if (block.type === "bullets") bullets.push(...block.items);
    else if (block.type === "metrics") for (const metric of block.metrics) bullets.push(`${metric.label || metric.key || "指标"}：${metric.value ?? ""}`);
    else if (block.type === "callout") bullets.push(`${block.title}：${block.text}`);
    else if (block.type === "sources") bullets.push(...block.inputArtifactIds.map((id) => `来源 artifact：${id}`));
  }
  return bullets;
}

function deliveryDeckRenderedSlides(deck) {
  const authored = validateDeliveryDeck({ structureVersion: deck.structureVersion, theme: deck.theme, reportRef: deck.reportRef, slides: deck.slides }, "Presentation Delivery Deck", true);
  const descriptors = authored.slides.map((slide) => {
    const title = slide.title || (slide.type === "cover" ? "Data Delivery Deck" : slide.type === "provenance" ? "来源与溯源" : slide.type === "report-blocks" ? "报告要点" : slide.type === "chart" ? "数据图表" : "数据表格");
    const base = { id: slide.id, sourceSlideId: slide.id, continuationIndex: 0, title, speakerNotes: slide.speakerNotes, citation: slide.citation, deliveryType: slide.type };
    if (slide.type === "cover") return { ...base, bullets: slide.subtitle ? [slide.subtitle] : [], layout: "text" };
    if (slide.type === "report-blocks" || slide.type === "provenance") return { ...base, bullets: deliveryBlockBullets(slide.resolvedBlocks), layout: "text" };
    if (slide.type === "chart") return { ...base, bullets: [], chart: slide.chart, chartFormat: slide.chartFormat, layout: "chart" };
    return { ...base, bullets: [], table: slide.table, tableRowHeights: null, tableRect: null, layout: "table" };
  });
  const pages = paginatePresentationSlides(descriptors, (descriptor) => descriptor.chart || null, (descriptor) => descriptor.table || null);
  if (pages.length > MAX_DELIVERY_DECK_RENDERED_PAGES) throw lineageFailure("LINEAGE_PRESENTATION_LAYOUT_OVERFLOW", `Canonical Report Delivery Deck 分页超过 ${MAX_DELIVERY_DECK_RENDERED_PAGES} 页安全上限。`);
  const citations = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor.citation]));
  return pages.map((page) => {
    const citation = citations.get(page.sourceSlideId);
    if (!citation) throw new Error(`Delivery Deck rendered page ${page.id} 缺少 source citation。`);
    return { ...page, citation: { ...citation, blockIds: [...citation.blockIds] } };
  });
}

function presentationChartSpec(pptx, chart) {
  const chartType = {
    bar: pptx.ChartType.bar,
    line: pptx.ChartType.line,
    area: pptx.ChartType.area,
    scatter: pptx.ChartType.scatter
  }[chart.chartType];
  if (!chartType) throw new Error("Presentation chartType 无效。" );
  if (chart.chartType === "scatter") {
    const xValues = chart.categories.map((category) => finiteDataNumber(category));
    if (xValues.some((value) => value === null)) {
      throw lineageFailure("LINEAGE_PRESENTATION_SCATTER_X_REQUIRED", "Scatter PPTX 需要可解析为有限数字的 X categories；当前分类轴不能伪装成数值散点轴。" );
    }
    return {
      chartType,
      data: [
        { name: chart.xColumn || "X", values: xValues },
        { name: chart.title || chart.yColumn || "数据", values: chart.values }
      ],
      xValues
    };
  }
  return {
    chartType,
    data: [{ name: chart.title || "数据", labels: chart.categories, values: chart.values }],
    xValues: null
  };
}

function chartForPresentationSlide(projectRoot, artifact, chartArtifactId) {
  const snapshot = artifact.provenance.inputs.find((input) => input.artifactId === chartArtifactId);
  if (!snapshot) throw new Error("Presentation chartArtifactId 未被 provenance 授权。");
  const revisionPath = artifactRevisionPath(projectRoot, chartArtifactId, snapshot.revision);
  if (!existsSync(revisionPath) || controlledLineageFileSha(revisionPath, projectRoot, "Presentation chart revision") !== snapshot.sha256) throw new Error("Presentation chart revision/SHA 快照无效。");
  let stored;
  try { stored = JSON.parse(readFileSync(revisionPath, "utf8")); } catch { throw new Error("Presentation chart revision JSON 损坏。"); }
  if (stored?.formatVersion !== LINEAGE_FORMAT_VERSION || stored?.artifactId !== chartArtifactId || stored?.projectId !== artifact.projectId || stored?.projectKind !== artifact.projectKind || stored?.kind !== "chart" || Number(stored?.revision) !== snapshot.revision) {
    throw new Error("Presentation chart 引用不是受控 chart 快照。");
  }
  return validateLineageStoredContent(stored.content, "chart", artifact.projectKind).chart;
}

function tableForPresentationSlide(projectRoot, artifact, descriptor) {
  if (!descriptor.tableRef) return null;
  const ref = validatePresentationTableRef(descriptor.tableRef, `Presentation slide ${descriptor.id}.tableRef`);
  const snapshot = artifact.provenance.inputs.find((input) => input.artifactId === ref.reportArtifactId);
  if (!snapshot) throw new Error("Presentation tableRef 未被 provenance 授权。");
  const revisionPath = artifactRevisionPath(projectRoot, ref.reportArtifactId, snapshot.revision);
  if (!existsSync(revisionPath) || controlledLineageFileSha(revisionPath, projectRoot, "Presentation report revision") !== snapshot.sha256) throw new Error("Presentation Report revision/SHA 快照无效。");
  let stored;
  try { stored = JSON.parse(readFileSync(revisionPath, "utf8")); } catch { throw new Error("Presentation Report revision JSON 损坏。"); }
  if (stored?.formatVersion !== LINEAGE_FORMAT_VERSION || stored?.artifactId !== ref.reportArtifactId || stored?.projectId !== artifact.projectId || stored?.projectKind !== artifact.projectKind || stored?.kind !== "report" || Number(stored?.revision) !== snapshot.revision) {
    throw new Error("Presentation tableRef 不是受控 Report 快照。");
  }
  const reportContent = validateLineageStoredContent(stored.content, "report", artifact.projectKind);
  const source = { id: stored.artifactId, kind: "report", status: "ready", revision: snapshot.revision, contentSha256: snapshot.sha256 };
  const resolved = presentationTableSnapshotFromReport(source, reportContent, ref, `Presentation slide ${descriptor.id}.tableRef`);
  if (!descriptor.table || JSON.stringify(descriptor.tableRef) !== JSON.stringify(resolved.ref) || JSON.stringify(descriptor.table) !== JSON.stringify(resolved.table)) throw new Error("Presentation stored table 快照与 provenance revision 不一致。");
  return descriptor.table;
}

async function writePresentation(projectRoot, artifact, slides, themeInput, deliveryDeck = null) {
  const palette = presentationTheme(themeInput || "paper");
  if (!palette) throw new Error("Presentation theme 无效。");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Aieyra Workspace";
  pptx.subject = "Lineage-backed presentation";
  pptx.title = cleanOneLine(slides[0]?.title || "Presentation", 200);
  pptx.company = "Aieyra";
  pptx.lang = "zh-CN";
  pptx.theme = {
    headFontFace: "Microsoft YaHei",
    bodyFontFace: "Microsoft YaHei",
    lang: "zh-CN"
  };
  const renderedSlides = deliveryDeck?.structureVersion === DELIVERY_DECK_STRUCTURE_VERSION
    ? deliveryDeckRenderedSlides(deliveryDeck)
    : paginatePresentationSlides(slides, (descriptor) => {
    const authoritativeChart = descriptor.chartArtifactId ? chartForPresentationSlide(projectRoot, artifact, descriptor.chartArtifactId) : null;
    if (authoritativeChart && JSON.stringify(authoritativeChart) !== JSON.stringify(descriptor.chart)) throw new Error("Presentation stored chart 快照与 provenance revision 不一致。");
    return authoritativeChart ? descriptor.chart : (descriptor.chart || null);
    }, (descriptor) => tableForPresentationSlide(projectRoot, artifact, descriptor));
  for (const descriptor of renderedSlides) {
    const fixedText = presentationFixedText(descriptor);
    const slide = pptx.addSlide();
    slide.background = { color: palette.background };
    slide.addText(fixedText.title, {
      ...PRESENTATION_LAYOUT.title, objectName: "ii-title", fontFace: "Microsoft YaHei",
      fontSize: 26, bold: true, color: palette.title, margin: 0
    });
    const bullets = descriptor.bullets.map((item) => ({ text: item, options: { bullet: { indent: 16 }, hanging: 4, breakLine: true } }));
    if (bullets.length) {
      slide.addText(bullets, {
        ...presentationTextRect(descriptor.layout),
        objectName: "ii-bullets", fontFace: "Microsoft YaHei", fontSize: descriptor.chart ? 17 : 18,
        color: palette.body, breakLine: false, valign: "top", margin: 0.08, paraSpaceAfterPt: 5
      });
    }
    if (descriptor.table) {
      slide.addText(fixedText.tableCaption, {
        ...PRESENTATION_LAYOUT.tableCaption, objectName: "ii-table-caption", fontFace: "Microsoft YaHei",
        fontSize: 12, bold: true, color: palette.body, margin: 0
      });
      const tableRows = [
        descriptor.table.columns.map((column) => ({ text: column.label, options: { bold: true, align: column.align, color: palette.title, fill: palette.background } })),
        ...descriptor.table.rows.map((row) => row.cells.map((cell, index) => ({ text: cell, options: { align: descriptor.table.columns[index].align } })))
      ];
      slide.addTable(tableRows, {
        ...descriptor.tableRect, objectName: "ii-table", autoPage: false,
        colW: descriptor.table.columns.map(() => PRESENTATION_LAYOUT.table.w / descriptor.table.columns.length),
        rowH: descriptor.tableRowHeights, fontFace: "Microsoft YaHei", fontSize: 10.5,
        color: palette.body, fill: palette.background, valign: "mid", margin: 0.05,
        border: { type: "solid", color: palette.foot, pt: 0.75 }
      });
    }
    if (descriptor.chart?.categories?.length) {
      const spec = presentationChartSpec(pptx, descriptor.chart);
      const chartFormat = validatePresentationChartFormat(descriptor.chartFormat || defaultPresentationChartFormat);
      const chartColors = presentationChartColors(chartFormat, palette);
      slide.addChart(spec.chartType, spec.data, {
        ...presentationChartRect(descriptor.layout),
        objectName: "ii-chart", altText: descriptor.chart.accessibleDescription,
        showLegend: chartFormat.legend !== "none",
        ...(chartFormat.legend === "bottom" ? { legendPos: "b" } : chartFormat.legend === "right" ? { legendPos: "r" } : {}),
        showValue: chartFormat.dataLabels === "value",
        catAxisHidden: !["both", "category"].includes(chartFormat.axes),
        valAxisHidden: !["both", "value"].includes(chartFormat.axes),
        showTitle: false, valAxisMinVal: Math.min(0, ...descriptor.chart.values),
        chartColors,
        ...(descriptor.chart.chartType === "bar" ? { barDir: "col" } : {}),
        ...(descriptor.chart.chartType === "scatter" ? { lineSize: 0 } : { catAxisLabelRotate: -35 })
      });
      descriptor.chartXValues = spec.xValues;
      descriptor.chartFormat = chartFormat;
      descriptor.chartColors = chartColors;
    }
    if (descriptor.speakerNotes) slide.addNotes(descriptor.speakerNotes);
    slide.addText(PRESENTATION_FOOTER_TEXT, {
      ...PRESENTATION_LAYOUT.footer, objectName: "ii-footer", fontSize: 9, color: palette.foot, margin: 0
    });
    if (fixedText.citation) slide.addText(fixedText.citation, {
      ...PRESENTATION_LAYOUT.citation, objectName: "ii-citation", fontSize: 7.5, color: palette.foot, margin: 0, align: "right"
    });
  }
  return { bytes: generatedExportBuffer(await pptx.write({ outputType: "nodebuffer" }), "pptx"), renderedSlides };
}

async function verifyXlsx(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  for (const required of ["[Content_Types].xml", "xl/workbook.xml", "xl/_rels/workbook.xml.rels"]) {
    if (!zip.file(required)) throw new Error(`XLSX 缺少 ${required}。`);
  }
  if (!Object.keys(zip.files).some((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))) {
    throw new Error("XLSX 缺少真实工作表。" );
  }
}

async function verifyScenarioWorkbookXlsx(bytes, artifact, content) {
  await verifyXlsx(bytes);
  const zip = await JSZip.loadAsync(bytes);
  const fileNames = Object.keys(zip.files);
  if (fileNames.some((name) => /(^|\/)(vbaProject\.bin|externalLinks)(\/|$)/i.test(name))) throw new Error("Scenario XLSX 不得包含宏或外部链接部件。" );
  for (const name of fileNames.filter((candidate) => /^xl\/.*\.xml$/i.test(candidate))) {
    const xml = await zip.file(name)?.async("string");
    if (xml && /<f(?:\s|>)/i.test(xml)) throw new Error(`Scenario XLSX 不得包含公式：${name}`);
  }
  for (const name of fileNames.filter((candidate) => /^xl\/.*\.rels$/i.test(candidate))) {
    const rels = await zip.file(name)?.async("string");
    if (rels && /TargetMode=["']External["']/i.test(rels)) throw new Error(`Scenario XLSX 不得包含外部 relationship：${name}`);
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const expected = scenarioWorkbookXlsxSheets(artifact, content);
  if (JSON.stringify(workbook.worksheets.map((sheet) => sheet.name)) !== JSON.stringify(expected.map((sheet) => sheet.name))) {
    throw new Error("Scenario XLSX 工作表名称或顺序不一致。" );
  }
  let cellCount = 0;
  for (const [sheetIndex, definition] of expected.entries()) {
    const sheet = workbook.worksheets[sheetIndex];
    if (sheet.actualRowCount !== definition.rows.length || sheet.actualColumnCount !== definition.rows[0].length) {
      throw new Error(`Scenario XLSX ${definition.name} 行列数不一致。`);
    }
    for (const [rowIndex, expectedRow] of definition.rows.entries()) {
      for (const [columnIndex, expectedValue] of expectedRow.entries()) {
        const value = sheet.getCell(rowIndex + 1, columnIndex + 1).value;
        if (value && typeof value === "object") throw new Error(`Scenario XLSX ${definition.name}!${rowIndex + 1},${columnIndex + 1} 包含非标量单元格。`);
        if (value !== expectedValue) throw new Error(`Scenario XLSX ${definition.name}!${rowIndex + 1},${columnIndex + 1} 与 canonical 内容不一致。`);
        cellCount += 1;
      }
    }
  }
  return {
    workbookKind: "finance-scenario-workbook-v1",
    sheets: expected.map((sheet) => ({ name: sheet.name, rows: sheet.rows.length, columns: sheet.rows[0].length })),
    sheetCount: expected.length,
    cellCount,
    formulas: 0,
    macros: 0,
    externalLinks: 0,
    semanticReadback: true
  };
}

async function verifyPng(bytes) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.byteLength < signature.byteLength || !bytes.subarray(0, signature.byteLength).equals(signature)) {
    throw new Error("PNG 生成结果缺少有效签名。" );
  }
  const metadata = await sharp(bytes).metadata();
  if (metadata.format !== "png" || !Number.isSafeInteger(metadata.width) || metadata.width < 1 || !Number.isSafeInteger(metadata.height) || metadata.height < 1) {
    throw new Error("PNG 生成结果回读身份无效。" );
  }
}

function decodeXmlText(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (match, encoded) => {
      const point = Number.parseInt(encoded, 16);
      return Number.isInteger(point) && point >= 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : match;
    })
    .replace(/&#([0-9]+);/g, (match, encoded) => {
      const point = Number.parseInt(encoded, 10);
      return Number.isInteger(point) && point >= 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : match;
    })
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function xmlAttribute(element, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(element || "").match(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"));
  return decodeXmlText(match?.[2] || "");
}

function packagePartTarget(sourcePart, target, targetMode = "") {
  if (!target || targetMode) return "";
  const normalizedTarget = String(target).replace(/\\/g, "/");
  const resolved = path.posix.normalize(normalizedTarget.startsWith("/")
    ? normalizedTarget.slice(1)
    : path.posix.join(path.posix.dirname(sourcePart), normalizedTarget));
  return resolved.startsWith("ppt/") && !resolved.includes("../../..") ? resolved : "";
}

function packageRelationships(xml, sourcePart) {
  return (String(xml || "").match(/<Relationship\b[^>]*\/?\s*>/gi) || []).map((element) => {
    const id = xmlAttribute(element, "Id");
    const type = xmlAttribute(element, "Type");
    const target = xmlAttribute(element, "Target");
    const targetMode = xmlAttribute(element, "TargetMode");
    return { id, type, target, targetMode, partPath: packagePartTarget(sourcePart, target, targetMode) };
  });
}

function xmlTextRuns(xml) {
  return [...String(xml || "").matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/gi)].map((match) => decodeXmlText(match[1]));
}

function normalizePresentationText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function xmlRunsContainText(runs, expected) {
  const normalizedExpected = normalizePresentationText(expected);
  if (!normalizedExpected) return true;
  const spaced = normalizePresentationText(runs.join(" "));
  const compact = normalizePresentationText(runs.join(""));
  return spaced.includes(normalizedExpected) || compact.includes(normalizedExpected) ||
    compact.replace(/\s+/g, "").includes(normalizedExpected.replace(/\s+/g, ""));
}

function namedShapeGeometry(slideXml) {
  const byName = new Map();
  for (const match of String(slideXml || "").matchAll(/<p:(sp|graphicFrame)\b[\s\S]*?<\/p:\1>/gi)) {
    const block = match[0];
    const nonVisual = block.match(/<p:cNvPr\b[^>]*\/?\s*>/i)?.[0] || "";
    const name = xmlAttribute(nonVisual, "name");
    if (!name) continue;
    const transform = block.match(/<(?:a|p):xfrm\b[^>]*>[\s\S]*?<a:off\b[^>]*\/?\s*>[\s\S]*?<a:ext\b[^>]*\/?\s*>[\s\S]*?<\/(?:a|p):xfrm>/i)?.[0] || "";
    const off = transform.match(/<a:off\b[^>]*\/?\s*>/i)?.[0] || "";
    const ext = transform.match(/<a:ext\b[^>]*\/?\s*>/i)?.[0] || "";
    const numbers = [xmlAttribute(off, "x"), xmlAttribute(off, "y"), xmlAttribute(ext, "cx"), xmlAttribute(ext, "cy")].map(Number);
    if (numbers.every((value) => Number.isSafeInteger(value) && value >= 0)) {
      const [x, y, w, h] = numbers.map((value) => value / 914400);
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push({ name, x, y, w, h, kind: match[1] });
    }
  }
  return byName;
}

function rectanglesOverlap(left, right, epsilon = 0.001) {
  return left.x < right.x + right.w - epsilon && left.x + left.w > right.x + epsilon &&
    left.y < right.y + right.h - epsilon && left.y + left.h > right.y + epsilon;
}

function verifyPresentationGeometry(slideXml, expected, slideIndex) {
  const shapes = namedShapeGeometry(slideXml);
  const expectedRects = new Map([
    ["ii-title", PRESENTATION_LAYOUT.title],
    ["ii-footer", PRESENTATION_LAYOUT.footer],
    ...(expected.citation ? [["ii-citation", PRESENTATION_LAYOUT.citation]] : []),
    ...(expected.bullets.length ? [["ii-bullets", presentationTextRect(expected.layout)]] : []),
    ...(expected.chart ? [["ii-chart", presentationChartRect(expected.layout)]] : []),
    ...(expected.table ? [["ii-table-caption", PRESENTATION_LAYOUT.tableCaption], ["ii-table", expected.tableRect]] : [])
  ]);
  const verified = [];
  for (const [name, expectedRect] of expectedRects) {
    const matches = shapes.get(name) || [];
    if (matches.length !== 1) throw new Error(`PPTX 第 ${slideIndex + 1} 页 ${name} shape 数量不一致。`);
    const actual = matches[0];
    for (const key of ["x", "y", "w", "h"]) {
      if (Math.abs(actual[key] - expectedRect[key]) > 0.002) throw new Error(`PPTX 第 ${slideIndex + 1} 页 ${name}.${key} 几何回读不一致。`);
    }
    if (actual.x < 0 || actual.y < 0 || actual.x + actual.w > PRESENTATION_LAYOUT.slide.w + 0.002 || actual.y + actual.h > PRESENTATION_LAYOUT.slide.h + 0.002) {
      throw new Error(`PPTX 第 ${slideIndex + 1} 页 ${name} 越出页面边界。`);
    }
    verified.push(actual);
  }
  for (let left = 0; left < verified.length; left += 1) for (let right = left + 1; right < verified.length; right += 1) {
    if (rectanglesOverlap(verified[left], verified[right])) throw new Error(`PPTX 第 ${slideIndex + 1} 页 ${verified[left].name} 与 ${verified[right].name} 发生重叠。`);
  }
  return verified;
}

function presentationTableContentEvidence(table) {
  return {
    caption: normalizePresentationText(table.caption),
    columns: table.columns.map((column) => ({ id: column.id, label: normalizePresentationText(column.label), align: column.align })),
    rows: table.rows.map((row) => ({ id: row.id, cells: row.cells.map(normalizePresentationText) }))
  };
}

function verifyPresentationTable(slideXml, expected, slideIndex) {
  const tables = [...String(slideXml || "").matchAll(/<a:tbl\b[\s\S]*?<\/a:tbl>/gi)].map((match) => match[0]);
  if (!expected.table) {
    if (tables.length) throw new Error(`PPTX 第 ${slideIndex + 1} 页出现未授权 table。`);
    return null;
  }
  if (tables.length !== 1) throw new Error(`PPTX 第 ${slideIndex + 1} 页原生 table 数量不一致。`);
  const tableXml = tables[0];
  const gridColumns = [...tableXml.matchAll(/<a:gridCol\b[^>]*\/?\s*>/gi)];
  if (gridColumns.length !== expected.table.columns.length) throw new Error(`PPTX 第 ${slideIndex + 1} 页 table 列数回读不一致。`);
  const rows = [...tableXml.matchAll(/<a:tr\b[\s\S]*?<\/a:tr>/gi)].map((match) => match[0]);
  if (rows.length !== expected.table.rows.length + 1) throw new Error(`PPTX 第 ${slideIndex + 1} 页 table 行数回读不一致。`);
  const matrix = rows.map((rowXml, rowIndex) => {
    const cells = [...rowXml.matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/gi)].map((match) => normalizePresentationText(xmlTextRuns(match[0]).join("")));
    if (cells.length !== expected.table.columns.length) throw new Error(`PPTX 第 ${slideIndex + 1} 页 table 第 ${rowIndex + 1} 行宽度不一致。`);
    return cells;
  });
  const expectedMatrix = [
    expected.table.columns.map((column) => normalizePresentationText(column.label)),
    ...expected.table.rows.map((row) => row.cells.map(normalizePresentationText))
  ];
  if (JSON.stringify(matrix) !== JSON.stringify(expectedMatrix)) throw new Error(`PPTX 第 ${slideIndex + 1} 页 table 单元格文本回读不一致。`);
  const content = presentationTableContentEvidence(expected.table);
  return {
    reportArtifactId: expected.table.reportArtifactId,
    reportRevision: expected.table.reportRevision,
    reportSha256: expected.table.reportSha256,
    tableBlockId: expected.table.tableBlockId,
    columnCount: expected.table.columns.length,
    rowCount: expected.table.rows.length,
    contentSha256: sha256Bytes(Buffer.from(JSON.stringify(content), "utf8"))
  };
}

function chartPointValues(chartXml, tag, numeric) {
  const section = String(chartXml || "").match(new RegExp(`<c:${tag}\\b[\\s\\S]*?<\\/c:${tag}>`, "i"))?.[0] || "";
  return [...section.matchAll(/<c:pt\b[^>]*\bidx\s*=\s*(["'])(\d+)\1[^>]*>[\s\S]*?<c:v>([\s\S]*?)<\/c:v>[\s\S]*?<\/c:pt>/gi)]
    .map((match) => ({ index: Number(match[2]), value: numeric ? Number(decodeXmlText(match[3])) : decodeXmlText(match[3]) }))
    .sort((left, right) => left.index - right.index)
    .map((point) => point.value);
}

function chartTypeFromXml(chartXml) {
  return ["bar", "line", "area", "scatter"].find((type) => new RegExp(`<c:${type}Chart\\b`, "i").test(chartXml)) || "";
}

function excelCellValue(cell) {
  const value = cell?.value;
  if (value && typeof value === "object" && Object.hasOwn(value, "result")) return value.result;
  if (value && typeof value === "object" && Array.isArray(value.richText)) return value.richText.map((item) => item.text || "").join("");
  return value;
}

function assertPresentationSeries(expected, actual, label) {
  if (expected.length !== actual.length) throw new Error(`${label} 点数不一致。`);
  for (let index = 0; index < expected.length; index += 1) {
    if (typeof expected[index] === "number") {
      if (!Number.isFinite(actual[index]) || Math.abs(expected[index] - actual[index]) > 1e-9) throw new Error(`${label} 第 ${index + 1} 点不一致。`);
    } else if (String(expected[index]) !== String(actual[index])) throw new Error(`${label} 第 ${index + 1} 点不一致。`);
  }
}

function presentationChartFormatEvidence(chartXml, expected, chartType, slideIndex) {
  const format = validatePresentationChartFormat(expected.chartFormat || defaultPresentationChartFormat, `PPTX 第 ${slideIndex + 1} 页 chartFormat`);
  const legend = String(chartXml).match(/<c:legend\b[\s\S]*?<\/c:legend>/i)?.[0] || "";
  const expectedLegendPosition = format.legend === "bottom" ? "b" : format.legend === "right" ? "r" : "";
  if (!expectedLegendPosition && legend) throw new Error(`PPTX 第 ${slideIndex + 1} 页 legend 应隐藏。`);
  if (expectedLegendPosition) {
    const actualPosition = xmlAttribute(legend.match(/<c:legendPos\b[^>]*\/?\s*>/i)?.[0] || "", "val");
    if (!legend || actualPosition !== expectedLegendPosition) throw new Error(`PPTX 第 ${slideIndex + 1} 页 legend 位置回读不一致。`);
  }
  const labels = String(chartXml).match(/<c:dLbls\b[\s\S]*?<\/c:dLbls>/i)?.[0] || "";
  const showValue = xmlAttribute(labels.match(/<c:showVal\b[^>]*\/?\s*>/i)?.[0] || "", "val") === "1";
  if (showValue !== (format.dataLabels === "value")) throw new Error(`PPTX 第 ${slideIndex + 1} 页 data labels 回读不一致。`);

  const axes = [...String(chartXml).matchAll(/<c:(catAx|dateAx|valAx)\b[\s\S]*?<\/c:\1>/gi)].map((match) => {
    const block = match[0];
    return {
      type: match[1],
      position: xmlAttribute(block.match(/<c:axPos\b[^>]*\/?\s*>/i)?.[0] || "", "val"),
      hidden: xmlAttribute(block.match(/<c:delete\b[^>]*\/?\s*>/i)?.[0] || "", "val") === "1"
    };
  });
  const categoryAxis = chartType === "scatter"
    ? axes.find((axis) => axis.type === "valAx" && ["b", "t"].includes(axis.position))
    : axes.find((axis) => axis.type === "catAx" || axis.type === "dateAx");
  const valueAxis = chartType === "scatter"
    ? axes.find((axis) => axis.type === "valAx" && ["l", "r"].includes(axis.position))
    : axes.find((axis) => axis.type === "valAx");
  const expectedCategoryHidden = !["both", "category"].includes(format.axes);
  const expectedValueHidden = !["both", "value"].includes(format.axes);
  if (!categoryAxis || categoryAxis.hidden !== expectedCategoryHidden || !valueAxis || valueAxis.hidden !== expectedValueHidden) {
    throw new Error(`PPTX 第 ${slideIndex + 1} 页 axes 回读不一致。`);
  }

  const firstSeries = String(chartXml).match(/<c:ser\b[\s\S]*?<\/c:ser>/i)?.[0] || "";
  const paletteColor = xmlAttribute(firstSeries.match(/<a:srgbClr\b[^>]*\/?\s*>/i)?.[0] || "", "val").toUpperCase();
  const expectedPaletteColor = String(expected.chartColors?.[0] || "").toUpperCase();
  if (!expectedPaletteColor || paletteColor !== expectedPaletteColor) throw new Error(`PPTX 第 ${slideIndex + 1} 页 palette 回读不一致。`);
  return {
    legend: format.legend,
    dataLabels: format.dataLabels,
    axes: format.axes,
    palette: format.palette,
    placement: format.placement,
    paletteColor
  };
}

async function verifyPresentationChart(zip, slidePath, slideXml, relationships, expected, slideIndex) {
  const chartReferences = [...slideXml.matchAll(/<c:chart\b[^>]*\br:id\s*=\s*(["'])(.*?)\1[^>]*\/?\s*>/gi)].map((match) => decodeXmlText(match[2]));
  if (!expected.chart) {
    if (chartReferences.length) throw new Error(`PPTX 第 ${slideIndex + 1} 页出现未授权 chart。`);
    return null;
  }
  if (chartReferences.length !== 1) throw new Error(`PPTX 第 ${slideIndex + 1} 页 chart 引用数量不一致。`);
  const relationship = relationships.find((item) => item.id === chartReferences[0]);
  if (!relationship || !/\/chart$/i.test(relationship.type) || !relationship.partPath || !zip.file(relationship.partPath)) throw new Error(`PPTX 第 ${slideIndex + 1} 页 chart relationship 目标无效。`);
  const chartXml = await zip.file(relationship.partPath).async("string");
  const chartType = chartTypeFromXml(chartXml);
  if (chartType !== expected.chart.chartType) throw new Error(`PPTX 第 ${slideIndex + 1} 页 chartType 回读不一致：期望 ${expected.chart.chartType}，实际 ${chartType || "missing"}。`);
  const categories = chartType === "scatter" ? chartPointValues(chartXml, "xVal", true) : chartPointValues(chartXml, "cat", false);
  const values = chartType === "scatter" ? chartPointValues(chartXml, "yVal", true) : chartPointValues(chartXml, "val", true);
  const expectedCategories = chartType === "scatter" ? expected.chartXValues : expected.chart.categories;
  assertPresentationSeries(expectedCategories, categories, `PPTX 第 ${slideIndex + 1} 页 chart categories`);
  assertPresentationSeries(expected.chart.values, values, `PPTX 第 ${slideIndex + 1} 页 chart values`);
  const chartFormat = presentationChartFormatEvidence(chartXml, expected, chartType, slideIndex);
  const chartRelsPath = `${path.posix.dirname(relationship.partPath)}/_rels/${path.posix.basename(relationship.partPath)}.rels`;
  const chartRelsFile = zip.file(chartRelsPath);
  if (!chartRelsFile) throw new Error(`PPTX 第 ${slideIndex + 1} 页 chart 缺少 relationships。`);
  const chartRelationships = packageRelationships(await chartRelsFile.async("string"), relationship.partPath);
  const workbookRelationship = chartRelationships.find((item) => /\/package$/i.test(item.type) && item.partPath && /\.xlsx$/i.test(item.partPath));
  const workbookFile = workbookRelationship?.partPath ? zip.file(workbookRelationship.partPath) : null;
  if (!workbookRelationship || !workbookFile) throw new Error(`PPTX 第 ${slideIndex + 1} 页 chart 缺少精确 embedded workbook。`);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await workbookFile.async("nodebuffer"));
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error(`PPTX 第 ${slideIndex + 1} 页 embedded workbook 没有工作表。`);
  const workbookCategories = [];
  const workbookValues = [];
  for (let row = 2; row <= expectedCategories.length + 1; row += 1) {
    workbookCategories.push(excelCellValue(worksheet.getCell(row, 1)));
    workbookValues.push(excelCellValue(worksheet.getCell(row, 2)));
  }
  assertPresentationSeries(expectedCategories, workbookCategories, `PPTX 第 ${slideIndex + 1} 页 workbook categories`);
  assertPresentationSeries(expected.chart.values, workbookValues, `PPTX 第 ${slideIndex + 1} 页 workbook values`);
  const normalized = { chartType, categories, values };
  return {
    chartPath: relationship.partPath,
    workbookPath: workbookRelationship.partPath,
    chartType,
    chartFormat,
    pointCount: values.length,
    seriesSha256: sha256Bytes(Buffer.from(JSON.stringify(normalized), "utf8"))
  };
}

async function verifyPptx(source, expectedSlides, expectedTheme = undefined) {
  const bytes = Buffer.isBuffer(source) || source instanceof ArrayBuffer || ArrayBuffer.isView(source)
    ? generatedExportBuffer(source, "pptx")
    : readFileSync(source);
  const zip = await JSZip.loadAsync(bytes);
  const slideFiles = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  if (!Array.isArray(expectedSlides) || slideFiles.length !== expectedSlides.length) throw new Error(`PPTX 回读页数不一致：期望 ${Array.isArray(expectedSlides) ? expectedSlides.length : "无效"}，实际 ${slideFiles.length}。`);
  const presentation = zip.file("ppt/presentation.xml");
  if (!presentation) throw new Error("PPTX 缺少 presentation.xml。" );
  const presentationXml = await presentation.async("string");
  const presentationRels = zip.file("ppt/_rels/presentation.xml.rels");
  if (!/p:sldId/.test(presentationXml) || !presentationRels) throw new Error("PPTX 没有真实页面关系。" );
  const relXml = await presentationRels.async("string");
  const relationships = packageRelationships(relXml, "ppt/presentation.xml");
  const targets = new Map(relationships.filter((item) => /\/slide$/i.test(item.type)).map((item) => [item.id, item.partPath]));
  const orderedIds = [...presentationXml.matchAll(/<p:sldId\b[^>]*\br:id\s*=\s*(["'])(.*?)\1/gi)].map((match) => decodeXmlText(match[2]));
  if (orderedIds.length !== expectedSlides.length) throw new Error("PPTX 页面关系顺序不完整。");
  const themeFile = zip.file("ppt/theme/theme1.xml");
  const themeXml = themeFile ? await themeFile.async("string") : "";
  if (!themeXml || !/<a:theme\b/i.test(themeXml)) throw new Error("PPTX 缺少真实 theme1.xml。" );
  const chartEvidence = [];
  const tableEvidence = [];
  const geometryEvidence = [];
  for (const [index, expected] of expectedSlides.entries()) {
    const slidePath = targets.get(orderedIds[index]) || "";
    if (!slidePath || !zip.file(slidePath)) throw new Error(`PPTX 第 ${index + 1} 页关系缺失。`);
    const slideXml = await zip.file(slidePath).async("string");
    if (expectedTheme && !slideXml.includes(presentationTheme(expectedTheme)?.background || "")) throw new Error(`PPTX 第 ${index + 1} 页 theme 背景色回读不一致。`);
    const textRuns = xmlTextRuns(slideXml);
    for (const text of [expected.title, ...(expected.bullets || []), ...(expected.table ? [expected.table.caption] : []), ...(expected.citation ? [deliveryCitationText(expected.citation)] : []), PRESENTATION_FOOTER_TEXT]) if (!xmlRunsContainText(textRuns, text)) throw new Error(`PPTX 第 ${index + 1} 页文本回读不一致。`);
    geometryEvidence.push(verifyPresentationGeometry(slideXml, expected, index));
    const table = verifyPresentationTable(slideXml, expected, index);
    if (table) tableEvidence.push({ slideIndex: index, slidePath, continuationIndex: expected.continuationIndex, sourceSlideId: expected.sourceSlideId, ...table });
    const slideRelsPath = `${path.posix.dirname(slidePath)}/_rels/${path.posix.basename(slidePath)}.rels`;
    const slideRels = zip.file(slideRelsPath);
    const slideRelXml = slideRels ? await slideRels.async("string") : "";
    const slideRelationships = packageRelationships(slideRelXml, slidePath);
    const chart = await verifyPresentationChart(zip, slidePath, slideXml, slideRelationships, expected, index);
    if (chart) chartEvidence.push({ slideIndex: index, slidePath, ...chart });
    if (expected.speakerNotes) {
      const notesRelationship = slideRelationships.find((item) => /\/notesSlide$/i.test(item.type));
      const notes = notesRelationship?.partPath ? zip.file(notesRelationship.partPath) : null;
      const notesRuns = notes ? xmlTextRuns(await notes.async("string")) : [];
      if (!notes || !xmlRunsContainText(notesRuns, expected.speakerNotes)) throw new Error(`PPTX 第 ${index + 1} 页 notes 文本回读不一致。`);
    }
  }
  return {
    slideCount: slideFiles.length,
    relationshipVerified: true,
    contentVerified: true,
    layoutVerified: true,
    chartVerified: chartEvidence.length === expectedSlides.filter((slide) => slide.chart).length,
    tableVerified: tableEvidence.length === expectedSlides.filter((slide) => slide.table).length,
    embeddedWorkbookVerified: chartEvidence.every((chart) => Boolean(chart.workbookPath)),
    chartTypes: chartEvidence.map((chart) => chart.chartType),
    chartFormats: chartEvidence.map((chart) => chart.chartFormat),
    chartEvidence,
    tableEvidence,
    deliveryPages: expectedSlides.flatMap((slide, slideIndex) => slide.citation ? [{
      slideIndex,
      sourceSlideId: slide.sourceSlideId,
      continuationIndex: slide.continuationIndex,
      citation: slide.citation
    }] : []),
    geometryShapeCount: geometryEvidence.reduce((count, shapes) => count + shapes.length, 0),
    themePartVerified: true,
    ...(expectedTheme ? { themeVerified: true } : {})
  };
}

function safeExportTarget(targetPath, format) {
  const rawTarget = String(targetPath || "");
  const absolute = path.resolve(rawTarget);
  if (!rawTarget || path.extname(absolute).toLowerCase() !== `.${format}`) throw new Error(`导出目标必须使用 .${format} 扩展名。`);
  const parent = path.dirname(absolute);
  if (!existsSync(parent)) throw new Error("导出目标父目录必须预先存在。" );
  const parentInfo = lstatSync(parent);
  if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) throw new Error("导出目标父目录必须是真实目录，不能是链接或其他实体。" );
  const realParent = path.resolve(realpathSync(parent));
  if (path.relative(parent, realParent) !== "" || path.relative(realParent, parent) !== "") throw new Error("导出目标父目录解析身份发生偏移，已拒绝写入。" );
  const existed = existsSync(absolute);
  let targetInfo = null;
  let targetIdentity = null;
  if (existed) {
    targetInfo = lstatSync(absolute);
    if (!targetInfo.isFile() || targetInfo.isSymbolicLink() || targetInfo.nlink > 1) throw new Error("已存在的导出目标必须是普通、非链接且非多硬链接文件。" );
    targetIdentity = lstatSync(absolute, { bigint: true });
  }
  return { path: absolute, parent, realParent, existed, targetInfo, targetIdentity };
}

function assertExportParentIdentity(targetState) {
  const info = lstatSync(targetState.parent);
  const currentRealParent = path.resolve(realpathSync(targetState.parent));
  if (
    !info.isDirectory() || info.isSymbolicLink() ||
    currentRealParent !== targetState.realParent ||
    path.relative(targetState.parent, currentRealParent) !== "" || path.relative(currentRealParent, targetState.parent) !== ""
  ) throw new Error("导出目标父目录身份在发布前发生偏移，已拒绝写入。" );
}

function assertExportTargetIdentity(targetState) {
  if (!targetState.existed) return;
  if (!existsSync(targetState.path)) throw new Error("既有导出目标在发布前消失，已拒绝替换。" );
  const current = lstatSync(targetState.path);
  const currentIdentity = lstatSync(targetState.path, { bigint: true });
  const initial = targetState.targetInfo;
  const unstableIdentityChanged = !hasStableFileIdentity(targetState.targetIdentity) && !hasStableFileIdentity(currentIdentity) && (
    current.size !== initial.size || current.birthtimeMs !== initial.birthtimeMs || current.ctimeMs !== initial.ctimeMs
  );
  if (
    !current.isFile() || current.isSymbolicLink() || current.nlink !== 1 ||
    fileIdentityConflicts(targetState.targetIdentity, currentIdentity) || unstableIdentityChanged
  ) throw new Error("既有导出目标身份在发布前发生变化，已拒绝替换。" );
}

function deliveryDeckExportSources(project, artifact, runtimeOptions) {
  if (!Array.isArray(runtimeOptions?.sourceArtifacts)) throw new Error("Delivery Deck 导出缺少当前项目的权威 source descriptors。" );
  const required = new Set(artifact.sourceArtifactIds);
  const byId = new Map();
  for (const candidate of runtimeOptions.sourceArtifacts) {
    const source = sanitizeDescriptor(candidate, project.kind, project.id);
    if (!required.has(source.id)) continue;
    if (byId.has(source.id)) throw new Error(`Delivery Deck 导出 source descriptor 重复：${source.id}`);
    const content = readArtifactContent(project.path, source);
    byId.set(source.id, { ...source, payload: artifactContentForRenderer(content, source.kind, source.projectKind, source.finance) });
  }
  const sources = artifact.sourceArtifactIds.map((sourceId) => byId.get(sourceId));
  if (sources.some((source) => !source)) throw new Error("Delivery Deck 导出 provenance 来源缺失。" );
  return sources;
}

async function exportLineageArtifact(projectInput, descriptor, targetPath, formatInput, runtimeOptions = undefined) {
  const project = validateProject(projectInput);
  const artifact = sanitizeDescriptor(descriptor, project.kind, project.id);
  if (!artifact) throw new Error("导出 artifact 无效。" );
  if (artifact.status !== "ready") {
    throw lineageFailure("LINEAGE_ARTIFACT_NOT_READY", `artifact 当前为 ${artifact.status || "unknown"}，请先重算后再导出：${artifact.title || artifact.id}`);
  }
  const content = readArtifactContent(project.path, artifact, runtimeOptions?.sourceArtifacts);
  if (artifact.kind === "presentation" && content.structureVersion === DELIVERY_DECK_STRUCTURE_VERSION) {
    const sources = deliveryDeckExportSources(project, artifact, runtimeOptions);
    validateStructureReferences("presentation", content, sources, artifact.provenance.inputs);
  }
  const format = cleanOneLine(formatInput, 20).toLowerCase();
  const allowed = artifact.kind === "scenario-workbook"
    ? new Set(["xlsx", "md", "html"])
    : content.table ? new Set(["csv", "json", "xlsx"]) : content.chart ? new Set(["svg", "png"]) : content.slides ? new Set(["pptx"]) : typeof content.markdown === "string" ? new Set(["md", "html"]) : new Set(["json"]);
  if (!allowed.has(format)) throw new Error(`${artifact.kind} 不支持导出 ${format}。` );
  const targetState = safeExportTarget(targetPath, format);
  const target = targetState.path;
  const beforePublish = runtimeOptions?.beforePublish;
  const requireTargetAbsent = runtimeOptions?.requireTargetAbsent === true;
  const testOnlyOptions = process.env.AIEYRA_LINEAGE_RUNTIME_SELFTEST === "1" && runtimeOptions?.testOnly && typeof runtimeOptions.testOnly === "object"
    ? runtimeOptions.testOnly
    : null;
  if (beforePublish !== undefined && typeof beforePublish !== "function") throw new Error("Lineage 导出 checkpoint 必须是函数。" );
  if (testOnlyOptions?.exclusiveCheckpoint !== undefined && typeof testOnlyOptions.exclusiveCheckpoint !== "function") throw new Error("Lineage fallback checkpoint 必须是函数。" );
  if (testOnlyOptions?.exclusiveFaultStage !== undefined && !["write", "fsync", "close"].includes(testOnlyOptions.exclusiveFaultStage)) throw new Error("Lineage fallback fault stage 无效。" );
  if (testOnlyOptions?.unlinkCheckpoint !== undefined && typeof testOnlyOptions.unlinkCheckpoint !== "function") throw new Error("Lineage cleanup checkpoint 必须是函数。" );
  if (testOnlyOptions?.renameCheckpoint !== undefined && typeof testOnlyOptions.renameCheckpoint !== "function") throw new Error("Lineage rename checkpoint 必须是函数。" );
  if (testOnlyOptions?.linkFaultCode !== undefined && !/^[A-Z0-9_-]{1,40}$/.test(String(testOnlyOptions.linkFaultCode))) throw new Error("Lineage link fault code 无效。" );
  if (requireTargetAbsent && targetState.existed) throw targetAlreadyExistsFailure();
  let verification = null;
  let bytes = null;
  if (format === "csv") bytes = Buffer.from(`\uFEFF${tableCsv(content.table)}`, "utf8");
  else if (format === "json") bytes = Buffer.from(`${JSON.stringify(content.table?.rows || content, null, 2)}\n`, "utf8");
  else if (format === "xlsx") {
    if (artifact.kind === "scenario-workbook") {
      bytes = await writeScenarioWorkbookXlsx(artifact, content);
      verification = await verifyScenarioWorkbookXlsx(bytes, artifact, content);
    } else {
      bytes = await writeXlsx(content.table);
      await verifyXlsx(bytes);
    }
  } else if (format === "svg") bytes = Buffer.from(chartSvg(content.chart), "utf8");
  else if (format === "png") {
    bytes = generatedExportBuffer(await sharp(Buffer.from(chartSvg(content.chart), "utf8")).png({ compressionLevel: 9 }).toBuffer(), "png");
    await verifyPng(bytes);
  } else if (format === "md") bytes = Buffer.from(content.markdown, "utf8");
  else if (format === "html") bytes = Buffer.from(content.html || reportHtml(content.markdown, artifact.title), "utf8");
  else if (format === "pptx") {
    const presentation = await writePresentation(project.path, artifact, content.slides, content.theme || "paper", content.structureVersion === DELIVERY_DECK_STRUCTURE_VERSION ? content : null);
    bytes = presentation.bytes;
    verification = await verifyPptx(bytes, presentation.renderedSlides, content.theme || "paper");
  }
  bytes = generatedExportBuffer(bytes, format);
  assertExportParentIdentity(targetState);
  assertExportTargetIdentity(targetState);
  const writeResult = atomicWrite(target, bytes, path.dirname(target), {
    requireTargetAbsent: requireTargetAbsent || !targetState.existed,
    returnPublicationResult: true,
    beforePublish: beforePublish ? () => {
      assertExportParentIdentity(targetState);
      assertExportTargetIdentity(targetState);
      const result = beforePublish(Object.freeze({
        artifactId: artifact.id,
        byteLength: bytes.byteLength,
        format,
        initialTargetExisted: targetState.existed,
        requireTargetAbsent,
        targetPath: target
      }));
      assertExportParentIdentity(targetState);
      assertExportTargetIdentity(targetState);
      return result;
    } : () => {
      assertExportParentIdentity(targetState);
      assertExportTargetIdentity(targetState);
    },
    forceExclusiveFallback: testOnlyOptions?.forceExclusiveFallback === true,
    exclusiveCheckpoint: testOnlyOptions?.exclusiveCheckpoint,
    exclusiveFaultStage: testOnlyOptions?.exclusiveFaultStage,
    linkFaultCode: testOnlyOptions?.linkFaultCode,
    renameCheckpoint: testOnlyOptions?.renameCheckpoint,
    unlinkCheckpoint: testOnlyOptions?.unlinkCheckpoint
  });
  const publication = writeResult.publication;
  const expectedFinalNlink = Number(publication?.expectedFinalNlink || 1);
  const managedHardlinkResidue = Boolean(
    expectedFinalNlink === 2 &&
    publication?.method === "hardlink-no-overwrite-atomic" &&
    publication?.cleanupPending === true &&
    publication.cleanupRecords?.some((record) => record?.purpose === "published-staging" && record?.status === "residue")
  );
  if (expectedFinalNlink < 1 || expectedFinalNlink > 2 || (expectedFinalNlink === 2 && !managedHardlinkResidue)) {
    throw lineageFailure("LINEAGE_EXPORT_RESTORE_REQUIRED", "导出发布后的链接身份不符合受控状态。" );
  }
  const info = lstatSync(target);
  const identityBeforeRead = lstatSync(target, { bigint: true });
  const parentAfterWrite = path.dirname(target);
  const parentAfterInfo = lstatSync(parentAfterWrite);
  const realParentAfterWrite = path.resolve(realpathSync(parentAfterWrite));
  if (
    !info.isFile() || info.isSymbolicLink() || info.nlink !== expectedFinalNlink || info.size !== bytes.byteLength ||
    fileIdentityConflicts(identityBeforeRead, publication?.finalIdentity) ||
    !parentAfterInfo.isDirectory() || parentAfterInfo.isSymbolicLink() ||
    path.relative(parentAfterWrite, realParentAfterWrite) !== "" || path.relative(realParentAfterWrite, parentAfterWrite) !== ""
  ) throw new Error("导出文件回读身份失败。" );
  const publishedSha256 = sha256File(target);
  const infoAfterRead = lstatSync(target);
  const identityAfterRead = lstatSync(target, { bigint: true });
  if (
    !infoAfterRead.isFile() || infoAfterRead.isSymbolicLink() || infoAfterRead.nlink !== expectedFinalNlink ||
    infoAfterRead.size !== bytes.byteLength || fileIdentityConflicts(identityBeforeRead, identityAfterRead) ||
    publishedSha256 !== sha256Bytes(bytes)
  ) throw new Error("导出文件内容回读校验失败。" );
  return {
    artifactId: artifact.id,
    revision: artifact.revision,
    format,
    path: target,
    sha256: publishedSha256,
    byteLength: infoAfterRead.size,
    publication: {
      method: publication.method,
      visibility: publication.visibility,
      cleanupPending: publication.cleanupPending === true,
      cleanupRetried: publication.cleanupRetried === true,
      cleanupRecords: Array.isArray(publication.cleanupRecords) ? publication.cleanupRecords : []
    },
    ...(verification ? { verification } : {})
  };
}

function removeLineageManagedData(projectRoot) {
  const root = lineageRoot(projectRoot);
  if (!existsSync(root)) return [];
  assertInside(root, projectRoot, "Lineage 清理目标");
  const info = lstatSync(root);
  if (info.isSymbolicLink()) throw new Error("Lineage 目录是符号链接，已拒绝清理。" );
  rmSync(root, { recursive: true, force: true });
  return [normalizedRelative(path.relative(projectRoot, root))];
}

module.exports = {
  LINEAGE_FORMAT_VERSION,
  LINEAGE_REVISION,
  LINEAGE_MUTATION_JOURNAL_FORMAT,
  LINEAGE_MUTATION_JOURNAL_VERSION,
  MAX_SOURCE_BYTES,
  MAX_TABLE_CELLS,
  PREVIEW_MAX_ROWS,
  PREVIEW_MAX_CELLS,
  PREVIEW_MAX_BYTES,
  PREVIEW_CELL_CHARS,
  TABLE_WINDOW_MAX_ROWS,
  TABLE_WINDOW_MAX_COLUMNS,
  TABLE_WINDOW_MAX_BYTES,
  TABLE_WINDOW_MAX_COLUMN_KEY_CHARS,
  TABLE_WINDOW_MAX_REQUEST_BYTES,
  dataArtifactKinds,
  financeArtifactKinds,
  emptyLineageSession,
  sanitizeLineageSession,
  hydrateLineageSession,
  dehydrateLineageSession,
  lineageSessionHasContent,
  importLineageArtifact,
  refreshLineageDataRootArtifact,
  planLineageDataStaleRecovery,
  createLineageArtifact,
  editLineageArtifactStructure,
  lineageSessionWithArtifact,
  readLineageArtifact,
  readLineageTableWindow,
  exportLineageArtifact,
  readArtifactContent,
  normalizeFinanceContext,
  normalizeOperationOptions,
  validateLineageStoredContent,
  canonicalScenarioWorkbookContentFromSources,
  createLineageTablePreview,
  createLineageTableWindow,
  lineageJournalSnapshotFromDescriptor,
  lineageJournalSourceHistoryFromDescriptor,
  readLineageMutationJournal,
  writeLineageMutationJournal,
  clearLineageMutationJournal,
  recoverLineageMutationJournal,
  removeLineageManagedData,
  runLineageWorker,
  chartSvg,
  verifyPptx
};
