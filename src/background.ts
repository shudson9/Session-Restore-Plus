import { isSnapshot, SNAPSHOT_SCHEMA_VERSION, type Snapshot, type SnapshotGroup, type SnapshotTab } from "./lib/snapshot";

const MENU_SAVE = "save_snapshot";
const MENU_RESTORE_LAST = "restore_last_snapshot";
const META_STORAGE_KEY = "sessionRestorePlusMeta";
const LEGACY_STATE_KEY = "sessionRestorePlus";
const SNAPSHOT_KEY_PREFIX = "snapshot:";
const MAX_SNAPSHOTS = 50;
const META_SCHEMA_VERSION = 1 as const;

const UNSUPPORTED_URL_PREFIXES = ["chrome://", "chrome-extension://", "edge://", "about:"];

type RestoreSkippedTab = {
  windowIndex: number;
  tabIndex: number;
  url: string;
  reason: "unsupported-url";
};

type RestoreSummary = {
  windowsCreated: number;
  tabsRestored: number;
  tabsSkipped: RestoreSkippedTab[];
};

type LastAction =
  | {
      type: "save";
      message: string;
      at: string;
    }
  | {
      type: "restore";
      message: string;
      at: string;
      summary: RestoreSummary;
    }
  | {
      type: "rename";
      message: string;
      at: string;
    }
  | {
      type: "delete";
      message: string;
      at: string;
    }
  | {
      type: "error";
      message: string;
      at: string;
    };

type SnapshotIndexItem = {
  id: string;
  name: string;
  createdAt: string;
  windowsCount: number;
  tabsCount: number;
  groupsCount: number;
};

type StoredMeta = {
  schemaVersion: typeof META_SCHEMA_VERSION;
  snapshots: SnapshotIndexItem[];
  restoreLastOnStartup: boolean;
  lastSnapshotId: string | null;
  lastAction: LastAction | null;
};

type LegacyStoredState = {
  snapshots: unknown[];
  restoreLastOnStartup?: unknown;
  lastAction?: unknown;
};

const defaultMeta: StoredMeta = {
  schemaVersion: META_SCHEMA_VERSION,
  snapshots: [],
  restoreLastOnStartup: false,
  lastSnapshotId: null,
  lastAction: null
};

chrome.runtime.onInstalled.addListener(async () => {
  await ensureStorage();
  await createContextMenus();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureStorage();
  const meta = await getMeta();
  if (!meta.restoreLastOnStartup || !meta.lastSnapshotId) {
    return;
  }

  const snapshot = await getSnapshotPayload(meta.lastSnapshotId);
  if (!snapshot) {
    meta.lastAction = {
      type: "error",
      at: new Date().toISOString(),
      message: "Startup restore failed: Snapshot payload was not found."
    };
    await saveMeta(meta);
    return;
  }

  const restoreResult = await restoreSnapshotInternal(snapshot);
  meta.lastAction = restoreResult.ok
    ? {
        type: "restore",
        at: new Date().toISOString(),
        message: `Startup restore completed for "${resolveSnapshotName(meta, snapshot.id, snapshot.name)}".`,
        summary: restoreResult.summary
      }
    : {
        type: "error",
        at: new Date().toISOString(),
        message: `Startup restore failed: ${restoreResult.error}`
      };
  await saveMeta(meta);
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  const meta = await getMeta();
  if (info.menuItemId === MENU_SAVE) {
    const name = defaultSnapshotName();
    const result = await saveSnapshotInternal(name);
    if (!result.ok) {
      meta.lastAction = {
        type: "error",
        at: new Date().toISOString(),
        message: `Failed to save snapshot: ${result.error}`
      };
      await saveMeta(meta);
      return;
    }

    const nextMeta = applySavedSnapshotToMeta(meta, result.snapshot);
    nextMeta.lastAction = {
      type: "save",
      at: new Date().toISOString(),
      message: `Saved snapshot "${result.snapshot.name}".`
    };
    await saveMeta(nextMeta);
    if (result.removedSnapshotIds.length > 0) {
      await removeSnapshotPayloads(result.removedSnapshotIds);
    }
  }

  if (info.menuItemId === MENU_RESTORE_LAST) {
    if (!meta.lastSnapshotId) {
      meta.lastAction = {
        type: "error",
        at: new Date().toISOString(),
        message: "No snapshots available to restore."
      };
      await saveMeta(meta);
      return;
    }

    const snapshot = await getSnapshotPayload(meta.lastSnapshotId);
    if (!snapshot) {
      meta.lastAction = {
        type: "error",
        at: new Date().toISOString(),
        message: "No snapshots available to restore."
      };
      await saveMeta(meta);
      return;
    }

    const restoreResult = await restoreSnapshotInternal(snapshot);
    meta.lastAction = restoreResult.ok
      ? {
          type: "restore",
          at: new Date().toISOString(),
          message: `Restored snapshot "${resolveSnapshotName(meta, snapshot.id, snapshot.name)}".`,
          summary: restoreResult.summary
        }
      : {
          type: "error",
          at: new Date().toISOString(),
          message: `Failed to restore snapshot: ${restoreResult.error}`
        };
    await saveMeta(meta);
  }
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  void handleMessage(message)
    .then((response) => {
      sendResponse(response);
    })
    .catch((error: unknown) => {
      const errorMessage = error instanceof Error ? error.message : "Unknown error.";
      sendResponse({ ok: false, error: errorMessage });
    });

  return true;
});

