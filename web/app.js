/* Skill Drawer UI — vanilla JS, no build step. */
import { parseQuery, scoreSkill, matchRanges, FILTERS } from "./query.js";

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
    agent: "all",
    query: "",
    sort: "agent",
    filters: { attention: false, disabled: true },
    activeId: null,
    marked: new Set(),
    detail: null,
    tab: "rendered",
    editorDirty: false,
    ai: null,
    parsedQuery: parseQuery(""),
    assessments: {},
    closedAgents: new Set(),
    closedGroups: new Set(),
    groupByAgent: true,
    comparisons: {},
  };
  try { state.groupByAgent = localStorage.getItem("skill-drawer-group") !== "0"; } catch { /* ignore */ }
  try { for (const id of JSON.parse(localStorage.getItem("skill-drawer-closed-groups") || "[]")) state.closedGroups.add(id); } catch { /* ignore */ }
  try { for (const id of JSON.parse(localStorage.getItem("skill-drawer-closed-agents") || "[]")) state.closedAgents.add(id); } catch { /* ignore */ }
  function persistClosed() { try { localStorage.setItem("skill-drawer-closed-agents", JSON.stringify([...state.closedAgents])); } catch { /* ignore */ } }
  function persistGroup() { try { localStorage.setItem("skill-drawer-group", state.groupByAgent ? "1" : "0"); } catch { /* ignore */ } }
  function persistGroups() { try { localStorage.setItem("skill-drawer-closed-groups", JSON.stringify([...state.closedGroups])); } catch { /* ignore */ } }

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

  /** The writable drawer the user is looking at, if any. */
  function currentDrawerId() {
    const d = (state.data?.drawers || []).find((x) => x.id === state.drawer && x.writable);
    return d ? d.id : null;
  }

  function drawerOptions(selectedId, { exclude = [] } = {}) {
    const writable = (state.data?.drawers || []).filter((d) => d.writable && !exclude.includes(d.id));
    const def = writable.find((d) => /\.claude\/skills$/.test(d.root)) || writable[0];
    const groups = new Map();
    for (const d of writable) {
      if (!groups.has(d.agentLabel)) groups.set(d.agentLabel, []);
      groups.get(d.agentLabel).push(d);
    }
    return [...groups.entries()]
      .map(([agent, ds]) => `<optgroup label="${esc(agent)}">${ds
        .map((d) => `<option value="${esc(d.id)}" ${(selectedId || def?.id) === d.id ? "selected" : ""}>${esc(d.label)}${d.scope === "project" ? " (project)" : ""}</option>`)
        .join("")}</optgroup>`)
      .join("");
  }

  /* ---------- Loading ---------- */
  async function load(refresh = false) {
    try {
      const data = await api(`/api/skills${refresh ? "?refresh=1" : ""}`);
      state.data = data;
      state.skills = data.skills;
      if (!state.ai) api("/api/ai/config").then((c) => { state.ai = c; }).catch(() => {});
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
    const { drawers, agents, census } = state.data;
    const total = state.skills.filter((s) => !s.disabled).length;
    const byId = new Map(drawers.map((d) => [d.id, d]));
    const allActive = state.agent === "all" && state.drawer === "all";
    let html = `<button class="agent-item ${allActive ? "active" : ""}" data-agent="all"><span class="lbl">All agents</span><span class="count">${total}</span></button>`;
    for (const a of agents) {
      const closed = state.closedAgents.has(a.id);
      html += `<button class="agent-item ${state.agent === a.id && state.drawer === "all" ? "active" : ""} ${closed ? "closed" : ""}" data-agent="${esc(a.id)}" title="${esc(a.installed ? `Detected: ${a.via.join(", ")}` : "Not detected on this machine; a skills folder exists")}">
        <span class="lbl"><span class="chev" data-toggle="${esc(a.id)}" title="${closed ? "Open" : "Close"} this drawer group">▾</span><span>${esc(a.label)}</span>${a.installed ? "" : `<span class="inst">folder only</span>`}</span><span class="count">${a.count}</span></button>`;
      if (closed) continue;
      for (const id of a.drawers) {
        const d = byId.get(id);
        if (!d) continue;
        const ghost = d.exists === false;
        html += `<button class="drawer-item nested ${ghost ? "ghost" : ""} ${state.drawer === d.id ? "active" : ""}" data-drawer="${esc(d.id)}" data-agent-of="${esc(a.id)}" title="${esc(ghost ? `${d.root} (not created yet; copy or install a skill here to create it)` : d.root)}">
          <span class="label">${esc(d.label)}</span>
          <span class="right"><span class="kind">${esc(d.kind === "user" ? "" : d.kind)}</span><span class="count">${ghost ? "—" : d.count}</span></span>
        </button>`;
      }
    }
    $("#drawers").innerHTML = html;
    $$("[data-toggle]", $("#drawers")).forEach((c) => (c.onclick = (e) => {
      e.stopPropagation();
      const id = c.dataset.toggle;
      if (state.closedAgents.has(id)) state.closedAgents.delete(id); else state.closedAgents.add(id);
      persistClosed();
      renderDrawers();
    }));
    $$("[data-agent]", $("#drawers")).forEach((b) => (b.onclick = () => { state.agent = b.dataset.agent; state.drawer = "all"; renderDrawers(); renderShelf(); applyFilters(); }));
    $$("[data-drawer]", $("#drawers")).forEach((b) => (b.onclick = () => { state.drawer = b.dataset.drawer; state.agent = b.dataset.agentOf || "all"; renderDrawers(); renderShelf(); applyFilters(); }));
  }

  function renderShelf() {
    const c = state.data.census;
    $("#shelf-list").innerHTML = `
      <button class="shelf-item ${state.drawer === "__disabled" ? "active" : ""}" data-shelf="disabled" title="Skills moved out of the way but kept in place; shown in the list">
        <span>Disabled</span><span class="count">${c.disabled}</span></button>
      <button class="shelf-item" data-shelf="archived" title="Skills shelved outside every agent">
        <span>Archived</span><span class="row" style="gap:6px"><span class="count">${c.archived}</span><span class="go">›</span></span></button>
      <button class="shelf-item" data-shelf="trashed" title="Deleted skills you can still restore">
        <span>Deleted</span><span class="row" style="gap:6px"><span class="count">${c.trash}</span><span class="go">›</span></span></button>`;
    $$("[data-shelf]", $("#shelf-list")).forEach((b) => (b.onclick = () => {
      const kind = b.dataset.shelf;
      if (kind === "disabled") {
        state.drawer = state.drawer === "__disabled" ? "all" : "__disabled";
        state.agent = "all";
        renderDrawers();
        renderShelf();
        applyFilters();
        return;
      }
      (kind === "archived" ? archiveDialog : trashDialog)();
    }));
  }

  function renderCensus() {
    const c = state.data.census;
    $("#census").innerHTML = `
      <div><b>${c.active}</b> active, <b>${c.disabled}</b> disabled</div>
      <div><b>${c.unique}</b> unique, <b>${c.duplicates}</b> duplicate copies</div>
      <div><b>${c.lintErrors}</b> lint errors, <b>${c.lintWarnings}</b> warnings</div>
      <div><b>${c.risky}</b> high/critical risk</div>
      <div><b>${c.conflicts}</b> conflicts · <b>${c.trash}</b> in trash · <b>${c.archived}</b> archived</div>
      <div class="mono" style="margin-top:6px;font-size:11px">store: ${esc(state.data.storeHome)}</div>
      <div class="mono" style="font-size:11px">cwd: ${esc(state.data.cwd)}</div>`;
    const issues = c.conflicts + c.lintErrors + c.lintWarnings + c.risky;
    $("#checks-count").hidden = !issues;
    $("#checks-count").textContent = issues;
    $("#menu-issues-hint").textContent = issues ? `${issues} to review` : "none open";
    renderShelf();
  }

  /* ---------- Filtering & list ---------- */
  const RISK = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };
  const LINT = { ok: 0, info: 1, warning: 2, error: 3 };

  /** Escape text, wrapping the parts the query matched in <mark>. */
  function mark(text, query) {
    const ranges = matchRanges(text, query);
    if (!ranges.length) return esc(text);
    let out = "";
    let at = 0;
    for (const [start, end] of ranges) {
      out += esc(text.slice(at, start)) + `<mark>${esc(text.slice(start, end))}</mark>`;
      at = end;
    }
    return out + esc(text.slice(at));
  }

  function applyFilters() {
    const query = parseQuery(state.query);
    state.parsedQuery = query;
    const scores = new Map();
    let list = state.skills.filter((s) => {
      if (state.drawer === "__disabled") return s.disabled;
      if (!state.filters.disabled && s.disabled) return false;
      if (state.drawer !== "all" && s.drawerId !== state.drawer) return false;
      if (state.drawer === "all" && state.agent !== "all" && s.agentId !== state.agent) return false;
      if (state.filters.attention && s.lint === "ok" && s.risk === "none" && !s.copyCount) return false;
      const score = scoreSkill(s, query);
      if (!score) return false;
      scores.set(s.id, score);
      return true;
    });
    const by = {
      agent: (a, b) => a.agentLabel.localeCompare(b.agentLabel) || a.drawerLabel.localeCompare(b.drawerLabel) || a.name.localeCompare(b.name),
      drawer: (a, b) => a.drawerLabel.localeCompare(b.drawerLabel) || a.name.localeCompare(b.name),
      name: (a, b) => a.name.localeCompare(b.name),
      mtime: (a, b) => b.mtime - a.mtime,
      ctime: (a, b) => b.ctime - a.ctime,
      size: (a, b) => b.bytes - a.bytes,
      risk: (a, b) => RISK[b.risk] - RISK[a.risk] || a.name.localeCompare(b.name),
      lint: (a, b) => LINT[b.lint] - LINT[a.lint] || b.lintCount - a.lintCount,
      quality: (a, b) => (a.qualityScore ?? 101) - (b.qualityScore ?? 101),
    };
    // While searching, the best match wins; the chosen sort breaks ties.
    const tiebreak = by[state.sort] || by.agent;
    list.sort(query.empty ? tiebreak : (a, b) => scores.get(b.id) - scores.get(a.id) || tiebreak(a, b));
    state.filtered = list;
    renderList();
  }

  /**
   * Badges render for two shapes: the trimmed catalog entry used by the list
   * (lintCount, copyCount, qualityScore) and the full skill used by the detail
   * header (lintProblems, copies, quality). Read both.
   */
  function badges(s) {
    const out = [];
    const lintCount = s.lintCount ?? s.lintProblems?.length ?? 0;
    const copyCount = s.copyCount ?? s.copies?.length ?? 0;
    const qScore = s.qualityScore ?? s.quality?.score ?? null;
    const qGrade = s.qualityGrade ?? s.quality?.grade ?? "";
    if (s.disabled) out.push(`<span class="badge badge-muted">disabled</span>`);
    if (qScore !== null && qScore !== undefined) out.push(`<span class="qchip q-${esc(qGrade)}" title="Static quality score (Quality report explains it)">Q${esc(qScore)}</span>`);
    if (s.lint === "error") out.push(`<span class="badge badge-err" title="Lint errors">${lintCount} lint</span>`);
    else if (s.lint === "warning") out.push(`<span class="badge badge-warn" title="Lint warnings">${lintCount} lint</span>`);
    if (RISK[s.risk] >= 3) out.push(`<span class="badge badge-err">${esc(s.risk)} risk</span>`);
    else if (RISK[s.risk] >= 1) out.push(`<span class="badge badge-warn">${esc(s.risk)} risk</span>`);
    if (copyCount) out.push(`<span class="badge badge-info" title="Identical copies elsewhere">${copyCount} cop${copyCount === 1 ? "y" : "ies"}</span>`);
    if (s.link) out.push(`<span class="badge">symlink</span>`);
    if (s.file) out.push(`<span class="badge">file</span>`);
    if (s.scope === "project") out.push(`<span class="badge badge-ok">project</span>`);
    if (!s.writable && !s.disabled) out.push(`<span class="badge badge-muted">${esc(s.kind)}</span>`);
    return out.join("");
  }

  function cardHtml(s) {
    return `<div class="skill-card ${s.id === state.activeId ? "active" : ""} ${state.marked.has(s.id) ? "marked" : ""} ${s.disabled ? "disabled" : ""}" data-id="${s.id}">
            <input type="checkbox" data-mark="${s.id}" ${state.marked.has(s.id) ? "checked" : ""} aria-label="Mark ${esc(s.name)}" />
            <div>
              <div class="name">${mark(s.name, state.parsedQuery)} ${badges(s)}</div>
              <div class="desc">${s.description ? mark(s.description, state.parsedQuery) : "No description"}</div>
              <div class="meta">${state.groupByAgent ? "" : `<span class="agent-chip">${esc(s.agentLabel)}</span>`}<span>${esc(s.drawerLabel)}</span><span title="${fmtDate(s.mtime)}">${ago(s.mtime)}</span><span>${fmtBytes(s.bytes)}</span>${s.origin ? `<span title="${esc(s.origin.url)}">${esc(s.origin.label)}</span>` : ""}</div>
            </div>
          </div>`;
  }

  function renderList() {
    const list = $("#list");
    $("#list-summary").textContent = `${state.filtered.length} skill${state.filtered.length === 1 ? "" : "s"}${state.parsedQuery.empty ? "" : ", best match first"}`;
    list.classList.toggle("selecting", state.marked.size > 0);
    if (!state.filtered.length) {
      const d = state.data.drawers.find((x) => x.id === state.drawer);
      const hint = d && d.exists === false
        ? `This drawer does not exist yet. Copy, move or install a skill into <span class="mono">${esc(d.root)}</span> and it will be created. <button class="btn btn-sm" id="open-drawer">Create &amp; open folder</button>`
        : state.skills.length ? "Nothing matches." : "No skills found in any drawer. Install one or create a new skill.";
      list.innerHTML = `<div class="empty">${hint}</div>`;
      $("#open-drawer")?.addEventListener("click", () => api("/api/drawers/open", { method: "POST", body: { id: state.drawer } }).then(() => load(true)).catch((e) => toast(e.message, { kind: "err" })));
    } else if (state.groupByAgent) {
      const groups = [];
      const byAgent = new Map();
      for (const s of state.filtered) {
        if (!byAgent.has(s.agentId)) {
          byAgent.set(s.agentId, { id: s.agentId, label: s.agentLabel, skills: [] });
          groups.push(byAgent.get(s.agentId));
        }
        byAgent.get(s.agentId).skills.push(s);
      }
      list.innerHTML = groups
        .map((g) => {
          const closed = state.closedGroups.has(g.id);
          const marked = g.skills.filter((s) => state.marked.has(s.id)).length;
          return `<button class="group-head ${closed ? "closed" : ""}" data-group="${esc(g.id)}" title="${closed ? "Open" : "Close"} this group">
              <span class="chev">▾</span><span>${esc(g.label)}</span>
              <span class="count">${marked ? `${marked} marked · ` : ""}${g.skills.length}</span>
            </button>${closed ? "" : g.skills.map(cardHtml).join("")}`;
        })
        .join("");
      $$("[data-group]", list).forEach((b) => (b.onclick = () => {
        const id = b.dataset.group;
        if (state.closedGroups.has(id)) state.closedGroups.delete(id); else state.closedGroups.add(id);
        persistGroups();
        renderList();
      }));
    } else {
      list.innerHTML = state.filtered.map(cardHtml).join("");
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
    $("#list").classList.toggle("selecting", state.marked.size > 0);
    if (state.groupByAgent) {
      const s = state.skills.find((x) => x.id === id);
      const head = s && $(`.group-head[data-group="${s.agentId}"] .count`);
      if (head) {
        const g = state.filtered.filter((x) => x.agentId === s.agentId);
        const marked = g.filter((x) => state.marked.has(x.id)).length;
        head.textContent = `${marked ? `${marked} marked · ` : ""}${g.length}`;
      }
    }
    renderBulk();
  }

  function renderBulk() {
    const n = state.marked.size;
    $("#bulk").hidden = !n;
    $("#bulk-count").textContent = `${n} marked`;
    $("#bulk-compare").hidden = n !== 2;
  }

  /* ---------- Detail ---------- */
  async function openSkill(id, { keepTab = false } = {}) {
    if (state.editorDirty && state.activeId !== id) {
      if (!(await confirm({ title: "Discard changes?", message: "You have unsaved edits in the editor.", ok: "Discard", danger: true }))) return;
      state.editorDirty = false;
    }
    state.activeId = id;
    if (!keepTab) state.tab = state.tab === "edit" ? "rendered" : state.tab;
    const target = state.skills.find((x) => x.id === id);
    if (state.groupByAgent && target && state.closedGroups.has(target.agentId)) {
      state.closedGroups.delete(target.agentId);
      persistGroups();
      renderList();
    }
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
      ["ai", state.assessments[s.id] ? `AI ${state.assessments[s.id].result?.score ?? ""}` : "AI"],
    ];
    const actions = [];
    if (!ro) {
      if (s.disabled) actions.push(`<button class="btn btn-sm btn-primary" data-act="enable">Enable</button>`);
      else if (s.kind === "user" || s.kind === "project" || s.kind === "extra") actions.push(`<button class="btn btn-sm" data-act="disable" title="Move to quarantine; the tool stops loading it (e)">Disable</button>`);
      if (s.writable && !s.disabled) actions.push(`<button class="btn btn-sm" data-act="edit" title="Edit files and metadata (6)">Edit</button>`);
      if (s.writable && !s.disabled) actions.push(`<button class="btn btn-sm" data-act="rename">Rename</button>`);
      if (!s.disabled) actions.push(`<button class="btn btn-sm" data-act="copy" title="Copy to another agent's drawer (c)">Copy to…</button>`);
      if (!s.disabled) actions.push(`<button class="btn btn-sm" data-act="sync" title="Overwrite same-named copies in other agents with this version">Sync…</button>`);
      if (s.writable && !s.disabled) actions.push(`<button class="btn btn-sm" data-act="move" title="Move to another agent's drawer (m)">Move to…</button>`);
      if (!s.disabled && (s.kind === "user" || s.kind === "project" || s.kind === "extra")) actions.push(`<button class="btn btn-sm" data-act="archive" title="Shelve outside every agent; unarchive later into any drawer">Archive</button>`);
      actions.push(`<button class="btn btn-sm" data-act="open" title="Open in $EDITOR">Open in editor</button>`);
      actions.push(`<button class="btn btn-sm" data-act="assess" title="AI quality assessment">Assess (AI)</button>`);
      actions.push(`<button class="btn btn-sm" data-act="compare-with" title="AI-compare with another skill">Compare with…</button>`);
      actions.push(`<button class="btn btn-sm" data-act="export">Export</button>`);
      if (s.disabled) actions.push(`<button class="btn btn-sm btn-danger" data-act="delete-permanent">Delete permanently</button>`);
      else {
        actions.push(`<button class="btn btn-sm btn-danger" data-act="delete" title="Move to trash (d)">Trash</button>`);
        actions.push(`<button class="btn btn-sm" data-act="delete-permanent" title="Skip the trash">Delete permanently</button>`);
      }
    } else {
      actions.push(`<button class="btn btn-sm" data-act="assess" title="AI quality assessment">Assess (AI)</button>`);
      actions.push(`<button class="btn btn-sm" data-act="compare-with" title="AI-compare with another skill">Compare with…</button>`);
      actions.push(`<button class="btn btn-sm" data-act="export">Export</button>`);
    }
    pane.innerHTML = `
      <div class="detail-head">
        <div class="detail-title"><h1>${esc(s.name)}</h1><span class="agent-chip">${esc(s.agentLabel)}</span>${badges(s)}${s.origin ? `<a href="${esc(s.origin.url)}" target="_blank" rel="noopener" class="badge" title="${esc(s.origin.via)} (${esc(s.origin.certainty)})">${esc(s.origin.label)}</a>` : ""}</div>
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
        const canFix = s.writable && !state.data.readOnly;
        const lint = s.lintProblems.length
          ? s.lintProblems.map((p) => `<div class="problem ${p.level}"><div class="row"><span>${esc(p.message)}</span>${p.fix && canFix ? `<span class="spacer"></span><button class="btn btn-sm" data-fix="${esc(p.fix)}">Fix</button>` : ""}</div><div class="rule">${esc(p.level)} · ${esc(p.rule)}</div></div>`).join("")
          : `<p class="muted">Frontmatter and structure look good.</p>`;
        const risk = s.findings.length
          ? s.findings.map((f) => `<div class="problem ${f.severity}"><div>${esc(f.message)}</div><div class="rule">${esc(f.severity)} · ${esc(f.rule)} · ${esc(f.file)}:${f.line}${f.context === "denylist" ? " · in a do-not instruction" : ""}</div><div class="snippet">${esc(f.snippet)}</div></div>`).join("")
          : `<p class="muted">No risky instructions found.</p>`;
        body.innerHTML = `<div class="section-title">Lint</div>${lint}<div class="section-title">Risk audit (heuristic)</div>${risk}`;
        $$("[data-fix]", body).forEach((b) => (b.onclick = () => applyFix(s.id, b.dataset.fix)));
        break;
      }
      case "ai": {
        renderAssessment(body, s);
        break;
      }
      case "edit": {
        if (ro || !s.writable) {
          body.innerHTML = `<p class="muted">${ro ? "Read-only mode: editing is disabled." : "This skill is tool-managed or symlinked; edit it at its source instead."}</p><pre>${esc(s.source)}</pre>`;
          break;
        }
        const fileOptions = s.files.map((f) => `<option value="${esc(f.path)}" ${f.path === s.skillRel ? "selected" : ""}>${esc(f.path)}</option>`).join("");
        const fmRest = Object.fromEntries(Object.entries(s.frontmatter || {}).filter(([k]) => k !== "name" && k !== "description"));
        body.innerHTML = `
          <div class="section-title">Metadata</div>
          <div class="meta-form">
            <div class="field"><label>name <span class="muted">(use Rename to change; it also moves the folder)</span></label><input value="${esc(s.frontmatter?.name ?? s.slug)}" disabled /></div>
            <div class="field"><label>description — what the skill does and when the agent should use it</label><textarea id="meta-desc">${esc(s.frontmatter?.description ?? "")}</textarea></div>
            <div class="field"><label>other frontmatter (YAML)</label><textarea id="meta-yaml" class="mono" spellcheck="false">${esc(Object.keys(fmRest).length ? jsyaml(fmRest) : "")}</textarea></div>
            <div class="row"><span class="grow muted" id="meta-status"></span><button class="btn btn-sm btn-primary" id="meta-save">Save metadata</button></div>
          </div>
          <div class="section-title">Files</div>
          <div class="editor-bar">
            <select id="edit-file" class="select">${fileOptions}</select>
            <button class="btn btn-sm" id="edit-new" title="Add a file to this skill">New file</button>
            <button class="btn btn-sm" id="edit-delete" title="Delete the selected file">Delete file</button>
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
        $("#edit-new").onclick = async () => {
          const rel = await prompt({ title: "New file", label: "Path inside the skill folder", placeholder: "reference/notes.md", ok: "Create" });
          if (!rel) return;
          try {
            await api(`/api/skills/${s.id}/file`, { method: "PUT", body: { path: rel, content: "" } });
            toast(`Created ${rel}`, { kind: "ok" });
            state.tab = "edit";
            await load(true);
            await openSkill(s.id, { keepTab: true });
            const next = $("#edit-file");
            if (next) { next.value = rel.replace(/^\.\//, ""); next.dispatchEvent(new Event("change")); }
          } catch (err) {
            toast(err.message, { kind: "err" });
          }
        };
        $("#edit-delete").onclick = async () => {
          const rel = sel.value;
          if (rel === s.skillRel) return toast("Trash the whole skill instead of deleting its SKILL.md", { kind: "err" });
          if (!(await confirm({ title: "Delete file?", message: `<code>${esc(rel)}</code> will be removed from the skill folder.`, ok: "Delete", danger: true }))) return;
          try {
            await api(`/api/skills/${s.id}/file?path=${encodeURIComponent(rel)}`, { method: "DELETE" });
            toast(`Deleted ${rel}`, { kind: "ok" });
            await load(true);
            openSkill(s.id, { keepTab: true });
          } catch (err) {
            toast(err.message, { kind: "err" });
          }
        };
        $("#meta-save").onclick = async () => {
          try {
            const rest = parseYamlLoose($("#meta-yaml").value);
            const data = { name: s.frontmatter?.name ?? s.slug, description: $("#meta-desc").value, ...rest };
            await api(`/api/skills/${s.id}/frontmatter`, { method: "PUT", body: { data } });
            $("#meta-status").textContent = `Saved ${new Date().toLocaleTimeString()}`;
            toast("Metadata saved", { kind: "ok" });
            await load(true);
            openSkill(s.id, { keepTab: true });
          } catch (err) {
            toast(err.message, { kind: "err" });
          }
        };
        $("#edit-revert").onclick = () => { editor.value = original; state.editorDirty = false; $("#edit-status").textContent = ""; };
        loadFile();
        break;
      }
    }
  }

  /* ---------- Tiny YAML helpers for the metadata form (flat keys; nested values as JSON) ---------- */
  function jsyaml(obj) {
    return Object.entries(obj)
      .map(([k, v]) => `${k}: ${typeof v === "string" && !/[:#\n]/.test(v) ? v : JSON.stringify(v)}`)
      .join("\n");
  }
  function parseYamlLoose(text) {
    const out = {};
    for (const raw of String(text || "").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const m = line.match(/^([\w.-]+)\s*:\s*(.*)$/);
      if (!m) throw new Error(`Cannot parse metadata line: ${line}. Use key: value, one per line (JSON for lists/objects).`);
      const v = m[2].trim();
      if (v === "") out[m[1]] = "";
      else if (v === "true" || v === "false") out[m[1]] = v === "true";
      else if (/^-?\d+(\.\d+)?$/.test(v)) out[m[1]] = Number(v);
      else if (/^[\[{"]/.test(v)) { try { out[m[1]] = JSON.parse(v); } catch { out[m[1]] = v; } }
      else out[m[1]] = v.replace(/^['"]|['"]$/g, "");
    }
    return out;
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
        case "export": return exportSkills([s.id]);
        case "edit": state.tab = "edit"; renderDetail(); return;
        case "copy": return transferDialog([s.id], false);
        case "move": return transferDialog([s.id], true);
        case "archive": return archiveSkills([s.id]);
        case "sync": return syncDialog(s.id);
        case "assess": state.tab = "ai"; renderDetail(); return runAssessment(s.id, { force: Boolean(state.assessments[s.id]) });
        case "compare-with": return comparePickDialog(s.id);
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

  function transferDialog(ids, move) {
    const skills = ids.map((id) => state.skills.find((s) => s.id === id)).filter(Boolean);
    if (!skills.length) return;
    const one = skills.length === 1 ? skills[0] : null;
    const verb = move ? "Move" : "Copy";
    modal({
      title: `${verb} ${one ? `"${one.name}"` : `${skills.length} skills`} to another agent`,
      body: `<p class="muted">${move ? "The skill leaves its current drawer." : "The original stays where it is; the target agent gets its own copy."}</p>
        <div class="field"><label>Target drawer</label><select id="tr-drawer">${drawerOptions(null, { exclude: one ? [one.drawerId] : [] })}</select></div>
        ${one ? `<div class="field"><label>Name in the target (optional)</label><input id="tr-name" value="${esc(one.slug)}" /></div>` : ""}
        <label class="check"><input type="checkbox" id="tr-overwrite" /> Overwrite if it already exists there</label>
        <div id="tr-result"></div>`,
      footer: `<button class="btn btn-primary" id="tr-go">${verb}</button>`,
      onOpen(el, close) {
        $("#tr-go", el).onclick = async () => {
          try {
            $("#tr-go", el).disabled = true;
            const r = await api("/api/skills/copy", { method: "POST", body: { ids, drawerId: $("#tr-drawer", el).value, move, overwrite: $("#tr-overwrite", el).checked, name: one ? $("#tr-name", el).value : "" } });
            if (r.errors.length) $("#tr-result", el).innerHTML = `<ul>${r.errors.map((e) => `<li class="problem error">${esc(e.name || e.id)}: ${esc(e.error)}</li>`).join("")}</ul>`;
            if (r.done.length) {
              toast(`${move ? "Moved" : "Copied"} ${r.done.length} skill${r.done.length === 1 ? "" : "s"} to ${r.drawer}`, { kind: "ok" });
              state.marked.clear();
              if (!r.errors.length) close();
              await load(true);
              if (r.done.length === 1 && r.done[0].skill) openSkill(r.done[0].skill.id);
            }
            $("#tr-go", el).disabled = false;
          } catch (err) {
            $("#tr-go", el).disabled = false;
            toast(err.message, { kind: "err" });
          }
        };
      },
    });
  }

  async function archiveSkills(ids) {
    const names = ids.map((id) => state.skills.find((s) => s.id === id)?.name || id);
    const label = names.length === 1 ? `"${names[0]}"` : `${names.length} skills`;
    const ok = await confirm({
      title: "Archive?",
      message: `<p>${esc(label)} will move to the archive shelf at <code>${esc(state.data.storeHome)}/archive</code>. No agent loads archived skills. Unarchive later into the same drawer or any other agent's.</p>`,
      ok: "Archive",
    });
    if (!ok) return;
    try {
      const r = await api("/api/skills/archive", { method: "POST", body: { ids } });
      for (const id of ids) state.marked.delete(id);
      if (r.errors.length) toast(r.errors.map((e) => `${e.name || e.id}: ${e.error}`).join("; "), { kind: "err", timeout: 9000 });
      if (r.archived.length) {
        const entry = r.archived.length === 1 ? r.archived[0].entryId : null;
        toast(`Archived ${r.archived.length} skill${r.archived.length === 1 ? "" : "s"}`, {
          kind: "ok",
          action: entry ? "Undo" : undefined,
          onAction: entry ? () => api(`/api/archive/${entry}/restore`, { method: "POST" }).then(() => load(true)).catch((e) => toast(e.message, { kind: "err" })) : undefined,
        });
      }
      if (ids.includes(state.activeId)) { state.activeId = null; state.detail = null; renderDetail(); }
      await load(true);
    } catch (err) {
      toast(err.message, { kind: "err" });
    }
  }

  async function archiveDialog() {
    let data;
    try {
      data = await api("/api/archive");
    } catch (err) {
      return toast(err.message, { kind: "err" });
    }
    const ro = state.data.readOnly;
    const rows = data.entries.length
      ? data.entries.map((e) => `<div class="trash-row"><div>
            <div><b>${esc(e.name)}</b> <span class="agent-chip">${esc(e.agentLabel || "")}</span> <span class="muted">${esc(e.drawerLabel)} · ${ago(e.at)}</span></div>
            ${e.description ? `<div class="muted" style="font-size:12.5px">${esc(e.description)}</div>` : ""}
            <div class="path">${esc(e.originalPath)}</div>
          </div>
          <div class="row">${ro ? "" : `<button class="btn btn-sm btn-primary" data-restore="${esc(e.entryId)}" title="Back to ${esc(e.originalPath)}">Unarchive</button>
            <select class="select" data-target="${esc(e.entryId)}" title="Unarchive into a different drawer"><option value="">Unarchive to…</option>${drawerOptions("__none__")}</select>
            <button class="btn btn-sm btn-danger" data-purge="${esc(e.entryId)}">Delete</button>`}</div></div>`).join("")
      : `<p class="muted">The archive is empty. Archive a skill from its toolbar or the selection bar.</p>`;
    modal({
      title: `Archived (${data.entries.length})`,
      wide: true,
      body: `<p class="muted mono">${esc(data.root)}</p>${rows}`,
      onOpen(el, close) {
        const unarchive = async (entry, drawerId) => {
          try {
            const r = await api(`/api/archive/${entry}/restore`, { method: "POST", body: drawerId ? { drawerId } : {} });
            toast(`Unarchived ${r.restored.name} → ${r.restored.restoredTo}`, { kind: "ok" });
            close();
            await load(true);
            archiveDialog();
          } catch (err) {
            toast(err.message, { kind: "err" });
          }
        };
        $$("[data-restore]", el).forEach((b) => (b.onclick = () => unarchive(b.dataset.restore)));
        $$("[data-target]", el).forEach((sel) => (sel.onchange = () => { if (sel.value) unarchive(sel.dataset.target, sel.value); }));
        $$("[data-purge]", el).forEach((b) => (b.onclick = async () => {
          if (!(await confirm({ title: "Delete permanently?", message: "This removes the archived copy for good.", ok: "Delete", danger: true }))) return;
          try { await api(`/api/archive/${b.dataset.purge}`, { method: "DELETE" }); close(); await load(true); archiveDialog(); }
          catch (err) { toast(err.message, { kind: "err" }); }
        }));
      },
    });
  }

  async function applyFix(id, fix) {
    try {
      const r = await api(`/api/skills/${id}/fix`, { method: "POST", body: { fix } });
      toast(`Set the frontmatter name to "${r.name}"`, { kind: "ok" });
      await load(true);
      if (state.activeId === id) openSkill(id, { keepTab: true });
    } catch (err) {
      toast(err.message, { kind: "err" });
    }
  }

  async function syncDialog(id) {
    let data;
    try {
      data = await api(`/api/skills/${id}/sync`);
    } catch (err) {
      return toast(err.message, { kind: "err" });
    }
    if (!data.targets.length) return toast("No other agent has a skill by this name", { timeout: 3000 });
    const stale = data.targets.filter((t) => !t.inSync);
    modal({
      title: `Sync "${data.source.name}" to other agents`,
      wide: true,
      body: `<p class="muted">Overwrite the copies below with this version. ${stale.length ? `${stale.length} of ${data.targets.length} ${stale.length === 1 ? "is" : "are"} out of date.` : "They are all already identical."}</p>
        ${data.targets.map((t) => `<label class="check"><input type="checkbox" data-target="${esc(t.id)}" ${t.inSync ? "" : "checked"} />
          <span>${esc(t.agentLabel)}</span><span class="muted mono" style="font-size:11.5px">${esc(t.path)}</span>
          ${t.inSync ? `<span class="badge badge-ok">in sync</span>` : `<span class="badge badge-warn">differs</span>`}</label>`).join("")}`,
      footer: `<button class="btn" data-cancel>Cancel</button><button class="btn btn-primary" id="sync-go">Sync</button>`,
      onOpen(el, close) {
        $("[data-cancel]", el).onclick = close;
        $("#sync-go", el).onclick = async () => {
          const ids = $$("[data-target]", el).filter((c) => c.checked).map((c) => c.dataset.target);
          if (!ids.length) return toast("Nothing selected", { timeout: 2000 });
          if (!(await confirm({ title: "Overwrite the selected copies?", message: `<p>${ids.length} cop${ids.length === 1 ? "y" : "ies"} will be replaced with this version. They are not put in the trash first.</p>`, ok: "Overwrite", danger: true }))) return;
          try {
            const r = await api(`/api/skills/${id}/sync`, { method: "POST", body: { ids } });
            if (r.errors.length) toast(r.errors.map((e) => `${e.name}: ${e.error}`).join("; "), { kind: "err", timeout: 9000 });
            if (r.synced.length) toast(`Synced to ${r.synced.map((x) => x.agentLabel).join(", ")}`, { kind: "ok" });
            close();
            await load(true);
          } catch (err) {
            toast(err.message, { kind: "err" });
          }
        };
      },
    });
  }

  /* ---------- AI: settings, assessment, comparison ---------- */
  function aiNotReady() {
    return !state.ai || !state.ai.ready;
  }

  function renderAssessment(body, s) {
    const a = state.assessments[s.id];
    if (a === "loading") {
      body.innerHTML = `<p><span class="spinner"></span>Asking ${esc(state.ai?.model || "the model")}… this usually takes 10–60 seconds.</p>`;
      return;
    }
    if (!a) {
      body.innerHTML = aiNotReady()
        ? `<div class="notice">Set up a model first: click <b>AI ⚙</b> in the top bar and enter an endpoint, model and API key. Any OpenAI-compatible chat-completions server works (OpenAI, OpenRouter, Groq, Ollama, LM Studio…) as well as Anthropic's API.</div>`
        : `<div class="notice">No assessment yet. <button class="btn btn-sm btn-primary" id="ai-run">Assess with ${esc(state.ai.model)}</button><p class="muted" style="margin:8px 0 0">The full SKILL.md, frontmatter, file list and static findings are sent to the model you configured. Results are cached until the skill changes.</p></div>`;
      $("#ai-run", body)?.addEventListener("click", () => runAssessment(s.id));
      return;
    }
    const r = a.result || {};
    const dims = Object.entries(r.dimensions || {});
    const list = (title, items) => (items?.length ? `<div class="section-title">${esc(title)}</div><ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : "");
    body.innerHTML = `
      <div class="row" style="gap:14px"><span class="score">${esc(r.score ?? "?")}<small>/ 100</small></span><span class="grade grade-${esc(r.grade || "")}">${esc(r.grade || "")}</span><span class="spacer"></span><button class="btn btn-sm" id="ai-rerun" title="Ignore the cache and ask again">Re-assess</button><button class="btn btn-sm" id="ai-compare">Compare with…</button></div>
      <p>${esc(r.summary || "")}</p>
      <div class="section-title">Dimensions</div>
      <div class="dims">${dims.map(([k, d]) => `<span>${esc(k)}</span><span class="bar"><i style="width:${Math.max(0, Math.min(10, Number(d.score) || 0)) * 10}%"></i></span><span>${esc(d.score)}/10</span><span class="note">${esc(d.note || "")}</span>`).join("")}</div>
      ${list("Strengths", r.strengths)}${list("Weaknesses", r.weaknesses)}${list("Suggestions", r.suggestions)}
      ${r.improvedDescription ? `<div class="section-title">Suggested description</div><div class="notice"><div>${esc(r.improvedDescription)}</div>${s.writable && !state.data.readOnly ? `<div style="margin-top:8px"><button class="btn btn-sm btn-primary" id="ai-apply-desc">Apply to frontmatter</button></div>` : ""}</div>` : ""}
      <div class="ai-meta">${esc(a.model)} via ${esc(a.provider)} · ${a.cached ? "cached" : `${Math.round((a.ms || 0) / 1000)}s`}${a.usage?.total_tokens ? ` · ${a.usage.total_tokens} tokens` : a.usage?.input_tokens ? ` · ${a.usage.input_tokens + (a.usage.output_tokens || 0)} tokens` : ""}${a.truncated ? " · body was truncated for the model" : ""} · ${fmtDate(a.at)}</div>`;
    $("#ai-rerun", body).onclick = () => runAssessment(s.id, { force: true });
    $("#ai-compare", body).onclick = () => comparePickDialog(s.id);
    $("#ai-apply-desc", body)?.addEventListener("click", async () => {
      try {
        const data = { ...(s.frontmatter || {}), name: s.frontmatter?.name ?? s.slug, description: r.improvedDescription };
        await api(`/api/skills/${s.id}/frontmatter`, { method: "PUT", body: { data } });
        toast("Description updated", { kind: "ok" });
        await load(true);
        openSkill(s.id, { keepTab: true });
      } catch (err) {
        toast(err.message, { kind: "err" });
      }
    });
  }

  async function runAssessment(id, { force = false } = {}) {
    if (aiNotReady()) return aiSettingsDialog();
    state.assessments[id] = "loading";
    if (state.detail?.id === id && state.tab === "ai") renderTab();
    try {
      state.assessments[id] = await api("/api/ai/assess", { method: "POST", body: { id, force } });
    } catch (err) {
      delete state.assessments[id];
      toast(err.message, { kind: "err", timeout: 10000 });
    }
    if (state.detail?.id === id) renderDetail();
  }

  function comparePickDialog(aId) {
    if (aiNotReady()) return aiSettingsDialog();
    const a = state.skills.find((s) => s.id === aId);
    const others = state.skills.filter((s) => s.id !== aId);
    modal({
      title: `Compare "${a?.name}" with…`,
      body: `<div class="field"><label>Filter</label><input id="cmp-filter" placeholder="type to filter" /></div>
        <div class="field"><label>Skill B</label><select id="cmp-b" size="10" style="width:100%">${others.map((s) => `<option value="${s.id}">${esc(s.name)} — ${esc(s.agentLabel)} · ${esc(s.drawerLabel)}</option>`).join("")}</select></div>`,
      footer: `<button class="btn btn-primary" id="cmp-go">Compare</button>`,
      onOpen(el, close) {
        const sel = $("#cmp-b", el);
        const f = $("#cmp-filter", el);
        f.focus();
        f.addEventListener("input", () => {
          const q = f.value.toLowerCase();
          for (const o of sel.options) o.hidden = q && !o.text.toLowerCase().includes(q);
        });
        const go = () => { if (!sel.value) return; close(); runComparison(aId, sel.value); };
        $("#cmp-go", el).onclick = go;
        sel.addEventListener("dblclick", go);
      },
    });
  }

  async function runComparison(aId, bId, { force = false } = {}) {
    if (aiNotReady()) return aiSettingsDialog();
    const m = modal({ title: "Comparing…", wide: true, body: `<p><span class="spinner"></span>Asking ${esc(state.ai.model)} to compare both skills. This usually takes 15–90 seconds.</p>` });
    let r;
    try {
      r = await api("/api/ai/compare", { method: "POST", body: { a: aId, b: bId, force } });
    } catch (err) {
      m.close();
      return toast(err.message, { kind: "err", timeout: 10000 });
    }
    m.close();
    state.comparisons[[aId, bId].sort().join("|")] = r;
    let stat = null;
    let diff = null;
    try { stat = (await api(`/api/overlap?ids=${aId},${bId}&threshold=0`)).pairs[0] || null; } catch { stat = null; }
    try { diff = await api(`/api/skills/${aId}/diff?other=${bId}`); } catch { diff = null; }
    const c = r.result || {};
    const pct = (x) => `${Math.round((x || 0) * 100)}%`;
    const ul = (items) => (items?.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : `<p class="muted">—</p>`);
    const recLabel = { "keep-a": `Keep A (${r.a.name}) and drop B`, "keep-b": `Keep B (${r.b.name}) and drop A`, "keep-both": "Keep both", merge: "Merge them into one" }[c.recommendation] || c.recommendation;
    modal({
      title: `AI comparison: ${r.a.name} vs ${r.b.name}`,
      wide: true,
      body: `<p>${esc(c.summary || "")}</p>
        <div class="row" style="gap:16px"><span>AI overlap <b>${esc(c.overlap)}%</b></span><span>Same job: <b>${c.sameJob ? "yes" : "no"}</b></span><span>AI quality A <b>${esc(c.scoreA)}</b> · B <b>${esc(c.scoreB)}</b></span>${stat ? `<span class="muted">Static: ${pct(stat.score)} (description ${pct(stat.description)}, body ${pct(stat.body)}, name ${pct(stat.name)})</span>` : ""}<span class="muted">Static quality A ${esc(r.a.qualityScore)} · B ${esc(r.b.qualityScore)}</span></div>
        <div class="rec"><b>${esc(recLabel)}</b><div>${esc(c.rationale || "")}</div></div>
        <div class="cmp-grid">
          <div class="cmp-col"><h3>A · ${esc(r.a.name)} <span class="agent-chip">${esc(r.a.agentLabel)}</span></h3><div class="muted mono" style="font-size:11px">${esc(r.a.path)}</div><div class="section-title">Does better</div>${ul(c.strengthsA)}</div>
          <div class="cmp-col"><h3>B · ${esc(r.b.name)} <span class="agent-chip">${esc(r.b.agentLabel)}</span></h3><div class="muted mono" style="font-size:11px">${esc(r.b.path)}</div><div class="section-title">Does better</div>${ul(c.strengthsB)}</div>
        </div>
        <div class="section-title">Differences</div>${ul(c.differences)}
        ${c.mergePlan?.length ? `<div class="section-title">Merge plan</div>${ul(c.mergePlan)}` : ""}
        ${c.triggerFix ? `<div class="section-title">Trigger fix</div><div class="notice">${esc(c.triggerFix)}</div>` : ""}
        ${!state.data.readOnly ? `<div class="section-title">Quick actions</div><div class="row">
          ${r.a.writable ? `<button class="btn btn-sm" data-desc="b2a" title="Overwrite A's description with B's">Use B's description on A</button>` : ""}
          ${r.b.writable ? `<button class="btn btn-sm" data-desc="a2b" title="Overwrite B's description with A's">Use A's description on B</button>` : ""}
          ${r.a.writable && r.b.writable ? `<button class="btn btn-sm" data-trash="${c.recommendation === "keep-a" ? "b" : c.recommendation === "keep-b" ? "a" : ""}" ${c.recommendation === "keep-a" || c.recommendation === "keep-b" ? "" : "hidden"}>Trash ${c.recommendation === "keep-a" ? "B" : "A"} as recommended</button>` : ""}
        </div>` : ""}
        <div class="section-title">SKILL.md diff (A → B)${diff ? ` <span class="muted">+${diff.added} −${diff.removed}</span>` : ""}</div>
        ${diff ? (diff.same ? `<p class="muted">The two SKILL.md files are identical.</p>` : `<div class="diff">${diff.ops.map((o) => `<div class="${o.type}">${o.type === "add" ? "+" : o.type === "del" ? "−" : " "} ${esc(o.text)}</div>`).join("")}</div>`) : `<p class="muted">Diff unavailable.</p>`}
        <div class="ai-meta">${esc(r.model)} via ${esc(r.provider)} · ${r.cached ? "cached" : `${Math.round((r.ms || 0) / 1000)}s`}${r.truncated ? " · a body was truncated for the model" : ""}</div>`,
      footer: `<button class="btn" id="cmp-open-a">Open A</button><button class="btn" id="cmp-open-b">Open B</button><button class="btn" id="cmp-again">Re-compare</button>`,
      onOpen(el, close) {
        $("#cmp-open-a", el).onclick = () => { close(); openSkill(r.a.id); };
        $("#cmp-open-b", el).onclick = () => { close(); openSkill(r.b.id); };
        $("#cmp-again", el).onclick = () => { close(); runComparison(aId, bId, { force: true }); };
        $$("[data-desc]", el).forEach((b) => (b.onclick = async () => {
          const [from, to] = b.dataset.desc === "b2a" ? [r.b, r.a] : [r.a, r.b];
          try {
            const data = { ...(to.frontmatter || {}), name: to.frontmatter?.name ?? to.slug, description: from.frontmatter?.description ?? from.description };
            await api(`/api/skills/${to.id}/frontmatter`, { method: "PUT", body: { data } });
            toast(`Description copied to ${to.name}`, { kind: "ok" });
            await load(true);
          } catch (err) { toast(err.message, { kind: "err" }); }
        }));
        $$("[data-trash]", el).forEach((b) => (b.onclick = () => { const victim = b.dataset.trash === "a" ? r.a : r.b; close(); removeSkills([victim.id], false); }));
      },
    });
  }

  async function aiSettingsDialog() {
    let cfg;
    try {
      cfg = await api("/api/ai/config");
      state.ai = cfg;
    } catch (err) {
      return toast(err.message, { kind: "err" });
    }
    const ro = state.data?.readOnly;
    modal({
      title: "AI settings",
      body: `<p class="muted">Used for <b>Assess</b> and <b>Compare</b>. Skill contents are sent to this endpoint and nowhere else. Settings are stored in <span class="mono">${esc(state.data?.storeHome || "~/.skill-drawer")}/ai.json</span> (the key is stored there too, readable only by you).</p>
        <div class="field"><label>Preset</label><select id="ai-preset"><option value="">— pick to fill in the fields —</option>${cfg.presets.map((p) => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join("")}</select></div>
        <div class="field"><label>API format</label><select id="ai-provider"><option value="openai" ${cfg.provider === "openai" ? "selected" : ""}>OpenAI-compatible chat completions (POST {baseUrl}/chat/completions)</option><option value="anthropic" ${cfg.provider === "anthropic" ? "selected" : ""}>Anthropic Messages API (POST {baseUrl}/v1/messages)</option></select></div>
        <div class="field"><label>Base URL</label><input id="ai-base" value="${esc(cfg.baseUrl)}" placeholder="https://api.openai.com/v1" /></div>
        <div class="field"><label>Model</label><input id="ai-model" value="${esc(cfg.model)}" placeholder="model id as the provider names it" /></div>
        <div class="field"><label>API key ${cfg.hasKey ? `<span class="muted">(stored: ${esc(cfg.keyHint)}; leave blank to keep)</span>` : ""}</label><input id="ai-key" type="password" autocomplete="off" placeholder="${cfg.hasKey ? "unchanged" : "sk-…  (leave empty for local servers)"}" /></div>
        <div class="row"><div class="field" style="flex:1"><label>Temperature</label><input id="ai-temp" type="number" step="0.1" min="0" max="2" value="${esc(cfg.temperature)}" /></div><div class="field" style="flex:1"><label>Max output tokens</label><input id="ai-max" type="number" min="256" value="${esc(cfg.maxTokens)}" /></div></div>
        <div id="ai-result"></div>`,
      footer: `<button class="btn" id="ai-clear-key" title="Remove the stored key">Forget key</button><button class="btn" id="ai-test">Test</button><button class="btn btn-primary" id="ai-save" ${ro ? "disabled" : ""}>Save</button>`,
      onOpen(el, close) {
        const read = () => ({
          provider: $("#ai-provider", el).value,
          baseUrl: $("#ai-base", el).value.trim(),
          model: $("#ai-model", el).value.trim(),
          apiKey: $("#ai-key", el).value ? $("#ai-key", el).value : "keep",
          temperature: Number($("#ai-temp", el).value),
          maxTokens: Number($("#ai-max", el).value),
        });
        $("#ai-preset", el).onchange = () => {
          const p = cfg.presets.find((x) => x.id === $("#ai-preset", el).value);
          if (!p) return;
          $("#ai-provider", el).value = p.provider;
          $("#ai-base", el).value = p.baseUrl;
          $("#ai-model", el).value = p.model;
          $("#ai-result", el).innerHTML = p.keyEnv ? `<p class="muted">Tip: the server also reads the <span class="mono">${esc(p.keyEnv)}</span> environment variable if no key is saved.</p>` : "";
        };
        $("#ai-test", el).onclick = async () => {
          $("#ai-result", el).innerHTML = `<p><span class="spinner"></span>Testing…</p>`;
          try {
            const r = await api("/api/ai/test", { method: "POST", body: { config: read() } });
            $("#ai-result", el).innerHTML = `<div class="problem info">Connected: ${esc(r.model)} replied "${esc(r.reply)}" in ${r.ms} ms.</div>`;
          } catch (err) {
            $("#ai-result", el).innerHTML = `<div class="problem error">${esc(err.message)}</div>`;
          }
        };
        $("#ai-save", el).onclick = async () => {
          try {
            state.ai = await api("/api/ai/config", { method: "PUT", body: read() });
            toast("AI settings saved", { kind: "ok" });
            close();
            if (state.detail) renderDetail();
          } catch (err) {
            toast(err.message, { kind: "err" });
          }
        };
        $("#ai-clear-key", el).onclick = async () => {
          try {
            state.ai = await api("/api/ai/config", { method: "PUT", body: { apiKey: "" } });
            $("#ai-key", el).placeholder = "sk-…";
            toast("Key removed", { kind: "ok" });
          } catch (err) {
            toast(err.message, { kind: "err" });
          }
        };
      },
    });
  }

  async function agentSettingsDialog() {
    let cfg;
    try {
      cfg = await api("/api/agents/settings");
    } catch (err) {
      return toast(err.message, { kind: "err" });
    }
    const counts = new Map((state.data?.agents || []).map((a) => [a.id, a.count]));
    const rows = cfg.agents
      .slice()
      .sort((a, b) => Number(b.installed) - Number(a.installed) || a.label.localeCompare(b.label))
      .map((a) => `<label class="check" title="${esc(a.via.join(", ") || "not detected on this machine")}">
          <input type="checkbox" data-agent-show="${esc(a.id)}" ${a.hidden ? "" : "checked"} />
          <span>${esc(a.label)}</span>
          <span class="muted" style="font-size:11.5px">${a.custom ? "custom · " : a.shared ? "shared folder · " : ""}${a.installed ? esc(a.via[0] || "detected") : "not detected"}${counts.get(a.id) ? ` · ${counts.get(a.id)} skill${counts.get(a.id) === 1 ? "" : "s"}` : ""}</span>
        </label>`)
      .join("");
    modal({
      title: "Agents",
      wide: true,
      body: `<p class="muted">Unticked agents are hidden from the sidebar and the grouped list; their skills are not scanned. Agents that are neither installed nor holding skills never appear at all.</p>
        <div class="section-title">Show</div>
        <div style="columns:2;column-gap:24px">${rows}</div>
        <div class="section-title">Your own agents</div>
        <p class="muted" style="margin-top:0">Point Skill Drawer at any other tool's skills folder. The user folder must be an absolute path; project folders are relative to a repository root.</p>
        <div id="custom-rows"></div>
        <button class="btn btn-sm" id="add-custom">Add an agent</button>`,
      footer: `<button class="btn" data-cancel>Cancel</button><button class="btn btn-primary" id="agents-save">Save</button>`,
      onOpen(el, close) {
        let custom = (cfg.custom || []).map((c) => ({ ...c }));
        const renderCustom = () => {
          $("#custom-rows", el).innerHTML = custom.length
            ? custom.map((c, i) => `<div class="row" style="gap:8px;margin-bottom:8px">
                <input style="flex:0 0 130px" placeholder="Name" value="${esc(c.label || "")}" data-c="label" data-i="${i}" />
                <input style="flex:1" placeholder="/absolute/path/to/skills" value="${esc(c.userSkills || "")}" data-c="userSkills" data-i="${i}" />
                <input style="flex:0 0 160px" placeholder=".tool/skills (project)" value="${esc((c.projectSkills || []).join(", "))}" data-c="projectSkills" data-i="${i}" />
                <button class="btn btn-sm btn-danger" data-del="${i}">Remove</button>
              </div>`).join("")
            : `<p class="muted">None yet.</p>`;
          $$("[data-c]", el).forEach((inp) => (inp.oninput = () => {
            const c = custom[Number(inp.dataset.i)];
            if (inp.dataset.c === "projectSkills") c.projectSkills = inp.value.split(",").map((x) => x.trim()).filter(Boolean);
            else c[inp.dataset.c] = inp.value;
            if (inp.dataset.c === "label") c.id = inp.value;
          }));
          $$("[data-del]", el).forEach((b) => (b.onclick = () => { custom.splice(Number(b.dataset.del), 1); renderCustom(); }));
        };
        renderCustom();
        $("#add-custom", el).onclick = () => { custom.push({ id: "", label: "", userSkills: "", projectSkills: [] }); renderCustom(); };
        $("[data-cancel]", el).onclick = close;
        $("#agents-save", el).onclick = async () => {
          try {
            const hidden = $$("[data-agent-show]", el).filter((c) => !c.checked).map((c) => c.dataset.agentShow);
            await api("/api/agents/settings", { method: "PUT", body: { hidden, custom: custom.filter((c) => (c.label || c.id) && c.userSkills) } });
            close();
            toast("Agents updated", { kind: "ok" });
            await load(true);
          } catch (err) {
            toast(err.message, { kind: "err" });
          }
        };
      },
    });
  }

  /* ---------- Quality & overlap panels ---------- */
  const sbar = (score, max = 100) => { const pct = Math.round((score / max) * 100); const cls = pct >= 70 ? "ok" : pct >= 50 ? "warn" : "err"; return `<span class="sbar ${cls}"><i style="width:${pct}%"></i></span>`; };

  async function qualityPanel() {
    let rows;
    try {
      rows = await api(`/api/quality?agent=${encodeURIComponent(state.agent)}`);
    } catch (err) {
      return toast(err.message, { kind: "err" });
    }
    const scope = state.agent === "all" ? "all agents" : state.data.agents.find((a) => a.id === state.agent)?.label || state.agent;
    const aiCell = (id) => {
      const a = state.assessments[id];
      if (a === "loading") return `<span class="spinner"></span>`;
      if (!a) return `<a data-assess="${esc(id)}">assess</a>`;
      return `${sbar(a.result?.score ?? 0)}<b>${esc(a.result?.score)}</b> <span class="muted">${esc(a.result?.grade || "")}</span>`;
    };
    const render = (el) => {
      $("#q-table", el).innerHTML = `<table class="grid"><thead><tr><th>Static</th><th>Skill</th><th>Agent</th><th>Fix first</th><th>AI</th></tr></thead><tbody>${rows
        .map((r) => `<tr>
          <td>${sbar(r.quality.score)}<b>${r.quality.score}</b> <span class="qchip q-${esc(r.quality.grade)}">${esc(r.quality.grade)}</span></td>
          <td><a data-goto="${esc(r.id)}">${esc(r.name)}</a>${r.disabled ? ` <span class="badge badge-muted">disabled</span>` : ""}</td>
          <td><span class="agent-chip">${esc(r.agentLabel)}</span></td>
          <td class="muted" style="font-size:12.5px">${esc(r.quality.parts.filter((p) => p.points < p.max).sort((x, y) => (y.max - y.points) - (x.max - x.points)).slice(0, 2).map((p) => `${p.label}: ${p.note}`).join(" · ") || "nothing major")}</td>
          <td data-ai="${esc(r.id)}">${aiCell(r.id)}</td></tr>`)
        .join("")}</tbody></table>`;
      $$("[data-goto]", el).forEach((a) => (a.onclick = () => { m.close(); openSkill(a.dataset.goto); }));
      $$("[data-assess]", el).forEach((a) => (a.onclick = () => runOne(a.dataset.assess)));
    };
    const runOne = async (id) => {
      if (aiNotReady()) return aiSettingsDialog();
      state.assessments[id] = "loading";
      render(m.el);
      try { state.assessments[id] = await api("/api/ai/assess", { method: "POST", body: { id } }); }
      catch (err) { delete state.assessments[id]; toast(err.message, { kind: "err" }); }
      render(m.el);
    };
    const m = modal({
      title: `Quality check — ${scope} (${rows.length})`,
      wide: true,
      body: `<div class="panel-tools">
          <span class="muted">Static score: frontmatter 20 · description-as-trigger 30 · instructions 25 · safety 15 · structure 10. AI score: your configured model's judgement.</span>
          <span class="spacer"></span>
          <button class="btn btn-sm btn-primary" id="q-all">Assess all with AI</button>
          <div class="progress" id="q-prog" hidden><i style="width:0"></i></div>
        </div>
        <div id="q-table"></div>`,
    });
    render(m.el);
    $("#q-all", m.el).onclick = async () => {
      if (aiNotReady()) return aiSettingsDialog();
      const todo = rows.filter((r) => !state.assessments[r.id] || state.assessments[r.id] === "loading").map((r) => r.id);
      if (!todo.length) return toast("Everything is already assessed", { timeout: 2000 });
      const prog = $("#q-prog", m.el);
      prog.hidden = false;
      let done = 0;
      const worker = async () => {
        while (todo.length) {
          const id = todo.shift();
          await runOne(id);
          done += 1;
          $("i", prog).style.width = `${Math.round((done / rows.length) * 100)}%`;
        }
      };
      await Promise.all([worker(), worker()]);
      prog.hidden = true;
      toast("Quality check complete", { kind: "ok" });
      if (state.detail) renderDetail();
    };
  }

  async function overlapPanel() {
    let threshold = 0.35;
    let data;
    const fetchPairs = async () => api(`/api/overlap?agent=${encodeURIComponent(state.agent)}&threshold=${threshold}`);
    try {
      data = await fetchPairs();
    } catch (err) {
      return toast(err.message, { kind: "err" });
    }
    const scope = state.agent === "all" ? "all agents" : state.data.agents.find((a) => a.id === state.agent)?.label || state.agent;
    const key = (p) => [p.a.id, p.b.id].sort().join("|");
    const verdict = (p) => {
      const c = state.comparisons[key(p)];
      if (c === "loading") return `<span class="spinner"></span>`;
      if (!c) return `<a data-check="${esc(p.a.id)}|${esc(p.b.id)}">check with AI</a>`;
      const r = c.result || {};
      const rec = { "keep-a": "keep A", "keep-b": "keep B", "keep-both": "keep both", merge: "merge" }[r.recommendation] || r.recommendation;
      return `<b>${esc(r.overlap)}%</b> ${r.sameJob ? "same job" : "different jobs"} · <b>${esc(rec)}</b> <a data-open="${esc(p.a.id)}|${esc(p.b.id)}">details</a>`;
    };
    const render = (el) => {
      const pct = (x) => `${Math.round(x * 100)}%`;
      $("#o-summary", el).textContent = `${data.total} pair${data.total === 1 ? "" : "s"} above ${Math.round(threshold * 100)}% among ${data.considered} skills`;
      $("#o-table", el).innerHTML = data.pairs.length
        ? `<table class="grid"><thead><tr><th>Overlap</th><th>Skill A</th><th>Skill B</th><th>Where</th><th>AI verdict</th></tr></thead><tbody>${data.pairs
          .map((p) => `<tr>
            <td title="name ${pct(p.name)} · description ${pct(p.description)} · body ${pct(p.body)}">${sbar(p.score * 100)}<b>${pct(p.score)}</b><div class="muted" style="font-size:11px">${p.identical ? "identical copies" : `desc ${pct(p.description)} · body ${pct(p.body)} · name ${pct(p.name)}`}</div></td>
            <td><a data-goto="${esc(p.a.id)}">${esc(p.a.name)}</a><div class="muted" style="font-size:11px">${esc(p.a.agentLabel)}</div></td>
            <td><a data-goto="${esc(p.b.id)}">${esc(p.b.name)}</a><div class="muted" style="font-size:11px">${esc(p.b.agentLabel)}</div></td>
            <td>${p.sameDrawer ? `<span class="badge badge-err">same drawer</span>` : p.sameAgent ? `<span class="badge badge-warn">same agent</span>` : `<span class="badge badge-info">across agents</span>`}</td>
            <td>${verdict(p)}</td></tr>`)
          .join("")}</tbody></table>`
        : `<p class="muted">No pairs above the threshold. Lower it to look harder.</p>`;
      $$("[data-goto]", el).forEach((a) => (a.onclick = () => { m.close(); openSkill(a.dataset.goto); }));
      $$("[data-check]", el).forEach((a) => (a.onclick = () => checkOne(...a.dataset.check.split("|"))));
      $$("[data-open]", el).forEach((a) => (a.onclick = () => { const [x, y] = a.dataset.open.split("|"); m.close(); runComparison(x, y); }));
    };
    const checkOne = async (aId, bId) => {
      if (aiNotReady()) return aiSettingsDialog();
      const k = [aId, bId].sort().join("|");
      state.comparisons[k] = "loading";
      render(m.el);
      try { state.comparisons[k] = await api("/api/ai/compare", { method: "POST", body: { a: aId, b: bId } }); }
      catch (err) { delete state.comparisons[k]; toast(err.message, { kind: "err" }); }
      render(m.el);
    };
    const m = modal({
      title: `Overlap check — ${scope}`,
      wide: true,
      body: `<div class="panel-tools">
          <label>Threshold <input type="range" id="o-th" min="0.15" max="0.9" step="0.05" value="${threshold}" /> <span id="o-thv">${Math.round(threshold * 100)}%</span></label>
          <span class="muted" id="o-summary"></span>
          <span class="spacer"></span>
          <button class="btn btn-sm btn-primary" id="o-ai">Check top 10 with AI</button>
          <div class="progress" id="o-prog" hidden><i style="width:0"></i></div>
        </div>
        <p class="muted" style="margin:0 0 10px;font-size:12.5px">Static overlap weighs the descriptions most (that is what the agent chooses on), then bodies, then names. Same drawer = the tool will pick one unpredictably; same agent = both may be loaded; across agents = duplication to reconcile.</p>
        <div id="o-table"></div>`,
    });
    render(m.el);
    $("#o-th", m.el).oninput = async (e) => {
      threshold = Number(e.target.value);
      $("#o-thv", m.el).textContent = `${Math.round(threshold * 100)}%`;
      try { data = await fetchPairs(); render(m.el); } catch (err) { toast(err.message, { kind: "err" }); }
    };
    $("#o-ai", m.el).onclick = async () => {
      if (aiNotReady()) return aiSettingsDialog();
      const todo = data.pairs.filter((p) => !p.identical && !state.comparisons[key(p)]).slice(0, 10);
      if (!todo.length) return toast("Nothing left to check", { timeout: 2000 });
      const prog = $("#o-prog", m.el);
      prog.hidden = false;
      let done = 0;
      const worker = async () => {
        while (todo.length) {
          const p = todo.shift();
          await checkOne(p.a.id, p.b.id);
          done += 1;
          $("i", prog).style.width = `${Math.round((done / 10) * 100)}%`;
        }
      };
      await Promise.all([worker(), worker()]);
      prog.hidden = true;
    };
  }

  /* ---------- Dialogs ---------- */
  /**
   * Export is always a bundle: the manifest-only form carries no file contents,
   * so it can only be restored for skills that came from GitHub.
   */
  function exportSkills(ids) {
    const qs = ids?.length ? `&ids=${ids.join(",")}` : "";
    const a = document.createElement("a");
    a.href = `/api/export?format=bundle${qs}`;
    a.download = "skill-drawer-bundle.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast(`Exporting ${ids?.length ? `${ids.length} skill${ids.length === 1 ? "" : "s"}` : "every active skill"}`, { kind: "ok", timeout: 3000 });
  }

  function importDialog() {
    modal({
      title: "Import manifest or bundle",
      body: `<div class="field"><label>File</label><input type="file" id="import-file" accept="application/json,.json" /></div>
        <div class="field"><label>Or paste JSON</label><textarea id="import-text" placeholder='{"format":"skill-drawer-bundle", ...}'></textarea></div>
        <div class="field"><label>Into drawer</label><select id="import-drawer">${drawerOptions(currentDrawerId())}</select></div>
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
        <div class="field"><label>Into drawer</label><select id="install-drawer">${drawerOptions(currentDrawerId())}</select></div>
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
        <div class="field"><label>Drawer</label><select id="new-drawer">${drawerOptions(currentDrawerId())}</select></div>`,
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
      title: `Deleted (${data.entries.length})`,
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
          if (!(await confirm({ title: "Empty the trash?", message: `All ${data.entries.length} deleted skills will be removed permanently.`, ok: "Delete all", danger: true }))) return;
          try { await api("/api/trash", { method: "DELETE" }); close(); await load(true); toast("Trash emptied", { kind: "ok" }); }
          catch (err) { toast(err.message, { kind: "err" }); }
        };
      },
    });
  }

  const CAP = 8;

  /** A capped list with a "show all" expander, so a big drawer stays readable. */
  function capped(items, render, noun) {
    if (!items.length) return `<p class="muted">None.</p>`;
    const head = items.slice(0, CAP).map(render).join("");
    if (items.length <= CAP) return head;
    const rest = items.slice(CAP).map(render).join("");
    const id = `more-${Math.random().toString(36).slice(2, 9)}`;
    return `${head}<div id="${id}" hidden>${rest}</div><button class="btn btn-sm" data-more="${id}" data-count="${items.length - CAP}">Show ${items.length - CAP} more ${esc(noun)}</button>`;
  }

  function wireExpanders(el) {
    $$("[data-more]", el).forEach((b) => (b.onclick = () => {
      $(`#${b.dataset.more}`, el).hidden = false;
      b.remove();
    }));
  }

  async function issuesDialog() {
    let data;
    try {
      data = await api("/api/issues");
    } catch (err) {
      return toast(err.message, { kind: "err" });
    }
    const link = (s) => `<li><a data-goto="${s.id}">${esc(s.path || s.name)}</a></li>`;
    const byType = new Map();
    for (const c of data.conflicts) {
      if (!byType.has(c.type)) byType.set(c.type, []);
      byType.get(c.type).push(c);
    }
    const TYPE_LABEL = {
      "exact-copy": "Identical copies",
      "same-name": "Same name, different content",
      "similar-name": "Near-identical names",
      "overlapping-description": "Overlapping triggers",
    };
    const conflictSection = [...byType.entries()]
      .map(([type, list]) => `<div class="section-title">${esc(TYPE_LABEL[type] || type)} (${list.length})</div>${capped(list, (c) => `<div class="issue"><div class="head"><span class="badge badge-${c.severity === "warning" ? "warn" : "info"}">${esc(c.severity)}</span>${esc(c.title)}${c.skills.length === 2 && c.type !== "exact-copy" ? `<span class="spacer"></span><button class="btn btn-sm" data-cmp="${esc(c.skills[0].id)}|${esc(c.skills[1].id)}">Compare (AI)</button>` : ""}</div><div class="detail">${esc(c.detail)}</div><ul>${c.skills.map(link).join("")}</ul></div>`, "pairs")}`)
      .join("");
    const lintSection = capped(data.lint, (l) => `<div class="issue"><div class="head"><span class="badge badge-${l.status === "error" ? "err" : l.status === "warning" ? "warn" : "info"}">${esc(l.status)}</span><a data-goto="${l.id}">${esc(l.name)}</a> <span class="muted">${esc(l.drawer)}</span>${l.problems.some((p) => p.fix) ? `<span class="spacer"></span><button class="btn btn-sm" data-fix="${esc(l.id)}">Fix name</button>` : ""}</div><ul>${l.problems.slice(0, 4).map((p) => `<li>${esc(p.message)}</li>`).join("")}</ul></div>`, "skills");
    const riskSection = capped(data.risk, (r) => `<div class="issue"><div class="head"><span class="badge badge-${RISK[r.risk] >= 3 ? "err" : "warn"}">${esc(r.risk)}</span><a data-goto="${r.id}">${esc(r.name)}</a> <span class="muted">${esc(r.drawer)}</span></div><ul>${r.findings.slice(0, 3).map((f) => `<li>${esc(f.message)} <span class="muted">${esc(f.file)}:${f.line}</span></li>`).join("")}</ul></div>`, "skills");
    const total = data.conflicts.length + data.lint.length + data.risk.length;
    const m = modal({
      title: `Issues (${total})`,
      wide: true,
      body: `<p class="muted">${data.conflicts.length} duplicate or overlap ${data.conflicts.length === 1 ? "pair" : "pairs"} · ${data.lint.length} with lint problems · ${data.risk.length} with risk findings. Each group shows the first ${CAP}.</p>
        <div class="section-title">Duplicates &amp; conflicts (${data.conflicts.length})</div>${data.conflicts.length ? conflictSection : `<p class="muted">None.</p>`}
        <div class="section-title">Lint (${data.lint.length})</div>${lintSection}
        <div class="section-title">Risk audit (${data.risk.length})</div>${riskSection}`,
      onOpen(el, close) {
        wireExpanders(el);
        $$("[data-goto]", el).forEach((a) => (a.onclick = () => { close(); openSkill(a.dataset.goto); }));
        $$("[data-cmp]", el).forEach((b) => (b.onclick = () => { const [x, y] = b.dataset.cmp.split("|"); close(); runComparison(x, y); }));
        $$("[data-fix]", el).forEach((b) => (b.onclick = () => { close(); applyFix(b.dataset.fix, "name"); }));
      },
    });
    // Expanders inside sections revealed later still need wiring.
    m.el.addEventListener("click", () => wireExpanders(m.el));
  }

  function helpDialog() {
    const rows = [
      ["j / ↓", "next skill"], ["k / ↑", "previous skill"], ["Enter", "open selected"], ["/", "search"],
      ["x / Space", "mark / unmark"], ["a", "mark all visible"], ["d", "trash marked (or current)"],
      ["e", "disable / enable current"], ["c / m", "copy / move to another agent"], ["n", "new skill"], ["i", "install"], ["t", "deleted skills"], ["!", "issues"],
      ["1–7", "switch tab (7 = AI)"], ["r", "rescan"], ["Esc", "clear marks / close"], ["?", "this help"],
    ];
    modal({
      title: "Keyboard shortcuts",
      body: `<div class="shortcuts">${rows.map(([k, v]) => `<kbd>${esc(k)}</kbd><span>${esc(v)}</span>`).join("")}</div>
        <div class="section-title">Search</div>
        <p class="muted" style="margin-top:0">Bare words must all match; results are ranked by how well they match. Wrap a <code>"phrase"</code> in quotes, prefix with <code>-</code> to exclude, and combine any of these filters:</p>
        <div class="syntax">${FILTERS.map(([k, hint]) => `<code>${esc(k)}:</code><span class="muted">${esc(hint)}</span>`).join("")}</div>
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
      case "c": if (ro) break; if (state.marked.size) transferDialog([...state.marked], false); else if (cur && !cur.disabled) transferDialog([cur.id], false); break;
      case "m": if (ro) break; if (state.marked.size) transferDialog([...state.marked], true); else if (cur && cur.writable && !cur.disabled) transferDialog([cur.id], true); break;
      case "n": if (!ro) newSkillDialog(); break;
      case "i": if (!ro) installDialog(); break;
      case "t": trashDialog(); break;
      case "!": issuesDialog(); break;
      case "r": load(true); toast("Rescanned", { timeout: 1500 }); break;
      case "?": helpDialog(); break;
      case "Escape": state.marked.clear(); renderList(); break;
      default: {
        const n = Number(e.key);
        if (n >= 1 && n <= 7 && cur) { state.tab = ["rendered", "source", "frontmatter", "files", "health", "edit", "ai"][n - 1]; renderDetail(); }
      }
    }
  });

  /* ---------- Wiring ---------- */
  $("#search").addEventListener("input", (e) => { state.query = e.target.value; applyFilters(); });
  $("#search").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.target.blur(); move(0); } });
  $("#sort").onchange = (e) => { state.sort = e.target.value; applyFilters(); };
  for (const key of ["attention", "disabled"]) {
    $(`#f-${key}`).onchange = (e) => { state.filters[key] = e.target.checked; applyFilters(); };
  }
  $("#select-all").onchange = (e) => {
    if (e.target.checked) state.filtered.forEach((s) => state.marked.add(s.id));
    else state.filtered.forEach((s) => state.marked.delete(s.id));
    renderList();
  };
  $("#bulk-delete").onclick = () => removeSkills([...state.marked], false);
  $("#bulk-disable").onclick = () => bulkDisable([...state.marked]);
  $("#bulk-copy").onclick = () => transferDialog([...state.marked], false);
  $("#bulk-move").onclick = () => transferDialog([...state.marked], true);
  $("#bulk-archive").onclick = () => archiveSkills([...state.marked]);
  $("#btn-ai").onclick = aiSettingsDialog;
  $("#bulk-compare").onclick = () => { const [a, b] = [...state.marked]; runComparison(a, b); };
  $("#bulk-export").onclick = () => exportSkills([...state.marked]);
  $("#bulk-clear").onclick = () => { state.marked.clear(); renderList(); };
  $("#btn-new").onclick = newSkillDialog;
  $("#btn-install").onclick = installDialog;
  $("#btn-help").onclick = helpDialog;
  $("#btn-agent-settings").onclick = agentSettingsDialog;
  $("#group-agent").checked = state.groupByAgent;
  $("#group-agent").onchange = (e) => { state.groupByAgent = e.target.checked; persistGroup(); renderList(); };

  const PANELS = {
    quality: qualityPanel,
    overlap: overlapPanel,
    issues: issuesDialog,
    archived: archiveDialog,
    trashed: trashDialog,
    import: importDialog,
    export: () => exportSkills(state.marked.size ? [...state.marked] : null),
  };
  const closeMenus = () => $$(".menu").forEach((m) => {
    m.hidden = true;
    m.previousElementSibling?.setAttribute("aria-expanded", "false");
  });
  for (const [btn, menu] of [["#btn-checks", "#menu-checks"], ["#btn-transfer", "#menu-transfer"]]) {
    $(btn).onclick = (e) => {
      e.stopPropagation();
      const el = $(menu);
      const open = el.hidden;
      closeMenus();
      el.hidden = !open;
      $(btn).setAttribute("aria-expanded", String(open));
    };
  }
  $$("[data-panel]").forEach((b) => (b.onclick = () => { closeMenus(); PANELS[b.dataset.panel]?.(); }));
  document.addEventListener("click", (e) => { if (!e.target.closest(".menu-wrap")) closeMenus(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenus(); }, true);
  $("#btn-refresh").onclick = () => load(true);

  const themeSel = $("#theme");
  let savedTheme = "auto";
  try { savedTheme = localStorage.getItem("skill-drawer-theme") || "auto"; } catch { /* ignore */ }
  if (!["auto", "dark", "light"].includes(savedTheme)) savedTheme = savedTheme === "paper" ? "light" : "dark";
  document.documentElement.dataset.theme = savedTheme;
  themeSel.value = savedTheme;
  themeSel.onchange = () => {
    document.documentElement.dataset.theme = themeSel.value;
    try { localStorage.setItem("skill-drawer-theme", themeSel.value); } catch { /* ignore */ }
  };

  window.addEventListener("beforeunload", (e) => { if (state.editorDirty) { e.preventDefault(); e.returnValue = ""; } });

  /* Live reload: the server watches the drawers and tells us when they change. */
  function listenForChanges() {
    if (!window.EventSource) return;
    let source;
    try {
      source = new EventSource("/api/events");
    } catch {
      return;
    }
    source.addEventListener("changed", () => {
      // Never yank the ground out from under an unsaved edit.
      if (state.editorDirty) return;
      load(true);
    });
    source.onerror = () => { /* EventSource reconnects on its own */ };
  }

  load().then(() => {
    listenForChanges();
    // Hide mutating controls in read-only mode.
    if (state.data?.readOnly) {
      for (const id of ["btn-new", "btn-install", "bulk-delete", "bulk-disable", "bulk-copy", "bulk-move", "bulk-archive"]) $(`#${id}`).hidden = true;
      $('[data-panel="import"]').hidden = true;
    }
  });
})();
