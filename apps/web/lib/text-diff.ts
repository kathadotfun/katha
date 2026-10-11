export type DiffPart = Readonly<{ kind: "same" | "removed" | "added"; text: string }>;

// Word-level comparison for reviewing proposed public text. Large inputs fall back
// to a whole-field replacement rather than an expensive comparison.
export function wordDiff(before: string, after: string, limit = 4_000_000): DiffPart[] {
  if (before === after) return [{ kind: "same", text: before }];
  const a = before.split(/(\s+)/),
    b = after.split(/(\s+)/);
  if (a.length * b.length > limit)
    return [
      { kind: "removed", text: before },
      { kind: "added", text: after },
    ];
  const rows = a.length + 1,
    cols = b.length + 1;
  const table = new Uint32Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i * cols + j] =
        a[i] === b[j]
          ? table[(i + 1) * cols + j + 1]! + 1
          : Math.max(table[(i + 1) * cols + j]!, table[i * cols + j + 1]!);
  const parts: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], text: string) => {
    const last = parts.at(-1);
    if (last?.kind === kind) parts[parts.length - 1] = { kind, text: last.text + text };
    else parts.push({ kind, text });
  };
  let i = 0,
    j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("same", a[i]!);
      i++;
      j++;
    } else if (table[(i + 1) * cols + j]! >= table[i * cols + j + 1]!)
      push("removed", a[i++]!);
    else push("added", b[j++]!);
  }
  while (i < a.length) push("removed", a[i++]!);
  while (j < b.length) push("added", b[j++]!);
  return parts;
}