async function createContextMenus(): Promise<void> {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: MENU_SAVE,
    title: "Save Snapshot",
    contexts: ["action"]
  });
  chrome.contextMenus.create({
    id: MENU_RESTORE_LAST,
    title: "Restore Last Snapshot",
    contexts: ["action"]
  });
}

async function ensureStorage(): Promise<void> {
  await migrateLegacyStateToLocalPayloads();
  const meta = await getMeta();
  await saveMeta(meta);
}

async function migrateLegacyStateToLocalPayloads(): Promise<void> {
  const legacyStateData = await chrome.storage.sync.get(LEGACY_STATE_KEY);
  const legacy = legacyStateData[LEGACY_STATE_KEY] as LegacyStoredState | undefined;
  if (!legacy || !Array.isArray(legacy.snapshots)) {
    return;
  }

  const validSnapshots = legacy.snapshots.filter((item): item is Snapshot => isSnapshot(item));
  if (validSnapshots.length === 0) {
    await chrome.storage.sync.remove(LEGACY_STATE_KEY);
    return;
  }

  const orderedSnapshots = validSnapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, MAX_SNAPSHOTS);
  const payloads: Record<string, Snapshot> = {};
  for (const snapshot of orderedSnapshots) {
    payloads[snapshotStorageKey(snapshot.id)] = snapshot;
  }
  await chrome.storage.local.set(payloads);

  const meta: StoredMeta = {
    schemaVersion: META_SCHEMA_VERSION,
    snapshots: orderedSnapshots.map(buildSnapshotIndexItem),
    restoreLastOnStartup: legacy.restoreLastOnStartup === true,
    lastSnapshotId: orderedSnapshots[0]?.id ?? null,
    lastAction: isLastAction(legacy.lastAction) ? legacy.lastAction : null
  };
  await chrome.storage.local.set({
    [META_STORAGE_KEY]: meta
  });
  await chrome.storage.sync.remove(LEGACY_STATE_KEY);
}

async function getMeta(): Promise<StoredMeta> {
  const syncValue = await chrome.storage.sync.get(META_STORAGE_KEY);
  const syncMeta = parseMeta(syncValue[META_STORAGE_KEY]);
  if (syncMeta) {
    return syncMeta;
  }

  const localValue = await chrome.storage.local.get(META_STORAGE_KEY);
  const localMeta = parseMeta(localValue[META_STORAGE_KEY]);
  if (localMeta) {
    return localMeta;
  }

  return { ...defaultMeta };
}

