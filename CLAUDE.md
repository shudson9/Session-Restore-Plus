# CLAUDE.md

## Workflow
- Prefer one issue at a time. Do not start a second issue unless asked or blocked..
- Preferred flow for new features: grill-me → PRD → GitHub issues → implementation → QA.
- Avoid broad refactors unless explicitly requested.

## Restore behavior
- Any change touching restore logic (`src/background.ts`, `src/lib/snapshot.ts`, `src/popup/main.ts`) must be manually verified for repeated restore behavior:
  - Restore once, verify results.
  - Restore again without reloading the extension, verify idempotency.
  - Verify startup auto-restore fires only once after a full Chrome restart.

## Chrome permissions
- Before adding any new `permissions` or `host_permissions` entry to `public/manifest.json`, explain what the permission grants and why it is needed. Get explicit approval before writing the change.

## Build
- `npm run build` — produces `dist/`
- Load `dist/` as an unpacked extension in `chrome://extensions` for manual testing.
