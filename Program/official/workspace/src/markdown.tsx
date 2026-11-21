import { Fragment, useState, type ReactNode } from "react";
import { Clipboard } from "./studio-icons-lazy";

import { ButtonBase } from "./ui";
import { renderImageMentions } from "./image-mention-context";
import {
  isMarkdownFenceClose,
  markdownBlockKind as blockKind,
  parseMarkdownFence,
  parseMarkdownHeading as parseHeading,
  parseMarkdownInline,
  parseMarkdownListItem,
  parseMarkdownTableDelimiter,
  parseMarkdownTableRow,
  parseMarkdownTaskItem,
  markdownNeedsRendering,
  sanitizeMarkdownHref,
  type MarkdownTableAlignment
} from "./markdown-grammar";

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.style.cssText = "position:fixed;opacity:0";
  document.body.append(textarea);
  textarea.select();
  try {
    document.execCommand("copy");
  } finally {
    textarea.remove();
  }
}

function MarkdownCodeBlock({ language, text }: { language: string; text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await copyTextToClipboard(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="markdown-code-block">
      <div className="markdown-code-head">
        <span>{language}</span>
        <ButtonBase type="button" onClick={copy} title="复制代码">
          <Clipboard size={13} />
          {copied ? "已复制" : "复制"}
        </ButtonBase>
      </div>
      <pre><code>{text}</code></pre>
    </div>
  );
}

function renderInline(source: string, keyPrefix: string, allowMentions = true): ReactNode[] {
  const nodes: ReactNode[] = [];
  parseMarkdownInline(source).forEach((token, tokenIndex) => {
    const key = `${keyPrefix}-${tokenIndex}`;
    if (token.kind === "text") nodes.push(<Fragment key={key}>{allowMentions ? renderImageMentions(token.text) : token.text}</Fragment>);
    else if (token.kind === "code") nodes.push(<code key={key}>{allowMentions ? renderImageMentions(token.text) : token.text}</code>);
    else if (token.kind === "link") {
      const href = sanitizeMarkdownHref(token.href || "");
      nodes.push(href
        ? <a key={key} href={href} target="_blank" rel="noreferrer">{renderInline(token.text, key, false)}</a>
        : <Fragment key={key}>{renderInline(token.text, key, allowMentions)}</Fragment>);
    } else if (token.kind === "strong") nodes.push(<strong key={key}>{renderInline(token.text, key, allowMentions)}</strong>);
    else nodes.push(<em key={key}>{renderInline(token.text, key, allowMentions)}</em>);
  });
  return nodes.length ? nodes : [source];
}

function renderListItem(item: string, key: string) {
  const task = parseMarkdownTaskItem(item);
  return <li key={key} className={task ? "markdown-task-item" : undefined}>
    {task ? <input type="checkbox" checked={task.checked} disabled aria-label="任务状态" /> : null}
    {renderInline(task?.text ?? item, key)}
  </li>;
}

function renderTableRow(cells: string[], alignments: MarkdownTableAlignment[], key: string, heading = false) {
  const Cell = heading ? "th" : "td";
  return <tr key={key}>{cells.map((cell, column) => <Cell
    key={column}
    scope={heading ? "col" : undefined}
    style={{ textAlign: alignments[column] || undefined }}
  >{renderInline(cell, `${key}-${column}`)}</Cell>)}</tr>;
}

function renderMarkdownBlocks(content: string, preserveLineBreaks = false) {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const kind = blockKind(line);
    const key = `md-${blocks.length}`;
    const nextLine = lines[index + 1] || "";

    const tableHeader = parseMarkdownTableRow(line);
    const tableAlignments = tableHeader && parseMarkdownTableDelimiter(nextLine, tableHeader.length);
    if (tableHeader && tableAlignments) {
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length) {
        const row = parseMarkdownTableRow(lines[index]);
        if (!row || row.length !== tableHeader.length) break;
        rows.push(row);
        index += 1;
      }
      blocks.push(
        <div key={key} className="markdown-table-scroll" tabIndex={0} role="region" aria-label="表格">
          <table>
            <thead>{renderTableRow(tableHeader, tableAlignments, `${key}h`, true)}</thead>
            <tbody>{rows.map((row, rowIndex) => renderTableRow(row, tableAlignments, `${key}${rowIndex}`))}</tbody>
          </table>
        </div>
      );
      continue;
    }
    if (kind === "fence") {
      const fence = parseMarkdownFence(line);
      const language = fence?.info.split(/\s+/)[0] || "text";
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !(fence && isMarkdownFenceClose(lines[index], fence))) {
        body.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(<MarkdownCodeBlock key={key} language={language} text={body.join("\n")} />);
      continue;
    }

    if (kind === "heading") {
      const heading = parseHeading(line);
      const level = heading?.level ?? 2;
      const text = heading?.text ?? line;
      const Heading = `h${level}` as keyof JSX.IntrinsicElements;
      blocks.push(<Heading key={key}>{renderInline(text, `${key}-heading`)}</Heading>);
      index += 1;
      continue;
    }

    if (kind === "rule") {
      blocks.push(<hr key={key} />);
      index += 1;
      continue;
    }

    if (kind === "quote") {
      const quoteLines: string[] = [];
      while (index < lines.length && blockKind(lines[index]) === "quote") {
        quoteLines.push(lines[index].replace(/^\s{0,3}>\s?/, ""));
        index += 1;
      }
      blocks.push(<blockquote key={key}><p>{renderInline(quoteLines.join(" ").trim(), `${key}-quote`)}</p></blockquote>);
      continue;
    }

    if (kind === "unordered-list" || kind === "ordered-list") {
      const ordered = kind === "ordered-list";
      const start = ordered ? Math.max(1, Number(line.trim().match(/^\d+/)?.[0]) || 1) : undefined;
      const items: string[] = [];
      while (index < lines.length) {
        const item = parseMarkdownListItem(lines[index], ordered);
        if (item === null) break;
        items.push(item);
        index += 1;
      }
      const children = items.map((item, itemIndex) => renderListItem(item, `${key}-${itemIndex}`));
      blocks.push(ordered ? <ol key={key} start={start}>{children}</ol> : <ul key={key}>{children}</ul>);
      continue;
    }

    const paragraphLines = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && blockKind(lines[index]) === "paragraph") {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    blocks.push(<p key={key} style={preserveLineBreaks ? { whiteSpace: "pre-wrap" } : undefined}>{renderInline(paragraphLines.join(preserveLineBreaks ? "\n" : " "), `${key}-paragraph`)}</p>);
  }

  return blocks;
}

export default function RichMarkdownMessage({ content, preserveLineBreaks = false }: { content: string; preserveLineBreaks?: boolean }) {
  return <>{renderMarkdownBlocks(content, preserveLineBreaks)}</>;
}

export function AgentMarkdownMessage({ content }: { content: string }) {
  return markdownNeedsRendering(content)
    ? <div className="markdown-body">{renderMarkdownBlocks(content)}</div>
    : <div className="markdown-body agent-plain-text">{renderImageMentions(content)}</div>;
}
