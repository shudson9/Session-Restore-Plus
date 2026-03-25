# Session Restore Plus — AGENTS.md

## Product goal
A Chrome Extension (Manifest V3) that lets the user take named “snapshots” of their current Chrome workspace
(multiple windows and tabs) and restore them later in one click.

Primary success criteria:
- Restores ALL windows and tabs reliably (grouped + ungrouped tabs)
- Does NOT create “Unnamed tab groups” / white group chips
- Does NOT depend on Chrome History UI being present

## Critical clarification: Saved Tab Groups
The user uses Chrome “Saved Tab Groups” (pinned chips like Left / DevOps / HomeLab).
Chrome’s extension APIs do not currently provide full, reliable control over saved/pinned tab groups (especially closed/pinned groups).
Therefore:

### Non-goal for v0.1.x
Do NOT attempt to recreate or simulate Saved Tab Groups by creating new temporary tab groups.
If doing so would create unnamed groups or incorrect chips, prefer restoring tabs without grouping.

## Restore modes
### Mode A — Safe Rebuild (default)
This mode must be rock-solid and must never create unnamed groups.

Snapshot captures:
- All windows:
  - bounds: left, top, width, height, state
- Tabs in order:
  - url
  - pinned
  - active index

Restore does:
- Open NEW windows (do not close existing windows)
- Create tabs in order and set pinned + active
- Skip unsupported URLs (chrome://, chrome-extension://, edge://, about:, file:// unless allowed) and show a skipped summary
- IMPORTANT: Do NOT call chrome.tabs.group() or chrome.tabGroups.update() in Mode A

Outcome:
- Tabs always restore.
- Tab groups may not appear exactly like native “History → Restore window”, but there must be no UI corruption.

### Mode B — Native Session Restore (experimental, opt-in later)
Goal: match Chrome’s “History → Restore window” fidelity.
Use chrome.sessions.restore(sessionId) only when session IDs can be obtained safely and reliably WITHOUT cloning temp windows.
If not possible, do not run.

## UX requirements
Popup UI:
- Save Snapshot (prompt for name; default timestamp)
- List snapshots: Restore / Rename / Delete
- Toggle: Restore last snapshot on startup
- Status panel: “Last action” with success/error + counts + skipped URLs

Context menu:
- Save Snapshot
- Restore Last Snapshot

## Storage
- Use chrome.storage.local for large payloads
- Index/metadata can be in sync if small, but local is acceptable
- Keep schema versioned (schemaVersion: 1) and validate before saving/restoring

## Permissions
- tabs
- storage
- contextMenus
- startup (only if implementing auto-restore)
- Avoid tabGroups permission unless strictly needed for read-only display.
- Keep host permissions minimal.

## Quality bar
- Propose a short plan before making changes
- Do not run terminal commands unless the user explicitly asks
- After changes: npm run build and ensure dist/ is loadable as an unpacked extension
- Update README with install/dev/build steps + limitations
