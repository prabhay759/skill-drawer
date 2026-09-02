import fs from "node:fs";
import path from "node:path";
import { HOME, SKIP_WALK, exists, isDir, real, idFor, sha256, describeInstall, httpError, looksText, contained, drawerHome } from "./util.js";
import { parseFrontmatter } from "./frontmatter.js";
import { inferOrigin, resetOriginCache } from "./origin.js";
import { auditSkill } from "./audit.js";
import { lintSkill } from "./lint.js";
import { detectConflicts } from "./conflicts.js";
import { listStore } from "./store.js";

const SKIP_HOME_DOTDIRS = new Set([
  ".cache", ".local", ".npm", ".nvm", ".rustup", ".cargo", ".docker", ".mozilla",
  ".config", ".steam", ".var", ".wine", ".thumbnails", ".Trash", ".android",
  ".gradle", ".java", ".skill-drawer", ".vscode", ".vscode-server", ".ssh", ".gnupg",
]);

/** Folders that tools read project-local skills from, relative to a project root. */
export const PROJECT_SKILL_DIRS = [
  [".claude/skills", "claude"],
  [".agents/skills", "agents"],
  [".codex/skills", "codex"],
  [".cursor/skills", "cursor"],
  [".gemini/skills", "gemini"],
  [".github/skills", "github"],
  [".windsurf/skills", "windsurf"],
  [".kiro/skills", "kiro"],
  [".opencode/skills", "opencode"],
  [".copilot/skills", "copilot"],
  ["skills", "skills"],
];

const NAMED_SKILL_FILES = new Set(["skill.md", "SKILL.md"]);
const IGNORE_LOOSE_MD = new Set(["readme.md", "changelog.md", "license.md", "licence.md", "contributing.md"]);

function isSkillFileName(name) {
  if (NAMED_SKILL_FILES.has(name)) return true;
  if (!/\.md$/i.test(name)) return false;
  return !IGNORE_LOOSE_MD.has(name.toLowerCase());
}

export function findSkillFile(dir) {
  for (const name of ["SKILL.md", "skill.md"]) {
    const p = path.join(dir, name);
    if (exists(p) && !isDir(p)) return p;
  }
  return null;
}

/**
 * @typedef {{id:string,label:string,root:string,kind:'user'|'builtin'|'plugin'|'project'|'extra',scope:'user'|'project',recursive:boolean,writable:boolean}} Drawer
 */

export function discoverDrawers({ cwd = process.cwd(), extraRoots = [], project = true, home = HOME } = {}) {
  /** @type {Drawer[]} */
  const drawers = [];
  const seen = new Set();
  const add = (id, label, root, kind, scope, recursive = false, writable = true) => {
    if (!exists(root) || !isDir(root)) return;
    const resolved = real(root);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    drawers.push({ id, label, root: resolved, kind, scope, recursive, writable });
  };

  let homeEntries = [];
  try {
    homeEntries = fs.readdirSync(home, { withFileTypes: true });
  } catch {
    homeEntries = [];
  }
  for (const entry of homeEntries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (!entry.name.startsWith(".") || SKIP_HOME_DOTDIRS.has(entry.name)) continue;
    const base = path.join(home, entry.name);
    const id = entry.name.slice(1);
    for (const folder of ["skills", "skill"]) {
      add(id, `~/${entry.name}/${folder}`, path.join(base, folder), "user", "user");
    }
    if (entry.name === ".cursor") {
      add("cursor-builtin", "~/.cursor/skills-cursor", path.join(base, "skills-cursor"), "builtin", "user", false, false);
      add("cursor-plugins", "~/.cursor/plugins", path.join(base, "plugins"), "plugin", "user", true, false);
    }
    if (entry.name === ".claude") {
      add("claude-plugins", "~/.claude/plugins", path.join(base, "plugins"), "plugin", "user", true, false);
    }
    if (entry.name === ".codex") {
      add("codex-plugins", "~/.codex/plugins", path.join(base, "plugins"), "plugin", "user", true, false);
    }
  }
  add("gemini", "~/.gemini/antigravity/skills", path.join(home, ".gemini/antigravity/skills"), "user", "user");
  add("gemini", "~/.gemini/antigravity/global_skills", path.join(home, ".gemini/antigravity/global_skills"), "user", "user");

  if (project && cwd) {
    // Walk up from cwd; every ancestor may hold project-local drawers.
    let current = path.resolve(cwd);
    for (let i = 0; i < 12; i += 1) {
      if (current === home) break;
      for (const [rel, tool] of PROJECT_SKILL_DIRS) {
        const root = path.join(current, rel);
        const label = `${path.basename(current) || current}/${rel}`;
        add(`project:${tool}:${current}`, label, root, "project", "project");
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  for (const extra of extraRoots) {
    add(`extra:${extra}`, extra, extra, "extra", "project");
  }
  return drawers;
}

function collectDirectSkills(drawer, list, rootOverride) {
  const root = rootOverride || drawer.root;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_WALK.has(entry.name)) continue;
    const abs = path.resolve(path.join(root, entry.name));
    const install = describeInstall(abs);
    if (isDir(abs)) {
      const skillMd = findSkillFile(abs);
      if (skillMd) list.push({ dir: abs, skillMd, drawer, ...install, file: false });
      continue;
    }
    if (install.file && isSkillFileName(entry.name)) {
      list.push({ dir: abs, skillMd: abs, drawer, ...install, file: true });
    }
  }
}

function walkSkillContainers(dir, drawer, list, depth = 0) {
  if (depth > 14) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const base = path.basename(dir);
  if (base === "skills" || base === "skill") {
    collectDirectSkills(drawer, list, dir);
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (SKIP_WALK.has(entry.name)) continue;
    walkSkillContainers(path.join(dir, entry.name), drawer, list, depth + 1);
  }
}

export function dirFiles(dir) {
  try {
    const followed = fs.statSync(dir);
    if (followed.isFile()) {
      return { files: [{ path: path.basename(dir), size: followed.size, mtime: followed.mtimeMs }], bytes: followed.size };
    }
  } catch {
    /* walk as a directory */
  }
  const files = [];
  let bytes = 0;
  const walk = (current, rel, depth) => {
    if (depth > 8 || files.length > 400) return;
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_WALK.has(entry.name) || entry.isSymbolicLink()) continue;
      const abs = path.join(current, entry.name);
      const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(abs, nextRel, depth + 1);
      else if (entry.isFile()) {
        let size = 0;
        let mtime = 0;
        try {
          const st = fs.statSync(abs);
          size = st.size;
          mtime = st.mtimeMs;
          bytes += size;
        } catch {
          /* ignore */
        }
        files.push({ path: nextRel, size, mtime });
      }
    }
  };
  walk(dir, "", 0);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, bytes };
}

