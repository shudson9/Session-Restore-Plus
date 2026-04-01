import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyGroupsToWindow, closeAllWindows } from "./restore";
import type { SnapshotGroup } from "./snapshot";

function makeAutoGroup(id: number, windowId = 1): chrome.tabGroups.TabGroup {
  return {
    id,
    windowId,
    title: `Auto Group ${id}`,
    color: "grey",
    collapsed: false
  } as chrome.tabGroups.TabGroup;
}

function makeTab(id: number, windowId: number, groupId: number): chrome.tabs.Tab {
  return {
    id,
    windowId,
    groupId,
    index: id - 1,
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

beforeEach(() => {
  vi.resetAllMocks();
});

describe("applyGroupsToWindow", () => {
  it("completes without error when no auto-created groups exist in the window", async () => {
    const queryMock = vi.fn().mockResolvedValue([]);
    const tabsQueryMock = vi.fn().mockResolvedValue([]);
    const updateMock = vi.fn().mockResolvedValue({});

    vi.stubGlobal("chrome", {
      tabGroups: { query: queryMock, update: updateMock, TAB_GROUP_ID_NONE: -1 },
      tabs: { query: tabsQueryMock }
    });

    const snapshotGroups: SnapshotGroup[] = [makeSnapshotGroup({ tabIndexes: [0, 1] })];
    const tabIdMap = new Map([[0, 101], [1, 102]]);

    await applyGroupsToWindow(1, snapshotGroups, tabIdMap);

    expect(updateMock).not.toHaveBeenCalled();
  });

  it("completes without error when snapshotGroups is empty", async () => {
    const queryMock = vi.fn().mockResolvedValue([makeAutoGroup(10)]);
    const tabsQueryMock = vi.fn().mockResolvedValue([makeTab(101, 1, 10)]);
    const updateMock = vi.fn().mockResolvedValue({});

    vi.stubGlobal("chrome", {
      tabGroups: { query: queryMock, update: updateMock, TAB_GROUP_ID_NONE: -1 },
      tabs: { query: tabsQueryMock }
    });

    await applyGroupsToWindow(1, [], new Map());

    expect(queryMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("calls update with correct title, color, and collapsed:true for matched group", async () => {
    const autoGroup = makeAutoGroup(10);
    const queryMock = vi.fn().mockResolvedValue([autoGroup]);
    const tabsQueryMock = vi.fn().mockResolvedValue([
      makeTab(101, 1, 10),
      makeTab(102, 1, 10)
    ]);
    const updateMock = vi.fn().mockResolvedValue({});

    vi.stubGlobal("chrome", {
      tabGroups: { query: queryMock, update: updateMock, TAB_GROUP_ID_NONE: -1 },
      tabs: { query: tabsQueryMock }
    });

    const snapshotGroups: SnapshotGroup[] = [
      makeSnapshotGroup({ title: "Work", color: "blue", tabIndexes: [0, 1] })
    ];
    const tabIdMap = new Map([[0, 101], [1, 102]]);

    await applyGroupsToWindow(1, snapshotGroups, tabIdMap);

    expect(updateMock).toHaveBeenCalledOnce();
    expect(updateMock).toHaveBeenCalledWith(10, { title: "Work", color: "blue", collapsed: true });
  });

  it("forces collapsed:true even when the snapshot group had collapsed:false", async () => {
    const autoGroup = makeAutoGroup(20);
    const queryMock = vi.fn().mockResolvedValue([autoGroup]);
    const tabsQueryMock = vi.fn().mockResolvedValue([makeTab(201, 1, 20)]);
    const updateMock = vi.fn().mockResolvedValue({});

    vi.stubGlobal("chrome", {
      tabGroups: { query: queryMock, update: updateMock, TAB_GROUP_ID_NONE: -1 },
      tabs: { query: tabsQueryMock }
    });

    const snapshotGroups: SnapshotGroup[] = [
      makeSnapshotGroup({ title: "Research", color: "red", collapsed: false, tabIndexes: [0] })
    ];
    const tabIdMap = new Map([[0, 201]]);

    await applyGroupsToWindow(1, snapshotGroups, tabIdMap);

    expect(updateMock).toHaveBeenCalledWith(20, expect.objectContaining({ collapsed: true }));
  });

  it("does NOT call update for an auto-created group that has no snapshot match", async () => {
    // Two auto-created groups: group 10 matches snapshot, group 11 does not
    const queryMock = vi.fn().mockResolvedValue([makeAutoGroup(10), makeAutoGroup(11)]);
    const tabsQueryMock = vi.fn().mockResolvedValue([
      makeTab(101, 1, 10),
      makeTab(102, 1, 10),
      makeTab(103, 1, 11) // tab 103 is in group 11, not in any snapshot group
    ]);
    const updateMock = vi.fn().mockResolvedValue({});

    vi.stubGlobal("chrome", {
      tabGroups: { query: queryMock, update: updateMock, TAB_GROUP_ID_NONE: -1 },
      tabs: { query: tabsQueryMock }
    });

    const snapshotGroups: SnapshotGroup[] = [
      makeSnapshotGroup({ title: "Work", color: "blue", tabIndexes: [0, 1] })
      // No snapshot group for tabs at index 2
    ];
    const tabIdMap = new Map([[0, 101], [1, 102], [2, 103]]);

    await applyGroupsToWindow(1, snapshotGroups, tabIdMap);

    expect(updateMock).toHaveBeenCalledOnce();
    expect(updateMock).toHaveBeenCalledWith(10, { title: "Work", color: "blue", collapsed: true });
  });

  it("correctly matches and updates multiple groups in the same window", async () => {
    const queryMock = vi.fn().mockResolvedValue([makeAutoGroup(10), makeAutoGroup(20)]);
    const tabsQueryMock = vi.fn().mockResolvedValue([
      makeTab(101, 1, 10),
      makeTab(102, 1, 10),
      makeTab(201, 1, 20)
    ]);
    const updateMock = vi.fn().mockResolvedValue({});

    vi.stubGlobal("chrome", {
      tabGroups: { query: queryMock, update: updateMock, TAB_GROUP_ID_NONE: -1 },
      tabs: { query: tabsQueryMock }
    });

    const snapshotGroups: SnapshotGroup[] = [
      makeSnapshotGroup({ id: 1, title: "Work", color: "blue", tabIndexes: [0, 1] }),
      makeSnapshotGroup({ id: 2, title: "Fun", color: "green", tabIndexes: [2] })
    ];
    const tabIdMap = new Map([[0, 101], [1, 102], [2, 201]]);

    await applyGroupsToWindow(1, snapshotGroups, tabIdMap);

    expect(updateMock).toHaveBeenCalledTimes(2);
    expect(updateMock).toHaveBeenCalledWith(10, { title: "Work", color: "blue", collapsed: true });
    expect(updateMock).toHaveBeenCalledWith(20, { title: "Fun", color: "green", collapsed: true });
  });

  it("silently skips snapshot groups whose tabs were all skipped (no created tab IDs)", async () => {
    const queryMock = vi.fn().mockResolvedValue([makeAutoGroup(10)]);
    const tabsQueryMock = vi.fn().mockResolvedValue([makeTab(101, 1, 10)]);
    const updateMock = vi.fn().mockResolvedValue({});

    vi.stubGlobal("chrome", {
      tabGroups: { query: queryMock, update: updateMock, TAB_GROUP_ID_NONE: -1 },
      tabs: { query: tabsQueryMock }
    });

    // Snapshot group refers to tabIndex 5, but that tab was skipped so it's not in the map
    const snapshotGroups: SnapshotGroup[] = [
      makeSnapshotGroup({ title: "Skipped", color: "yellow", tabIndexes: [5] })
    ];
    const tabIdMap = new Map<number, number>(); // empty — tab was skipped

    await applyGroupsToWindow(1, snapshotGroups, tabIdMap);

    expect(updateMock).not.toHaveBeenCalled();
  });

  it("queries with the correct windowId", async () => {
    const queryMock = vi.fn().mockResolvedValue([]);
    const tabsQueryMock = vi.fn().mockResolvedValue([]);
    const updateMock = vi.fn().mockResolvedValue({});

    vi.stubGlobal("chrome", {
      tabGroups: { query: queryMock, update: updateMock, TAB_GROUP_ID_NONE: -1 },
      tabs: { query: tabsQueryMock }
    });

    const snapshotGroups: SnapshotGroup[] = [makeSnapshotGroup({ tabIndexes: [0] })];
    const tabIdMap = new Map([[0, 101]]);

    await applyGroupsToWindow(42, snapshotGroups, tabIdMap);

    expect(queryMock).toHaveBeenCalledWith({ windowId: 42 });
  });
});

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

describe("closeAllWindows", () => {
  it("calls windows.remove for each open window", async () => {
    const getAllMock = vi.fn().mockResolvedValue([makeWindow(1), makeWindow(2)]);
    const removeMock = vi.fn().mockResolvedValue(undefined);

    vi.stubGlobal("chrome", {
      windows: { getAll: getAllMock, remove: removeMock }
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

    vi.stubGlobal("chrome", {
      windows: { getAll: getAllMock, remove: removeMock, create: createMock }
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

    vi.stubGlobal("chrome", {
      windows: { getAll: getAllMock, remove: removeMock }
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

    vi.stubGlobal("chrome", {
      windows: { getAll: getAllMock, remove: removeMock }
    });

    await closeAllWindows();

    expect(removeMock).not.toHaveBeenCalled();
  });
});