async function saveMeta(meta: StoredMeta): Promise<void> {
  const normalized = normalizeMeta(meta);
  try {
    await chrome.storage.sync.set({ [META_STORAGE_KEY]: normalized });
    await chrome.storage.local.remove(META_STORAGE_KEY);
  } catch (error: unknown) {
    if (!isQuotaError(error)) {
      throw error;
    }
    await chrome.storage.local.set({ [META_STORAGE_KEY]: normalized });
  }
}

function parseMeta(value: unknown): StoredMeta | null {
  if (!isObject(value) || value.schemaVersion !== META_SCHEMA_VERSION) {
    return null;
  }

  const snapshots = Array.isArray(value.snapshots) ? value.snapshots.filter(isSnapshotIndexItem) : [];
  const restoreLastOnStartup = typeof value.restoreLastOnStartup === "boolean" ? value.restoreLastOnStartup : false;
  const lastSnapshotId = typeof value.lastSnapshotId === "string" ? value.lastSnapshotId : null;
  const lastAction = isLastAction(value.lastAction) ? value.lastAction : null;

  return normalizeMeta({
    schemaVersion: META_SCHEMA_VERSION,
    snapshots,
    restoreLastOnStartup,
    lastSnapshotId,
    lastAction
  });
}

function normalizeMeta(meta: StoredMeta): StoredMeta {
  const snapshots = [...meta.snapshots].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const snapshotIds = new Set(snapshots.map((snapshot) => snapshot.id));
  const lastSnapshotId = meta.lastSnapshotId && snapshotIds.has(meta.lastSnapshotId) ? meta.lastSnapshotId : snapshots[0]?.id ?? null;

  return {
    schemaVersion: META_SCHEMA_VERSION,
    snapshots,
    restoreLastOnStartup: meta.restoreLastOnStartup,
    lastSnapshotId,
    lastAction: meta.lastAction
  };
}

async function handleMessage(message: unknown): Promise<unknown> {
  if (!isMessage(message)) {
    return { ok: false, error: "Invalid message." };
  }

  if (message.type === "listSnapshots") {
    const meta = await getMeta();
    return {
      ok: true,
      snapshots: meta.snapshots,
      restoreLastOnStartup: meta.restoreLastOnStartup,
      lastAction: meta.lastAction
    };
  }

  if (message.type === "setRestoreOnStartup") {
    const meta = await getMeta();
    meta.restoreLastOnStartup = message.enabled;
    await saveMeta(meta);
    return { ok: true };
  }

  if (message.type === "saveSnapshot") {
    const meta = await getMeta();
    const snapshotName = message.name?.trim() || defaultSnapshotName();
    const result = await saveSnapshotInternal(snapshotName);
    if (!result.ok) {
      meta.lastAction = {
        type: "error",
        at: new Date().toISOString(),
        message: `Failed to save snapshot: ${result.error}`
      };
      await saveMeta(meta);
      return { ok: false, error: result.error };
    }

    const nextMeta = applySavedSnapshotToMeta(meta, result.snapshot);
    nextMeta.lastAction = {
      type: "save",
      at: new Date().toISOString(),
      message: `Saved snapshot "${result.snapshot.name}".`
    };
    await saveMeta(nextMeta);
    if (result.removedSnapshotIds.length > 0) {
      await removeSnapshotPayloads(result.removedSnapshotIds);
    }
    return { ok: true };
  }

  if (message.type === "renameSnapshot") {
    const meta = await getMeta();
    const newName = message.name.trim();
    if (!newName) {
      return { ok: false, error: "Snapshot name cannot be empty." };
    }

    const target = meta.snapshots.find((item) => item.id === message.id);
    if (!target) {
      return { ok: false, error: "Snapshot not found." };
    }

    target.name = newName;
    await updateSnapshotPayloadName(message.id, newName);
    meta.lastAction = {
      type: "rename",
      at: new Date().toISOString(),
      message: `Renamed snapshot to "${newName}".`
    };
    await saveMeta(meta);
    return { ok: true };
  }

  if (message.type === "deleteSnapshot") {
    const meta = await getMeta();
    const nextSnapshots = meta.snapshots.filter((item) => item.id !== message.id);
    if (nextSnapshots.length === meta.snapshots.length) {
      return { ok: false, error: "Snapshot not found." };
    }

    meta.snapshots = nextSnapshots;
    if (meta.lastSnapshotId === message.id) {
      meta.lastSnapshotId = nextSnapshots[0]?.id ?? null;
    }
    meta.lastAction = {
      type: "delete",
      at: new Date().toISOString(),
      message: "Snapshot deleted."
    };
    await Promise.all([saveMeta(meta), removeSnapshotPayloads([message.id])]);
    return { ok: true };
  }

  if (message.type === "restoreSnapshot") {
    const meta = await getMeta();
    const snapshot = await getSnapshotPayload(message.id);
    if (!snapshot) {
      return { ok: false, error: "Snapshot not found." };
    }

    const restoreResult = await restoreSnapshotInternal(snapshot);
    if (!restoreResult.ok) {
      meta.lastAction = {
        type: "error",
        at: new Date().toISOString(),
        message: `Failed to restore snapshot: ${restoreResult.error}`
      };
      await saveMeta(meta);
      return { ok: false, error: restoreResult.error };
    }

    meta.lastSnapshotId = snapshot.id;
    meta.lastAction = {
      type: "restore",
      at: new Date().toISOString(),
      message: `Restored snapshot "${resolveSnapshotName(meta, snapshot.id, snapshot.name)}".`,
      summary: restoreResult.summary
    };
    await saveMeta(meta);
    return { ok: true, summary: restoreResult.summary };
  }

  return { ok: false, error: "Unsupported message type." };
}