function summarize(item) {
  const { dir, skillMd, drawer } = item;
  let text = "";
  let raw;
  let st;
  try {
    st = fs.statSync(skillMd);
    raw = fs.readFileSync(skillMd);
    text = raw.toString("utf8");
  } catch {
    return null;
  }
  const fm = parseFrontmatter(text);
  const data = fm.data;
  const base = path.basename(dir);
  const slug = item.file ? base.replace(/\.md$/i, "") : base;
  const name =
    (typeof data.name === "string" && data.name) ||
    (typeof data.displayName === "string" && data.displayName) ||
    slug;
  const description = typeof data.description === "string" ? data.description : "";
  const audited = auditSkill({ root: dir, skillFile: skillMd, text, fileOnly: Boolean(item.file) });
  const { files, bytes } = dirFiles(dir);
  const lint = lintSkill({
    frontmatter: data,
    slug,
    body: fm.content,
    source: text,
    fileOnly: Boolean(item.file),
    present: fm.present,
    error: fm.error,
    files,
  });
  let dirStat = null;
  try {
    dirStat = fs.statSync(dir);
  } catch {
    dirStat = st;
  }
  return {
    id: idFor(dir),
    name,
    slug,
    description,
    frontmatter: data,
    frontmatterError: fm.error,
    drawerId: drawer.id,
    drawerLabel: drawer.label,
    kind: drawer.kind,
    scope: drawer.scope,
    writable: drawer.writable && !item.link,
    path: dir,
    skillFile: skillMd,
    skillRel: path.basename(skillMd),
    file: Boolean(item.file),
    link: Boolean(item.link),
    linkTarget: item.linkTarget || "",
    origin: inferOrigin(dir, data, item.linkTarget),
    contentHash: sha256(raw),
    risk: audited.severity,
    findings: audited.findings,
    lint: lint.status,
    lintProblems: lint.problems,
    copies: [],
    mtime: Math.max(st.mtimeMs, dirStat?.mtimeMs || 0),
    ctime: Math.min(st.birthtimeMs || st.ctimeMs, dirStat?.birthtimeMs || dirStat?.ctimeMs || Infinity),
    atime: st.atimeMs,
    skillSize: st.size,
    bytes,
    fileCount: files.length,
    disabled: false,
  };
}

function disabledSkills() {
  const out = [];
  for (const entry of listStore("disabled")) {
    const payload = entry.payloadPath;
    const install = describeInstall(payload);
    const skillMd = install.file ? payload : findSkillFile(payload);
    if (!skillMd) continue;
    const drawer = { id: entry.drawerId, label: entry.drawerLabel, kind: "user", scope: "user", writable: true };
    const summary = summarize({ dir: payload, skillMd, drawer, ...install, file: install.file });
    if (!summary) continue;
    summary.id = idFor(entry.originalPath);
    summary.disabled = true;
    summary.disabledEntry = entry.entryId;
    summary.disabledAt = entry.at;
    summary.originalPath = entry.originalPath;
    summary.writable = true;
    out.push(summary);
  }
  return out;
}

