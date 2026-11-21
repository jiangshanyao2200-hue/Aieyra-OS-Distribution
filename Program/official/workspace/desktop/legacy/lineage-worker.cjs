"use strict";

const path = require("node:path");
const { readFileSync } = require("node:fs");
const { isMainThread, parentPort, workerData } = require("node:worker_threads");
const { createInflateRaw } = require("node:zlib");
const ExcelJS = require("exceljs");

const MAX_ROWS = 100000;
const MAX_COLUMNS = 256;
const MAX_TABLE_CELLS = 2000000;
const MAX_GENERATED_CELLS = 2000000;
const MAX_CELL_CHARS = 32768;
const MAX_XLSX_UNCOMPRESSED_BYTES = 128 * 1024 * 1024;
const MAX_XLSX_ARCHIVE_ENTRIES = 4096;
const FINANCE_CONTEXT_IDENTITY_KEYS = Object.freeze(["asOf", "sourceName", "sourceUrl", "currency", "unit", "timezone"]);
const FINANCE_SCENARIO_COMPARABLE_KEYS = Object.freeze(["asOf", "currency", "unit", "timezone"]);
const FINANCE_METRIC_SCALE_BY_UNIT = Object.freeze({
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
const CONTROLLED_FINANCE_METRIC_SCALES = new Set(Object.values(FINANCE_METRIC_SCALE_BY_UNIT));
const FINANCE_SCENARIO_METRIC_POLICIES = Object.freeze({
  marketCap: Object.freeze({ direction: "higher-is-upside", scenarioRule: "relative-linear" }),
  marketValue: Object.freeze({ direction: "higher-is-upside", scenarioRule: "relative-linear" })
});
const FINANCE_SCENARIO_LIMITATIONS = Object.freeze([
  "V1 不执行汇率、单位、时区或估值口径转换；不一致来源会被拒绝。",
  "V1 不接入实时行情、网页抓取、券商账户或交易执行。",
  "乐观与压力情景是明确假设，不是预测、目标价、收益承诺或买卖建议。"
]);
const FINANCE_SCENARIO_FIXED_RISKS = Object.freeze([
  "情景仅按受控百分比线性调整共同指标，未建模相关性、流动性或尾部事件。",
  "来源可能延迟或不完整，任何结论都必须结合原始 artifact 复核。"
]);

function abortError(message = "数据任务已取消。") {
  return Object.assign(new Error(message), { code: "ABORT_ERR" });
}

function cleanText(value, maximum = MAX_CELL_CHARS) {
  return String(value ?? "").replace(/\u0000/g, "").slice(0, maximum);
}

function finiteDataNumber(value) {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizedCell(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "result")) return normalizedCell(value.result);
    if (Array.isArray(value.richText)) return cleanText(value.richText.map((item) => item?.text || "").join(""));
    if (typeof value.text === "string") return cleanText(value.text);
    if (typeof value.hyperlink === "string") return cleanText(value.text || value.hyperlink);
    return cleanText(JSON.stringify(value));
  }
  return cleanText(value);
}

function uniqueColumnKey(label, index, used) {
  const normalized = cleanText(label || `列 ${index + 1}`, 160)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, "_")
    .replace(/^_+|_+$/g, "") || `column_${index + 1}`;
  let key = normalized;
  let suffix = 2;
  while (used.has(key)) key = `${normalized}_${suffix++}`;
  used.add(key);
  return key;
}

function tableFromMatrix(matrix, sheetName = "Sheet1", allSheetNames = [sheetName], sourceTruncated = false) {
  const sourceRows = Array.isArray(matrix) ? matrix : [];
  const headerSource = Array.isArray(sourceRows[0]) ? sourceRows[0].slice(0, MAX_COLUMNS) : [];
  const width = Math.min(
    MAX_COLUMNS,
    Math.max(headerSource.length, ...sourceRows.slice(1, 2000).map((row) => Array.isArray(row) ? row.length : 0), 0)
  );
  const used = new Set();
  const labels = Array.from({ length: width }, (_, index) => cleanText(headerSource[index] || `列 ${index + 1}`, 160).trim() || `列 ${index + 1}`);
  const keys = labels.map((label, index) => uniqueColumnKey(label, index, used));
  const rowLimit = Math.min(MAX_ROWS, Math.max(1, Math.floor(MAX_TABLE_CELLS / Math.max(1, width))));
  const rows = sourceRows.slice(1, rowLimit + 1).map((source) => {
    const row = {};
    for (let index = 0; index < width; index += 1) row[keys[index]] = normalizedCell(Array.isArray(source) ? source[index] : null);
    return row;
  });
  return profileTable({
    sheetName: cleanText(sheetName || "Sheet1", 160),
    sheetNames: [...new Set((allSheetNames || [sheetName]).map((name) => cleanText(name || "Sheet1", 160)))],
    columnLabels: Object.fromEntries(keys.map((key, index) => [key, labels[index]])),
    rows,
    truncated: sourceTruncated || sourceRows.length - 1 > rowLimit || headerSource.length > MAX_COLUMNS
  });
}

function cellType(value) {
  if (value === null || value === "") return "empty";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/.test(value) && !Number.isNaN(Date.parse(value))) return "date";
  return "string";
}

function profileTable(table) {
  const rows = Array.isArray(table.rows) ? table.rows.slice(0, MAX_ROWS) : [];
  const keys = Object.keys(table.columnLabels || {}).slice(0, MAX_COLUMNS);
  if (rows.length * keys.length > MAX_TABLE_CELLS) {
    throw new Error(`表格超过安全上限 ${MAX_TABLE_CELLS} 个单元格，请先筛选、选列或聚合。`);
  }
  const columns = keys.map((key) => {
    const values = rows.map((row) => row?.[key] ?? null);
    const types = new Set(values.map(cellType).filter((type) => type !== "empty"));
    const missingCount = values.filter((value) => value === null || value === "").length;
    return {
      key,
      label: cleanText(table.columnLabels?.[key] || key, 160),
      type: types.size === 0 ? "empty" : types.size === 1 ? [...types][0] : "mixed",
      nullable: missingCount > 0,
      missingCount,
      distinctCount: new Set(values.filter((value) => value !== null).map((value) => JSON.stringify(value))).size
    };
  });
  const warnings = [];
  if (table.truncated) warnings.push(`数据超过安全预算，仅保留最多 ${MAX_ROWS} 行、${MAX_COLUMNS} 列和 ${MAX_TABLE_CELLS} 个单元格。`);
  return {
    sheetName: cleanText(table.sheetName || "Sheet1", 160),
    sheetNames: Array.isArray(table.sheetNames) && table.sheetNames.length ? table.sheetNames.slice(0, 128) : [cleanText(table.sheetName || "Sheet1", 160)],
    columns,
    rows,
    totalRows: rows.length,
    totalColumns: columns.length,
    warnings
  };
}

function parseDelimited(text, delimiter) {
  const matrix = [];
  let row = [];
  let field = "";
  let quoted = false;
  let cells = 0;
  let truncated = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        if (field.length < MAX_CELL_CHARS) field += '"';
        else truncated = true;
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        if (field.length < MAX_CELL_CHARS) field += char;
        else truncated = true;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === delimiter) {
      if (row.length < MAX_COLUMNS) row.push(field);
      else truncated = true;
      field = "";
    } else if (char === "\n") {
      if (row.length < MAX_COLUMNS) row.push(field.replace(/\r$/, ""));
      else truncated = true;
      matrix.push(row);
      cells += row.length;
      row = [];
      field = "";
      if (matrix.length > MAX_ROWS || (matrix.length > 1 && cells > MAX_TABLE_CELLS + MAX_COLUMNS)) {
        truncated = index < text.length - 1;
        break;
      }
    } else {
      if (field.length < MAX_CELL_CHARS) field += char;
      else truncated = true;
    }
  }
  if (field || row.length) {
    if (row.length < MAX_COLUMNS) row.push(field.replace(/\r$/, ""));
    else truncated = true;
    matrix.push(row);
  }
  return { matrix, truncated };
}

function matrixFromObjects(items) {
  const rows = Array.isArray(items) ? items.slice(0, MAX_ROWS) : [];
  const headers = [];
  const known = new Set();
  for (const item of rows.slice(0, 5000)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    for (const key of Object.keys(item)) {
      if (!known.has(key) && headers.length < MAX_COLUMNS) {
        known.add(key);
        headers.push(key);
      }
    }
  }
  const rowLimit = Math.min(rows.length, Math.max(1, Math.floor(MAX_TABLE_CELLS / Math.max(1, headers.length))));
  return {
    matrix: [headers, ...rows.slice(0, rowLimit).map((item) => headers.map((key) => item && typeof item === "object" ? item[key] : null))],
    truncated: Array.isArray(items) && items.length > rowLimit
  };
}

async function inflatedZipEntryByteLength(compressed, limit) {
  const inflater = createInflateRaw();
  inflater.end(compressed);
  let total = 0;
  try {
    for await (const chunk of inflater) {
      total += chunk.length;
      if (total > limit) throw new Error(`XLSX 解压内容超过安全上限 ${MAX_XLSX_UNCOMPRESSED_BYTES / 1024 / 1024} MB。`);
    }
  } finally {
    if (!inflater.destroyed) inflater.destroy();
  }
  return total;
}

