/* Skill Drawer UI — vanilla JS, no build step. */
(() => {
  "use strict";

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtBytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
  const fmtDate = (ms) => (ms ? new Date(ms).toLocaleString() : "—");
  const ago = (ms) => {
    if (!ms) return "—";
    const d = Date.now() - ms;
    const m = Math.round(d / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h}h ago`;
    const days = Math.round(h / 24);
    if (days < 60) return `${days}d ago`;
    return `${Math.round(days / 30)}mo ago`;
  };

  const state = {
    data: null,
    skills: [],
    filtered: [],
    drawer: "all",
    query: "",
    sort: "drawer",
    filters: { lint: false, risk: false, dupes: false, disabled: true },
    activeId: null,
    marked: new Set(),
    detail: null,
    tab: "rendered",
    editorDirty: false,
  };

  /* ---------- API ---------- */
  async function api(path, opts = {}) {
    const res = await fetch(path, {
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
      ...opts,
      body: opts.body && typeof opts.body !== "string" ? JSON.stringify(opts.body) : opts.body,
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok) throw new Error(body?.error || `${res.status} ${res.statusText}`);
    return body;
  }

  /* ---------- Toasts ---------- */
  function toast(message, { kind = "", action, onAction, timeout = 6000 } = {}) {
    const root = $("#toast-root");
    const el = document.createElement("div");
    el.className = `toast ${kind}`;
    el.innerHTML = `<span>${esc(message)}</span>${action ? `<button class="btn btn-sm">${esc(action)}</button>` : ""}`;
    if (action) $("button", el).onclick = () => { onAction?.(); el.remove(); };
    root.appendChild(el);
    setTimeout(() => el.remove(), timeout);
  }

  /* ---------- Modals ---------- */
  function modal({ title, body, footer, wide = false, onOpen }) {
    const root = $("#modal-root");
    const back = document.createElement("div");
    back.className = "modal-backdrop";
    back.innerHTML = `<div class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true">
      <div class="modal-head"><span>${esc(title)}</span><button class="btn btn-sm" data-close>Esc</button></div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ""}
    </div>`;
    const close = () => { back.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    back.addEventListener("click", (e) => { if (e.target === back) close(); });
    $("[data-close]", back).onclick = close;
    document.addEventListener("keydown", onKey);
    root.appendChild(back);
    onOpen?.(back, close);
    return { el: back, close };
  }

  function confirm({ title, message, ok = "OK", danger = false }) {
    return new Promise((resolve) => {
      const m = modal({
        title,
        body: `<div>${message}</div>`,
        footer: `<button class="btn" data-cancel>Cancel</button><button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-ok>${esc(ok)}</button>`,
        onOpen(el, close) {
          $("[data-cancel]", el).onclick = () => { close(); resolve(false); };
          $("[data-ok]", el).onclick = () => { close(); resolve(true); };
          $("[data-ok]", el).focus();
        },
      });
      m.el.addEventListener("keydown", (e) => { if (e.key === "Enter") { m.close(); resolve(true); } });
    });
  }

  function prompt({ title, label, value = "", ok = "Save", placeholder = "" }) {
    return new Promise((resolve) => {
      modal({
        title,
        body: `<div class="field"><label>${esc(label)}</label><input id="prompt-input" value="${esc(value)}" placeholder="${esc(placeholder)}" /></div>`,
        footer: `<button class="btn" data-cancel>Cancel</button><button class="btn btn-primary" data-ok>${esc(ok)}</button>`,
        onOpen(el, close) {
          const input = $("#prompt-input", el);
          input.focus();
          input.select();
          $("[data-cancel]", el).onclick = () => { close(); resolve(null); };
          $("[data-ok]", el).onclick = () => { close(); resolve(input.value); };
          input.addEventListener("keydown", (e) => { if (e.key === "Enter") { close(); resolve(input.value); } });
        },
      });
    });
  }

  function drawerOptions(selectedId) {
    const writable = (state.data?.drawers || []).filter((d) => d.writable);
    const def = writable.find((d) => /\.claude\/skills$/.test(d.root)) || writable[0];
    return writable
      .map((d) => `<option value="${esc(d.id)}" ${(selectedId || def?.id) === d.id ? "selected" : ""}>${esc(d.label)} — ${esc(d.root)}</option>`)
      .join("");
  }

  /* ---------- Loading ---------- */
  async function load(refresh = false) {
    try {
      const data = await api(`/api/skills${refresh ? "?refresh=1" : ""}`);
      state.data = data;
      state.skills = data.skills;
      $("#readonly-badge").hidden = !data.readOnly;
      document.body.classList.toggle("read-only", data.readOnly);
      for (const id of Array.from(state.marked)) if (!data.skills.some((s) => s.id === id)) state.marked.delete(id);
      renderDrawers();
      renderCensus();
      applyFilters();
      if (state.activeId && !state.skills.some((s) => s.id === state.activeId)) {
        state.activeId = null;
        state.detail = null;
        renderDetail();
      } else if (state.activeId && refresh) {
        openSkill(state.activeId, { keepTab: true });
      }
    } catch (err) {
      toast(`Could not load skills: ${err.message}`, { kind: "err" });
    }
  }

  /* ---------- Sidebar ---------- */
  function renderDrawers() {
    const { drawers, census } = state.data;
    const total = state.skills.filter((s) => !s.disabled).length;
    const items = [{ id: "all", label: "All drawers", count: total, kind: "" }];
    for (const d of drawers) items.push(d);
    if (census.disabled) items.push({ id: "__disabled", label: "Disabled", count: census.disabled, kind: "quarantine" });
    $("#drawers").innerHTML = items
      .map(
        (d) => `<button class="drawer-item ${state.drawer === d.id ? "active" : ""}" data-drawer="${esc(d.id)}" title="${esc(d.root || "")}">
          <span class="label">${esc(d.label)}</span>
          <span class="right"><span class="kind">${esc(d.kind === "user" ? "" : d.kind)}</span><span class="count">${d.count}</span></span>
        </button>`,
      )
      .join("");
    $$("[data-drawer]").forEach((b) => (b.onclick = () => { state.drawer = b.dataset.drawer; renderDrawers(); applyFilters(); }));
  }

  function renderCensus() {
    const c = state.data.census;
    $("#census").innerHTML = `
      <div><b>${c.active}</b> active, <b>${c.disabled}</b> disabled</div>
      <div><b>${c.unique}</b> unique, <b>${c.duplicates}</b> duplicate copies</div>
      <div><b>${c.lintErrors}</b> lint errors, <b>${c.lintWarnings}</b> warnings</div>
      <div><b>${c.risky}</b> high/critical risk</div>
      <div><b>${c.conflicts}</b> conflicts · <b>${c.trash}</b> in trash</div>
      <div class="mono" style="margin-top:6px;font-size:11px">store: ${esc(state.data.storeHome)}</div>
      <div class="mono" style="font-size:11px">cwd: ${esc(state.data.cwd)}</div>`;
    const issues = c.conflicts + c.lintErrors + c.lintWarnings + c.risky;
    $("#issue-count").hidden = !issues;
    $("#issue-count").textContent = issues;
    $("#trash-count").hidden = !c.trash;
    $("#trash-count").textContent = c.trash;
  }

  /* ---------- Filtering & list ---------- */
  const RISK = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };
  const LINT = { ok: 0, info: 1, warning: 2, error: 3 };

  function matches(s, q) {
    if (!q) return true;
    const hay = [s.name, s.slug, s.description, s.path, s.drawerLabel, JSON.stringify(s.frontmatter || {})].join("\n").toLowerCase();
    return q.split(/\s+/).every((term) => hay.includes(term));
  }

  function applyFilters() {
    const q = state.query.trim().toLowerCase();
    let list = state.skills.filter((s) => {
      if (state.drawer === "__disabled") return s.disabled;
      if (!state.filters.disabled && s.disabled) return false;
      if (state.drawer !== "all" && s.drawerId !== state.drawer) return false;
      if (state.filters.lint && s.lint === "ok") return false;
      if (state.filters.risk && s.risk === "none") return false;
      if (state.filters.dupes && !s.copyCount) return false;
      return matches(s, q);
    });
    const by = {
      drawer: (a, b) => a.drawerLabel.localeCompare(b.drawerLabel) || a.name.localeCompare(b.name),
      name: (a, b) => a.name.localeCompare(b.name),
      mtime: (a, b) => b.mtime - a.mtime,
      ctime: (a, b) => b.ctime - a.ctime,
      size: (a, b) => b.bytes - a.bytes,
      risk: (a, b) => RISK[b.risk] - RISK[a.risk] || a.name.localeCompare(b.name),
      lint: (a, b) => LINT[b.lint] - LINT[a.lint] || b.lintCount - a.lintCount,
    };
    list.sort(by[state.sort] || by.drawer);
    state.filtered = list;
    renderList();
  }

  function badges(s) {
    const out = [];
    if (s.disabled) out.push(`<span class="badge badge-muted">disabled</span>`);
    if (s.lint === "error") out.push(`<span class="badge badge-err" title="Lint errors">${s.lintCount} lint</span>`);
    else if (s.lint === "warning") out.push(`<span class="badge badge-warn" title="Lint warnings">${s.lintCount} lint</span>`);
    if (RISK[s.risk] >= 3) out.push(`<span class="badge badge-err">${esc(s.risk)} risk</span>`);
    else if (RISK[s.risk] >= 1) out.push(`<span class="badge badge-warn">${esc(s.risk)} risk</span>`);
    if (s.copyCount) out.push(`<span class="badge badge-info" title="Identical copies elsewhere">${s.copyCount} cop${s.copyCount === 1 ? "y" : "ies"}</span>`);
    if (s.link) out.push(`<span class="badge">symlink</span>`);
    if (s.file) out.push(`<span class="badge">file</span>`);
    if (s.scope === "project") out.push(`<span class="badge badge-ok">project</span>`);
    if (!s.writable && !s.disabled) out.push(`<span class="badge badge-muted">${esc(s.kind)}</span>`);
    return out.join("");
  }

  function renderList() {
    const list = $("#list");
    $("#list-summary").textContent = `${state.filtered.length} skill${state.filtered.length === 1 ? "" : "s"}`;
    if (!state.filtered.length) {
      list.innerHTML = `<div class="empty">${state.skills.length ? "Nothing matches." : "No skills found in any drawer. Install one or create a new skill."}</div>`;
    } else {
      list.innerHTML = state.filtered
        .map(
          (s) => `<div class="skill-card ${s.id === state.activeId ? "active" : ""} ${state.marked.has(s.id) ? "marked" : ""} ${s.disabled ? "disabled" : ""}" data-id="${s.id}">
            <input type="checkbox" data-mark="${s.id}" ${state.marked.has(s.id) ? "checked" : ""} aria-label="Mark ${esc(s.name)}" />
            <div>
              <div class="name">${esc(s.name)} ${badges(s)}</div>
              <div class="desc">${esc(s.description || "No description")}</div>
              <div class="meta"><span>${esc(s.drawerLabel)}</span><span title="${fmtDate(s.mtime)}">${ago(s.mtime)}</span><span>${fmtBytes(s.bytes)}</span>${s.origin ? `<span title="${esc(s.origin.url)}">${esc(s.origin.label)}</span>` : ""}</div>
            </div>
          </div>`,
        )
        .join("");
    }
    $$("[data-id]", list).forEach((card) => {
      card.onclick = (e) => {
        if (e.target.matches("input")) return;
        openSkill(card.dataset.id);
      };
    });
    $$("[data-mark]", list).forEach((cb) => {
      cb.onchange = () => { toggleMark(cb.dataset.mark, cb.checked); };
    });
    renderBulk();
    const all = $("#select-all");
    all.checked = state.filtered.length > 0 && state.filtered.every((s) => state.marked.has(s.id));
    all.indeterminate = !all.checked && state.filtered.some((s) => state.marked.has(s.id));
  }

  function toggleMark(id, on) {
    if (on === undefined) on = !state.marked.has(id);
    if (on) state.marked.add(id);
    else state.marked.delete(id);
    const card = $(`.skill-card[data-id="${id}"]`);
    if (card) { card.classList.toggle("marked", on); $("input", card).checked = on; }
    renderBulk();
  }

  function renderBulk() {
    const n = state.marked.size;
    $("#bulk").hidden = !n;
    $("#bulk-count").textContent = `${n} marked`;
  }

  /* ---------- Detail ---------- */
  async function openSkill(id, { keepTab = false } = {}) {
    if (state.editorDirty && state.activeId !== id) {
      if (!(await confirm({ title: "Discard changes?", message: "You have unsaved edits in the editor.", ok: "Discard", danger: true }))) return;
      state.editorDirty = false;
    }
    state.activeId = id;
    if (!keepTab) state.tab = state.tab === "edit" ? "rendered" : state.tab;
    $$(".skill-card").forEach((c) => c.classList.toggle("active", c.dataset.id === id));
    $(`.skill-card[data-id="${id}"]`)?.scrollIntoView({ block: "nearest" });
    try {
      state.detail = await api(`/api/skills/${id}`);
      renderDetail();
    } catch (err) {
      toast(err.message, { kind: "err" });
    }
  }

  function renderMarkdown(md) {
    const html = window.marked ? window.marked.parse(md, { gfm: true, breaks: false }) : `<pre>${esc(md)}</pre>`;
    return window.DOMPurify ? window.DOMPurify.sanitize(html, { USE_PROFILES: { html: true } }) : esc(md);
  }

  function renderDetail() {
    const pane = $("#detail");
    const s = state.detail;
    if (!s) {
      pane.innerHTML = `<div class="empty">Select a skill to read it. Press <kbd>?</kbd> for shortcuts.</div>`;
      return;
    }
    const ro = state.data.readOnly;
    const tabs = [
      ["rendered", "Rendered"],
      ["source", "Source"],
      ["frontmatter", "Frontmatter"],
      ["files", `Files (${s.files.length})`],
      ["health", `Health${s.lintProblems.length + s.findings.length ? ` (${s.lintProblems.length + s.findings.length})` : ""}`],
      ["edit", "Edit"],
    ];
    const actions = [];
    if (!ro) {
      if (s.disabled) actions.push(`<button class="btn btn-sm btn-primary" data-act="enable">Enable</button>`);
      else if (s.kind === "user" || s.kind === "project" || s.kind === "extra") actions.push(`<button class="btn btn-sm" data-act="disable" title="Move to quarantine; the tool stops loading it (e)">Disable</button>`);
      if (s.writable && !s.disabled) actions.push(`<button class="btn btn-sm" data-act="rename">Rename</button>`);
      actions.push(`<button class="btn btn-sm" data-act="open" title="Open in $EDITOR">Open in editor</button>`);
      actions.push(`<button class="btn btn-sm" data-act="export">Export</button>`);
      if (s.disabled) actions.push(`<button class="btn btn-sm btn-danger" data-act="delete-permanent">Delete permanently</button>`);
      else {
        actions.push(`<button class="btn btn-sm btn-danger" data-act="delete" title="Move to trash (d)">Trash</button>`);
        actions.push(`<button class="btn btn-sm" data-act="delete-permanent" title="Skip the trash">Delete permanently</button>`);
      }
    } else {
      actions.push(`<button class="btn btn-sm" data-act="export">Export</button>`);
    }
    pane.innerHTML = `
      <div class="detail-head">
        <div class="detail-title"><h1>${esc(s.name)}</h1>${badges(s)}${s.origin ? `<a href="${esc(s.origin.url)}" target="_blank" rel="noopener" class="badge" title="${esc(s.origin.via)} (${esc(s.origin.certainty)})">${esc(s.origin.label)}</a>` : ""}</div>
        <div class="detail-path">${esc(s.disabled ? `${s.originalPath}  (disabled, stored at ${s.path})` : s.path)}${s.link ? ` → ${esc(s.linkTarget)}` : ""}</div>
        <div class="detail-actions">${actions.join("")}</div>
        <div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${state.tab === k ? "active" : ""}" data-tab="${k}">${l}</button>`).join("")}</div>
      </div>
      <div class="detail-body ${state.tab === "rendered" ? "rendered" : ""}" id="detail-body"></div>`;
    $$("[data-tab]", pane).forEach((b) => (b.onclick = () => { state.tab = b.dataset.tab; renderDetail(); }));
    $$("[data-act]", pane).forEach((b) => (b.onclick = () => doAction(b.dataset.act, s)));
    renderTab();
  }

  function renderTab() {
    const s = state.detail;
    const body = $("#detail-body");
    const ro = state.data.readOnly;
    switch (state.tab) {
      case "rendered": {
        body.innerHTML = s.description ? `<p class="muted"><em>${esc(s.description)}</em></p>${renderMarkdown(s.body)}` : renderMarkdown(s.body);
        break;
      }
      case "source": {
        body.innerHTML = `<pre>${esc(s.source)}</pre>`;
        break;
      }
      case "frontmatter": {
        const entries = Object.entries(s.frontmatter || {});
        body.innerHTML = `
          ${s.frontmatterError ? `<div class="problem error">${esc(s.frontmatterError)}</div>` : ""}
          ${entries.length ? `<div class="kv">${entries.map(([k, v]) => `<div class="k">${esc(k)}</div><div class="v">${esc(typeof v === "string" ? v : JSON.stringify(v, null, 2))}</div>`).join("")}</div>` : `<p class="muted">No frontmatter.</p>`}
          <div class="section-title">Raw</div><pre>${esc(s.frontmatterRaw || "")}</pre>
          <div class="section-title">Signals</div>
          <div class="kv">
            <div class="k">modified</div><div class="v">${fmtDate(s.mtime)} (${ago(s.mtime)})</div>
            <div class="k">added</div><div class="v">${fmtDate(s.ctime)}</div>
            <div class="k">last read</div><div class="v">${fmtDate(s.atime)} <span class="muted">(atime; may be unreliable)</span></div>
            <div class="k">size</div><div class="v">${fmtBytes(s.bytes)} across ${s.files.length} file${s.files.length === 1 ? "" : "s"}</div>
            <div class="k">sha256</div><div class="v">${esc(s.contentHash)}</div>
            ${s.copies.length ? `<div class="k">copies</div><div class="v">${s.copies.map((c) => `<a data-goto="${c.id}">${esc(c.path)}</a>`).join("\n")}</div>` : ""}
          </div>`;
        $$("[data-goto]", body).forEach((a) => (a.onclick = () => openSkill(a.dataset.goto)));
        break;
      }
      case "files": {
        body.innerHTML = `<ul class="file-list">${s.files
          .map((f) => `<li><a data-file="${esc(f.path)}">${esc(f.path)}</a><span class="size">${fmtBytes(f.size)}</span></li>`)
          .join("")}</ul><div id="file-view"></div>`;
        $$("[data-file]", body).forEach((a) => (a.onclick = async () => {
          try {
            const f = await api(`/api/skills/${s.id}/file?path=${encodeURIComponent(a.dataset.file)}`);
            $("#file-view").innerHTML = `<div class="section-title">${esc(f.path)}</div>${f.binary ? `<p class="muted">Binary file (${fmtBytes(f.size)})</p>` : `<pre>${esc(f.content)}</pre>`}`;
          } catch (err) {
            toast(err.message, { kind: "err" });
          }
        }));
        break;
      }
      case "health": {
        const lint = s.lintProblems.length
          ? s.lintProblems.map((p) => `<div class="problem ${p.level}"><div>${esc(p.message)}</div><div class="rule">${esc(p.level)} · ${esc(p.rule)}</div></div>`).join("")
          : `<p class="muted">Frontmatter and structure look good.</p>`;
        const risk = s.findings.length
          ? s.findings.map((f) => `<div class="problem ${f.severity}"><div>${esc(f.message)}</div><div class="rule">${esc(f.severity)} · ${esc(f.rule)} · ${esc(f.file)}:${f.line}${f.context === "denylist" ? " · in a do-not instruction" : ""}</div><div class="snippet">${esc(f.snippet)}</div></div>`).join("")
          : `<p class="muted">No risky instructions found.</p>`;
        body.innerHTML = `<div class="section-title">Lint</div>${lint}<div class="section-title">Risk audit (heuristic)</div>${risk}`;
        break;
      }
      case "edit": {
        if (ro || !s.writable) {
          body.innerHTML = `<p class="muted">${ro ? "Read-only mode: editing is disabled." : "This skill is tool-managed or symlinked; edit it at its source instead."}</p><pre>${esc(s.source)}</pre>`;
          break;
        }
        const fileOptions = s.files.map((f) => `<option value="${esc(f.path)}" ${f.path === s.skillRel ? "selected" : ""}>${esc(f.path)}</option>`).join("");
        body.innerHTML = `
          <div class="editor-bar">
            <select id="edit-file" class="select">${fileOptions}</select>
            <span class="grow muted" id="edit-status"></span>
            <button class="btn btn-sm" id="edit-revert">Revert</button>
            <button class="btn btn-sm btn-primary" id="edit-save">Save (⌘/Ctrl+S)</button>
          </div>
          <textarea class="editor" id="editor" spellcheck="false"></textarea>`;
        const editor = $("#editor");
        const sel = $("#edit-file");
        let original = "";
        const loadFile = async () => {
          try {
            const f = await api(`/api/skills/${s.id}/file?path=${encodeURIComponent(sel.value)}`);
            original = f.binary ? "" : f.content;
            editor.value = original;
            editor.disabled = f.binary;
            $("#edit-status").textContent = f.binary ? "Binary file" : "";
            state.editorDirty = false;
          } catch (err) {
            toast(err.message, { kind: "err" });
          }
        };
        const save = async () => {
          try {
            await api(`/api/skills/${s.id}/file`, { method: "PUT", body: { path: sel.value, content: editor.value } });
            original = editor.value;
            state.editorDirty = false;
            $("#edit-status").textContent = `Saved ${new Date().toLocaleTimeString()}`;
            toast(`Saved ${sel.value}`, { kind: "ok" });
            const keepTab = true;
            await load(true);
            if (state.tab !== "edit") return;
            void keepTab;
          } catch (err) {
            toast(err.message, { kind: "err" });
          }
        };
        editor.addEventListener("input", () => { state.editorDirty = editor.value !== original; $("#edit-status").textContent = state.editorDirty ? "Unsaved changes" : ""; });
        editor.addEventListener("keydown", (e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); save(); }
          if (e.key === "Tab") { e.preventDefault(); const st = editor.selectionStart; editor.setRangeText("  ", st, editor.selectionEnd, "end"); editor.dispatchEvent(new Event("input")); }
        });
        sel.onchange = loadFile;
        $("#edit-save").onclick = save;
        $("#edit-revert").onclick = () => { editor.value = original; state.editorDirty = false; $("#edit-status").textContent = ""; };
        loadFile();
        break;
      }
    }
  }

  /* ---------- Actions ---------- */
  async function doAction(act, s) {
    try {
      switch (act) {
        case "delete": return removeSkills([s.id], false);
        case "delete-permanent": return removeSkills([s.id], true);
        case "disable": {
          const r = await api(`/api/skills/${s.id}/disable`, { method: "POST" });
          toast(`Disabled ${r.disabled.name}`, { kind: "ok", action: "Undo", onAction: () => api(`/api/skills/${s.id}/enable`, { method: "POST" }).then(() => load(true)) });
          await load(true);
          return;
        }
        case "enable": {
          const r = await api(`/api/skills/${s.id}/enable`, { method: "POST" });
          toast(`Enabled ${r.enabled.name}`, { kind: "ok" });
          await load(true);
          return;
        }
        case "rename": {
          const name = await prompt({ title: "Rename skill", label: "New name (lowercase, hyphens). The folder and frontmatter `name` are both updated.", value: s.slug, ok: "Rename" });
          if (!name || name === s.slug) return;
          const r = await api(`/api/skills/${s.id}/rename`, { method: "POST", body: { name } });
          toast(`Renamed to ${r.renamed.name || name}`, { kind: "ok" });
          state.activeId = r.renamed.id || null;
          await load(true);
          return;
        }
        case "open": {
          const r = await api(`/api/skills/${s.id}/open`, { method: "POST" });
          toast(`Opened in ${r.editor}`, { kind: "ok" });
          return;
        }
        case "export": return exportDialog([s.id]);
      }
    } catch (err) {
      toast(err.message, { kind: "err" });
    }
  }

  async function removeSkills(ids, permanent) {
    const names = ids.map((id) => state.skills.find((s) => s.id === id)?.name || id);
    const label = names.length === 1 ? `"${names[0]}"` : `${names.length} skills`;
    const ok = await confirm({
      title: permanent ? "Delete permanently?" : "Move to trash?",
      message: permanent
        ? `<p>${esc(label)} will be removed from disk. <b>This cannot be undone.</b></p>`
        : `<p>${esc(label)} will be moved to <code>${esc(state.data.storeHome)}/trash</code>. You can restore it later from Trash.</p>`,
      ok: permanent ? "Delete" : "Trash",
      danger: true,
    });
    if (!ok) return;
    try {
      const r = await api("/api/skills/delete", { method: "POST", body: { ids, permanent } });
      for (const id of ids) state.marked.delete(id);
      if (r.errors.length) toast(r.errors.map((e) => e.error).join("; "), { kind: "err", timeout: 9000 });
      if (r.removed.length) {
        const entry = r.removed.length === 1 ? r.removed[0].trashEntry : null;
        toast(`${permanent ? "Deleted" : "Trashed"} ${r.removed.length} skill${r.removed.length === 1 ? "" : "s"}`, {
          kind: "ok",
          action: entry ? "Undo" : undefined,
          onAction: entry ? () => api(`/api/trash/${entry}/restore`, { method: "POST" }).then(() => load(true)).catch((e) => toast(e.message, { kind: "err" })) : undefined,
        });
      }
      if (ids.includes(state.activeId)) { state.activeId = null; state.detail = null; renderDetail(); }
      await load(true);
    } catch (err) {
      toast(err.message, { kind: "err" });
    }
  }

  async function bulkDisable(ids) {
    try {
      const r = await api("/api/skills/disable", { method: "POST", body: { ids } });
      if (r.errors.length) toast(r.errors.map((e) => e.error).join("; "), { kind: "err" });
      toast(`Disabled ${r.disabled.length} skill${r.disabled.length === 1 ? "" : "s"}`, { kind: "ok" });
      state.marked.clear();
      await load(true);
    } catch (err) {
      toast(err.message, { kind: "err" });
    }
  }

  /* ---------- Dialogs ---------- */
  function exportDialog(ids) {
    const scope = ids?.length ? `${ids.length} selected skill${ids.length === 1 ? "" : "s"}` : "all active skills";
    modal({
      title: "Export",
      body: `<p>Export ${esc(scope)} as:</p>
        <p><b>Manifest</b> — names, drawers, origins and content hashes. Small; reproducible when skills came from GitHub.</p>
        <p><b>Bundle</b> — manifest plus every file's contents. Restores exactly, anywhere, without network access.</p>`,
      footer: `<a class="btn" href="/api/export?format=manifest${ids?.length ? `&ids=${ids.join(",")}` : ""}" download>Manifest</a>
               <a class="btn btn-primary" href="/api/export?format=bundle${ids?.length ? `&ids=${ids.join(",")}` : ""}" download>Bundle</a>`,
    });
  }

  function importDialog() {
    modal({
      title: "Import manifest or bundle",
      body: `<div class="field"><label>File</label><input type="file" id="import-file" accept="application/json,.json" /></div>
        <div class="field"><label>Or paste JSON</label><textarea id="import-text" placeholder='{"format":"skill-drawer-bundle", ...}'></textarea></div>
        <div class="field"><label>Into drawer</label><select id="import-drawer">${drawerOptions()}</select></div>
        <label class="check"><input type="checkbox" id="import-overwrite" /> Overwrite skills that already exist</label>
        <label class="check"><input type="checkbox" id="import-fetch" checked /> Fetch manifest-only entries from their GitHub origin (needs git)</label>
        <div id="import-result"></div>`,
      footer: `<button class="btn btn-primary" id="import-go">Import</button>`,
      onOpen(el, close) {
        $("#import-go", el).onclick = async () => {
          try {
            let text = $("#import-text", el).value.trim();
            const file = $("#import-file", el).files[0];
            if (file) text = await file.text();
            if (!text) throw new Error("Choose a file or paste JSON");
            $("#import-go", el).disabled = true;
            const r = await api("/api/import", {
              method: "POST",
              body: { data: JSON.parse(text), drawerId: $("#import-drawer", el).value, overwrite: $("#import-overwrite", el).checked, fetchMissing: $("#import-fetch", el).checked },
            });
            $("#import-result", el).innerHTML = resultList(r);
            $("#import-go", el).disabled = false;
            await load(true);
          } catch (err) {
            $("#import-go", el).disabled = false;
            toast(err.message, { kind: "err" });
          }
        };
      },
    });
  }

  function resultList(r) {
    const rows = [];
    for (const w of r.written || []) rows.push(`<li>imported <b>${esc(w.name)}</b> → <span class="mono">${esc(w.path)}</span></li>`);
    for (const i of r.installed || []) rows.push(`<li>installed <b>${esc(i.slug)}</b> → <span class="mono">${esc(i.path)}</span></li>`);
    for (const s of r.skipped || []) rows.push(`<li class="muted">skipped ${esc(s.name || s.slug)}: ${esc(s.reason)}</li>`);
    for (const n of r.needsInstall || []) rows.push(`<li class="muted">${esc(n.name)} needs installing from ${esc(n.origin?.url)}</li>`);
    return `<ul>${rows.join("") || "<li>Nothing to do.</li>"}</ul>`;
  }

  function installDialog() {
    modal({
      title: "Install skills",
      body: `<div class="field"><label>Source — owner/repo, owner/repo/path/to/skill, a GitHub URL, or a local folder</label><input id="install-src" placeholder="anthropics/skills/skills/pdf" /></div>
        <div class="field"><label>Into drawer</label><select id="install-drawer">${drawerOptions()}</select></div>
        <label class="check"><input type="checkbox" id="install-overwrite" /> Overwrite skills that already exist</label>
        <p class="muted">Every folder containing a SKILL.md under the source is installed. Requires <code>git</code> for GitHub sources.</p>
        <div id="install-result"></div>`,
      footer: `<button class="btn btn-primary" id="install-go">Install</button>`,
      onOpen(el) {
        $("#install-src", el).focus();
        const go = async () => {
          try {
            $("#install-go", el).disabled = true;
            $("#install-result", el).innerHTML = `<p class="muted">Fetching…</p>`;
            const r = await api("/api/install", { method: "POST", body: { source: $("#install-src", el).value, drawerId: $("#install-drawer", el).value, overwrite: $("#install-overwrite", el).checked } });
            $("#install-result", el).innerHTML = resultList(r);
            await load(true);
          } catch (err) {
            $("#install-result", el).innerHTML = `<div class="problem error">${esc(err.message)}</div>`;
          }
          $("#install-go", el).disabled = false;
        };
        $("#install-go", el).onclick = go;
        $("#install-src", el).addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
      },
    });
  }

  function newSkillDialog() {
    modal({
      title: "New skill",
      body: `<div class="field"><label>Name (lowercase, hyphens)</label><input id="new-name" placeholder="my-skill" /></div>
        <div class="field"><label>Description — what it does and when to use it</label><input id="new-desc" placeholder="Use when …" /></div>
        <div class="field"><label>Drawer</label><select id="new-drawer">${drawerOptions()}</select></div>`,
      footer: `<button class="btn btn-primary" id="new-go">Create</button>`,
      onOpen(el, close) {
        $("#new-name", el).focus();
        $("#new-go", el).onclick = async () => {
          try {
            const r = await api("/api/skills", { method: "POST", body: { name: $("#new-name", el).value, description: $("#new-desc", el).value, drawerId: $("#new-drawer", el).value } });
            close();
            toast(`Created ${r.created.name || r.created.path}`, { kind: "ok" });
            await load(true);
            if (r.created.id) { state.tab = "edit"; openSkill(r.created.id, { keepTab: true }); }
          } catch (err) {
            toast(err.message, { kind: "err" });
          }
        };
      },
    });
  }

  async function trashDialog() {
    let data;
    try {
      data = await api("/api/trash");
    } catch (err) {
      return toast(err.message, { kind: "err" });
    }
    const ro = state.data.readOnly;
    const rows = data.entries.length
      ? data.entries.map((e) => `<div class="trash-row"><div><div><b>${esc(e.name)}</b> <span class="muted">${esc(e.drawerLabel)} · ${ago(e.at)}</span></div><div class="path">${esc(e.originalPath)}</div></div>
          <div class="row">${ro ? "" : `<button class="btn btn-sm btn-primary" data-restore="${esc(e.entryId)}">Restore</button><button class="btn btn-sm btn-danger" data-purge="${esc(e.entryId)}">Delete</button>`}</div></div>`).join("")
      : `<p class="muted">Trash is empty.</p>`;
    modal({
      title: `Trash (${data.entries.length})`,
      wide: true,
      body: `<p class="muted mono">${esc(data.root)}</p>${rows}`,
      footer: data.entries.length && !ro ? `<button class="btn btn-danger" id="trash-empty">Empty trash</button>` : "",
      onOpen(el, close) {
        $$("[data-restore]", el).forEach((b) => (b.onclick = async () => {
          try { await api(`/api/trash/${b.dataset.restore}/restore`, { method: "POST" }); toast("Restored", { kind: "ok" }); close(); await load(true); trashDialog(); }
          catch (err) { toast(err.message, { kind: "err" }); }
        }));
        $$("[data-purge]", el).forEach((b) => (b.onclick = async () => {
          if (!(await confirm({ title: "Delete permanently?", message: "This removes the trashed copy for good.", ok: "Delete", danger: true }))) return;
          try { await api(`/api/trash/${b.dataset.purge}`, { method: "DELETE" }); close(); await load(true); trashDialog(); }
          catch (err) { toast(err.message, { kind: "err" }); }
        }));
        const empty = $("#trash-empty", el);
        if (empty) empty.onclick = async () => {
          if (!(await confirm({ title: "Empty trash?", message: `All ${data.entries.length} entries will be removed permanently.`, ok: "Empty", danger: true }))) return;
          try { await api("/api/trash", { method: "DELETE" }); close(); await load(true); toast("Trash emptied", { kind: "ok" }); }
          catch (err) { toast(err.message, { kind: "err" }); }
        };
      },
    });
  }

  async function issuesDialog() {
    let data;
    try {
      data = await api("/api/issues");
    } catch (err) {
      return toast(err.message, { kind: "err" });
    }
    const link = (s) => `<li><a data-goto="${s.id}">${esc(s.path || s.name)}</a></li>`;
    const conflicts = data.conflicts.length
      ? data.conflicts.map((c) => `<div class="issue"><div class="head"><span class="badge badge-${c.severity === "warning" ? "warn" : "info"}">${esc(c.type)}</span>${esc(c.title)}</div><div class="detail">${esc(c.detail)}</div><ul>${c.skills.map(link).join("")}</ul></div>`).join("")
      : `<p class="muted">No duplicates or overlapping triggers.</p>`;
    const lint = data.lint.length
      ? data.lint.map((l) => `<div class="issue"><div class="head"><span class="badge badge-${l.status === "error" ? "err" : l.status === "warning" ? "warn" : "info"}">${esc(l.status)}</span><a data-goto="${l.id}">${esc(l.name)}</a> <span class="muted">${esc(l.drawer)}</span></div><ul>${l.problems.map((p) => `<li>${esc(p.message)}</li>`).join("")}</ul></div>`).join("")
      : `<p class="muted">Every skill passes validation.</p>`;
    const risk = data.risk.length
      ? data.risk.map((r) => `<div class="issue"><div class="head"><span class="badge badge-${RISK[r.risk] >= 3 ? "err" : "warn"}">${esc(r.risk)}</span><a data-goto="${r.id}">${esc(r.name)}</a> <span class="muted">${esc(r.drawer)}</span></div><ul>${r.findings.slice(0, 5).map((f) => `<li>${esc(f.message)} <span class="muted">${esc(f.file)}:${f.line}</span></li>`).join("")}</ul></div>`).join("")
      : `<p class="muted">No risky instructions found.</p>`;
    modal({
      title: "Issues",
      wide: true,
      body: `<div class="section-title">Duplicates & conflicts (${data.conflicts.length})</div>${conflicts}
        <div class="section-title">Lint (${data.lint.length})</div>${lint}
        <div class="section-title">Risk audit (${data.risk.length})</div>${risk}`,
      onOpen(el, close) {
        $$("[data-goto]", el).forEach((a) => (a.onclick = () => { close(); openSkill(a.dataset.goto); }));
      },
    });
  }

  function helpDialog() {
    const rows = [
      ["j / ↓", "next skill"], ["k / ↑", "previous skill"], ["Enter", "open selected"], ["/", "search"],
      ["x / Space", "mark / unmark"], ["a", "mark all visible"], ["d", "trash marked (or current)"],
      ["e", "disable / enable current"], ["n", "new skill"], ["i", "install"], ["t", "trash"], ["!", "issues"],
      ["1–6", "switch tab"], ["r", "rescan"], ["Esc", "clear marks / close"], ["?", "this help"],
    ];
    modal({
      title: "Keyboard shortcuts",
      body: `<div class="shortcuts">${rows.map(([k, v]) => `<kbd>${esc(k)}</kbd><span>${esc(v)}</span>`).join("")}</div>
        <p class="muted" style="margin-top:14px">Trash keeps everything you delete under <span class="mono">${esc(state.data?.storeHome || "~/.skill-drawer")}/trash</span> until you empty it. Disable moves a skill to a quarantine folder so the tool stops loading it; Enable puts it back.</p>`,
    });
  }

  /* ---------- Keyboard ---------- */
  function move(delta) {
    if (!state.filtered.length) return;
    const idx = state.filtered.findIndex((s) => s.id === state.activeId);
    const next = Math.max(0, Math.min(state.filtered.length - 1, idx < 0 ? 0 : idx + delta));
    openSkill(state.filtered[next].id, { keepTab: true });
  }

  document.addEventListener("keydown", (e) => {
    const inField = e.target.matches("input, textarea, select") || $("#modal-root").children.length;
    if (e.key === "Escape" && e.target.matches("input, textarea")) { e.target.blur(); return; }
    if (inField) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const ro = state.data?.readOnly;
    const cur = state.detail;
    switch (e.key) {
      case "j": case "ArrowDown": e.preventDefault(); move(1); break;
      case "k": case "ArrowUp": e.preventDefault(); move(-1); break;
      case "Enter": if (state.activeId) openSkill(state.activeId); break;
      case "/": e.preventDefault(); $("#search").focus(); $("#search").select(); break;
      case "x": case " ": if (state.activeId) { e.preventDefault(); toggleMark(state.activeId); } break;
      case "a": state.filtered.forEach((s) => state.marked.add(s.id)); renderList(); break;
      case "d": if (ro) break; if (state.marked.size) removeSkills([...state.marked], false); else if (state.activeId) removeSkills([state.activeId], false); break;
      case "e": if (ro || !cur) break; doAction(cur.disabled ? "enable" : "disable", cur); break;
      case "n": if (!ro) newSkillDialog(); break;
      case "i": if (!ro) installDialog(); break;
      case "t": trashDialog(); break;
      case "!": issuesDialog(); break;
      case "r": load(true); toast("Rescanned", { timeout: 1500 }); break;
      case "?": helpDialog(); break;
      case "Escape": state.marked.clear(); renderList(); break;
      default: {
        const n = Number(e.key);
        if (n >= 1 && n <= 6 && cur) { state.tab = ["rendered", "source", "frontmatter", "files", "health", "edit"][n - 1]; renderDetail(); }
      }
    }
  });

  /* ---------- Wiring ---------- */
  $("#search").addEventListener("input", (e) => { state.query = e.target.value; applyFilters(); });
  $("#search").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.target.blur(); move(0); } });
  $("#sort").onchange = (e) => { state.sort = e.target.value; applyFilters(); };
  for (const key of ["lint", "risk", "dupes", "disabled"]) {
    $(`#f-${key}`).onchange = (e) => { state.filters[key] = e.target.checked; applyFilters(); };
  }
  $("#select-all").onchange = (e) => {
    if (e.target.checked) state.filtered.forEach((s) => state.marked.add(s.id));
    else state.filtered.forEach((s) => state.marked.delete(s.id));
    renderList();
  };
  $("#bulk-delete").onclick = () => removeSkills([...state.marked], false);
  $("#bulk-disable").onclick = () => bulkDisable([...state.marked]);
  $("#bulk-export").onclick = () => exportDialog([...state.marked]);
  $("#bulk-clear").onclick = () => { state.marked.clear(); renderList(); };
  $("#btn-new").onclick = newSkillDialog;
  $("#btn-install").onclick = installDialog;
  $("#btn-import").onclick = importDialog;
  $("#btn-export").onclick = () => exportDialog(state.marked.size ? [...state.marked] : null);
  $("#btn-issues").onclick = issuesDialog;
  $("#btn-trash").onclick = trashDialog;
  $("#btn-help").onclick = helpDialog;
  $("#btn-refresh").onclick = () => load(true);

  const themeSel = $("#theme");
  let savedTheme = "carbon";
  try { savedTheme = localStorage.getItem("skill-drawer-theme") || "carbon"; } catch { /* ignore */ }
  document.documentElement.dataset.theme = savedTheme;
  themeSel.value = savedTheme;
  themeSel.onchange = () => {
    document.documentElement.dataset.theme = themeSel.value;
    try { localStorage.setItem("skill-drawer-theme", themeSel.value); } catch { /* ignore */ }
  };

  window.addEventListener("beforeunload", (e) => { if (state.editorDirty) { e.preventDefault(); e.returnValue = ""; } });

  load().then(() => {
    // Hide mutating controls in read-only mode.
    if (state.data?.readOnly) for (const id of ["btn-new", "btn-install", "btn-import", "bulk-delete", "bulk-disable"]) $(`#${id}`).hidden = true;
  });
})();
