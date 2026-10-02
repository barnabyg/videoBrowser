# Issue tracker: GitHub

Issues and specs live in [barnabyg/videoBrowser](https://github.com/barnabyg/videoBrowser/issues).

Prefer the connected GitHub app for supported repository, issue, pull-request, comment, and label operations. Use the `gh` CLI when needed.

## CLI conventions

Run from this repository so `gh` infers the repository from `origin`; otherwise pass `--repo barnabyg/videoBrowser`. For authenticated CLI operations on native Windows, use narrowly scoped execution outside the sandbox and the host credential store.

Write multi-line issue bodies and comments to a temporary UTF-8 file and pass `--body-file`.

- **Create:** `gh issue create --title "..." --body-file <path>`.
- **Read:** `gh issue view <number> --comments`; include the issue's labels when fetching a ticket.
- **List:** `gh issue list --state open --json number,title,body,labels,comments`, with appropriate state and label filters.
- **Comment:** `gh issue comment <number> --body-file <path>`.
- **Apply or remove labels:** `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- **Close:** `gh issue close <number> --comment "..."`.

When a skill says **publish to the issue tracker**, create a GitHub issue. When it says **fetch the relevant ticket**, read the issue, its labels, and its comments.

## Pull requests as a triage surface

**PRs as a request surface: no.**

Set this flag to `yes` if external pull requests should enter the triage queue. When enabled, use the same triage roles and states with the corresponding pull-request operations.

GitHub issues and pull requests share a number space. For an ambiguous reference such as `#42`, resolve its type before acting; with the CLI, try `gh pr view 42` and fall back to `gh issue view 42`.

## Wayfinding operations

For skills that use a map and child tickets:

- **Map:** one issue labelled `wayfinder:map`, containing Notes, Decisions-so-far, and Fog.
- **Child ticket:** link it as a sub-issue when available. Otherwise add it to a task list in the map and put `Part of #<map>` at the top of its body. Use `wayfinder:<type>` labels: `research`, `prototype`, `grilling`, or `task`.
- **Blocking:** use native GitHub issue dependencies when available. Otherwise put `Blocked by: #<number>, #<number>` at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier:** take the first open, unblocked, unassigned child in map order.
- **Claim:** assign the ticket to the driving developer before starting work.
- **Resolve:** comment with the answer, close the ticket, and append a summary and link to the map's Decisions-so-far.
