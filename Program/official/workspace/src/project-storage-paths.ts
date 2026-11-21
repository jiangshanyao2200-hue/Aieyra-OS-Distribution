/** Rebase persisted draft attachments after an atomic managed-project move. */
export function relocateDraftPaths<T>(draft: T, mappings: [string, string][]): T {
  const normalize = (value: string) => {
    const normalized = value.replace(/\\/g, "/").replace(/\/$/, "");
    return /^(?:[a-z]:|\/\/)/i.test(normalized) ? normalized.toLowerCase() : normalized;
  };
  const move = (value: string): string => {
    const prefix = "iiimage-asset://local/abs/";
    if (value.startsWith(prefix)) {
      try { return prefix + encodeURIComponent(move(decodeURIComponent(value.slice(prefix.length)))); } catch { return value; }
    }
    const normalized = normalize(value);
    for (const [from, to] of mappings) {
      const source = normalize(from);
      if (normalized === source || normalized.startsWith(source + "/")) {
        return to.replace(/[\\/]$/, "") + value.slice(from.replace(/[\\/]$/, "").length);
      }
    }
    return value;
  };
  const queue: unknown[] = [draft];
  while (queue.length) {
    const current = queue.pop();
    if (!current || typeof current !== "object") continue;
    for (const [field, value] of Object.entries(current)) {
      if (typeof value === "string" && field !== "prompt" && field !== "text") (current as Record<string, unknown>)[field] = move(value);
      else if (value && typeof value === "object") queue.push(value);
    }
  }
  return draft;
}
