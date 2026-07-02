// Service worker: periodic check, local diff history, and notifications.
// HackerOne GraphQL still runs inside hackerone.com via chrome.scripting.executeScript
// so the request remains same-origin and uses the browser's existing H1 session.
import { relLabel, safeReportUrl, substateLabel } from "./h1.js";

const ALARM = "h1-check";
const DEFAULT_PERIOD_MIN = 60;
const MIN_PERIOD_MIN = 15;
const MAX_PERIOD_MIN = 24 * 60;
const DEFAULT_HISTORY_LIMIT = 500;
const MAX_HISTORY_LIMIT = 2000;

const DATA_KEYS = [
  "lastSnapshot",
  "reports",
  "me",
  "lastCheck",
  "lastError",
  "initialized",
  "changeHistory",
  "unseenChangeCount"
];

chrome.runtime.onInstalled.addListener(() => {
  void boot({ runCheck: true });
});

chrome.runtime.onStartup.addListener(() => {
  void boot({ runCheck: true });
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM) void check({ source: "alarm" }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg)
    .then(result => sendResponse({ ok: true, ...result }))
    .catch(error => sendResponse({ ok: false, error: String(error.message || error) }));
  return true;
});

async function boot({ runCheck }) {
  const settings = await getSettings();
  await configureAlarm(settings);
  if (runCheck && !settings.paused) {
    void check({ source: "boot" }).catch(() => {});
  }
}

async function handleMessage(msg) {
  if (!msg || !msg.type) throw new Error("Unknown message.");

  if (msg.type === "checkNow") {
    return check({ source: "manual", force: true });
  }

  if (msg.type === "setSettings") {
    const settings = await saveSettings(msg.settings || {});
    return { settings };
  }

  if (msg.type === "clearHistory") {
    await chrome.storage.local.set({ changeHistory: [], unseenChangeCount: 0 });
    await setBadge(0);
    return { changeHistory: [] };
  }

  if (msg.type === "clearLocalData") {
    await chrome.storage.local.remove(DATA_KEYS);
    await chrome.storage.local.set({ initialized: false, changeHistory: [], unseenChangeCount: 0 });
    await setBadge(0);
    return {};
  }

  if (msg.type === "markSeen") {
    await chrome.storage.local.set({ unseenChangeCount: 0 });
    await setBadge(0);
    return {};
  }

  throw new Error("Unknown message type: " + msg.type);
}

async function getSettings() {
  const raw = await chrome.storage.local.get(["periodMin", "paused", "historyLimit"]);
  return {
    periodMin: clampInt(raw.periodMin, DEFAULT_PERIOD_MIN, MIN_PERIOD_MIN, MAX_PERIOD_MIN),
    paused: Boolean(raw.paused),
    historyLimit: clampInt(raw.historyLimit, DEFAULT_HISTORY_LIMIT, 50, MAX_HISTORY_LIMIT)
  };
}

async function saveSettings(patch) {
  const current = await getSettings();
  const next = {
    periodMin: "periodMin" in patch
      ? clampInt(patch.periodMin, current.periodMin, MIN_PERIOD_MIN, MAX_PERIOD_MIN)
      : current.periodMin,
    paused: "paused" in patch ? Boolean(patch.paused) : current.paused,
    historyLimit: "historyLimit" in patch
      ? clampInt(patch.historyLimit, current.historyLimit, 50, MAX_HISTORY_LIMIT)
      : current.historyLimit
  };

  await chrome.storage.local.set(next);
  await configureAlarm(next);
  return next;
}

async function configureAlarm(settings) {
  await chrome.alarms.clear(ALARM);
  if (!settings.paused) {
    chrome.alarms.create(ALARM, { periodInMinutes: settings.periodMin });
  }
}

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

