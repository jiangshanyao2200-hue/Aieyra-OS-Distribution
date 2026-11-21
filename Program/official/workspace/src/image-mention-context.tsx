import { createContext, useContext, type ReactNode } from "react";

type Target = { nodeId: string; assetIndex?: number; code: string; kind?: "document"; name?: string };
export const ImageMentionContext = createContext<{ targets: Map<string, Target>; locate: (target: Target) => void } | null>(null);

function ImageMention({ code }: { code: string }) {
  const context = useContext(ImageMentionContext);
  const target = context?.targets.get(code.toLowerCase());
  return target ? <button type="button" className="ui-button-base canvas-image-mention" data-image-mention={target.kind === "document" ? undefined : code} title={target.name}
    aria-label={`定位${target.kind === "document" ? "文档" : "图片"} @${code}`} onClick={() => context!.locate(target)}>@{code}</button> : <>@{code}</>;
}

export function renderImageMentions(text: string): ReactNode {
  if (!text.includes("@")) return text;
  const parts: ReactNode[] = []; let end = 0;
  for (const match of text.matchAll(/(?<![\w@])@([A-Za-z][A-Za-z0-9_-]{0,31})(?![A-Za-z0-9_-])/g)) {
    parts.push(text.slice(end, match.index), <ImageMention key={match.index} code={match[1]} />);
    end = match.index + match[0].length;
  }
  parts.push(text.slice(end)); return parts;
}
