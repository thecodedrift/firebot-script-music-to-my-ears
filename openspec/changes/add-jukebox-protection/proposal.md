## Why

The existing no-repeat window stops the same *track* being requeued, but nothing stops the same
*artist* from crowding out the queue. Two viewers who both love one band can stack hours of that
band into the jukebox, and every other requester is locked out. The goal is **playlist diversity**:
the stream should not play one artist six times an hour, regardless of who asks.

Separately, a failed request today yields a machine-readable `errorReason` and nothing else, so
every streamer hand-writes the same five chat messages. The effect should ship the friendly text
alongside the reason.

## What Changes

- **Global artist cooldown.** A successfully queued track locks its *primary* artist for a
  configurable window, for everyone. New `errorReason: artist-recently-played`.
- **Per-user artist cooldown.** Independently, a requester is locked out of the primary artist they
  just queued. Skipped entirely when the trigger carries no username. New
  `errorReason: user-artist-recently-played`.
- **Max track length.** A track longer than the configured limit is rejected. New
  `errorReason: too-long`. Uses `Track.durationMs`, already parsed and currently read by nothing.
- **Two-part gate ordering, now specified.** Permanent rejections (`blocked-term`, `explicit`,
  `too-long`) are reported first, first-match-wins. Among the three transient cooldown gates, the
  one with the **longest remaining wait** is reported — not the most specific one.
- **New `errorText` output** on every effect that emits an `errorReason`: a prebuilt, contextual,
  ready-to-send message.
- **New `errorCooldown` output** on the Request Song effect: the remaining wait in whole seconds.
- **Effect UI regrouped** into `Moderation` (explicit, blocked terms) and `Restrictions` (the three
  cooldowns, max length). `Troubleshooting` is unchanged.
- **BREAKING:** `noRepeatMinutes` moves from a script parameter to per-effect configuration and is
  **removed** from `getDefaultParameters()`. Existing effects fall back to the default and silently
  lose any customized value. This is a major version bump with a migration note.
- All new restrictions default to `0` (disabled), so the upgrade is behavior-neutral apart from the
  configuration move above.

## Capabilities

### New Capabilities

None. This extends existing capabilities.

### Modified Capabilities

- `song-requests`: adds the three restriction requirements, specifies gate ordering and the
  max-remaining tiebreak, adds the `errorText`/`errorCooldown` outputs, moves the no-repeat window
  to per-effect configuration, and restates the ledger contract over a namespaced keyspace.
- `spotify-integration`: the domain `Track` gains `artistIds`, and the consumed subset of Spotify's
  track object gains the artist `id` it currently discards.

## Impact

**Behavior (breaking).** `noRepeatMinutes` disappears from the script settings screen. Streamers who
changed it from the default of 30 must reconfigure it on each Request Song effect. Major bump.

**Public API.** `errorReason` values are strings streamers branch on. Three are added; none change
or disappear. Two outputs are added. Nothing is removed.

**Code.**
- `src/services/ledger.ts` — `isRecent()` becomes `remainingMs()`; the map takes namespaced keys
  (`track:` / `artist:` / `user-artist:`); `clear()` must still clear everything.
- `src/shared/types.ts` — three new `ErrorReason` values; `Track.artistIds`.
- `src/types/spotify.ts` — `SpotifyTrack.artists[].id`.
- `src/services/api.ts` — `toTrack()` carries artist IDs; search diagnostics log them.
- `src/services/moderation.ts` — the new length gate lands beside the existing content gates.
- `src/firebot/effects/requestSongEffect.ts` — new model fields, the regrouped options template,
  the reordered gate chain, the two new outputs, and the hand-maintained reason list in the
  `errorReason` output description.
- `src/firebot/effects/playbackEffect.ts`, `getCurrentTrackEffect.ts` — `errorText` output.
- `src/main.ts` — `noRepeatMinutes` removed from `getDefaultParameters()`.
- `src/types/params.ts` — restriction defaults for the backend.

**Constraint.** `optionsController` is stringified and evaluated on the frontend and cannot
reference bundled imports, so every new default is inlined there *and* declared in `types/params.ts`
for the backend — the existing `DEFAULT_BLOCKED_TERMS` split.

**Preserved.** The Request Song effect stays one atomic invocation: a single `outputs.success`, one
`errorReason`, and the cooldown checks and ledger write inside the same call. Top-level `success`
stays `true` on failure so Firebot does not discard `outputs`.

**Release.** Ships with a `major` changeset carrying the migration note. Versioning is automated;
`changeset version` is never run by hand.
