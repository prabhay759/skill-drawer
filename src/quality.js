/**
 * Static quality score (0-100) for a skill, no model needed. Each component
 * explains its points so the UI can show why a skill scored what it did.
 */
const TRIGGER_WORDS = /\b(use (this )?when|when (the )?user|trigger|whenever|if the user|for requests|use for|invoke)\b/i;

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

export function qualityScore({ frontmatter, present, error, body, lintProblems = [], risk = "none", slug, files = [], fileOnly = false }) {
  const fm = frontmatter || {};
  const parts = [];
  const add = (key, label, points, max, note) => parts.push({ key, label, points: clamp(Math.round(points), 0, max), max, note });

  // 1. Frontmatter validity (20)
  if (!present) add("frontmatter", "Frontmatter", 0, 20, "No YAML frontmatter; the agent cannot read a name or description");
  else if (error) add("frontmatter", "Frontmatter", 4, 20, "YAML does not parse");
  else {
    let p = 20;
    const notes = [];
    if (typeof fm.name !== "string" || !fm.name) { p -= 8; notes.push("missing name"); }
    else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fm.name)) { p -= 3; notes.push("name is not lowercase-hyphenated"); }
    if (!fileOnly && typeof fm.name === "string" && slug && fm.name !== slug) { p -= 3; notes.push("name differs from folder"); }
    if (lintProblems.some((x) => x.rule === "key.unknown")) { p -= 1; notes.push("unknown keys"); }
    add("frontmatter", "Frontmatter", p, 20, notes.length ? notes.join(", ") : "valid, name matches folder");
  }

  // 2. Description as a trigger (30)
  const d = typeof fm.description === "string" ? fm.description.trim() : "";
  if (!d) add("description", "Description", 0, 30, "Missing; the agent never knows when to load this skill");
  else {
    let p = 10;
    const notes = [];
    if (d.length >= 60) p += 8; else notes.push("very short");
    if (d.length <= 400) p += 2; else if (d.length > 1024) { p -= 6; notes.push("over the 1024-character limit"); } else notes.push("long");
    if (TRIGGER_WORDS.test(d)) { p += 8; } else notes.push("does not say when to use it");
    if (/\b(read|write|create|generate|merge|split|convert|deploy|test|lint|review|search|fix|build|run|analy[sz]e|summari[sz]e|extract|format|refactor|migrate|scan|install)\b/i.test(d)) p += 2; else notes.push("no action verb");
    if (/<[a-z][^>]*>/i.test(d)) { p -= 5; notes.push("contains HTML"); }
    add("description", "Description as trigger", p, 30, notes.length ? notes.join(", ") : "clear purpose and trigger guidance");
  }

  // 3. Body instructions (25)
  const b = String(body || "").trim();
  if (!b) add("body", "Instructions", 0, 25, "Empty body");
  else {
    let p = 8;
    const notes = [];
    const headings = (b.match(/^#{1,6}\s/gm) || []).length;
    const codeBlocks = (b.match(/```/g) || []).length / 2;
    const lists = (b.match(/^\s*(?:[-*+]|\d+\.)\s/gm) || []).length;
    const lines = b.split("\n").length;
    if (b.length >= 200) p += 5; else notes.push("very short body");
    if (headings >= 1) p += 3; else notes.push("no headings");
    if (codeBlocks >= 1 || /`[^`]+`/.test(b)) p += 4; else notes.push("no commands or code");
    if (lists >= 2) p += 3; else notes.push("no steps or checklists");
    if (lines > 500) { p -= 6; notes.push("over 500 lines; move detail to reference files"); }
    else if (b.length > 20000) { p -= 3; notes.push("very long"); }
    if (/\b(do not|don't|never|avoid)\b/i.test(b)) p += 2; else notes.push("no guardrails (what not to do)");
    add("body", "Instructions", p, 25, notes.length ? notes.join(", ") : "specific, structured, actionable");
  }

  // 4. Safety (15)
  const riskPts = { none: 15, low: 11, medium: 6, high: 2, critical: 0 }[risk] ?? 8;
  add("safety", "Safety", riskPts, 15, risk === "none" ? "no risky instructions found" : `${risk} risk findings`);

  // 5. Structure and references (10)
  {
    let p = 6;
    const notes = [];
    const broken = lintProblems.filter((x) => x.rule === "link.broken").length;
    if (broken) { p -= Math.min(4, broken * 2); notes.push(`${broken} broken link${broken > 1 ? "s" : ""}`); }
    const extras = files.filter((f) => !/^skill\.md$/i.test(f.path)).length;
    if (extras > 0 && /\]\(/.test(b)) p += 2;
    if (extras > 0 && !/\]\(/.test(b)) notes.push("extra files are never referenced from the body");
    if (extras === 0 && b.length > 12000) notes.push("long body with no reference files");
    if (extras > 0 && /\]\(/.test(b) && !notes.length) p += 2;
    add("structure", "Structure", p, 10, notes.length ? notes.join(", ") : "tidy");
  }

  const score = parts.reduce((s, x) => s + x.points, 0);
  const grade = score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : score >= 40 ? "D" : "F";
  return { score, grade, parts };
}
