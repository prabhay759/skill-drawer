/**
 * Install skills from a GitHub repository (owner/repo[@ref][/subpath] or URL)
 * or from a local folder into a drawer.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseGithubSource } from "./origin.js";
import { findSkillFile } from "./scan.js";
import { exists, httpError, SKIP_WALK, isDir } from "./util.js";

function findSkillDirs(root, depth = 0, out = []) {
  if (depth > 6 || out.length > 200) return out;
  if (findSkillFile(root)) {
    out.push(root);
    return out;
  }
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_WALK.has(entry.name)) continue;
    findSkillDirs(path.join(root, entry.name), depth + 1, out);
  }
  return out;
}

function cloneGithub(spec, tmp) {
  const url = `https://github.com/${spec.owner}/${spec.repo}.git`;
  const args = ["clone", "--depth", "1", "--quiet"];
  if (spec.ref) args.push("--branch", spec.ref);
  args.push(url, tmp);
  const res = spawnSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (res.error?.code === "ENOENT") throw httpError(500, "git is not installed; it is required to install from GitHub");
  if (res.status !== 0) throw httpError(502, `git clone failed: ${(res.stderr || "").trim().split("\n").pop() || "unknown error"}`);
}

/**
 * @param {string} source  owner/repo, owner/repo/path, github URL or local path
 * @param {{drawerRoot:string, overwrite?:boolean, only?:string[]}} opts
 */
export function installSkills(source, { drawerRoot, overwrite = false, only = null }) {
  if (!drawerRoot) throw httpError(400, "A target drawer is required");
  const text = String(source || "").trim();
  if (!text) throw httpError(400, "Missing source");
  let base;
  let cleanup = null;
  let origin = null;
  const local = text.replace(/^~(?=$|\/)/, os.homedir());
  if (exists(local) && isDir(local)) {
    base = path.resolve(local);
  } else {
    const spec = parseGithubSource(text);
    if (!spec) throw httpError(400, "Source must be a local folder, owner/repo, owner/repo/path or a GitHub URL");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skill-drawer-"));
    cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });
    cloneGithub(spec, tmp);
    base = spec.subpath ? path.join(tmp, spec.subpath) : tmp;
    if (!exists(base)) {
      cleanup();
      throw httpError(404, `Path ${spec.subpath} not found in ${spec.owner}/${spec.repo}`);
    }
    origin = `https://github.com/${spec.owner}/${spec.repo}`;
  }
  try {
    const dirs = findSkillDirs(base);
    if (!dirs.length) throw httpError(404, "No SKILL.md found in the source");
    fs.mkdirSync(drawerRoot, { recursive: true });
    const installed = [];
    const skipped = [];
    for (const dir of dirs) {
      const slug = path.basename(dir);
      if (only && !only.includes(slug)) continue;
      const dest = path.join(drawerRoot, slug);
      if (exists(dest) && !overwrite) {
        skipped.push({ slug, reason: `already exists at ${dest}` });
        continue;
      }
      if (exists(dest)) fs.rmSync(dest, { recursive: true, force: true });
      fs.cpSync(dir, dest, {
        recursive: true,
        filter: (src) => !SKIP_WALK.has(path.basename(src)) || src === dir,
      });
      installed.push({ slug, path: dest, origin });
    }
    return { installed, skipped, available: dirs.map((d) => path.basename(d)) };
  } finally {
    if (cleanup) cleanup();
  }
}
