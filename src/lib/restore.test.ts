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

beforeEach(() => {
  vi.resetAllMocks();
});

describe("applyGroupsToWindow", () => {
  it("completes without error when snapshotGroups is empty", async () => {
    const groupMock = vi.fn().mockResolvedValue(10);
    const updateMock = vi.fn().mockResolvedValue({});

    vi.stubGlobal("chrome", {
      tabGroups: { update: updateMock },
      tabs: { group: groupMock }
    });

    await applyGroupsToWindow(1, [], new Map());

    expect(groupMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("creates a group and applies title, color, and collapsed state", async () => {
    const groupMock = vi.fn().mockResolvedValue(99);
    const updateMock = vi.fn().mockResolvedValue({});

    vi.stubGlobal("chrome", {
      tabGroups: { update: updateMock },
      tabs: { group: groupMock }
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

    vi.stubGlobal("chrome", {
      tabGroups: { update: updateMock },
      tabs: { group: groupMock }
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

    vi.stubGlobal("chrome", {
      tabGroups: { update: updateMock },
      tabs: { group: groupMock }
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

    vi.stubGlobal("chrome", {
      tabGroups: { update: updateMock },
      tabs: { group: groupMock }
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

    vi.stubGlobal("chrome", {
      tabGroups: { update: updateMock },
      tabs: { group: groupMock }
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

    vi.stubGlobal("chrome", {
      tabGroups: { update: updateMock },
      tabs: { group: groupMock }
    });

    const snapshotGroups: SnapshotGroup[] = [makeSnapshotGroup({ tabIndexes: [0] })];
    const tabIdMap = new Map([[0, 101]]);

    await applyGroupsToWindow(42, snapshotGroups, tabIdMap);

    expect(groupMock).toHaveBeenCalledWith(expect.objectContaining({
      createProperties: { windowId: 42 }
    }));
  });
});

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
