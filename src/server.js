import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import express from "express";
import {
  scanSkills,
  readSkill,
  readSkillFile,
  writeSkillFile,
  assertMutable,
  toCatalogSkill,
  findSkillFile,
} from "./scan.js";
import { listStore, stash, restore, purge, purgeAll, storeRoot } from "./store.js";
import { exportManifest, importManifest, parseManifest } from "./manifest.js";
import { installSkills } from "./install.js";
import { setFrontmatterName, stringifyFrontmatter } from "./frontmatter.js";
import { HOME, drawerHome, exists, httpError, removePath, slugify } from "./util.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const nodeRequire = createRequire(import.meta.url);

/** Package root of an installed dependency, tolerant of "exports" maps. */
function pkgRoot(name) {
  let dir = path.dirname(nodeRequire.resolve(name));
  for (let i = 0; i < 6; i += 1) {
    const pkg = path.join(dir, "package.json");
    if (fs.existsSync(pkg)) {
      try {
        if (JSON.parse(fs.readFileSync(pkg, "utf8")).name === name) return dir;
      } catch {
        /* keep walking */
      }
    }
    dir = path.dirname(dir);
  }
  throw new Error(`Cannot locate package ${name}`);
}

export function createApp(options = {}) {
  const opts = {
    readOnly: false,
    cwd: process.cwd(),
    extraRoots: [],
    project: true,
    ...options,
  };
  let cache = { at: 0, payload: null };
  const scanOptions = { cwd: opts.cwd, extraRoots: opts.extraRoots, project: opts.project, ...(opts.home ? { home: opts.home } : {}) };
  const getIndex = (force = false) => {
    if (!force && cache.payload) return cache.payload;
    cache = { at: Date.now(), payload: scanSkills(scanOptions) };
    return cache.payload;
  };
  const invalidate = () => {
    cache = { at: 0, payload: null };
  };
  const findSkill = (id, refresh = false) => {
    const index = getIndex(refresh);
    const s = index.byId.get(id);
    if (!s) throw httpError(404, "Skill not in the drawer");
    return { index, skill: s };
  };
  const drawerFor = (index, drawerId) => {
    const d = index.drawers.find((x) => x.id === drawerId);
    if (!d) throw httpError(404, "Unknown drawer");
    if (!d.writable) throw httpError(403, `${d.label} is managed by its tool; pick a user or project drawer`);
    return d;
  };
  const defaultDrawer = (index) =>
    index.drawers.find((d) => d.writable && d.kind === "user" && /\.claude\/skills$/.test(d.root)) ||
    index.drawers.find((d) => d.writable && d.kind === "user") ||
    index.drawers.find((d) => d.writable);

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64mb" }));
  app.use((req, res, next) => {
    // Loopback-only server: reject cross-origin browser requests outright.
    const origin = req.headers.origin;
    if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(origin)) {
      res.status(403).json({ error: "Cross-origin requests are not allowed" });
      return;
    }
    if (opts.readOnly && req.path.startsWith("/api") && !["GET", "HEAD", "OPTIONS"].includes(req.method) && req.path !== "/api/export") {
      res.status(403).json({ error: "skill-drawer is running in read-only mode" });
      return;
    }
    next();
  });

  const wrap = (fn) => (req, res) => {
    try {
      const out = fn(req, res);
      if (out !== undefined) res.json(out);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  };

  app.get("/api/health", (_req, res) => res.json({ ok: true, readOnly: opts.readOnly }));

  app.get(
    "/api/skills",
    wrap((req) => {
      const index = getIndex(req.query.refresh === "1");
      const drawers = index.drawers.map((d) => ({ ...d, count: 0 }));
      const byId = new Map(drawers.map((d) => [d.id, d]));
      for (const s of index.skills) {
        if (s.disabled) continue;
        const d = byId.get(s.drawerId);
        if (d) d.count += 1;
      }
      return {
        home: HOME,
        cwd: opts.cwd,
        storeHome: drawerHome(),
        readOnly: opts.readOnly,
        scannedAt: cache.at,
        total: index.skills.length,
        census: index.census,
        drawers: drawers.filter((d) => d.count > 0 || d.writable),
        skills: index.skills.map(toCatalogSkill),
        conflicts: index.conflicts,
      };
    }),
  );

  app.get("/api/issues", wrap(() => {
    const index = getIndex();
    return {
      conflicts: index.conflicts,
      lint: index.skills
        .filter((s) => s.lint !== "ok")
        .map((s) => ({ id: s.id, name: s.name, drawer: s.drawerLabel, status: s.lint, problems: s.lintProblems })),
      risk: index.skills
        .filter((s) => s.risk !== "none")
        .map((s) => ({ id: s.id, name: s.name, drawer: s.drawerLabel, risk: s.risk, findings: s.findings })),
    };
  }));

  app.get("/api/skills/:id", wrap((req) => readSkill(findSkill(req.params.id).skill)));

  app.get("/api/skills/:id/file", wrap((req) => {
    const rel = String(req.query.path || "");
    if (!rel) throw httpError(400, "Missing path");
    return readSkillFile(findSkill(req.params.id).skill, rel);
  }));

  app.put("/api/skills/:id/file", wrap((req) => {
    const rel = String(req.body?.path || "");
    const content = req.body?.content;
    if (!rel) throw httpError(400, "Missing path");
    if (typeof content !== "string") throw httpError(400, "Missing content");
    const { skill } = findSkill(req.params.id);
    const out = writeSkillFile(skill, rel, content);
    invalidate();
    return out;
  }));

  app.post("/api/skills", wrap((req) => {
    const index = getIndex();
    const name = slugify(req.body?.name);
    if (!name) throw httpError(400, "A skill name is required");
    const drawer = req.body?.drawerId ? drawerFor(index, req.body.drawerId) : defaultDrawer(index);
    if (!drawer) throw httpError(400, "No writable drawer found");
    const dir = path.join(drawer.root, name);
    if (exists(dir)) throw httpError(409, `${dir} already exists`);
    const description = String(req.body?.description || "Describe what this skill does and when to use it.");
    const body = String(req.body?.body || `# ${name}\n\nInstructions for the agent go here.\n`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), stringifyFrontmatter({ name, description }, body));
    invalidate();
    const created = getIndex().skills.find((s) => s.path === dir);
    return { created: created ? toCatalogSkill(created) : { path: dir } };
  }));

  app.post("/api/skills/:id/rename", wrap((req) => {
    const name = slugify(req.body?.name);
    if (!name) throw httpError(400, "A new name is required");
    const { index, skill } = findSkill(req.params.id, true);
    if (skill.disabled) throw httpError(400, "Enable the skill before renaming it");
    if (!skill.writable) throw httpError(403, "This skill is read-only");
    const target = assertMutable(skill, index.drawers);
    const dest = skill.file ? path.join(path.dirname(target), `${name}.md`) : path.join(path.dirname(target), name);
    if (dest !== target && exists(dest)) throw httpError(409, `${dest} already exists`);
    if (dest !== target) fs.renameSync(target, dest);
    const skillFile = skill.file ? dest : findSkillFile(dest);
    if (skillFile && req.body?.updateFrontmatter !== false) {
      fs.writeFileSync(skillFile, setFrontmatterName(fs.readFileSync(skillFile, "utf8"), name));
    }
    invalidate();
    const renamed = getIndex().skills.find((s) => s.path === dest);
    return { renamed: renamed ? toCatalogSkill(renamed) : { path: dest } };
  }));

  app.post("/api/skills/:id/open", wrap((req) => {
    const { skill } = findSkill(req.params.id);
    const editor = process.env.SKILL_DRAWER_EDITOR || process.env.VISUAL || process.env.EDITOR;
    if (!editor) throw httpError(400, "Set SKILL_DRAWER_EDITOR, VISUAL or EDITOR to open skills in an editor");
    const [cmd, ...args] = editor.split(/\s+/);
    try {
      spawn(cmd, [...args, skill.path], { stdio: "ignore", detached: true, shell: false }).unref();
    } catch (err) {
      throw httpError(500, `Could not launch ${editor}: ${err.message}`);
    }
    return { opened: skill.path, editor };
  }));

  const removeIds = (ids, permanent) => {
    const index = getIndex(true);
    const removed = [];
    const errors = [];
    for (const id of ids) {
      const s = index.byId.get(id);
      if (!s) {
        errors.push({ id, error: "Skill not in the drawer" });
        continue;
      }
      try {
        if (s.disabled) {
          purge("disabled", s.disabledEntry);
          removed.push({ id, name: s.name, path: s.originalPath, permanent: true });
          continue;
        }
        const target = assertMutable(s, index.drawers);
        if (permanent) {
          removePath(target);
          removed.push({ id, name: s.name, path: target, permanent: true });
        } else {
          const entry = stash("trash", s);
          removed.push({ id, name: s.name, path: target, permanent: false, trashEntry: entry.entryId });
        }
      } catch (err) {
        errors.push({ id, error: err.message, path: s.path });
      }
    }
    invalidate();
    return { removed, errors };
  };

  app.delete("/api/skills/:id", wrap((req, res) => {
    const out = removeIds([req.params.id], req.query.permanent === "1");
    res.status(out.removed.length ? 200 : 400);
    return out;
  }));

  app.post("/api/skills/delete", wrap((req) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    if (!ids.length) throw httpError(400, "No skills selected");
    return removeIds(ids, Boolean(req.body?.permanent));
  }));

  app.post("/api/skills/:id/disable", wrap((req) => {
    const { index, skill } = findSkill(req.params.id, true);
    if (skill.disabled) throw httpError(400, "Already disabled");
    if (skill.kind === "builtin" || skill.kind === "plugin") {
      throw httpError(403, "Tool-managed skills come back on the next update; disable them in the tool instead");
    }
    assertMutable(skill, index.drawers);
    const entry = stash("disabled", skill);
    invalidate();
    return { disabled: { id: skill.id, name: skill.name, entryId: entry.entryId } };
  }));

  app.post("/api/skills/:id/enable", wrap((req) => {
    const { skill } = findSkill(req.params.id, true);
    if (!skill.disabled) throw httpError(400, "Skill is not disabled");
    const out = restore("disabled", skill.disabledEntry);
    invalidate();
    return { enabled: { id: skill.id, name: skill.name, path: out.restoredTo } };
  }));

  app.post("/api/skills/disable", wrap((req) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    const index = getIndex(true);
    const done = [];
    const errors = [];
    for (const id of ids) {
      const s = index.byId.get(id);
      if (!s || s.disabled) {
        errors.push({ id, error: s ? "Already disabled" : "Skill not in the drawer" });
        continue;
      }
      try {
        if (s.kind === "builtin" || s.kind === "plugin") throw new Error("Tool-managed skill");
        assertMutable(s, index.drawers);
        stash("disabled", s);
        done.push({ id, name: s.name });
      } catch (err) {
        errors.push({ id, error: err.message });
      }
    }
    invalidate();
    return { disabled: done, errors };
  }));

  app.get("/api/trash", wrap(() => ({ root: storeRoot("trash"), entries: listStore("trash") })));
  app.post("/api/trash/:entry/restore", wrap((req) => {
    const out = restore("trash", req.params.entry, { target: req.body?.target });
    invalidate();
    return { restored: out };
  }));
  app.delete("/api/trash/:entry", wrap((req) => {
    const out = purge("trash", req.params.entry);
    invalidate();
    return { purged: out };
  }));
  app.delete("/api/trash", wrap(() => {
    const count = purgeAll("trash");
    invalidate();
    return { purged: count };
  }));

  app.get("/api/export", wrap((req, res) => {
    const index = getIndex();
    const ids = String(req.query.ids || "").split(",").filter(Boolean);
    const skills = ids.length ? index.skills.filter((s) => ids.includes(s.id)) : index.skills.filter((s) => !s.disabled);
    const bundle = req.query.format === "bundle";
    const out = exportManifest(skills, { includeFiles: bundle });
    res.setHeader("Content-Disposition", `attachment; filename="skill-drawer-${bundle ? "bundle" : "manifest"}.json"`);
    return out;
  }));

  app.post("/api/import", wrap((req) => {
    const index = getIndex();
    const data = parseManifest(req.body?.data ?? req.body);
    const drawer = req.body?.drawerId ? drawerFor(index, req.body.drawerId) : defaultDrawer(index);
    if (!drawer) throw httpError(400, "No writable drawer found");
    const result = importManifest(data, { drawerRoot: drawer.root, overwrite: Boolean(req.body?.overwrite), only: req.body?.only || null });
    const installed = [];
    if (req.body?.fetchMissing) {
      for (const item of result.needsInstall) {
        try {
          const r = installSkills(item.origin.url, { drawerRoot: drawer.root, only: [item.slug] });
          installed.push(...r.installed);
        } catch (err) {
          result.skipped.push({ name: item.name, reason: err.message });
        }
      }
    }
    invalidate();
    return { ...result, installed, drawer: drawer.label };
  }));

  app.post("/api/install", wrap((req) => {
    const index = getIndex();
    const drawer = req.body?.drawerId ? drawerFor(index, req.body.drawerId) : defaultDrawer(index);
    if (!drawer) throw httpError(400, "No writable drawer found");
    const result = installSkills(req.body?.source, {
      drawerRoot: drawer.root,
      overwrite: Boolean(req.body?.overwrite),
      only: Array.isArray(req.body?.only) ? req.body.only : null,
    });
    invalidate();
    return { ...result, drawer: drawer.label };
  }));

  app.get("/api/drawers", wrap(() => getIndex().drawers));

  // Static UI + vendored browser libs (no build step).
  app.use("/vendor/marked", express.static(pkgRoot("marked")));
  app.use("/vendor/dompurify", express.static(pkgRoot("dompurify")));
  const web = path.join(ROOT, "web");
  app.use(express.static(web));
  app.use((req, res) => {
    if (req.path.startsWith("/api")) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.sendFile(path.join(web, "index.html"));
  });
  return app;
}

function openBrowser(url) {
  const platform = process.platform;
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* no browser available */
  }
}

export function startServer(options = {}) {
  const port = Number(options.port ?? process.env.PORT ?? 3782);
  const host = options.host || "127.0.0.1";
  const app = createApp(options);
  return new Promise((resolve, reject) => {
    const attempt = (p, left) => {
      const server = app.listen(p, host);
      server.on("listening", () => {
        const url = `http://${host}:${server.address().port}`;
        if (!options.quiet) {
          console.log(`Skill Drawer at ${url}${options.readOnly ? " (read-only)" : ""}`);
        }
        if (options.open !== false && process.env.SKILL_DRAWER_NO_OPEN !== "1") openBrowser(url);
        resolve({ server, url, app });
      });
      server.on("error", (err) => {
        if (err.code === "EADDRINUSE" && !options.port && !process.env.PORT && left > 0) {
          attempt(p + 1, left - 1);
          return;
        }
        reject(new Error(`Could not bind ${host}:${p}: ${err.message}`));
      });
    };
    attempt(port, 20);
  });
}
