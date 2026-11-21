"use strict";
// Unified canvas office documents: persistence, provenance, import/export and data operations.
const fs = require("node:fs/promises"),
  path = require("node:path");
const syncFs = require("node:fs");
const { createHash, randomUUID } = require("node:crypto");
const { atomicWriteJson } = require("../core/json-storage.cjs");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const clone = (value) => JSON.parse(JSON.stringify(value));
const MAX_TEXT = 2_000_000,
  MAX_BYTES = 32 * 1024 * 1024;
const formats = [
  "txt",
  "md",
  "html",
  "csv",
  "tsv",
  "json",
  "docx",
  "xlsx",
  "pptx",
  "pdf",
];
const checkText = (value) => {
  if (typeof value !== "string" || value.length > MAX_TEXT)
    throw Error("正文应为不超过200万字符的文本。");
  return value.replace(/\r\n?/g, "\n");
};
const id = (value) => {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(value || "")) throw Error("文档ID无效。");
  return value;
};
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
// PDF glyph runs are not paragraphs. Rejoin adjacent runs on the same baseline;
// retain column gaps, line order and the untouched original PDF alongside text.
function readablePdfText(result) {
  if (!result.pages?.length) return result.canonicalText || result.text || "";
  return result.pages
    .map((page) => {
      const lines = [];
      let previous = null;
      for (const block of page.blocks || []) {
        const text = String(block.text || "").replace(
            /[\u2e80-\u2fd5\uf900-\ufaff]/g,
            (c) => c.normalize("NFKC"),
          ),
          box = block.bbox;
        if (!text) continue;
        const height = Math.max(
            1,
            box?.height || 0,
            previous?.box?.height || 0,
          ),
          gap =
            box && previous?.box
              ? box.x - (previous.box.x + previous.box.width)
              : Infinity;
        if (
          previous &&
          box &&
          Math.abs(box.y - previous.box.y) <= height * 0.25 &&
          gap >= -2 &&
          gap <= height * 0.85
        ) {
          const cjk = /[\u3000-\u9fff\uac00-\ud7af]/;
          const space =
            gap > height * 0.12 &&
            !cjk.test(previous.text.slice(-1)) &&
            !cjk.test(text[0])
              ? " "
              : "";
          lines[lines.length - 1] += space + text;
        } else lines.push(text);
        previous = { text, box };
      }
      return lines.join("\n");
    })
    .join("\n\n");
}
// Bound archive expansion before Office parsers allocate/decompress entries.
function zipBudget(bytes) {
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw Error("Office文件ZIP目录损坏。");
  const count = bytes.readUInt16LE(end + 10),
    size = bytes.readUInt32LE(end + 12),
    start = bytes.readUInt32LE(end + 16);
  if (
    bytes.readUInt16LE(end + 4) ||
    bytes.readUInt16LE(end + 6) ||
    count !== bytes.readUInt16LE(end + 8) ||
    !count ||
    count > 12000 ||
    start + size > end
  )
    throw Error("Office文件目录超出限制。");
  let offset = start,
    total = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > start + size || bytes.readUInt32LE(offset) !== 0x02014b50)
      throw Error("Office文件目录无效。");
    const flags = bytes.readUInt16LE(offset + 8),
      compressed = bytes.readUInt32LE(offset + 20),
      expanded = bytes.readUInt32LE(offset + 24),
      local = bytes.readUInt32LE(offset + 42);
    const length =
      46 +
      bytes.readUInt16LE(offset + 28) +
      bytes.readUInt16LE(offset + 30) +
      bytes.readUInt16LE(offset + 32);
    total += expanded;
    if (
      flags & 1 ||
      expanded > 32 * 1024 * 1024 ||
      total > 128 * 1024 * 1024 ||
      compressed === 0xffffffff ||
      local >= start ||
      offset + length > start + size
    )
      throw Error("Office文件加密、损坏或解压后超过128MB。");
    offset += length;
  }
  if (offset !== start + size) throw Error("Office文件目录长度不一致。");
}
// Portable project support uses the same source/revision store, without a second database.
function studioPackage(project, input) {
  const root = path.resolve(project.path),
    directory = path.join(root, ".iiimage", "studio");
  const safe = (relative) =>
    /^\.iiimage\/studio\/(?:doc-[\w-]+\.json|sources\/[a-f0-9]{64}\.(?:txt|md|html|csv|tsv|json|docx|xlsx|pptx|pdf))$/.test(
      relative,
    );
  if (input === undefined) {
    if (!syncFs.existsSync(directory)) return [];
    const files = [];
    let total = 0;
    for (const relative of syncFs
      .readdirSync(directory)
      .filter((n) => /^doc-[\w-]+\.json$/.test(n))
      .map((n) => `.iiimage/studio/${n}`)
      .concat(
        syncFs.existsSync(path.join(directory, "sources"))
          ? syncFs
              .readdirSync(path.join(directory, "sources"))
              .map((n) => `.iiimage/studio/sources/${n}`)
          : [],
      )) {
      if (!safe(relative)) continue;
      const file = path.join(root, relative),
        stat = syncFs.lstatSync(file);
      if (
        stat.isSymbolicLink() ||
        !stat.isFile() ||
        !syncFs
          .realpathSync(file)
          .toLowerCase()
          .startsWith(syncFs.realpathSync(root).toLowerCase() + path.sep)
      )
        throw Error("文档包包含不安全的文件引用。");
      const bytes = syncFs.readFileSync(file);
      total += bytes.length;
      if (total > 64 * 1024 * 1024)
        throw Error("文档项目包超过64MB，请分别导出文档。");
      files.push({
        relativePath: relative,
        data: bytes.toString("base64"),
        sha256: hash(bytes),
      });
    }
    return files;
  }
  if (!Array.isArray(input) || input.length > 10000)
    throw Error("文档项目包索引无效。");
  let total = 0;
  const seen = new Set();
  const files = input.map((entry) => {
    if (
      !entry ||
      !safe(entry.relativePath) ||
      seen.has(entry.relativePath.toLowerCase()) ||
      typeof entry.data !== "string"
    )
      throw Error("文档项目包路径无效或重复。");
    seen.add(entry.relativePath.toLowerCase());
    const bytes = Buffer.from(entry.data, "base64");
    total += bytes.length;
    if (
      bytes.toString("base64") !== entry.data ||
      hash(bytes) !== entry.sha256 ||
      total > 64 * 1024 * 1024
    )
      throw Error("文档项目包校验失败或过大。");
    if (
      entry.relativePath.endsWith(".json") &&
      !entry.relativePath.includes("/sources/")
    ) {
      const doc = JSON.parse(bytes);
      if (
        doc.schema !== 1 ||
        !Array.isArray(doc.spans) ||
        hash(doc.text) !== doc.sha256 ||
        entry.relativePath !== `.iiimage/studio/${doc.id}.json`
      )
        throw Error("文档项目包正文校验失败。");
    }
    return { ...entry, bytes };
  });
  return {
    files,
    decodedBytes: total,
    restore() {
      // Validate every destination before writing any document or source.
      for (const file of files) {
        const target = path.join(root, file.relativePath);
        if (syncFs.existsSync(target)) throw Error("文档导入目标已存在。");
        let ancestor = path.dirname(target);
        while (ancestor !== root) {
          if (syncFs.existsSync(ancestor) && (syncFs.lstatSync(ancestor).isSymbolicLink() || !syncFs.lstatSync(ancestor).isDirectory()))
            throw Error("文档导入路径包含不安全的目录引用。");
          ancestor = path.dirname(ancestor);
        }
      }
      for (const file of files) {
        const target = path.join(root, file.relativePath);
        if (syncFs.existsSync(target)) throw Error("文档导入目标已存在。");
        syncFs.mkdirSync(path.dirname(target), { recursive: true });
        let bytes = file.bytes;
        if (
          file.relativePath.endsWith(".json") &&
          !file.relativePath.includes("/sources/")
        ) {
          const doc = JSON.parse(bytes);
          doc.projectId = project.id;
          bytes = Buffer.from(JSON.stringify(doc));
        }
        syncFs.writeFileSync(target, bytes, { flag: "wx" });
      }
    },
  };
}
function parseDelimited(text, delimiter = ",") {
  const rows = [];
  let row = [],
    field = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (quoted || !field) quoted = !quoted;
      else field += c;
    } else if (!quoted && (c === delimiter || c === "\n")) {
      row.push(field);
      field = "";
      if (c === "\n") {
        rows.push(row);
        row = [];
      }
    } else if (c !== "\r" || quoted) field += c;
  }
  if (quoted) throw Error("表格含未闭合的引号。");
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length > 100000 || rows.some((row) => row.length > 500))
    throw Error("表格超过10万行或500列。");
  return rows;
}
const delimited = (rows, delimiter = ",") =>
  rows
    .map((row) =>
      row
        .map((value) => {
          const s = String(value ?? "");
          return /["\r\n,\t]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        })
        .join(delimiter),
    )
    .join("\n");
function textBlocks(text, previous = []) {
  const old = new Map();
  for (const block of previous) {
    const list = old.get(block.text) || [];
    list.push(block.id);
    old.set(block.text, list);
  }
  let offset = 0;
  return text.split("\n").map((text) => {
    const result = {
      id: old.get(text)?.shift() || "p-" + randomUUID(),
      start: offset,
      end: offset + text.length,
      text,
    };
    offset += text.length + 1;
    return result;
  });
}
function replaceRange(document, start, end, replacement, author) {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end > document.text.length
  )
    throw Error("修改范围无效。");
  const delta = replacement.length - (end - start),
    spans = [];
  for (const span of document.spans) {
    if (span.end <= start) spans.push(span);
    else if (span.start >= end)
      spans.push({ ...span, start: span.start + delta, end: span.end + delta });
    else {
      if (span.start < start) spans.push({ ...span, end: start });
      if (span.end > end)
        spans.push({
          ...span,
          start: start + replacement.length,
          end: span.end + delta,
        });
    }
  }
  if (replacement.length)
    spans.push({
      start,
      end: start + replacement.length,
      author,
      revision: document.revision + 1,
    });
  spans.sort((a, b) => a.start - b.start);
  document.spans = spans;
  for (const note of document.annotations || []) {
    if (note.end <= start) continue;
    if (note.start >= end) {
      note.start += delta;
      note.end += delta;
    } else {
      note.anchorChanged = true;
      note.start = Math.min(note.start, start);
      note.end = Math.max(
        note.start,
        Math.min(document.text.length + delta, note.end + delta),
      );
    }
  }
  const before = document.text.slice(start, end);
  document.text =
    document.text.slice(0, start) + replacement + document.text.slice(end);
  document.blocks = textBlocks(document.text, document.blocks);
  document.changes.push({
    id: randomUUID(),
    at: new Date().toISOString(),
    author,
    revision: document.revision + 1,
    start,
    before,
    after: replacement,
  });
  document.changes = document.changes.slice(-100);
}
function dataRows(document) {
  if (["csv", "tsv"].includes(document.format))
    return parseDelimited(
      document.text,
      document.format === "tsv" ? "\t" : ",",
    );
  if (document.format === "json") {
    const value = JSON.parse(document.text);
    if (!Array.isArray(value)) throw Error("数据应为JSON数组。");
    if (value.every(Array.isArray)) return value;
    if (
      value.every(
        (row) => row && typeof row === "object" && !Array.isArray(row),
      )
    ) {
      const columns = [...new Set(value.flatMap(Object.keys))];
      return [
        columns,
        ...value.map((row) => columns.map((key) => row[key] ?? "")),
      ];
    }
  }
  throw Error("请使用CSV/TSV或表格JSON文档；XLSX导入后可选择其工作表。");
}
function analyze(document, input) {
  const rows = dataRows(document),
    headers = rows[0] || [],
    body = rows.slice(1);
  const column = (key) => {
    const index = typeof key === "number" ? key : headers.indexOf(key);
    if (!Number.isInteger(index) || index < 0 || index >= headers.length)
      throw Error("数据列不存在。");
    return index;
  };
  if (input.operation === "sort") {
    const c = column(input.column);
    return {
      rows: [
        headers,
        ...body
          .slice()
          .sort(
            (a, b) =>
              (finite(Number(a[c])) && finite(Number(b[c]))
                ? Number(a[c]) - Number(b[c])
                : String(a[c]).localeCompare(String(b[c]))) *
              (input.descending ? -1 : 1),
          ),
      ],
    };
  }
  if (input.operation === "filter") {
    const c = column(input.column),
      ops = {
        eq: (v) => String(v) === String(input.value),
        contains: (v) => String(v).includes(String(input.value)),
        gt: (v) => Number(v) > Number(input.value),
        lt: (v) => Number(v) < Number(input.value),
      };
    if (!ops[input.compare || "eq"]) throw Error("筛选比较方式无效。");
    return {
      rows: [
        headers,
        ...body.filter((row) => ops[input.compare || "eq"](row[c])),
      ],
    };
  }
  const c = column(input.column),
    valid = [],
    missing = [],
    invalid = [];
  body.forEach((row, index) => {
    const raw = row[c];
    if (raw === "" || raw == null) missing.push(index + 2);
    else if (!Number.isFinite(Number(raw))) invalid.push(index + 2);
    else valid.push({ row, value: Number(raw) });
  });
  if (!valid.length) throw Error("所选列没有有效数字。");
  const values = valid.map((v) => v.value),
    sum = values.reduce((a, b) => a + b, 0),
    mean = sum / values.length;
  let result = {
    count: values.length,
    missingRows: missing,
    invalidRows: invalid,
    sum,
    mean,
    min: values.reduce((a, b) => Math.min(a, b), Infinity),
    max: values.reduce((a, b) => Math.max(a, b), -Infinity),
    median:
      [...values]
        .sort((a, b) => a - b)
        .slice(
          Math.floor((values.length - 1) / 2),
          Math.floor(values.length / 2) + 1,
        )
        .reduce((a, b) => a + b, 0) / (values.length % 2 ? 1 : 2),
    standardDeviation: Math.sqrt(
      values.reduce((n, v) => n + (v - mean) ** 2, 0) / values.length,
    ),
  };
  if (input.operation === "group") {
    const g = column(input.groupBy),
      groups = new Map();
    for (const item of valid) {
      const key = String(item.row[g] ?? "");
      const values = groups.get(key) || [];
      values.push(item.value);
      groups.set(key, values);
    }
    result.groups = [...groups].map(([key, values]) => ({
      key,
      count: values.length,
      sum: values.reduce((a, b) => a + b, 0),
      mean: values.reduce((a, b) => a + b, 0) / values.length,
    }));
  } else if (input.operation === "finance") {
    if (missing.length || invalid.length)
      throw Error("金融时间序列不允许跳过缺失或无效行，请先清理数据。");
    const rate = input.discountRate ?? 0,
      periods = input.periodsPerYear ?? 1;
    if (!finite(rate) || rate <= -1 || !finite(periods) || periods <= 0)
      throw Error("折现率或年周期数无效。");
    const npv = values.reduce((n, v, i) => n + v / (1 + rate) ** i, 0);
    const priceSeries = values.every((v) => v > 0),
      returns = priceSeries
        ? values.slice(1).map((v, i) => v / values[i] - 1)
        : [];
    const avg = returns.length
      ? returns.reduce((a, b) => a + b, 0) / returns.length
      : null;
    let peak = values[0],
      drawdown = 0;
    if (priceSeries)
      for (const value of values) {
        peak = Math.max(peak, value);
        drawdown = Math.min(drawdown, value / peak - 1);
      }
    result.finance = {
      npv,
      discountRate: rate,
      convention:
        "现金流首行为t=0，折现率按每期；价格收益指标仅对全正值序列计算，不自动猜测频率或单位。",
      periodsPerYear: periods,
      totalReturn: priceSeries ? values.at(-1) / values[0] - 1 : null,
      annualizedGrowth:
        priceSeries && values.length > 1
          ? (values.at(-1) / values[0]) ** (periods / (values.length - 1)) - 1
          : null,
      maxDrawdown: priceSeries ? drawdown : null,
      annualizedVolatility:
        returns.length > 1
          ? Math.sqrt(
              returns.reduce((n, v) => n + (v - avg) ** 2, 0) /
                (returns.length - 1),
            ) * Math.sqrt(periods)
          : null,
    };
  } else if (input.operation !== "summary")
    throw Error("请选择summary/group/sort/filter/finance。");
  return result;
}
function createStudioDocuments({ projectById, pdfImport, pdfExport }) {
  const queues = new Map();
  async function paths(projectId) {
    const project = await projectById(projectId);
    if (!project?.path) throw Error("项目不存在。");
    const root = path.join(project.path, ".iiimage", "studio");
    await fs.mkdir(root, { recursive: true });
    return {
      project,
      root,
      file: (docId) => path.join(root, id(docId) + ".json"),
    };
  }
  async function read(p, docId) {
    let text;
    try { text = await fs.readFile(p.file(docId), "utf8"); }
    catch (error) {
      if (error.code === "ENOENT")
        throw Object.assign(Error("文档不存在或已删除，请刷新后重试。"), { code: "STUDIO_DOCUMENT_NOT_FOUND" });
      throw error;
    }
    const doc = JSON.parse(text);
    if (
      doc.schema !== 1 ||
      doc.id !== docId ||
      doc.projectId !== p.project.id ||
      typeof doc.text !== "string" ||
      hash(doc.text) !== doc.sha256 ||
      !Array.isArray(doc.spans) ||
      !Array.isArray(doc.history)
    )
      throw Error("文档内容校验失败，原件保留。");
    return doc;
  }
  async function save(p, document, author, summary) {
    checkText(document.text);
    document.revision++;
    document.updatedAt = new Date().toISOString();
    document.sha256 = hash(document.text);
    const sheet = document.sheets?.find(
      (s) => s.name === (document.activeSheet || document.sheets[0]?.name),
    );
    if (sheet) {
      sheet.rows = dataRows(document);
      sheet.editor = {
        text: document.text,
        spans: clone(document.spans),
        annotations: clone(document.annotations),
        blocks: clone(document.blocks),
      };
    }
    document.history.push({
      revision: document.revision,
      at: document.updatedAt,
      author,
      summary: String(summary || "").slice(0, 1000),
      text: document.text,
      format: document.format,
      title: document.title,
      sheets: clone(document.sheets),
      activeSheet: document.activeSheet,
      citations: clone(document.citations),
      spans: clone(document.spans),
      annotations: clone(document.annotations),
      blocks: clone(document.blocks),
      sha256: document.sha256,
    });
    document.history = document.history.slice(-30);
    while (
      document.history.length > 1 &&
      Buffer.byteLength(JSON.stringify(document.history)) > 24 * 1024 * 1024
    )
      document.history.shift();
    atomicWriteJson(p.file(document.id), document);
    return document;
  }
  const publicDoc = (doc) => {
    const { history, ...rest } = doc;
    return {
      ...rest,
      history: history.map(
        ({ text, spans, annotations, blocks, sheets, citations, ...v }) => v,
      ),
    };
  };
  async function create(p, input, author, source) {
    const text = checkText(input.text || ""),
      now = new Date().toISOString(),
      format = input.format || "md";
    if (!["txt", "md", "html", "csv", "tsv", "json"].includes(format))
      throw Error("编辑格式应为txt/md/html/csv/tsv/json。");
    const doc = {
      schema: 1,
      id: "doc-" + randomUUID(),
      projectId: p.project.id,
      title: String(input.title || "未命名文档").slice(0, 240),
      format,
      revision: 0,
      text,
      spans: text ? [{ start: 0, end: text.length, author, revision: 1 }] : [],
      blocks: textBlocks(text),
      annotations: [],
      changes: [],
      history: [],
      createdAt: now,
      source: source || null,
      citations: input.citations || [],
      sheets: input.sheets || null,
    };
    return save(p, doc, author, "创建文档");
  }
  async function importFile(p, input) {
    const source = path.resolve(input.path || ""),
      stat = await fs.lstat(source),
      sourceExt = path.extname(source).slice(1).toLowerCase(),
      ext = sourceExt === "markdown" ? "md" : sourceExt === "htm" ? "html" : sourceExt;
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > MAX_BYTES ||
      !formats.includes(ext)
    )
      throw Error("不支持的文件格式、链接或超过32MB。");
    const bytes = await fs.readFile(source),
      digest = hash(bytes);
    if (["docx", "xlsx", "pptx"].includes(ext)) zipBudget(bytes);
    let text = "",
      format = "md",
      sheets = null,
      warnings = [];
    if (["txt", "md", "csv", "tsv", "json", "html"].includes(ext)) {
      text = new TextDecoder("utf-8", { fatal: true })
        .decode(bytes)
        .replace(/^\uFEFF/, "");
      format = ext;
    } else if (ext === "docx") {
      const parsed = await require("mammoth").extractRawText({ buffer: bytes });
      text = parsed.value;
      warnings = parsed.messages.map((m) => m.message);
      warnings.push("保留原始DOCX；编辑视图提取正文，不声称保留原版式。");
    } else if (ext === "xlsx") {
      const workbook = new (require("exceljs").Workbook)();
      await workbook.xlsx.load(bytes);
      sheets = [];
      for (const sheet of workbook.worksheets) {
        const rows = [];
        sheet.eachRow({ includeEmpty: true }, (row) => {
          rows.push(
            row.values
              .slice(1)
              .map((cell) =>
                cell == null
                  ? ""
                  : typeof cell === "object"
                    ? (cell.result ??
                      cell.text ??
                      cell.richText?.map((r) => r.text).join("") ??
                      "")
                    : cell,
              ),
          );
        });
        sheets.push({ name: sheet.name, rows });
      }
      if (!sheets.length) throw Error("工作簿没有工作表。");
      text = delimited(sheets[0].rows);
      format = "csv";
      warnings.push(
        "编辑当前选择的工作表；公式使用文件内缓存值，不执行Excel重算。原工作簿保留。",
      );
    } else if (ext === "pptx") {
      const zip = await require("jszip").loadAsync(bytes);
      const files = Object.keys(zip.files)
        .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
        .sort(
          (a, b) =>
            Number(a.match(/slide(\d+)/)[1]) - Number(b.match(/slide(\d+)/)[1]),
        );
      if (files.length > 500) throw Error("幻灯片超过500页。");
      const blocks = [];
      for (const [i, file] of files.entries()) {
        const xml = await zip.file(file).async("string");
        const doc = require("htmlparser2").parseDocument(xml, {
          xmlMode: true,
        });
        const words = [];
        const visit = (node) => {
          if (node.name === "a:t")
            words.push((node.children || []).map((n) => n.data || "").join(""));
          else for (const child of node.children || []) visit(child);
        };
        visit(doc);
        blocks.push(
          "# " +
            (words.shift() || `幻灯片 ${i + 1}`) +
            "\n\n" +
            words.join("\n"),
        );
      }
      text = blocks.join("\n\n---\n\n");
      warnings.push(
        "保留原始PPTX；编辑视图提取各页文字，不声称原动画或版式可往返。",
      );
    } else if (ext === "pdf") {
      if (!pdfImport) throw Error("PDF解析不可用。");
      const result = await pdfImport(source);
      text = readablePdfText(result);
      warnings.push(
        ...(result.warnings || []),
        "PDF保留原件；按同一基线合并相邻字形。复杂多栏/表格请对照原件；扫描页如未提供OCR文字则不能当作已读取。",
      );
      if (!text.trim()) throw Error("PDF未提取到文字，可能需要OCR。");
    }
    text = checkText(text);
    const sourceDir = path.join(p.root, "sources");
    await fs.mkdir(sourceDir, { recursive: true });
    const original = path.join(sourceDir, digest + "." + ext);
    await fs.writeFile(original, bytes, { flag: "wx" }).catch((e) => {
      if (e.code !== "EEXIST") throw e;
    });
    if (hash(await fs.readFile(original)) !== digest)
      throw Error("原件校验失败。");
    return create(
      p,
      { title: input.title || path.basename(source), format, text, sheets },
      "import",
      {
        originalName: path.basename(source),
        relativePath: path
          .relative(p.project.path, original)
          .replaceAll("\\", "/"),
        sha256: digest,
        bytes: bytes.length,
        warnings,
      },
    );
  }
  function markup(doc) {
    const pieces = [];
    for (const span of doc.spans)
      pieces.push(
        `<span data-author="${span.author}" style="color:${span.author === "user" ? "#327fc7" : span.author === "agent" ? "#9867d7" : "#222"}">${esc(doc.text.slice(span.start, span.end))}</span>`,
      );
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${esc(doc.title)}</title><style>body{font:12pt Arial,sans-serif;margin:32px;color:#222}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:6px}h1{font-size:24pt}</style></head><body><h1>${esc(doc.title)}</h1><pre>${pieces.join("")}</pre></body></html>`;
  }
  async function exportFile(p, doc, input) {
    if (input.path !== undefined)
      throw Error("导出文件保存在目标画布项目的 output/documents 目录，不支持指定 path；请使用返回的实际路径。");
    const format = input.format || doc.format;
    if (!formats.includes(format)) throw Error("导出格式不支持。");
    let bytes;
    if (format === "txt" || format === "md") bytes = Buffer.from(doc.text);
    else if (format === "html")
      bytes = Buffer.from(
        doc.format === "html"
          ? require("../../shared/writing-html.mjs").createSafeHtmlDocument(
              doc.text,
              doc.title,
            )
          : markup(doc),
      );
    else if (format === "json")
      bytes = Buffer.from(
        JSON.stringify(
          ["csv", "tsv"].includes(doc.format)
            ? dataRows(doc)
            : {
                title: doc.title,
                text: doc.text,
                spans: doc.spans,
                citations: doc.citations,
                annotations: doc.annotations,
              },
          null,
          2,
        ),
      );
    else if (format === "csv" || format === "tsv")
      bytes = Buffer.from(
        delimited(dataRows(doc), format === "tsv" ? "\t" : ","),
      );
    else if (format === "xlsx") {
      const workbook = new (require("exceljs").Workbook)();
      const all =
        input.allSheets && doc.sheets
          ? doc.sheets.map((s) => ({
              ...s,
              rows:
                s.name === (doc.activeSheet || doc.sheets[0].name)
                  ? dataRows(doc)
                  : s.rows,
            }))
          : [{ name: doc.title, rows: dataRows(doc) }];
      for (const sheet of all) {
        const ws = workbook.addWorksheet(
          sheet.name.replace(/[\\/*?:\[\]]/g, " ").slice(0, 31) || "Sheet",
        );
        // CSV has no cell types. Infer conservative decimal values while keeping
        // headers, leading-zero identifiers, long IDs and formula-like text literal.
        ws.addRows(sheet.rows.map((row, rowIndex) => row.map((value) => {
          if (!["csv", "tsv"].includes(doc.format) || rowIndex === 0 || typeof value !== "string" ||
              !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) ||
              value.replace(/[-.]/g, "").length > 15) return value;
          return Number(value);
        })));
        ws.getRow(1).font = { bold: true };
        ws.columns.forEach((c) => {
          c.width = 24;
        });
        ws.views = [{ state: "frozen", ySplit: 1 }];
      }
      bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    } else if (format === "docx") {
      const {
        Document,
        Paragraph,
        TextRun,
        HeadingLevel,
        Packer,
        Table,
        TableRow,
        TableCell,
      } = require("docx");
      let children = [
        new Paragraph({ text: doc.title, heading: HeadingLevel.TITLE }),
      ];
      if (["csv", "tsv"].includes(doc.format)) {
        children.push(
          new Table({
            rows: dataRows(doc).map(
              (row, i) =>
                new TableRow({
                  children: row.map(
                    (value) =>
                      new TableCell({
                        children: [
                          new Paragraph({
                            children: [
                              new TextRun({
                                text: String(value),
                                bold: i === 0,
                              }),
                            ],
                          }),
                        ],
                      }),
                  ),
                }),
            ),
          }),
        );
      } else
        for (const block of doc.blocks) {
          const heading = /^(#{1,3})\s+(.*)$/.exec(block.text);
          children.push(
            new Paragraph({
              ...(heading
                ? { heading: HeadingLevel["HEADING_" + heading[1].length] }
                : {}),
              children: heading
                ? [new TextRun(heading[2])]
                : doc.spans
                    .filter((s) => s.start < block.end && s.end > block.start)
                    .map(
                      (s) =>
                        new TextRun({
                          text: doc.text.slice(
                            Math.max(s.start, block.start),
                            Math.min(s.end, block.end),
                          ),
                          color:
                            s.author === "user"
                              ? "327FC7"
                              : s.author === "agent"
                                ? "9867D7"
                                : "222222",
                        }),
                    ),
            }),
          );
        }
      bytes = await Packer.toBuffer(new Document({ sections: [{ children }] }));
    } else if (format === "pptx") {
      const Pptx = require("pptxgenjs"),
        pptx = new Pptx();
      pptx.layout = "LAYOUT_WIDE";
      pptx.author = "Aieyra Workspace";
      pptx.subject = doc.title;
      pptx.title = doc.title;
      const slides =
        input.slides ||
        doc.text
          .split(/\n\s*---\s*\n/)
          .map((text, i) => ({
            title:
              text.split("\n")[0].replace(/^#+\s*/, "") ||
              `${doc.title} ${i + 1}`,
            text: text.split("\n").slice(1).join("\n"),
          }));
      if (!Array.isArray(slides) || slides.length > 100)
        throw Error("幻灯片应为1–100页。");
      for (const spec of slides) {
        const slide = pptx.addSlide();
        slide.addText(String(spec.title || doc.title), {
          x: 0.55,
          y: 0.4,
          w: 12.2,
          h: 0.7,
          fontSize: 28,
          bold: true,
          color: "182536",
          breakLine: false,
        });
        if (spec.table)
          slide.addTable(spec.table, {
            x: 0.55,
            y: 1.35,
            w: 12.2,
            h: 4.8,
            fontSize: 14,
            border: { pt: 0.5, color: "CBD5E1" },
            rowH: 0.4,
          });
        else if (spec.chart) {
          const { type = "bar", labels, series } = spec.chart;
          if (
            !["bar", "line", "pie"].includes(type) ||
            !Array.isArray(labels) ||
            !Array.isArray(series) ||
            series.some(
              (s) =>
                !Array.isArray(s.values) ||
                s.values.length !== labels.length ||
                s.values.some((v) => !finite(v)),
            )
          )
            throw Error("图表数据无效。");
          slide.addChart(
            pptx.ChartType[type],
            series.map((s) => ({
              name: String(s.name || "系列"),
              labels,
              values: s.values,
            })),
            {
              x: 0.7,
              y: 1.5,
              w: 11.8,
              h: 5,
              showLegend: series.length > 1,
              catAxisLabelFontSize: 12,
              valAxisLabelFontSize: 12,
              ...(type === "bar"
                ? {
                    valAxisMinVal: Math.min(
                      0,
                      ...series.flatMap((s) => s.values),
                    ),
                  }
                : {}),
            },
          );
        } else
          slide.addText(String(spec.text || ""), {
            x: 0.6,
            y: 1.4,
            w: 12,
            h: 5.4,
            fontSize: 18,
            color: "253348",
            breakLine: false,
            fit: "shrink",
            margin: 0,
          });
      }
      bytes = Buffer.from(await pptx.write({ outputType: "nodebuffer" }));
    } else if (format === "pdf") {
      if (!pdfExport) throw Error("PDF导出不可用。");
      bytes = await pdfExport(markup(doc));
    }
    const out = path.join(p.project.path, "output", "documents");
    await fs.mkdir(out, { recursive: true });
    const filename = `${doc.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 100) || "document"}-r${doc.revision}-${randomUUID().slice(0, 8)}.${format}`;
    const file = path.join(out, filename);
    await fs.writeFile(file, bytes, { flag: "wx" });
    if (hash(await fs.readFile(file)) !== hash(bytes))
      throw Error("导出校验失败。");
    return {
      ok: true,
      path: file,
      filename,
      format,
      bytes: bytes.length,
      sha256: hash(bytes),
      revision: doc.revision,
    };
  }
  async function run(input, author = "user") {
    const p = await paths(input.projectId),
      action = input.action;
    if (action === "list") {
      const docs = [];
      for (const entry of await fs.readdir(p.root)) {
        if (!/^doc-[\w-]+\.json$/.test(entry)) continue;
        const d = await read(p, entry.slice(0, -5));
        docs.push({
          id: d.id,
          title: d.title,
          format: d.format,
          revision: d.revision,
          updatedAt: d.updatedAt,
          excerpt: d.text.slice(0, 220),
        });
      }
      return {
        ok: true,
        documents: docs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      };
    }
    if (action === "create" || action === "import")
      return {
        ok: true,
        document: publicDoc(
          await (action === "create"
            ? create(p, input, author)
            : importFile(p, input)),
        ),
      };
    const doc = await read(p, input.id);
    if (action === "read") {
      if (input.revision) {
        const version = doc.history.find((v) => v.revision === input.revision);
        if (!version) throw Error("历史修订已不在保留的30版内。");
        return { ok: true, document: { ...publicDoc(doc), ...version } };
      }
      return { ok: true, document: publicDoc(doc) };
    }
    if (input.expectedRevision !== undefined && input.expectedRevision !== doc.revision)
      throw Object.assign(Error("文档已变化，请重新读取当前修订；未覆盖人工修改。"), { code: "STUDIO_REVISION_CONFLICT" });
    if (action === "export") return exportFile(p, doc, input);
    if (action === "analyze") {
      const result = analyze(doc, input);
      let report;
      if (input.saveAs) {
        const text = result.rows
          ? delimited(result.rows)
          : JSON.stringify(
              {
                source: {
                  documentId: doc.id,
                  revision: doc.revision,
                  sha256: doc.sha256,
                },
                ...result,
              },
              null,
              2,
            );
        report = publicDoc(
          await create(
            p,
            { title: input.saveAs, format: result.rows ? "csv" : "json", text },
            author,
            { documentId: doc.id, revision: doc.revision, sha256: doc.sha256 },
          ),
        );
      }
      return {
        ok: true,
        result,
        document: report,
        sourceRevision: doc.revision,
      };
    }
    if (input.expectedRevision !== doc.revision)
      throw Object.assign(
        Error("文档已变化，请重新读取当前修订；未覆盖人工修改。"),
        { code: "STUDIO_REVISION_CONFLICT" },
      );
    if (action === "edit") {
      const next = checkText(input.text);
      if (input.edits) {
        if (
          author !== "user" ||
          !Array.isArray(input.edits) ||
          input.edits.length > 20000
        )
          throw Error("人工编辑记录无效。");
        for (const edit of input.edits) {
          if (!edit || !Number.isInteger(edit.start) || !Number.isInteger(edit.end) || edit.start<0 || edit.end<edit.start || edit.end>doc.text.length || typeof edit.oldText!=="string")
            throw Error("人工编辑位置无效。");
          if (doc.text.slice(edit.start, edit.end) !== edit.oldText)
            throw Error("人工编辑原文已变化。");
          replaceRange(doc, edit.start, edit.end, checkText(edit.text), author);
        }
        if (doc.text !== next) throw Error("人工编辑记录与正文不一致。");
      } else {
        let start = 0,
          end = doc.text.length,
          tail = next.length;
        while (start < end && start < tail && doc.text[start] === next[start])
          start++;
        while (
          end > start &&
          tail > start &&
          doc.text[end - 1] === next[tail - 1]
        ) {
          end--;
          tail--;
        }
        replaceRange(doc, start, end, next.slice(start, tail), author);
      }
    } else if (action === "patch") {
      const patches = input.patches;
      if (!Array.isArray(patches) || !patches.length || patches.length > 100)
        throw Error("需要1–100项定点修改。");
      const ranges = patches
        .map((patch) => {
          const block = patch.blockId
            ? doc.blocks.find((b) => b.id === patch.blockId)
            : null;
          if (patch.blockId && !block)
            throw Error("段落已改变或不存在，请重新读取。");
          let start = patch.start, end = patch.end;
          if (block && start === undefined && end === undefined) {
            const text = doc.text.slice(block.start, block.end);
            if (text === patch.oldText) { start = block.start; end = block.end; }
            else {
              const offset = typeof patch.oldText === "string" && patch.oldText.length
                ? text.indexOf(patch.oldText) : -1;
              if (offset < 0 || text.indexOf(patch.oldText, offset + 1) >= 0)
                throw Error("段落内原文不存在或不唯一，请重新读取并提供精确 start/end。");
              start = block.start + offset;
              end = start + patch.oldText.length;
            }
          }
          if (
            !Number.isInteger(start) ||
            !Number.isInteger(end) ||
            start < 0 ||
            end < start ||
            end > doc.text.length ||
            (block && (start < block.start || end > block.end)) ||
            doc.text.slice(start, end) !== patch.oldText
          )
            throw Error("原文或段落位置已改变，请重新读取。");
          return { start, end, text: checkText(patch.text) };
        })
        .sort((a, b) => b.start - a.start);
      for (let i = 1; i < ranges.length; i++)
        if (ranges[i].end > ranges[i - 1].start)
          throw Error("修改范围不能重叠。");
      for (const r of ranges) replaceRange(doc, r.start, r.end, r.text, author);
    } else if (action === "annotate") {
      if (input.removeId)
        doc.annotations = doc.annotations.filter(
          (n) => n.id !== input.removeId,
        );
      else if (input.resolveId) {
        const n = doc.annotations.find((n) => n.id === input.resolveId);
        if (!n) throw Error("批注不存在。");
        n.status = input.status === "dismissed" ? "dismissed" : "resolved";
      } else {
        const start = input.start ?? 0,
          end = input.end ?? start;
        if (
          !Number.isInteger(start) ||
          !Number.isInteger(end) ||
          start < 0 ||
          end < start ||
          end > doc.text.length
        )
          throw Error("批注范围无效。");
        const text = String(input.instruction || "").trim();
        if (!text || text.length > 10000) throw Error("批注须为1–10000字。");
        doc.annotations.push({
          id: "mark-" + randomUUID(),
          start,
          end,
          quote: doc.text.slice(start, end),
          instruction: text,
          author,
          status: "open",
          at: new Date().toISOString(),
        });
      }
    } else if (action === "restore") {
      const old = doc.history.find((v) => v.revision === input.revision);
      if (!old) throw Error("历史修订不存在。");
      doc.text = old.text;
      doc.spans = clone(old.spans);
      doc.annotations = clone(old.annotations);
      doc.blocks = clone(old.blocks);
      doc.format = old.format || doc.format;
      doc.title = old.title || doc.title;
      doc.sheets = clone(old.sheets || null);
      doc.activeSheet = old.activeSheet;
      doc.citations = clone(old.citations || []);
    } else if (action === "sheet") {
      const sheet = doc.sheets?.find((s) => s.name === input.sheet);
      if (!sheet) throw Error("工作表不存在。");
      const previous = doc.sheets.find(
        (s) => s.name === (doc.activeSheet || doc.sheets[0].name),
      );
      if (previous) {
        previous.rows = dataRows(doc);
        previous.editor = {
          text: doc.text,
          spans: clone(doc.spans),
          annotations: clone(doc.annotations),
          blocks: clone(doc.blocks),
        };
      }
      const text = delimited(sheet.rows);
      Object.assign(
        doc,
        sheet.editor
          ? clone(sheet.editor)
          : {
              text,
              spans: text
                ? [
                    {
                      start: 0,
                      end: text.length,
                      author: "import",
                      revision: doc.revision + 1,
                    },
                  ]
                : [],
              annotations: [],
              blocks: textBlocks(text),
            },
      );
      doc.activeSheet = sheet.name;
    } else if (action === "metadata") {
      if (input.title) doc.title = String(input.title).slice(0, 240);
      if (input.citations) {
        if (
          !Array.isArray(input.citations) ||
          JSON.stringify(input.citations).length > 100000
        )
          throw Error("引用数据过大。");
        doc.citations = clone(input.citations);
      }
    } else if (action === "delete") {
      const archive = path.join(p.root, "archive");
      await fs.mkdir(archive, { recursive: true });
      await fs.rename(
        p.file(doc.id),
        path.join(archive, doc.id + "-" + Date.now() + ".json"),
      );
      return { ok: true, archived: true, id: doc.id };
    } else throw Error("未知文档操作。");
    return {
      ok: true,
      document: publicDoc(await save(p, doc, author, input.summary || action)),
    };
  }
  return {
    run(input, author = "user") {
      const key = String(input.projectId);
      const promise = (queues.get(key) || Promise.resolve()).then(() =>
        run(input, author),
      );
      queues.set(
        key,
        promise.catch(() => {}),
      );
      return promise;
    },
  };
}
module.exports = {
  createStudioDocuments,
  parseDelimited,
  delimited,
  textBlocks,
  replaceRange,
  analyze,
  studioPackage,
  readablePdfText,
};
