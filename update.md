# Fork Update Process

This process updates your fork from `upstream/main`, publishes a new release APK when upstream changed, then rebuilds and relaunches the local macOS desktop app so your desktop install stays in sync with the merged code.

Release destination (release APK only):

`/Users/radoslawchybicki/Library/CloudStorage/GoogleDrive-rchybicki@gmail.com/My Drive/phone share/CodexMonitor/CodexMonitor-release.apk`

Local macOS app bundle to rebuild/relaunch after merged updates:

`src-tauri/target/release/bundle/macos/Codex Monitor Dev.app`

Do not publish debug APKs, universal debug APKs, or AAB artifacts to Google Drive.

## Current Android Release Focus

- Project tab long-press actions must work on Android for project, worktree, and agent rows.
- Mobile/touch platforms must open the same context menu actions as desktop right-click.
- Desktop platforms keep native context popup menus.
- Implementation rule: keep long-press wired to Sidebar anchored popover menus (`openWorkspaceMenu` / `openWorktreeMenu` / `openThreadMenu`) and keep right-click wired to native menu popup (`showWorkspaceMenu` / `showWorktreeMenu` / `showThreadMenu`).

## Remote Model

- `origin` = your fork (push target)
- `upstream` = main project repo (read-only source for merges)
- Never push to `upstream`.

## 1) Review Upstream and Decide

Fetch and list upstream commits not yet in your branch:

```bash
git checkout main
git fetch upstream --prune
git log --oneline --decorate --no-merges main..upstream/main
```

Also list upstream-only affected files (from merge-base to upstream):

```bash
MB="$(git merge-base main upstream/main)"
git diff --name-only "$MB"..upstream/main
```

Record these two outputs in your run summary every time.

No-op rule:

- If `HEAD..upstream/main` is empty, stop.
- If `main..upstream/main` is empty, stop.
- Do not merge.
- Do not build APK.
- Do not publish to Google Drive.
- Do not rebuild/restart the macOS app.
- Do not push to `origin/main`.

Optional shell gate:

```bash
UPSTREAM_CHANGES="$(git log --oneline --no-merges main..upstream/main)"
if [ -z "$UPSTREAM_CHANGES" ]; then
  echo "No upstream changes. Merge/build/publish skipped."
  exit 0
fi
```

## 2) Merge Upstream Into Your Branch (Only If Step 1 Has Changes)

Use your main branch (`main`) and merge (no rebase):

```bash
git checkout main
git merge --no-ff upstream/main
```

If the merge has conflicts, resolve them before continuing.

### Merge Conflict Guardrails (Android long-press menus)

Do not blindly take `--theirs` for these files:

- `src/features/app/components/WorkspaceCard.tsx`
- `src/features/app/components/WorktreeCard.tsx`
- `src/features/app/components/ThreadRow.tsx`
- `src/features/app/components/ThreadList.tsx`
- `src/features/app/components/PinnedThreadList.tsx`
- `src/features/app/components/WorktreeSection.tsx`
- `src/features/app/components/Sidebar.tsx`

These files carry Android touch long-press behavior for opening context menus.
If conflicts occur, preserve long-press handling (`onPointerDown`/`onPointerMove`/`onPointerUp` + `LONG_PRESS_*`) while keeping upstream desktop right-click behavior.
In `Sidebar.tsx`, preserve the mobile anchored popover state/handlers (`threadMenuAnchor` / `workspaceMenuAnchor` / `worktreeMenuAnchor`, `open*Menu`, and the `createPortal(<PopoverSurface ...>)` menu blocks). If these disappear, Android long-press will no-op even when pointer handlers still exist.
In `src/styles/sidebar.css`, preserve `.sidebar-thread-menu` positioning styles (`position: fixed`, `z-index`, padding/layout). If this class is removed, Android long-press menus can render off-flow/invisible.

Quick verification before build:

```bash
rg -n "LONG_PRESS_|onPointerDown|onOpenWorkspaceMenu|onOpenWorktreeMenu|onOpenThreadMenu" \
  src/features/app/components/WorkspaceCard.tsx \
  src/features/app/components/WorktreeCard.tsx \
  src/features/app/components/ThreadRow.tsx \
  src/features/app/components/ThreadList.tsx \
  src/features/app/components/PinnedThreadList.tsx \
  src/features/app/components/WorktreeSection.tsx \
  src/features/app/components/Sidebar.tsx
```

## 3) Build Android Release APK (Only If Step 1 Has Changes)

```bash
npm run typecheck
./scripts/build_android.sh --apk-only --target aarch64
```

Output APK:

`src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`

## 4) Publish Release APK to Google Drive (Only If Step 1 Has Changes)

