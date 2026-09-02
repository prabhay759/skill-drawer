/**
 * User settings for the agent list: which agents to hide, and extra agents
 * the user defines themselves. Stored in ~/.skill-drawer/agents.json.
 */
import path from "node:path";
import os from "node:os";
import { drawerHome, readJson, writeJson, httpError } from "./util.js";

function file() {
  return path.join(drawerHome(), "agents.json");
}

const EMPTY = { hidden: [], custom: [] };

export function loadAgentSettings() {
  const raw = readJson(file(), null) || {};
  return {
    hidden: Array.isArray(raw.hidden) ? raw.hidden.map(String) : [],
    custom: Array.isArray(raw.custom) ? raw.custom.filter((c) => c && typeof c.id === "string") : [],
  };
}

function expand(p) {
  const t = String(p || "").trim();
  if (!t) return "";
  return t.startsWith("~") ? path.join(os.homedir(), t.slice(1)) : t;
}

export function saveAgentSettings(patch) {
  const next = { ...EMPTY, ...loadAgentSettings() };
  if (Array.isArray(patch?.hidden)) next.hidden = [...new Set(patch.hidden.map(String))];
  if (Array.isArray(patch?.custom)) {
    next.custom = patch.custom.map((c) => {
      const id = String(c.id || "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
      if (!id) throw httpError(400, "Each custom agent needs an id");
      const userSkills = expand(c.userSkills);
      if (!userSkills) throw httpError(400, `Custom agent "${id}" needs a skills folder`);
      if (!path.isAbsolute(userSkills)) throw httpError(400, `The skills folder for "${id}" must be an absolute path`);
      const projectSkills = Array.isArray(c.projectSkills)
        ? c.projectSkills.map((s) => String(s).replace(/^[\\/]+/, "").trim()).filter(Boolean)
        : [];
      return { id, label: String(c.label || id).slice(0, 60), userSkills, projectSkills, custom: true };
    });
  }
  writeJson(file(), next);
  return next;
}