// ---- This function is serialized and executed in the hackerone.com page. ----
// It must be fully self-contained and cannot reference outer-scope functions.
async function pageFetchReports() {
  const meta = document.querySelector('meta[name="csrf-token"]');
  if (!meta || !meta.content) {
    return { error: "Not logged in to HackerOne (no CSRF meta on page)." };
  }
  const csrf = meta.content;

  async function gql(query, variables) {
    const res = await fetch("/graphql", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ query, variables })
    });
    if (!res.ok) return { __http: res.status };
    const j = await res.json();
    if (j.errors && j.errors.length) return { __gql: j.errors.map(e => e.message).join("; ") };
    return j.data;
  }

  const me = await gql("query { me { _id username } }", {});
  if (me.__http) return { error: "HTTP " + me.__http + " on /graphql" };
  if (me.__gql) return { error: me.__gql };
  if (!me || !me.me) return { error: "Invalid session (me == null). Sign in to HackerOne." };

  const rid = parseInt(me.me._id, 10);
  if (!Number.isFinite(rid)) return { error: "Invalid HackerOne user id." };

  const fields = "_id title substate url submitted_at" +
    " latest_activity_at: latest_public_activity_at" +
    " report_pending_party_last_activity";

  const pagedQuery = "query Tracker($rid: Int!, $after: String) {" +
    " reports(first: 100, after: $after, where: { reporter: { id: { _eq: $rid } } }) {" +
    " pageInfo { hasNextPage endCursor }" +
    " edges { node { " + fields + " } } } }";

  const legacyQuery = "query Tracker($rid: Int!) {" +
    " reports(first: 100, where: { reporter: { id: { _eq: $rid } } }) {" +
    " edges { node { " + fields + " } } } }";

  async function fetchLegacy() {
    const data = await gql(legacyQuery, { rid });
    if (data.__http) return { error: "HTTP " + data.__http + " on /graphql" };
    if (data.__gql) return { error: data.__gql };
    if (!data || !data.reports || !Array.isArray(data.reports.edges)) {
      return { error: "Unexpected HackerOne reports response." };
    }
    return (data.reports.edges || []).map(e => e.node);
  }

  const reports = [];
  let after = null;
  let partial = false;
  for (let page = 0; page < 20; page++) {
    const data = await gql(pagedQuery, { rid, after });
    if (data.__http) return { error: "HTTP " + data.__http + " on /graphql" };
    if (data.__gql) {
      if (page === 0 && /after|pageInfo|endCursor|hasNextPage/i.test(data.__gql)) {
        const fallbackReports = await fetchLegacy();
        if (fallbackReports.error) return fallbackReports;
        fallbackReports.sort((a, b) => String(b.submitted_at || "").localeCompare(String(a.submitted_at || "")));
        return { me: me.me, reports: fallbackReports, partial: fallbackReports.length >= 100 };
      }
      return { error: data.__gql };
    }

    const connection = data && data.reports;
    if (!connection || !connection.edges) return { error: "Unexpected HackerOne reports response." };
    reports.push(...connection.edges.map(e => e.node));

    const pageInfo = connection.pageInfo || {};
    if (!pageInfo.hasNextPage || !pageInfo.endCursor) break;
    if (page === 19) {
      partial = true;
      break;
    }
    after = pageInfo.endCursor;
  }

  reports.sort((a, b) => String(b.submitted_at || "").localeCompare(String(a.submitted_at || "")));
  return { me: me.me, reports, partial };
}

function waitForComplete(tabId, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, arg) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      fn(arg);
    };
    const timer = setTimeout(() => finish(reject, new Error("tab load timeout")), timeoutMs);
    function listener(id, info) {
      if (id === tabId && info.status === "complete") finish(resolve);
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then(t => {
      if (t.status === "complete") finish(resolve);
    }).catch(() => {});
  });
}

