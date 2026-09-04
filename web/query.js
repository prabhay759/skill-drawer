/**
 * Search: a small query language plus relevance ranking.
 *
 * Shared by the page and the test suite, so it must stay free of both DOM and
 * Node APIs.
 *
 *   pdf merge              every bare term must match somewhere
 *   "pdf forms"            quoted phrase, matched as one string
 *   -deploy                exclude anything matching
 *   agent:cursor           field filters (see FILTERS)
 *   risk:>=high  q:<50     comparisons on ranked and numeric fields
 *   is:disabled has:copies flags
 */

const RISK_ORDER = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };
const LINT_ORDER = { ok: 0, info: 1, warning: 2, error: 3 };

export const FILTERS = [
  ["agent", "agent name, e.g. agent:cursor"],
  ["drawer", "drawer path, e.g. drawer:.claude"],
  ["name", "skill name only"],
  ["desc", "description only"],
  ["path", "folder path only"],
  ["risk", "none|low|medium|high|critical, e.g. risk:>=high"],
  ["lint", "ok|info|warning|error, e.g. lint:error"],
  ["score", "quality score, e.g. score:<50 (alias q:)"],
  ["is", "disabled, project, user, file, link, duplicate, readonly, plugin, builtin"],
  ["has", "copies, lint, risk, files"],
];

const FILTER_KEYS = new Set([...FILTERS.map(([k]) => k), "q"]);

/** Split on whitespace, keeping "quoted phrases" together. */
function tokenize(input) {
  const out = [];
  const re = /(-?)(?:([a-z]+):)?(?:"([^"]*)"|(\S+))/gi;
  let m;
  while ((m = re.exec(input))) {
    const [, negate, key, quoted, bare] = m;
    const value = quoted !== undefined ? quoted : bare;
    if (!value && quoted === undefined) continue;
    out.push({ negate: negate === "-", key: key ? key.toLowerCase() : null, value, phrase: quoted !== undefined });
  }
  return out;
}

function splitComparison(value) {
  const m = String(value).match(/^(>=|<=|>|<|=)?\s*(.*)$/);
  return { op: m[1] || "=", value: m[2] };
}

export function parseQuery(input) {
  const terms = [];
  const filters = [];
  for (const t of tokenize(String(input || "").trim())) {
    if (t.key && FILTER_KEYS.has(t.key)) {
      const key = t.key === "q" ? "score" : t.key;
      filters.push({ key, negate: t.negate, ...splitComparison(t.value) });
    } else if (t.value) {
      // An unknown key: treat the whole thing as text, so "todo:" still searches.
      terms.push({ text: (t.key ? `${t.key}:${t.value}` : t.value).toLowerCase(), negate: t.negate, phrase: t.phrase });
    }
  }
  return { terms, filters, empty: !terms.length && !filters.length };
}

function compare(op, actual, expected) {
  switch (op) {
    case ">": return actual > expected;
    case ">=": return actual >= expected;
    case "<": return actual < expected;
    case "<=": return actual <= expected;
    default: return actual === expected;
  }
}

function flag(skill, name) {
  switch (name) {
    case "disabled": return Boolean(skill.disabled);
    case "enabled": return !skill.disabled;
    case "project": return skill.scope === "project";
    case "user": return skill.scope === "user";
    case "file": return Boolean(skill.file);
    case "link": return Boolean(skill.link);
    case "duplicate": return (skill.copyCount ?? skill.copies?.length ?? 0) > 0;
    case "writable": return Boolean(skill.writable);
    case "readonly": return !skill.writable;
    case "plugin": return skill.kind === "plugin";
    case "builtin": return skill.kind === "builtin";
    default: return false;
  }
}

function has(skill, name) {
  switch (name) {
    case "copies": return (skill.copyCount ?? skill.copies?.length ?? 0) > 0;
    case "lint": return skill.lint && skill.lint !== "ok";
    case "risk": return skill.risk && skill.risk !== "none";
    case "files": return (skill.fileCount ?? 0) > 1;
    default: return false;
  }
}

