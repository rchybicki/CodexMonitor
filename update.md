# Fork Update Process

This process updates your fork from `upstream/main`, then publishes a new release APK only when upstream changed.

Release destination (release APK only):

`/Users/radoslawchybicki/Library/CloudStorage/GoogleDrive-rchybicki@gmail.com/My Drive/phone share/CodexMonitor/CodexMonitor-release.apk`

Do not publish debug APKs, universal debug APKs, or AAB artifacts to Google Drive.

## Remote Model

- `origin` = your fork (push target)
- `upstream` = main project repo (read-only source for merges)
- Never push to `upstream`.

## 1) Review Upstream and Decide

Fetch and list upstream commits not yet in your branch:

```bash
git checkout android
git fetch upstream --prune
git log --oneline --decorate --no-merges android..upstream/main
```

Also list upstream-only affected files (from merge-base to upstream):

```bash
MB="$(git merge-base android upstream/main)"
git diff --name-only "$MB"..upstream/main
```

Record these two outputs in your run summary every time.

No-op rule:

- If `HEAD..upstream/main` is empty, stop.
- If `android..upstream/main` is empty, stop.
- Do not merge.
- Do not build APK.
- Do not publish to Google Drive.
- Do not push to `origin/android`.

Optional shell gate:

```bash
UPSTREAM_CHANGES="$(git log --oneline --no-merges android..upstream/main)"
if [ -z "$UPSTREAM_CHANGES" ]; then
  echo "No upstream changes. Merge/build/publish skipped."
  exit 0
fi
```

## 2) Merge Upstream Into Your Branch (Only If Step 1 Has Changes)

Use your Android branch (`android`) and merge (no rebase):

```bash
git checkout android
git merge --no-ff upstream/main
```

If the merge has conflicts, resolve them before continuing.

## 3) Build Android Release APK (Only If Step 1 Has Changes)

```bash
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

## 5) Summarize Changes (Always Required)

When Step 1 found updates, include (using the Step 1 outputs captured before merge):

1. Full upstream commit list from `git log android..upstream/main`
2. Upstream changed files from `git diff --name-only "$(git merge-base android upstream/main)"..upstream/main`
3. Merge result and current branch SHA
4. Release APK path, size, timestamp, and hash match
5. Push status to `origin`
6. Publish retry result (whether first copy succeeded or second attempt was needed)

Also include:

- Count of upstream commits applied in this run
- Commit SHAs and subjects applied in this run
- File-change count from `git diff --name-only "$(git merge-base android upstream/main)"..upstream/main | wc -l`

When Step 1 found no updates, include:

1. `No upstream changes`
2. `Merge skipped`
3. `Build skipped`
4. `Publish skipped`
5. `Push skipped`

## 6) Push Updated Branch to Fork (Only If Step 1 Has Changes)

After merge:

```bash
git push origin android
```

This updates only your fork branch and keeps `upstream` read-only.

## 7) Install Troubleshooting (`App not installed as package appears to be invalid`)

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
