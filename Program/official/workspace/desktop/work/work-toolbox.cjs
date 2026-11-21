"use strict";
const definition = (name, description, properties, required = []) => ({ type: "function", function: { name, description,
  parameters: { type: "object", properties, required, additionalProperties: false } } });
const workToolboxSchemas = [
  definition("toolbox", "按名称或用途查询工作工具，只返回名称和说明。", { query: { type: "string" } }),
  definition("open_tool", "打开专业工具的参数说明。当前任务调用前先打开；上下文整理后可重新打开。", { name: { type: "string" } }, ["name"]),
  definition("call_tool", "按已打开的参数调用专业工具，返回真实执行结果。", { name: { type: "string" }, arguments: { type: "object", additionalProperties: true } }, ["name", "arguments"]),
  definition("workspace_observe", "核对当前资料、成果版本与待审核阶段；正文通过 document_read 按需读取。", {})
];

function validateWorkArguments(value, schema, at = "arguments") {
  if (!schema) return;
  if (Array.isArray(schema.type)) {
    for (const type of schema.type) {
      try { validateWorkArguments(value, { ...schema, type }, at); return; } catch {}
    }
    throw new Error(`${at} 需要 ${schema.type.join(" / ")}`);
  }
  if (schema.type === "null") { if (value !== null) throw new Error(`${at} 需要 null`); return; }
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${at} 必须是 ${schema.enum.join(" / ")}`);
  const type = schema.type;
  if (type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${at} 需要对象`);
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) throw new Error(`${at}.${key} 必填`);
    for (const [key, item] of Object.entries(value)) {
      if (!schema.properties?.[key] && schema.additionalProperties === false) throw new Error(`${at}.${key} 不在工具参数中`);
      validateWorkArguments(item, schema.properties?.[key] || (typeof schema.additionalProperties === "object" ? schema.additionalProperties : undefined), `${at}.${key}`);
    }
  } else if (type === "array") {
    if (!Array.isArray(value)) throw new Error(`${at} 需要数组`);
    if (value.length < (schema.minItems || 0) || value.length > (schema.maxItems ?? Infinity)) throw new Error(`${at} 数量超出范围`);
    value.forEach((item, index) => validateWorkArguments(item, schema.items, `${at}[${index}]`));
  } else if (type === "integer" || type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value) || (type === "integer" && !Number.isSafeInteger(value))
      || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) throw new Error(`${at} 数值无效`);
  } else if (type && typeof value !== type) throw new Error(`${at} 需要 ${type}`);
  if (typeof value === "string" && (value.length < (schema.minLength || 0) || value.length > (schema.maxLength ?? Infinity))) throw new Error(`${at} 长度超出范围`);
}
module.exports = { workToolboxSchemas, validateWorkArguments };
