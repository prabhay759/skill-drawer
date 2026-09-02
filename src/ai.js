/**
 * AI-assisted quality assessment and skill comparison.
 *
 * Talks to any chat-completions endpoint the user configures (OpenAI,
 * OpenRouter, Groq, Ollama, LM Studio, Anthropic's OpenAI-compatible
 * endpoint, …) or natively to Anthropic's Messages API. Settings live in
 * ~/.skill-drawer/ai.json; results are cached by model + content hash.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { drawerHome, readJson, writeJson, httpError } from "./util.js";

export const PRESETS = [
  { id: "openai", label: "OpenAI", provider: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", keyEnv: "OPENAI_API_KEY" },
  { id: "anthropic", label: "Anthropic (native Messages API)", provider: "anthropic", baseUrl: "https://api.anthropic.com", model: "claude-opus-5", keyEnv: "ANTHROPIC_API_KEY" },
  { id: "anthropic-compat", label: "Anthropic (OpenAI-compatible)", provider: "openai", baseUrl: "https://api.anthropic.com/v1", model: "claude-opus-5", keyEnv: "ANTHROPIC_API_KEY" },
  { id: "openrouter", label: "OpenRouter", provider: "openai", baseUrl: "https://openrouter.ai/api/v1", model: "anthropic/claude-opus-5", keyEnv: "OPENROUTER_API_KEY" },
  { id: "groq", label: "Groq", provider: "openai", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", keyEnv: "GROQ_API_KEY" },
  { id: "ollama", label: "Ollama (local)", provider: "openai", baseUrl: "http://localhost:11434/v1", model: "llama3.1", keyEnv: "" },
  { id: "lmstudio", label: "LM Studio (local)", provider: "openai", baseUrl: "http://localhost:1234/v1", model: "", keyEnv: "" },
  { id: "custom", label: "Custom endpoint", provider: "openai", baseUrl: "", model: "", keyEnv: "" },
];

const DEFAULTS = { provider: "openai", baseUrl: "https://api.openai.com/v1", model: "", apiKey: "", temperature: 0.2, maxTokens: 4000, timeoutMs: 120000 };
const MAX_BODY_CHARS = 60_000;

function configFile() {
  return path.join(drawerHome(), "ai.json");
}
function cacheFile() {
  return path.join(drawerHome(), "ai-cache.json");
}

export function loadConfig() {
  const saved = readJson(configFile(), {}) || {};
  const env = process.env;
  const cfg = {
    ...DEFAULTS,
    ...saved,
    provider: env.SKILL_DRAWER_AI_PROVIDER || saved.provider || DEFAULTS.provider,
    baseUrl: env.SKILL_DRAWER_AI_BASE_URL || saved.baseUrl || DEFAULTS.baseUrl,
    model: env.SKILL_DRAWER_AI_MODEL || saved.model || "",
    apiKey: env.SKILL_DRAWER_AI_API_KEY || saved.apiKey || "",
  };
  if (!cfg.apiKey) {
    const preset = PRESETS.find((p) => p.baseUrl && cfg.baseUrl.startsWith(p.baseUrl.replace(/\/v1$/, "")));
    if (preset?.keyEnv && env[preset.keyEnv]) cfg.apiKey = env[preset.keyEnv];
  }
  return cfg;
}

export function saveConfig(patch) {
  const current = readJson(configFile(), {}) || {};
  const next = { ...current };
  for (const key of ["provider", "baseUrl", "model", "temperature", "maxTokens", "timeoutMs"]) {
    if (patch[key] !== undefined) next[key] = patch[key];
  }
  if (typeof patch.apiKey === "string") {
    // Empty string clears; "keep" leaves the stored key alone.
    if (patch.apiKey !== "keep") next.apiKey = patch.apiKey;
  }
  if (next.provider && !["openai", "anthropic"].includes(next.provider)) throw httpError(400, "provider must be openai or anthropic");
  if (next.baseUrl && !/^https?:\/\//.test(next.baseUrl)) throw httpError(400, "baseUrl must start with http:// or https://");
  writeJson(configFile(), next);
  try {
    fs.chmodSync(configFile(), 0o600);
  } catch {
    /* windows */
  }
  return publicConfig(loadConfig());
}

export function publicConfig(cfg = loadConfig()) {
  const { apiKey, ...rest } = cfg;
  return {
    ...rest,
    hasKey: Boolean(apiKey),
    keyHint: apiKey ? `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}` : "",
    ready: Boolean(cfg.baseUrl && cfg.model),
    presets: PRESETS,
  };
}

/* ---------- transport ---------- */

