import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { detectAgents, agentForFolder, allAgents } from "../src/agents.js";
import { loadAgentSettings, saveAgentSettings } from "../src/settings.js";
import { discoverDrawers, scanSkills } from "../src/scan.js";
import { startServer } from "../src/server.js";
import { tmpHome, writeSkill } from "./helpers.js";

test("Microsoft 365 Copilot is detected and mapped", (t) => {
  const env = tmpHome();
  t.after(env.cleanup);
  fs.mkdirSync(path.join(env.home, ".m365"), { recursive: true });
  const agents = detectAgents({ home: env.home, envPath: "" });
  const m365 = agents.find((a) => a.id === "m365");
  assert.equal(m365.label, "Microsoft 365 Copilot");
  assert.equal(m365.installed, true);
  assert.deepEqual(m365.via, ["~/.m365"]);
  assert.ok(m365.projectSkills.includes("appPackage/skills"));
  assert.equal(agentForFolder(".m365").id, "m365");
  assert.equal(agentForFolder(".microsoft365agents").id, "m365");
  // The Agents Toolkit CLI alone is enough.
  const bin = path.join(env.root, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "atk"), "#!/bin/sh\n");
  assert.ok(detectAgents({ home: env.home, envPath: bin }).find((a) => a.id === "m365").via.includes("atk on PATH"));
});

test("the shared .agents convention never gets a placeholder drawer", (t) => {
  const env = tmpHome();
  t.after(env.cleanup);
  fs.mkdirSync(path.join(env.home, ".agents"), { recursive: true }); // present but empty
  fs.mkdirSync(path.join(env.home, ".claude/skills"), { recursive: true });
  let drawers = discoverDrawers({ home: env.home, project: false });
  assert.equal(drawers.find((d) => d.agentId === "agents"), undefined);
  assert.ok(detectAgents({ home: env.home, envPath: "" }).find((a) => a.id === "agents").shared);
  // It does appear once it actually holds a skill.
  writeSkill(path.join(env.home, ".agents/skills/shared-one"), { name: "shared-one", description: "A shared skill used by several tools." });
  drawers = discoverDrawers({ home: env.home, project: false });
  assert.ok(drawers.find((d) => d.agentId === "agents"));
});

test("hiding an agent removes its drawers and skills", (t) => {
  const env = tmpHome();
  t.after(env.cleanup);
  writeSkill(path.join(env.home, ".claude/skills/a"), { name: "a", description: "Alpha skill does alpha things well." });
  writeSkill(path.join(env.home, ".cursor/skills/b"), { name: "b", description: "Beta skill does beta things well." });
  assert.equal(scanSkills({ home: env.home, project: false }).skills.length, 2);
  saveAgentSettings({ hidden: ["cursor"] });
  assert.deepEqual(loadAgentSettings().hidden, ["cursor"]);
  const index = scanSkills({ home: env.home, project: false });
  assert.deepEqual(index.skills.map((s) => s.name), ["a"]);
  assert.equal(index.drawers.find((d) => d.agentId === "cursor"), undefined);
  assert.equal(detectAgents({ home: env.home, envPath: "" }).find((a) => a.id === "cursor").hidden, true);
  saveAgentSettings({ hidden: [] });
  assert.equal(scanSkills({ home: env.home, project: false }).skills.length, 2);
});

test("custom agents are scanned at their absolute path and validated", (t) => {
  const env = tmpHome();
  t.after(env.cleanup);
  const dir = path.join(env.root, "elsewhere", "mytool-skills");
  writeSkill(path.join(dir, "custom-one"), { name: "custom-one", description: "A custom tool skill used for custom things." });
  saveAgentSettings({ custom: [{ id: "My Tool", label: "My Tool", userSkills: dir, projectSkills: [".mytool/skills"] }] });
  const settings = loadAgentSettings();
  assert.equal(settings.custom[0].id, "my-tool");
  assert.ok(allAgents(settings).find((a) => a.id === "my-tool"));
  const drawers = discoverDrawers({ home: env.home, project: false });
  const d = drawers.find((x) => x.agentId === "my-tool");
  assert.ok(d, "custom drawer discovered");
  assert.equal(d.exists, true, "an existing custom folder is not a placeholder");
  const index = scanSkills({ home: env.home, project: false });
  assert.equal(index.skills.find((s) => s.name === "custom-one").agentLabel, "My Tool");
  assert.throws(() => saveAgentSettings({ custom: [{ id: "x", userSkills: "relative/path" }] }), /absolute/);
  assert.throws(() => saveAgentSettings({ custom: [{ id: "x" }] }), /skills folder/);
  saveAgentSettings({ custom: [] });
});

test("custom project folders are picked up when walking up from the cwd", (t) => {
  const env = tmpHome();
  t.after(env.cleanup);
  const proj = path.join(env.root, "proj");
  writeSkill(path.join(proj, ".mytool/skills/proj-one"), { name: "proj-one", description: "A project skill for the custom tool." });
  saveAgentSettings({ custom: [{ id: "mytool", label: "My Tool", userSkills: path.join(env.home, "mytool"), projectSkills: [".mytool/skills"] }] });
  const index = scanSkills({ home: env.home, cwd: path.join(proj, "src") });
  assert.equal(index.skills.find((s) => s.name === "proj-one")?.agentLabel, "My Tool");
  saveAgentSettings({ custom: [] });
});

test("HTTP: agent settings round-trip and rescan", async (t) => {
  const env = tmpHome();
  writeSkill(path.join(env.home, ".claude/skills/a"), { name: "a", description: "Alpha skill does alpha things well." });
  writeSkill(path.join(env.home, ".cursor/skills/b"), { name: "b", description: "Beta skill does beta things well." });
  const { server, url } = await startServer({ port: 0, open: false, quiet: true, project: false, home: env.home });
  t.after(() => { server.close(); env.cleanup(); saveAgentSettings({ hidden: [], custom: [] }); });
  const call = async (p, init = {}) => {
    const res = await fetch(url + p, { headers: { "Content-Type": "application/json" }, ...init, body: init.body ? JSON.stringify(init.body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  let r = await call("/api/agents/settings");
  assert.deepEqual(r.body.hidden, []);
  assert.ok(r.body.agents.some((a) => a.id === "m365"));
  r = await call("/api/agents/settings", { method: "PUT", body: { hidden: ["cursor"] } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.hidden, ["cursor"]);
  r = await call("/api/skills");
  assert.deepEqual(r.body.skills.map((s) => s.name), ["a"]);
  r = await call("/api/agents/settings", { method: "PUT", body: { custom: [{ id: "x", userSkills: "nope" }] } });
  assert.equal(r.status, 400);
  await call("/api/agents/settings", { method: "PUT", body: { hidden: [] } });
  r = await call("/api/skills");
  assert.equal(r.body.skills.length, 2);
});