function applySavedSnapshotToMeta(meta: StoredMeta, snapshot: Snapshot): StoredMeta {
  const newEntry = buildSnapshotIndexItem(snapshot);
  const ordered = [newEntry, ...meta.snapshots.filter((item) => item.id !== snapshot.id)].slice(0, MAX_SNAPSHOTS);
  return normalizeMeta({
    ...meta,
    snapshots: ordered,
    lastSnapshotId: snapshot.id
  });
}

async function saveSnapshotInternal(
  name: string
): Promise<{ ok: true; snapshot: Snapshot; removedSnapshotIds: string[] } | { ok: false; error: string }> {
  const snapshot = await captureSnapshot(name);
  if (!isSnapshot(snapshot) || snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    return { ok: false, error: "Snapshot validation failed." };
  }

  await chrome.storage.local.set({
    [snapshotStorageKey(snapshot.id)]: snapshot
  });

  const meta = await getMeta();
  const existingIds = new Set(meta.snapshots.map((item) => item.id));
  const currentEntries = [buildSnapshotIndexItem(snapshot), ...meta.snapshots.filter((item) => item.id !== snapshot.id)];
  const keptEntries = currentEntries.slice(0, MAX_SNAPSHOTS);
  const keptIds = new Set(keptEntries.map((item) => item.id));
  const removedSnapshotIds = [...existingIds].filter((id) => !keptIds.has(id));

  return { ok: true, snapshot, removedSnapshotIds };
}

function buildSnapshotIndexItem(snapshot: Snapshot): SnapshotIndexItem {
  const windowsCount = snapshot.windows.length;
  const tabsCount = snapshot.windows.reduce((total, windowItem) => total + windowItem.tabs.length, 0);
  const groupsCount = snapshot.windows.reduce((total, windowItem) => total + windowItem.groups.length, 0);
  return {
    id: snapshot.id,
    name: snapshot.name,
    createdAt: snapshot.createdAt,
    windowsCount,
    tabsCount,
    groupsCount
  };
}

async function updateSnapshotPayloadName(snapshotId: string, name: string): Promise<void> {
  const payload = await getSnapshotPayload(snapshotId);
  if (!payload) {
    return;
  }
  payload.name = name;
  await chrome.storage.local.set({
    [snapshotStorageKey(snapshotId)]: payload
  });
}

