import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer } from "../src/server.js";
import { tmpHome, writeSkill } from "./helpers.js";

async function boot(t, opts = {}) {
  const env = tmpHome();
  const dir = writeSkill(path.join(env.home, ".claude/skills/alpha"), { name: "alpha", description: "Alpha skill does alpha things." });
  const { server, url } = await startServer({ port: 0, open: false, quiet: true, project: false, home: env.home, ...opts });
  t.after(() => { server.close(); env.cleanup(); });
  const call = async (p, init = {}) => {
    const res = await fetch(url + p, { headers: { "Content-Type": "application/json" }, ...init, body: init.body ? JSON.stringify(init.body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  return { env, dir, url, call };
}

test("list, read, edit, rename, trash, restore, disable, enable", async (t) => {
  const { call, dir, env } = await boot(t);
  let r = await call("/api/skills");
  assert.equal(r.status, 200);
  assert.equal(r.body.skills.length, 1);
  const id = r.body.skills[0].id;

  r = await call(`/api/skills/${id}`);
  assert.equal(r.body.name, "alpha");
  assert.ok(r.body.files.some((f) => f.path === "SKILL.md"));

  r = await call(`/api/skills/${id}/file`, { method: "PUT", body: { path: "SKILL.md", content: "---\nname: alpha\ndescription: Edited description for alpha.\n---\nnew body\n" } });
  assert.equal(r.status, 200);
  assert.match(fs.readFileSync(path.join(dir, "SKILL.md"), "utf8"), /new body/);
  r = await call(`/api/skills/${id}/file`, { method: "PUT", body: { path: "../escape.md", content: "x" } });
  assert.equal(r.status, 200); // normalised inside the skill folder
  assert.equal(fs.existsSync(path.join(env.home, ".claude/skills/escape.md")), false);

  r = await call(`/api/skills/${id}/rename`, { method: "POST", body: { name: "alpha-two" } });
  assert.equal(r.status, 200);
  assert.equal(fs.existsSync(path.join(env.home, ".claude/skills/alpha-two/SKILL.md")), true);
  assert.match(fs.readFileSync(path.join(env.home, ".claude/skills/alpha-two/SKILL.md"), "utf8"), /name: alpha-two/);
  const id2 = r.body.renamed.id;

  r = await call(`/api/skills/${id2}/disable`, { method: "POST" });
  assert.equal(r.status, 200);
  r = await call("/api/skills");
  assert.equal(r.body.skills[0].disabled, true);
  assert.equal(r.body.census.active, 0);
  r = await call(`/api/skills/${id2}/enable`, { method: "POST" });
  assert.equal(r.status, 200);

  r = await call(`/api/skills/${id2}`, { method: "DELETE" });
  assert.equal(r.status, 200);
  assert.equal(r.body.removed[0].permanent, false);
  const entry = r.body.removed[0].trashEntry;
  r = await call("/api/trash");
  assert.equal(r.body.entries.length, 1);
  r = await call(`/api/trash/${entry}/restore`, { method: "POST" });
  assert.equal(r.status, 200);
  r = await call("/api/skills");
  assert.equal(r.body.skills.length, 1);

  r = await call("/api/skills", { method: "POST", body: { name: "Fresh Skill", description: "A fresh skill for testing." } });
  assert.equal(r.status, 200);
  assert.equal(r.body.created.name, "fresh-skill");
  r = await call("/api/export?format=bundle");
  assert.equal(r.body.skills.length, 2);
});

test("read-only mode refuses mutations", async (t) => {
  const { call } = await boot(t, { readOnly: true });
  const list = await call("/api/skills");
  assert.equal(list.body.readOnly, true);
  const r = await call(`/api/skills/${list.body.skills[0].id}`, { method: "DELETE" });
  assert.equal(r.status, 403);
  const exp = await call("/api/export");
  assert.equal(exp.status, 200);
});

test("cross-origin requests are rejected and unknown ids 404", async (t) => {
  const { call } = await boot(t);
  const r = await call("/api/skills", { headers: { Origin: "https://evil.example", "Content-Type": "application/json" } });
  assert.equal(r.status, 403);
  const missing = await call("/api/skills/nope");
  assert.equal(missing.status, 404);
});

test("copy, move, archive, frontmatter and file delete over HTTP", async (t) => {
  const { call, env } = await boot(t);
  fs.mkdirSync(path.join(env.home, ".cursor/skills"), { recursive: true });
  let r = await call("/api/skills?refresh=1");
  assert.ok(r.body.agents.some((a) => a.label === "Claude Code"));
  const cursor = r.body.drawers.find((d) => d.agentId === "cursor");
  const id = r.body.skills[0].id;

  r = await call(`/api/skills/${id}/copy`, { method: "POST", body: { drawerId: cursor.id } });
  assert.equal(r.status, 200);
  assert.equal(r.body.done.length, 1);
  assert.equal(r.body.done[0].skill.agentId, "cursor");
  const copyId = r.body.done[0].skill.id;

  r = await call(`/api/skills/${copyId}/frontmatter`, { method: "PUT", body: { data: { name: "alpha", description: "Changed via form.", tags: ["a"] } } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.frontmatter.tags, ["a"]);

  r = await call(`/api/skills/${copyId}/file`, { method: "PUT", body: { path: "notes/x.md", content: "hi" } });
  assert.equal(r.status, 200);
  r = await call(`/api/skills/${copyId}/file?path=notes/x.md`, { method: "DELETE" });
  assert.equal(r.status, 200);
  r = await call(`/api/skills/${copyId}/file?path=SKILL.md`, { method: "DELETE" });
  assert.equal(r.status, 400);

  r = await call(`/api/skills/${copyId}/archive`, { method: "POST" });
  assert.equal(r.status, 200);
  const entry = r.body.archived[0].entryId;
  r = await call("/api/archive");
  assert.equal(r.body.entries.length, 1);
  const claude = (await call("/api/skills")).body.drawers.find((d) => d.agentId === "claude");
  r = await call(`/api/archive/${entry}/restore`, { method: "POST", body: { drawerId: claude.id } });
  assert.equal(r.status, 409); // alpha already exists in ~/.claude/skills
  r = await call(`/api/archive/${entry}/restore`, { method: "POST", body: { drawerId: cursor.id } });
  assert.equal(r.status, 200);

  r = await call("/api/skills/copy", { method: "POST", body: { ids: [id], drawerId: cursor.id, move: true, overwrite: true } });
  assert.equal(r.body.done.length, 1);
  r = await call("/api/skills");
  assert.equal(r.body.skills.length, 1);
  assert.equal(r.body.skills[0].agentId, "cursor");
});
