import "./styles.css";

type SnapshotListItem = {
  id: string;
  name: string;
  createdAt: string;
  windowsCount: number;
  tabsCount: number;
  groupsCount: number;
};

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
      type: "save" | "rename" | "delete";
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
      type: "error";
      message: string;
      at: string;
    };

type ListSnapshotsResponse = {
  ok: boolean;
  snapshots: SnapshotListItem[];
  restoreLastOnStartup: boolean;
  lastAction: LastAction | null;
  error?: string;
};

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Popup root element not found.");
}

app.innerHTML = `
  <main class="popup">
    <header class="popup__header">
      <h1>Session Restore Plus</h1>
      <button id="saveSnapshot" class="button button--primary">Save Snapshot</button>
    </header>
    <section class="popup__section">
      <label class="toggle">
        <input id="restoreOnStartup" type="checkbox" />
        <span>Restore last snapshot on startup</span>
      </label>
    </section>
    <section class="popup__section">
      <h2>Last action</h2>
      <div id="lastAction" class="last-action">No actions yet.</div>
    </section>
    <section class="popup__section">
      <h2>Snapshots</h2>
      <ul id="snapshotList" class="snapshot-list"></ul>
    </section>
  </main>
`;

const snapshotList = document.querySelector<HTMLUListElement>("#snapshotList");
const saveButton = document.querySelector<HTMLButtonElement>("#saveSnapshot");
const restoreOnStartup = document.querySelector<HTMLInputElement>("#restoreOnStartup");
const lastAction = document.querySelector<HTMLDivElement>("#lastAction");

if (!snapshotList || !saveButton || !restoreOnStartup || !lastAction) {
  throw new Error("Popup controls are missing.");
}

void init();

saveButton.addEventListener("click", async () => {
  const name = prompt("Snapshot name", defaultSnapshotName())?.trim();
  if (name === null) {
    return;
  }

  const response = await sendMessage<{ ok: boolean; error?: string }>({
    type: "saveSnapshot",
    name
  });
  if (!response.ok) {
    renderLastAction({
      type: "error",
      at: new Date().toISOString(),
      message: normalizeErrorMessage(response.error, "Failed to save snapshot.")
    });
    return;
  }

  await refresh();
});

restoreOnStartup.addEventListener("change", async () => {
  const response = await sendMessage<{ ok: boolean; error?: string }>({
    type: "setRestoreOnStartup",
    enabled: restoreOnStartup.checked
  });
  if (!response.ok) {
    renderLastAction({
      type: "error",
      at: new Date().toISOString(),
      message: normalizeErrorMessage(response.error, "Failed to update startup setting.")
    });
  }
});

snapshotList.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }

  const action = target.dataset.action;
  const snapshotId = target.dataset.id;
  if (!action || !snapshotId) {
    return;
  }

  if (action === "restore") {
    const response = await sendMessage<{ ok: boolean; summary?: RestoreSummary; error?: string }>({
      type: "restoreSnapshot",
      id: snapshotId
    });
    if (!response.ok) {
      renderLastAction({
        type: "error",
        at: new Date().toISOString(),
        message: normalizeErrorMessage(response.error, "Restore failed.")
      });
      return;
    }
    await refresh();
    return;
  }

  if (action === "rename") {
    const currentName = target.dataset.name ?? "Snapshot";
    const nextName = prompt("Rename snapshot", currentName)?.trim();
    if (nextName === null) {
      return;
    }
    const response = await sendMessage<{ ok: boolean; error?: string }>({
      type: "renameSnapshot",
      id: snapshotId,
      name: nextName
    });
    if (!response.ok) {
      renderLastAction({
        type: "error",
        at: new Date().toISOString(),
        message: normalizeErrorMessage(response.error, "Rename failed.")
      });
      return;
    }
    await refresh();
    return;
  }

  if (action === "delete") {
    const confirmDelete = confirm("Delete this snapshot?");
    if (!confirmDelete) {
      return;
    }
    const response = await sendMessage<{ ok: boolean; error?: string }>({
      type: "deleteSnapshot",
      id: snapshotId
    });
    if (!response.ok) {
      renderLastAction({
        type: "error",
        at: new Date().toISOString(),
        message: normalizeErrorMessage(response.error, "Delete failed.")
      });
      return;
    }
    await refresh();
  }
});

