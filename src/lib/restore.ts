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
 * Explicitly recreates tab groups in a newly restored window by calling
 * chrome.tabs.group() for each SnapshotGroup, then applies the saved title,
 * color, and collapsed state via chrome.tabGroups.update().
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

    const newGroupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });

    await chrome.tabGroups.update(newGroupId, {
      title: snapshotGroup.title,
      color: snapshotGroup.color,
      collapsed: snapshotGroup.collapsed
    });
  }
}