async function postJson(url, headers, body, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
  } catch (err) {
    throw httpError(502, err.name === "AbortError" ? `The model did not answer within ${Math.round(timeoutMs / 1000)}s` : `Could not reach ${url}: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || text.slice(0, 300) || res.statusText;
    throw httpError(res.status === 401 || res.status === 403 ? 401 : 502, `Model endpoint returned ${res.status}: ${msg}`);
  }
  return data;
}

/**
 * One chat turn. Returns { text, usage, raw }.
 */
export async function chat({ system, user, json = true }, cfg = loadConfig()) {
  if (!cfg.baseUrl) throw httpError(400, "Set the model endpoint in AI settings first");
  if (!cfg.model) throw httpError(400, "Set the model name in AI settings first");
  const base = cfg.baseUrl.replace(/\/+$/, "");
  if (cfg.provider === "anthropic") {
    if (!cfg.apiKey) throw httpError(400, "An API key is required for the Anthropic API");
    const url = `${base.replace(/\/v1$/, "")}/v1/messages`;
    const data = await postJson(
      url,
      { "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01" },
      { model: cfg.model, max_tokens: cfg.maxTokens, system, messages: [{ role: "user", content: user }] },
      cfg.timeoutMs,
    );
    if (data.stop_reason === "refusal") throw httpError(502, "The model declined this request");
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    return { text, usage: data.usage || null, raw: data };
  }
  const url = `${base}/chat/completions`;
  const headers = cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {};
  const body = {
    model: cfg.model,
    temperature: cfg.temperature,
    max_tokens: cfg.maxTokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  if (json) body.response_format = { type: "json_object" };
  let data;
  try {
    data = await postJson(url, headers, body, cfg.timeoutMs);
  } catch (err) {
    // Some servers reject response_format; retry without it once.
    if (json && /response_format|json_object/i.test(err.message)) {
      delete body.response_format;
      data = await postJson(url, headers, body, cfg.timeoutMs);
    } else throw err;
  }
  const choice = data.choices?.[0];
  const text = typeof choice?.message?.content === "string" ? choice.message.content : Array.isArray(choice?.message?.content) ? choice.message.content.map((p) => p.text || "").join("") : "";
  return { text, usage: data.usage || null, raw: data };
}

export function extractJson(text) {
  const t = String(text || "").trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced ? fenced[1] : null, t, t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)].filter(Boolean);
  for (const c of candidates) {
    try {
      const v = JSON.parse(c);
      if (v && typeof v === "object") return v;
    } catch {
      /* next */
    }
  }
  throw httpError(502, "The model did not return valid JSON. Try a stronger model or lower temperature.");
}

/* ---------- prompts ---------- */

const SKILL_PRIMER = `An "agent skill" is a folder with a SKILL.md that an AI coding agent (Claude Code, Cursor, Codex, Gemini CLI, Copilot, …) loads on demand.
The YAML frontmatter has \`name\` and \`description\`; the agent reads only the description to decide WHEN to load the skill, so the description must say what the skill does and when to use it, concretely, with the trigger words a user would actually say.
The markdown body is the instructions the agent follows once loaded: it should be specific, actionable, ordered, and short (progressive disclosure: put long reference material in separate files and link to them). Good skills state prerequisites, exact commands, expected outputs, edge cases and what NOT to do. Bad skills are vague, restate the obvious, contradict themselves, have no trigger guidance, or contain risky instructions (piping downloads into a shell, touching credentials, overriding other instructions).`;

function renderSkill(s, label) {
  let body = s.body || "";
  let truncated = false;
  if (body.length > MAX_BODY_CHARS) {
    body = body.slice(0, MAX_BODY_CHARS);
    truncated = true;
  }
  const extras = (s.files || []).filter((f) => f.path !== s.skillRel).map((f) => f.path).slice(0, 40);
  const lint = (s.lintProblems || []).map((p) => `${p.level}: ${p.message}`).slice(0, 12);
  const risk = (s.findings || []).map((f) => `${f.severity}: ${f.message} (${f.file}:${f.line})`).slice(0, 12);
  return {
    truncated,
    text: [
      `### ${label}: ${s.name}`,
      `agent: ${s.agentLabel} · drawer: ${s.drawerLabel} · path: ${s.path}`,
      `frontmatter (YAML):\n${(s.frontmatterRaw || "").trim() || "(none)"}`,
      extras.length ? `other files in the skill folder: ${extras.join(", ")}` : "other files: none",
      lint.length ? `static lint findings:\n- ${lint.join("\n- ")}` : "static lint: clean",
      risk.length ? `static risk findings:\n- ${risk.join("\n- ")}` : "static risk audit: clean",
      `body (markdown${truncated ? `, truncated to the first ${MAX_BODY_CHARS} characters` : ""}):\n<<<\n${body}\n>>>`,
    ].join("\n\n"),
  };
}

const ASSESS_SCHEMA = `{
  "score": <integer 0-100, overall quality>,
  "grade": "<A|B|C|D|F>",
  "summary": "<two sentences: what this skill is and the single most important thing to fix>",
  "dimensions": {
    "trigger": {"score": <1-10>, "note": "<does the description reliably make the agent load this skill at the right moments and not otherwise?>"},
    "clarity": {"score": <1-10>, "note": "<are the instructions unambiguous and ordered?>"},
    "completeness": {"score": <1-10>, "note": "<prerequisites, commands, expected results, edge cases?>"},
    "structure": {"score": <1-10>, "note": "<length, headings, progressive disclosure, links to reference files?>"},
    "safety": {"score": <1-10>, "note": "<risky commands, credentials, instruction overrides, destructive steps without guards?>"}
  },
  "strengths": ["<concrete strength>", ...],
  "weaknesses": ["<concrete weakness, quote the offending text when short>", ...],
  "suggestions": ["<specific, actionable edit>", ...],
  "improvedDescription": "<a rewritten frontmatter description, max 300 characters, that states what it does and when to use it>"
}`;

const COMPARE_SCHEMA = `{
  "summary": "<two or three sentences comparing the two skills>",
  "overlap": <integer 0-100, how much of their purpose/trigger space overlaps>,
  "sameJob": <true|false, whether an agent would reasonably pick either for the same request>,
  "differences": ["<concrete difference in purpose, scope, approach or quality>", ...],
  "strengthsA": ["<what A does better>", ...],
  "strengthsB": ["<what B does better>", ...],
  "scoreA": <integer 0-100 quality of A>,
  "scoreB": <integer 0-100 quality of B>,
  "recommendation": "<keep-a|keep-b|keep-both|merge>",
  "rationale": "<why, in two sentences>",
  "mergePlan": ["<if merge or keep-one: the specific sections/instructions to carry over from the other>", ...],
  "triggerFix": "<if both trigger on the same requests: how to rewrite one description so the agent can tell them apart>"
}`;

export function assessmentPrompt(skill) {
  const r = renderSkill(skill, "SKILL");
  return {
    truncated: r.truncated,
    system: `You are a rigorous reviewer of agent skills.\n\n${SKILL_PRIMER}\n\nAssess the skill you are given. Be specific and quote the skill where useful. Do not invent files or behaviour that is not in the text. Respond with a single JSON object and nothing else, matching this schema exactly:\n${ASSESS_SCHEMA}`,
    user: r.text,
  };
}

export function comparisonPrompt(a, b) {
  const ra = renderSkill(a, "SKILL A");
  const rb = renderSkill(b, "SKILL B");
  return {
    truncated: ra.truncated || rb.truncated,
    system: `You are a rigorous reviewer of agent skills.\n\n${SKILL_PRIMER}\n\nCompare skill A and skill B: do they do the same job, which is better, and what should the user do (keep one, keep both, or merge)? Judge trigger overlap from the descriptions, quality from the bodies. Be concrete; quote where useful; never invent content. Respond with a single JSON object and nothing else, matching this schema exactly:\n${COMPARE_SCHEMA}`,
    user: `${ra.text}\n\n\n${rb.text}`,
  };
}

/* ---------- cache ---------- */

function cacheKey(kind, cfg, hashes) {
  return crypto.createHash("sha1").update([kind, cfg.provider, cfg.baseUrl, cfg.model, ...hashes].join("|")).digest("hex");
}
function readCache() {
  return readJson(cacheFile(), {}) || {};
}
function writeCache(cache) {
  const keys = Object.keys(cache);
  if (keys.length > 500) for (const k of keys.slice(0, keys.length - 500)) delete cache[k];
  writeJson(cacheFile(), cache);
}

async function run(kind, prompt, hashes, cfg, { force = false } = {}) {
  const key = cacheKey(kind, cfg, hashes);
  const cache = readCache();
  if (!force && cache[key]) return { ...cache[key], cached: true };
  const started = Date.now();
  const { text, usage } = await chat({ system: prompt.system, user: prompt.user, json: true }, cfg);
  const result = extractJson(text);
  const out = { kind, result, model: cfg.model, provider: cfg.provider, usage, truncated: prompt.truncated, at: Date.now(), ms: Date.now() - started, cached: false };
  cache[key] = out;
  writeCache(cache);
  return out;
}

export function assessSkill(skill, opts = {}) {
  const cfg = opts.config || loadConfig();
  return run("assess", assessmentPrompt(skill), [skill.contentHash], cfg, opts);
}

export function compareSkills(a, b, opts = {}) {
  const cfg = opts.config || loadConfig();
  return run("compare", comparisonPrompt(a, b), [a.contentHash, b.contentHash], cfg, opts);
}

export async function testConnection(cfg = loadConfig()) {
  const started = Date.now();
  const { text, usage } = await chat({ system: "Reply with the single word OK.", user: "Ping", json: false }, cfg);
  return { ok: true, reply: String(text).trim().slice(0, 80), usage, ms: Date.now() - started, model: cfg.model, provider: cfg.provider };
}

export function clearCache() {
  try {
    fs.rmSync(cacheFile(), { force: true });
  } catch {
    /* ignore */
  }
}
