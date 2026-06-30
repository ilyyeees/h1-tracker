import { relLabel, substateLabel } from "./h1.js";

const $ = sel => document.querySelector(sel);
const userEl = $("#user");
const statusEl = $("#status");
const listEl = $("#list");
const metaEl = $("#meta");
const refreshBtn = $("#refresh");
const filtersEl = $("#filters");
const sortEl = $("#sort");

const FILTER_KEY = "filterSubstates";
const SORT_KEY = "sortBy";
const ORDER = [
  "new", "pending-program-review", "triaged", "needs-more-info",
  "resolved", "informative", "not-applicable", "duplicate", "spam"
];

// Selected substates. Empty set = show all.
let selected = new Set();
let sortBy = "submitted_desc";
let currentReports = [];
let lastChangedIds = new Set();

function cmpStr(a, b) { return String(a || "").localeCompare(String(b || "")); }

function sortRows(rows) {
  const r = rows.slice();
  switch (sortBy) {
    case "submitted_asc": r.sort((a, b) => cmpStr(a.submitted_at, b.submitted_at)); break;
    case "activity_desc": r.sort((a, b) => cmpStr(b.latest_activity_at, a.latest_activity_at)); break;
    case "internal_desc": r.sort((a, b) => cmpStr(b.report_pending_party_last_activity, a.report_pending_party_last_activity)); break;
    case "status": r.sort((a, b) => (ORDER.indexOf(a.substate) - ORDER.indexOf(b.substate)) || cmpStr(b.submitted_at, a.submitted_at)); break;
    case "id_desc": r.sort((a, b) => Number(b._id) - Number(a._id)); break;
    case "submitted_desc":
    default: r.sort((a, b) => cmpStr(b.submitted_at, a.submitted_at)); break;
  }
  return r;
}

function fmtTime(ts) {
  if (!ts) return "never";
  const d = new Date(ts);
  return d.toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// Build the filter chips from the substates present in the data.
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
    listEl.innerHTML = '<div class="empty">No reports match the filter.</div>';
  } else {
    for (const r of rows) {
      const changed = lastChangedIds.has(String(r._id));
      const ppr = r.substate === "pending-program-review";
      const card = document.createElement("div");
      card.className = "card" + (changed ? " changed" : ppr ? " ppr" : "");
      card.addEventListener("click", () => {
        chrome.tabs.create({ url: r.url || ("https://hackerone.com/reports/" + r._id) });
      });
      card.innerHTML = `
        <div class="top">
          <span class="title">${escapeHtml(r.title || "(untitled)")}</span>
          <span class="id">#${r._id}</span>
        </div>
        <div class="sub">${escapeHtml(substateLabel(r.substate))}${changed ? ' <span class="badge-changed">● CHANGED</span>' : ""}</div>
        <div class="meta-line">
          <span>activity: ${relLabel(r.latest_activity_at)}</span>
          <span>internal: ${relLabel(r.report_pending_party_last_activity)}</span>
        </div>`;
      listEl.appendChild(card);
    }
  }

  const shown = selected.size ? rows.length : currentReports.length;
  const pprCount = currentReports.filter(r => r.substate === "pending-program-review").length;
  metaEl.textContent = `${shown}/${currentReports.length} shown · ${pprCount} in PPR`;
}

function render(reports, changes) {
  currentReports = reports || [];
  lastChangedIds = new Set((changes || []).map(c => String(c.id)));
  buildFilters(currentReports);
  renderList();
}

async function load(triggerCheck) {
  const data = await chrome.storage.local.get(["reports", "me", "lastCheck", "lastError"]);
  if (data.me) userEl.textContent = "@" + data.me.username;
  if (data.reports) render(data.reports, []);
  if (data.lastError) {
    statusEl.textContent = "⚠ " + data.lastError;
    statusEl.className = "status error";
  } else {
    statusEl.textContent = "Last check: " + fmtTime(data.lastCheck);
    statusEl.className = "status";
  }
  if (triggerCheck) await doCheck();
}

async function doCheck() {
  refreshBtn.classList.add("spin");
  statusEl.className = "status";
  statusEl.textContent = "Checking…";
  try {
    const resp = await chrome.runtime.sendMessage({ type: "checkNow" });
    if (!resp || !resp.ok) throw new Error(resp ? resp.error : "no response");
    if (resp.me) userEl.textContent = "@" + resp.me.username;
    render(resp.reports, resp.changes);
    const n = (resp.changes || []).length;
    statusEl.textContent = n ? `${n} change(s)!` : "No changes.";
    chrome.action.setBadgeText({ text: "" }); // seen
  } catch (e) {
    statusEl.className = "status error";
    statusEl.textContent = "⚠ " + (e.message || e);
  } finally {
    refreshBtn.classList.remove("spin");
  }
}

refreshBtn.addEventListener("click", doCheck);
sortEl.addEventListener("change", async () => {
  sortBy = sortEl.value;
  await chrome.storage.local.set({ [SORT_KEY]: sortBy });
  renderList();
});

// Init: load persisted filter + sort, then data, then maybe refresh if stale.
(async () => {
  const store = await chrome.storage.local.get([FILTER_KEY, SORT_KEY, "lastCheck"]);
  selected = new Set(store[FILTER_KEY] || []);
  sortBy = store[SORT_KEY] || "submitted_desc";
  sortEl.value = sortBy;
  const stale = !store.lastCheck || (Date.now() - store.lastCheck > 5 * 60 * 1000);
  await load(stale);
})();
