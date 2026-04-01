# PRD: Tab Group Restore Fidelity & Replace-Mode Restore

## Problem Statement

When a user restores a snapshot, the extension opens new windows alongside all existing windows. Because the restored tabs contain URLs belonging to Chrome Saved Tab Groups, Chrome automatically creates open instances of those saved groups in each new restore window. Each instance appears as an additional chip in the bookmarks bar. After repeated restores, the bookmarks bar accumulates extra chips. The groups appear as unnamed white chips until clicked to expand, at which point they fill in the correct name but not the correct color. The user's desired experience — equivalent to Chrome's "History > Restore tab group" flow — creates only a single chip per saved group and restores all groups in a collapsed state.

Additionally, the group capture code does not call the `chrome.tabGroups` API at save time, so title, color, and collapsed state are all hardcoded to empty/grey/false defaults and are never actually persisted in the snapshot.

## Solution

Change the restore flow to:
1. Close all existing Chrome windows (best-effort) before opening the snapshot windows, so each saved group has exactly one open instance after restore.
2. Add the `tabGroups` permission to the manifest and call `chrome.tabGroups.get()` during snapshot capture to record real title, color, collapsed state, and `savedGroupId` for each group.
3. After tabs are created in each restored window, call `chrome.tabGroups.update()` on every auto-created tab group to set correct title, color, and force collapsed state.

## User Stories

1. As a user, I want restoring a snapshot to close my existing windows first, so that I end up with only the snapshot's windows open — not a mix of old and new.
2. As a user, I want the restore to proceed even if some windows cannot be closed (e.g., an unsubmitted form), so that I'm not blocked by a single window.
3. As a user, I want tab groups in restored windows to appear with their correct name and color immediately, so that I can identify them without having to click to expand.
4. As a user, I want all tab groups to be collapsed after restore, so that the window looks clean and matches the way I manually restore from History.
5. As a user, I want only one bookmarks bar chip per saved group after a restore, so that my bookmarks bar does not accumulate duplicate chips across multiple restore sessions.
6. As a user, I want snapshot capture to record the real title, color, and collapsed state of each tab group at save time, so that the snapshot faithfully represents the workspace as it was.
7. As a user, I want snapshot capture to record the `savedGroupId` for each tab group, so that restore can correlate auto-created groups with the correct saved group metadata.
8. As a user, I want tabs that were not in any group to remain ungrouped after restore, so that ungrouped tabs are not accidentally placed into a group.
9. As a user, I want tabs whose saved group no longer exists to be restored ungrouped without an error, so that a deleted saved group does not break the entire restore.
10. As a user, I want the restore summary in the popup to continue reporting windows created, tabs restored, and tabs skipped, so that I can verify the restore completed correctly.
11. As a user, I want the window closing step to happen before any new windows are created, so that I never temporarily have both old and new windows open at the same time.
12. As a user, I want the extension to not create unnamed white group chips in any scenario, so that my bookmarks bar and tab strip are never visually corrupted.

## Implementation Decisions

### Modules Modified

**manifest.json (permissions)**
- Add `tabGroups` to the permissions array. This unlocks `chrome.tabGroups.get()`, `chrome.tabGroups.query()`, and `chrome.tabGroups.update()`.

**SnapshotGroup schema (snapshot.ts)**
- Add an optional `savedGroupId?: string` field to `SnapshotGroup` to store the Chrome Saved Tab Group GUID.
- Update the `isSnapshotGroup()` validator to accept (but not require) this field, preserving backwards compatibility with snapshots saved before this change.
- Schema version does not need to bump because the field is optional and additive.

**captureWindowGroups (background.ts)**
- Make the function async.
- After collecting group IDs from tabs, call `chrome.tabGroups.query({ windowId })` once to fetch all open groups in the window.
- Build a lookup map from `groupId` → `TabGroup` object.
- Use real `title`, `color`, `collapsed`, and `savedGroupId` values from the lookup map when constructing each `SnapshotGroup`.
- Fall back to empty/grey/false/undefined defaults if a group ID is not found in the query result (defensive coding for edge cases only).

**restoreSnapshotInternal (background.ts)**
- Add a new step at the start of restore: close all currently open Chrome windows using `chrome.windows.getAll()` followed by `chrome.windows.remove()` for each, wrapped in individual try/catch blocks so a single failed close does not abort the restore.
- This step runs before any new windows are created.
- After each restored window's tabs are created and `applyPinnedAndActive` completes, call a new `applyGroupsToWindow` function.