async function runInH1Tab() {
  const tabs = await chrome.tabs.query({ url: "https://hackerone.com/*" });
  let tab = tabs.find(t => t.status === "complete") || tabs[0];
  let created = false;

  if (!tab) {
    tab = await chrome.tabs.create({ url: "https://hackerone.com/bugs", active: false });
    created = true;
  }

  try {
    if (tab.status !== "complete") await waitForComplete(tab.id);
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: pageFetchReports
    });
    const result = injection && injection.result;
    if (!result) throw new Error("No result from HackerOne page.");
    if (result.error) throw new Error(result.error);
    return {
      me: normalizeMe(result.me),
      reports: normalizeReports(result.reports || []),
      partial: Boolean(result.partial)
    };
  } finally {
    if (created) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function normalizeMe(me) {
  return {
    _id: cleanString(me && me._id, 40),
    username: cleanString(me && me.username, 80)
  };
}

function normalizeReports(reports) {
  return reports
    .map(r => {
      const id = cleanString(r && r._id, 40);
      if (!id) return null;
      return {
        _id: id,
        title: cleanString(r.title, 240),
        substate: cleanString(r.substate, 80),
        url: safeReportUrl(r.url, id),
        submitted_at: cleanString(r.submitted_at, 80),
        latest_activity_at: cleanString(r.latest_activity_at, 80),
        report_pending_party_last_activity: cleanString(r.report_pending_party_last_activity, 80)
      };
    })
    .filter(Boolean);
}

function cleanString(value, max) {
  if (value === null || value === undefined) return "";
  return String(value).slice(0, max);
}

function snapshotOf(reports) {
  const snap = {};
  for (const r of reports) {
    snap[r._id] = {
      title: r.title,
      url: safeReportUrl(r.url, r._id),
      substate: r.substate,
      pend: r.report_pending_party_last_activity || null,
      latest: r.latest_activity_at || null
    };
  }
  return snap;
}

function diff(prev, reports) {
  const changes = [];
  const seen = new Set();

  for (const r of reports) {
    seen.add(r._id);
    const before = prev[r._id];
    if (!before) {
      changes.push(changeFor(r, "new", "new report tracked: " + substateLabel(r.substate), null, r.substate));
      continue;
    }

    if ((before.substate || "") !== (r.substate || "")) {
      changes.push(changeFor(
        r,
        "substate",
        substateLabel(before.substate) + " -> " + substateLabel(r.substate),
        before.substate || null,
        r.substate || null
      ));
    }

    if ((before.pend || null) !== (r.report_pending_party_last_activity || null)) {
      changes.push(changeFor(
        r,
        "internal",
        "internal activity updated (" + relLabel(r.report_pending_party_last_activity) + ")",
        before.pend || null,
        r.report_pending_party_last_activity || null
      ));
    }

    if ((before.latest || null) !== (r.latest_activity_at || null)) {
      changes.push(changeFor(
        r,
        "activity",
        "public activity updated (" + relLabel(r.latest_activity_at) + ")",
        before.latest || null,
        r.latest_activity_at || null
      ));
    }
  }

  for (const [id, before] of Object.entries(prev || {})) {
    if (!seen.has(id)) {
      const prior = before || {};
      changes.push({
        id,
        title: prior.title || "Report #" + id,
        kind: "missing",
        detail: "report no longer returned by HackerOne",
        from: "present",
        to: null,
        url: safeReportUrl(prior.url, id)
      });
    }
  }

  return changes;
}

function changeFor(report, kind, detail, from, to) {
  return {
    id: report._id,
    title: report.title || "Report #" + report._id,
    kind,
    detail,
    from,
    to,
    url: safeReportUrl(report.url, report._id)
  };
}

export async function check(options = {}) {
  const settings = await getSettings();
  if (settings.paused && !options.force) {
    const stored = await chrome.storage.local.get(["reports", "me", "changeHistory"]);
    return {
      skipped: true,
      reason: "paused",
      settings,
      reports: stored.reports || [],
      changes: [],
      changeHistory: stored.changeHistory || [],
      me: stored.me || null
    };
  }

  try {
    const { me, reports, partial } = await runInH1Tab();
    const snap = snapshotOf(reports);
    const now = Date.now();

    const stored = await chrome.storage.local.get([
      "lastSnapshot",
      "initialized",
      "changeHistory",
      "unseenChangeCount"
    ]);

    const prev = stored.lastSnapshot || {};
    const changes = stored.initialized ? diff(prev, reports) : [];
    const historyEntries = makeHistoryEntries(changes, now);
    const existingHistory = Array.isArray(stored.changeHistory) ? stored.changeHistory : [];
    const changeHistory = historyEntries.concat(existingHistory).slice(0, settings.historyLimit);
    const unseenChangeCount = (Number(stored.unseenChangeCount) || 0) + changes.length;

    await chrome.storage.local.set({
      lastSnapshot: snap,
      reports,
      me,
      lastCheck: now,
      lastError: partial ? "Only the first 100 reports were returned by the fallback query." : null,
      initialized: true,
      changeHistory,
      unseenChangeCount
    });

    await setBadge(unseenChangeCount);
    if (changes.length) notify(changes);

    return { reports, changes, changeHistory, me, settings, partial };
  } catch (e) {
    await chrome.storage.local.set({ lastError: String(e.message || e), lastCheck: Date.now() });
    throw e;
  }
}

function makeHistoryEntries(changes, now) {
  return changes.map((change, index) => ({
    uid: [now, index, change.id, change.kind].join("-"),
    at: now,
    reportId: change.id,
    title: change.title,
    kind: change.kind,
    detail: change.detail,
    from: change.from,
    to: change.to,
    url: safeReportUrl(change.url, change.id)
  }));
}

async function setBadge(count) {
  await chrome.action.setBadgeBackgroundColor({ color: "#d9534f" });
  await chrome.action.setBadgeText({ text: count ? String(Math.min(count, 99)) : "" });
}

function notify(changes) {
  const title = changes.length === 1
    ? "1 change on your H1 reports"
    : changes.length + " changes on your H1 reports";
  const lines = changes.slice(0, 5).map(c => "#" + c.id + " - " + c.detail);
  if (changes.length > 5) lines.push("and " + (changes.length - 5) + " more");
  chrome.notifications.create("h1-" + Date.now(), {
    type: "basic",
    iconUrl: "icon128.png",
    title,
    message: lines.join("\n"),
    priority: 2
  });
}

chrome.notifications.onClicked.addListener(async () => {
  const { changeHistory, reports } = await chrome.storage.local.get(["changeHistory", "reports"]);
  const latest = Array.isArray(changeHistory) && changeHistory[0] ? changeHistory[0] : null;
  const fallback = Array.isArray(reports) && reports[0] ? reports[0] : null;
  const target = latest || fallback;
  chrome.tabs.create({ url: safeReportUrl(target && target.url, target && (target.reportId || target._id)) });
});