async function getSnapshotPayload(snapshotId: string): Promise<Snapshot | null> {
  const key = snapshotStorageKey(snapshotId);
  const data = await chrome.storage.local.get(key);
  const payload = data[key];
  return isSnapshot(payload) ? payload : null;
}

async function removeSnapshotPayloads(snapshotIds: string[]): Promise<void> {
  if (snapshotIds.length === 0) {
    return;
  }
  await chrome.storage.local.remove(snapshotIds.map(snapshotStorageKey));
}

function snapshotStorageKey(snapshotId: string): string {
  return `${SNAPSHOT_KEY_PREFIX}${snapshotId}`;
}

function resolveSnapshotName(meta: StoredMeta, snapshotId: string, fallbackName: string): string {
  return meta.snapshots.find((item) => item.id === snapshotId)?.name ?? fallbackName;
}

async function captureSnapshot(name: string): Promise<Snapshot> {
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
  const snapshotWindows = await Promise.all(
    windows.map(async (windowItem) => {
      const tabs = [...(windowItem.tabs ?? [])].sort((a, b) => a.index - b.index);
      const capturedTabs: SnapshotTab[] = tabs.map((tab, position) => ({
        url: tab.url ?? tab.pendingUrl ?? "about:blank",
        pinned: Boolean(tab.pinned),
        active: Boolean(tab.active),
        index: position,
        groupId: tab.groupId !== undefined && tab.groupId >= 0 ? tab.groupId : undefined
      }));

      const groups = await captureWindowGroups(windowItem.id, tabs);
      return {
        bounds: {
          left: windowItem.left,
          top: windowItem.top,
          width: windowItem.width,
          height: windowItem.height,
          state: windowItem.state
        },
        tabs: capturedTabs,
        groups
      };
    })
  );

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    id: createId(),
    name,
    createdAt: new Date().toISOString(),
    windows: snapshotWindows
  };
}

async function captureWindowGroups(windowId: number | undefined, tabs: chrome.tabs.Tab[]): Promise<SnapshotGroup[]> {
  if (windowId === undefined) {
    return [];
  }

  const groupIdSet = new Set<number>();
  tabs.forEach((tab) => {
    if (typeof tab.groupId === "number" && tab.groupId >= 0) {
      groupIdSet.add(tab.groupId);
    }
  });

  const groups: SnapshotGroup[] = [];
  const orderedTabs = [...tabs].sort((a, b) => a.index - b.index);
  for (const groupId of groupIdSet) {
    try {
      const group = await chrome.tabGroups.get(groupId);
      const tabIndexes = orderedTabs
        .map((tab, position) => ({ groupId: tab.groupId, position }))
        .filter((item) => item.groupId === groupId)
        .map((item) => item.position);
      groups.push({
        id: group.id,
        title: group.title,
        color: group.color,
        collapsed: group.collapsed,
        tabIndexes
      });
    } catch {
      // Ignore groups that no longer exist.
    }
  }

  return groups;
}

