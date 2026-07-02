import { relLabel, safeReportUrl, substateLabel, timeLabel } from "./h1.js";

const $ = sel => document.querySelector(sel);
const userEl = $("#user");
const statusEl = $("#status");
const listEl = $("#list");
const metaEl = $("#meta");
const refreshBtn = $("#refresh");
const filtersEl = $("#filters");
const sortEl = $("#sort");
const pausedEl = $("#paused");
const periodEl = $("#period");
const settingsStatusEl = $("#settingsStatus");
const historyEl = $("#history");
const historyCountEl = $("#historyCount");
const exportHistoryBtn = $("#exportHistory");
const clearHistoryBtn = $("#clearHistory");
const clearDataBtn = $("#clearData");
const statReportsEl = $("#statReports");
const statPprEl = $("#statPpr");
const statChangedEl = $("#statChanged");
const exportFormatEl = $("#exportFormat");
const exportAllBtn = $("#exportAll");
const selectToggleBtn = $("#selectToggle");
const selectAllBtn = $("#selectAll");
const exportSelectedBtn = $("#exportSelected");
const exportStatusEl = $("#exportStatus");

// HackerOne-aligned accent colors for the report accent bar.
const CHANGED_BAR = "#fb896a"; // coral, mirrors H1 severity/attention
const PPR_BAR = "#f28ccd";     // pink, mirrors H1 counts/active state
const SUBSTATE_COLOR = {
  "new": "#86a3f9",
  "pending-program-review": "#f28ccd",
  "triaged": "#67e4cb",
  "needs-more-info": "#b98be0",
  "resolved": "#57d9a3",
  "informative": "#5ec9e0",
  "not-applicable": "#9aa3bd",
  "duplicate": "#8089ab",
  "spam": "#fb896a"
};

function statusColor(s) {
  return SUBSTATE_COLOR[s] || "#67707f";
}

const FILTER_KEY = "filterSubstates";
const SORT_KEY = "sortBy";
const ORDER = [
  "new", "pending-program-review", "triaged", "needs-more-info",
  "resolved", "informative", "not-applicable", "duplicate", "spam"
];

let selected = new Set();
let sortBy = "internal_desc";
let currentReports = [];
let currentHistory = [];
let lastChangedIds = new Set();
let selectionMode = false;
let exportBusy = false;
const exportSelected = new Set();

function cmpStr(a, b) {
  return String(a || "").localeCompare(String(b || ""));
}

