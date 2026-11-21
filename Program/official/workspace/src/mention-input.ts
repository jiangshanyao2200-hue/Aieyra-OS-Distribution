export type MentionQuery = { start: number; end: number; prefix: string };
export type MentionOption = { code: string; name?: string; nodeTitle?: string };

export function mentionQueryAt(value: string, caret: number): MentionQuery | null {
  const end = Math.max(0, Math.min(value.length, Math.floor(caret) || 0));
  const match = value.slice(0, end).match(/@([^\s@，。！？、；：,!?;:()（）]{0,64})$/u);
  if (!match) return null;
  const start = end - match[0].length;
  if (start > 0 && /[A-Za-z0-9_@]/.test(value[start - 1])) return null;
  return { start, end, prefix: match[1] };
}

export function matchesMention(option: MentionOption, prefix: string) {
  const query = prefix.toLocaleLowerCase();
  return !query || option.code.toLocaleLowerCase().startsWith(query) ||
    [option.name, option.nodeTitle].some(value => value?.toLocaleLowerCase().includes(query));
}

// Only a contiguous insertion after the active query can accept a candidate.
// Deletion, paste over a selection, moving the caret and IME preedit are not
// acceptance. The caller passes the text before composition at compositionend.
export function acceptMentionOnContinuation(before: string, after: string, query: MentionQuery | null,
  options: MentionOption[], active: MentionOption | undefined, explicitlySelected = false) {
  if (!query || !active || !options.includes(active) || after.length <= before.length) return null;
  const insertedLength = after.length - before.length;
  if (after.slice(0, query.end) !== before.slice(0, query.end) ||
      after.slice(query.end + insertedLength) !== before.slice(query.end)) return null;
  const added = after.slice(query.end, query.end + insertedLength);
  const candidate = explicitlySelected ? active : options.find(option => option.code.toLowerCase() === query.prefix.toLowerCase()) || active;
  if (!explicitlySelected && options.some(option => matchesMention(option, query.prefix + added))) return null;
  if (!explicitlySelected && !query.prefix) return null;
  const replacement = `@${candidate.code}${/^\s/.test(added) ? "" : " "}${added}`;
  const text = before.slice(0, query.start) + replacement + before.slice(query.end);
  return { text, caret: query.start + replacement.length };
}
