# Changelog

## 0.4.0

- **Only agents that are actually here.** Skill Drawer now detects installed agents (home folder such as `~/.copilot`, a binary on PATH such as `codex`, or a VS Code extension such as GitHub Copilot) and lists an agent only when it is installed or already holds skills. Installed agents without a skills folder get a placeholder drawer that is created on first copy, install or "Create & open folder".
- **GitHub Copilot, first class.** Detected via `~/.copilot`, the `copilot` CLI, or the `github.copilot` VS Code extension; user drawer `~/.copilot/skills`, project drawer `.github/skills`.
- **Open and close drawer groups.** Each agent group in the sidebar collapses with a chevron; the state is remembered. Hover an agent to see how it was detected.
- **Quality check, deep.** A static 0–100 score with five explained parts (frontmatter 20, description-as-trigger 30, instructions 25, safety 15, structure 10) on every skill, a `Q` chip on cards, sort by lowest quality, and a Quality panel that lists what to fix first and can run the AI assessment over every skill in the current scope with progress. `skill-drawer quality`.
- **Overlap check, deep.** A pairwise static overlap score (description-weighted, then body, then name) with an adjustable threshold, "same drawer / same agent / across agents" severity, identical-copy detection, and per-pair or top-10 AI verdicts. `skill-drawer overlap`.
- **Comparison, deep.** The comparison view now adds static overlap and quality alongside the AI verdict, a colour line diff of the two SKILL.md files, and quick actions: copy one description onto the other skill, or trash the skill the model recommends dropping.

## 0.3.0

- **AI quality assessment.** An Assess (AI) button and an AI tab score a skill 0–100 with a grade, five dimensions (trigger, clarity, completeness, structure, safety), strengths, weaknesses, concrete suggestions and a rewritten description you can apply with one click. `skill-drawer assess <name>` from the CLI.
- **AI comparison of two skills.** Compare with… on any skill, Compare (AI) when exactly two are marked, and a Compare button on every two-skill conflict in the Issues panel. Reports overlap, whether they do the same job, quality of each, a keep-A / keep-B / keep-both / merge recommendation with rationale, a merge plan and a trigger fix. `skill-drawer compare <a> <b>`.
- **Bring your own model.** AI ⚙ in the top bar: pick a preset (OpenAI, Anthropic native or OpenAI-compatible, OpenRouter, Groq, Ollama, LM Studio, custom) or enter any base URL, model and API key. Two wire formats: OpenAI chat completions and Anthropic Messages. Settings in `~/.skill-drawer/ai.json` (mode 600) or via `SKILL_DRAWER_AI_*` environment variables; the key can also come from `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` etc. Test button. Results are cached by model and content hash; Re-assess bypasses the cache.

## 0.2.0

- **Per-agent classification.** Every drawer and skill carries the agent that reads it (Claude Code, Cursor, Codex, Gemini, GitHub Copilot, Windsurf, Kiro, OpenCode and more; unknown dot-folders are named after the folder). The sidebar is an agent tree with drawers nested underneath, cards show an agent chip, sort by agent is the default, and `skill-drawer agents` groups from the CLI.
- **Archive shelf.** Archive moves a skill out of every agent into `~/.skill-drawer/archive` with its agent, drawer and description recorded. The Archive panel lists what is shelved and can unarchive back to the original drawer, into any other agent's drawer, or delete for good. Undo toast on archive. CLI: `archive`, `archive list`, `unarchive`.
- **Copy and move across agents.** Copy to… and Move to… on a skill or a selection, with a drawer picker grouped by agent, optional rename, and overwrite. Symlinks are dereferenced so the target gets a real copy; `node_modules` and `.git` are skipped. Keys `c` and `m`. CLI: `copy`, `move`.
- **Editing.** Edit button in the toolbar. The Edit tab now has a metadata form (description plus other frontmatter keys) that rewrites the frontmatter block without touching the body, and New file / Delete file for the skill folder alongside the file editor.

## 0.1.0

First release. Everything skill-cabinet offers (scan user drawers, filter, search, read, delete, keyboard, themes, risk audit, origin inference) plus:

- Trash with restore and undo, disable/enable quarantine
- Frontmatter and structure lint
- Duplicate and trigger-conflict detection
- Project-local drawer scanning and `--root`
- In-place editor, open in `$EDITOR`, create and rename
- Manifest / bundle export and import
- Install from GitHub or a local folder
- Read-only mode
- Full CLI: `list`, `lint`, `issues`, `drawers`, `export`, `import`, `install`, `disable`, `enable`, `trash`
