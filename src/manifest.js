/**
 * Export a drawer set as a manifest (what/where/origin) or a bundle
 * (manifest + file contents), and import either back.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dirFiles } from "./scan.js";
import { exists, httpError, looksText, slugify } from "./util.js";

export const MANIFEST_FORMAT = "skill-drawer-manifest";
export const BUNDLE_FORMAT = "skill-drawer-bundle";
const MAX_BUNDLE_FILE = 2_000_000;

function manifestEntry(s) {
  return {
    name: s.name,
    slug: s.slug,
    description: s.description,
    drawer: s.drawerLabel,
    drawerId: s.drawerId,
    path: s.path,
    file: s.file,
    disabled: Boolean(s.disabled),
    origin: s.origin ? { kind: s.origin.kind, url: s.origin.url, label: s.origin.label } : null,
    contentHash: s.contentHash,
    mtime: s.mtime,
  };
}

export function exportManifest(skills, { includeFiles = false } = {}) {
  const out = {
    format: includeFiles ? BUNDLE_FORMAT : MANIFEST_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    host: os.hostname(),
    tool: "skill-drawer",
    skills: [],
  };
  for (const s of skills) {
    const entry = manifestEntry(s);
    if (includeFiles) {
      entry.files = [];
      const { files } = dirFiles(s.path);
      for (const f of files) {
        if (f.size > MAX_BUNDLE_FILE) continue;
        const abs = s.file ? s.path : path.join(s.path, f.path);
        let buf;
        try {
          buf = fs.readFileSync(abs);
        } catch {
          continue;
        }
        const text = looksText(abs, buf);
        entry.files.push({
          path: f.path,
          encoding: text ? "utf8" : "base64",
          content: text ? buf.toString("utf8") : buf.toString("base64"),
        });
      }
    }
    out.skills.push(entry);
  }
  return out;
}

export function parseManifest(input) {
  const data = typeof input === "string" ? JSON.parse(input) : input;
  if (!data || typeof data !== "object" || !Array.isArray(data.skills)) {
    throw httpError(400, "Not a skill-drawer manifest or bundle");
  }
  if (data.format !== MANIFEST_FORMAT && data.format !== BUNDLE_FORMAT) {
    throw httpError(400, `Unknown manifest format: ${data.format}`);
  }
  return data;
}

/**
 * Write bundle entries into a drawer root. Manifest-only entries are returned
 * as "needs-install" with their origin so the caller can fetch them.
 */
export function importManifest(data, { drawerRoot, overwrite = false, only = null }) {
  if (!drawerRoot) throw httpError(400, "A target drawer is required");
  fs.mkdirSync(drawerRoot, { recursive: true });
  const written = [];
  const skipped = [];
  const needsInstall = [];
  for (const entry of data.skills) {
    if (only && !only.includes(entry.slug) && !only.includes(entry.name)) continue;
    const slug = slugify(entry.slug || entry.name);
    if (!slug) {
      skipped.push({ name: entry.name, reason: "no usable name" });
      continue;
    }
    if (!Array.isArray(entry.files) || !entry.files.length) {
      if (entry.origin?.kind === "github") needsInstall.push({ name: entry.name, slug, origin: entry.origin });
      else skipped.push({ name: entry.name, reason: "manifest has no file contents and no GitHub origin" });
      continue;
    }
    const dest = entry.file ? path.join(drawerRoot, `${slug}.md`) : path.join(drawerRoot, slug);
    if (exists(dest) && !overwrite) {
      skipped.push({ name: entry.name, reason: `already exists at ${dest}` });
      continue;
    }
    if (exists(dest)) fs.rmSync(dest, { recursive: true, force: true });
    for (const f of entry.files) {
      const rel = path.normalize(f.path).replace(/^(\.\.(\/|\\|$))+/, "");
      const abs = entry.file ? dest : path.resolve(dest, rel);
      if (!entry.file && !abs.startsWith(path.resolve(dest) + path.sep)) continue;
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      const buf = f.encoding === "base64" ? Buffer.from(f.content, "base64") : Buffer.from(String(f.content), "utf8");
      fs.writeFileSync(abs, buf);
    }
    written.push({ name: entry.name, slug, path: dest });
  }
  return { written, skipped, needsInstall };
}
