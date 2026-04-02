import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyGroupsToWindow, closeAllWindows } from "./restore";
import type { SnapshotGroup } from "./snapshot";

function makeSnapshotGroup(overrides: Partial<SnapshotGroup> & Pick<SnapshotGroup, "tabIndexes">): SnapshotGroup {
  return {
    id: 1,
    title: "My Group",
    color: "blue",
    collapsed: false,
    savedGroupId: undefined,
    ...overrides
  };
}

function makeWindow(id: number): chrome.windows.Window {
  return {
    id,
    focused: false,
    alwaysOnTop: false,
    incognito: false,
    type: "normal",
    state: "normal"
  } as chrome.windows.Window;
}

/** Build a minimal chrome.tabGroups.TabGroup stub */
function makeTabGroup(id: number): chrome.tabGroups.TabGroup {
  return {
    id,
    windowId: 1,
    title: "",
    color: "blue",
    collapsed: false
  } as chrome.tabGroups.TabGroup;
}

/** Build a minimal chrome.tabs.Tab stub */
function makeTab(id: number, groupId: number): chrome.tabs.Tab {
  return {
    id,
    groupId,
    index: 0,
    pinned: false,
    highlighted: false,
    windowId: 1,
    active: false,
    incognito: false,
    selected: false,
    discarded: false,
    autoDiscardable: true
  } as unknown as chrome.tabs.Tab;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("applyGroupsToWindow", () => {
  it("completes without error when snapshotGroups is empty", async () => {
    const groupMock = vi.fn().mockResolvedValue(10);
    const updateMock = vi.fn().mockResolvedValue({});
    const tabGroupsQueryMock = vi.fn().mockResolvedValue([]);
    const tabsQueryMock = vi.fn().mockResolvedValue([]);

    vi.stubGlobal("chrome", {
      tabGroups: { update: updateMock, query: tabGroupsQueryMock },
      tabs: { group: groupMock, query: tabsQueryMock }
    });

    await applyGroupsToWindow(1, [], new Map());

    expect(groupMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    // Early return means query should not have been called either
    expect(tabGroupsQueryMock).not.toHaveBeenCalled();
  });

  it("creates a group and applies title, color, and collapsed state when no auto-created group exists", async () => {
    const groupMock = vi.fn().mockResolvedValue(99);
    const updateMock = vi.fn().mockResolvedValue({});
    // No auto-created groups in the window
    const tabGroupsQueryMock = vi.fn().mockResolvedValue([]);
    const tabsQueryMock = vi.fn().mockResolvedValue([]);

    vi.stubGlobal("chrome", {
      tabGroups: { update: updateMock, query: tabGroupsQueryMock },
      tabs: { group: groupMock, query: tabsQueryMock }
    });

    const snapshotGroups: SnapshotGroup[] = [
      makeSnapshotGroup({ title: "Work", color: "blue", collapsed: false, tabIndexes: [0, 1] })
    ];
    const tabIdMap = new Map([[0, 101], [1, 102]]);

    await applyGroupsToWindow(1, snapshotGroups, tabIdMap);

    expect(groupMock).toHaveBeenCalledOnce();
    expect(groupMock).toHaveBeenCalledWith({ tabIds: [101, 102], createProperties: { windowId: 1 } });
    expect(updateMock).toHaveBeenCalledOnce();
    expect(updateMock).toHaveBeenCalledWith(99, { title: "Work", color: "blue", collapsed: false });
  });

  it("restores a collapsed group with collapsed:true", async () => {
    const groupMock = vi.fn().mockResolvedValue(55);
    const updateMock = vi.fn().mockResolvedValue({});
    const tabGroupsQueryMock = vi.fn().mockResolvedValue([]);
    const tabsQueryMock = vi.fn().mockResolvedValue([]);

    vi.stubGlobal("chrome", {
      tabGroups: { update: updateMock, query: tabGroupsQueryMock },
      tabs: { group: groupMock, query: tabsQueryMock }
    });

    const snapshotGroups: SnapshotGroup[] = [
      makeSnapshotGroup({ title: "Research", color: "red", collapsed: true, tabIndexes: [0] })
    ];
    const tabIdMap = new Map([[0, 201]]);

    await applyGroupsToWindow(1, snapshotGroups, tabIdMap);

    expect(updateMock).toHaveBeenCalledWith(55, expect.objectContaining({ collapsed: true }));
  });

  it("restores multiple distinct tab groups with correct members and no cross-group contamination", async () => {
    // group() returns different IDs per call
    const groupMock = vi.fn()
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(20);
    const updateMock = vi.fn().mockResolvedValue({});
    // No auto-created groups
    const tabGroupsQueryMock = vi.fn().mockResolvedValue([]);
    const tabsQueryMock = vi.fn().mockResolvedValue([]);

    vi.stubGlobal("chrome", {
      tabGroups: { update: updateMock, query: tabGroupsQueryMock },
      tabs: { group: groupMock, query: tabsQueryMock }
    });

    const snapshotGroups: SnapshotGroup[] = [
      makeSnapshotGroup({ id: 1, title: "Work", color: "blue", collapsed: false, tabIndexes: [0, 1] }),
      makeSnapshotGroup({ id: 2, title: "Fun", color: "green", collapsed: false, tabIndexes: [2] })
    ];
    const tabIdMap = new Map([[0, 101], [1, 102], [2, 201]]);

    await applyGroupsToWindow(1, snapshotGroups, tabIdMap);

    expect(groupMock).toHaveBeenCalledTimes(2);
    expect(groupMock).toHaveBeenCalledWith({ tabIds: [101, 102], createProperties: { windowId: 1 } });
    expect(groupMock).toHaveBeenCalledWith({ tabIds: [201], createProperties: { windowId: 1 } });

    expect(updateMock).toHaveBeenCalledTimes(2);
    expect(updateMock).toHaveBeenCalledWith(10, { title: "Work", color: "blue", collapsed: false });
    expect(updateMock).toHaveBeenCalledWith(20, { title: "Fun", color: "green", collapsed: false });
  });

  it("only groups tabs that have a groupId — ungrouped tabs are left as-is", async () => {
    // tabIndex 1 is ungrouped (not in any snapshot group)
    const groupMock = vi.fn().mockResolvedValue(10);
    const updateMock = vi.fn().mockResolvedValue({});
    const tabGroupsQueryMock = vi.fn().mockResolvedValue([]);
    const tabsQueryMock = vi.fn().mockResolvedValue([]);

    vi.stubGlobal("chrome", {
      tabGroups: { update: updateMock, query: tabGroupsQueryMock },
      tabs: { group: groupMock, query: tabsQueryMock }
    });

    const snapshotGroups: SnapshotGroup[] = [
      makeSnapshotGroup({ title: "Work", color: "blue", tabIndexes: [0] })
      // tabIndex 1 is intentionally omitted → ungrouped
    ];
    const tabIdMap = new Map([[0, 101], [1, 102]]);

    await applyGroupsToWindow(1, snapshotGroups, tabIdMap);

    // Only tabId 101 should be grouped
    expect(groupMock).toHaveBeenCalledOnce();
    expect(groupMock).toHaveBeenCalledWith({ tabIds: [101], createProperties: { windowId: 1 } });
    // tabId 102 is never passed to group()
    const allTabIdsGrouped: number[] = groupMock.mock.calls.flatMap((call) => call[0].tabIds as number[]);
    expect(allTabIdsGrouped).not.toContain(102);
  });

  it("silently skips snapshot groups whose tabs were all skipped (no created tab IDs)", async () => {
    const groupMock = vi.fn().mockResolvedValue(10);
    const updateMock = vi.fn().mockResolvedValue({});
    const tabGroupsQueryMock = vi.fn().mockResolvedValue([]);
    const tabsQueryMock = vi.fn().mockResolvedValue([]);

    vi.stubGlobal("chrome", {
      tabGroups: { update: updateMock, query: tabGroupsQueryMock },
      tabs: { group: groupMock, query: tabsQueryMock }
    });

    // Snapshot group refers to tabIndex 5, but that tab was skipped so it's not in the map
    const snapshotGroups: SnapshotGroup[] = [
      makeSnapshotGroup({ title: "Skipped", color: "yellow", tabIndexes: [5] })
    ];
    const tabIdMap = new Map<number, number>(); // empty — tab was skipped

    await applyGroupsToWindow(1, snapshotGroups, tabIdMap);

    expect(groupMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("uses the correct windowId when creating the group", async () => {
    const groupMock = vi.fn().mockResolvedValue(10);
    const updateMock = vi.fn().mockResolvedValue({});
    const tabGroupsQueryMock = vi.fn().mockResolvedValue([]);
    const tabsQueryMock = vi.fn().mockResolvedValue([]);

    vi.stubGlobal("chrome", {
      tabGroups: { update: updateMock, query: tabGroupsQueryMock },
      tabs: { group: groupMock, query: tabsQueryMock }
    });

    const snapshotGroups: SnapshotGroup[] = [makeSnapshotGroup({ tabIndexes: [0] })];
    const tabIdMap = new Map([[0, 101]]);

    await applyGroupsToWindow(42, snapshotGroups, tabIdMap);

    expect(groupMock).toHaveBeenCalledWith(expect.objectContaining({
      createProperties: { windowId: 42 }
    }));
  });

  // --- New tests for hybrid auto-created group detection ---

  it("reuses an auto-created group (Saved Tab Group instance) and does NOT call chrome.tabs.group()", async () => {
    const groupMock = vi.fn();
    const updateMock = vi.fn().mockResolvedValue({});

    // Chrome has already auto-created group 77 for the restored tabs
    const autoGroup = makeTabGroup(77);
    const tabGroupsQueryMock = vi.fn().mockResolvedValue([autoGroup]);
    // chrome.tabs.query({ windowId, groupId: 77 }) returns tabs 101 and 102
    const tabsQueryMock = vi.fn().mockResolvedValue([makeTab(101, 77), makeTab(102, 77)]);

    vi.stubGlobal("chrome", {
      tabGroups: { update: updateMock, query: tabGroupsQueryMock },
      tabs: { group: groupMock, query: tabsQueryMock }
    });

    const snapshotGroups: SnapshotGroup[] = [
      makeSnapshotGroup({ title: "Work", color: "blue", collapsed: false, tabIndexes: [0, 1] })
    ];
    const tabIdMap = new Map([[0, 101], [1, 102]]);

    await applyGroupsToWindow(1, snapshotGroups, tabIdMap);

    // Should NOT have called chrome.tabs.group() — group was auto-created
    expect(groupMock).not.toHaveBeenCalled();
    // Should have called update on the existing auto-created group
    expect(updateMock).toHaveBeenCalledOnce();
    expect(updateMock).toHaveBeenCalledWith(77, { title: "Work", color: "blue", collapsed: false });
  });

  it("falls back to explicit chrome.tabs.group() when no auto-created group matches (regular non-saved group)", async () => {
    const groupMock = vi.fn().mockResolvedValue(55);
    const updateMock = vi.fn().mockResolvedValue({});

    // No auto-created groups at all
    const tabGroupsQueryMock = vi.fn().mockResolvedValue([]);
    const tabsQueryMock = vi.fn().mockResolvedValue([]);

    vi.stubGlobal("chrome", {
      tabGroups: { update: updateMock, query: tabGroupsQueryMock },
      tabs: { group: groupMock, query: tabsQueryMock }
    });

    const snapshotGroups: SnapshotGroup[] = [
      makeSnapshotGroup({ title: "Research", color: "red", collapsed: true, tabIndexes: [0] })
    ];
    const tabIdMap = new Map([[0, 201]]);

    await applyGroupsToWindow(1, snapshotGroups, tabIdMap);

    // Must create a new group explicitly
    expect(groupMock).toHaveBeenCalledOnce();
    expect(groupMock).toHaveBeenCalledWith({ tabIds: [201], createProperties: { windowId: 1 } });
    // Must update the newly created group
    expect(updateMock).toHaveBeenCalledOnce();
    expect(updateMock).toHaveBeenCalledWith(55, { title: "Research", color: "red", collapsed: true });
  });

  it("handles mixed scenario: reuses auto-created group for saved tabs, creates new group for regular tabs", async () => {
    // group() is only called for the regular group (snapshot group 2)
    const groupMock = vi.fn().mockResolvedValue(88);
    const updateMock = vi.fn().mockResolvedValue({});

    // One auto-created group (id 77) contains tabs 101 and 102 (snapshot group 1)
    const autoGroup = makeTabGroup(77);
    const tabGroupsQueryMock = vi.fn().mockResolvedValue([autoGroup]);

    // tabs.query is called per auto-created group per snapshot group being checked.
    // For snapshot group 1 (tabs 101, 102): query returns tabs 101 and 102 → match found.
    // For snapshot group 2 (tab 201): the auto-group check queries and returns 101,102 → no match.
    const tabsQueryMock = vi.fn()
      .mockResolvedValueOnce([makeTab(101, 77), makeTab(102, 77)]) // check for group 1
      .mockResolvedValueOnce([makeTab(101, 77), makeTab(102, 77)]); // check for group 2 (no match)

    vi.stubGlobal("chrome", {
      tabGroups: { update: updateMock, query: tabGroupsQueryMock },
      tabs: { group: groupMock, query: tabsQueryMock }
    });

    const snapshotGroups: SnapshotGroup[] = [
      makeSnapshotGroup({ id: 1, title: "Saved Work", color: "blue", collapsed: false, tabIndexes: [0, 1] }),
      makeSnapshotGroup({ id: 2, title: "Regular Fun", color: "green", collapsed: false, tabIndexes: [2] })
    ];
    const tabIdMap = new Map([[0, 101], [1, 102], [2, 201]]);

    await applyGroupsToWindow(1, snapshotGroups, tabIdMap);

    // chrome.tabs.group() called only once — for the regular group (snapshot group 2)
    expect(groupMock).toHaveBeenCalledOnce();
    expect(groupMock).toHaveBeenCalledWith({ tabIds: [201], createProperties: { windowId: 1 } });

    // update called twice: once for auto-created group 77, once for newly created group 88
    expect(updateMock).toHaveBeenCalledTimes(2);
    expect(updateMock).toHaveBeenCalledWith(77, { title: "Saved Work", color: "blue", collapsed: false });
    expect(updateMock).toHaveBeenCalledWith(88, { title: "Regular Fun", color: "green", collapsed: false });
  });

  it("ungrouped tabs remain ungrouped even when auto-created groups are present", async () => {
    const groupMock = vi.fn().mockResolvedValue(10);
    const updateMock = vi.fn().mockResolvedValue({});

    // An auto-created group exists but it only matches tab 101 (snapshot group covers tabIndex 0 only)
    const autoGroup = makeTabGroup(77);
    const tabGroupsQueryMock = vi.fn().mockResolvedValue([autoGroup]);
    const tabsQueryMock = vi.fn().mockResolvedValue([makeTab(101, 77)]);

    vi.stubGlobal("chrome", {
      tabGroups: { update: updateMock, query: tabGroupsQueryMock },
      tabs: { group: groupMock, query: tabsQueryMock }
    });

    const snapshotGroups: SnapshotGroup[] = [
      makeSnapshotGroup({ title: "Work", color: "blue", tabIndexes: [0] })
      // tabIndex 1 (tab 102) is ungrouped — not in any snapshot group
    ];
    const tabIdMap = new Map([[0, 101], [1, 102]]);

    await applyGroupsToWindow(1, snapshotGroups, tabIdMap);

    // Auto-created group matched for tab 101 → no chrome.tabs.group() call
    expect(groupMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledOnce();
    expect(updateMock).toHaveBeenCalledWith(77, { title: "Work", color: "blue", collapsed: false });

    // tab 102 was never passed to group() — it stays ungrouped
    const allTabIdsGrouped: number[] = groupMock.mock.calls.flatMap((call) => call[0].tabIds as number[]);
    expect(allTabIdsGrouped).not.toContain(102);
  });
});

describe("closeAllWindows", () => {
  it("calls windows.remove for each open window", async () => {
    const getAllMock = vi.fn().mockResolvedValue([makeWindow(1), makeWindow(2)]);
    const removeMock = vi.fn().mockResolvedValue(undefined);
    const tabsQueryMock = vi.fn().mockResolvedValue([]);
    const ungroupMock = vi.fn().mockResolvedValue(undefined);

    vi.stubGlobal("chrome", {
      windows: { getAll: getAllMock, remove: removeMock },
      tabs: { query: tabsQueryMock, ungroup: ungroupMock }
    });

    await closeAllWindows();

    expect(removeMock).toHaveBeenCalledTimes(2);
    expect(removeMock).toHaveBeenCalledWith(1);
    expect(removeMock).toHaveBeenCalledWith(2);
  });

  it("calls remove for each window before any windows.create would be called (ordering via call order)", async () => {
    const callOrder: string[] = [];

    const getAllMock = vi.fn().mockResolvedValue([makeWindow(10), makeWindow(20)]);
    const removeMock = vi.fn().mockImplementation((id: number) => {
      callOrder.push(`remove:${id}`);
      return Promise.resolve(undefined);
    });
    const createMock = vi.fn().mockImplementation(() => {
      callOrder.push("create");
      return Promise.resolve({ id: 99 });
    });
    const tabsQueryMock = vi.fn().mockResolvedValue([]);
    const ungroupMock = vi.fn().mockResolvedValue(undefined);

    vi.stubGlobal("chrome", {
      windows: { getAll: getAllMock, remove: removeMock, create: createMock },
      tabs: { query: tabsQueryMock, ungroup: ungroupMock }
    });

    await closeAllWindows();
    // Simulate create happening after
    await createMock();

    expect(callOrder.indexOf("remove:10")).toBeLessThan(callOrder.indexOf("create"));
    expect(callOrder.indexOf("remove:20")).toBeLessThan(callOrder.indexOf("create"));
  });

  it("swallows a rejected remove and continues closing remaining windows", async () => {
    const getAllMock = vi.fn().mockResolvedValue([makeWindow(1), makeWindow(2)]);
    const removeMock = vi.fn()
      .mockRejectedValueOnce(new Error("Cannot remove window"))
      .mockResolvedValue(undefined);
    const tabsQueryMock = vi.fn().mockResolvedValue([]);
    const ungroupMock = vi.fn().mockResolvedValue(undefined);

    vi.stubGlobal("chrome", {
      windows: { getAll: getAllMock, remove: removeMock },
      tabs: { query: tabsQueryMock, ungroup: ungroupMock }
    });

    // Should not throw
    await expect(closeAllWindows()).resolves.toBeUndefined();

    // Both removes were attempted despite the first failing
    expect(removeMock).toHaveBeenCalledTimes(2);
    expect(removeMock).toHaveBeenCalledWith(1);
    expect(removeMock).toHaveBeenCalledWith(2);
  });

  it("does nothing when there are no open windows", async () => {
    const getAllMock = vi.fn().mockResolvedValue([]);
    const removeMock = vi.fn().mockResolvedValue(undefined);
    const tabsQueryMock = vi.fn().mockResolvedValue([]);
    const ungroupMock = vi.fn().mockResolvedValue(undefined);

    vi.stubGlobal("chrome", {
      windows: { getAll: getAllMock, remove: removeMock },
      tabs: { query: tabsQueryMock, ungroup: ungroupMock }
    });

    await closeAllWindows();

    expect(removeMock).not.toHaveBeenCalled();
  });

  it("calls chrome.tabs.ungroup() with grouped tab IDs before chrome.windows.remove()", async () => {
    const callOrder: string[] = [];

    const getAllMock = vi.fn().mockResolvedValue([makeWindow(1)]);
    // Window 1 has two grouped tabs (groupId >= 0) and one ungrouped tab (groupId -1)
    const tabsQueryMock = vi.fn().mockResolvedValue([
      makeTab(10, 5),  // grouped
      makeTab(11, 5),  // grouped
      makeTab(12, -1)  // ungrouped
    ]);
    const ungroupMock = vi.fn().mockImplementation(() => {
      callOrder.push("ungroup");
      return Promise.resolve(undefined);
    });
    const removeMock = vi.fn().mockImplementation(() => {
      callOrder.push("remove");
      return Promise.resolve(undefined);
    });

    vi.stubGlobal("chrome", {
      windows: { getAll: getAllMock, remove: removeMock },
      tabs: { query: tabsQueryMock, ungroup: ungroupMock }
    });

    await closeAllWindows();

    // ungroup must have been called with only the grouped tab IDs (not -1)
    expect(ungroupMock).toHaveBeenCalledOnce();
    expect(ungroupMock).toHaveBeenCalledWith([10, 11]);

    // ungroup must come before remove
    expect(callOrder.indexOf("ungroup")).toBeLessThan(callOrder.indexOf("remove"));

    // remove must still be called
    expect(removeMock).toHaveBeenCalledOnce();
    expect(removeMock).toHaveBeenCalledWith(1);
  });

  it("does NOT call chrome.tabs.ungroup() for tabs with groupId -1 (TAB_GROUP_ID_NONE)", async () => {
    const getAllMock = vi.fn().mockResolvedValue([makeWindow(1)]);
    // All tabs are ungrouped
    const tabsQueryMock = vi.fn().mockResolvedValue([
      makeTab(10, -1),
      makeTab(11, -1)
    ]);
    const ungroupMock = vi.fn().mockResolvedValue(undefined);
    const removeMock = vi.fn().mockResolvedValue(undefined);

    vi.stubGlobal("chrome", {
      windows: { getAll: getAllMock, remove: removeMock },
      tabs: { query: tabsQueryMock, ungroup: ungroupMock }
    });

    await closeAllWindows();

    // No grouped tabs — ungroup should not be called
    expect(ungroupMock).not.toHaveBeenCalled();
    // remove should still proceed
    expect(removeMock).toHaveBeenCalledOnce();
    expect(removeMock).toHaveBeenCalledWith(1);
  });

  it("swallows an ungroup failure and still calls windows.remove()", async () => {
    const getAllMock = vi.fn().mockResolvedValue([makeWindow(1)]);
    const tabsQueryMock = vi.fn().mockResolvedValue([makeTab(10, 5)]);
    const ungroupMock = vi.fn().mockRejectedValue(new Error("ungroup failed"));
    const removeMock = vi.fn().mockResolvedValue(undefined);

    vi.stubGlobal("chrome", {
      windows: { getAll: getAllMock, remove: removeMock },
      tabs: { query: tabsQueryMock, ungroup: ungroupMock }
    });

    // Should not throw despite ungroup failing
    await expect(closeAllWindows()).resolves.toBeUndefined();

    // remove must still have been called
    expect(removeMock).toHaveBeenCalledOnce();
    expect(removeMock).toHaveBeenCalledWith(1);
  });

  it("skips the ungroup call for a window with no grouped tabs", async () => {
    const getAllMock = vi.fn().mockResolvedValue([makeWindow(1)]);
    // Window has no tabs at all
    const tabsQueryMock = vi.fn().mockResolvedValue([]);
    const ungroupMock = vi.fn().mockResolvedValue(undefined);
    const removeMock = vi.fn().mockResolvedValue(undefined);

    vi.stubGlobal("chrome", {
      windows: { getAll: getAllMock, remove: removeMock },
      tabs: { query: tabsQueryMock, ungroup: ungroupMock }
    });

    await closeAllWindows();

    expect(ungroupMock).not.toHaveBeenCalled();
    expect(removeMock).toHaveBeenCalledOnce();
    expect(removeMock).toHaveBeenCalledWith(1);
  });
});