async function restoreSnapshotInternal(
  snapshot: Snapshot
): Promise<{ ok: true; summary: RestoreSummary } | { ok: false; error: string }> {
  if (!isSnapshot(snapshot) || snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    return { ok: false, error: "Snapshot schema validation failed." };
  }

  const allowFileUrls = await isFileUrlRestoreAllowed();
  const summary: RestoreSummary = {
    windowsCreated: 0,
    tabsRestored: 0,
    tabsSkipped: []
  };
  const restoredGroupsByWindow = new Map<number, RestoredGroup[]>();

  for (let windowIndex = 0; windowIndex < snapshot.windows.length; windowIndex += 1) {
    const snapshotWindow = snapshot.windows[windowIndex];
    const createdWindow = await createTargetWindow(snapshotWindow);
    summary.windowsCreated += 1;

    const createdTabIdsByIndex = new Map<number, number>();
    const defaultTabId = createdWindow.tabs?.[0]?.id;
    let usedDefaultTab = false;
    let nextIndex = 0;

    for (let tabIndex = 0; tabIndex < snapshotWindow.tabs.length; tabIndex += 1) {
      const snapshotTab = snapshotWindow.tabs[tabIndex];
      if (!isRestorableUrl(snapshotTab.url, allowFileUrls)) {
        summary.tabsSkipped.push({
          windowIndex,
          tabIndex,
          url: snapshotTab.url,
          reason: "unsupported-url"
        });
        continue;
      }

      if (!usedDefaultTab && typeof defaultTabId === "number") {
        const updatedTab = await chrome.tabs.update(defaultTabId, {
          url: snapshotTab.url,
          active: false
        });
        if (typeof updatedTab.id === "number") {
          createdTabIdsByIndex.set(tabIndex, updatedTab.id);
          summary.tabsRestored += 1;
          usedDefaultTab = true;
          nextIndex = 1;
        }
        continue;
      }

      const createdTab = await chrome.tabs.create({
        windowId: createdWindow.id,
        url: snapshotTab.url,
        active: false,
        index: nextIndex
      });
      if (typeof createdTab.id === "number") {
        createdTabIdsByIndex.set(tabIndex, createdTab.id);
        summary.tabsRestored += 1;
        nextIndex += 1;
      }
    }

    await applyPinnedAndActive(snapshotWindow.tabs, createdTabIdsByIndex);
    if (typeof createdWindow.id === "number") {
      const restoredGroups = await restoreWindowGroups(snapshotWindow.groups, createdTabIdsByIndex);
      if (restoredGroups.length > 0) {
        restoredGroupsByWindow.set(createdWindow.id, restoredGroups);
      }
    }
  }

  if (restoredGroupsByWindow.size > 0) {
    await finalizeRestoredGroupMetadata(restoredGroupsByWindow);
  }

  return { ok: true, summary };
}

async function createTargetWindow(snapshotWindow: Snapshot["windows"][number]): Promise<chrome.windows.Window> {
  const { bounds } = snapshotWindow;
  if (bounds.state && bounds.state !== "normal") {
    return chrome.windows.create({
      url: "about:blank",
      state: bounds.state
    });
  }

  return chrome.windows.create({
    url: "about:blank",
    state: bounds.state ?? "normal",
    left: bounds.left,
    top: bounds.top,
    width: bounds.width,
    height: bounds.height
  });
}

async function applyPinnedAndActive(
  snapshotTabs: SnapshotTab[],
  createdTabIdsByIndex: Map<number, number>
): Promise<void> {
  for (let tabIndex = 0; tabIndex < snapshotTabs.length; tabIndex += 1) {
    const tabId = createdTabIdsByIndex.get(tabIndex);
    if (typeof tabId !== "number") {
      continue;
    }

    if (snapshotTabs[tabIndex].pinned) {
      await chrome.tabs.update(tabId, { pinned: true });
    }
  }

  const activeTabIndex = snapshotTabs.findIndex((tab, index) => tab.active && createdTabIdsByIndex.has(index));
  const fallbackTabIndex = snapshotTabs.findIndex((_tab, index) => createdTabIdsByIndex.has(index));
  const finalActiveIndex = activeTabIndex >= 0 ? activeTabIndex : fallbackTabIndex;
  if (finalActiveIndex >= 0) {
    const activeTabId = createdTabIdsByIndex.get(finalActiveIndex);
    if (typeof activeTabId === "number") {
      await chrome.tabs.update(activeTabId, { active: true });
    }
  }
}

type RestoredGroup = {
  groupId: number;
  title: string;
  color: chrome.tabGroups.ColorEnum;
  collapsed: boolean;
};

