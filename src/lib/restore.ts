import type { SnapshotGroup } from "./snapshot";

/**
 * Queries the auto-created tab groups in a newly restored window, matches each
 * one to a SnapshotGroup by comparing tab membership, then applies the saved
 * title, color, and forces collapsed:true via chrome.tabGroups.update().
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

  const autoCreatedGroups = await chrome.tabGroups.query({ windowId });
  if (autoCreatedGroups.length === 0) {
    return;
  }

  // Build a map from auto-created group ID → set of tab IDs in that group
  const autoGroupTabIds = new Map<number, Set<number>>();
  for (const group of autoCreatedGroups) {
    autoGroupTabIds.set(group.id, new Set<number>());
  }

  const allTabsInWindow = await chrome.tabs.query({ windowId });
  for (const tab of allTabsInWindow) {
    if (typeof tab.id === "number" && typeof tab.groupId === "number" && autoGroupTabIds.has(tab.groupId)) {
      autoGroupTabIds.get(tab.groupId)!.add(tab.id);
    }
  }

  // For each snapshot group, compute the set of created tab IDs it owns
  for (const snapshotGroup of snapshotGroups) {
    const expectedTabIds = new Set<number>();
    for (const tabIndex of snapshotGroup.tabIndexes) {
      const createdId = createdTabIdsByIndex.get(tabIndex);
      if (typeof createdId === "number") {
        expectedTabIds.add(createdId);
      }
    }

    if (expectedTabIds.size === 0) {
      continue;
    }

    // Find the auto-created group whose tab-ID set matches the expected set
    let matchedGroupId: number | undefined;
    for (const [autoGroupId, tabIdSet] of autoGroupTabIds) {
      if (setsEqual(tabIdSet, expectedTabIds)) {
        matchedGroupId = autoGroupId;
        break;
      }
    }

    if (typeof matchedGroupId !== "number") {
      continue;
    }

    await chrome.tabGroups.update(matchedGroupId, {
      title: snapshotGroup.title,
      color: snapshotGroup.color,
      collapsed: true
    });
  }
}

function setsEqual(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const value of a) {
    if (!b.has(value)) {
      return false;
    }
  }
  return true;
}
