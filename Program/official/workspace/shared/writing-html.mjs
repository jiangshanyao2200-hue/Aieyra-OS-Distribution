import { parseDocument } from "htmlparser2";

export const HTML_PREVIEW_CSP = "default-src 'none'; script-src 'none'; connect-src 'none'; img-src data:; media-src 'none'; font-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'; style-src 'unsafe-inline'";
export const isHtmlArtifact = (artifact) => artifact?.provenance?.source?.format === "html" || artifact?.attributes?.documentFormat === "html";
const escape = (value) => String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const tags = new Set("article section main header footer aside nav div span p h1 h2 h3 h4 h5 h6 br hr strong b em i u s small sub sup blockquote pre code ul ol li dl dt dd table caption thead tbody tfoot tr th td figure figcaption img a details summary abbr time mark ruby rt rp wbr style".split(" "));
const drop = new Set("script iframe object embed form input button textarea select option base link meta svg math template noscript audio video source canvas".split(" "));
const voids = new Set(["br", "hr", "img", "wbr"]);
const allowedAttributes = new Set(["id","class","title","lang","dir","style","colspan","rowspan","scope","alt","width","height","start","reversed","open","align"]);

// Parsing only: no DOM creation, resource loading, or execution. The same
// allowlist/CSP is used for previews and the standalone HTML delivered to users.
export function createSafeHtmlDocument(source, title = "HTML 文档") {
  if (String(source).length > 8 * 1024 * 1024) throw new Error("HTML 超过 8 MiB 限制。");
  const document = parseDocument(String(source), { decodeEntities: true });
  let count = 0;
  const render = (node, depth = 0) => {
    if (++count > 100000 || depth > 256) throw new Error("HTML 结构过于复杂，请简化后预览。");
    if (node.type === "text") return escape(node.data);
    const tag = String(node.name || "").toLowerCase();
    if (drop.has(tag) || tag === "title") return "";
    const body = () => (node.children || []).map((child) => render(child, depth + 1)).join("");
    if (!tags.has(tag)) return body();
    if (tag === "style") {
      // CSP blocks CSS resource requests, including escaped url()/@import forms.
      const css = (node.children || []).map((child) => child.data || "").join("").replace(/<\/style/gi, "<\\/style");
      return `<style>${css}</style>`;
    }
    const attrs = [];
    for (const [key, value] of Object.entries(node.attribs || {})) {
      if (allowedAttributes.has(key) || key === "role" || /^aria-[a-z-]+$/.test(key)) attrs.push(`${key}="${escape(value)}"`);
      else if (tag === "a" && key === "href" && /^#[A-Za-z0-9_\-:.]+$/.test(value)) attrs.push(`href="${escape(value)}"`);
      else if (tag === "img" && key === "src" && /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(value)) attrs.push(`src="${escape(value)}"`);
    }
    if (tag === "img" && !attrs.some((attr) => attr.startsWith("src="))) return `<span class="workspace-unavailable-image">${escape(node.attribs?.alt || "外部图片未加载")}</span>`;
    return `<${tag}${attrs.length ? " " + attrs.join(" ") : ""}>${voids.has(tag) ? "" : `${body()}</${tag}>`}`;
  };
  const body = render(document);
  return `<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_CSP}"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>html{color-scheme:light dark}body{margin:24px;font:16px/1.7 system-ui,sans-serif;background:#f6f5f0;color:#30332e;overflow-wrap:anywhere}img{max-width:100%;height:auto}.workspace-unavailable-image{display:inline-block;padding:8px 12px;border:1px solid #8886;border-radius:6px;font-size:12px}pre{white-space:pre-wrap}@media(prefers-color-scheme:dark){body{background:#151b19;color:#dce4dd}}</style></head><body>${body}</body></html>`;
}
