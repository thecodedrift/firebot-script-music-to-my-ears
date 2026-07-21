## 1. Candidate ranking

- [ ] 1.1 Add a `selectBest(items, queryTokens)` helper in `src/services/api.ts` that scores each candidate by the count of distinct query tokens appearing in the union of its track-name tokens and its artists'-name tokens (reusing `tokenize`), and returns the highest-scoring candidate with ties broken by original order (stable). Return `undefined` when there are no items.
- [ ] 1.2 Have `runSearch` take the scoring tokens for the query it issues and select via `selectBest` instead of `items.find((item) => item.is_playable !== false)`; keep `endpoint`, `data`, and `items` on the returned `SearchAttempt` so diagnostics are unchanged.
- [ ] 1.3 In `searchTrack`, pass the parsed title+artist tokens as the scoring tokens on the filtered attempt and the raw-query tokens on the raw attempt.

## 2. Zero-overlap floor on the raw path

- [ ] 2.1 In the raw-fallback branch of `searchTrack`, reject the selected candidate when its token overlap with the raw query is zero (best-overlap candidate shares no query token), returning `undefined` so the effect reports `not-found`.
- [ ] 2.2 Confirm the filtered path is unaffected: a candidate that passes `validateMatch` already has maximal overlap, so it stays selected when it validates; keep the existing validation gate exactly as is.
- [ ] 2.3 Update the stale comments at `SEARCH_LIMIT`, `runSearch`, and the raw-fallback branch that describe selection as always `items[0]` and the raw result as "accepted without validation".

## 3. Tests

- [ ] 3.1 Add a test proving the reported bug case: a raw search returning `Tippy Toes by XG` first and `Come Play` later selects `Come Play` (higher overlap), not the first result.
- [ ] 3.2 Add a test that a raw fallback whose candidates all share no query token yields `undefined` (→ `not-found`).
- [ ] 3.3 Add a tie test: two equal-overlap raw candidates select the earlier (Spotify order preserved).
- [ ] 3.4 Add/confirm a test that when the filtered `items[0]` validates, selection and outcome are unchanged from today.
- [ ] 3.5 Review existing `api.test.ts` raw-fallback expectations and update any that assumed blind `items[0]` selection.

## 4. Verify

- [ ] 4.1 Run `pnpm test` and `pnpm build`; ensure the bundle still builds as the single CommonJS file.
- [ ] 4.2 Run `pnpm openspec validate rank-search-candidates --strict` and resolve any findings.
- [ ] 4.3 Add a changeset (`.changeset/*.md`, patch) describing the fix for the release automation.
