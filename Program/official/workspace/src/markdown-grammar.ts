/**
 * Shared, renderer-independent Markdown recognition.
 *
 * The agent feed and Writing artifact reader must agree about when a string
 * is Markdown. Keeping the small grammar here avoids the old split-brain
 * behaviour where the feed recognised a construct that the renderer left as
 * literal text (and vice versa).
 */

export type MarkdownBlockKind =
  | "fence"
  | "heading"
  | "quote"
  | "unordered-list"
  | "ordered-list"
  | "rule"
  | "paragraph";

export type MarkdownHeading = { level: number; text: string };

export type MarkdownTableAlignment = "left" | "center" | "right" | null;

export type MarkdownInlineToken = {
  kind: "text" | "code" | "link" | "strong" | "emphasis";
  text: string;
  href?: string;
};

/** Only these schemes may become active links in the React renderer. */
export function sanitizeMarkdownHref(value: string) {
  const href = value.trim();
  return /^(?:https?:\/\/|mailto:)/i.test(href) ? href : "";
}

export type MarkdownFence = { marker: "`" | "~"; length: number; info: string };

export function parseMarkdownFence(line: string): MarkdownFence | null {
  const match = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match) return null;
  return { marker: match[1][0] as "`" | "~", length: match[1].length, info: match[2].trim() };
}

export function isMarkdownFenceClose(line: string, fence: MarkdownFence) {
  const match = /^\s*(`{3,}|~{3,})\s*$/.exec(line);
  return Boolean(match && match[1][0] === fence.marker && match[1].length >= fence.length);
}

const cjkHeadingStart = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const inlineTokenPattern = /`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([^*\n]+)\*\*|(?<![\p{L}\p{N}_])__([^_\n]+)__(?![\p{L}\p{N}_])|\*([^*\n]+)\*|(?<![\p{L}\p{N}_])_([^_\n]+)_(?![\p{L}\p{N}_])/gu;

export function parseMarkdownInline(source: string): MarkdownInlineToken[] {
  const tokens: MarkdownInlineToken[] = [];
  let cursor = 0;
  for (const match of source.matchAll(inlineTokenPattern)) {
    const index = match.index ?? 0;
    if (index > cursor) tokens.push({ kind: "text", text: source.slice(cursor, index) });
    if (match[1]) tokens.push({ kind: "code", text: match[1] });
    else if (match[2] && match[3]) tokens.push({ kind: "link", text: match[2], href: match[3] });
    else if (match[4] || match[5]) tokens.push({ kind: "strong", text: match[4] || match[5] || "" });
    else tokens.push({ kind: "emphasis", text: match[6] || match[7] || "" });
    cursor = index + match[0].length;
  }
  if (cursor < source.length) tokens.push({ kind: "text", text: source.slice(cursor) });
  return tokens.length ? tokens : [{ kind: "text", text: source }];
}

export function parseMarkdownHeading(line: string): MarkdownHeading | null {
  // ATX indentation is zero to three literal spaces. A leading tab expands
  // past that boundary, and a seventh opening `#` must not be backtracked
  // into an H6 whose visible text happens to start with another hash.
  const match = /^ {0,3}(#{1,6})(?!#)(.*)$/.exec(line);
  if (!match) return null;
  const hashes = match[1];
  const rest = match[2] || "";
  const hasSeparator = /^[\t ]/.test(rest);
  // CommonMark requires a space after `#`. Models and Chinese users often
  // emit `##标题`; accept that compact form for 2–6 hashes (and a CJK
  // single-hash heading) without turning ordinary `#hashtag` text into H1.
  if (!hasSeparator && hashes.length < 2 && !cjkHeadingStart.test(rest)) return null;
  const text = rest
    .replace(/[\t ]+#+[\t ]*$/, "")
    .trim();
  if (!text) return null;
  return { level: hashes.length, text };
}

/** Split one GFM-style table row without activating arbitrary HTML. */
export function parseMarkdownTableRow(line: string): string[] | null {
  const source = line.trim();
  if (!source.includes("|")) return null;
  const cells = source.replace(/^\||\|$/g, "").split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, "|").trim());
  return cells.length > 1 ? cells : null;
}

export function parseMarkdownTableDelimiter(line: string, expectedColumns?: number): MarkdownTableAlignment[] | null {
  const cells = parseMarkdownTableRow(line);
  if (!cells || (expectedColumns && cells.length !== expectedColumns)) return null;
  const alignments = cells.map((cell): MarkdownTableAlignment | undefined => /^:?-{3,}:?$/.test(cell)
    ? cell.startsWith(":") ? cell.endsWith(":") ? "center" : "left" : cell.endsWith(":") ? "right" : null
    : undefined);
  return alignments.includes(undefined) ? null : alignments as MarkdownTableAlignment[];
}

export function parseMarkdownTaskItem(value: string) {
  const match = /^\[([ xX])\]\s*(.*)$/.exec(value.trim());
  return match ? { checked: match[1].toLowerCase() === "x", text: match[2] } : null;
}

export function isMarkdownHorizontalRule(line: string) {
  const compact = line.trim().replace(/\s+/g, "");
  return /^(?:\*{3,}|-{3,}|_{3,})$/.test(compact);
}

export function parseMarkdownListItem(line: string, ordered: boolean): string | null {
  // Match only horizontal whitespace, and share this exact recognition with
  // the block renderer. Empty items occur naturally during streamed output.
  const match = (ordered ? /^[\t ]*\d+[.)][\t ]+(.*)$/ : /^[\t ]*[-+*][\t ]+(.*)$/).exec(line);
  return match ? match[1] : null;
}

export function markdownBlockKind(line: string): MarkdownBlockKind {
  const value = line;
  if (parseMarkdownFence(value)) return "fence";
  if (parseMarkdownHeading(value)) return "heading";
  if (/^\s{0,3}>\s?/.test(value)) return "quote";
  if (parseMarkdownListItem(value, false) !== null) return "unordered-list";
  if (parseMarkdownListItem(value, true) !== null) return "ordered-list";
  if (isMarkdownHorizontalRule(value)) return "rule";
  return "paragraph";
}

/**
 * Decide whether the lightweight feed should mount the rich renderer.
 * This deliberately derives from the same block and inline grammar used by
 * the renderer: adding a supported construct cannot leave the first-load
 * detector behind, and literal identifiers such as snake_case stay untouched.
 */
export function markdownNeedsRendering(content: string) {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const nextLine = lines[index + 1] || "";
    const tableHeader = parseMarkdownTableRow(line);
    if (tableHeader && parseMarkdownTableDelimiter(nextLine, tableHeader.length)) return true;
    if (markdownBlockKind(line) !== "paragraph") return true;
    if (parseMarkdownInline(line).some((token) => token.kind !== "text")) return true;
  }
  return false;
}
