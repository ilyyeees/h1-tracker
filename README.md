# H1 Report Tracker (Chrome extension)

Tracks the status of your HackerOne reports and notifies you **only when something changes**
(`substate` change, new internal activity, or new public activity).

Uses your **already logged-in HackerOne session** in the browser — no cookies to paste.

## Installation

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the cloned `h1-tracker` folder
5. Make sure you are **signed in to hackerone.com** in a tab.

The "H1" icon appears in the toolbar. Click it to see your reports.

## How it works

- Automatic background check **every 60 min** (via `alarms`).
- The **red badge** on the icon = number of changes since you last opened the popup.
- **System notification** when a report changes; click = opens HackerOne.
- In the popup: **↻** button to force a check, **PPR only** checkbox to show
  only `pending-program-review` reports. Each card shows:
  - *activity* = last public activity (`latest_activity_at`)
  - *internal* = `report_pending_party_last_activity` (the UI's "Last internal activity")
- Click a card = opens the report.

## Technical notes

- HackerOne returns **403** for `/graphql` requests coming from the extension origin, so the
  fetch runs **inside a hackerone.com tab** via `chrome.scripting.executeScript` — same origin as
  the real SPA. The CSRF token is read from `<meta name="csrf-token">` on that page.
- If a hackerone.com tab is open, it is reused silently. If none is open, a hidden background tab
  is opened, queried, then closed.
- If you see "Not logged in": open hackerone.com, sign in, then ↻.
- Scope: **only your own reports** (filter `reporter.id = me._id`).

## Change the frequency

In the service worker console (`chrome://extensions` → the extension → *service worker*):

```js
chrome.storage.local.set({ periodMin: 30 });
chrome.alarms.create("h1-check", { periodInMinutes: 30 });
```