function sortRows(rows) {
  const r = rows.slice();
  switch (sortBy) {
    case "submitted_asc":
      r.sort((a, b) => cmpStr(a.submitted_at, b.submitted_at));
      break;
    case "activity_desc":
      r.sort((a, b) => cmpStr(b.latest_activity_at, a.latest_activity_at));
      break;
    case "internal_desc":
      r.sort((a, b) => cmpStr(b.report_pending_party_last_activity, a.report_pending_party_last_activity));
      break;
    case "status":
      r.sort((a, b) => (ORDER.indexOf(a.substate) - ORDER.indexOf(b.substate)) || cmpStr(b.submitted_at, a.submitted_at));
      break;
    case "id_desc":
      r.sort((a, b) => Number(b._id) - Number(a._id));
      break;
    case "submitted_desc":
    default:
      r.sort((a, b) => cmpStr(b.submitted_at, a.submitted_at));
      break;
  }
  return r;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function buildFilters(reports) {
  const counts = {};
  for (const r of reports) counts[r.substate] = (counts[r.substate] || 0) + 1;

  const present = Object.keys(counts);
  const ordered = ORDER.filter(s => present.includes(s))
    .concat(present.filter(s => !ORDER.includes(s)));

  filtersEl.innerHTML = "";
  for (const s of ordered) {
    const on = selected.has(s);
    const label = document.createElement("label");
    label.className = "chip" + (on ? " on" : "");
    label.innerHTML =
      `<input type="checkbox" ${on ? "checked" : ""} />` +
      `<span>${escapeHtml(substateLabel(s))}</span>` +
      `<span class="cnt">${counts[s]}</span>`;
    const input = label.querySelector("input");
    input.addEventListener("change", async () => {
      if (input.checked) selected.add(s); else selected.delete(s);
      label.classList.toggle("on", input.checked);
      await chrome.storage.local.set({ [FILTER_KEY]: [...selected] });
      renderList();
    });
    filtersEl.appendChild(label);
  }
}

function renderList() {
  let rows = currentReports;
  if (selected.size) rows = rows.filter(r => selected.has(r.substate));
  rows = sortRows(rows);

  listEl.innerHTML = "";
  if (!rows.length) {
    listEl.appendChild(el("div", "empty", currentReports.length ? "No reports match the filter." : "No reports loaded yet. Sign in to HackerOne and refresh."));
  } else {
    for (const r of rows) {
      const changed = lastChangedIds.has(String(r._id));
      const ppr = r.substate === "pending-program-review";
      const dotColor = statusColor(r.substate);
      const barColor = changed ? CHANGED_BAR : ppr ? PPR_BAR : dotColor;
      const pickedForExport = exportSelected.has(String(r._id));
      const card = document.createElement("button");
      card.type = "button";
      card.className = "card" + (changed ? " changed" : ppr ? " ppr" : "") +
        (selectionMode ? " selectable" : "") + (selectionMode && pickedForExport ? " selected" : "");
      card.style.setProperty("--bar", barColor);
      if (selectionMode) card.setAttribute("aria-pressed", pickedForExport ? "true" : "false");
      card.addEventListener("click", () => {
        if (selectionMode) toggleSelect(r);
        else openReport(r);
      });
      const check = selectionMode ? '<span class="check" aria-hidden="true"></span>' : "";
      card.innerHTML = `
        <div class="top">
          ${check}<span class="title">${escapeHtml(r.title || "(untitled)")}</span>
          <span class="id">#${escapeHtml(r._id)}</span>
        </div>
        <div class="sub">
          <span class="dot" style="background:${dotColor}"></span>
          <span>${escapeHtml(substateLabel(r.substate))}</span>
          ${changed ? '<span class="badge-changed">CHANGED</span>' : ""}
        </div>
        <div class="meta-line">
          <span>public: ${escapeHtml(relLabel(r.latest_activity_at))}</span>
          <span>internal: ${escapeHtml(relLabel(r.report_pending_party_last_activity))}</span>
        </div>`;
      listEl.appendChild(card);
    }
  }

  const shown = selected.size ? rows.length : currentReports.length;
  const pprCount = currentReports.filter(r => r.substate === "pending-program-review").length;
  metaEl.textContent = `${shown} of ${currentReports.length} shown`;
  statReportsEl.textContent = currentReports.length;
  statPprEl.textContent = pprCount;
  statChangedEl.textContent = lastChangedIds.size;
  updateExportControls();
}

function renderHistory(history) {
  currentHistory = Array.isArray(history) ? history : [];
  historyEl.innerHTML = "";
  historyCountEl.textContent = currentHistory.length + " stored";

  if (!currentHistory.length) {
    historyEl.appendChild(el("div", "empty", "No changes recorded yet. History starts after the first successful baseline check."));
    return;
  }

  for (const item of currentHistory.slice(0, 80)) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "history-item " + String(item.kind || "change");
    row.addEventListener("click", () => openReport({ _id: item.reportId, url: item.url }));

    const top = el("div", "history-top");
    top.appendChild(el("span", "history-title", item.title || ("Report #" + item.reportId)));
    top.appendChild(el("span", "history-time", timeLabel(item.at)));

    const detail = el("div", "history-detail", "#" + item.reportId + " - " + labelKind(item.kind) + ": " + (item.detail || "changed"));

    row.appendChild(top);
    row.appendChild(detail);
    historyEl.appendChild(row);
  }
}

function labelKind(kind) {
  const labels = {
    new: "New",
    substate: "Status",
    internal: "Internal",
    activity: "Public activity",
    missing: "Missing"
  };
  return labels[kind] || "Change";
}

function render(reports, changes, history) {
  currentReports = reports || [];
  lastChangedIds = new Set((changes || []).map(c => String(c.id || c.reportId)));
  buildFilters(currentReports);
  renderList();
  if (history) renderHistory(history);
}

function openReport(report) {
  chrome.tabs.create({ url: safeReportUrl(report && report.url, report && (report._id || report.reportId)) });
}

function applySettings(data) {
  pausedEl.checked = Boolean(data.paused);
  periodEl.value = data.periodMin || 60;
}

