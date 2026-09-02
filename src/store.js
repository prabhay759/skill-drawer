/**
 * Trash (soft delete) and Disabled (quarantine) stores under ~/.skill-drawer.
 * Each entry is a folder: <store>/<entryId>/meta.json + payload (dir, file or symlink).
 */
import fs from "node:fs";
import path from "node:path";
import { drawerHome, exists, movePath, removePath, readJson, writeJson, describeInstall, nowStamp, httpError } from "./util.js";

function storeDir(kind) {
  return path.join(drawerHome(), kind);
}

function payloadPath(kind, entryId, meta) {
  return path.join(storeDir(kind), entryId, meta?.payload || "payload");
}

export function listStore(kind) {
  const dir = storeDir(kind);
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const meta = readJson(path.join(dir, entry.name, "meta.json"));
    if (!meta) continue;
    out.push({ ...meta, entryId: entry.name, payloadPath: payloadPath(kind, entry.name, meta) });
  }
  out.sort((a, b) => (b.at || 0) - (a.at || 0));
  return out;
}

export function getEntry(kind, entryId) {
  const meta = readJson(path.join(storeDir(kind), entryId, "meta.json"));
  if (!meta) return null;
  return { ...meta, entryId, payloadPath: payloadPath(kind, entryId, meta) };
}

/**
 * Move a skill (folder, file or symlink) into a store.
 * @param {"trash"|"disabled"} kind
 * @param {{path:string,name:string,slug:string,drawerId:string,drawerLabel:string,file:boolean}} skill
 */
export function stash(kind, skill, extra = {}) {
  const source = path.resolve(skill.path);
  if (!exists(source) && !describeInstall(source).link) {
    throw httpError(404, "Skill path no longer exists");
  }
  const install = describeInstall(source);
  const entryId = `${nowStamp()}-${skill.slug || path.basename(source)}`.replace(/[^\w.-]+/g, "-");
  const entryDir = path.join(storeDir(kind), entryId);
  fs.mkdirSync(entryDir, { recursive: true });
  const payloadName = install.file || install.link ? path.basename(source) : "payload";
  const meta = {
    id: skill.id,
    name: skill.name,
    slug: skill.slug,
    originalPath: source,
    drawerId: skill.drawerId,
    drawerLabel: skill.drawerLabel,
    type: install.link ? "link" : install.file ? "file" : "dir",
    linkTarget: install.linkTarget || "",
    payload: payloadName,
    at: Date.now(),
    ...extra,
  };
  const dest = path.join(entryDir, payloadName);
  if (install.link) {
    fs.symlinkSync(install.linkTarget, dest);
    fs.unlinkSync(source);
  } else {
    movePath(source, dest);
  }
  writeJson(path.join(entryDir, "meta.json"), meta);
  return { ...meta, entryId, payloadPath: dest };
}

/** Move a stored entry back to its original path (or a new target). */
export function restore(kind, entryId, { target } = {}) {
  const entry = getEntry(kind, entryId);
  if (!entry) throw httpError(404, "Entry not found");
  const dest = path.resolve(target || entry.originalPath);
  if (exists(dest) || describeInstall(dest).link) {
    throw httpError(409, `Something already exists at ${dest}; remove it or restore elsewhere`);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (entry.type === "link") {
    fs.symlinkSync(entry.linkTarget, dest);
    fs.unlinkSync(entry.payloadPath);
  } else {
    movePath(entry.payloadPath, dest);
  }
  fs.rmSync(path.join(storeDir(kind), entryId), { recursive: true, force: true });
  return { ...entry, restoredTo: dest };
}

export function purge(kind, entryId) {
  const entry = getEntry(kind, entryId);
  if (!entry) throw httpError(404, "Entry not found");
  fs.rmSync(path.join(storeDir(kind), entryId), { recursive: true, force: true });
  return entry;
}

export function purgeAll(kind) {
  const entries = listStore(kind);
  for (const entry of entries) removePath(path.join(storeDir(kind), entry.entryId));
  return entries.length;
}

export function storeRoot(kind) {
  return storeDir(kind);
}
