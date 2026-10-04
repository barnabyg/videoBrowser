# Video Browser

A personal, offline Windows 11 desktop application. Choose a folder, recognise source videos by their thumbnails, and open one in the Windows default player. The supported target is **Windows 11 x64**.

## Status

Version 0.1.0 implements the whole of [spec #1](https://github.com/barnabyg/videoBrowser/issues/1); every slice ticket is closed. Removable-drive disconnection recovery ([#10](https://github.com/barnabyg/videoBrowser/issues/10)) was dropped from scope. Some manual checks are still pending, and some limits are known; see [Known limits](#known-limits).

## Requirements

- **Development:** Windows x64, Node.js **24.13.0**, and internet access for the first `npm.cmd ci` and `npm.cmd run tools`.
- **Desktop tests:** an interactive Windows desktop. See [Testing](#testing).
- **Using a built package:** Windows 11 x64, and a default player for the video types you want to play. No Node.js, SDK, FFmpeg, codec pack, account or network connection is needed.

## Running from source

```powershell
npm.cmd ci
npm.cmd run tools
npm.cmd run build
npm.cmd start
```

`npm.cmd run tools` downloads the pinned FFmpeg 9.0.2 essentials build from gyan.dev and checks its SHA-256 before extracting `ffmpeg.exe` and `ffprobe.exe` into `.tools/ffmpeg`. The archive is cached in `.cache`, so later runs do not download it again. `npm.cmd start` runs Electron on the compiled `build/` folder, so run `npm.cmd run build` again after changing `src/`.

## Building a distributable

The distributable is an unzip-and-run folder, also zipped. There is no installer.

1. One-time setup, as above:

   ```powershell
   npm.cmd ci
   npm.cmd run tools
   ```

2. Build the package:

   ```powershell
   npm.cmd run package
   ```

   This compiles `src/` into `build/`, then runs [`scripts/package.mjs`](scripts/package.mjs). The script deletes and recreates `dist/VideoBrowser-win32-x64/`, then zips it to `dist/VideoBrowser-win32-x64.zip` (about 240 MB).

3. Optionally, test the zip itself:

   ```powershell
   npm.cmd run test:package
   ```

   This extracts the zip into `.verify` and drives its own `VideoBrowser.exe` through the complete workflow, using only Windows' own `PATH` and fresh, empty `%LOCALAPPDATA%` and `%APPDATA%` folders. The app must save nothing in them; only the empty folder Windows itself creates when it opens a video in the default player is allowed. It needs an interactive desktop. `npm.cmd run verify` runs packaging and this test as its last stage, after every other check. Use it for a build you intend to hand over.

The package contains:

| Path                                       | Contents                                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `VideoBrowser.exe` and the files beside it | Electron 44.5.1 runtime, with `electron.exe` renamed; `LICENSE`, `LICENSES.chromium.html` |
| `resources/app`                            | `package.json` and the compiled `build/` folder only                                      |
| `resources/tools`                          | `ffmpeg.exe` and `ffprobe.exe`                                                            |
| `licenses/ffmpeg`                          | The FFmpeg build's `LICENSE` and `README.txt`                                             |
| `README.md`                                | The user guide, from [`docs/package-readme.md`](docs/package-readme.md)                   |
| `THIRD-PARTY-NOTICES.md`                   | The dependency and licence review, from [`docs/dependencies.md`](docs/dependencies.md)    |

**To use it:**

1. Copy the zip to a Windows 11 x64 machine.
2. Extract the whole archive to a local folder.
3. Run `VideoBrowser-win32-x64\VideoBrowser.exe`.

The app is portable. Preferences, stored thumbnails and Electron's own session data go to a `data` folder beside `VideoBrowser.exe`, created on first run, and nowhere else. Copying the application folder keeps them, and deleting it removes them. To reset the app, delete `data` while the app is closed. If the application folder is read-only, the app still browses, keeps preferences and thumbnails in memory only, and says so. Earlier versions used `%LOCALAPPDATA%\video-browser`; that data is not imported, and the old folder can be deleted.

In development, `npm.cmd start` keeps its data in the checkout's git-ignored `.state` folder. Tests set `VIDEO_BROWSER_STATE` to a disposable folder instead. Implemented in [`src/storage.ts`](src/storage.ts).

The bundled FFmpeg is a GPLv3 build. The package is for private use. Before distributing it any further, read [dependencies](docs/dependencies.md).

## Verification

`npm.cmd run verify` is the canonical check. Run `npm.cmd run tools` first. It runs these stages in order and stops at the first failure:

1. formatting (check only);
2. lint, with no warnings allowed;
3. type checks of the application and the tests;
4. type-aware static analysis;
5. the dashboard tests and the full desktop test suite;
6. `npm audit` and the dependency, lockfile and credential-pattern checks;
7. packaging and the package tests.

Verification writes only generated build output and evidence. It never formats or edits source.

When run interactively, verification serves a localhost dashboard, normally <http://127.0.0.1:4179>, and prints `TEST_DASHBOARD_URL`. If that port is taken, it picks a free one. The dashboard shows the stage, test progress, elapsed time, recent output and the final result. It stays available for 15 seconds after completion and saves `.verify/verification.json`. To run headless, use `npm.cmd run verify -- --no-dashboard`. If the dashboard fails, terminal output and the exit status are unaffected. CI ([`.github/workflows/verify.yml`](.github/workflows/verify.yml)) runs the same command headless on a Windows runner for every push and pull request.

## Testing

Focused commands:

- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run test:dashboard`
- `npm.cmd test`: builds, then runs every Playwright test except the package tests.
- `npm.cmd test -- tests/sort.spec.ts` or `npm.cmd test -- --grep "single click"`: runs one file or matching tests.

Most tests drive the real Electron window with Playwright, real generated media and the real FFmpeg tools. Some run on their own: the store, reconcile, queue and sort tests. Supporting programs in `tests/` stand in for situations that are hard to produce on demand. [`player-observer.cjs`](tests/player-observer.cjs) is a controlled default player. [`stalled-probe.mjs`](tests/stalled-probe.mjs) never finishes. [`counting-probe.mjs`](tests/counting-probe.mjs) counts probes.

Desktop tests need:

- an interactive Windows desktop;
- permission to create and delete uniquely named file associations under `HKCU\Software\Classes`, pointing to the controlled player. Normal video associations are untouched.
- permission to deny and restore read access on their own fixture files with `icacls`.

Run them as the host user when an agent sandbox blocks desktop or registry access. On a restricted workspace ACL, Electron may need read/execute access for ALL APPLICATION PACKAGES on its runtime folder; do not disable Electron's sandbox.

## Project layout

```text
src/
├── main.ts            # Electron main process: window, IPC, selected folder, extraction scheduling
├── preload.ts         # the window's restricted bridge to the main process
├── renderer.ts        # grid, controls, keyboard and screen-reader behaviour
├── index.html, style.css
├── contract.ts        # types shared across the IPC boundary
├── folder.ts          # lists the source videos directly in a folder
├── sort.ts            # natural filename and modification-date order
├── thumbnail.ts       # ffprobe/ffmpeg extraction with a 30-second budget
├── process-worker.ts  # starts tool processes off the main thread
├── queue.ts           # visible-first, bounded extraction queue
├── cache.ts           # stored thumbnails: reuse, 1 GB LRU limit, clearing
├── reconcile.ts       # matches a refreshed listing to the entries shown
├── preferences.ts     # last folder, thumbnail size and sort order
├── replace.ts         # whole-file replacement, retried while a file is held
└── association.ts     # checks the Windows default application before launch
scripts/               # tools download, packaging, verification and dashboard
tests/                 # Playwright desktop and focused tests, test helpers
docs/                  # ADR, dependency review, user guide, ticket evidence
```

These folders are generated and ignored by git:

- `build/`: compiled application;
- `dist/`: package;
- `.tools/`: FFmpeg;
- `.cache/`: downloads, Electron and the npm cache;
- `.verify/`: test fixtures and evidence;
- `test-results/`.

The vocabulary (source video, selected folder, thumbnail, placeholder, preferences) is defined in [`CONTEXT.md`](CONTEXT.md). Thumbnail extraction and playback are deliberately independent; see [ADR 0001](docs/adr/0001-separate-thumbnails-from-playback.md).

## Behaviour

### Folders and launch

- **Scope:** only files directly in the selected folder with a recognised extension are listed: `.mp4`, `.m4v`, `.mkv`, `.webm`, `.mov`, `.avi`, `.wmv`, `.mpg`, `.mpeg`, `.ts`, `.mts`, `.m2ts`, `.3gp` and `.h264`, matched without regard to case. Subfolders are not scanned. UNC network paths (`\\server\share`) are rejected. A network drive mapped to a drive letter cannot be told apart from a local drive without extra system calls, so it is not rejected. A listed extension does not guarantee a thumbnail or playback.
- **Folder messages:** each of these gets its own message:
  - an empty folder;
  - a folder without recognised videos;
  - a missing folder, including one on a disconnected USB drive;
  - a file instead of a folder;
  - denied access;
  - a network path;
  - a relative path.

  The folder controls stay at the top and only the grid scrolls.

- **Launch:** a click on a thumbnail or filename, or Enter on the focused entry, opens the source video through Windows. The browser stays open at the same position.

  Windows' `ShellExecute` reports success even when no application is associated with an extension, and shows its own "Open with" prompt instead. So before delegating, the app checks the default application through `reg.exe`, in this order:
  1. `UserChoiceLatest`;
  2. `UserChoice`;
  3. `HKCR\<ext>`;
  4. the ProgID's packaged application, `DelegateExecute` or verb commands.

  A missing source, an absent association and a broken association each produce a clear error. Unclear registrations still attempt the launch. A path that `reg.exe` prints with non-ASCII characters cannot be checked reliably, so it is treated as usable.

- **Removable drives:** a USB drive is browsed like an internal disk. If its drive is disconnected, Refresh explains that the folder cannot be found. After you reconnect it, Refresh lists it again. Keeping the grid visible while the drive is away is not supported.

### Thumbnails and durations

Implemented in [`src/thumbnail.ts`](src/thumbnail.ts):

- **Positions:** ffprobe reads the duration.
  - When the duration is finite and positive, ffmpeg tries 10%, then 50%, then the first frame.
  - Without a reliable duration, it tries the first frame without seeking, then 1 s, then 5 s, and the duration label is omitted.

  The first still that is not dark (32×32 mean brightness of at least 12/255) is used. If every still is dark, the last one is kept with an explanation.

- **Budget:** each started job has one 30-second elapsed budget. It covers the readability check, probing and all fallback attempts; time queued behind other entries does not count. When the budget runs out or the folder changes, the running process is terminated.

  Two jobs run at a time. Each runs in a separate process with one decoder thread and an 8 MiB output cap. Closing the window terminates them.

- **Failures:** the entry keeps a placeholder and its playback action, with a reason. There is a distinct reason for each of:
  - an unreadable file;
  - a file with no video stream;
  - an unrecognised or damaged file;
  - a recognised video that cannot be decoded;
  - a timeout.

  No dialogs are shown, and other entries carry on. A reliable duration is still shown when no still can be decoded.

- **Offline and read-only:** the tools accept only the `file` and `pipe` protocols, and they only read the source.
- **Tested matrix:** all generated media.

  | Container / codec   | Inputs                                                                             |
  | ------------------- | ---------------------------------------------------------------------------------- |
  | MP4 / H.264         | landscape, portrait, 64×36, one-frame 4K, 0.2-second, and a clip that starts black |
  | AVI / MPEG-4 Part 2 | two hours                                                                          |
  | WebM / VP9          | two seconds                                                                        |
  | MKV / HEVC          | two seconds                                                                        |
  | Raw Annex-B H.264   | no duration                                                                        |

  The other recognised containers are listed but untested.

### Large folders

- **Grid first:** filenames and placeholders appear without waiting for probing or extraction. Every entry stays in the grid, so keyboard and screen-reader access are unchanged.
- **Visible first:** entries within one viewport height of the visible area are extracted first, starting nearest the middle of the view. This is recalculated after each scroll ([`src/queue.ts`](src/queue.ts)). The remaining entries follow in folder order. Changing folder discards queued work and terminates running jobs, and results from earlier folders are never shown.
- **Bounded resources:** stills are loaded through a private `thumbnail://` scheme that serves only the selected folder's stills. Only entries near the viewport hold an image or receive result updates.
- **Responsive window:** ffprobe and ffmpeg are started from a worker thread ([`src/process-worker.ts`](src/process-worker.ts)). Starting Windows processes on Electron's main thread, which also runs the window, made scrolling and clicks stall.

### Size, names and keyboard

- **Size:** the **Thumbnail size** slider sets the entry width from 160 to 640 logical pixels in 40-pixel steps, starting at 320. Changing the size never re-extracts a thumbnail. The current entry, or otherwise the topmost visible one, keeps its place on screen.
- **Fit and alignment:** every entry has a 4:3 frame, two filename lines and one detail line, so rows stay aligned. Stills use `object-fit: contain`, so portrait and landscape images are shown whole.
- **Long text:** a long filename or reason is shortened in place. Hovering over or focusing the entry shows it in full over the entries below. Accessible names always contain the full filename.
- **Keyboard:** Tab moves through:
  1. the folder field and its buttons;
  2. the size slider and the sort controls;
  3. the grid, as a single stop.

  Inside the grid, the arrow keys, Home and End move focus without launching. Enter or Space opens the focused entry. Every control shows a visible focus outline.

- **Screen readers:** each entry is described as loading, by its spoken duration (for example "Duration 1 minute 5 seconds"), or by its failure reason.

### Sorting and preferences

- **Sorting:** **Sort by** offers Filename or Date modified, and **Order** sets the direction.
  - Filename order is natural (video2 before video10), ignores case and accents, and starts ascending.
  - Equal dates fall back to ascending filename order in both directions.
  - A source whose date cannot be read sorts as the oldest.
  - Names that compare equal (video1 and video01, cafe and café) fall back to code-unit order, so the order is always the same.

  Re-sorting moves the existing entries without re-extracting them.

- **Preferences:** the last selected folder that could be listed, the thumbnail size and the sort order are saved to `preferences.json` in the data folder. A missing or damaged file, or an invalid value, falls back to the initial choice for that value. Pending changes are saved before the app quits.
- **Startup:** a fresh profile starts at 320 pixels, sorted by filename ascending, and asks for a folder. Later launches restore the size and sort order and reopen the saved folder. If that folder is unavailable, the status explains why and focus moves to **Choose folder…**.

### Stored thumbnails, Refresh and Clear cache

Implemented in [`src/cache.ts`](src/cache.ts) and [`src/reconcile.ts`](src/reconcile.ts):

- **Storage:** each generated still, with its duration and any dark-frame note, is stored in `thumbnails` in the data folder. Revisiting a folder, also after restarting, shows stored thumbnails without extracting unchanged source videos again. Failures are not stored, so they are tried again on the next visit.
- **Source identity:** a stored thumbnail is reused only while its source keeps the same path (ignoring case), size and modification time. A record also names the generation recipe and the cache format; a thumbnail made another way, a damaged record or a missing still is never reused.

  Each file is written to a temporary file and renamed into place, with the record written last ([`src/replace.ts`](src/replace.ts)). If another program, such as a virus scanner, briefly holds the target open, the rename is retried for about three seconds.

  A source replaced by different content with the same path, size and modification time keeps its old thumbnail until **Clear cache**.

- **Refresh:** lists the selected folder again. Unchanged entries keep their place and thumbnails, and the browsing position is kept. Added, changed and previously failed entries are extracted, visible ones first. The status reports how many were added, removed and changed, or why the folder can no longer be listed.
- **Races:** Refresh and folder changes stop earlier extraction, and replaced entries get new ids, so no earlier result reaches a current entry. A source that changes while its thumbnail is being made gets no thumbnail; its entry explains this and suggests Refresh.
- **Storage limit:** the store is bounded at 1 GB (1024³ bytes). When it goes over, the least recently used thumbnails are removed. Showing a stored thumbnail makes it the most recently used, and recency survives restarts. The folder being shown keeps its thumbnails, so storage may exceed the limit until another folder is opened.
- **Clear cache:** removes every stored thumbnail and makes the selected folder's thumbnails again, visible ones first. Preferences and source videos are untouched. Extraction under way is stopped first, so nothing made before clearing is stored afterwards.

## Known limits

- **Pending manual checks:** a clean Windows 11 machine, a real default player, Narrator, Windows display scaling, thumbnail comfort with real footage and a real USB drive. Procedures and results go in [ticket 11 evidence](docs/ticket-11-evidence.md).
- **Very large folders:** with Windows accessibility processing active, for example with a screen reader running, each change to a 10,000-entry grid blocks the window for several seconds. The 1,000-entry grid appears in about 0.2 s on a local SSD, against a 2-second target.
- **Untested:** most recognised containers, real-world footage, network storage and ARM64 Windows.
- **Out of scope:** an installer, Start-menu integration, public distribution, updates, subfolder and network browsing, and embedded playback.

## Further documents

- [Ticket 01 evidence](docs/ticket-01-evidence.md): technology choices and the first slice.
- [Ticket 05 evidence](docs/ticket-05-evidence.md): large-folder measurements and investigation.
- [Ticket 06 evidence](docs/ticket-06-evidence.md): size, keyboard and display-scaling checks.
- [Ticket 11 evidence](docs/ticket-11-evidence.md): package verification, clean-checkout reproduction, measurements and manual checks.
- [Dependencies](docs/dependencies.md): bundled licences and the private-distribution boundary.
- [Package user guide](docs/package-readme.md): the `README.md` shipped in the zip.
