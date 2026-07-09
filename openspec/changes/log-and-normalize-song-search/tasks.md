## 1. Comment corrections (no behavior change)

- [x] 1.1 Fix `src/types/spotify.ts:36-39`: `is_playable` is present only when track relinking applies, which requires a `market` parameter. Remove the false claim that "we use `from_token`" — we send no `market` at all.
- [x] 1.2 Fix `src/services/api.ts:179-183`: `SEARCH_LIMIT = 5` does not cause "the first playable result" to be chosen. State that `is_playable` is absent without `market`, so selection always resolves to `items[0]`, and that the extra four results are currently unused.
- [x] 1.3 Fix `src/services/api.ts:249-256`: the `find(is_playable !== false)` predicate never filters anything today. Say so, and reference that a real fix (send `market`, rank candidates) is deliberately deferred to a separate change.

## 2. Query normalization primitives

- [x] 2.1 Add `SEPARATOR` handling in `src/services/api.ts`: detect the word `by` (`/\bby\b/gi`) and the spaced hyphen (` - `); a split applies only when exactly one separator of one kind matches and both sides are non-empty after trimming.
- [x] 2.2 Add `hasFieldFilter(query)`: true when the query contains a recognized Spotify filter prefix (`track:`, `artist:`, `album:`, `year:`, `genre:`, `isrc:`, `upc:`, `tag:`). Such queries skip normalization entirely.
- [x] 2.3 Add `buildFilteredQuery(title, artist)`: strips `"` from each value, returns `track:"<title>" artist:"<artist>"`.
- [x] 2.4 Add `normalizeQuery(query)`: returns `{ kind: "filtered", q, title, artist }` or `{ kind: "raw", q }`, composing 2.1–2.3.
- [x] 2.5 Add `tokenize(text)`: lowercase, strip diacritics (NFD + combining-mark strip), strip punctuation, collapse whitespace, split into a token `Set`.
- [x] 2.6 Add `validateMatch(track, title, artist)`: every title token present in `tokenize(track.name)`, and every artist token present in the union of `tokenize()` over `track.artists`. Returns a verdict object carrying pass/fail and, on failure, which side missed and which tokens.

## 3. Search flow

- [x] 3.1 Extend `SpotifySearchResponse` in `src/types/spotify.ts` with `tracks.total` and `tracks.limit`.
- [x] 3.2 Change `searchTrack(query)` to `searchTrack(query, options?: { log?: boolean })`. Confirm no existing caller breaks (the trailing arg is optional).
- [x] 3.3 Extract the single-search body into an internal `runSearch(q, options)` that returns the raw response, the candidate list, and the selected candidate.
- [x] 3.4 Implement the two-attempt flow: when `normalizeQuery` yields `filtered`, run it, validate the selection; on zero results OR failed validation, run exactly one raw retry and accept its result unvalidated. When it yields `raw`, run exactly one search and do not validate. Never exceed two searches.
- [x] 3.5 Preserve existing behavior on the `parseTrackId` short-circuit: a URL/URI/bare-id request still bypasses search entirely and never normalizes.

## 4. Opt-in diagnostics

- [x] 4.1 Add a `logAttempt()` helper in `src/services/api.ts` that emits one structured record at `info` via `logger` from `src/modules.ts` — never `console`.
- [x] 4.2 Record fields: attempt kind (`filtered` | `raw`), outgoing `q`, resolved endpoint, `tracks.total`, `items.length`, full candidate list projected to `{uri, name, artists, explicit, is_playable}`, raw response body, selected candidate, validation verdict + failure reason.
- [x] 4.3 Ensure `tracks.total` and `items.length` are reported as distinct fields — the former answers "total possible matches", the latter is just the page size.
- [x] 4.4 Gate every emission on `options.log === true`; when false, the search path logs exactly what it logs today (the existing zero-results `debug` line and nothing more).
- [x] 4.5 Assert the redaction split from `design.md` D5: `logAttempt` deliberately does NOT call `redactEndpoint()`, while `spotifyFetch`'s failure-triage block still does. Leave a comment at each site explaining why they differ, so neither is "fixed" into the other later.
- [x] 4.6 Verify no diagnostic path can reach `options.headers`, the access token, the refresh token, or the client secret.

## 5. Effect wiring

- [x] 5.1 Add `enableLogging: boolean` to the `Model` interface in `src/firebot/effects/requestSongEffect.ts`.
- [x] 5.2 Add an "Enable Logging" checkbox as the last `eos-container` in `optionsTemplate`, styled like the existing "Allow explicit tracks" control, with muted help text stating it is verbose and intended for troubleshooting a wrong match.
- [x] 5.3 Seed the default in `optionsController` with the literal `false` when `$scope.effect.enableLogging === undefined`. Do NOT reference any bundled import — the controller is stringified and eval'd on the frontend (see the comment at `requestSongEffect.ts:97-101`).
- [x] 5.4 Pass `{ log: Boolean(effect.enableLogging) }` through to `searchTrack()` in `onTriggerEvent`.

## 6. Tests

- [x] 6.1 `normalizeQuery` unit tests: `by` split; spaced-hyphen split; `Blink-182` / `Jay-Z` unsplit; two `by` occurrences unsplit; no separator unsplit; empty side unsplit; quote injection stripped; existing `track:`/`artist:` filter passed through.
- [x] 6.2 `tokenize` / `validateMatch` unit tests: exact match passes; decorated name `Seven Dollars - 2024 Remaster` passes; `me` vs `Mestizo` fails (substring is not a token); diacritics normalized; multi-artist union satisfied.
- [x] 6.3 `searchTrack` integration tests with a mocked `spotifyFetch`: filtered attempt validates → exactly one call; filtered fails validation → exactly two calls, raw result returned; filtered returns zero items → exactly two calls; unsplit query → exactly one call, no validation; both attempts empty → `undefined`.
- [x] 6.4 Logging tests: `log: false` emits no `info` records; `log: true` emits one record for a validated filtered search and two records on fallback; the record reports `tracks.total` and `items.length` distinctly; no record contains a token or secret.
- [x] 6.5 `requestSongEffect` test: `enableLogging` defaults off and is threaded into `searchTrack` as `{ log: ... }`.
- [x] 6.6 Regression: the `parseTrackId` short-circuit path issues no search and logs nothing new.

## 7. Ship

- [x] 7.1 Run `pnpm lint`, `pnpm test`, and the typecheck/build to confirm the bundle still builds as a single CommonJS file.
- [x] 7.2 Add a changeset in `.changeset/` (patch or minor — new opt-in effect option plus a search-quality change; minor is appropriate). Do NOT run `pnpm changeset version`.
- [x] 7.3 Commit with `git commit -S` (GPG-signed, per `CLAUDE.md`).
