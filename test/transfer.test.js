import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { scanSkills, discoverDrawers, copySkill } from "../src/scan.js";
import { agentForFolder, agentForPath } from "../src/agents.js";
import { stash, restore, listStore } from "../src/store.js";
import { replaceFrontmatter, parseFrontmatter } from "../src/frontmatter.js";
import { tmpHome, writeSkill } from "./helpers.js";

test("drawers and skills are classified per agent", (t) => {
  const env = tmpHome();
  t.after(env.cleanup);
  writeSkill(path.join(env.home, ".claude/skills/a"), { name: "a", description: "Alpha skill does alpha things." });
  writeSkill(path.join(env.home, ".cursor/skills/b"), { name: "b", description: "Beta skill does beta things." });
  writeSkill(path.join(env.home, ".cursor/plugins/x/skills/c"), { name: "c", description: "Gamma skill does gamma things." });
  writeSkill(path.join(env.home, ".weirdtool/skills/d"), { name: "d", description: "Delta skill does delta things." });
  const proj = path.join(env.root, "proj");
  writeSkill(path.join(proj, ".github/skills/e"), { name: "e", description: "Epsilon skill does epsilon things." });
  const index = scanSkills({ home: env.home, cwd: proj });
  const by = Object.fromEntries(index.skills.map((s) => [s.name, s.agentLabel]));
  assert.deepEqual(by, { a: "Claude Code", b: "Cursor", c: "Cursor", d: "Weirdtool", e: "GitHub Copilot" });
  assert.equal(discoverDrawers({ home: env.home, cwd: proj }).every((d) => d.agentId), true);
  assert.equal(agentForFolder(".codex").label, "Codex");
  assert.equal(agentForPath("/home/u/.gemini/antigravity/skills").id, "gemini");
});

test("copy and move a skill across agents", (t) => {
  const env = tmpHome();
  t.after(env.cleanup);
  const src = writeSkill(path.join(env.home, ".claude/skills/alpha"), { name: "alpha", description: "Alpha skill does alpha things." });
  fs.mkdirSync(path.join(src, "node_modules/junk"), { recursive: true });
  fs.writeFileSync(path.join(src, "extra.txt"), "x");
  fs.mkdirSync(path.join(env.home, ".cursor/skills"), { recursive: true });
  let index = scanSkills({ home: env.home, project: false });
  const cursor = index.drawers.find((d) => d.agentId === "cursor");
  const skill = index.skills[0];
  const r = copySkill(skill, cursor, {});
  assert.equal(r.to, path.join(cursor.root, "alpha"));
  assert.equal(fs.existsSync(path.join(r.to, "extra.txt")), true);
  assert.equal(fs.existsSync(path.join(r.to, "node_modules")), false);
  assert.equal(fs.existsSync(src), true);
  assert.throws(() => copySkill(skill, cursor, {}), /already exists/);
  copySkill(skill, cursor, { overwrite: true, newName: "alpha-two" });
  assert.equal(fs.existsSync(path.join(cursor.root, "alpha-two/SKILL.md")), true);
  const m = copySkill(skill, cursor, { move: true, newName: "alpha-moved" });
  assert.equal(m.moved, true);
  assert.equal(fs.existsSync(src), false);
  assert.equal(fs.existsSync(path.join(cursor.root, "alpha-moved/SKILL.md")), true);
  index = scanSkills({ home: env.home, project: false });
  assert.deepEqual(index.skills.map((s) => s.agentId), ["cursor", "cursor", "cursor"]);
  assert.throws(() => copySkill(index.skills[0], { ...cursor, writable: false }, {}), /managed/);
});

test("archive then unarchive into a different drawer", (t) => {
  const env = tmpHome();
  t.after(env.cleanup);
  const dir = writeSkill(path.join(env.home, ".claude/skills/alpha"), { name: "alpha", description: "Alpha skill does alpha things." });
  fs.mkdirSync(path.join(env.home, ".codex/skills"), { recursive: true });
  let index = scanSkills({ home: env.home, project: false });
  const entry = stash("archive", index.skills[0], { agentId: "claude", agentLabel: "Claude Code" });
  assert.equal(fs.existsSync(dir), false);
  index = scanSkills({ home: env.home, project: false });
  assert.equal(index.skills.length, 0);
  assert.equal(index.census.archived, 1);
  assert.equal(listStore("archive")[0].agentLabel, "Claude Code");
  const codex = path.join(env.home, ".codex/skills/alpha");
  const r = restore("archive", entry.entryId, { target: codex });
  assert.equal(r.restoredTo, codex);
  index = scanSkills({ home: env.home, project: false });
  assert.equal(index.skills[0].agentId, "codex");
  assert.equal(index.census.archived, 0);
});

test("replaceFrontmatter keeps the body", () => {
  const out = replaceFrontmatter("---\nname: a\ndescription: old\n---\n\n# Body\n\ntext\n", { name: "a", description: "new", tags: ["x"] });
  const fm = parseFrontmatter(out);
  assert.equal(fm.data.description, "new");
  assert.deepEqual(fm.data.tags, ["x"]);
  assert.equal(fm.content, "\n# Body\n\ntext\n");
  assert.match(replaceFrontmatter("no frontmatter\n", { name: "n", description: "d" }), /^---\nname: n\ndescription: d\n---\n\nno frontmatter\n$/);
});