export function attachCopies(skills) {
  const byHash = new Map();
  for (const s of skills) {
    const list = byHash.get(s.contentHash) || [];
    list.push(s);
    byHash.set(s.contentHash, list);
  }
  for (const s of skills) {
    s.copies = (byHash.get(s.contentHash) || [])
      .filter((o) => o.id !== s.id)
      .map((o) => ({ id: o.id, drawerLabel: o.drawerLabel, path: o.path }));
  }
  return skills;
}

export function scanSkills(options = {}) {
  resetOriginCache();
  const drawers = discoverDrawers(options);
  const found = [];
  for (const drawer of drawers) {
    if (drawer.recursive) walkSkillContainers(drawer.root, drawer, found);
    else collectDirectSkills(drawer, found);
  }
  const byPath = new Map();
  for (const item of found) byPath.set(item.dir, item);

  const skills = [];
  for (const item of byPath.values()) {
    const summary = summarize(item);
    if (summary) skills.push(summary);
  }
  for (const s of disabledSkills()) skills.push(s);
  attachCopies(skills);
  skills.sort((a, b) => {
    const scope = a.drawerLabel.localeCompare(b.drawerLabel);
    return scope !== 0 ? scope : a.name.localeCompare(b.name);
  });
  const byId = new Map(skills.map((s) => [s.id, s]));
  const conflicts = detectConflicts(skills);
  return { drawers, skills, byId, conflicts, census: census(skills, conflicts) };
}

function census(skills, conflicts) {
  const active = skills.filter((s) => !s.disabled);
  const hashes = new Set(active.map((s) => s.contentHash));
  return {
    total: skills.length,
    active: active.length,
    disabled: skills.length - active.length,
    unique: hashes.size,
    duplicates: Math.max(0, active.length - hashes.size),
    lintErrors: skills.filter((s) => s.lint === "error").length,
    lintWarnings: skills.filter((s) => s.lint === "warning").length,
    risky: skills.filter((s) => ["high", "critical"].includes(s.risk)).length,
    conflicts: conflicts.length,
    trash: listStore("trash").length,
  };
}

export function toCatalogSkill(s) {
  return {
    id: s.id,
    name: s.name,
    slug: s.slug,
    description: s.description,
    drawerId: s.drawerId,
    drawerLabel: s.drawerLabel,
    kind: s.kind,
    scope: s.scope,
    writable: s.writable,
    path: s.path,
    skillRel: s.skillRel,
    file: s.file,
    link: s.link,
    linkTarget: s.linkTarget,
    origin: s.origin,
    risk: s.risk,
    lint: s.lint,
    lintCount: s.lintProblems.length,
    copyCount: s.copies.length,
    mtime: s.mtime,
    ctime: s.ctime,
    bytes: s.bytes,
    fileCount: s.fileCount,
    disabled: s.disabled,
    frontmatter: s.frontmatter,
  };
}

export function readSkill(summary) {
  const text = fs.readFileSync(summary.skillFile, "utf8");
  const fm = parseFrontmatter(text);
  const { files, bytes } = dirFiles(summary.path);
  return { ...summary, frontmatter: fm.data, frontmatterRaw: fm.raw, body: fm.content, source: text, files, bytes };
}

export function resolveSkillFile(summary, relPath) {
  if (summary.file) return { abs: real(summary.skillFile), rel: path.basename(summary.skillFile) };
  const normalized = path.normalize(relPath || "").replace(/^(\.\.(\/|\\|$))+/, "");
  const root = real(summary.path);
  const abs = path.resolve(root, normalized);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw httpError(400, "Path escapes skill directory");
  return { abs, rel: path.relative(root, abs) };
}

export function readSkillFile(summary, relPath) {
  const { abs, rel } = resolveSkillFile(summary, relPath);
  if (!exists(abs) || isDir(abs)) throw httpError(404, "File not found");
  const st = fs.statSync(abs);
  if (st.size > 1_500_000) throw httpError(413, "File too large to preview");
  const buf = fs.readFileSync(abs);
  const text = looksText(abs, buf);
  return { path: rel, size: st.size, binary: !text, content: text ? buf.toString("utf8") : null };
}

export function writeSkillFile(summary, relPath, content) {
  if (!summary.writable) throw httpError(403, "This skill is read-only (tool-managed or symlinked)");
  const { abs, rel } = resolveSkillFile(summary, relPath);
  if (isDir(abs)) throw httpError(400, "Target is a directory");
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
  return { path: rel, size: Buffer.byteLength(content, "utf8") };
}

export function assertMutable(summary, drawers) {
  const target = path.resolve(summary.path);
  const roots = [...drawers.map((d) => d.root), path.join(drawerHome(), "disabled")];
  const ok = roots.some((r) => contained(target, r) && path.resolve(r) !== target);
  if (!ok || target === HOME) {
    throw httpError(403, ok ? "Refusing to touch a drawer root" : "Skill is outside known drawers");
  }
  const install = describeInstall(target);
  const isFolderSkill = isDir(target) && findSkillFile(target);
  const isFileSkill = install.file && isSkillFileName(path.basename(target));
  if (!isFolderSkill && !isFileSkill) throw httpError(400, "Not a skill path");
  return target;
}
