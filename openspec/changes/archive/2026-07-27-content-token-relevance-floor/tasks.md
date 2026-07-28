## 1. Implementation

- [x] 1.1 Add a closed `FUNCTION_WORDS` set and an exported `contentTokens(tokens)` helper to `src/services/api.ts`
- [x] 1.2 Apply the content-token floor in `searchTrack`'s raw path, falling back to any-token overlap when the query has no content tokens

## 2. Tests

- [x] 2.1 Unit-test `contentTokens`: function words removed, pronouns kept, all-function-word input returns empty
- [x] 2.2 Cover the floor in `src/services/api.test.ts`: a candidate sharing only `the` is rejected as not-found, a candidate sharing a content token is accepted, an all-function-word query still matches on a function word, and ranking is unchanged

## 3. Docs and release

- [x] 3.1 Add a `patch` changeset
- [x] 3.2 Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm openspec validate content-token-relevance-floor --strict`
- [x] 3.3 Sync the delta spec into `openspec/specs/` and archive the change