function passesFilter(skill, f) {
  const v = String(f.value || "").toLowerCase();
  let ok;
  switch (f.key) {
    case "agent": ok = `${skill.agentId} ${skill.agentLabel}`.toLowerCase().includes(v); break;
    case "drawer": ok = `${skill.drawerId} ${skill.drawerLabel}`.toLowerCase().includes(v); break;
    case "name": ok = `${skill.name} ${skill.slug}`.toLowerCase().includes(v); break;
    case "desc": ok = String(skill.description || "").toLowerCase().includes(v); break;
    case "path": ok = String(skill.path || "").toLowerCase().includes(v); break;
    case "risk": ok = RISK_ORDER[v] === undefined ? false : compare(f.op, RISK_ORDER[skill.risk] ?? 0, RISK_ORDER[v]); break;
    case "lint": ok = LINT_ORDER[v] === undefined ? false : compare(f.op, LINT_ORDER[skill.lint] ?? 0, LINT_ORDER[v]); break;
    case "score": {
      const n = Number(v);
      const actual = skill.qualityScore ?? skill.quality?.score;
      ok = Number.isNaN(n) || actual === undefined || actual === null ? false : compare(f.op, actual, n);
      break;
    }
    case "is": ok = flag(skill, v); break;
    case "has": ok = has(skill, v); break;
    default: ok = false;
  }
  return f.negate ? !ok : ok;
}

/** Characters of `needle` appear in order in `hay` — tolerates typos and gaps. */
function subsequence(hay, needle) {
  let i = 0;
  for (const ch of hay) {
    if (ch === needle[i]) i += 1;
    if (i === needle.length) return true;
  }
  return false;
}

function termScore(skill, term) {
  const name = String(skill.name || "").toLowerCase();
  const slug = String(skill.slug || "").toLowerCase();
  const desc = String(skill.description || "").toLowerCase();
  const t = term.text;
  if (name === t) return 120;
  if (name.startsWith(t) || slug.startsWith(t)) return 70;
  // A match at a word boundary beats one buried mid-word.
  if (new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(name)) return 50;
  if (name.includes(t) || slug.includes(t)) return 40;
  if (desc.includes(t)) return 22;
  const where = [skill.path, skill.drawerLabel, skill.agentLabel].join(" ").toLowerCase();
  if (where.includes(t)) return 10;
  let meta = "";
  try {
    meta = JSON.stringify(skill.frontmatter || {}).toLowerCase();
  } catch {
    meta = "";
  }
  if (meta.includes(t)) return 6;
  // Last resort: a fuzzy name match, so "pdftls" still finds "pdf-tools".
  if (!term.phrase && t.length >= 3 && subsequence(name.replace(/[^a-z0-9]/g, ""), t.replace(/[^a-z0-9]/g, ""))) return 4;
  return 0;
}

/**
 * @returns {number} 0 when the skill does not match; higher is more relevant.
 */
export function scoreSkill(skill, query) {
  if (!query || query.empty) return 1;
  for (const f of query.filters) if (!passesFilter(skill, f)) return 0;
  let score = 1;
  for (const term of query.terms) {
    const s = termScore(skill, term);
    if (term.negate) {
      if (s > 0) return 0;
    } else {
      if (s === 0) return 0;
      score += s;
    }
  }
  return score;
}

/** Ranges of `text` matched by the query's positive terms, for highlighting. */
export function matchRanges(text, query) {
  if (!query || !query.terms.length) return [];
  const hay = String(text || "").toLowerCase();
  const ranges = [];
  for (const term of query.terms) {
    if (term.negate || !term.text) continue;
    let from = 0;
    for (;;) {
      const at = hay.indexOf(term.text, from);
      if (at === -1) break;
      ranges.push([at, at + term.text.length]);
      from = at + term.text.length;
    }
  }
  if (!ranges.length) return [];
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [ranges[0]];
  for (const [start, end] of ranges.slice(1)) {
    const last = merged[merged.length - 1];
    if (start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}
