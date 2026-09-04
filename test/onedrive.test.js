import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { oneDriveRoots, oneDrivePaths } from "../src/onedrive.js";
import { detectAgents, resolveUserSkills, allAgents } from "../src/agents.js";
import { discoverDrawers, scanSkills } from "../src/scan.js";
import { tmpHome, writeSkill } from "./helpers.js";

test("OneDrive roots come from env vars and from disk", (t) => {
  const env = tmpHome();
  t.after(env.cleanup);
  fs.mkdirSync(path.join(env.home, "OneDrive - Contoso"), { recursive: true });
  fs.mkdirSync(path.join(env.home, "Library/CloudStorage/OneDrive-Personal"), { recursive: true });
  const found = oneDriveRoots({ home: env.home, env: {} }).existing.map((p) => path.basename(p));
  assert.deepEqual(found.sort(), ["OneDrive - Contoso", "OneDrive-Personal"]);
  // An env var that points somewhere real takes precedence.
  const custom = path.join(env.home, "Custom OneDrive");
  fs.mkdirSync(custom);
  assert.equal(oneDriveRoots({ home: env.home, env: { OneDriveConsumer: custom } }).existing[0], custom);
  // One that points nowhere is skipped rather than breaking discovery.
  assert.ok(oneDriveRoots({ home: env.home, env: { OneDriveConsumer: path.join(env.home, "gone") } }).existing.length >= 2);
});

test("Cowork paths cover OneDrive and a redirected Documents folder", (t) => {
  const env = tmpHome();
  t.after(env.cleanup);
  fs.mkdirSync(path.join(env.home, "OneDrive"), { recursive: true });
  const paths = oneDrivePaths("Documents/Cowork/Skills", { home: env.home, env: {} });
  assert.equal(paths[0], path.join(env.home, "OneDrive/Documents/Cowork/Skills"));
  assert.ok(paths.includes(path.join(env.home, "Documents/Cowork/Skills")), "Known Folder Move fallback");
});

test("Cowork skills in OneDrive are found, and the agent reads as installed", (t) => {
  const env = tmpHome();
  t.after(env.cleanup);
  const cowork = path.join(env.home, "OneDrive/Documents/Cowork/Skills");
  writeSkill(path.join(cowork, "research"), { name: "research", description: "Research a topic in depth when the user asks for a deep dive." });
  const m365 = detectAgents({ home: env.home, envPath: "", env: {} }).find((a) => a.id === "m365");
  assert.equal(m365.label, "Microsoft Cowork");
  assert.equal(m365.installed, true, "the skills folder itself proves the tool is in use");
  assert.equal(m365.userSkills, cowork);
  const index = scanSkills({ home: env.home, project: false });
  const found = index.skills.find((s) => s.name === "research");
  assert.ok(found, "the OneDrive skill is scanned");
  assert.equal(found.agentLabel, "Microsoft Cowork");
  assert.equal(index.drawers.find((d) => d.agentId === "m365").root, cowork);
});

test("with no OneDrive folder Cowork still offers a place to put skills", (t) => {
  const env = tmpHome();
  t.after(env.cleanup);
  fs.mkdirSync(path.join(env.home, ".m365"), { recursive: true }); // detected by its dot-folder
  const m365 = detectAgents({ home: env.home, envPath: "", env: {} }).find((a) => a.id === "m365");
  assert.equal(m365.installed, true);
  assert.match(m365.userSkills.replace(/\\/g, "/"), /Cowork\/Skills$/);
  assert.ok(resolveUserSkills(allAgents().find((a) => a.id === "m365"), env.home, {}).length > 1);
});

test("Claude is renamed and the shared .agents convention is gone", (t) => {
  const env = tmpHome();
  t.after(env.cleanup);
  writeSkill(path.join(env.home, ".claude/skills/a"), { name: "a", description: "Alpha skill does alpha things well." });
  writeSkill(path.join(env.home, ".agents/skills/shared"), { name: "shared", description: "A skill in the old shared folder." });
  const agents = detectAgents({ home: env.home, envPath: "", env: {} });
  assert.equal(agents.find((a) => a.id === "claude").label, "Claude");
  assert.equal(agents.find((a) => a.id === "agents"), undefined);
  const index = scanSkills({ home: env.home, project: false });
  assert.deepEqual(index.skills.map((s) => s.name), ["a"], ".agents is not scanned at all");
  assert.equal(discoverDrawers({ home: env.home, project: false }).find((d) => d.root.includes(".agents")), undefined);
});
