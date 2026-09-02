# Changelog

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
