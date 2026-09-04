/**
 * Agents: which tools read skills, where they keep them, and how to tell
 * whether a tool is installed on this machine.
 *
 * Detection signals per agent: a home dot-folder, a binary on PATH, or an
 * application folder. An agent is "installed" when any signal matches.
 *
 * `shared: true` marks a cross-tool convention (such as ~/.agents/skills)
 * rather than a product: it is listed only when it actually holds skills and
 * never gets an empty placeholder drawer.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadAgentSettings } from "./settings.js";
import { oneDrivePaths } from "./onedrive.js";

const BUILT_IN = [
  { id: "claude", label: "Claude", folders: [".claude"], bins: ["claude"], userSkills: ".claude/skills", projectSkills: [".claude/skills"] },
  { id: "copilot", label: "GitHub Copilot", folders: [".copilot"], bins: ["copilot", "github-copilot-cli"], apps: [".vscode/extensions"], appMatch: /github\.copilot/i, userSkills: ".copilot/skills", projectSkills: [".github/skills"] },
  {
    // Cowork keeps its skills in the user's OneDrive, not in a home dot-folder.
    id: "m365",
    label: "Microsoft Cowork",
    folders: [".m365", ".microsoft365agents", ".copilotstudio"],
    bins: ["m365", "atk", "pac"],
    userSkills: ".m365/skills",
    userSkillsPaths: (home, env) => oneDrivePaths("Documents/Cowork/Skills", { home, env }),
    projectSkills: [".m365/skills", ".microsoft365agents/skills", "appPackage/skills"],
  },
  { id: "cursor", label: "Cursor", folders: [".cursor"], bins: ["cursor"], userSkills: ".cursor/skills", projectSkills: [".cursor/skills"] },
  { id: "codex", label: "Codex", folders: [".codex"], bins: ["codex"], userSkills: ".codex/skills", projectSkills: [".codex/skills"] },
  { id: "gemini", label: "Gemini", folders: [".gemini"], bins: ["gemini"], userSkills: ".gemini/skills", projectSkills: [".gemini/skills"] },
  { id: "windsurf", label: "Windsurf", folders: [".windsurf", ".codeium"], bins: ["windsurf"], userSkills: ".windsurf/skills", projectSkills: [".windsurf/skills"] },
  { id: "kiro", label: "Kiro", folders: [".kiro"], bins: ["kiro"], userSkills: ".kiro/skills", projectSkills: [".kiro/skills"] },
  { id: "opencode", label: "OpenCode", folders: [".opencode", ".config/opencode"], bins: ["opencode"], userSkills: ".opencode/skills", projectSkills: [".opencode/skills"] },
  { id: "amp", label: "Amp", folders: [".amp", ".config/amp"], bins: ["amp"], userSkills: ".amp/skills", projectSkills: [".amp/skills"] },
  { id: "continue", label: "Continue", folders: [".continue"], bins: ["cn"], userSkills: ".continue/skills", projectSkills: [".continue/skills"] },
  { id: "cline", label: "Cline", folders: [".cline"], bins: ["cline"], userSkills: ".cline/skills", projectSkills: [".cline/skills"] },
  { id: "roo", label: "Roo Code", folders: [".roo"], bins: [], userSkills: ".roo/skills", projectSkills: [".roo/skills"] },
  { id: "aider", label: "Aider", folders: [".aider"], bins: ["aider"], userSkills: ".aider/skills", projectSkills: [] },
  { id: "goose", label: "Goose", folders: [".config/goose"], bins: ["goose"], userSkills: ".goose/skills", projectSkills: [] },
  { id: "zed", label: "Zed", folders: [".config/zed"], bins: ["zed"], userSkills: ".zed/skills", projectSkills: [] },
  { id: "junie", label: "Junie", folders: [".junie"], bins: [], userSkills: ".junie/skills", projectSkills: [".junie/skills"] },
  { id: "trae", label: "Trae", folders: [".trae"], bins: ["trae"], userSkills: ".trae/skills", projectSkills: [".trae/skills"] },
  { id: "qwen", label: "Qwen Code", folders: [".qwen"], bins: ["qwen"], userSkills: ".qwen/skills", projectSkills: [".qwen/skills"] },
  { id: "augment", label: "Augment", folders: [".augment"], bins: ["auggie"], userSkills: ".augment/skills", projectSkills: [".augment/skills"] },
  { id: "vscode", label: "VS Code", folders: [], bins: ["code"], userSkills: "", projectSkills: [] },
];

/** Built-ins plus the user's custom agents. */
export function allAgents(settings = loadAgentSettings()) {
  const custom = (settings.custom || []).map((c) => ({
    id: c.id,
    label: c.label || c.id,
    custom: true,
    folders: [],
    bins: [],
    userSkillsAbs: c.userSkills,
    userSkills: c.userSkills,
    projectSkills: c.projectSkills || [],
  }));
  const byId = new Map(BUILT_IN.map((a) => [a.id, a]));
  for (const c of custom) byId.set(c.id, { ...(byId.get(c.id) || {}), ...c });
  return [...byId.values()];
}

