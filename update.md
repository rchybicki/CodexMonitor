# Fork Update Process

This process updates your fork from `upstream/main`, then publishes a new release APK only when upstream changed.

Release destination (release APK only):

`/Users/radoslawchybicki/Library/CloudStorage/GoogleDrive-rchybicki@gmail.com/My Drive/phone share/CodexMonitor/CodexMonitor-release.apk`

Do not publish debug APKs, universal debug APKs, or AAB artifacts to Google Drive.

## Remote Model

- `origin` = your fork (push target)
- `upstream` = main project repo (read-only source for rebases)
- Never push to `upstream`.

## 1) Review Upstream and Decide

Fetch and list upstream commits not yet in your branch:

```bash
git fetch upstream --prune
git log --oneline --decorate --no-merges HEAD..upstream/main
```

Also list upstream-only affected files (from merge-base to upstream):

```bash
git diff --name-only "$(git merge-base HEAD upstream/main)"..upstream/main
```

Record these two outputs in your run summary every time.

No-op rule:

- If `HEAD..upstream/main` is empty, stop.
- Do not rebase.
- Do not build APK.
- Do not publish to Google Drive.
- Do not push to `origin/android`.

Optional shell gate:

```bash
UPSTREAM_CHANGES="$(git log --oneline --no-merges HEAD..upstream/main)"
if [ -z "$UPSTREAM_CHANGES" ]; then
  echo "No upstream changes. Rebase/build/publish skipped."
  exit 0
fi
```

## 2) Rebase Your Branch (Only If Step 1 Has Changes)

Use your Android branch (`android`):

```bash
git checkout android
git stash push -u -m "pre-rebase-local-state"
git rebase upstream/main
git stash pop
```

If `git stash pop` has conflicts, resolve them before continuing.

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

Then copy only the release APK:

```bash
cp -f "src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk" \
  "/Users/radoslawchybicki/Library/CloudStorage/GoogleDrive-rchybicki@gmail.com/My Drive/phone share/CodexMonitor/CodexMonitor-release.apk"
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

## 5) Summarize Changes (Always Required)

When Step 1 found updates, include:

1. Full upstream commit list from `git log HEAD..upstream/main`
2. Upstream changed files from `git diff --name-only "$(git merge-base HEAD upstream/main)"..upstream/main`
3. Rebase result and current branch SHA
4. Release APK path, size, timestamp, and hash match
5. Push status to `origin`

Also include:

- Count of upstream commits applied in this run
- Commit SHAs and subjects applied in this run
- File-change count from `git diff --name-only "$(git merge-base HEAD upstream/main)"..upstream/main | wc -l`

When Step 1 found no updates, include:

1. `No upstream changes`
2. `Rebase skipped`
3. `Build skipped`
4. `Publish skipped`
5. `Push skipped`

## 6) Push Updated Branch to Fork (Only If Step 1 Has Changes)

After rebase:

```bash
git push --force-with-lease origin android
```

This updates only your fork branch and keeps `upstream` read-only.
