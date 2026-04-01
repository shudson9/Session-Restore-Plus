import { describe, it, expect, vi, beforeEach } from "vitest";
import { captureWindowGroups } from "./capture";

// Minimal chrome.tabGroups.TabGroup factory
function makeTabGroup(
  id: number,
  overrides: Partial<chrome.tabGroups.TabGroup> = {}
): chrome.tabGroups.TabGroup {
  return {
    id,
    title: "Group " + id,
    color: "blue",
    collapsed: false,
    windowId: 1,
    ...overrides
  } as chrome.tabGroups.TabGroup;
}

// Minimal chrome.tabs.Tab factory
function makeTab(
  id: number,
  index: number,
  groupId?: number
): chrome.tabs.Tab {
  return {
    id,
    index,
    groupId: groupId ?? chrome.tabGroups.TAB_GROUP_ID_NONE,
    windowId: 1,
    url: `https://example.com/${id}`,
    pinned: false,
    active: false,
    highlighted: false,
    selected: false,
    discarded: false,
    autoDiscardable: true,
    incognito: false
  } as unknown as chrome.tabs.Tab;
}

beforeEach(() => {
  // Reset the chrome mock before each test
  vi.resetAllMocks();
});

describe("captureWindowGroups", () => {
  it("returns empty array when no tabs belong to a group", async () => {
    const queryMock = vi.fn().mockResolvedValue([]);
    vi.stubGlobal("chrome", {
      tabGroups: {
        query: queryMock,
        TAB_GROUP_ID_NONE: -1
      }
    });

    const tabs = [makeTab(1, 0), makeTab(2, 1)];
    const result = await captureWindowGroups(tabs, 1);

    expect(result).toEqual([]);
    // query should not be called since there are no groups
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("returns SnapshotGroups with real metadata from chrome.tabGroups.query", async () => {
    const tg10 = makeTabGroup(10, { title: "Work", color: "blue", collapsed: false });
    const tg20 = makeTabGroup(20, { title: "Research", color: "red", collapsed: true });

    const queryMock = vi.fn().mockResolvedValue([tg10, tg20]);
    vi.stubGlobal("chrome", {
      tabGroups: {
        query: queryMock,
        TAB_GROUP_ID_NONE: -1
      }
    });

    const tabs = [
      makeTab(1, 0, 10),
      makeTab(2, 1, 10),
      makeTab(3, 2, 20),
      makeTab(4, 3) // ungrouped
    ];

    const result = await captureWindowGroups(tabs, 1);

    expect(queryMock).toHaveBeenCalledWith({ windowId: 1 });
    expect(result).toHaveLength(2);

    const group10 = result.find((g) => g.id === 10);
    expect(group10).toBeDefined();
    expect(group10!.title).toBe("Work");
    expect(group10!.color).toBe("blue");
    expect(group10!.collapsed).toBe(false);
    expect(group10!.tabIndexes).toEqual([0, 1]);

    const group20 = result.find((g) => g.id === 20);
    expect(group20).toBeDefined();
    expect(group20!.title).toBe("Research");
    expect(group20!.color).toBe("red");
    expect(group20!.collapsed).toBe(true);
    expect(group20!.tabIndexes).toEqual([2]);
  });

  it("falls back to empty string/grey/false when group ID is absent from query result", async () => {
    // query returns no matching group for groupId 99
    const queryMock = vi.fn().mockResolvedValue([]);
    vi.stubGlobal("chrome", {
      tabGroups: {
        query: queryMock,
        TAB_GROUP_ID_NONE: -1
      }
    });

    const tabs = [makeTab(1, 0, 99), makeTab(2, 1, 99)];

    const result = await captureWindowGroups(tabs, 1);

    expect(result).toHaveLength(1);
    const group = result[0];
    expect(group.id).toBe(99);
    expect(group.title).toBe("");
    expect(group.color).toBe("grey");
    expect(group.collapsed).toBe(false);
    expect(group.savedGroupId).toBeUndefined();
    expect(group.tabIndexes).toEqual([0, 1]);
  });

  it("queries with no windowId filter when windowId is undefined", async () => {
    const tg5 = makeTabGroup(5, { title: "All", color: "green", collapsed: false });
    const queryMock = vi.fn().mockResolvedValue([tg5]);
    vi.stubGlobal("chrome", {
      tabGroups: {
        query: queryMock,
        TAB_GROUP_ID_NONE: -1
      }
    });

    const tabs = [makeTab(1, 0, 5)];

    await captureWindowGroups(tabs, undefined);

    expect(queryMock).toHaveBeenCalledWith({});
  });

  it("populates savedGroupId as undefined on captured groups", async () => {
    const tg1 = makeTabGroup(1, { title: "Dev", color: "cyan", collapsed: false });
    const queryMock = vi.fn().mockResolvedValue([tg1]);
    vi.stubGlobal("chrome", {
      tabGroups: {
        query: queryMock,
        TAB_GROUP_ID_NONE: -1
      }
    });

    const tabs = [makeTab(1, 0, 1)];
    const result = await captureWindowGroups(tabs, 1);

    expect(result[0].savedGroupId).toBeUndefined();
  });
});
