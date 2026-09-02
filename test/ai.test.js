import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { scanSkills, readSkill } from "../src/scan.js";
import { assessSkill, compareSkills, extractJson, loadConfig, saveConfig, publicConfig, testConnection, assessmentPrompt, comparisonPrompt } from "../src/ai.js";
import { startServer } from "../src/server.js";
import { tmpHome, writeSkill } from "./helpers.js";

const ASSESS = { score: 72, grade: "B", summary: "Decent skill.", dimensions: { trigger: { score: 7, note: "ok" } }, strengths: ["clear"], weaknesses: ["short"], suggestions: ["add examples"], improvedDescription: "Better description." };
const COMPARE = { summary: "Similar.", overlap: 80, sameJob: true, differences: ["A is longer"], strengthsA: ["depth"], strengthsB: ["brevity"], scoreA: 70, scoreB: 60, recommendation: "merge", rationale: "why", mergePlan: ["take A's steps"], triggerFix: "rename" };

/** Mock server that speaks both OpenAI chat completions and Anthropic messages. */
function mockModel() {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const data = JSON.parse(body || "{}");
      calls.push({ url: req.url, headers: req.headers, body: data });
      const userText = req.url.endsWith("/v1/messages") ? data.messages[0].content : data.messages[1].content;
      const sys = req.url.endsWith("/v1/messages") ? data.system : data.messages[0].content;
      let reply;
      if (/SKILL A/.test(userText)) reply = "```json\n" + JSON.stringify(COMPARE) + "\n```";
      else if (/Ping/.test(userText)) reply = "OK";
      else reply = JSON.stringify(ASSESS);
      if (req.url.endsWith("/v1/messages")) {
        if (req.headers["x-api-key"] !== "sk-ant-test") { res.writeHead(401); res.end(JSON.stringify({ error: { message: "bad key" } })); return; }
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ content: [{ type: "text", text: reply }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } }));
        return;
      }
      if (req.url.endsWith("/chat/completions")) {
        if (data.response_format && req.headers["x-reject-format"]) { res.writeHead(400); res.end(JSON.stringify({ error: { message: "response_format not supported" } })); return; }
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: reply } }], usage: { total_tokens: 15 }, sys }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, calls, url: `http://127.0.0.1:${server.address().port}` })));
}

function fixture(t) {
  const env = tmpHome();
  writeSkill(path.join(env.home, ".claude/skills/alpha"), { name: "alpha", description: "Alpha skill merges pdf files when asked.", body: "# Alpha\n\nRun merge.\n" });
  writeSkill(path.join(env.home, ".cursor/skills/beta"), { name: "beta", description: "Beta skill merges pdf documents when asked.", body: "# Beta\n\nRun merge better.\n" });
  t.after(env.cleanup);
  return env;
}

test("config save/load masks the key and env overrides win", (t) => {
  fixture(t);
  const c = saveConfig({ provider: "openai", baseUrl: "http://localhost:1/v1", model: "m", apiKey: "sk-secret-1234", temperature: 0 });
  assert.equal(c.hasKey, true);
  assert.equal(c.keyHint, "sk-s…1234");
  assert.equal(c.ready, true);
  assert.equal(loadConfig().apiKey, "sk-secret-1234");
  saveConfig({ apiKey: "keep", model: "m2" });
  assert.equal(loadConfig().apiKey, "sk-secret-1234");
  assert.equal(loadConfig().model, "m2");
  saveConfig({ apiKey: "" });
  assert.equal(publicConfig().hasKey, false);
  assert.throws(() => saveConfig({ provider: "nope" }), /provider/);
  assert.throws(() => saveConfig({ baseUrl: "ftp://x" }), /baseUrl/);
  process.env.SKILL_DRAWER_AI_MODEL = "env-model";
  assert.equal(loadConfig().model, "env-model");
  delete process.env.SKILL_DRAWER_AI_MODEL;
});

test("prompts include frontmatter, body and static findings; extractJson tolerates fences", (t) => {
  const env = fixture(t);
  const index = scanSkills({ home: env.home, project: false });
  const a = readSkill(index.skills[0]);
  const p = assessmentPrompt(a);
  assert.match(p.user, /name: alpha/);
  assert.match(p.user, /Run merge\./);
  assert.match(p.system, /"score"/);
  const cp = comparisonPrompt(a, readSkill(index.skills[1]));
  assert.match(cp.user, /SKILL A: alpha[\s\S]*SKILL B: beta/);
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Sure! {"a":1} done'), { a: 1 });
  assert.throws(() => extractJson("nope"), /valid JSON/);
});