**applyGroupsToWindow (background.ts) — new function**
- Accepts the snapshot window's group list, the created tab ID map, and the Chrome window ID.
- Calls `chrome.tabGroups.query({ windowId })` to find any tab groups Chrome auto-created in the new window.
- For each auto-created group, determine which `SnapshotGroup` it corresponds to by comparing the tab membership (tabs in the group vs. `tabIndexes` in the snapshot).
- If a matching snapshot group is found, call `chrome.tabGroups.update(groupId, { title, color, collapsed: true })` — always force `collapsed: true` regardless of the snapshot's stored collapsed value.
- If a tab group exists in the window but no matching snapshot group is found, leave it unchanged (Chrome may have its own reason for creating it).
- If a snapshot group has no corresponding auto-created group (Chrome did not auto-group those tabs), do nothing — restore the tabs ungrouped.

### Key Architectural Decisions

- **Replace mode is unconditional**: There is no toggle. Every restore closes existing windows first. This matches the user's mental model ("restore" means "replace my current session").
- **Collapsed state is always true on restore**: The snapshot stores the real collapsed value for future use, but restore always collapses all groups. This matches the manual "History > Restore tab group" behavior.
- **No explicit group creation**: The extension does NOT call `chrome.tabs.group()` to form groups. It relies on Chrome auto-creating groups from Saved Tab Group URL matching, then corrects their appearance. This avoids creating unnamed groups if Chrome does not auto-group certain tabs.
- **savedGroupId is captured but not used during restore matching**: Matching during restore is done by tab membership (which tabs are in the group), not by savedGroupId. The savedGroupId is captured for potential future use (e.g., Mode B native restore).
- **Backwards compatibility**: Snapshots without `savedGroupId` or with empty title/grey color continue to restore correctly — `applyGroupsToWindow` will query live groups and update them even if the snapshot metadata is stale.

## Testing Decisions

**What makes a good test:** Tests should exercise the observable behavior of each module through its public interface — inputs in, outputs/side-effects out. Tests should not assert on internal implementation details (e.g., which helper function was called). Mock Chrome extension APIs at the boundary.

**Modules to test:**

- **captureWindowGroups**: Given a set of mock tabs with group IDs and a mock `chrome.tabGroups.query` response returning real titles/colors/collapsed/savedGroupId values, assert that the returned `SnapshotGroup[]` array contains the correct metadata. Also assert graceful fallback when a group ID is missing from the query result.

- **applyGroupsToWindow**: Given a mock `chrome.tabGroups.query` response (auto-created groups with known tab members), a snapshot group list, and a tab ID map, assert that `chrome.tabGroups.update` is called with the correct title, color, and `collapsed: true` for each matching group. Assert it is NOT called for groups with no snapshot match. Assert it handles the case where Chrome created no groups at all (no calls to update).

- **restoreSnapshotInternal (window-closing step)**: Given a mock `chrome.windows.getAll` returning two open windows, assert that `chrome.windows.remove` is called for each before any `chrome.windows.create` call. Assert that a failed `remove` (rejected promise) is swallowed and restore proceeds.

**Prior art for tests:** Look for any existing unit tests for `captureSnapshot` or `populateWindowTabs` in the test suite for patterns on mocking the Chrome APIs.

## Out of Scope

- Mode B (native session restore via `chrome.sessions.restore()`): Would require reliable access to session IDs, which are not available for older snapshots.
- Per-window restore (restoring only one snapshot window instead of all): All windows in a snapshot are always restored together.
- An undo/redo mechanism for accidental restores.
- Surfacing a warning when a restored snapshot group no longer has a matching Saved Tab Group in Chrome.
- Controlling whether Chrome creates new Saved Tab Group entries vs. reusing existing ones: this is Chrome's internal behavior and not controllable via extension API.
- Color restoration for groups that Chrome does not auto-group (since we're not calling `chrome.tabs.group()` ourselves).

## Further Notes

- The root cause of the "white unnamed chip" symptom is that Chrome auto-creates tab group instances from Saved Tab Group URL matching, but those instances have no title/color until they are opened or until the extension sets them via `chrome.tabGroups.update()`.
- The root cause of chip accumulation is that each restore window creates a new open instance of the saved group, visible as a separate bookmarks bar chip. Closing existing windows before restore eliminates this because only one window (the new one) ever holds the group open at a time.
- AGENTS.md should be updated to reflect that Mode A now includes group appearance correction via `chrome.tabGroups.update()` and replace-mode window closing.