async function restoreWindowGroups(
  groups: SnapshotGroup[],
  createdTabIdsByIndex: Map<number, number>
): Promise<RestoredGroup[]> {
  const restoredGroups: RestoredGroup[] = [];
  for (const group of groups) {
    const tabIds = group.tabIndexes
      .map((tabIndex) => createdTabIdsByIndex.get(tabIndex))
      .filter((tabId): tabId is number => typeof tabId === "number");
    if (tabIds.length === 0) {
      continue;
    }

    const groupId = await chrome.tabs.group({ tabIds });
    restoredGroups.push({
      groupId,
      title: group.title,
      color: group.color,
      collapsed: group.collapsed
    });
    await sleep(35);
  }

  return restoredGroups;
}

async function finalizeRestoredGroupMetadata(restoredGroupsByWindow: Map<number, RestoredGroup[]>): Promise<void> {
  await sleep(500);

  for (const restoredGroups of restoredGroupsByWindow.values()) {
    for (const group of restoredGroups) {
      await chrome.tabGroups.update(group.groupId, {
        title: group.title,
        color: group.color,
        collapsed: group.collapsed
      });

      const toggledCollapsed = !group.collapsed;
      await chrome.tabGroups.update(group.groupId, {
        title: group.title,
        color: group.color,
        collapsed: toggledCollapsed
      });
      await sleep(35);
      await chrome.tabGroups.update(group.groupId, {
        title: group.title,
        color: group.color,
        collapsed: group.collapsed
      });
      await sleep(35);
    }
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRestorableUrl(url: string, allowFileUrls: boolean): boolean {
  if (url.startsWith("file://")) {
    return allowFileUrls;
  }

  return !UNSUPPORTED_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}

async function isFileUrlRestoreAllowed(): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.extension.isAllowedFileSchemeAccess((isAllowed) => {
      resolve(isAllowed);
    });
  });
}

function defaultSnapshotName(): string {
  const timestamp = new Date().toISOString().replace("T", " ").replace(/\..+$/, "");
  return `Snapshot ${timestamp}`;
}

function createId(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSnapshotIndexItem(value: unknown): value is SnapshotIndexItem {
  if (!isObject(value)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.createdAt === "string" &&
    Number.isInteger(value.windowsCount) &&
    value.windowsCount >= 0 &&
    Number.isInteger(value.tabsCount) &&
    value.tabsCount >= 0 &&
    Number.isInteger(value.groupsCount) &&
    value.groupsCount >= 0
  );
}

function isLastAction(value: unknown): value is LastAction | null {
  if (value === null) {
    return true;
  }
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const action = value as Partial<LastAction>;
  if (typeof action.type !== "string" || typeof action.message !== "string" || typeof action.at !== "string") {
    return false;
  }
  if (action.type === "restore") {
    if (typeof action.summary !== "object" || action.summary === null) {
      return false;
    }
    const summary = action.summary as Partial<RestoreSummary>;
    return (
      typeof summary.windowsCreated === "number" &&
      typeof summary.tabsRestored === "number" &&
      Array.isArray(summary.tabsSkipped)
    );
  }
  return true;
}

function isQuotaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("Resource::kQuotaBytesPerItem") || message.includes("QUOTA_BYTES_PER_ITEM");
}

type ExtensionMessage =
  | { type: "listSnapshots" }
  | { type: "saveSnapshot"; name?: string }
  | { type: "renameSnapshot"; id: string; name: string }
  | { type: "deleteSnapshot"; id: string }
  | { type: "restoreSnapshot"; id: string }
  | { type: "setRestoreOnStartup"; enabled: boolean };

function isMessage(value: unknown): value is ExtensionMessage {
  if (typeof value !== "object" || value === null || typeof (value as { type?: unknown }).type !== "string") {
    return false;
  }

  const message = value as Partial<ExtensionMessage>;
  if (message.type === "listSnapshots") {
    return true;
  }
  if (message.type === "saveSnapshot") {
    return message.name === undefined || typeof message.name === "string";
  }
  if (message.type === "renameSnapshot") {
    return typeof message.id === "string" && typeof message.name === "string";
  }
  if (message.type === "deleteSnapshot" || message.type === "restoreSnapshot") {
    return typeof message.id === "string";
  }
  if (message.type === "setRestoreOnStartup") {
    return typeof message.enabled === "boolean";
  }

  return false;
}
