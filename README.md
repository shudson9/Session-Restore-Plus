# Session Restore Plus

Chrome extension (Manifest V3) for saving and restoring named browser session snapshots.

## Features

- Save named snapshots of all normal Chrome windows.
- Store snapshot payloads in `chrome.storage.local` to avoid sync quota limits.
- Capture per-window bounds/state, ordered tabs (`url`, `pinned`, `active`), and tab groups (`title`, `color`, `collapsed`, tab membership).
- Restore snapshots into new windows only (existing windows are not closed).
- Restore order:
  - Create windows.
  - Create tabs in order.
  - Apply pinned/active state.
  - Recreate tab groups and metadata.
- Skip unsupported URLs and report a restore summary:
  - windows created
  - tabs restored
  - skipped tabs list
- Popup actions:
  - Save Snapshot (name prompt with timestamp default)
  - Restore / Rename / Delete snapshots
  - Toggle: Restore last snapshot on startup
  - Last action status area with restore summary/errors
- Context menu (extension action menu):
  - Save Snapshot
  - Restore Last Snapshot
- Startup auto-restore of most recent snapshot when enabled.

## Requirements

- Node.js 20+ recommended
- npm 10+ recommended
- Google Chrome (or Chromium-based browser with MV3 extension support)

## Install

```bash
npm install
```

## Build

```bash
npm run build
```

The extension build output is generated in `dist/`.

## Dev Watch

```bash
npm run dev
```

This runs a Vite watch build into `dist/`.

## Load As Unpacked Extension

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the `dist/` directory.

## Project Structure

- `public/manifest.json`: Chrome extension manifest
- `src/background.ts`: MV3 service worker entry
- `src/popup/main.ts`: popup logic
- `src/popup/styles.css`: popup styles
- `src/lib/snapshot.ts`: schema-versioned snapshot model + validator (`schemaVersion: 1`)
- `vite.config.ts`: Vite multi-entry build config

## Manual Testing

1. Load `dist/` as unpacked extension in `chrome://extensions`.
2. Open multiple Chrome windows/tabs and create at least one tab group.
3. Click extension icon -> `Save Snapshot`.
4. Verify snapshot appears in list.
5. Click `Restore` and verify:
   - New windows are opened.
   - Tabs are restored in order.
   - Pinned and active tabs are applied.
   - Tab groups are recreated with title/color/collapsed state.
6. Include unsupported tabs (for example `chrome://settings`) and restore:
   - Check `Last action` includes skipped tabs summary.
7. Test `Rename` and `Delete` from popup.
8. Test context menu entries from the extension action:
   - `Save Snapshot`
   - `Restore Last Snapshot`
9. Enable `Restore last snapshot on startup`, fully restart Chrome, and verify latest snapshot restores.

## Known Limitations

- Unsupported URL handling intentionally skips:
  - `chrome://`
  - `chrome-extension://`
  - `edge://`
  - `about:`
  - `file://` when file URL access is not enabled for the extension
- Restore opens new windows by design and does not close/merge existing windows.