async function load(triggerCheck) {
  const data = await chrome.storage.local.get([
    "reports",
    "me",
    "lastCheck",
    "lastError",
    "changeHistory",
    "periodMin",
    "paused",
    FILTER_KEY,
    SORT_KEY
  ]);

  selected = new Set(data[FILTER_KEY] || []);
  sortBy = data[SORT_KEY] || "internal_desc";
  sortEl.value = sortBy;
  applySettings(data);

  if (data.me) userEl.textContent = "@" + data.me.username;
  render(data.reports || [], [], data.changeHistory || []);

  if (data.lastError) {
    statusEl.textContent = "Error: " + data.lastError;
    statusEl.className = "status error";
  } else {
    statusEl.textContent = "Last check: " + timeLabel(data.lastCheck);
    statusEl.className = "status";
  }

  if (triggerCheck) {
    await doCheck();
  } else {
    await markSeen();
  }
}

async function doCheck() {
  refreshBtn.classList.add("spin");
  refreshBtn.disabled = true;
  statusEl.className = "status";
  statusEl.textContent = "Checking...";

  try {
    const resp = await chrome.runtime.sendMessage({ type: "checkNow" });
    if (!resp || !resp.ok) throw new Error(resp ? resp.error : "no response");
    if (resp.me) userEl.textContent = "@" + resp.me.username;
    if (resp.settings) applySettings(resp.settings);
    render(resp.reports || [], resp.changes || [], resp.changeHistory || currentHistory);
    const n = (resp.changes || []).length;
    statusEl.textContent = n ? `${n} change(s) recorded.` : "No changes.";
    if (resp.partial) statusEl.textContent += " Fallback query only returned the first 100 reports.";
    await markSeen();
  } catch (e) {
    statusEl.className = "status error";
    statusEl.textContent = "Error: " + (e.message || e);
  } finally {
    refreshBtn.classList.remove("spin");
    refreshBtn.disabled = false;
  }
}

async function markSeen() {
  await chrome.runtime.sendMessage({ type: "markSeen" }).catch(() => {});
}

async function saveSettings(patch) {
  settingsStatusEl.textContent = "Saving...";
  const resp = await chrome.runtime.sendMessage({ type: "setSettings", settings: patch });
  if (!resp || !resp.ok) throw new Error(resp ? resp.error : "settings save failed");
  applySettings(resp.settings || {});
  settingsStatusEl.textContent = resp.settings && resp.settings.paused ? "Auto checks paused" : "Saved";
  setTimeout(() => {
    if (settingsStatusEl.textContent === "Saved") settingsStatusEl.textContent = "";
  }, 1500);
}