test("assess and compare via OpenAI-compatible endpoint, with cache and response_format fallback", async (t) => {
  const env = fixture(t);
  const mock = await mockModel();
  t.after(() => mock.server.close());
  const config = { provider: "openai", baseUrl: `${mock.url}/v1`, model: "test-model", apiKey: "sk-x", temperature: 0, maxTokens: 500, timeoutMs: 5000 };
  const index = scanSkills({ home: env.home, project: false });
  const [a, b] = index.skills.map(readSkill);
  const r1 = await assessSkill(a, { config });
  assert.equal(r1.result.score, 72);
  assert.equal(r1.cached, false);
  assert.equal(mock.calls[0].headers.authorization, "Bearer sk-x");
  assert.equal(mock.calls[0].body.response_format.type, "json_object");
  const r2 = await assessSkill(a, { config });
  assert.equal(r2.cached, true);
  assert.equal(mock.calls.length, 1);
  const r3 = await assessSkill(a, { config, force: true });
  assert.equal(r3.cached, false);
  assert.equal(mock.calls.length, 2);
  const c = await compareSkills(a, b, { config });
  assert.equal(c.result.recommendation, "merge");
  assert.equal(c.result.overlap, 80);
  const ping = await testConnection(config);
  assert.equal(ping.reply, "OK");
});

test("anthropic messages format and auth errors", async (t) => {
  const env = fixture(t);
  const mock = await mockModel();
  t.after(() => mock.server.close());
  const index = scanSkills({ home: env.home, project: false });
  const a = readSkill(index.skills[0]);
  const good = { provider: "anthropic", baseUrl: mock.url, model: "claude-test", apiKey: "sk-ant-test", maxTokens: 500, timeoutMs: 5000 };
  const r = await assessSkill(a, { config: good });
  assert.equal(r.result.grade, "B");
  const call = mock.calls.at(-1);
  assert.ok(call.url.endsWith("/v1/messages"));
  assert.equal(call.headers["anthropic-version"], "2023-06-01");
  assert.equal(call.body.max_tokens, 500);
  await assert.rejects(assessSkill(a, { config: { ...good, apiKey: "wrong" }, force: true }), /401/);
  await assert.rejects(assessSkill(a, { config: { ...good, apiKey: "" }, force: true }), /API key/);
  await assert.rejects(assessSkill(a, { config: { ...good, model: "" }, force: true }), /model name/);
  // A cached result is served without needing the key again.
  assert.equal((await assessSkill(a, { config: { ...good, apiKey: "" } })).cached, true);
});

test("HTTP endpoints: config, test, assess, compare", async (t) => {
  const env = fixture(t);
  const mock = await mockModel();
  t.after(() => mock.server.close());
  const { server, url } = await startServer({ port: 0, open: false, quiet: true, project: false, home: env.home });
  t.after(() => server.close());
  const call = async (p, init = {}) => {
    const res = await fetch(url + p, { headers: { "Content-Type": "application/json" }, ...init, body: init.body ? JSON.stringify(init.body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  let r = await call("/api/ai/config");
  assert.equal(r.body.ready, false);
  assert.ok(Array.isArray(r.body.presets));
  r = await call("/api/ai/config", { method: "PUT", body: { provider: "openai", baseUrl: `${mock.url}/v1`, model: "test-model", apiKey: "sk-z" } });
  assert.equal(r.body.ready, true);
  assert.equal(r.body.apiKey, undefined);
  r = await call("/api/ai/test", { method: "POST", body: {} });
  assert.equal(r.body.reply, "OK");
  const skills = (await call("/api/skills")).body.skills;
  r = await call("/api/ai/assess", { method: "POST", body: { id: skills[0].id } });
  assert.equal(r.status, 200);
  assert.equal(r.body.result.score, 72);
  r = await call("/api/ai/compare", { method: "POST", body: { a: skills[0].id, b: skills[1].id } });
  assert.equal(r.status, 200);
  assert.equal(r.body.a.name, "alpha");
  assert.equal(r.body.result.sameJob, true);
  r = await call("/api/ai/compare", { method: "POST", body: { a: skills[0].id, b: skills[0].id } });
  assert.equal(r.status, 400);
  assert.equal(fs.existsSync(path.join(env.store, "ai-cache.json")), true);
});
