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
      const card = document.createElement("button");
      card.type = "button";
      card.className = "card" + (changed ? " changed" : ppr ? " ppr" : "");
      card.addEventListener("click", () => openReport(r));
      card.innerHTML = `
        <div class="top">
          <span class="title">${escapeHtml(r.title || "(untitled)")}</span>
          <span class="id">#${escapeHtml(r._id)}</span>
        </div>
        <div class="sub">${escapeHtml(substateLabel(r.substate))}${changed ? ' <span class="badge-changed">CHANGED</span>' : ""}</div>
        <div class="meta-line">
          <span>activity: ${escapeHtml(relLabel(r.latest_activity_at))}</span>
          <span>internal: ${escapeHtml(relLabel(r.report_pending_party_last_activity))}</span>
        </div>`;
      listEl.appendChild(card);
    }
  }

  const shown = selected.size ? rows.length : currentReports.length;
  const pprCount = currentReports.filter(r => r.substate === "pending-program-review").length;
  metaEl.textContent = `${shown}/${currentReports.length} shown, ${pprCount} in PPR`;
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