/**
 * Every folder this agent might keep user-level skills in, most likely first.
 * Absolute for custom agents and for agents that resolve their own paths
 * (Cowork looks inside OneDrive); otherwise relative to the home directory.
 */
export function resolveUserSkills(agent, home = os.homedir(), env = process.env) {
  if (agent.userSkillsAbs) return [path.resolve(agent.userSkillsAbs)];
  if (typeof agent.userSkillsPaths === "function") {
    const found = agent.userSkillsPaths(home, env) || [];
    if (found.length) return found.map((p) => path.resolve(p));
  }
  return agent.userSkills ? [path.join(home, agent.userSkills)] : [];
}

function folderIndex(agents) {
  const map = new Map();
  const put = (folder, agent) => {
    const key = String(folder || "").split("/")[0].toLowerCase();
    if (key && !map.has(key)) map.set(key, agent);
  };
  for (const a of agents) {
    for (const f of a.folders || []) put(f, a);
    if (a.userSkills && !a.userSkillsAbs) put(a.userSkills, a);
    for (const p of a.projectSkills || []) put(p, a);
  }
  const copilot = agents.find((a) => a.id === "copilot");
  if (copilot) map.set(".github", copilot);
  const vscode = agents.find((a) => a.id === "vscode");
  if (vscode) map.set(".vscode", vscode);
  return map;
}

const pick = (a) => ({ id: a.id, label: a.label });

export function agentForFolder(folderName, agents = allAgents()) {
  const raw = String(folderName || "");
  const key = raw.startsWith(".") ? raw : `.${raw}`;
  const hit = folderIndex(agents).get(key.toLowerCase());
  if (hit) return pick(hit);
  const bare = key.slice(1).toLowerCase();
  if (bare === "skills") return { id: "project", label: "Project (bare skills/)" };
  if (!bare) return { id: "other", label: "Other" };
  return { id: bare, label: bare.charAt(0).toUpperCase() + bare.slice(1) };
}

/** Agent for an arbitrary drawer root path: first dot-folder segment wins. */
export function agentForPath(root, agents = allAgents()) {
  const resolved = path.resolve(String(root));
  for (const a of agents) {
    if (a.userSkillsAbs && path.resolve(a.userSkillsAbs) === resolved) return pick(a);
  }
  const parts = String(root).split(/[\\/]+/).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    if (parts[i].startsWith(".") && parts[i].length > 1) return agentForFolder(parts[i], agents);
  }
  if (parts[parts.length - 1] === "skills") return { id: "project", label: "Project (bare skills/)" };
  return { id: "other", label: "Other" };
}

function onPath(bin, envPath) {
  const exts = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const dir of String(envPath || "").split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      try {
        const p = path.join(dir, bin + ext);
        if (fs.statSync(p).isFile()) return p;
      } catch {
        /* next */
      }
    }
  }
  return null;
}

function appMatch(home, a) {
  if (!a.apps) return null;
  for (const rel of a.apps) {
    const dir = path.join(home, rel);
    try {
      const entries = fs.readdirSync(dir);
      const hit = entries.find((e) => a.appMatch.test(e));
      if (hit) return path.join(dir, hit);
    } catch {
      /* missing */
    }
  }
  return null;
}

/**
 * Which agents are present on this machine, with the evidence.
 * Hidden agents are returned with `hidden: true` so settings can show them.
 */
export function detectAgents({ home = os.homedir(), envPath = process.env.PATH, env = process.env, settings = loadAgentSettings() } = {}) {
  const hidden = new Set(settings.hidden || []);
  const envForAgent = env;
  return allAgents(settings).map((a) => {
    const via = [];
    for (const f of a.folders || []) {
      try {
        if (fs.statSync(path.join(home, f)).isDirectory()) via.push(`~/${f}`);
      } catch {
        /* missing */
      }
    }
    for (const b of a.bins || []) {
      if (onPath(b, envPath)) via.push(`${b} on PATH`);
    }
    const app = appMatch(home, a);
    if (app) via.push(path.relative(home, app).replace(/\\/g, "/"));
    const candidates = resolveUserSkills(a, home, envForAgent);
    const present = candidates.filter((p) => {
      try {
        return fs.statSync(p).isDirectory();
      } catch {
        return false;
      }
    });
    // A skills folder that exists is itself proof the tool is in use — the
    // only signal for agents like Cowork that keep nothing in a dot-folder.
    // Only report it when nothing else already found the tool.
    if (!via.length) {
      for (const p of present) via.push(p.startsWith(home) ? `~/${path.relative(home, p).replace(/\\/g, "/")}` : p);
    }
    const userSkills = present[0] || candidates[0] || null;
    return {
      id: a.id,
      label: a.label,
      installed: via.length > 0,
      shared: Boolean(a.shared),
      custom: Boolean(a.custom),
      hidden: hidden.has(a.id),
      via,
      userSkills,
      userSkillsAll: candidates,
      projectSkills: a.projectSkills || [],
    };
  });
}

export const KNOWN_AGENTS = BUILT_IN;
