import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export const HOME = os.homedir();

export function drawerHome() {
  return process.env.SKILL_DRAWER_HOME || path.join(HOME, ".skill-drawer");
}

export function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

export function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

export function real(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

export function idFor(absPath) {
  return crypto.createHash("sha1").update(absPath).digest("hex").slice(0, 16);
}

export function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export function contained(child, parent) {
  const c = path.resolve(child);
  const p = path.resolve(parent);
  return c === p || c.startsWith(p + path.sep);
}

export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

export function describeInstall(p) {
  let link = false;
  let file = false;
  let linkTarget = "";
  try {
    const listed = fs.lstatSync(p);
    link = listed.isSymbolicLink();
    if (link) {
      try {
        linkTarget = fs.readlinkSync(p);
      } catch {
        linkTarget = "";
      }
      try {
        file = fs.statSync(p).isFile();
      } catch {
        file = false;
      }
    } else {
      file = listed.isFile();
    }
  } catch {
    /* missing or unreadable */
  }
  return { link, file, linkTarget };
}

/** Move a path across devices safely: rename first, copy+remove on EXDEV. */
export function movePath(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
    return;
  } catch (err) {
    if (err.code !== "EXDEV") throw err;
  }
  const st = fs.lstatSync(from);
  if (st.isSymbolicLink()) {
    fs.symlinkSync(fs.readlinkSync(from), to);
    fs.unlinkSync(from);
    return;
  }
  fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true });
  fs.rmSync(from, { recursive: true, force: true });
}

export function removePath(target) {
  let st;
  try {
    st = fs.lstatSync(target);
  } catch {
    return;
  }
  if (st.isSymbolicLink() || st.isFile()) {
    fs.unlinkSync(target);
    return;
  }
  fs.rmSync(target, { recursive: true, force: true });
}

export const SKIP_WALK = new Set([
  "node_modules",
  ".git",
  "dist",
  ".cache",
  "upstream",
  "__pycache__",
  ".venv",
  "venv",
]);

export const TEXT_EXT =
  /\.(md|mdx|txt|ya?ml|json|jsonc|js|mjs|cjs|ts|tsx|jsx|py|sh|bash|zsh|fish|ps1|html|css|svg|toml|xml|csv|rst|ini|cfg|env|gitignore|lock)$/i;

export function looksText(abs, buf) {
  if (buf.includes(0)) return false;
  return TEXT_EXT.test(abs) || !path.extname(abs);
}

export function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 64);
}

export function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
