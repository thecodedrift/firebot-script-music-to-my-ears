## 1. Types and identity

- [x] 1.1 Add `id: string` to each element of `SpotifyTrack.artists` in `src/types/spotify.ts`
- [x] 1.2 Add `artistIds: string[]` to `Track` in `src/shared/types.ts`, documenting that index `0` is the primary artist by Spotify convention
- [x] 1.3 Add `too-long`, `artist-recently-played`, and `user-artist-recently-played` to the `ErrorReason` union in `src/shared/types.ts`
- [x] 1.4 Populate `artistIds` in `toTrack()` (`src/services/api.ts`), the sole `Track` construction site
- [x] 1.5 Include artist ids in the diagnostics candidate list so a surprise artist-cooldown hit is debuggable
- [x] 1.6 Add `artistIds` to the track fixtures in `src/services/api.test.ts` and `tools/spotify/search.test.ts`

## 2. Ledger

- [x] 2.1 Introduce namespaced key builders for `track:<uri>`, `artist:<artistId>`, and `user-artist:<lowercased-username>:<artistId>`
- [x] 2.2 Replace `isRecent(key, windowMs, now) -> boolean` with `remainingMs(key, windowMs, now) -> number`, returning `0` when the key is absent, the window has elapsed, or the window is `<= 0`
- [x] 2.3 Change `record()` to write the track, artist, and requester-artist keys together, unconditionally, from one successful queue
- [x] 2.4 Constrain `requesterOf()` to `track:` keys and document why the single map permits, but does not support, other key kinds
- [x] 2.5 Confirm `clear()` still empties the whole map, and that `main.ts`'s `stop()` calls it
- [x] 2.6 Update `src/services/ledger.test.ts` for `remainingMs()`, covering the absent key, elapsed window, and disabled (`0`) window cases

## 3. Restriction gates

- [x] 3.1 Add a max-track-length gate to `src/services/moderation.ts` taking `Track.durationMs` and a limit in seconds, where `0` disables
- [x] 3.2 Implement the transient-gate resolver: given the three cooldown windows, return the reason with the greatest `remainingMs`, or none when all are `0`
- [x] 3.3 Skip the per-requester gate entirely when the trigger username is blank
- [x] 3.4 Unit-test the resolver, including the three-way tie-break from the design and the all-disabled case

## 4. Error text and cooldown outputs

- [x] 4.1 Add `errorTextFor(reason)` as a single exhaustive map over `ErrorReason`, returning `""` for success
- [x] 4.2 Implement a small internal `{placeholder}` substitution helper — no `$`-prefixed tokens
- [x] 4.3 Write the message for `artist-recently-played` so it names the artist and never blames the requester
- [x] 4.4 Derive `errorCooldown` as `Math.ceil(remainingMs / 1000)`, and `0` for every non-cooldown reason and on success
- [x] 4.5 Test that an artist name containing `$` (e.g. `A$AP Rocky`) renders intact, and that `errorCooldown` rounds 400ms up to `1`

## 5. Request Song effect

- [x] 5.1 Add `noRepeatMinutes`, `artistCooldownMinutes`, `userArtistCooldownMinutes`, and `maxTrackLengthSeconds` to the effect `Model`
- [x] 5.2 Declare the defaults (`30`, `0`, `0`, `0`) in `src/types/params.ts` for the backend, following the `DEFAULT_BLOCKED_TERMS` precedent
- [x] 5.3 Inline the same defaults in `optionsController` — it is eval'd on the frontend and cannot reference bundled imports
- [x] 5.4 Regroup `optionsTemplate` into `Moderation` (explicit, blocked terms) and `Restrictions` (the three cooldowns, max length), leaving `Troubleshooting` last; use 7 minutes as suggested copy for max length, not as a default
- [x] 5.5 Reorder the gate chain: permanent rejections first (`blocked-term`, `explicit`, `too-long`), then the transient resolver
- [x] 5.6 Read `noRepeatMinutes` from the effect model instead of `getParams()`
- [x] 5.7 Add `errorText` and `errorCooldown` to `Outputs` and to the effect's declared `outputs`
- [x] 5.8 Update the hand-maintained reason list in the `errorReason` output description to include the three new reasons
- [x] 5.9 Confirm top-level `success` still stays `true` on failure so Firebot retains `outputs`

## 6. Other effects

- [x] 6.1 Add an `errorText` output to `makePlaybackEffect` (backs skip, play/resume, pause)
- [x] 6.2 Add an `errorText` output to `getCurrentTrackEffect`
- [x] 6.3 Leave `errorCooldown` off these effects — none has a cooldown to report

## 7. Remove the script parameter

- [x] 7.1 Delete `noRepeatMinutes` from `getDefaultParameters()` in `src/main.ts`
- [x] 7.2 Remove `noRepeatMinutes` from the `Params` interface in `src/types/params.ts`
- [x] 7.3 Check no remaining `getParams().noRepeatMinutes` reader survives

## 8. Effect-level tests

- [x] 8.1 Global artist cooldown blocks a second requester, and the message does not blame them
- [x] 8.2 Per-requester cooldown blocks the same requester and lets a different one through
- [x] 8.3 A blank username skips the per-requester gate, and two such requests do not share a bucket
- [x] 8.4 A featured (non-primary) artist does not trip the artist cooldown — the accepted bypass, pinned as a test
- [x] 8.5 `too-long` outranks a concurrent cooldown (permanent beats transient)
- [x] 8.6 **The tiebreak test:** three transient gates trip with 5, 22, and 58 minutes remaining; assert `artist-recently-played` wins and `errorCooldown` matches the 58-minute wait
- [x] 8.7 An effect with a disabled window still records the ledger keys another effect reads
- [x] 8.8 A successful request outputs empty `errorReason`/`errorText` and `errorCooldown: 0`

## 9. Ship

- [x] 9.1 Run `pnpm openspec validate add-jukebox-protection --strict`
- [x] 9.2 Run lint, typecheck, tests, and the webpack build; confirm the bundle stays a single CommonJS file with `run`/`getScriptManifest`/`getDefaultParameters` unmangled
- [x] 9.3 Update `README.md` for the new restrictions and the two new outputs
- [x] 9.4 Add a **major** changeset stating that the no-repeat window moved from script parameters to each Request Song effect, and that streamers who changed it from 30 must set it again
- [ ] 9.5 Commit with `-S`, open a PR; do not run `pnpm changeset version`
