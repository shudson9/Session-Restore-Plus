export const SNAPSHOT_SCHEMA_VERSION = 1 as const;
const WINDOW_STATES: chrome.windows.WindowState[] = ["normal", "minimized", "maximized", "fullscreen"];
const TAB_GROUP_COLORS: chrome.tabGroups.ColorEnum[] = [
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange"
];

export type Snapshot = {
  schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
  id: string;
  name: string;
  createdAt: string;
  windows: SnapshotWindow[];
};

export type SnapshotWindow = {
  bounds: {
    left?: number;
    top?: number;
    width?: number;
    height?: number;
    state?: chrome.windows.WindowState;
  };
  tabs: SnapshotTab[];
  groups: SnapshotGroup[];
};

export type SnapshotTab = {
  url: string;
  pinned: boolean;
  active: boolean;
  index: number;
  groupId?: number;
};

export type SnapshotGroup = {
  id: number;
  title: string;
  color: chrome.tabGroups.ColorEnum;
  collapsed: boolean;
  tabIndexes: number[];
};

export function isSnapshot(value: unknown): value is Snapshot {
  if (!isObject(value)) {
    return false;
  }
  if (value.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    return false;
  }
  if (typeof value.id !== "string" || typeof value.name !== "string" || typeof value.createdAt !== "string") {
    return false;
  }
  if (!Array.isArray(value.windows)) {
    return false;
  }

  return value.windows.every(isSnapshotWindow);
}

function isSnapshotWindow(value: unknown): value is SnapshotWindow {
  if (!isObject(value)) {
    return false;
  }
  if (!isSnapshotWindowBounds(value.bounds) || !Array.isArray(value.tabs) || !Array.isArray(value.groups)) {
    return false;
  }

  return value.tabs.every(isSnapshotTab) && value.groups.every(isSnapshotGroup);
}

function isSnapshotWindowBounds(value: unknown): value is SnapshotWindow["bounds"] {
  if (!isObject(value)) {
    return false;
  }

  return (
    isOptionalNumber(value.left) &&
    isOptionalNumber(value.top) &&
    isOptionalNumber(value.width) &&
    isOptionalNumber(value.height) &&
    isOptionalWindowState(value.state)
  );
}

function isSnapshotTab(value: unknown): value is SnapshotTab {
  if (!isObject(value)) {
    return false;
  }
  return (
    typeof value.url === "string" &&
    typeof value.pinned === "boolean" &&
    typeof value.active === "boolean" &&
    Number.isInteger(value.index) &&
    value.index >= 0 &&
    (value.groupId === undefined || (Number.isInteger(value.groupId) && value.groupId >= 0))
  );
}

function isSnapshotGroup(value: unknown): value is SnapshotGroup {
  if (!isObject(value)) {
    return false;
  }

  return (
    Number.isInteger(value.id) &&
    typeof value.title === "string" &&
    isTabGroupColor(value.color) &&
    typeof value.collapsed === "boolean" &&
    Array.isArray(value.tabIndexes) &&
    value.tabIndexes.every((index) => Number.isInteger(index) && index >= 0)
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || typeof value === "number";
}

function isOptionalWindowState(value: unknown): value is chrome.windows.WindowState | undefined {
  return value === undefined || WINDOW_STATES.includes(value as chrome.windows.WindowState);
}

function isTabGroupColor(value: unknown): value is chrome.tabGroups.ColorEnum {
  return typeof value === "string" && TAB_GROUP_COLORS.includes(value as chrome.tabGroups.ColorEnum);
}
