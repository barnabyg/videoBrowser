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

Technology choices, measurements and follow-up limits are in [ticket 01 evidence](docs/ticket-01-evidence.md). Bundled licenses and the private-distribution boundary are documented in [dependencies](docs/dependencies.md).