async function init(): Promise<void> {
  await refresh();
}

async function refresh(): Promise<void> {
  const state = await sendMessage<ListSnapshotsResponse>({ type: "listSnapshots" });
  if (!state.ok) {
    renderLastAction({
      type: "error",
      at: new Date().toISOString(),
      message: normalizeErrorMessage(state.error, "Failed to load snapshots.")
    });
    return;
  }
  restoreOnStartup.checked = state.restoreLastOnStartup;
  renderSnapshotList(state.snapshots);
  renderLastAction(state.lastAction);
}

function renderSnapshotList(snapshots: SnapshotListItem[]): void {
  if (snapshots.length === 0) {
    snapshotList.innerHTML = `<li class="snapshot-list__empty">No snapshots yet.</li>`;
    return;
  }

  snapshotList.innerHTML = snapshots
    .map((snapshot) => {
      const timestamp = new Date(snapshot.createdAt).toLocaleString();
      return `
        <li class="snapshot-list__item">
          <div class="snapshot-list__meta">
            <strong>${escapeHtml(snapshot.name)}</strong>
            <span>${escapeHtml(timestamp)}</span>
            <span>${snapshot.windowsCount} window${snapshot.windowsCount === 1 ? "" : "s"} | ${snapshot.tabsCount} tab${snapshot.tabsCount === 1 ? "" : "s"} | ${snapshot.groupsCount} group${snapshot.groupsCount === 1 ? "" : "s"}</span>
          </div>
          <div class="snapshot-list__actions">
            <button class="button" data-action="restore" data-id="${escapeHtml(snapshot.id)}">Restore</button>
            <button class="button" data-action="rename" data-id="${escapeHtml(snapshot.id)}" data-name="${escapeHtml(snapshot.name)}">Rename</button>
            <button class="button button--danger" data-action="delete" data-id="${escapeHtml(snapshot.id)}">Delete</button>
          </div>
        </li>
      `;
    })
    .join("");
}

function renderLastAction(value: LastAction | null): void {
  if (!value) {
    lastAction.textContent = "No actions yet.";
    return;
  }

  const time = new Date(value.at).toLocaleString();
  if (value.type === "restore") {
    const skippedCount = value.summary.tabsSkipped.length;
    const skippedText =
      skippedCount === 0
        ? "No skipped tabs."
        : `Skipped ${skippedCount} tab${skippedCount === 1 ? "" : "s"}: ${value.summary.tabsSkipped
            .map((tab) => tab.url)
            .join(", ")}`;
    lastAction.textContent =
      `${value.message} (${time}) ` +
      `Windows: ${value.summary.windowsCreated}, tabs restored: ${value.summary.tabsRestored}. ${skippedText}`;
    return;
  }

  lastAction.textContent = `${value.message} (${time})`;
}

function defaultSnapshotName(): string {
  const timestamp = new Date().toISOString().replace("T", " ").replace(/\..+$/, "");
  return `Snapshot ${timestamp}`;
}

function normalizeErrorMessage(error: string | undefined, fallback: string): string {
  if (!error) {
    return fallback;
  }
  if (error.includes("Resource::kQuotaBytesPerItem") || error.includes("QUOTA_BYTES_PER_ITEM")) {
    return "Snapshot too large for sync storage; storing locally instead.";
  }
  return error;
}

async function sendMessage<T>(message: PopupMessage): Promise<T> {
  return (await chrome.runtime.sendMessage(message)) as T;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

type PopupMessage =
  | { type: "listSnapshots" }
  | { type: "saveSnapshot"; name?: string }
  | { type: "renameSnapshot"; id: string; name: string }
  | { type: "deleteSnapshot"; id: string }
  | { type: "restoreSnapshot"; id: string }
  | { type: "setRestoreOnStartup"; enabled: boolean };
