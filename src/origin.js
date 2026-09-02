import fs from "node:fs";
import path from "node:path";
import { HOME } from "./util.js";

function githubFromString(raw) {
  if (!raw) return null;
  const text = String(raw).trim().replace(/^["']|["']$/g, "");
  const match = text.match(
    /(?:https?:\/\/|git@|ssh:\/\/git@)github\.com[:/]+([^\s#?]+)/i,
  );
  if (match) {
    const parts = match[1].replace(/\.git$/i, "").split("/").filter(Boolean);
    if (parts.length >= 2) {
      const spec = `${parts[0]}/${parts[1]}`;
      return { kind: "github", label: spec, url: `https://github.com/${spec}` };
    }
  }
  if (/^[\w.-]+\/[\w.-]+$/.test(text)) {
    return { kind: "github", label: text, url: `https://github.com/${text}` };
  }
  return null;
}

function originFromText(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const github = githubFromString(raw);
  if (github) return github;
  const text = raw.trim().replace(/^["']|["']$/g, "");
  if (!/^https?:\/\//i.test(text)) return null;
  try {
    const parsed = new URL(text);
    const label = `${parsed.host}${parsed.pathname}`.replace(/\/+$/, "");
    return { kind: "url", label, url: parsed.href };
  } catch {
    return null;
  }
}

function originFromValue(value) {
  if (typeof value === "string") return originFromText(value);
  if (value && typeof value === "object" && typeof value.url === "string") {
    return originFromText(value.url);
  }
  return null;
}

function withOrigin(origin, via, certainty) {
  return origin ? { ...origin, via, certainty } : null;
}

function originFromFrontmatter(data) {
  const meta =
    data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)
      ? data.metadata
      : {};
  for (const key of ["source", "repository"]) {
    const found = originFromValue(data[key]) || originFromValue(meta[key]);
    if (found) return withOrigin(found, "frontmatter", "attested");
  }
  for (const key of ["homepage", "url"]) {
    const found = originFromValue(data[key]) || originFromValue(meta[key]);
    if (found?.kind === "github") return withOrigin(found, "frontmatter", "attested");
  }
  return null;
}

function originFromPath(p) {
  const norm = p.replace(/\\/g, "/");
  const nested = norm.match(/\/github\.com\/([^/]+)\/([^/]+)/);
  if (nested && nested[1] !== "www") {
    return withOrigin(
      {
        kind: "github",
        label: `${nested[1]}/${nested[2]}`,
        url: `https://github.com/${nested[1]}/${nested[2]}`,
      },
      "path",
      "attested",
    );
  }
  return null;
}

const PLUGIN_JSON = [
  ["plugin.json"],
  [".cursor-plugin", "plugin.json"],
  [".claude-plugin", "plugin.json"],
  [".plugin", "plugin.json"],
];

function originFromPluginFile(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const repo = originFromValue(data.repository);
    if (repo) return repo;
    const home = originFromText(data.homepage);
    return home?.kind === "github" ? home : null;
  } catch {
    return null;
  }
}

function originFromGitDir(dir) {
  const gitPath = path.join(dir, ".git");
  try {
    const listed = fs.lstatSync(gitPath);
    let configPath = "";
    if (listed.isFile()) {
      const text = fs.readFileSync(gitPath, "utf8");
      const marker = text.match(/gitdir:\s*(.+)/i);
      if (!marker) return null;
      let gitdir = marker[1].trim();
      if (!path.isAbsolute(gitdir)) gitdir = path.resolve(dir, gitdir);
      configPath = path.join(gitdir, "config");
    } else if (listed.isDirectory()) {
      configPath = path.join(gitPath, "config");
    } else {
      return null;
    }
    const config = fs.readFileSync(configPath, "utf8");
    const url = config.match(/\[remote "origin"\][\s\S]*?url\s*=\s*(\S+)/);
    return url ? originFromText(url[1].replace(/^["']|["']$/g, "")) : null;
  } catch {
    return null;
  }
}

let originCache = new Map();
export function resetOriginCache() {
  originCache = new Map();
}

function originStartDir(start) {
  const resolved = path.resolve(start);
  try {
    const st = fs.statSync(resolved);
    if (st.isFile()) return path.dirname(resolved);
  } catch {
    /* missing */
  }
  return resolved;
}

function fromCachedOrigin(hit, startDir) {
  if (!hit) return null;
  const here = path.resolve(hit.at) === path.resolve(startDir);
  return withOrigin(hit.origin, hit.via, here ? "attested" : "inferred");
}

function originFromAncestors(start) {
  const chain = [];
  let current = originStartDir(start);
  const startDir = current;
  for (let i = 0; i < 14; i += 1) {
    if (originCache.has(current)) {
      const hit = originCache.get(current);
      for (const dir of chain) originCache.set(dir, hit);
      return fromCachedOrigin(hit, startDir);
    }
    chain.push(current);
    for (const parts of PLUGIN_JSON) {
      const found = originFromPluginFile(path.join(current, ...parts));
      if (found) {
        const packed = { origin: found, via: "plugin", at: current };
        for (const dir of chain) originCache.set(dir, packed);
        return fromCachedOrigin(packed, startDir);
      }
    }
    const git = originFromGitDir(current);
    if (git) {
      const packed = { origin: git, via: "git", at: current };
      for (const dir of chain) originCache.set(dir, packed);
      return fromCachedOrigin(packed, startDir);
    }
    const parent = path.dirname(current);
    if (parent === current || parent === HOME) break;
    current = parent;
  }
  for (const dir of chain) originCache.set(dir, null);
  return null;
}

export function inferOrigin(dir, data, linkTarget) {
  const yaml = originFromFrontmatter(data || {});
  if (yaml) return yaml;
  const fromHere = originFromPath(dir);
  if (fromHere) return fromHere;
  if (linkTarget) {
    const resolved = path.isAbsolute(linkTarget)
      ? path.resolve(linkTarget)
      : path.resolve(path.dirname(dir), linkTarget);
    const fromLink = originFromPath(resolved) || originFromAncestors(resolved);
    if (fromLink) return fromLink;
  }
  return originFromAncestors(dir);
}

export function parseGithubSource(text) {
  const t = String(text || "").trim();
  const url = t.match(
    /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([^/]+))?(?:\/(.*))?$/i,
  );
  if (url) {
    return { owner: url[1], repo: url[2], ref: url[3] || "", subpath: url[4] || "" };
  }
  const short = t.match(/^(?:github:)?([\w.-]+)\/([\w.-]+)(?:@([\w.-]+))?(?:\/(.*))?$/);
  if (short) {
    return { owner: short[1], repo: short[2], ref: short[3] || "", subpath: short[4] || "" };
  }
  return null;
}
