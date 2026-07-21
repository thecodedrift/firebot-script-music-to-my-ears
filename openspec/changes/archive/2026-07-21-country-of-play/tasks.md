## 1. Parameter

- [ ] 1.1 Add `spotifyCountryCode: string` to the `Params` interface in `src/types/params.ts` with a doc comment.
- [ ] 1.2 Add a `spotifyCountryCode` entry to `getDefaultParameters()` in `src/main.ts`: `type: "string"`, title "Country of Play", a description naming the 2-letter ISO 3166-1 alpha-2 code and that empty disables it, default `""`.

## 2. Market plumbing

- [ ] 2.1 Add a `market()` helper in `src/services/api.ts` that reads `getParams().spotifyCountryCode`, trims it, and returns the uppercased value only when it matches exactly two ASCII letters; otherwise `undefined`.
- [ ] 2.2 In `runSearch`, append `market` to the `/search` `URLSearchParams` when `market()` returns a code.
- [ ] 2.3 In `getTrack`, append `market` to the `/tracks/{id}` query when `market()` returns a code (its existing `is_playable === false` → `NotPlayableError` guard then activates).
- [ ] 2.4 Rewrite the "we intentionally send no `market`" comment block so it describes sending the configured market and keeping the implicit-account behavior only when none is set.

## 3. Playability pre-filter

- [ ] 3.1 In `selectBest`, skip candidates with `is_playable === false` before scoring, so ranking runs over playable candidates only. Confirm it is a no-op when the field is absent (no market).
- [ ] 3.2 Verify the empty/no-market path is byte-for-byte the prior behavior (nothing excluded, same pick).

## 4. Tests

- [ ] 4.1 Assert the `/search` request includes `market=US` when the param is `us`/`US`, and includes no `market` when the param is empty.
- [ ] 4.2 Assert an invalid code (`USA`, `1`, `u`) sends no `market`.
- [ ] 4.3 Assert `getTrack` sends `market` when set and raises `NotPlayableError` (→ `not-playable`) for an `is_playable: false` track.
- [ ] 4.4 Assert `selectBest` / `searchTrack` excludes an `is_playable: false` candidate from ranking, and that all-unplayable resolves to `undefined` (→ `not-found`).
- [ ] 4.5 Reset the mocked params between tests so a configured code does not leak across cases.

## 5. Verify

- [ ] 5.1 Run `pnpm test`, `pnpm lint`, `pnpm typecheck`, and `pnpm build`.
- [ ] 5.2 Run `pnpm openspec validate country-of-play --strict` and resolve findings.
- [ ] 5.3 Add a changeset (`.changeset/*.md`, minor — new parameter) describing Country of Play.
