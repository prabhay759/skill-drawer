import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { scanSkills } from "../src/scan.js";
import { stash, restore, listStore, purge, purgeAll } from "../src/store.js";
import { tmpHome, writeSkill } from "./helpers.js";

test("trash and restore a folder skill", (t) => {
  const env = tmpHome();
  t.after(env.cleanup);
  const dir = writeSkill(path.join(env.home, ".claude/skills/alpha"), { name: "alpha", description: "Alpha skill does alpha things." });
  fs.writeFileSync(path.join(dir, "extra.txt"), "keep me");
  let index = scanSkills({ home: env.home, project: false });
  const skill = index.skills[0];
  const entry = stash("trash", skill);
  assert.equal(fs.existsSync(dir), false);
  assert.equal(listStore("trash").length, 1);
  assert.equal(fs.readFileSync(path.join(entry.payloadPath, "extra.txt"), "utf8"), "keep me");
  const r = restore("trash", entry.entryId);
  assert.equal(r.restoredTo, dir);
  assert.equal(fs.existsSync(path.join(dir, "extra.txt")), true);
  assert.equal(listStore("trash").length, 0);
  index = scanSkills({ home: env.home, project: false });
  assert.equal(index.skills.length, 1);
});

test("restore refuses to overwrite and purge removes", (t) => {
  const env = tmpHome();
  t.after(env.cleanup);
  const dir = writeSkill(path.join(env.home, ".claude/skills/alpha"), { name: "alpha", description: "Alpha skill does alpha things." });
  const skill = scanSkills({ home: env.home, project: false }).skills[0];
  const entry = stash("trash", skill);
  writeSkill(dir, { name: "alpha", description: "A replacement." });
  assert.throws(() => restore("trash", entry.entryId), /already exists/);
  purge("trash", entry.entryId);
  assert.equal(listStore("trash").length, 0);
});

test("disable quarantines and the scan lists it as disabled", (t) => {
  const env = tmpHome();
  t.after(env.cleanup);
  const dir = writeSkill(path.join(env.home, ".claude/skills/alpha"), { name: "alpha", description: "Alpha skill does alpha things." });
  const skill = scanSkills({ home: env.home, project: false }).skills[0];
  stash("disabled", skill);
  let index = scanSkills({ home: env.home, project: false });
  assert.equal(index.skills.length, 1);
  assert.equal(index.skills[0].disabled, true);
  assert.equal(index.skills[0].originalPath, dir);
  assert.equal(index.census.active, 0);
  restore("disabled", index.skills[0].disabledEntry);
  index = scanSkills({ home: env.home, project: false });
  assert.equal(index.skills[0].disabled, false);
});

test("symlink and single-file skills round-trip through trash", (t) => {
  const env = tmpHome();
  t.after(env.cleanup);
  const root = path.join(env.home, ".claude/skills");
  fs.mkdirSync(root, { recursive: true });
  const target = writeSkill(path.join(env.root, "target"), { name: "linked", description: "Linked skill does linked things." });
  fs.symlinkSync(target, path.join(root, "linked"));
  fs.writeFileSync(path.join(root, "loose.md"), "---\nname: loose\ndescription: Loose single-file skill.\n---\nbody\n");
  const index = scanSkills({ home: env.home, project: false });
  const entries = index.skills.map((s) => stash("trash", s));
  assert.equal(fs.readdirSync(root).length, 0);
  assert.equal(fs.existsSync(target), true);
  for (const e of entries) restore("trash", e.entryId);
  assert.equal(fs.lstatSync(path.join(root, "linked")).isSymbolicLink(), true);
  assert.equal(fs.existsSync(path.join(root, "loose.md")), true);
  assert.equal(purgeAll("trash"), 0);
});
