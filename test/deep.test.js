import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { detectAgents, agentForFolder } from "../src/agents.js";
import { qualityScore } from "../src/quality.js";
import { overlapPairs, overlapPair } from "../src/overlap.js";
import { diffLines } from "../src/diff.js";
import { scanSkills, discoverDrawers } from "../src/scan.js";
import { startServer } from "../src/server.js";
import { tmpHome, writeSkill } from "./helpers.js";

test("detectAgents: dot-folder, PATH binary, VS Code extension; Copilot mapping", (t) => {
  const env = tmpHome();
  t.after(env.cleanup);
  fs.mkdirSync(path.join(env.home, ".copilot"), { recursive: true });
  fs.mkdirSync(path.join(env.home, ".vscode/extensions/github.copilot-1.2.3"), { recursive: true });
  const bin = path.join(env.root, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "codex"), "#!/bin/sh\n");
  const agents = detectAgents({ home: env.home, envPath: bin });
  const by = Object.fromEntries(agents.map((a) => [a.id, a]));
  assert.equal(by.copilot.installed, true);
  assert.ok(by.copilot.via.includes("~/.copilot"));
  assert.ok(by.copilot.via.some((v) => /github\.copilot/.test(v)));
  assert.equal(by.codex.installed, true);
  assert.deepEqual(by.codex.via, ["codex on PATH"]);
  assert.equal(by.cursor.installed, false);
  assert.equal(agentForFolder(".github").id, "copilot");
  assert.equal(agentForFolder(".copilot").label, "GitHub Copilot");
});

test("only present agents get drawers; installed agents get a placeholder drawer", (t) => {
  const env = tmpHome();
  t.after(env.cleanup);
  fs.mkdirSync(path.join(env.home, ".copilot"), { recursive: true }); // installed, no skills folder
  writeSkill(path.join(env.home, ".cursor/skills/a"), { name: "a", description: "Alpha skill does alpha things." }); // folder only
  const drawers = discoverDrawers({ home: env.home, project: false });
  const copilot = drawers.find((d) => d.agentId === "copilot");
  assert.ok(copilot);
  assert.equal(copilot.exists, false);
  assert.equal(copilot.writable, true);
  assert.equal(copilot.root, path.join(env.home, ".copilot/skills"));
  assert.ok(drawers.find((d) => d.agentId === "cursor").exists);
  assert.equal(drawers.find((d) => d.agentId === "gemini"), undefined);
  const index = scanSkills({ home: env.home, project: false });
  assert.equal(index.skills.length, 1);
  assert.ok(index.skills[0].quality.score > 0);
});

test("static quality score rewards trigger guidance and structure", () => {
  const good = qualityScore({
    frontmatter: { name: "pdf-tools", description: "Read, merge and split PDF files with pypdf. Use when the user mentions a .pdf file or asks to combine pages." },
    present: true, error: null, slug: "pdf-tools",
    body: "# PDF tools\n\n## Steps\n\n1. Install: `pip install pypdf`\n2. Run the merge script\n3. Do not overwrite the original file\n\n" + "More detail. ".repeat(20),
    lintProblems: [], risk: "none", files: [{ path: "SKILL.md" }],
  });
  const bad = qualityScore({ frontmatter: {}, present: false, error: null, slug: "x", body: "", lintProblems: [], risk: "critical", files: [] });
  assert.ok(good.score >= 80, `good scored ${good.score}`);
  assert.equal(good.grade, "A");
  assert.ok(bad.score <= 10, `bad scored ${bad.score}`);
  assert.equal(bad.grade, "F");
  assert.equal(good.parts.length, 5);
  assert.equal(good.parts.reduce((s, p) => s + p.max, 0), 100);
  const noTrigger = qualityScore({ frontmatter: { name: "x", description: "Does PDF things for you with a library." }, present: true, error: null, slug: "x", body: "# X\n\nsome text", lintProblems: [], risk: "none", files: [] });
  assert.ok(noTrigger.parts.find((p) => p.key === "description").note.includes("when to use"));
});

