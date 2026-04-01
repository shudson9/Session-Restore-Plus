import type { SnapshotGroup } from "./snapshot";

/**
 * Closes all currently open Chrome windows (best-effort) before a restore.
 * Each window.remove() call is wrapped in its own try/catch so a single
 * failure does not abort the process.
 */
export async function closeAllWindows(): Promise<void> {
  const openWindows = await chrome.windows.getAll();
  for (const win of openWindows) {
    if (typeof win.id === "number") {
      try {
        await chrome.windows.remove(win.id);
      } catch {
        // Swallow — best-effort; restore continues regardless
      }
    }
  }
}

/**
 * Finds an existing auto-created tab group in the window that contains exactly
 * the given set of tab IDs. Returns the group ID if found, or undefined.
 *
 * This is used to detect Saved Tab Group instances that Chrome automatically
 * creates when tabs belonging to a Saved Tab Group are opened, so that restore
 * can reuse those groups instead of creating new ones (which would cause
 * duplicate chips in the bookmarks bar).
 */
async function findAutoCreatedGroup(
  windowId: number,
  expectedTabIds: Set<number>,
  autoCreatedGroups: chrome.tabGroups.TabGroup[]
): Promise<number | undefined> {
  for (const group of autoCreatedGroups) {
    const tabsInGroup = await chrome.tabs.query({ windowId, groupId: group.id });
    const groupTabIds = new Set(tabsInGroup.map((t) => t.id as number));

    if (
      groupTabIds.size === expectedTabIds.size &&
      [...expectedTabIds].every((id) => groupTabIds.has(id))
    ) {
      return group.id;
    }
  }
  return undefined;
}

/**
 * Applies tab groups to a newly restored window using a hybrid strategy:
 *
 * 1. After tabs are created, query Chrome for any auto-created groups in the
 *    window (e.g., Saved Tab Group instances Chrome instantiated automatically).
 * 2. For each SnapshotGroup, check if an auto-created group already contains
 *    exactly the expected tabs. If so, reuse that group (skip chrome.tabs.group(),
 *    call chrome.tabGroups.update() on the existing group).
 * 3. If no matching auto-created group is found, fall back to explicitly calling
 *    chrome.tabs.group() to create a new group, then chrome.tabGroups.update().
 *
 * Tabs that have no groupId in the snapshot are left ungrouped.
 *
 * @param windowId - The ID of the newly created window.
 * @param snapshotGroups - Groups captured from the original snapshot window.
 * @param createdTabIdsByIndex - Map from snapshot tab index → created tab ID.
 */
export async function applyGroupsToWindow(
  windowId: number,
  snapshotGroups: SnapshotGroup[],
  createdTabIdsByIndex: Map<number, number>
): Promise<void> {
  if (snapshotGroups.length === 0) {
    return;
  }

  // Query all auto-created groups in the window once before the loop.
  const autoCreatedGroups = await chrome.tabGroups.query({ windowId });

  for (const snapshotGroup of snapshotGroups) {
    const tabIds: number[] = [];
    for (const tabIndex of snapshotGroup.tabIndexes) {
      const createdId = createdTabIdsByIndex.get(tabIndex);
      if (typeof createdId === "number") {
        tabIds.push(createdId);
      }
    }

    if (tabIds.length === 0) {
      continue;
    }

    const expectedTabIds = new Set(tabIds);
    const existingGroupId = await findAutoCreatedGroup(windowId, expectedTabIds, autoCreatedGroups);

    let targetGroupId: number;
    if (existingGroupId !== undefined) {
      // Reuse the auto-created group — do NOT call chrome.tabs.group()
      targetGroupId = existingGroupId;
    } else {
      // No matching auto-created group; explicitly create a new one
      targetGroupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
    }

    await chrome.tabGroups.update(targetGroupId, {
      title: snapshotGroup.title,
      color: snapshotGroup.color,
      collapsed: snapshotGroup.collapsed
    });
  }
}
