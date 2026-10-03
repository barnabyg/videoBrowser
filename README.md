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
- **Removable drives:** browsing a USB drive uses the same enumeration as an internal disk. Physical USB selection, disconnection and reconnection remain manual checks; recovery is covered by issue #10.

Technology choices, measurements and follow-up limits are in [ticket 01 evidence](docs/ticket-01-evidence.md). Bundled licenses and the private-distribution boundary are documented in [dependencies](docs/dependencies.md).