function exportHistory() {
  if (!currentHistory.length) {
    statusEl.textContent = "No history to export.";
    return;
  }

  const blob = new Blob([JSON.stringify(currentHistory, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "h1-tracker-history-" + new Date().toISOString().slice(0, 10) + ".json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- full report export ---------- */

function visibleReportIds() {
  let rows = currentReports;
  if (selected.size) rows = rows.filter(r => selected.has(r.substate));
  return rows.map(r => String(r._id));
}

function toggleSelect(report) {
  const id = String(report._id);
  if (exportSelected.has(id)) exportSelected.delete(id);
  else exportSelected.add(id);
  renderList();
}

function updateExportControls() {
  if (!exportSelectedBtn) return;
  selectToggleBtn.textContent = selectionMode ? "Done" : "Select reports";
  selectToggleBtn.classList.toggle("on", selectionMode);
  selectAllBtn.hidden = !selectionMode;
  exportSelectedBtn.hidden = !selectionMode;

  const count = exportSelected.size;
  exportSelectedBtn.disabled = count === 0 || exportBusy;
  exportSelectedBtn.textContent = count ? `Download selected (${count})` : "Download selected";

  const ids = visibleReportIds();
  const allPicked = ids.length > 0 && ids.every(id => exportSelected.has(id));
  selectAllBtn.textContent = allPicked ? "Clear all" : "Select all";
}

function setExportBusy(busy) {
  exportBusy = busy;
  exportAllBtn.disabled = busy;
  selectToggleBtn.disabled = busy;
  exportFormatEl.disabled = busy;
  selectAllBtn.disabled = busy;
  updateExportControls();
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function actorName(actor) {
  if (!actor) return "system";
  if (actor.username) return "@" + actor.username;
  if (actor.name) return actor.name;
  if (actor.handle) return actor.handle;
  return "system";
}

function humanizeActivity(typename) {
  const raw = String(typename || "").replace(/^Activities::/, "");
  const spaced = raw.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").trim();
  return spaced || "Activity";
}

function collectBounties(node) {
  let total = 0;
  let count = 0;
  const edges = node && node.bounties && node.bounties.edges;
  if (Array.isArray(edges)) {
    for (const e of edges) {
      const b = e && e.node;
      if (!b) continue;
      count++;
      total += parseFloat(b.awarded_amount || 0) || 0;
      total += parseFloat(b.awarded_bonus_amount || 0) || 0;
    }
  }
  return { total, count };
}

function formatMoney(n) {
  return (Math.round(n * 100) / 100).toLocaleString("en-US");
}

function reportDetailToMarkdown(d) {
  if (!d) return "";
  if (d.error && !d.node) {
    return "# Report #" + escapeMdId(d.id) + "\n\n> Could not fetch: " + d.error + "\n";
  }

  const n = d.node || {};
  const id = n._id || d.id;
  const lines = [];
  lines.push("# #" + id + " — " + (n.title || "(untitled)"));
  lines.push("");
  lines.push("- **Status:** " + substateLabel(n.substate) + (n.state ? " (" + n.state + ")" : ""));
  if (n.url) lines.push("- **URL:** " + n.url);
  if (n.reporter) lines.push("- **Reporter:** " + actorName(n.reporter));
  if (n.team) {
    const program = n.team.name || n.team.handle || "—";
    lines.push("- **Program:** " + program + (n.team.handle ? " (" + n.team.handle + ")" : ""));
  }
  if (n.severity && (n.severity.rating || n.severity.score != null)) {
    lines.push("- **Severity:** " + (n.severity.rating || "—") +
      (n.severity.score != null ? " (" + n.severity.score + ")" : ""));
  }
  if (n.weakness && n.weakness.name) {
    lines.push("- **Weakness:** " + n.weakness.name +
      (n.weakness.external_id ? " (" + n.weakness.external_id + ")" : ""));
  }
  if (n.structured_scope && n.structured_scope.asset_identifier) {
    lines.push("- **Asset:** " + n.structured_scope.asset_identifier +
      (n.structured_scope.asset_type ? " (" + n.structured_scope.asset_type + ")" : ""));
  }
  lines.push("- **Submitted:** " + fmtDate(n.submitted_at || n.created_at));
  if (n.triaged_at) lines.push("- **Triaged:** " + fmtDate(n.triaged_at));
  if (n.closed_at) lines.push("- **Closed:** " + fmtDate(n.closed_at));
  lines.push("- **Disclosed:** " + (n.disclosed_at ? fmtDate(n.disclosed_at) : "not disclosed"));
  if (n.latest_public_activity_at) {
    lines.push("- **Last public activity:** " + fmtDate(n.latest_public_activity_at));
  }

  const bounties = collectBounties(n);
  if (bounties.count > 0 || bounties.total > 0) {
    lines.push("- **Bounties:** $" + formatMoney(bounties.total) +
      " across " + bounties.count + " award(s)");
  }
  lines.push("");

  lines.push("## Report");
  lines.push("");
  lines.push(n.vulnerability_information ? String(n.vulnerability_information) : "_(no report body returned)_");
  lines.push("");

  const acts = (d.activities || []).slice().sort((a, b) => cmpStr(a.created_at, b.created_at));
  lines.push("## Timeline (" + acts.length + (acts.length === 1 ? " activity)" : " activities)"));
  if (d.activitiesError) lines.push("\n> Activity timeline unavailable: " + d.activitiesError);
  lines.push("");
  for (const a of acts) {
    const kind = humanizeActivity(a.__typename);
    const flag = a.internal ? " · internal" : "";
    lines.push("### " + fmtDate(a.created_at) + " — " + actorName(a.actor) + " · " + kind + flag);
    if (a.message && String(a.message).trim()) {
      lines.push("");
      lines.push(String(a.message));
    }
    lines.push("");
  }

  return lines.join("\n").trim() + "\n";
}

function escapeMdId(id) {
  return String(id == null ? "" : id);
}

function buildMarkdown(details, me) {
  const header = [
    "# HackerOne reports export",
    "",
    "- **Exported:** " + fmtDate(new Date().toISOString()),
    me && me.username ? "- **Account:** @" + me.username : null,
    "- **Reports:** " + details.length,
    "",
    "---",
    ""
  ].filter(v => v !== null);
  const body = details.map(reportDetailToMarkdown).join("\n---\n\n");
  return header.join("\n") + "\n" + body;
}

function buildJson(details, me) {
  const payload = {
    exportedAt: new Date().toISOString(),
    account: me && me.username ? me.username : null,
    reportCount: details.length,
    reports: details.map(d => ({
      id: d.id,
      error: d.error || null,
      activitiesError: d.activitiesError || null,
      report: d.node || null,
      activities: d.activities || []
    }))
  };
  return JSON.stringify(payload, null, 2);
}

function downloadBlob(text, mime, filename) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function runExport(ids) {
  if (exportBusy) return;
  const format = exportFormatEl.value === "json" ? "json" : "markdown";
  const scopeAll = !ids;
  const count = scopeAll ? currentReports.length : ids.length;

  if (!count) {
    exportStatusEl.className = "export-status error";
    exportStatusEl.textContent = scopeAll ? "No reports loaded yet." : "No reports selected.";
    return;
  }

  setExportBusy(true);
  exportStatusEl.className = "export-status";
  exportStatusEl.textContent = `Fetching full details for ${count} report(s)… this can take a while.`;

  try {
    const resp = await chrome.runtime.sendMessage({ type: "exportReports", ids: ids || [] });
    if (!resp || !resp.ok) throw new Error(resp ? resp.error : "no response");

    const details = resp.details || [];
    if (!details.length) {
      exportStatusEl.textContent = "Nothing was returned to export.";
      return;
    }

    const stamp = new Date().toISOString().slice(0, 10);
    if (format === "json") {
      downloadBlob(buildJson(details, resp.me), "application/json", `h1-reports-${stamp}.json`);
    } else {
      downloadBlob(buildMarkdown(details, resp.me), "text/markdown;charset=utf-8", `h1-reports-${stamp}.md`);
    }

    const failed = details.filter(d => d.error && !d.node).length;
    const ok = details.length - failed;
    exportStatusEl.textContent = `Downloaded ${ok} report(s)` +
      (failed ? `, ${failed} could not be fetched.` : ".");
  } catch (e) {
    exportStatusEl.className = "export-status error";
    exportStatusEl.textContent = "Export failed: " + (e.message || e);
  } finally {
    setExportBusy(false);
  }
}

refreshBtn.addEventListener("click", doCheck);

sortEl.addEventListener("change", async () => {
  sortBy = sortEl.value;
  await chrome.storage.local.set({ [SORT_KEY]: sortBy });
  renderList();
});

pausedEl.addEventListener("change", async () => {
  try {
    await saveSettings({ paused: pausedEl.checked });
  } catch (e) {
    statusEl.className = "status error";
    statusEl.textContent = "Error: " + (e.message || e);
  }
});

periodEl.addEventListener("change", async () => {
  try {
    await saveSettings({ periodMin: periodEl.value });
  } catch (e) {
    statusEl.className = "status error";
    statusEl.textContent = "Error: " + (e.message || e);
  }
});

exportHistoryBtn.addEventListener("click", exportHistory);

exportAllBtn.addEventListener("click", () => runExport(null));

selectToggleBtn.addEventListener("click", () => {
  selectionMode = !selectionMode;
  if (!selectionMode) exportSelected.clear();
  renderList();
});

selectAllBtn.addEventListener("click", () => {
  const ids = visibleReportIds();
  const allPicked = ids.length > 0 && ids.every(id => exportSelected.has(id));
  if (allPicked) ids.forEach(id => exportSelected.delete(id));
  else ids.forEach(id => exportSelected.add(id));
  renderList();
});

exportSelectedBtn.addEventListener("click", () => {
  if (!exportSelected.size) return;
  runExport([...exportSelected]);
});

clearHistoryBtn.addEventListener("click", async () => {
  const resp = await chrome.runtime.sendMessage({ type: "clearHistory" });
  if (!resp || !resp.ok) {
    statusEl.className = "status error";
    statusEl.textContent = "Error: " + (resp ? resp.error : "clear failed");
    return;
  }
  renderHistory([]);
  statusEl.className = "status";
  statusEl.textContent = "History cleared.";
});

clearDataBtn.addEventListener("click", async () => {
  if (!confirm("Clear stored reports, snapshots, errors, and history from this browser? Settings are kept.")) return;
  const resp = await chrome.runtime.sendMessage({ type: "clearLocalData" });
  if (!resp || !resp.ok) {
    statusEl.className = "status error";
    statusEl.textContent = "Error: " + (resp ? resp.error : "clear failed");
    return;
  }
  currentReports = [];
  currentHistory = [];
  render([], [], []);
  userEl.textContent = "...";
  statusEl.className = "status";
  statusEl.textContent = "Local data cleared.";
});

(async () => {
  const store = await chrome.storage.local.get(["lastCheck"]);
  const stale = !store.lastCheck || (Date.now() - store.lastCheck > 5 * 60 * 1000);
  await load(stale);
})();
