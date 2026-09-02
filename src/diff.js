/** Line diff (Myers-free LCS; skills are small). Returns ops: eq | add | del. */
export function diffLines(aText, bText) {
  const a = String(aText || "").split("\n");
  const b = String(bText || "").split("\n");
  const n = a.length;
  const m = b.length;
  if (n * m > 4_000_000) {
    return { ops: [{ type: "note", text: "Files too large to diff line by line" }], added: 0, removed: 0 };
  }
  const dp = new Uint32Array((n + 1) * (m + 1));
  const idx = (i, j) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[idx(i, j)] = a[i] === b[j] ? dp[idx(i + 1, j + 1)] + 1 : Math.max(dp[idx(i + 1, j)], dp[idx(i, j + 1)]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  let added = 0;
  let removed = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ type: "eq", text: a[i] }); i += 1; j += 1; }
    else if (dp[idx(i + 1, j)] >= dp[idx(i, j + 1)]) { ops.push({ type: "del", text: a[i] }); i += 1; removed += 1; }
    else { ops.push({ type: "add", text: b[j] }); j += 1; added += 1; }
  }
  while (i < n) { ops.push({ type: "del", text: a[i] }); i += 1; removed += 1; }
  while (j < m) { ops.push({ type: "add", text: b[j] }); j += 1; added += 1; }
  return { ops, added, removed, same: added === 0 && removed === 0 };
}
