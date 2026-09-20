<!--
Thanks for contributing. A maintainer reviews every PR and the team merges it
once it is green and approved. `main` is protected, so you cannot self-merge.
See CONTRIBUTING.md.
-->

## What and why

<!-- What does this change, and why? Link the issue it closes. -->

Closes #

## How I tested

<!-- Commands you ran and manual steps. For UI changes, add before/after screenshots. -->

- [ ] `npm test`
- [ ] `npm run typecheck -w @threadle/web`
- [ ] `npx tsc -p packages/shared --noEmit`
- [ ] `npm run pack:smoke` (if build or packaging changed)

## Notes for the reviewer

<!-- Anything you are unsure about, tradeoffs, or follow-ups. -->

## Checklist

- [ ] One focused change. No unrelated reformatting.
- [ ] Providers stay read-only against agent storage.
- [ ] Docs or screenshots updated if behavior or UI changed.
