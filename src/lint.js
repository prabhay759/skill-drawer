/**
 * Frontmatter + structure validation for a skill. Follows the agentskills
 * SKILL.md conventions (name, description, optional license/compatibility/
 * metadata/allowed-tools) and flags things that make a skill fail to load.
 */
const KNOWN_KEYS = new Set([
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
  "allowedTools",
  "version",
  "author",
  "tags",
  "disable-model-invocation",
  "user-invocable",
  "argument-hint",
  "model",
  "context",
  "agent",
  "hooks",
  "when_to_use",
  "displayName",
  "globs",
  "alwaysApply",
]);

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_DESCRIPTION = 1024;
const MAX_NAME = 64;
const MAX_LINES = 500;
const MAX_BYTES = 200_000;

export const LINT_LEVELS = { error: 3, warning: 2, info: 1, ok: 0 };

export function lintSkill({ frontmatter, slug, body, source, fileOnly, present, error, files }) {
  const problems = [];
  const push = (level, rule, message) => problems.push({ level, rule, message });
  const fm = frontmatter || {};

  if (!present) {
    push("error", "frontmatter.missing", "SKILL.md has no YAML frontmatter");
  } else if (error) {
    push("error", "frontmatter.invalid", error);
  }

  const name = fm.name;
  if (name === undefined || name === null || name === "") {
    push("error", "name.missing", "Frontmatter is missing `name`");
  } else if (typeof name !== "string") {
    push("error", "name.type", "`name` must be a string");
  } else {
    if (name.length > MAX_NAME) push("error", "name.length", `\`name\` is longer than ${MAX_NAME} characters`);
    if (!NAME_RE.test(name)) {
      push("warning", "name.format", "`name` should be lowercase letters, digits and single hyphens");
    }
    if (!fileOnly && slug && name !== slug) {
      push("warning", "name.mismatch", `\`name\` (${name}) does not match the folder name (${slug})`);
    }
  }

  const description = fm.description;
  if (description === undefined || description === null || description === "") {
    push("error", "description.missing", "Frontmatter is missing `description` (agents use it to decide when to load the skill)");
  } else if (typeof description !== "string") {
    push("error", "description.type", "`description` must be a string");
  } else {
    if (description.length > MAX_DESCRIPTION) {
      push("error", "description.length", `\`description\` is ${description.length} characters; the limit is ${MAX_DESCRIPTION}`);
    } else if (description.length < 20) {
      push("info", "description.short", "`description` is very short; say what the skill does and when to use it");
    }
    if (/<[a-z][^>]*>/i.test(description)) push("warning", "description.html", "`description` contains HTML/XML tags");
  }

  if (fm.compatibility !== undefined && typeof fm.compatibility === "string" && fm.compatibility.length > 500) {
    push("warning", "compatibility.length", "`compatibility` is longer than 500 characters");
  }
  if (fm.metadata !== undefined && (typeof fm.metadata !== "object" || Array.isArray(fm.metadata))) {
    push("warning", "metadata.type", "`metadata` should be a mapping of string keys to string values");
  }
  for (const key of Object.keys(fm)) {
    if (key.startsWith("_")) continue;
    if (!KNOWN_KEYS.has(key)) push("info", "key.unknown", `Unrecognised frontmatter key \`${key}\``);
  }

  const bodyText = String(body || "");
  if (!bodyText.trim()) {
    push("warning", "body.empty", "Skill body is empty; the agent gets no instructions");
  }
  const lines = String(source || "").split("\n").length;
  if (lines > MAX_LINES) {
    push("warning", "body.long", `SKILL.md is ${lines} lines; keep it under ${MAX_LINES} and move detail into reference files`);
  }
  const bytes = Buffer.byteLength(String(source || ""), "utf8");
  if (bytes > MAX_BYTES) push("warning", "body.large", `SKILL.md is ${Math.round(bytes / 1024)} KB`);

  if (Array.isArray(files)) {
    const names = new Set(files.map((f) => f.path));
    const linkRe = /\]\((?!https?:|mailto:|#)([^)\s]+)\)/g;
    let m;
    const missing = new Set();
    while ((m = linkRe.exec(bodyText))) {
      const target = m[1].replace(/^\.\//, "").split("#")[0];
      if (!target || target.startsWith("/") || target.startsWith("..")) continue;
      if (!names.has(target) && !files.some((f) => f.path.startsWith(target + "/"))) missing.add(target);
    }
    for (const target of missing) {
      push("warning", "link.broken", `Body links to \`${target}\` but that file is not in the skill folder`);
    }
  }

  const levelOf = (p) => LINT_LEVELS[p.level];
  problems.sort((a, b) => levelOf(b) - levelOf(a));
  const worst = problems.reduce((acc, p) => (levelOf(p) > LINT_LEVELS[acc] ? p.level : acc), "ok");
  return { status: worst, problems };
}
