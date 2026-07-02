// Shared display and safety helpers used by the popup and background worker.

export function daysAgo(iso) {
  if (!iso) return null;
  const then = new Date(iso);
  if (isNaN(then.getTime())) return null;
  const now = new Date();
  const a = Date.UTC(then.getFullYear(), then.getMonth(), then.getDate());
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((b - a) / 86400000);
}

export function relLabel(iso) {
  const d = daysAgo(iso);
  if (d === null) return "-";
  if (d <= 0) return "today";
  if (d === 1) return "yesterday (1d)";
  return d + " days ago";
}

export function timeLabel(ts) {
  if (!ts) return "never";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "invalid date";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function substateLabel(s) {
  const map = {
    "new": "New",
    "pending-program-review": "Pending program review",
    "triaged": "Triaged",
    "needs-more-info": "Needs more info",
    "resolved": "Resolved",
    "informative": "Informative",
    "not-applicable": "Not applicable",
    "duplicate": "Duplicate",
    "spam": "Spam"
  };
  return map[s] || String(s || "Unknown");
}

export function safeReportUrl(rawUrl, id) {
  const fallback = id
    ? "https://hackerone.com/reports/" + encodeURIComponent(String(id))
    : "https://hackerone.com/bugs";

  try {
    const url = new URL(rawUrl || fallback, "https://hackerone.com");
    if (url.protocol !== "https:" || url.hostname !== "hackerone.com") return fallback;
    if (url.pathname === "/bugs" || url.pathname.startsWith("/reports/")) return url.href;
    return fallback;
  } catch (_e) {
    return fallback;
  }
}
