# H1 Report Tracker Safe

Chrome extension for tracking your own HackerOne reports. It records status changes,
public activity changes, and `report_pending_party_last_activity` changes in local
history, not only notifications.

## What It Does

- Checks your HackerOne reports on a schedule you control.
- Stores a local change history in `chrome.storage.local`.
- Shows current reports, filters by substate, and sorts by internal activity by default.
- Exports change history as JSON from the popup.
- Lets you pause automatic checks or clear all local extension data.

## Safety Model

The extension has no dependencies, build step, remote code, analytics, or third-party
network destinations. The only network request in the source is `fetch("/graphql")`
executed inside a `hackerone.com` tab, so the request goes to HackerOne on the same
origin as the real site.

The extension reads HackerOne's CSRF token from the page and uses your existing browser
session. It does not ask you to paste cookies or API keys. Report data is stored only in
Chrome local extension storage.

Review changes before pulling future updates. This extension has permission to run code
on `https://hackerone.com/*`, which is necessary for the HackerOne GraphQL request.

## Install

1. Open Chrome and go to `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this folder: `/home/ilyyeees/repos/h1-tracker`.
5. Open `https://hackerone.com` and sign in.
6. Click the extension icon and press `Refresh`.

There is no `npm install` and no build command.

## Use

- `Refresh` runs a manual check.
- `Pause automatic checks` stops scheduled checks. Manual refresh still works.
- `Check every` controls the alarm interval. Values are clamped between 15 and 1440 minutes.
- `Change history` keeps the newest 500 changes by default.
- `Export JSON` downloads the stored history.
- `Clear history` removes only history.
- `Clear all local data` removes stored reports, snapshots, errors, and history. Settings stay.

## Verify Before Updates

Before reloading the extension after an upstream update:

```sh
cd /home/ilyyeees/repos/h1-tracker
git fetch origin
git diff HEAD..origin/main
```

Look for new host permissions, remote URLs, install scripts, obfuscated code, cookie
access, or requests to non-HackerOne domains.
