/**
 * Map a drawer folder to the agent that reads it. Dot-folder names are the
 * convention every tool follows (~/.claude, .cursor, …); unknown ones fall
 * back to a capitalised folder name so nothing is left unclassified.
 */
const AGENTS = {
  claude: { id: "claude", label: "Claude Code" },
  cursor: { id: "cursor", label: "Cursor" },
  codex: { id: "codex", label: "Codex" },
  gemini: { id: "gemini", label: "Gemini" },
  agents: { id: "agents", label: "Agents (shared)" },
  github: { id: "copilot", label: "GitHub Copilot" },
  copilot: { id: "copilot", label: "GitHub Copilot" },
  windsurf: { id: "windsurf", label: "Windsurf" },
  kiro: { id: "kiro", label: "Kiro" },
  opencode: { id: "opencode", label: "OpenCode" },
  amp: { id: "amp", label: "Amp" },
  continue: { id: "continue", label: "Continue" },
  cline: { id: "cline", label: "Cline" },
  roo: { id: "roo", label: "Roo Code" },
  aider: { id: "aider", label: "Aider" },
  goose: { id: "goose", label: "Goose" },
  zed: { id: "zed", label: "Zed" },
  junie: { id: "junie", label: "Junie" },
  trae: { id: "trae", label: "Trae" },
  qwen: { id: "qwen", label: "Qwen Code" },
  augment: { id: "augment", label: "Augment" },
  vscode: { id: "vscode", label: "VS Code" },
  skills: { id: "project", label: "Project (bare skills/)" },
};

export function agentForFolder(folderName) {
  const key = String(folderName || "").replace(/^\./, "").toLowerCase();
  if (AGENTS[key]) return AGENTS[key];
  if (!key) return { id: "other", label: "Other" };
  return { id: key, label: key.charAt(0).toUpperCase() + key.slice(1) };
}

/** Agent for an arbitrary drawer root path: first dot-folder segment wins. */
export function agentForPath(root) {
  const parts = String(root).split(/[\\/]+/).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    if (parts[i].startsWith(".") && parts[i].length > 1) return agentForFolder(parts[i]);
  }
  if (parts[parts.length - 1] === "skills") return AGENTS.skills;
  return { id: "other", label: "Other" };
}

export const KNOWN_AGENTS = AGENTS;
