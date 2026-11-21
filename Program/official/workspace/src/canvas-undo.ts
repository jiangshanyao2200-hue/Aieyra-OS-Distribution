// Reverse just the user mutation. Work completed by a background job after
// the mutation remains on the canvas, including updates to an existing node.
export function undoCanvasChanges<T extends { id: string }>(before: T[], after: T[], current: T[]): T[] {
  const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
  const previous = new Map(before.map(item => [item.id, item]));
  const resulting = new Map(after.map(item => [item.id, item]));
  const live = new Set(current.map(item => item.id));
  const restored: T[] = [];
  for (const item of current) {
    const old = previous.get(item.id), changed = resulting.get(item.id);
    if (!old) { if (!changed || !equal(item, changed)) restored.push(item); continue; }
    if (!changed) { restored.push(item); continue; }
    const next = { ...item };
    for (const key of new Set([...Object.keys(old), ...Object.keys(changed)]) as Set<keyof T>) {
      if (equal(old[key], changed[key]) || !equal(item[key], changed[key])) continue;
      if (Object.prototype.hasOwnProperty.call(old, key)) next[key] = old[key]; else delete next[key];
    }
    restored.push(next);
  }
  for (const item of before) if (!resulting.has(item.id) && !live.has(item.id)) restored.push(item);
  return restored;
}
