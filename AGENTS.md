# Session Restore Plus — AGENTS.md

## Goal
Build a Chrome Extension (Manifest V3) that can:
- Save named snapshots of the user’s current Chrome state (multiple windows, tabs, and tab groups)
- Restore a snapshot in one click by opening new windows that match the saved layout

## Core behaviors
- Snapshot **all windows**, capturing:
  - window bounds: left, top, width, height, state
  - tabs in order: url, pinned, active
  - tab groups: title, color, collapsed, and which tabs belong to the group
- Restore:
  - open **new** windows (do not close existing windows)
  - recreate tabs in order, set pinned + active
  - recreate tab groups and apply metadata
  - skip unsupported URLs (e.g. chrome://) and surface a “skipped tabs” summary

## UX requirements
- Popup UI:
  - Save Snapshot (prompt for name; default timestamp)
  - List snapshots: Restore / Rename / Delete
  - Toggle: Restore last snapshot on startup
- Add context menu:
  - Save Snapshot
  - Restore Last Snapshot

## Tech choices
- TypeScript
- Manifest V3 service worker
- Use chrome.storage.sync for snapshots/settings
- Vite build output to dist/ (load dist/ as unpacked)

## Permissions
- tabs
- tabGroups
- storage
- contextMenus
- startup (only if implementing auto-restore)
- Keep host permissions minimal; only request what’s required for restoring URLs.

## Quality bar
- Propose a short plan before making changes
- Keep snapshot format versioned (schemaVersion: 1) and validate it before saving/restoring
- After changes: run npm run build and ensure dist is loadable as an unpacked extension
- Document install/dev/build steps + known limitations in README

## Engineering details
- Restore order: create windows → create tabs in order → set pinned/active → then recreate tab groups and apply title/color/collapsed.
- Treat unsupported URLs as: chrome://, chrome-extension://, edge://, about:, and file:// unless user has enabled file access.
- Show a “Last action” status area in the popup with restore summary (windows created, tabs restored, tabs skipped).
- Don’t run terminal commands unless I explicitly ask.