async function assertSafeXlsxArchive(filePath) {
  const bytes = readFileSync(filePath);
  const minimumOffset = Math.max(0, bytes.length - 65557);
  let endOffset = -1;
  for (let offset = bytes.length - 22; offset >= minimumOffset; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50 && offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length) { endOffset = offset; break; }
  }
  if (endOffset < 0) throw new Error("XLSX ZIP 目录无效或缺失。");
  const disk = bytes.readUInt16LE(endOffset + 4);
  const centralDisk = bytes.readUInt16LE(endOffset + 6);
  const diskEntries = bytes.readUInt16LE(endOffset + 8);
  const entryCount = bytes.readUInt16LE(endOffset + 10);
  const centralSize = bytes.readUInt32LE(endOffset + 12);
  const centralOffset = bytes.readUInt32LE(endOffset + 16);
  const commentLength = bytes.readUInt16LE(endOffset + 20);
  if (disk || centralDisk || diskEntries !== entryCount) throw new Error("XLSX 不支持分卷 ZIP。");
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw new Error("XLSX ZIP64 超出安全导入边界。");
  if (entryCount < 1 || entryCount > MAX_XLSX_ARCHIVE_ENTRIES) throw new Error(`XLSX ZIP 条目超过安全上限 ${MAX_XLSX_ARCHIVE_ENTRIES}。`);
  if (endOffset + 22 + commentLength !== bytes.length || centralOffset + centralSize > endOffset) throw new Error("XLSX ZIP 中央目录边界无效。");
  const centralEnd = centralOffset + centralSize;
  let cursor = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > centralEnd || bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error("XLSX ZIP 中央目录条目无效。");
    const flags = bytes.readUInt16LE(cursor + 8);
    const compression = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const entryCommentLength = bytes.readUInt16LE(cursor + 32);
    const entryDisk = bytes.readUInt16LE(cursor + 34);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    if (flags & 1) throw new Error("XLSX 不支持加密 ZIP 条目。");
    if (![0, 8].includes(compression)) throw new Error(`XLSX ZIP 使用不支持的压缩方式 ${compression}。`);
    if (entryDisk || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) throw new Error("XLSX ZIP64 或分卷条目超出安全导入边界。");
    if (!compressedSize && uncompressedSize) throw new Error("XLSX ZIP 条目压缩尺寸无效。");
    if (totalUncompressed + uncompressedSize > MAX_XLSX_UNCOMPRESSED_BYTES) throw new Error(`XLSX 解压内容超过安全上限 ${MAX_XLSX_UNCOMPRESSED_BYTES / 1024 / 1024} MB。`);
    if (localOffset + 30 > centralOffset || bytes.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("XLSX ZIP 本地条目无效或越界。");
    const localFlags = bytes.readUInt16LE(localOffset + 6);
    const localCompression = bytes.readUInt16LE(localOffset + 8);
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    if ((localFlags & 1) || localCompression !== compression) throw new Error("XLSX ZIP 本地条目与中央目录不一致。");
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataOffset + compressedSize;
    if (dataOffset > centralOffset || dataEnd > centralOffset) throw new Error("XLSX ZIP 压缩数据越界。");
    let actualSize = compressedSize;
    if (compression === 8) actualSize = await inflatedZipEntryByteLength(bytes.subarray(dataOffset, dataEnd), MAX_XLSX_UNCOMPRESSED_BYTES - totalUncompressed);
    if (actualSize !== uncompressedSize) throw new Error("XLSX ZIP 条目声明尺寸与实际解压尺寸不一致。");
    totalUncompressed += actualSize;
    cursor += 46 + nameLength + extraLength + entryCommentLength;
    if (cursor > centralEnd) throw new Error("XLSX ZIP 中央目录条目越界。");
  }
  if (cursor !== centralEnd || centralEnd !== endOffset) throw new Error("XLSX ZIP 中央目录计数或尺寸不一致。");
  return { entryCount, totalUncompressed };
}

async function parseInputFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".csv" || extension === ".tsv") {
    const text = readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
    const parsed = parseDelimited(text, extension === ".tsv" ? "\t" : ",");
    return tableFromMatrix(parsed.matrix, path.basename(filePath), undefined, parsed.truncated);
  }
  if (extension === ".json") {
    const parsed = JSON.parse(readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
    if (Array.isArray(parsed)) {
      const converted = matrixFromObjects(parsed);
      return tableFromMatrix(converted.matrix, path.basename(filePath), undefined, converted.truncated);
    }
    if (!parsed || typeof parsed !== "object") throw new Error("JSON 必须是对象数组，或以 sheet 名称映射对象数组。");
    const sheetEntries = Object.entries(parsed).filter(([, value]) => Array.isArray(value));
    if (!sheetEntries.length) throw new Error("JSON 未包含可解析的对象数组。");
    const [sheetName, items] = sheetEntries[0];
    const converted = matrixFromObjects(items);
    return tableFromMatrix(converted.matrix, sheetName, sheetEntries.map(([name]) => name), converted.truncated);
  }
  if (extension === ".xlsx") {
    await assertSafeXlsxArchive(filePath);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const sheetNames = workbook.worksheets.map((sheet) => sheet.name);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) throw new Error("XLSX 不包含工作表。");
    const matrix = [];
    let cellCount = 0;
    let truncated = false;
    worksheet.eachRow({ includeEmpty: true }, (row) => {
      if (matrix.length > MAX_ROWS || cellCount > MAX_TABLE_CELLS + MAX_COLUMNS) {
        truncated = true;
        return;
      }
      const values = [];
      const width = Math.min(MAX_COLUMNS, Math.max(0, row.cellCount));
      for (let index = 1; index <= width; index += 1) values.push(normalizedCell(row.getCell(index).value));
      matrix.push(values);
      cellCount += width;
    });
    return tableFromMatrix(matrix, worksheet.name, sheetNames, truncated);
  }
  throw new Error(`不支持的数据格式：${extension || "unknown"}`);
}

function tableFromContent(content) {
  const table = content?.table;
  if (!table || !Array.isArray(table.rows) || !Array.isArray(table.columns)) throw new Error("来源 artifact 不是可计算表格。");
  return {
    ...table,
    columnLabels: Object.fromEntries(table.columns.map((column) => [column.key, column.label])),
    rows: table.rows.map((row) => ({ ...row }))
  };
}

function cleanedTable(source, options = {}) {
  const table = tableFromContent(source);
  const trimStrings = options.trimStrings !== false;
  const removeEmptyRows = options.removeEmptyRows !== false;
  const deduplicate = options.deduplicate !== false;
  const keys = table.columns.map((column) => column.key);
  const seen = new Set();
  let removedEmpty = 0;
  let removedDuplicates = 0;
  const rows = [];
  for (const input of table.rows) {
    const row = Object.fromEntries(keys.map((key) => {
      const value = input?.[key] ?? null;
      return [key, trimStrings && typeof value === "string" ? value.trim() || null : value];
    }));
    if (removeEmptyRows && keys.every((key) => row[key] === null || row[key] === "")) {
      removedEmpty += 1;
      continue;
    }
    const identity = JSON.stringify(row);
    if (deduplicate && seen.has(identity)) {
      removedDuplicates += 1;
      continue;
    }
    seen.add(identity);
    rows.push(row);
  }
  return {
    table: profileTable({ ...table, rows }),
    metrics: [
      { key: "inputRows", label: "输入行数", value: table.rows.length },
      { key: "outputRows", label: "输出行数", value: rows.length },
      { key: "removedEmpty", label: "移除空行", value: removedEmpty },
      { key: "removedDuplicates", label: "移除重复行", value: removedDuplicates }
    ],
    operation: "clean",
    warnings: []
  };
}

function compareValues(left, right) {
  if (left === right) return 0;
  if (left === null || left === undefined) return 1;
  if (right === null || right === undefined) return -1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right), "zh-CN", { numeric: true });
}

function limitedRows(rows, options = {}) {
  return rows.slice(0, requestedRowLimit(options));
}

function requestedRowLimit(options = {}) {
  return Math.min(MAX_ROWS, Math.max(1, Math.floor(Number(options.limit || MAX_ROWS))));
}

