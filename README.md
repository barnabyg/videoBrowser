# Video Browser

The first runnable Windows desktop slice implements [ticket 01 / issue #2](https://github.com/barnabyg/videoBrowser/issues/2): select a folder, recognise a real thumbnail, then open the source video in its Windows default application.

Development requires Windows x64 and Node.js **24.13.0**. From a clean checkout:

```powershell
npm.cmd ci
npm.cmd run tools
npm.cmd run build
npm.cmd start
```

Dependency/tool setup requires internet access. The application works locally offline after packaging. Run `npm.cmd run package` to produce `dist/VideoBrowser-win32-x64.zip`; extract the complete archive and run `VideoBrowser.exe`. Runtime and thumbnail tools are included.

The canonical verification command is `npm.cmd run verify`. It checks formatting, lint/style, compilation/types, static bug analysis, automated tests, dependency/secret/package checks, then packaging and the extracted-package desktop smoke test. Run `npm.cmd run tools` first. Verification writes only generated evidence/build outputs and never formats or edits source.

Interactive verification automatically serves a localhost dashboard, normally <http://127.0.0.1:4179>, and prints `TEST_DASHBOARD_URL`. Concurrent runs select a free port. It shows stage, test progress, elapsed time, recent output and final result; it remains available for 15 seconds after completion and saves `.verify/verification.json`. Use `npm.cmd run verify -- --no-dashboard` to opt out. CI is headless. Reporting/server/display failures preserve terminal output and verification exit status. Playwright's lifecycle reporter supplies test events.

Focused checks: `npm.cmd run typecheck`, `npm.cmd run test:dashboard`, or `npm.cmd test -- --grep "single click"` (Playwright can also be invoked directly through its `.cmd` shim). Desktop tests need an interactive Windows desktop and permission to create/delete uniquely named fixture associations under HKCU; normal video associations are untouched. Run them under the host user when an agent sandbox blocks desktop/registry access. On a restricted workspace ACL, Electron may require read/execute access for ALL APPLICATION PACKAGES on its generated runtime directory; do not disable Electron's sandbox.

Desktop tests also deny and then restore read access on their own generated fixture files and folders with `icacls`, to exercise unreadable sources and inaccessible folders.

## Browsing and launch behaviour

[Issue #3](https://github.com/barnabyg/videoBrowser/issues/3) extends the first slice to reliable folder browsing:

- **Scope:** only files directly in the selected folder with an allowlisted video extension are listed. Subfolders are not scanned. UNC network paths (`\\server\share`) are rejected. A network drive mapped to a drive letter cannot be told apart from a local drive without extra system calls, so it is not rejected.
- **Folder messages:** empty folders, folders without recognised videos, missing folders (including a disconnected USB drive), files, denied access, network paths and relative paths each get a distinct message. The folder controls stay at the top and only the grid scrolls.
- **Launch:** Windows' `ShellExecute` reports success and shows its own "Open with" prompt when no application is associated with an extension. Before delegating, the app therefore checks the default application through `reg.exe`: `UserChoiceLatest`, then `UserChoice`, then `HKCR\<ext>`, then the ProgID's packaged application, `DelegateExecute` or verb commands. A missing source, an absent association and a broken association (its program no longer exists) each produce a clear error. Unclear registrations still attempt the launch. A path that `reg.exe` prints with non-ASCII characters cannot be checked reliably, so it is treated as usable.
- **Removable drives:** browsing a USB drive uses the same enumeration as an internal disk. Recovering browsing context when a drive disconnects during a session is out of scope; select the folder again after reconnecting.

## Thumbnails and durations

[Issue #4](https://github.com/barnabyg/videoBrowser/issues/4) defines automatic thumbnails ([`src/thumbnail.ts`](src/thumbnail.ts)):

- **Positions:** ffprobe reads the duration. When it is finite and positive, ffmpeg tries 10%, 50%, then the first frame. Without a reliable duration it tries the first frame without seeking, then 1 s and 5 s, and the duration label is omitted. The first still that is not dark (32×32 mean brightness of at least 12/255) is used; if every still is dark, the last one is kept with an explanation.
- **Budget:** each started job has one 30-second elapsed budget covering the readability check, probing and all fallback attempts; time queued behind other entries does not count. When the budget expires or the folder changes, the running ffprobe/ffmpeg process is terminated. Two jobs run at a time, each in separate processes with one decoder thread and an 8 MiB output cap. Closing the window terminates them.
- **Failures:** each entry keeps a placeholder and its playback action, with an explanation for an unreadable file, a file with no video stream, an unrecognised or damaged file, a recognised video that cannot be decoded, and a timeout. No dialogs are shown, and other entries continue. A reliable duration is still shown when no still can be decoded.
- **Offline and read-only:** the tools accept only the `file` and `pipe` protocols and only read the source. Stills go to the application's own storage, never beside source videos.
- **Tested matrix:** generated MP4/H.264 (landscape, portrait, 64×36, one-frame 4K, 0.2-second), AVI/MPEG-4 Part 2 (two hours), WebM/VP9, MKV/HEVC, raw Annex-B H.264 without duration, and a clip that starts black. Other allowlisted containers are listed but untested. Desktop tests in [`tests/thumbnail.spec.ts`](tests/thumbnail.spec.ts) use real generated media. A controlled stalled probe, [`tests/stalled-probe.mjs`](tests/stalled-probe.mjs), exercises the timeout and folder-change cancellation.

## Large folders

[Issue #5](https://github.com/barnabyg/videoBrowser/issues/5) keeps browsing responsive with thousands of source videos:

- **Grid first:** the grid of filenames and placeholders appears without waiting for probing or extraction. Every entry stays in the grid, so keyboard and screen-reader access are unchanged.
- **Visible first:** entries within one viewport height of the visible area are extracted first, nearest the middle of the view first, and again after each scroll ([`src/queue.ts`](src/queue.ts)). Remaining entries follow in folder order. Changing folder discards queued work and terminates running jobs; results from earlier folders are never shown.
- **Bounded resources:** at most two extraction jobs run at once. Stills are stored under the application's thumbnail folder and loaded through a private `thumbnail://` scheme, which serves only the selected folder's stills. Only entries near the viewport hold an image or receive result updates, so decoded images stay bounded and offscreen results do not re-lay out a large grid; scrolling back shows stored results.
- **Responsive window:** ffprobe/ffmpeg are started from a worker thread ([`src/process-worker.ts`](src/process-worker.ts)). In Electron the main process also runs the window, and starting Windows processes there stalled scrolling and clicks. Termination stays immediate on the main thread.
- **Workloads:** [`tests/scale.spec.ts`](tests/scale.spec.ts) generates 1,000-entry acceptance and 10,000-entry stress folders of playable copies and writes timing evidence. Format coverage comes from the varied set in [`tests/thumbnail.spec.ts`](tests/thumbnail.spec.ts), not from the copies.

## Thumbnail size, names and keyboard

[Issue #6](https://github.com/barnabyg/videoBrowser/issues/6) makes the grid adjustable and usable without a mouse ([`src/renderer.ts`](src/renderer.ts), [`src/style.css`](src/style.css)):

- **Size:** the **Thumbnail size** slider beside the folder controls sets the entry width from 160 to 640 logical pixels in 40-pixel steps, starting at 320. Stills are already extracted at up to 640 pixels, so a size change is a style change: nothing is re-extracted. The current entry, or otherwise the topmost visible one, keeps its place on screen. The size is not yet remembered between sessions; issue #7 adds preferences.
- **Fit and alignment:** every entry has a 4:3 frame, two filename lines and one detail line, so rows stay aligned. Stills use `object-fit: contain`, so portrait and landscape images are shown whole.
- **Long text:** a filename longer than two lines, or a reason longer than one, is shortened in place. Hovering over or focusing the entry shows the full filename and reason over the entries below without moving them. Keyboard focus also scrolls that text into view. Accessible names always contain the full filename.
- **Keyboard:** Tab reaches the folder field, its buttons, the size slider and then the grid as a single stop. Inside the grid, the arrow keys, Home and End move focus without launching. Enter or Space opens the focused entry through the same path as a click. Every control shows a visible focus outline.
- **Screen readers:** each entry is described as loading, by its spoken duration (for example "Duration 1 minute 5 seconds"), or by its failure reason. The visible duration uses `m:ss` or `h:mm:ss`.

Manual checks and their results are in [ticket 06 evidence](docs/ticket-06-evidence.md).

Measurements and the investigation log are in [ticket 05 evidence](docs/ticket-05-evidence.md). Technology choices, measurements and follow-up limits of the first slice are in [ticket 01 evidence](docs/ticket-01-evidence.md). Bundled licenses and the private-distribution boundary are documented in [dependencies](docs/dependencies.md).
