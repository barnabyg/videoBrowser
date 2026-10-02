# Domain docs

This repository uses a single-context layout.

## Before exploring the codebase

Read `CONTEXT.md` at the repository root, then relevant architectural decision records in `docs/adr/`.

If these files do not exist, proceed silently. Domain-modeling work creates them when terms or decisions are resolved.

## File structure

```text
/
├── CONTEXT.md
├── docs/adr/
│   └── 0001-<decision-slug>.md
└── src/
```

This layout describes where future documentation belongs; directories and domain documents are created when needed.

## Vocabulary

Use the terms defined in `CONTEXT.md` in issue titles, proposals, hypotheses, and test names. Follow any explicit guidance about synonyms.

If a required concept is absent, reconsider whether it belongs in the domain or note the gap for domain-modeling work.

## ADR conflicts

If a proposal contradicts an existing ADR, identify the ADR and explain why the decision should be reopened.