function basicTransformedTable(source, options = {}) {
  const table = tableFromContent(source);
  const existingKeys = new Set(table.columns.map((column) => column.key));
  const selectedKeys = (Array.isArray(options.columns) ? options.columns : [])
    .map(String)
    .filter((key) => existingKeys.has(key));
  const keys = selectedKeys.length ? selectedKeys : [...existingKeys];
  let rows = table.rows.map((row) => Object.fromEntries(keys.map((key) => [key, row?.[key] ?? null])));
  const filterColumn = String(options.filterColumn || "");
  const filterValue = options.filterValue;
  if (existingKeys.has(filterColumn) && filterValue !== undefined && filterValue !== null && filterValue !== "") {
    const needle = String(filterValue).toLocaleLowerCase("zh-CN");
    rows = rows.filter((row) => String(row[filterColumn] ?? "").toLocaleLowerCase("zh-CN").includes(needle));
  }
  const sortColumn = String(options.sortColumn || "");
  if (existingKeys.has(sortColumn)) {
    const direction = String(options.sortDirection || "asc") === "desc" ? -1 : 1;
    rows.sort((left, right) => compareValues(left[sortColumn], right[sortColumn]) * direction);
  }
  rows = limitedRows(rows, options);
  const columns = table.columns.filter((column) => keys.includes(column.key));
  return {
    table: profileTable({ ...table, columnLabels: Object.fromEntries(columns.map((column) => [column.key, column.label])), rows }),
    metrics: [
      { key: "inputRows", label: "输入行数", value: table.rows.length },
      { key: "outputRows", label: "输出行数", value: rows.length },
      { key: "outputColumns", label: "输出列数", value: columns.length },
      { key: "transformMode", label: "变换类型", value: "基础筛选 / 排序" }
    ],
    operation: "transform",
    warnings: []
  };
}

function requireColumns(table, keys, label) {
  const existing = new Set(table.columns.map((column) => column.key));
  const missing = [...new Set(keys)].filter((key) => key && !existing.has(key));
  if (missing.length) throw new Error(`${label} 引用了不存在的列：${missing.join(", ")}`);
}

