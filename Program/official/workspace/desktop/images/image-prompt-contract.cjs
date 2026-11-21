"use strict";

// Batch cardinality belongs to the scheduler, never to a single image request.
// Reject clear dispatch instructions rather than silently rewriting visual text.
function validateSingleImagePrompts(input) {
  const prompts = [{ prompt: input?.prompt, label: "prompt" }, ...(input?.items || []).map((item, index) => ({ prompt: item.prompt, label: `items[${index}].prompt` }))];
  for (const { prompt, label } of prompts) {
    if (typeof prompt !== "string") continue;
    const outsideQuotes = prompt.replace(/[“「『"][\s\S]*?[”」』"]/g, "");
    const chinese = /(?:^|[\n。；;！!])\s*(?:请|帮我|为我|再|继续|并行|批量|分别|一次|总共|共|各自|独立|高质量地|\s)*(?:生成|绘制|画出|画|制作|输出|产出)\s*(?:共|总共|至少|分别|独立|不同风格的|不同的|高质量的|\s)*([\d一二两三四五六七八九十百千万]+)\s*(?:张|幅|套|版)/g;
    const english = /\b(?:generate|create|produce|draw|render)\s+(?:(?:a\s+total\s+of|at\s+least|exactly)\s+)?(\d+|two|three|four|five|six|seven|eight|nine|ten|fifty|hundred)\s+(?:(?:different|independent|separate|high[- ]quality)\s+)*(?:images|pictures|variations|versions|options|candidates)\b/gi;
    const conflicts = [...outsideQuotes.matchAll(chinese), ...outsideQuotes.matchAll(english)].filter(match => !["1", "一"].includes(match[1]));
    if (conflicts.length) throw Object.assign(Error(`${label} 含有批次数量指令“${conflicts[0][0].trim()}”。把张数放在 count，把不同画面放在 items/variants；每个 prompt 只描述一张独立画面。画面内的主体数量、逐字文字及用户明确要求的拼图布局请保留。`), { code: "MATRIX_INPUT_INVALID" });
  }
}
module.exports = { validateSingleImagePrompts };
