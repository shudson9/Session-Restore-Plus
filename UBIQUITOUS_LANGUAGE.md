# Ubiquitous Language

This document defines the shared vocabulary for Session-Restore-Plus.
Use these terms consistently in issues, PRDs, code discussions, and tests.

## Core Concepts

### Snapshot
A saved representation of one browser session at a point in time.

A snapshot may include:
- one or more browser windows
- tabs within each window
- tab ordering
- pinned state
- tab group information
- window position and size metadata when available

### Restore
The act of recreating a previously saved snapshot in the browser.

Restore may recreate:
- multiple windows
- tabs within those windows
- pinned tabs
- tab groups
- window bounds and placement where supported

### Snapshot Name
A user-provided label for identifying a snapshot.

### Auto-Restore
A configured behavior where the extension restores a chosen snapshot automatically on browser startup.

### Restore Summary
A user-visible result describing what was restored, skipped, or failed.

## Tab Handling

### Supported URL
A URL that Chrome extensions are allowed to recreate during restore.

### Unsupported URL
A URL that cannot be restored due to Chrome platform restrictions or extension limitations.

Examples may include browser-internal pages or protected pages.

### Skipped Tab
A tab present in a snapshot that is intentionally not restored, usually because its URL is unsupported.

### Pinned Tab
A tab that should be restored with its pinned state preserved.

### Tab Group
A Chrome tab group and its associated metadata, such as grouping membership, label, and color where available.

## Window Handling

### Window State
The browser window state, such as normal, minimized, maximized, or fullscreen where supported.

### Window Bounds
The size and screen position of a browser window.

### Restore Order
The sequence in which windows and tabs are recreated during restore.

## Preferred Terms

- Prefer **snapshot** over vague alternatives like “saved session” in technical discussion.
- Prefer **restore** over “load” or “resume” when referring to recreating a snapshot.
- Prefer **skipped tab** when a tab was intentionally not restored.
- Prefer **unsupported URL** when the extension is blocked from restoring a tab due to browser limitations.
- Prefer **restore summary** for user-visible feedback after a restore operation.

## Open Questions

- How exact should restored window placement be across multiple monitors?
- Which tab group properties can be restored reliably?
- How should partial restore failures be communicated to the user?