Validate destination directory first:

```bash
test -d "/Users/radoslawchybicki/Library/CloudStorage/GoogleDrive-rchybicki@gmail.com/My Drive/phone share/CodexMonitor"
```

Then copy only the release APK (retry once if it fails):

```bash
SRC="src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk"
DST="/Users/radoslawchybicki/Library/CloudStorage/GoogleDrive-rchybicki@gmail.com/My Drive/phone share/CodexMonitor/CodexMonitor-release.apk"

cp -f "$SRC" "$DST" || {
  sleep 3
  cp -f "$SRC" "$DST"
}
```

Verify:

```bash
ls -lh \
  "/Users/radoslawchybicki/Library/CloudStorage/GoogleDrive-rchybicki@gmail.com/My Drive/phone share/CodexMonitor/CodexMonitor-release.apk"
shasum -a 256 \
  "src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk" \
  "/Users/radoslawchybicki/Library/CloudStorage/GoogleDrive-rchybicki@gmail.com/My Drive/phone share/CodexMonitor/CodexMonitor-release.apk"
```

If Google Drive briefly shows `0B`, verify real bytes:

```bash
stat -f "%N %z bytes" \
  "/Users/radoslawchybicki/Library/CloudStorage/GoogleDrive-rchybicki@gmail.com/My Drive/phone share/CodexMonitor/CodexMonitor-release.apk"
```

Before installing on phone, delete the previously downloaded APK from the device and download it again from Google Drive to avoid stale cached files.

## 5) Rebuild And Restart macOS App (Only If Step 1 Has Changes)

Rebuild the local macOS desktop app bundle:

```bash
npm run tauri:build:local
```

Quit the currently running local app if it is open, then relaunch the rebuilt bundle:

```bash
sh scripts/restart-local-dev-app.sh
```

Quick verification:

```bash
ls -lh "src-tauri/target/release/bundle/macos/Codex Monitor Dev.app"
APP_EXEC="$(pwd)/src-tauri/target/release/bundle/macos/Codex Monitor Dev.app/Contents/MacOS/codex-monitor"
pgrep -fl "$APP_EXEC"
```

## 6) Push Updated Branch to Fork (Only If Step 1 Has Changes)

After merge:

```bash
git push origin main
```

This updates only your fork branch and keeps `upstream` read-only.

## 7) Summarize Changes (Always Required)

When Step 1 found updates, include (using the Step 1 outputs captured before merge):

1. Full upstream commit list from `git log main..upstream/main`
2. Upstream changed files from `git diff --name-only "$(git merge-base main upstream/main)"..upstream/main`
3. Merge result and current branch SHA
4. Release APK path, size, timestamp, and hash match
5. macOS app rebuild status and relaunch status
6. Push status to `origin`
7. Publish retry result (whether first copy succeeded or second attempt was needed)

Also include:

- Count of upstream commits applied in this run
- Commit SHAs and subjects applied in this run
- File-change count from `git diff --name-only "$(git merge-base main upstream/main)"..upstream/main | wc -l`
- Local macOS app bundle path used for relaunch

When Step 1 found no updates, include:

1. `No upstream changes`
2. `Merge skipped`
3. `Build skipped`
4. `Publish skipped`
5. `macOS rebuild/restart skipped`
6. `Push skipped`

## 8) Install Troubleshooting (`App not installed as package appears to be invalid`)

Use this checklist when the APK is already built and published:

1. Verify the Drive APK is healthy (zip + signature + hash):

```bash
SDK_BT="$(ls -d "$HOME"/Library/Android/sdk/build-tools/* | sort -V | tail -n 1)"
APK="/Users/radoslawchybicki/Library/CloudStorage/GoogleDrive-rchybicki@gmail.com/My Drive/phone share/CodexMonitor/CodexMonitor-release.apk"
unzip -t "$APK"
"$SDK_BT/zipalign" -c -v 4 "$APK"
"$SDK_BT/apksigner" verify --verbose --print-certs "$APK"
shasum -a 256 "$APK"
```

2. Confirm ABI target is correct for Galaxy Fold 7: publish `aarch64` release APK only (`./scripts/build_android.sh --apk-only --target aarch64`).
3. If the app is already installed and installer still rejects: uninstall existing app first, then install the APK again.
4. If installing from desktop with `adb`, allow replace/downgrade when needed:

```bash
adb install -r -d "/path/to/CodexMonitor-release.apk"
```

Notes:

- In this repo, the release APK is debug-key signed by design (sideload flow), and that is expected.
- Re-publishing the same `versionCode` can still fail as an in-place update on some installer flows; uninstall + reinstall is the safe fallback.
