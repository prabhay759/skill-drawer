/**
 * Static skill-body audit: flags risky instructions in SKILL.md and
 * companion scripts. Heuristic, not a sandbox.
 */
import fs from "node:fs";
import path from "node:path";
import { SKIP_WALK } from "./util.js";

export const SEVERITY_ORDER = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };

const COMPANION_EXTENSIONS = new Set([
  ".sh", ".bash", ".zsh", ".fish", ".ps1", ".py", ".js", ".mjs", ".cjs", ".ts",
]);
const MAX_FILE_BYTES = 256_000;
const MAX_FILES = 12;
const MAX_DEPTH = 4;

const RULES = [
  {
    severity: "critical",
    rule: "shell.remote-pipe",
    pattern: /(?:curl|wget)\b[^\n|]{0,500}\|\s*(?:sudo\s+)?(?:sh|bash|zsh)\b/gi,
    message: "Downloads are piped directly to a shell",
  },
  {
    severity: "high",
    rule: "filesystem.broad-delete",
    pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f?[a-zA-Z]*\s+(?:\/|~|\$HOME)(?:\s|$)/gi,
    message: "Command may recursively delete a broad filesystem root",
  },
  {
    severity: "high",
    rule: "credentials.sensitive-path",
    pattern: /(?:\.ssh\/(?:id_|config)|\.aws\/credentials|\.config\/gcloud|login\.keychain|\.netrc|\.npmrc)/gi,
    message: "References a sensitive credential location",
  },
  {
    severity: "high",
    rule: "execution.obfuscated",
    pattern: /(?:eval|exec)\s*\([^\n]{0,200}(?:base64|b64decode|atob)/gi,
    message: "Executes obfuscated or decoded content",
  },
  {
    severity: "medium",
    rule: "prompt.override",
    pattern: /(?:ignore|disregard)\s+(?:all\s+)?(?:previous|prior|system|above)\s+instructions/gi,
    message: "Contains an instruction-override phrase",
  },
  {
    severity: "medium",
    rule: "prompt.exfiltration",
    pattern: /\b(?:send|post|upload|exfiltrate)\b[^\n]{0,80}\b(?:api[_ -]?key|token|secret|password|credential)s?\b/gi,
    message: "Asks to transmit secrets or credentials",
  },
  {
    severity: "medium",
    rule: "git.global-config",
    pattern: /git\s+config\s+--global/gi,
    message: "Modifies global Git configuration",
  },
  {
    severity: "low",
    rule: "network.download",
    pattern: /\b(?:curl|wget)\b/gi,
    message: "Uses a network download command",
  },
  {
    severity: "low",
    rule: "privilege.sudo",
    pattern: /\bsudo\b/gi,
    message: "Uses sudo",
  },
];

const SUBSUMED = { "network.download": new Set(["shell.remote-pipe"]) };
const DENYLIST = /(?:\bdo\s+not\b|\bdon't\b|\bnever\b|\bmust\s+not\b|\bavoid\b|\bforbidden\b)/i;

export function maxSeverity(values) {
  let best = "none";
  for (const v of values) if (SEVERITY_ORDER[v] > SEVERITY_ORDER[best]) best = v;
  return best;
}

function lineAt(text, index) {
  let n = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text.charCodeAt(i) === 10) n += 1;
  return n;
}

function scanText(rel, text) {
  const findings = [];
  const lines = text.split("\n");
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    let match;
    while ((match = rule.pattern.exec(text))) {
      const line = lineAt(text, match.index);
      const lineText = lines[line - 1] || "";
      const context = DENYLIST.test(lineText) ? "denylist" : "instruction";
      findings.push({
        rule: rule.rule,
        severity: context === "denylist" ? "low" : rule.severity,
        message: rule.message,
        file: rel,
        line,
        snippet: lineText.trim().slice(0, 160),
        context,
      });
      if (match[0].length === 0) rule.pattern.lastIndex += 1;
    }
  }
  const rulesHit = new Set(findings.map((f) => f.rule));
  return findings.filter((f) => {
    const subsumedBy = SUBSUMED[f.rule];
    if (!subsumedBy) return true;
    return ![...subsumedBy].some((r) => rulesHit.has(r));
  });
}

function companionFiles(root, fileOnly) {
  if (fileOnly) return [];
  const out = [];
  const walk = (dir, rel, depth) => {
    if (depth > MAX_DEPTH || out.length >= MAX_FILES) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= MAX_FILES) return;
      if (SKIP_WALK.has(entry.name) || entry.isSymbolicLink()) continue;
      const abs = path.join(dir, entry.name);
      const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(abs, nextRel, depth + 1);
      else if (COMPANION_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        out.push({ abs, rel: nextRel });
      }
    }
  };
  walk(root, "", 0);
  return out;
}

export function auditSkill({ root, skillFile, text, fileOnly }) {
  let findings = scanText(path.basename(skillFile), text || "");
  for (const file of companionFiles(root, fileOnly)) {
    try {
      const st = fs.statSync(file.abs);
      if (st.size > MAX_FILE_BYTES) continue;
      findings = findings.concat(scanText(file.rel, fs.readFileSync(file.abs, "utf8")));
    } catch {
      /* unreadable */
    }
  }
  findings.sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]);
  return { severity: maxSeverity(findings.map((f) => f.severity)), findings };
}