test("overlap pairs rank by description similarity and flag identical copies", () => {
  const mk = (id, name, description, body, agentId, drawerId, hash) => ({ id, name, description, body, agentId, agentLabel: agentId, drawerId, drawerLabel: drawerId, path: `/${id}`, contentHash: hash, disabled: false });
  const skills = [
    mk("1", "pdf-tools", "Read, merge, split and fill PDF forms when the user mentions a pdf file", "# PDF\nmerge split", "claude", "c", "h1"),
    mk("2", "pdf-helper", "Merge, split, read and fill PDF documents whenever the user mentions a pdf", "# PDF helper\nmerge split fill", "codex", "x", "h2"),
    mk("3", "deploy", "Deploy the app to production servers with the release script", "# Deploy\nrun release", "claude", "c", "h3"),
    mk("4", "pdf-tools", "Read, merge, split and fill PDF forms when the user mentions a pdf file", "# PDF\nmerge split", "cursor", "u", "h1"),
  ];
  const r = overlapPairs(skills, { threshold: 0.3 });
  assert.equal(r.considered, 4);
  assert.equal(r.pairs[0].identical, true);
  assert.equal(r.pairs[0].level, "identical");
  const pair = r.pairs.find((p) => p.a.id === "1" && p.b.id === "2");
  assert.ok(pair && pair.score > 0.5, JSON.stringify(pair));
  assert.equal(pair.sameAgent, false);
  assert.ok(!r.pairs.some((p) => p.a.id === "3" || p.b.id === "3"));
  assert.equal(overlapPairs(skills, { threshold: 0.3, agentId: "claude" }).considered, 2);
  assert.equal(overlapPair(skills[0], skills[2]).score < 0.3, true);
});

test("diffLines", () => {
  const d = diffLines("a\nb\nc\n", "a\nx\nc\nd\n");
  assert.equal(d.added, 2);
  assert.equal(d.removed, 1);
  assert.deepEqual(d.ops.map((o) => o.type), ["eq", "del", "add", "eq", "add", "eq"]);
  assert.equal(diffLines("same", "same").same, true);
});

test("HTTP: agents carry presence, overlap, quality, diff, open drawer creates folder", async (t) => {
  const env = tmpHome();
  fs.mkdirSync(path.join(env.home, ".copilot"), { recursive: true });
  writeSkill(path.join(env.home, ".claude/skills/pdf-tools"), { name: "pdf-tools", description: "Read, merge, split and fill PDF forms when the user mentions a pdf file.", body: "# PDF\n\nmerge split\n" });
  writeSkill(path.join(env.home, ".codex/skills/pdf-helper"), { name: "pdf-helper", description: "Merge, split, read and fill PDF documents whenever the user mentions a pdf.", body: "# PDF helper\n\nmerge split fill\n" });
  const { server, url } = await startServer({ port: 0, open: false, quiet: true, project: false, home: env.home });
  t.after(() => { server.close(); env.cleanup(); });
  const call = async (p, init = {}) => {
    const res = await fetch(url + p, { headers: { "Content-Type": "application/json" }, ...init, body: init.body ? JSON.stringify(init.body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  let r = await call("/api/skills");
  const copilot = r.body.agents.find((a) => a.id === "copilot");
  assert.ok(copilot && copilot.installed && copilot.count === 0);
  assert.equal(r.body.drawers.find((d) => d.agentId === "copilot").exists, false);
  assert.ok(r.body.skills.every((s) => typeof s.qualityScore === "number"));
  r = await call("/api/overlap?threshold=0.3");
  assert.equal(r.body.pairs.length, 1);
  assert.ok(r.body.pairs[0].score > 0.5);
  r = await call("/api/quality");
  assert.equal(r.body.length, 2);
  assert.ok(r.body[0].quality.score <= r.body[1].quality.score);
  const [a, b] = (await call("/api/skills")).body.skills;
  r = await call(`/api/skills/${a.id}/diff?other=${b.id}`);
  assert.ok(r.body.added > 0 && r.body.removed > 0);
  r = await call("/api/agents");
  assert.ok(r.body.find((x) => x.id === "copilot").installed);
});
