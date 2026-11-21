/** @typedef {'gpt-image-2.5-flare'|'gpt-image-2.5-sunburst'|'gpt-image-2'|'gpt-image-1.5'|'gpt-image-1'|'compatible'} ImageModelFamily */
/** @typedef {'low'|'medium'|'high'|'xhigh'|'max'|'auto'} ImageQuality */
// Shared Images API contract for the renderer and Electron/Agent transports.
// OpenAI's Images SDK, 2026-09-10: Image 2.5 adds xhigh/max and native sizes.
export const IMAGE25_MODELS = ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"];
export const IMAGE_QUALITIES = ["low", "medium", "high", "xhigh", "max", "auto"];
const baseQualities = ["low", "medium", "high", "auto"];

/** @returns {ImageModelFamily} */
export function imageModelFamily(model) {
  const id = String(model || "").trim().toLowerCase();
  const variant = id.match(/^gpt-image-2\.5-(flare|sunburst)(?:-\d{4}-\d{2}-\d{2})?$/);
  if (variant) return `gpt-image-2.5-${variant[1]}`;
  if (/^gpt-image-2(?:-\d{4}-\d{2}-\d{2})?$/.test(id)) return "gpt-image-2";
  if (id === "gpt-image-1.5" || id === "gpt-image-1") return id;
  return "compatible";
}

export const isImage25Model = model => IMAGE25_MODELS.includes(imageModelFamily(model));
export const imageQualitiesForModel = model => isImage25Model(model) ? IMAGE_QUALITIES : baseQualities;
export const imageQualityForModel = (model, value) => imageQualitiesForModel(model).includes(value) ? value : "high";

export function resolveImageQuality(model, value, fallback = "high") {
  if (value === undefined || value === null || value === "") return imageQualityForModel(model, fallback);
  const quality = String(value).trim().toLowerCase();
  if (imageModelFamily(model) !== "compatible" && !imageQualitiesForModel(model).includes(quality)) {
    throw Object.assign(new Error(`${model} 不支持画质 ${quality}；可选 ${imageQualitiesForModel(model).join("、")}。`),
      { code: "AIEYRA_IMAGE_QUALITY_UNSUPPORTED", status: 400 });
  }
  return quality;
}

export function validateImage25Size(model, value) {
  const size = String(value || "auto").trim().toLowerCase();
  if (!isImage25Model(model) || size === "auto") return size;
  const match = size.match(/^(\d+)x(\d+)$/);
  const width = Number(match?.[1]), height = Number(match?.[2]);
  const pixels = width * height, long = Math.max(width, height), short = Math.min(width, height);
  if (!match || short <= 0 || width % 16 || height % 16 || long > 3840 || long / short > 3 || pixels < 655360 || pixels > 8294400) {
    throw Object.assign(new Error(`${model} 尺寸无效：${size}。宽高须为 16 的倍数，比例在 1:3 到 3:1 之间，像素数 655360–8294400，最长边不超过 3840；也可使用 auto。`),
      { code: "AIEYRA_IMAGE_SIZE_UNSUPPORTED", status: 400 });
  }
  return size;
}

export function imagePromptForSize(model, prompt, size) {
  if (!isImage25Model(model) || !/^\d+x\d+$/.test(String(size))) return String(prompt || "");
  const [w, h] = size.split("x").map(Number);
  const suffix = `Output canvas: ${w}x${h} pixels; aspect ratio ${w}:${h}.`;
  return String(prompt || "").includes(suffix) ? String(prompt) : `${String(prompt || "").trim()}\n\n${suffix}`;
}
