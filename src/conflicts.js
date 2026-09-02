/**
 * Duplicate and trigger-conflict detection across the whole drawer set.
 */
const STOP = new Set(
  "a an the and or of to for in on with when use this that is are be by from as at it its into your you skill skills agent agents file files code".split(" "),
);

export function normalizeName(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function tokens(text) {
  return new Set(
    String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/[\s-]+/)
      .filter((t) => t.length > 2 && !STOP.has(t)),
  );
}

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

function ref(skill) {
  return { id: skill.id, name: skill.name, drawer: skill.drawerLabel, path: skill.path };
}

/**
 * @returns {Array<{type, severity, title, detail, skills:[]}>}
 */
export function detectConflicts(skills, { descriptionThreshold = 0.6 } = {}) {
  const issues = [];
  const active = skills.filter((s) => !s.disabled);
  const pairSeen = new Set();
  const pairKey = (a, b) => (a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`);

  // 1. exact copies by content hash
  const byHash = new Map();
  for (const s of active) {
    if (!s.contentHash) continue;
    const list = byHash.get(s.contentHash) || [];
    list.push(s);
    byHash.set(s.contentHash, list);
  }
  for (const group of byHash.values()) {
    if (group.length < 2) continue;
    issues.push({
      type: "exact-copy",
      severity: "info",
      title: `${group.length} identical copies of "${group[0].name}"`,
      detail: "Same SKILL.md content installed in more than one place. Keep one unless each tool needs its own copy.",
      skills: group.map(ref),
    });
    for (let i = 0; i < group.length; i += 1)
      for (let j = i + 1; j < group.length; j += 1) pairSeen.add(pairKey(group[i], group[j]));
  }

  // 2. same name, different content
  const byName = new Map();
  for (const s of active) {
    const key = normalizeName(s.name);
    if (!key) continue;
    const list = byName.get(key) || [];
    list.push(s);
    byName.set(key, list);
  }
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    const distinct = new Set(group.map((s) => s.contentHash));
    if (distinct.size < 2) continue;
    const drawers = new Set(group.map((s) => s.drawerId));
    issues.push({
      type: "same-name",
      severity: drawers.size === 1 ? "warning" : "info",
      title: `"${group[0].name}" is defined ${group.length} times with different content`,
      detail:
        drawers.size === 1
          ? "Two skills in the same drawer share a name; the tool will pick one unpredictably."
          : "Different tools will load different versions of a skill with the same name.",
      skills: group.map(ref),
    });
    for (let i = 0; i < group.length; i += 1)
      for (let j = i + 1; j < group.length; j += 1) pairSeen.add(pairKey(group[i], group[j]));
  }

  // One representative per content hash from here on, so identical copies
  // are not reported against every other skill more than once.
  const representative = [];
  const seenHash = new Set();
  for (const s of active) {
    if (s.contentHash && seenHash.has(s.contentHash)) continue;
    if (s.contentHash) seenHash.add(s.contentHash);
    representative.push(s);
  }

  // 3. near-identical names
  const named = representative.filter((s) => normalizeName(s.name).length >= 5);
  for (let i = 0; i < named.length; i += 1) {
    for (let j = i + 1; j < named.length; j += 1) {
      const a = named[i];
      const b = named[j];
      if (pairSeen.has(pairKey(a, b))) continue;
      const na = normalizeName(a.name);
      const nb = normalizeName(b.name);
      if (na === nb) continue;
      const dist = levenshtein(na, nb);
      const limit = Math.max(na.length, nb.length) >= 10 ? 2 : 1;
      if (dist <= limit) {
        pairSeen.add(pairKey(a, b));
        issues.push({
          type: "similar-name",
          severity: "warning",
          title: `"${a.name}" and "${b.name}" have near-identical names`,
          detail: "Agents choose skills by name and description; near-duplicates make the choice ambiguous.",
          skills: [ref(a), ref(b)],
        });
      }
    }
  }

  // 4. overlapping descriptions (trigger conflicts)
  const described = representative
    .map((s) => ({ s, t: tokens(s.description) }))
    .filter((x) => x.t.size >= 5);
  for (let i = 0; i < described.length; i += 1) {
    for (let j = i + 1; j < described.length; j += 1) {
      const a = described[i];
      const b = described[j];
      if (pairSeen.has(pairKey(a.s, b.s))) continue;
      const score = jaccard(a.t, b.t);
      if (score >= descriptionThreshold) {
        pairSeen.add(pairKey(a.s, b.s));
        issues.push({
          type: "overlapping-description",
          severity: "warning",
          title: `"${a.s.name}" and "${b.s.name}" trigger on overlapping descriptions`,
          detail: `Descriptions share ${Math.round(score * 100)}% of their keywords; both may be selected for the same request.`,
          score,
          skills: [ref(a.s), ref(b.s)],
        });
      }
    }
  }

  const order = { error: 3, warning: 2, info: 1 };
  issues.sort((x, y) => order[y.severity] - order[x.severity]);
  return issues;
}