function rounded(value, precision) {
  if (!Number.isFinite(value)) return null;
  if (!Number.isSafeInteger(precision)) return value;
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function computedValue(row, spec) {
  const left = row?.[spec.leftColumn] ?? null;
  const right = Object.prototype.hasOwnProperty.call(spec, "rightColumn") ? row?.[spec.rightColumn] ?? null : spec.rightValue;
  if (spec.operator === "concat") return cleanText(`${left ?? ""}${spec.separator ?? ""}${right ?? ""}`);
  const leftNumber = finiteDataNumber(left);
  const rightNumber = finiteDataNumber(right);
  if (leftNumber === null || rightNumber === null) return null;
  let result = null;
  if (spec.operator === "add") result = leftNumber + rightNumber;
  else if (spec.operator === "subtract") result = leftNumber - rightNumber;
  else if (spec.operator === "multiply") result = leftNumber * rightNumber;
  else if (spec.operator === "divide") result = rightNumber === 0 ? null : leftNumber / rightNumber;
  else if (spec.operator === "percent") result = rightNumber === 0 ? null : (leftNumber / rightNumber) * 100;
  return rounded(result, spec.precision);
}

function computedTable(source, options = {}) {
  const table = tableFromContent(source);
  const specs = Array.isArray(options.computedColumns) ? options.computedColumns : [];
  const sourceKeys = table.columns.map((column) => column.key);
  if (sourceKeys.length + specs.length > MAX_COLUMNS) throw new Error(`计算列结果超过安全上限 ${MAX_COLUMNS} 列，请先选择必要列。`);
  const inputRows = table.rows.slice(0, requestedRowLimit(options));
  if (inputRows.length * (sourceKeys.length + specs.length) > MAX_TABLE_CELLS) throw new Error(`计算列结果超过安全上限 ${MAX_TABLE_CELLS} 个单元格，请先设置更小 limit、筛选或选择必要列。`);
  const allKeys = new Set(sourceKeys);
  for (const spec of specs) {
    requireColumns({ columns: [...allKeys].map((key) => ({ key })) }, [spec.leftColumn, spec.rightColumn].filter(Boolean), "计算列");
    if (allKeys.has(spec.key)) throw new Error(`计算列输出 key 已存在：${spec.key}`);
    allKeys.add(spec.key);
  }
  let invalidNumericResults = 0;
  const rows = inputRows.map((input) => {
    const row = { ...input };
    for (const spec of specs) {
      const value = computedValue(row, spec);
      if (value === null && spec.operator !== "concat") invalidNumericResults += 1;
      row[spec.key] = value;
    }
    return row;
  });
  const columnLabels = {
    ...table.columnLabels,
    ...Object.fromEntries(specs.map((spec) => [spec.key, spec.label || spec.key]))
  };
  return {
    table: profileTable({ ...table, columnLabels, rows }),
    metrics: [
      { key: "inputRows", label: "输入行数", value: table.rows.length },
      { key: "outputRows", label: "输出行数", value: rows.length },
      { key: "computedColumns", label: "新增计算列", value: specs.length },
      { key: "transformMode", label: "变换类型", value: "计算列" }
    ],
    operation: "transform",
    warnings: invalidNumericResults ? [`${invalidNumericResults} 个计算结果因非数值或除数为零写为 NULL。`] : []
  };
}

function aggregateRows(rows, spec) {
  const values = spec.column ? rows.map((row) => row?.[spec.column] ?? null).filter((value) => value !== null && value !== "") : [];
  if (spec.operator === "count") return spec.column ? values.length : rows.length;
  if (spec.operator === "distinct-count") return new Set(values.map((value) => JSON.stringify(value))).size;
  if (spec.operator === "min" || spec.operator === "max") {
    if (!values.length) return null;
    return [...values].sort(compareValues)[spec.operator === "min" ? 0 : values.length - 1];
  }
  const numeric = values.map(finiteDataNumber).filter((value) => value !== null);
  if (!numeric.length) return null;
  const sum = numeric.reduce((total, value) => total + value, 0);
  if (spec.operator === "sum") return sum;
  if (spec.operator === "average") return sum / numeric.length;
  return null;
}

function sortedAndLimitedRows(rows, options = {}) {
  const sortColumn = String(options.sortColumn || "");
  if (sortColumn) {
    const direction = String(options.sortDirection || "asc") === "desc" ? -1 : 1;
    rows.sort((left, right) => compareValues(left?.[sortColumn], right?.[sortColumn]) * direction);
  }
  return limitedRows(rows, options);
}

function groupedTable(source, options = {}) {
  const table = tableFromContent(source);
  const groupBy = Array.isArray(options.groupBy) ? options.groupBy : [];
  const aggregations = Array.isArray(options.aggregations) ? options.aggregations : [];
  requireColumns(table, [...groupBy, ...aggregations.map((item) => item.column).filter(Boolean)], "分组聚合");
  const outputKeys = new Set(groupBy);
  for (const spec of aggregations) {
    if (outputKeys.has(spec.outputKey)) throw new Error(`分组聚合输出 key 冲突：${spec.outputKey}`);
    outputKeys.add(spec.outputKey);
  }
  if (options.sortColumn && !outputKeys.has(options.sortColumn)) throw new Error(`分组聚合排序引用了不存在的输出列：${options.sortColumn}`);
  const groups = new Map();
  for (const row of table.rows) {
    const identity = JSON.stringify(groupBy.map((key) => row?.[key] ?? null));
    if (!groups.has(identity)) groups.set(identity, []);
    groups.get(identity).push(row);
  }
  const outputColumnCount = outputKeys.size;
  const rowLimit = Math.min(groups.size, requestedRowLimit(options));
  const groupsToMaterialize = options.sortColumn ? groups.size : rowLimit;
  if (groupsToMaterialize * outputColumnCount > MAX_GENERATED_CELLS) throw new Error(`分组结果超过安全上限 ${MAX_GENERATED_CELLS} 个单元格，请设置更小 limit、取消排序或先筛选。`);
  const groupValues = [...groups.values()];
  let rows = (options.sortColumn ? groupValues : groupValues.slice(0, rowLimit)).map((items) => ({
    ...Object.fromEntries(groupBy.map((key) => [key, items[0]?.[key] ?? null])),
    ...Object.fromEntries(aggregations.map((spec) => [spec.outputKey, aggregateRows(items, spec)]))
  }));
  rows = sortedAndLimitedRows(rows, options);
  const columnLabels = {
    ...Object.fromEntries(groupBy.map((key) => [key, table.columnLabels?.[key] || key])),
    ...Object.fromEntries(aggregations.map((spec) => [spec.outputKey, spec.label || spec.outputKey]))
  };
  const sheetName = `${table.sheetName} · 分组`;
  return {
    table: profileTable({ sheetName, sheetNames: [...new Set([...(table.sheetNames || []), sheetName])], columnLabels, rows }),
    metrics: [
      { key: "inputRows", label: "输入行数", value: table.rows.length },
      { key: "groupCount", label: "分组数量", value: groups.size },
      { key: "aggregationCount", label: "聚合指标", value: aggregations.length },
      { key: "transformMode", label: "变换类型", value: "分组聚合" }
    ],
    operation: "transform",
    warnings: []
  };
}

function pivotedTable(source, options = {}) {
  const table = tableFromContent(source);
  const rowKeys = Array.isArray(options.rowKeys) ? options.rowKeys : [];
  requireColumns(table, [...rowKeys, options.pivotColumn, options.valueColumn], "透视表");
  const pivotIdentities = [];
  const pivotLabels = new Map();
  for (const row of table.rows) {
    const value = row?.[options.pivotColumn] ?? null;
    const identity = JSON.stringify(value);
    if (!pivotLabels.has(identity)) {
      pivotIdentities.push(identity);
      pivotLabels.set(identity, cleanText(value ?? "NULL", 160) || "NULL");
    }
  }
  if (pivotIdentities.length + rowKeys.length > MAX_COLUMNS) throw new Error(`透视列超过安全上限 ${MAX_COLUMNS}。`);
  const used = new Set(rowKeys);
  const pivotKeys = new Map(pivotIdentities.map((identity, index) => [identity, uniqueColumnKey(pivotLabels.get(identity), index, used)]));
  const groups = new Map();
  for (const row of table.rows) {
    const identity = JSON.stringify(rowKeys.map((key) => row?.[key] ?? null));
    if (!groups.has(identity)) groups.set(identity, { first: row, buckets: new Map() });
    const group = groups.get(identity);
    const pivotIdentity = JSON.stringify(row?.[options.pivotColumn] ?? null);
    if (!group.buckets.has(pivotIdentity)) group.buckets.set(pivotIdentity, []);
    group.buckets.get(pivotIdentity).push(row);
  }
  const aggregation = String(options.aggregation || "sum");
  const outputColumnCount = rowKeys.length + pivotIdentities.length;
  const rowLimit = Math.min(groups.size, Math.min(MAX_ROWS, Math.max(1, Math.floor(Number(options.limit || MAX_ROWS)))));
  if (rowLimit * outputColumnCount > MAX_GENERATED_CELLS) throw new Error(`透视结果超过安全上限 ${MAX_GENERATED_CELLS} 个单元格，请设置更小 limit 或先聚合。`);
  let rows = [...groups.values()].slice(0, rowLimit).map((group) => {
    const output = Object.fromEntries(rowKeys.map((key) => [key, group.first?.[key] ?? null]));
    for (const identity of pivotIdentities) {
      output[pivotKeys.get(identity)] = aggregateRows(group.buckets.get(identity) || [], {
        column: options.valueColumn,
        operator: aggregation
      });
    }
    return output;
  });
  rows = limitedRows(rows, options);
  const columnLabels = {
    ...Object.fromEntries(rowKeys.map((key) => [key, table.columnLabels?.[key] || key])),
    ...Object.fromEntries(pivotIdentities.map((identity) => [pivotKeys.get(identity), pivotLabels.get(identity)]))
  };
  const sheetName = `${table.sheetName} · 透视`;
  return {
    table: profileTable({ sheetName, sheetNames: [...new Set([...(table.sheetNames || []), sheetName])], columnLabels, rows }),
    metrics: [
      { key: "inputRows", label: "输入行数", value: table.rows.length },
      { key: "outputRows", label: "透视行数", value: rows.length },
      { key: "pivotColumns", label: "透视列数", value: pivotIdentities.length },
      { key: "transformMode", label: "变换类型", value: "透视表" }
    ],
    operation: "transform",
    warnings: []
  };
}

function joinIdentity(value) {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

function joinedTable(leftSource, rightSource, options = {}) {
  const left = tableFromContent(leftSource);
  const right = tableFromContent(rightSource);
  requireColumns(left, [options.leftKey], "连接左表");
  requireColumns(right, [options.rightKey], "连接右表");
  if (left.columns.length + right.columns.length > MAX_COLUMNS) throw new Error(`连接结果超过安全上限 ${MAX_COLUMNS} 列，请先选择必要列。`);
  const outputColumnCount = left.columns.length + right.columns.length;
  const requestedLimit = requestedRowLimit(options);
  const safeRowLimit = Math.min(MAX_ROWS, Math.floor(MAX_TABLE_CELLS / Math.max(1, outputColumnCount)));
  const leftKeys = left.columns.map((column) => column.key);
  const used = new Set(leftKeys);
  const prefix = cleanText(options.rightPrefix || "right", 80).replace(/[^\p{L}\p{N}_-]+/gu, "_") || "right";
  const rightKeyMap = new Map(right.columns.map((column, index) => [column.key, uniqueColumnKey(`${prefix}_${column.key}`, index, used)]));
  const rightIndex = new Map();
  right.rows.forEach((row, index) => {
    const identity = joinIdentity(row?.[options.rightKey]);
    if (identity === null) return;
    if (!rightIndex.has(identity)) rightIndex.set(identity, []);
    rightIndex.get(identity).push({ row, index });
  });
  const matchedRight = new Set();
  const rows = [];
  const append = (leftRow, rightRow) => {
    if (rows.length >= requestedLimit) return false;
    if (rows.length >= safeRowLimit) throw new Error(`连接结果超过安全上限 ${MAX_TABLE_CELLS} 个单元格，请设置更小 limit、筛选、选列或聚合。`);
    rows.push({
      ...Object.fromEntries(leftKeys.map((key) => [key, leftRow?.[key] ?? null])),
      ...Object.fromEntries(right.columns.map((column) => [rightKeyMap.get(column.key), rightRow?.[column.key] ?? null]))
    });
    return rows.length < requestedLimit;
  };
  let limitReached = false;
  leftLoop: for (const leftRow of left.rows) {
    const identity = joinIdentity(leftRow?.[options.leftKey]);
    const matches = identity === null ? [] : rightIndex.get(identity) || [];
    if (matches.length) {
      for (const match of matches) {
        matchedRight.add(match.index);
        if (!append(leftRow, match.row)) { limitReached = true; break leftLoop; }
      }
    } else if (["left", "full"].includes(options.joinType) && !append(leftRow, null)) { limitReached = true; break; }
  }
  if (!limitReached && ["right", "full"].includes(options.joinType)) {
    for (let index = 0; index < right.rows.length; index += 1) {
      if (!matchedRight.has(index) && !append(null, right.rows[index])) break;
    }
  }
  const columnLabels = {
    ...left.columnLabels,
    ...Object.fromEntries(right.columns.map((column) => [rightKeyMap.get(column.key), `${prefix} · ${column.label}`]))
  };
  const sheetName = `${left.sheetName} ⋈ ${right.sheetName}`;
  return {
    table: profileTable({ sheetName, sheetNames: [...new Set([...(left.sheetNames || []), ...(right.sheetNames || []), sheetName])], columnLabels, rows }),
    metrics: [
      { key: "leftRows", label: "左表行数", value: left.rows.length },
      { key: "rightRows", label: "右表行数", value: right.rows.length },
      { key: "outputRows", label: "连接结果", value: rows.length },
      { key: "transformMode", label: "变换类型", value: `${options.joinType} join` }
    ],
    operation: "transform",
    warnings: []
  };
}

function transformedTable(sources, options = {}) {
  const mode = String(options.mode || "basic");
  const primary = sources[0]?.content;
  if (mode === "basic") return basicTransformedTable(primary, options);
  if (mode === "compute") return computedTable(primary, options);
  if (mode === "group") return groupedTable(primary, options);
  if (mode === "pivot") return pivotedTable(primary, options);
  if (mode === "join") return joinedTable(primary, sources[1]?.content, options);
  throw new Error(`未知 transform mode：${mode}`);
}

function percentile(sorted, ratio) {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * ratio;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function analysisContent(source) {
  const table = tableFromContent(source);
  const metrics = [
    { key: "rowCount", label: "行数", value: table.rows.length },
    { key: "columnCount", label: "列数", value: table.columns.length }
  ];
  const columnProfiles = table.columns.map((column) => {
    const values = table.rows.map((row) => row?.[column.key] ?? null);
    const present = values.filter((value) => value !== null && value !== "");
    const numeric = present.filter((value) => typeof value === "number" && Number.isFinite(value));
    const profile = {
      key: column.key,
      label: column.label,
      type: column.type,
      count: values.length,
      missing: values.length - present.length,
      distinct: new Set(present.map((value) => JSON.stringify(value))).size
    };
    if (numeric.length) {
      const sorted = [...numeric].sort((a, b) => a - b);
      const sum = numeric.reduce((total, value) => total + value, 0);
      Object.assign(profile, {
        min: sorted[0],
        max: sorted[sorted.length - 1],
        mean: sum / numeric.length,
        median: percentile(sorted, 0.5),
        p25: percentile(sorted, 0.25),
        p75: percentile(sorted, 0.75)
      });
    }
    return profile;
  });
  for (const profile of columnProfiles.filter((column) => Object.prototype.hasOwnProperty.call(column, "mean")).slice(0, 24)) {
    metrics.push({ key: `${profile.key}.mean`, label: `${profile.label} 平均值`, value: Number(profile.mean.toFixed(6)) });
  }
  return { operation: "analysis", metrics, columnProfiles, warnings: [] };
}

function chartContent(source, options = {}) {
  const table = tableFromContent(source);
  const xColumn = String(options.xColumn || table.columns[0]?.key || "");
  const numericColumn = table.columns.find((column) => column.type === "number")?.key;
  const yColumn = String(options.yColumn || numericColumn || table.columns[1]?.key || "");
  if (!table.columns.some((column) => column.key === xColumn) || !table.columns.some((column) => column.key === yColumn)) {
    throw new Error("图表需要存在的 X/Y 列。");
  }
  const points = table.rows
    .map((row) => ({ category: cleanText(row?.[xColumn] ?? "", 120), value: finiteDataNumber(row?.[yColumn]) }))
    .filter((point) => point.category && point.value !== null)
    .slice(0, 80);
  if (!points.length) throw new Error("选择的列没有可绘制数值。");
  const chartType = ["bar", "line", "area", "scatter"].includes(String(options.chartType)) ? String(options.chartType) : "bar";
  const xLabel = table.columns.find((column) => column.key === xColumn)?.label || xColumn;
  const yLabel = table.columns.find((column) => column.key === yColumn)?.label || yColumn;
  const title = cleanText(options.title || `${yLabel} 按 ${xLabel}`, 240);
  return {
    operation: "chart",
    chart: {
      chartType,
      title,
      xColumn,
      yColumn,
      unit: cleanText(options.unit || "", 40),
      categories: points.map((point) => point.category),
      values: points.map((point) => point.value),
      accessibleDescription: `${title}，共 ${points.length} 个数据点；数值范围 ${Math.min(...points.map((point) => point.value))} 至 ${Math.max(...points.map((point) => point.value))}。`
    },
    warnings: table.rows.length > points.length ? [`图表只显示前 ${points.length} 个有效数据点。`] : []
  };
}

function markdownEscape(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/([`*_{}\[\]<>#+|])/g, "\\$1")
    .replace(/\r?\n/g, " ");
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
          const metric = metrics[index];
          lines.push(`| ${markdownEscape(metric.label)} | ${markdownEscape(metric.value)}${metric.unit ? ` ${markdownEscape(metric.unit)}` : ""} | ${markdownEscape(metric.note || "")} |`);
        });
        lines.push("");
      } else if (block.type === "sources") { block.inputArtifactIds.forEach((id) => lines.push(`- 来源 artifact：${markdownEscape(id)}`)); lines.push(""); }
      else if (block.type === "chart") { lines.push(`图表 artifact：${markdownEscape(block.chartArtifactId)}。`, ""); }
      else if (block.type === "table") {
        lines.push(`表：${markdownEscape(block.caption)}`, "");
        lines.push(`| ${block.columns.map((column) => markdownEscape(column.label)).join(" | ")} |`);
        lines.push(`| ${block.columns.map((column) => ({ left: ":---", center: ":---:", right: "---:" })[column.align]).join(" | ")} |`);
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

const dataDeliveryTemplates = new Set(["standard", "executive", "research"]);

function dataDeliveryTemplate(options = {}) {
  const template = options.template === undefined ? "standard" : String(options.template);
  if (!dataDeliveryTemplates.has(template)) throw new Error("template 只能是 standard、executive 或 research。");
  return template;
}

function reportTableBlock(sources, metrics) {
  const profiles = [];
  for (const source of sources) {
    if (!Array.isArray(source.content?.columnProfiles)) continue;
    for (const profile of source.content.columnProfiles) {
      profiles.push({ source, profile });
      if (profiles.length >= 24) break;
    }
    if (profiles.length >= 24) break;
  }
  if (profiles.length) {
    return {
      id: "data-profile-table",
      type: "table",
      caption: "字段与数据质量概览",
      columns: [
        { id: "profile-source", label: "来源", align: "left" },
        { id: "profile-field", label: "字段", align: "left" },
        { id: "profile-type", label: "类型", align: "center" },
        { id: "profile-count", label: "总数", align: "right" },
        { id: "profile-missing", label: "缺失数", align: "right" },
        { id: "profile-distinct", label: "唯一值", align: "right" }
      ],
      rows: profiles.map(({ source, profile }, index) => ({
        id: `data-profile-row-${index + 1}`,
        cells: [
          cleanText(source.title || source.kind || source.id, 240).replace(/\r?\n/g, " "),
          cleanText(profile.label || profile.key || `字段 ${index + 1}`, 240).replace(/\r?\n/g, " "),
          cleanText(profile.type || "unknown", 240).replace(/\r?\n/g, " "),
          cleanText(profile.count ?? "", 240).replace(/\r?\n/g, " "),
          cleanText(profile.missing ?? "", 240).replace(/\r?\n/g, " "),
          cleanText(profile.distinct ?? "", 240).replace(/\r?\n/g, " ")
        ]
      }))
    };
  }
  if (!metrics.length) return null;
  return {
    id: "metric-summary-table",
    type: "table",
    caption: "关键指标摘要",
    columns: [
      { id: "metric-label", label: "指标", align: "left" },
      { id: "metric-value", label: "数值", align: "right" },
      { id: "metric-unit", label: "单位", align: "left" },
      { id: "metric-note", label: "说明", align: "left" }
    ],
    rows: metrics.slice(0, 24).map((metric, index) => ({
      id: `metric-summary-row-${index + 1}`,
      cells: [metric.label, metric.value, metric.unit || "", metric.note || ""].map((value) => cleanText(value, 240).replace(/\r?\n/g, " "))
    }))
  };
}

function reportCalloutBlock(id, warnings, title = "复核提示") {
  const warningLines = warnings.slice(0, 8).map((warning) => cleanText(warning, 4000).trim()).filter(Boolean);
  const hasWarnings = warningLines.length > 0;
  const text = cleanText(
    hasWarnings ? warningLines.join("\n") : "本报告仅汇总当前受控 artifact；超出来源的数据与事实需要另行验证。",
    4000
  ).trim();
  return {
    id,
    type: "callout",
    tone: hasWarnings ? "warning" : "note",
    title: hasWarnings ? title : "使用边界",
    text
  };
}

function reportDocumentForTemplate(template, title, sources, metrics, warnings, chartBlocks) {
  const sourceBlock = { id: "sources", type: "sources", inputArtifactIds: sources.map((source) => source.id) };
  const allMetricIndexes = metrics.map((_, index) => index);
  const metricBlock = allMetricIndexes.length
    ? { id: "metrics", type: "metrics", metricIndexes: allMetricIndexes }
    : { id: "empty-results", type: "paragraph", text: "当前来源没有可汇总的确定性指标。" };
  const tableBlock = reportTableBlock(sources, metrics);
  const resultBlocks = tableBlock?.id === "data-profile-table"
    ? [...(metrics.length ? [metricBlock] : []), tableBlock]
    : tableBlock ? [tableBlock] : [metricBlock];
  if (template === "standard") {
    return {
      structureVersion: 2,
      title,
      sections: [
        { id: "scope", role: "scope", heading: "范围与来源", blocks: [sourceBlock] },
        { id: "findings", role: "findings", heading: "关键结果", blocks: [...resultBlocks, ...chartBlocks] },
        { id: "limitations", role: "limitations", heading: "限制与待确认", blocks: [reportCalloutBlock("warnings", warnings)] }
      ]
    };
  }
  if (template === "executive") {
    const executiveMetricBlock = metrics.length
      ? { id: "executive-metrics", type: "metrics", metricIndexes: allMetricIndexes.slice(0, 8) }
      : { id: "executive-empty", type: "paragraph", text: "当前来源没有可供决策汇总的确定性指标。" };
    const executiveResultBlocks = tableBlock?.id === "data-profile-table"
      ? [...(metrics.length ? [executiveMetricBlock] : []), tableBlock]
      : tableBlock ? [tableBlock] : [executiveMetricBlock];
    return {
      structureVersion: 2,
      title,
      sections: [
        { id: "executive-summary", role: "findings", heading: "管理摘要", blocks: [...executiveResultBlocks, ...chartBlocks] },
        { id: "executive-risks", role: "limitations", heading: "风险与下一步", blocks: [reportCalloutBlock("executive-warnings", warnings, "决策风险")] },
        { id: "executive-scope", role: "scope", heading: "数据口径与来源", blocks: [{ ...sourceBlock, id: "executive-sources" }] }
      ]
    };
  }
  const researchResultBlocks = tableBlock?.id === "data-profile-table"
    ? [...(metrics.length ? [{ ...metricBlock, id: "research-metrics" }] : []), tableBlock]
    : tableBlock ? [tableBlock] : [{ ...metricBlock, id: metrics.length ? "research-metrics" : "research-empty" }];
  return {
    structureVersion: 2,
    title,
    sections: [
      { id: "research-scope", role: "scope", heading: "研究范围与来源", blocks: [{ ...sourceBlock, id: "research-sources" }] },
      { id: "research-method", role: "custom", heading: "方法与口径", blocks: [{ id: "research-method-note", type: "paragraph", text: "本报告只对当前受控 artifact 中的确定性指标、图表与警告进行结构化汇总，并保留 revision 与 SHA 来源。" }] },
      { id: "research-evidence", role: "findings", heading: "结果与证据", blocks: [...researchResultBlocks, ...chartBlocks] },
      { id: "research-limitations", role: "limitations", heading: "限制与复核", blocks: [reportCalloutBlock("research-warnings", warnings, "研究限制")] }
    ]
  };
}

function reportContent(sources, options = {}, finance = null) {
  const title = cleanText(options.title || (finance ? "财经分析报告" : "数据分析报告"), 240);
  if (!finance) {
    const template = dataDeliveryTemplate(options);
    const metrics = sources.flatMap((source) => Array.isArray(source.content?.metrics) ? source.content.metrics : []).slice(0, 2048);
    const warnings = sources.flatMap((source) => Array.isArray(source.content?.warnings) ? source.content.warnings : []).slice(0, 2048);
    const chartBlocks = sources.filter((source) => source.content?.chart).slice(0, 24).map((source, index) => ({ id: `chart-${index + 1}`, type: "chart", chartArtifactId: source.id }));
    const document = reportDocumentForTemplate(template, title, sources, metrics, warnings, chartBlocks);
    return { operation: "report", document, markdown: reportMarkdownFromDocument(document, metrics, sources), metrics, warnings };
  }
  if (Object.hasOwn(options, "template")) throw new Error("Finance report 不支持 template。");
  const lines = [`# ${title}`, ""];
  if (finance) {
    lines.push(
      `- 截止时间：${finance.asOf}`,
      `- 来源：${finance.sourceName}${finance.sourceUrl ? `（${finance.sourceUrl}）` : ""}`,
      `- 币种 / 单位：${finance.currency} / ${finance.unit}`,
      `- 时区：${finance.timezone}`,
      ""
    );
  }
  lines.push("## 范围与来源", "");
  for (const source of sources) lines.push(`- ${markdownEscape(source.title || source.kind)} · revision ${source.revision || 1} · SHA ${String(source.sha256 || "").slice(0, 12)}`);
  lines.push("", "## 关键结果", "");
  const metrics = sources.flatMap((source) => Array.isArray(source.content?.metrics) ? source.content.metrics : []).slice(0, 2048);
  if (metrics.length) {
    lines.push("| 指标 | 数值 | 说明 |", "| --- | ---: | --- |");
    for (const metric of metrics.slice(0, 80)) lines.push(`| ${markdownEscape(metric.label)} | ${markdownEscape(metric.value)}${metric.unit ? ` ${markdownEscape(metric.unit)}` : ""} | ${markdownEscape(metric.note || "")} |`);
  } else {
    lines.push("当前来源没有可汇总的确定性指标。");
  }
  const warnings = sources.flatMap((source) => Array.isArray(source.content?.warnings) ? source.content.warnings : []).slice(0, 2048);
  lines.push("", "## 限制与待确认", "");
  if (warnings.length) warnings.slice(0, 40).forEach((warning) => lines.push(`- ${markdownEscape(warning)}`));
  else lines.push("- 本报告仅汇总当前受控 artifact；超出来源的数据与事实需要另行验证。");
  if (finance) lines.push("", `> ${finance.disclaimer}`);
  return {
    operation: finance ? "finance-report" : "report",
    markdown: lines.join("\n"),
    metrics,
    warnings,
    ...(finance ? { finance } : {})
  };
}

function presentationContent(sources, options = {}) {
  const report = sources.find((source) => source.kind === "report" && source.content?.document?.structureVersion === 2);
  if (!report) throw new Error("Canonical Report Delivery Deck 需要一个 ReportDocumentV2 report artifact。" );
  const template = dataDeliveryTemplate(options);
  const title = cleanText(options.title || report.title || "数据洞察", 240);
  const document = report.content.document;
  const blocks = document.sections.flatMap((section) => section.blocks.map((block) => ({ section, block })));
  const readableTypes = new Set(["paragraph", "bullets", "metrics", "callout", "sources"]);
  const blockSlide = (id, roles, fallbackTitle, speakerNotes) => {
    const matches = blocks.filter(({ section, block }) => roles.includes(section.role) && readableTypes.has(block.type));
    if (!matches.length) return null;
    return {
      id,
      type: "report-blocks",
      title: cleanText(matches[0].section.heading || fallbackTitle, 240),
      blockIds: matches.slice(0, 3).map(({ block }) => block.id),
      ...(speakerNotes ? { speakerNotes } : {})
    };
  };
  const provenanceSlide = (id, speakerNotes) => ({
    id,
    type: "provenance",
    title: "来源与可追溯性",
    ...(speakerNotes ? { speakerNotes } : {})
  });
  const authorizedChartIds = new Set(sources.filter((source) => source.kind === "chart" && source.content?.chart).map((source) => source.id));
  const reportChart = blocks.find(({ block }) => block.type === "chart" && authorizedChartIds.has(block.chartArtifactId));
  const chartSlide = reportChart ? {
    id: "report-chart",
    type: "chart",
    title: cleanText(reportChart.section.heading || "数据图表", 240),
    reportBlockId: reportChart.block.id,
    chartFormat: { legend: "none", dataLabels: "none", axes: "both", palette: "theme", placement: "auto" }
  } : null;
  const reportTable = blocks.find(({ block }) => block.type === "table");
  const tableSlide = reportTable ? {
    id: "report-table",
    type: "table",
    title: cleanText(reportTable.block.caption || "报告表格", 240),
    tableRef: {
      reportArtifactId: report.id,
      tableBlockId: reportTable.block.id,
      columnIds: reportTable.block.columns.slice(0, 6).map((column) => column.id),
      placement: "full"
    }
  } : null;
  const delivery = (slides) => ({
    operation: "presentation",
    structureVersion: 3,
    reportRef: { reportArtifactId: report.id },
    theme: template === "standard" ? "paper" : template === "executive" ? "midnight" : "slate",
    slides: slides.filter(Boolean).slice(0, 24),
    warnings: []
  });
  if (template === "standard") {
    return delivery([
      { id: "cover", type: "cover", title, subtitle: cleanText(options.subtitle || "基于可追溯数据 artifact 自动生成", 220) },
      blockSlide("summary", ["findings"], "关键结果"),
      chartSlide,
      tableSlide,
      blockSlide("limits", ["limitations"], "限制与下一步"),
      provenanceSlide("provenance")
    ]);
  }
  if (template === "executive") {
    return delivery([
      { id: "executive-cover", type: "cover", title, subtitle: cleanText(options.subtitle || "决策简报 · 基于可追溯数据 artifact", 220), speakerNotes: "本页用于确认决策主题、受众与数据口径。" },
      blockSlide("executive-summary", ["findings"], "管理摘要", "先陈述可验证指标，再讨论判断与行动。"),
      chartSlide ? { ...chartSlide, id: "executive-chart", speakerNotes: "图表来自受控 Report block，可回查原始 revision。" } : null,
      tableSlide ? { ...tableSlide, id: "executive-table", speakerNotes: "表格来自受控 Report revision，并以原生表格页交付。" } : null,
      blockSlide("executive-risks", ["limitations"], "风险与下一步", "逐项确认风险、责任人和下一步复核动作。"),
      provenanceSlide("executive-provenance", "结论只覆盖 canonical Report 及其 provenance 列出的受控来源。")
    ]);
  }
  return delivery([
    { id: "research-cover", type: "cover", title, subtitle: cleanText(options.subtitle || "研究型数据简报 · 方法、证据与局限", 220), speakerNotes: "说明研究问题、数据边界与本次简报的验证范围。" },
    blockSlide("research-method", ["scope", "custom"], "研究范围与方法", "所有方法描述均受 canonical Report 与 provenance 约束。"),
    blockSlide("research-evidence", ["findings"], "结果与证据", "区分直接指标、派生判断与尚待验证的假设。"),
    chartSlide ? { ...chartSlide, id: "research-chart", speakerNotes: "图表仅引用 Report 授权的 chart block，不替代原始表格与口径说明。" } : null,
    tableSlide ? { ...tableSlide, id: "research-table", speakerNotes: "表格内容绑定受控 Report revision，可回查字段与原始行。" } : null,
    blockSlide("research-limitations", ["limitations"], "限制与复核", "记录数据限制、异常值和下一轮复核要求。"),
    provenanceSlide("research-provenance", "使用 revision 与 SHA 回查 canonical Report 的受控来源。")
  ]);
}

function workerFinanceIdentity(value = {}) {
  return {
    asOf: cleanText(value.asOf || "", 64),
    sourceName: cleanText(value.sourceName || "", 200),
    sourceUrl: cleanText(value.sourceUrl || "", 500),
    currency: cleanText(value.currency || "", 24),
    unit: cleanText(value.unit || "", 40),
    timezone: cleanText(value.timezone || "", 80)
  };
}

function financeScaleForUnit(value) {
  const unit = cleanText(value || "", 40).toLowerCase();
  return Object.prototype.hasOwnProperty.call(FINANCE_METRIC_SCALE_BY_UNIT, unit) ? FINANCE_METRIC_SCALE_BY_UNIT[unit] : null;
}

function marketValueMetricSemantics(finance) {
  const scale = financeScaleForUnit(finance.unit);
  return scale === null ? null : { measure: "market-value", unit: finance.currency, scale };
}

function financeContext(options = {}, sources = []) {
  const sourceContexts = sources.map((source) => {
    const context = source?.finance || source?.content?.finance;
    if (!context || typeof context !== "object" || Array.isArray(context)) {
      throw new Error("Finance 来源缺少可验证的口径。" );
    }
    return workerFinanceIdentity(context);
  });
  const requested = workerFinanceIdentity(options);
  const inherited = sourceContexts[0] || requested;
  for (const context of sourceContexts.slice(1)) {
    const mismatches = FINANCE_CONTEXT_IDENTITY_KEYS.filter((key) => context[key] !== inherited[key]);
    if (mismatches.length) throw new Error(`Finance 多来源口径不一致：${mismatches.join(", ")}。`);
  }
  const overrides = FINANCE_CONTEXT_IDENTITY_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(options, key) && requested[key] !== inherited[key]);
  if (overrides.length) throw new Error(`Finance operation options 不得覆盖来源口径：${overrides.join(", ")}。`);
  const { asOf, sourceName, sourceUrl, currency, unit, timezone } = inherited;
  if (!asOf || !sourceName || !currency || !unit || !timezone) {
    throw new Error("Finance artifact 必须提供 as-of、来源、币种、单位与时区。" );
  }
  return {
    asOf,
    sourceName,
    ...(sourceUrl ? { sourceUrl } : {}),
    currency,
    unit,
    timezone,
    disclaimer: "仅供信息与研究，不构成投资建议；市场数据可能延迟或不完整。"
  };
}

function columnByAliases(table, aliases) {
  const normalized = aliases.map((alias) => String(alias).toLowerCase());
  return table.columns.find((column) => normalized.includes(String(column.key).toLowerCase()) || normalized.includes(String(column.label).toLowerCase()))?.key || "";
}

function lastFinite(table, key) {
  if (!key) return null;
  for (let index = table.rows.length - 1; index >= 0; index -= 1) {
    const value = finiteDataNumber(table.rows[index]?.[key]);
    if (value !== null) return value;
  }
  return null;
}

function valuationContent(source, options = {}) {
  const table = tableFromContent(source.content);
  const finance = financeContext(options, [source]);
  const revenueKey = String(options.revenueColumn || columnByAliases(table, ["revenue", "sales", "营业收入", "营收"]));
  const incomeKey = String(options.netIncomeColumn || columnByAliases(table, ["net_income", "netincome", "净利润", "归母净利润"]));
  const sharesKey = String(options.sharesColumn || columnByAliases(table, ["shares", "shares_outstanding", "股本", "总股本"]));
  const priceKey = String(options.priceColumn || columnByAliases(table, ["price", "close", "股价", "收盘价"]));
  const revenue = lastFinite(table, revenueKey);
  const netIncome = lastFinite(table, incomeKey);
  const shares = lastFinite(table, sharesKey);
  const price = lastFinite(table, priceKey);
  const metrics = [];
  const warnings = [];
  const marketValueSemantics = marketValueMetricSemantics(finance);
  if (revenue !== null) metrics.push({ key: "revenue", label: "营业收入", value: revenue, unit: finance.unit });
  if (netIncome !== null) metrics.push({ key: "netIncome", label: "净利润", value: netIncome, unit: finance.unit });
  if (revenue !== null && netIncome !== null && revenue !== 0) metrics.push({ key: "netMargin", label: "净利率", value: Number((netIncome / revenue * 100).toFixed(4)), unit: "%" });
  if (shares !== null && shares !== 0 && netIncome !== null) metrics.push({ key: "eps", label: "每股收益", value: Number((netIncome / shares).toFixed(6)), unit: finance.currency });
  if (shares !== null && price !== null) metrics.push({ key: "marketCap", label: "市值", value: Number((shares * price).toFixed(4)), ...(marketValueSemantics || { unit: finance.currency }) });
  const eps = metrics.find((metric) => metric.key === "eps")?.value;
  if (typeof eps === "number" && eps !== 0 && price !== null) metrics.push({ key: "pe", label: "市盈率", value: Number((price / eps).toFixed(4)), unit: "x" });
  if (!metrics.length) warnings.push("未找到可计算估值的收入、净利润、股本或价格列；未生成推测值。" );
  if (!priceKey) warnings.push("缺少价格列，无法计算市值与市盈率。" );
  if (shares !== null && price !== null && !marketValueSemantics) warnings.push(`Finance unit=${finance.unit} 没有受控 scale 映射，市值指标不可用于 scenario-workbook。`);
  return { operation: "valuation", metrics, finance, warnings, assumptions: { revenueKey, incomeKey, sharesKey, priceKey } };
}

function portfolioContent(source, options = {}) {
  const table = tableFromContent(source.content);
  const finance = financeContext(options, [source]);
  const symbolKey = String(options.symbolColumn || columnByAliases(table, ["symbol", "ticker", "代码", "证券代码", "名称"]));
  const quantityKey = String(options.quantityColumn || columnByAliases(table, ["quantity", "qty", "持仓", "数量"]));
  const priceKey = String(options.priceColumn || columnByAliases(table, ["price", "close", "现价", "收盘价"]));
  const costKey = String(options.costColumn || columnByAliases(table, ["cost", "cost_basis", "成本", "成本价"]));
  if (!quantityKey || !priceKey) throw new Error("组合分析需要数量与价格列。" );
  const holdings = table.rows.map((row, index) => {
    const quantity = finiteDataNumber(row?.[quantityKey]);
    const price = finiteDataNumber(row?.[priceKey]);
    const cost = finiteDataNumber(row?.[costKey]);
    if (quantity === null || price === null) return null;
    const marketValue = quantity * price;
    return {
      symbol: cleanText(row?.[symbolKey] || `持仓 ${index + 1}`, 100),
      quantity,
      price,
      cost,
      marketValue,
      pnl: cost !== null ? (price - cost) * quantity : null
    };
  }).filter(Boolean);
  if (!holdings.length) throw new Error("没有可计算的有效持仓行。" );
  const totalValue = holdings.reduce((sum, item) => sum + item.marketValue, 0);
  const pnlAvailable = holdings.every((item) => item.pnl !== null);
  const totalPnl = pnlAvailable ? holdings.reduce((sum, item) => sum + item.pnl, 0) : null;
  holdings.forEach((item) => { item.weight = totalValue ? item.marketValue / totalValue : 0; });
  const marketValueSemantics = marketValueMetricSemantics(finance);
  const outputTable = profileTable({
    sheetName: "Portfolio",
    sheetNames: ["Portfolio"],
    columnLabels: { symbol: "标的", quantity: "数量", price: "价格", cost: "成本价", marketValue: "市值", weight: "权重", pnl: "浮动盈亏" },
    rows: holdings
  });
  const metrics = [
    { key: "holdingCount", label: "持仓数量", value: holdings.length },
    { key: "marketValue", label: "组合市值", value: Number(totalValue.toFixed(4)), ...(marketValueSemantics || { unit: finance.currency }) },
    ...(totalPnl !== null ? [{ key: "pnl", label: "浮动盈亏", value: Number(totalPnl.toFixed(4)), unit: finance.currency }] : []),
    { key: "largestWeight", label: "最大单项权重", value: Number((Math.max(...holdings.map((item) => item.weight)) * 100).toFixed(4)), unit: "%" }
  ];
  const warnings = !costKey
    ? ["未找到成本列，盈亏指标不可用。"]
    : pnlAvailable ? [] : ["部分持仓缺少有效成本，盈亏指标不可用。"];
  if (!marketValueSemantics) warnings.push(`Finance unit=${finance.unit} 没有受控 scale 映射，组合市值指标不可用于 scenario-workbook。`);
  return {
    operation: "portfolio",
    table: outputTable,
    metrics,
    finance,
    warnings
  };
}

function aggregateScenarioFinance(sources, options = {}) {
  const contexts = sources.map((source) => {
    const value = source?.finance || source?.content?.finance;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("scenario-workbook 来源缺少 Finance context。" );
    return workerFinanceIdentity(value);
  });
  const inherited = contexts[0];
  for (const context of contexts.slice(1)) {
    const mismatches = FINANCE_SCENARIO_COMPARABLE_KEYS.filter((key) => context[key] !== inherited[key]);
    if (mismatches.length) throw new Error(`Finance scenario 来源口径不一致：${mismatches.join(", ")}。`);
  }
  const finance = {
    asOf: inherited.asOf,
    sourceName: `${sources.length} 个受控 Finance 来源`,
    currency: inherited.currency,
    unit: inherited.unit,
    timezone: inherited.timezone,
    disclaimer: "仅供信息与研究，不构成投资建议；市场数据可能延迟或不完整。"
  };
  const requested = workerFinanceIdentity(options);
  const mismatches = FINANCE_CONTEXT_IDENTITY_KEYS.filter((key) => requested[key] !== (finance[key] || ""));
  if (mismatches.length) throw new Error(`scenario-workbook operation context 与聚合来源不一致：${mismatches.join(", ")}。`);
  return finance;
}

function scenarioAdjustedValue(value, adjustmentPercent) {
  const adjusted = Number((value * (1 + adjustmentPercent / 100)).toFixed(6));
  if (!Number.isFinite(adjusted) || Math.abs(adjusted) > 1e15) throw new Error("Finance scenario 计算结果超出有限数值预算。" );
  return adjusted;
}

function scenarioWorkbookContent(sources, options = {}) {
  if (!Array.isArray(sources) || sources.length < 2 || sources.length > 12) throw new Error("scenario-workbook 需要 2-12 个来源。" );
  const orderedSources = [...sources].sort((left, right) => String(left?.id || "").localeCompare(String(right?.id || ""), "en"));
  const finance = aggregateScenarioFinance(orderedSources, options);
  const title = cleanText(options.title || "多标的情景工作簿", 240);
  const metricKey = cleanText(options.metricKey || "", 80);
  const metricPolicy = Object.prototype.hasOwnProperty.call(FINANCE_SCENARIO_METRIC_POLICIES, metricKey) ? FINANCE_SCENARIO_METRIC_POLICIES[metricKey] : null;
  const upsidePercent = Number(options.upsidePercent);
  const stressPercent = Number(options.stressPercent);
  if (!metricKey) throw new Error("scenario-workbook metricKey 不能为空。" );
  if (!metricPolicy) throw new Error("scenario-workbook 仅支持非负市值指标 marketCap 或 marketValue。" );
  if (!Number.isFinite(upsidePercent) || upsidePercent <= 0 || upsidePercent > 200) throw new Error("scenario-workbook upsidePercent 无效。" );
  if (!Number.isFinite(stressPercent) || stressPercent <= -100 || stressPercent >= 0) throw new Error("scenario-workbook stressPercent 无效。" );

  const snapshots = [];
  const facts = [];
  let sharedMetric = null;
  for (const source of orderedSources) {
    if (!["valuation", "portfolio"].includes(source.kind)) throw new Error(`scenario-workbook 不支持来源类型 ${source.kind}。`);
    const matches = (Array.isArray(source.content?.metrics) ? source.content.metrics : []).filter((metric) => metric?.key === metricKey);
    if (matches.length !== 1) throw new Error(`scenario-workbook 来源 ${source.title || source.id} 必须且只能包含一个 metric=${metricKey}。`);
    const metric = matches[0];
    if (typeof metric.value !== "number" || !Number.isFinite(metric.value) || metric.value < 0 || metric.value > 1e15) throw new Error(`scenario-workbook 来源 ${source.title || source.id} 的 metric=${metricKey} 必须是非负有限数值。`);
    const metricLabel = cleanText(metric.label || metricKey, 160);
    const metricMeasure = cleanText(metric.measure || "", 80);
    const metricUnit = cleanText(metric.unit || "", 160);
    const sourceFinance = source.finance || source.content.finance;
    const sourceFinanceIdentity = workerFinanceIdentity(sourceFinance);
    const expectedScale = financeScaleForUnit(sourceFinanceIdentity.unit);
    if (expectedScale === null) throw new Error(`scenario-workbook 来源 ${source.title || source.id} 的 Finance unit=${sourceFinanceIdentity.unit} 没有受控 scale 映射。`);
    if (metricMeasure !== "market-value" || !Object.prototype.hasOwnProperty.call(metric, "scale") || !Number.isSafeInteger(metric.scale) || !CONTROLLED_FINANCE_METRIC_SCALES.has(metric.scale)) {
      throw new Error(`scenario-workbook 来源 ${source.title || source.id} 的 metric=${metricKey} 缺少受控 measure/unit/scale。`);
    }
    if (!metricUnit || metricUnit !== sourceFinanceIdentity.currency || metric.scale !== expectedScale) {
      throw new Error(`scenario-workbook 来源 ${source.title || source.id} 的 metric=${metricKey} unit/scale 与 Finance context 不一致。`);
    }
    if (!sharedMetric) {
      sharedMetric = {
        key: metricKey,
        label: metricLabel,
        measure: metricMeasure,
        unit: metricUnit,
        scale: metric.scale,
        direction: metricPolicy.direction,
        scenarioRule: metricPolicy.scenarioRule
      };
    } else {
      if (metricLabel !== sharedMetric.label) throw new Error(`scenario-workbook metric=${metricKey} 标签不一致。`);
      if (metricMeasure !== sharedMetric.measure || metricUnit !== sharedMetric.unit || metric.scale !== sharedMetric.scale) {
        throw new Error(`scenario-workbook metric=${metricKey} measure/unit/scale 不一致。`);
      }
    }
    snapshots.push({
      artifactId: source.id,
      kind: source.kind,
      title: cleanText(source.title || source.kind, 240),
      revision: source.revision,
      sha256: source.sha256,
      finance: sourceFinance
    });
    facts.push({ id: source.id, sourceArtifactId: source.id, label: cleanText(source.title || source.kind, 240), value: metric.value, measure: metricMeasure, unit: metricUnit, scale: metric.scale });
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
  const ranked = [...facts].sort((left, right) => right.value - left.value || left.sourceArtifactId.localeCompare(right.sourceArtifactId, "en"));
  const highest = ranked[0];
  const lowest = ranked[ranked.length - 1];
  const spread = Number((highest.value - lowest.value).toFixed(6));
  const inferences = [
    { id: "ranking", kind: "ranking", text: `按 ${sharedMetric.label} 的基准事实排序，${highest.label} 最高，${lowest.label} 最低。`, sourceArtifactIds: ranked.map((fact) => fact.sourceArtifactId) },
    { id: "range", kind: "range", text: `${sharedMetric.label} 的基准区间差为 ${spread} ${sharedMetric.unit}（scale=${sharedMetric.scale}）。`, sourceArtifactIds: highest.sourceArtifactId === lowest.sourceArtifactId ? [highest.sourceArtifactId] : [highest.sourceArtifactId, lowest.sourceArtifactId] }
  ];
  const upstreamRisks = orderedSources.flatMap((source) => (Array.isArray(source.content?.warnings) ? source.content.warnings : []).map((warning) => `${cleanText(source.title || source.kind, 120)}：${cleanText(warning, 800)}`)).filter(Boolean).slice(0, 80);
  const risks = [...upstreamRisks, ...FINANCE_SCENARIO_FIXED_RISKS].slice(0, 100);
  const limitations = [...FINANCE_SCENARIO_LIMITATIONS];
  return {
    operation: "scenario-workbook",
    workbook: { structureVersion: 1, title, metric: sharedMetric, sources: snapshots, facts, assumptions, scenarios, inferences, risks, limitations },
    finance,
    warnings: risks
  };
}

function riskReviewContent(sources, options = {}) {
  const finance = financeContext(options, sources);
  const metrics = sources.flatMap((source) => Array.isArray(source.content?.metrics) ? source.content.metrics : []);
  const largestWeight = finiteDataNumber(metrics.find((metric) => metric.key === "largestWeight")?.value);
  const pnl = finiteDataNumber(metrics.find((metric) => metric.key === "pnl")?.value);
  const findings = [];
  if (largestWeight !== null) findings.push({ severity: largestWeight >= 50 ? "high" : largestWeight >= 30 ? "medium" : "low", title: "集中度", detail: `最大单项权重为 ${largestWeight}%。` });
  else findings.push({ severity: "unknown", title: "集中度", detail: "缺少可验证的持仓权重数据。" });
  if (pnl !== null) findings.push({ severity: pnl < 0 ? "medium" : "low", title: "浮动盈亏", detail: `当前浮动盈亏为 ${pnl} ${finance.currency}。` });
  findings.push({ severity: "info", title: "数据时效", detail: `所有判断仅适用于 ${finance.asOf}（${finance.timezone}）。` });
  return {
    operation: "risk-review",
    finance,
    findings,
    metrics: [
      { key: "findingCount", label: "风险检查项", value: findings.length },
      { key: "highRiskCount", label: "高风险项", value: findings.filter((item) => item.severity === "high").length }
    ],
    warnings: ["未包含实时价格、流动性、相关性、压力测试或税务影响，不能据此直接交易。"]
  };
}

async function executeTask(task) {
  const operation = String(task?.operation || "");
  if (operation === "parse") {
    const table = await parseInputFile(String(task.filePath || ""));
    return { operation: "import", table, warnings: table.warnings || [] };
  }
  const sources = Array.isArray(task.sources) ? task.sources : [];
  const primary = sources[0];
  if (!primary && operation !== "report") throw new Error(`${operation} 缺少来源 artifact。`);
  if (operation === "clean") return cleanedTable(primary.content, task.options);
  if (operation === "transform") return transformedTable(sources, task.options);
  if (operation === "analysis") return analysisContent(primary.content);
  if (operation === "chart") return chartContent(primary.content, task.options);
  if (operation === "report") return reportContent(sources, task.options);
  if (operation === "presentation") return presentationContent(sources, task.options);
  if (operation === "valuation") return valuationContent(primary, task.options);
  if (operation === "portfolio") return portfolioContent(primary, task.options);
  if (operation === "scenario-workbook") return scenarioWorkbookContent(sources, task.options);
  if (operation === "risk-review") return riskReviewContent(sources, task.options);
  if (operation === "finance-report") return reportContent(sources, task.options, financeContext(task.options, sources));
  throw new Error(`未知 lineage worker 操作：${operation}`);
}

if (!isMainThread) {
  Promise.resolve()
    .then(() => executeTask(workerData))
    .then((result) => parentPort.postMessage({ ok: true, result }))
    .catch((error) => parentPort.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error), code: error?.code }));
} else {
  module.exports = {
    MAX_ROWS,
    MAX_COLUMNS,
    MAX_TABLE_CELLS,
    MAX_GENERATED_CELLS,
    MAX_XLSX_UNCOMPRESSED_BYTES,
    assertSafeXlsxArchive,
    executeTask,
    parseDelimited,
    profileTable,
    tableFromMatrix,
    abortError
  };
}
