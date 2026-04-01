import type { SnapshotGroup } from "./snapshot";

export async function captureWindowGroups(tabs: chrome.tabs.Tab[], windowId: number | undefined): Promise<SnapshotGroup[]> {
  const groupIdSet = new Set<number>();
  tabs.forEach((tab) => {
    if (typeof tab.groupId === "number" && tab.groupId >= 0) {
      groupIdSet.add(tab.groupId);
    }
  });

  if (groupIdSet.size === 0) {
    return [];
  }

  const queryFilter: Parameters<typeof chrome.tabGroups.query>[0] = windowId !== undefined ? { windowId } : {};
  const tabGroupList = await chrome.tabGroups.query(queryFilter);
  const tabGroupMap = new Map<number, chrome.tabGroups.TabGroup>();
  for (const tg of tabGroupList) {
    tabGroupMap.set(tg.id, tg);
  }

  const orderedTabs = [...tabs].sort((a, b) => a.index - b.index);
  const groups: SnapshotGroup[] = [];
  for (const groupId of groupIdSet) {
    const tabIndexes = orderedTabs
      .map((tab, position) => ({ groupId: tab.groupId, position }))
      .filter((item) => item.groupId === groupId)
      .map((item) => item.position);

    const tg = tabGroupMap.get(groupId);
    groups.push({
      id: groupId,
      title: tg?.title ?? "",
      color: tg?.color ?? "grey",
      collapsed: tg?.collapsed ?? false,
      tabIndexes,
      savedGroupId: undefined
    });
  }

  return groups;
}
