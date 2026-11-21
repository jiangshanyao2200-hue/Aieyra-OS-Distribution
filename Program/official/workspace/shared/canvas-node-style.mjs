/** @typedef {{background?:string,color?:string,borderColor?:string,borderWidth?:number,borderRadius?:number,fontSize?:number,padding?:number,borderStyle?:'solid'|'dashed'|'dotted'|'double',fontWeight?:'normal'|'bold',textAlign?:'left'|'center'|'right',shadow?:'none'|'soft'|'strong',fontFamily?:string}} CanvasNodeStyle */
"use strict";
const numbers = { borderWidth:[0,12], borderRadius:[0,96], fontSize:[10,48], padding:[0,48] };
const choices = { borderStyle:["solid","dashed","dotted","double"], fontWeight:["normal","bold"], textAlign:["left","center","right"], shadow:["none","soft","strong"] };
export function normalizeNodeStyle(value) {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw Error("节点样式必须是对象或 null。");
  const result = {};
  for (const [key,v] of Object.entries(value)) {
    if (["background","color","borderColor"].includes(key)) {
      if (typeof v !== "string" || !/^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.test(v)) throw Error(`${key} 使用十六进制颜色。`);
    } else if (numbers[key]) {
      if (typeof v !== "number" || !Number.isFinite(v) || v < numbers[key][0] || v > numbers[key][1]) throw Error(`${key} 超出允许范围。`);
    } else if (choices[key]) {
      if (!choices[key].includes(v)) throw Error(`${key} 不受支持。`);
    } else if (key === "fontFamily") {
      if (typeof v !== "string" || !v.trim() || v.length > 100 || /[;{}<>\r\n]/.test(v)) throw Error("fontFamily 无效。");
    } else throw Error(`不支持节点样式 ${key}。`);
    result[key] = v;
  }
  return result;
}
export function nodeStyleProperties(value) {
  let style; try { style = normalizeNodeStyle(value); } catch { return {}; }
  const result = {};
  for (const [key,v] of Object.entries(style)) {
    const cssValue = numbers[key] ? `${v}px` : key === "shadow" ? ({none:"none",soft:"0 4px 16px #00000020",strong:"0 8px 28px #00000040"})[v] : v;
    result[key === "background" ? "backgroundColor" : key === "shadow" ? "boxShadow" : key] = cssValue;
    result[`--custom-node-${key}`] = cssValue;
  }
  return result;
}

