"use strict";
const fileTool = (name, description, properties, required) => ({ type: "function", function: { name, description,
  parameters: { type: "object", properties, required, additionalProperties: false } } });
const sourceRefs = { type: "array", maxItems: 40, items: { type: "object", properties: {
  artifactId: { type: "string" }, expectedRevision: { type: "integer", minimum: 1 }
}, required: ["artifactId", "expectedRevision"], additionalProperties: false } };
const workFileToolSchemas = [
  fileTool("work_import", "把项目目录中的文件作为资料导入工作画布。支持 TXT/Markdown/HTML/CSV/TSV/JSON/XLSX/DOCX/PDF，保留原件。附件清单给出实际路径；先阅读用户要求。", { path: { type: "string" } }, ["path"]),
  fileTool("work_publish", "将项目目录中已生成的 TXT、Markdown 或 HTML 保存为可预览、可核对的独立成果。填写真实来源及当前版本；已有成果使用结构化 patch 修订。", {
    path: { type: "string" }, title: { type: "string", minLength: 1, maxLength: 240 }, sourceRefs
  }, ["path", "title"])
];
module.exports = { workFileToolSchemas };
