/**
 * Locate the user's OneDrive roots.
 *
 * The OneDrive client exports env vars (`OneDriveConsumer` for a personal
 * account, `OneDriveCommercial` for a work one, `OneDrive` for whichever is
 * primary). Those are only present in a session the client has touched, so we
 * also look on disk: `~/OneDrive` and `~/OneDrive - <Org>` on Windows, and
 * `~/Library/CloudStorage/OneDrive-*` on macOS.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function dirsMatching(parent, re) {
  try {
    return fs
      .readdirSync(parent, { withFileTypes: true })
      .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && re.test(e.name))
      .map((e) => path.join(parent, e.name));
  } catch {
    return [];
  }
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * @returns {{roots: string[], existing: string[]}} candidates in preference
 * order, and the subset that is actually on disk.
 */
export function oneDriveRoots({ home = os.homedir(), env = process.env } = {}) {
  const roots = [];
  const add = (p) => {
    if (!p) return;
    const resolved = path.resolve(p);
    if (!roots.includes(resolved)) roots.push(resolved);
  };
  // A personal account first: that is what "personal OneDrive" means here.
  add(env.OneDriveConsumer);
  add(env.OneDrive);
  add(env.OneDriveCommercial);
  add(path.join(home, "OneDrive"));
  for (const d of dirsMatching(home, /^OneDrive(\s*-.*)?$/i)) add(d);
  for (const d of dirsMatching(path.join(home, "Library", "CloudStorage"), /^OneDrive/i)) add(d);
  return { roots, existing: roots.filter(isDir) };
}

/**
 * Where a OneDrive-synced app keeps files, e.g. "Documents/Cowork/Skills".
 * Includes the plain `~/Documents/...` path, because Known Folder Move can
 * redirect Documents into OneDrive and leave the usual path working.
 */
export function oneDrivePaths(relative, { home = os.homedir(), env = process.env } = {}) {
  const rel = String(relative).split(/[\\/]+/).filter(Boolean);
  const { roots, existing } = oneDriveRoots({ home, env });
  const out = [];
  const add = (p) => {
    if (p && !out.includes(p)) out.push(p);
  };
  for (const root of existing) add(path.join(root, ...rel));
  add(path.join(home, ...rel));
  for (const root of roots) add(path.join(root, ...rel));
  return out;
}
