# Ticket 11: unzip-and-run package and integrated workflow

Implements [issue #11](https://github.com/barnabyg/videoBrowser/issues/11) of [spec #1](https://github.com/barnabyg/videoBrowser/issues/1). It verifies the package and the workflow across the earlier slices; it adds no new browsing features.

## Building and running

The supported target is **Windows 11 x64**. Development needs Windows x64, Node.js 24.13.0 and internet access for the first setup. From a clean checkout:

```powershell
npm.cmd ci
npm.cmd run tools
npm.cmd run verify
```

`npm.cmd run tools` downloads the pinned FFmpeg 9.0.2 essentials build and checks its SHA-256. `npm.cmd run verify` runs every gate, including `npm.cmd run package`, which writes `dist/VideoBrowser-win32-x64.zip`. To use the package, extract the whole zip to a local folder and double-click `VideoBrowser-win32-x64\VideoBrowser.exe`.

The zip contains:

| Path                                       | Contents                                                                                      |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `VideoBrowser.exe` and the files beside it | Electron 44.5.1 runtime (renamed `electron.exe`), with `LICENSE` and `LICENSES.chromium.html` |
| `resources/app`                            | `package.json` and the compiled `build` folder only                                           |
| `resources/tools`                          | `ffmpeg.exe` and `ffprobe.exe`                                                                |
| `licenses/ffmpeg`                          | The FFmpeg build's `LICENSE` and `README.txt`                                                 |
| `README.md`, `THIRD-PARTY-NOTICES.md`      | The [user guide](package-readme.md) and the [dependency review](dependencies.md)              |

Preferences and stored thumbnails are kept in `%LOCALAPPDATA%\video-browser`. Nothing is written beside the application or the source videos.

### Clean-checkout reproduction

On 3 October 2026, commit d383d26 was cloned with `git clone --no-hardlinks` into a new folder outside the working copy, so no ignored, generated or untracked files came with it. In that folder, `npm.cmd ci` installed 114 packages, with no vulnerabilities found. `npm.cmd run tools` downloaded the FFmpeg archive from gyan.dev and verified its checksum. `npm.cmd run verify -- --no-dashboard` then passed every gate. That covered 67 tests, the dependency checks, packaging a 240,584,021-byte `dist/VideoBrowser-win32-x64.zip`, and 3 package tests. The 1,000-entry grid appeared in 154 ms and the 10,000-entry grid in 1,098 ms. Afterwards, `git status` showed no changes to tracked files. The repository's `.npmrc` keeps npm's cache in the checkout's own `.cache/npm`, so every package was downloaded again and checked against `package-lock.json`.

## Automated verification

Measured on 3 October 2026: Windows 11 Home 10.0.26300, AMD Ryzen 5 7600 (12 logical processors), 96 GiB RAM, Node.js 24.14.1. Fixtures and isolated application state were on C:, a Crucial P3 NVMe SSD (CT2000P3PSSD8, NTFS, fixed). This is not the machine used for tickets 01 and 05.

`npm.cmd run verify` passed with zero warnings, both headless (`--no-dashboard`) and with the live dashboard. The dashboard ran at http://127.0.0.1:4179, showed each stage and the test progress, and saved `.verify/verification.json`. It ran formatting, lint, both type checks, static analysis, the dashboard tests, all 67 desktop and focused tests, `npm audit`, the dependency and credential checks, packaging, and the 3 package tests. Every focused test from the earlier slices is kept.

### The extracted package

[`tests/package.spec.ts`](../tests/package.spec.ts) extracts the actual zip into `.verify` and starts its own `VideoBrowser.exe`:

- **Contents:** the runtime, compiled application, both tools, the user guide and the licence files are present. `resources/app` holds nothing but `package.json` and compiled `.js`, `.html` and `.css` files. The user guide covers the target, Refresh, Clear cache, the storage folder and the extension list.
- **Clean environment:** the app runs with `PATH` set to `%SystemRoot%\System32` and only the Windows variables it needs (`SystemRoot`, `windir`, `SystemDrive`, `USERPROFILE`, `APPDATA`, `TEMP`, `TMP`), and with `LOCALAPPDATA` pointing to a new, empty folder. No `VIDEO_BROWSER_STATE` override is set, so storage uses the normal location. Fixture videos are made with the package's own `ffmpeg.exe`.
- **Workflow:** in one session, with a disposable file association for a controlled player, the test:
  1. opens a folder and shows real thumbnails;
  2. explains a damaged file and still launches it;
  3. launches a playable source whose name contains `café`;
  4. changes the size and sort order with the keyboard and the mouse;
  5. reports a deleted source as no longer available when it is clicked;
  6. uses Refresh to show one added and one removed source;
  7. uses Clear cache to remove all stored thumbnails, including the deleted source's, and make the current ones again.

  After a restart, the folder, size and sort order are restored. The stored stills are shown without being written again: their names, sizes and modification times are unchanged.

- **Offline and storage:** every request from the window in both sessions used `file:`, `thumbnail:` or `data:` URLs. The main process makes no network requests of its own, and the thumbnail tools accept only the `file` and `pipe` protocols. Running with the network actually disconnected is part of the manual clean-machine check. `%LOCALAPPDATA%\video-browser` holds `preferences.json` and `thumbnails`. Every file in the package folder has the same size and modification time as before. The source folder holds only the source videos. Their bytes and modification times are the same after Refresh, Clear cache and the restart as after the last change the test made.

The earlier smoke test, which checks thumbnails, a non-ASCII filename, a launch and source bytes from the package, is kept.

## Integration regression found and fixed

The latest `main` CI run ([run 37143381037](https://github.com/barnabyg/videoBrowser/actions/runs/37143381037)) failed in `tests/cache-clear.spec.ts`. After the sort was changed to date modified and then to descending, `preferences.json` still held `ascending` five seconds later. The same commit passed on its branch.

| Hypothesis → check                                                                                                                                                                                                                                                                                  | Result                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preferences are saved by writing a temporary file and renaming it over `preferences.json`. Any failure is ignored. Windows refuses the rename (`EPERM`) while another program holds the target open without delete sharing, as virus scanners and indexers briefly do, so the later change is lost. | A new test in [`tests/preferences-store.spec.ts`](../tests/preferences-store.spec.ts) holds the file open from PowerShell for 500 ms during the second change. It failed: the file still held `ascending`. |
| → Retry the rename for about three seconds on `EPERM` or `EBUSY`, in a shared [`replaceFile`](../src/replace.ts). Thumbnail stills and records use it too.                                                                                                                                          | The new test passes. A save made while the file is held is completed once it is released.                                                                                                                  |

## Large-folder workloads

From [`tests/scale.spec.ts`](../tests/scale.spec.ts), run against the integrated tree during verification, with fresh state. Copies of one playable one-second 320×180 H.264/MP4 clip:

| Measurement                                     | 1,000 entries | 10,000 entries |
| ----------------------------------------------- | ------------- | -------------- |
| Grid of filenames and placeholders              | 192 ms        | 1,004 ms       |
| Thumbnail of the last entry after scrolling     | 605 ms        | 2,547 ms       |
| Thumbnail of the middle entry after scrolling   | 784 ms        | 2,434 ms       |
| Launch while thumbnails load                    | 407 ms        | 683 ms         |
| Three rapid folder changes to a one-video grid  | 451 ms        | 2,338 ms       |
| Reopening the large folder                      | 88 ms         | 836 ms         |
| Stills stored when the last entry's image shown | 8             | 44             |
| Images held / stills stored                     | 15 / 202      | 15 / 212       |

The 1,000-entry grid meets the two-second SSD target, and the test asserts it. The 10,000-entry workload is a stress check with no time target. Source bytes and modification times were unchanged after both runs. Earlier runs that day gave 161 ms for the 1,000-entry grid, and 995 ms and 1,059 ms for the 10,000-entry grid.

**Accessibility cost at 10,000 entries.** In two separate 10,000-entry runs, the folder change took 6.5 s and 7.1 s and the reopen 1.7 s and 4.1 s. A Chromium trace of the reopen showed 0.8 s of Blink accessibility updates in the renderer. It also showed a 2.3 s `HandleAXEvents` task on the browser main thread, which also blocks the Electron main process. Listing took 0.1 s and sorting 7 ms. Chromium's accessibility processing had been switched on partway through the session by another program on this desktop, although `app.isAccessibilitySupportEnabled()` reported `false`. Code from tickets 05 and 06 slowed the same way once it was switched on. Ticket 06 code reopened in 1.1 s, then took 4.1 s on the next reopen. So this is not a regression from later tickets. People using a screen reader would see this cost with very large folders. It is recorded as a limit; the 1,000-entry target is unaffected.

## Recognised files and tested previews

**Allowlist** ([`src/folder.ts`](../src/folder.ts)): `.mp4`, `.m4v`, `.mkv`, `.webm`, `.mov`, `.avi`, `.wmv`, `.mpg`, `.mpeg`, `.ts`, `.mts`, `.m2ts`, `.3gp`, `.h264`, case-insensitive. Only files directly inside the selected folder are listed. An extension controls listing only. It does not guarantee a thumbnail or playback.

**Tested preview matrix** (generated media, [`tests/thumbnail.spec.ts`](../tests/thumbnail.spec.ts)):

| Container / codec   | Inputs                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------- |
| MP4 / H.264         | 320×180 landscape, 180×320 portrait, 64×36, one-frame 3840×2160, 0.2 seconds, black opening |
| AVI / MPEG-4 Part 2 | 64×36, two hours                                                                            |
| WebM / VP9          | 160×90, two seconds                                                                         |
| MKV / HEVC          | 160×90, two seconds                                                                         |
| Raw H.264 (Annex B) | No duration                                                                                 |

Damaged files, files with no video stream, unreadable files and a stalled probe give placeholders with distinct reasons. `.m4v`, `.mov`, `.wmv`, `.mpg`, `.mpeg`, `.ts`, `.mts`, `.m2ts` and `.3gp` are listed but have no tested preview.

**Cache-metadata limitation:** a stored thumbnail is reused while its source keeps the same path (ignoring case), size and modification time. A file replaced by different content with the same three values keeps its old thumbnail. **Clear cache** removes every stored thumbnail and makes the current folder's thumbnails again.

## Prerequisites

- Building: Windows x64, Node.js 24.13.0, internet access for `npm.cmd ci` and `npm.cmd run tools`.
- Automated desktop tests: an interactive Windows desktop, permission to add and remove disposable file associations under `HKCU\Software\Classes`, and permission to change ACLs on the tests' own fixtures with `icacls`.
- Using the package: Windows 11 x64, a writable local folder to extract into, and a default player for the video types to be played. No Node.js, SDK, FFmpeg, codec pack, account or network connection.

## Manual checks

A person needs to do these. Record the result, date and machine in the table. The ticket 06 checks for thumbnail comfort, display scaling, screen-reader naming and recognisable content cover the same ground with the development build; they can be done once with the package instead.

| Check               | Procedure                                                                                                                                                                                                                              | Expected                                                                                                                                                                                                                                                                                   | Result  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| Clean Windows 11    | On a Windows 11 x64 machine or VM with no Node.js, developer SDK or FFmpeg installed, copy `dist/VideoBrowser-win32-x64.zip`, extract it, disconnect the network and double-click `VideoBrowser.exe`. Choose a folder of `.mp4` files. | The window opens without asking to install anything, real thumbnails appear, and `%LOCALAPPDATA%\video-browser` is created. No files appear beside the application or the videos.                                                                                                          | Pending |
| Real default player | With a real player set as the default for `.mp4` (for example Media Player), click a thumbnail, then a filename, then press Enter on a focused entry.                                                                                  | Each opens that video in the player. The browser stays open at the same scroll position.                                                                                                                                                                                                   | Pending |
| Launch errors       | Delete a listed video in File Explorer, then click it. Then choose a file type with no default application (for example rename a copy to `.3gp` on a machine with no `.3gp` handler).                                                  | A clear message names the file and the problem, with no Windows "Open with" dialog. The browser stays usable.                                                                                                                                                                              | Pending |
| Thumbnail comfort   | Open a folder of your own videos at a normal viewing distance. Try 160, 320 and 640 pixels.                                                                                                                                            | 320 is comfortable to recognise from, 160 gives an overview, 640 shows detail. Portrait videos are not cropped.                                                                                                                                                                            | Pending |
| Keyboard            | Without the mouse: Tab to **Folder path**, type a folder and press Enter; Tab to the size slider and use the arrow keys; Tab into the grid and use the arrow keys, Home and End; press Enter.                                          | Every stop shows a visible focus outline. Moving through the grid never starts playback, and Enter opens the focused video.                                                                                                                                                                | Pending |
| Screen reader       | With Narrator (Ctrl+Win+Enter) on, repeat the keyboard check.                                                                                                                                                                          | Controls are announced by their labels. Each entry is announced as "Open «full filename», button", followed by its loading state, duration or failure reason. Status messages, such as Refresh results, are read out.                                                                      | Pending |
| Display scaling     | Set **Settings › System › Display › Scale** to 100%, 150% and 200%, and restart the app each time.                                                                                                                                     | Text is crisp and readable, nothing overlaps at rest, and the grid scrolls only vertically.                                                                                                                                                                                                | Pending |
| USB drive           | Copy videos to a USB drive and open that folder. Remove the drive, select **Refresh**, reconnect it and select **Refresh** again.                                                                                                      | The folder is listed like a local folder. With the drive removed, Refresh says the folder cannot be found and suggests checking the drive. After reconnecting, Refresh lists it again with thumbnails. Keeping the grid visible while the drive is away is not promised (see Not covered). | Pending |

## Not covered

- **Not tested:**
  - a clean Windows 11 machine or VM: this host runs Windows 11 Home, which has no Windows Sandbox, so the package was tested here with a restricted environment instead;
  - a real default player (tests use a disposable association with a controlled handler);
  - Narrator and other screen readers;
  - Windows display-scale settings, as opposed to Chromium's `--force-device-scale-factor`;
  - real USB drives;
  - real-world footage and most allowlisted containers;
  - ARM64 Windows.
- **Accessibility cost:** with Chromium's accessibility processing switched on, each change to a 10,000-entry grid blocks the window for several seconds (see Large-folder workloads).
- **Measured on one machine:** two machines in all, for this ticket and ticket 05. The two-second target is not promised for other hardware, network storage or removable drives.
- **Out of scope:** an installer, Start-menu integration, public distribution and updates, network and subfolder browsing, embedded playback, and keeping browsing context when a removable drive disconnects ([#10](https://github.com/barnabyg/videoBrowser/issues/10), closed as not planned).
