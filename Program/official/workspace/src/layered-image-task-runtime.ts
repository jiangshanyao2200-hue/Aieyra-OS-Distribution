import type { AppSettings, ReferenceImage } from "./core";

export type LayeredImageRole = "background" | "subject" | "foreground" | "decoration" | "text" | "shadow" | "other";

export type LayeredImageDraftLayer = {
  id: string;
  title: string;
  role: LayeredImageRole;
  prompt: string;
  text?: string;
  transparent: boolean;
  referenceImages: ReferenceImage[];
};

export type LayeredImageTaskDialogState = {
  projectId: string;
  worldX: number;
  worldY: number;
  sourceNodeId?: string;
  sourceAssetIndex?: number;
  prompt: string;
  ratio: string;
  resolution: string;
  quality: AppSettings["imageQuality"];
  model?: string;
  layers: LayeredImageDraftLayer[];
};

export function defaultLayeredImageTaskLayers(): LayeredImageDraftLayer[] {
  return [
    { id: "background", title: "背景", role: "background", prompt: "完整画布背景与环境，不包含后续独立图层中的主体和前景元素。", transparent: false, referenceImages: [] },
    { id: "subject", title: "主体", role: "subject", prompt: "画面主要人物、动物或其他有生命主体，保持完整轮廓与透明背景。", transparent: true, referenceImages: [] },
    { id: "foreground", title: "前景", role: "foreground", prompt: "最靠近镜头的装饰、氛围或前景元素，独立透明背景。", transparent: true, referenceImages: [] }
  ];
}
