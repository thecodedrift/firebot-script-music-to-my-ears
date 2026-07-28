## 1. Implementation

- [x] 1.1 Add an exported `stripCommandPrefix(query)` to `src/services/api.ts` implementing the shape rule: first token only, letter required after the `!`, abandoned when nothing would remain
- [x] 1.2 Apply it at the top of `searchTrack`, above `parseTrackId`, and log the removal at `debug`

## 2. Tests

- [x] 2.1 Unit-test `stripCommandPrefix`: `!sr`-prefixed queries stripped, mid-query `!` untouched, `!!!` untouched, trigger-only query untouched
- [x] 2.2 Cover the search path in `src/services/api.test.ts`: a `!sr`-prefixed query issues `track:"…"` without the trigger, and a `!sr`-prefixed track link resolves by direct lookup with no search

## 3. Docs and release

- [x] 3.1 Note in `README.md` that a leaked command trigger is handled, so `$arg[all]` is safe to wire straight in
- [x] 3.2 Add a `patch` changeset
- [x] 3.3 Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm openspec validate strip-leaked-command-prefix --strict`
- [x] 3.4 Sync the delta spec into `openspec/specs/` and archive the change
