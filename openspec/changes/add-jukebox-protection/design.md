## Context

The Request Song effect today rejects a track for one of three reasons evaluated in a fixed order:
a blocked term, an explicit flag, or the track having been queued within the no-repeat window. The
no-repeat window is keyed by track URI and read from a script parameter (`noRepeatMinutes`,
default 30).

That protects against one specific abuse — requeuing the same song — and nothing else. It does not
protect the *shape of the playlist*. Two enthusiastic fans of one band can trivially fill hours of
the queue with that band while never repeating a track, and every other requester is squeezed out.

The ledger (`src/services/ledger.ts`) is a `Map<uri, {requestedBy, ts}>` with a boolean
`isRecent(uri, windowMs, now)` reader. `record()` and `isRecent()` already accept an injectable
`now`, so time-dependent behavior is deterministically testable without fake timers.

Constraints inherited from the codebase:

- The Request Song effect is **one atomic invocation**: a single `outputs.success`, one
  `errorReason`, and the cooldown check and ledger write inside the same call. Nothing here relaxes
  that.
- Firebot discards an effect's `outputs` when the effect reports `success: false` at the top level,
  so the top-level flag stays `true` on failure and the real pass/fail lives in `outputs.success`.
- `optionsController` is stringified and evaluated on the **frontend**. It cannot reference any
  bundled import; doing so throws `params_1 is not defined`. Defaults must be inlined there and
  separately declared in `types/params.ts` for the backend.

## Goals / Non-Goals

**Goals:**

- Protect playlist diversity: cap how often a single artist can occupy the queue.
- Give a streamer a failure message they can pipe straight into chat, without hand-writing one per
  `errorReason`.
- When a request is rejected by a cooldown, tell the viewer a retry time that is actually true.
- Keep the upgrade behavior-neutral except for the one configuration move we deliberately accept.

**Non-Goals:**

- **Anti-abuse.** The artist cooldown is not a punishment mechanism and must not be described as one
  in user-facing text. See the first decision below.
- **Per-user quotas** ("at most 3 songs pending"). Counting requests requires an append-only event
  log and a signal for when a track finished playing. The ledger has neither. Out of scope.
- **Candidate skipping.** A rejected track does not cause the effect to try the next search result.
  The effect still issues at most two searches and gates exactly one candidate.
- **Removing a track from the Spotify queue.** Spotify's Web API has no endpoint for it. Only
  skipping the currently-playing track is possible, which is a different feature.
- **Persisting the ledger** across restarts.

## Decisions

### The artist cooldown is global, and that is the point

A per-user artist cooldown targets the *user* who stacks one band. A global artist cooldown locks
the *artist* for everyone, including a viewer who has requested nothing all stream.

We ship both, but the global one carries the intent. The abuse framing ("one user keeps queueing
their favorite band") makes the innocent viewer's rejection look like a bug. The diversity framing
("the stream should not play this band six times an hour") makes it obviously correct, and it is the
property the streamer actually experiences. Whether an artist has one obsessive fan or forty
enthusiastic ones is not a distinction the queue cares about.

The consequence that must not be lost: **`errorText` for the global cooldown may never blame the
requester.** "That artist was played recently" is correct. "You have requested this artist too
often" is a lie to everyone but the one person who did.

*Alternative considered:* per-user only. Rejected — it is trivially defeated by two friends, and it
does nothing for diversity, which is the actual goal.

### Cooldowns key on the Spotify artist ID, not the artist name

`toTrack()` maps `item.artists.map(a => a.name)` and discards the `id` Spotify returns on every
artist object. Names are not identities: `ATEEZ` and `에이티즈` are the same group under different
catalog entries, `Beyoncé` and `Beyonce` differ by a diacritic, and two unrelated artists can share
a name and collide into one lock.

`tokenize()` already exists in `api.ts` and would normalize case and diacritics, so a normalized-name
key is *available* and would be better than raw strings. It is still the wrong key. The ID is free in
the response, exact, and immune to all three problems. `SpotifyTrack.artists` gains `id`; the domain
`Track` gains `artistIds`. `toTrack()` at `api.ts:158` is the sole `Track` construction site — the
`.map(a => a.name)` at `api.ts:450` is the diagnostics candidate log, not a `Track`.

### Only the primary artist gates, and the collab bypass is accepted

Both the write and the read use `artists[0]` only.

This leaves a bypass: an artist who is *featured* (non-primary) on a track does not trip their own
cooldown, so alternating `ATEEZ — Song` with `Other Artist feat. ATEEZ` never locks. We accept it.
The realistic failure mode is two fans queueing an artist's own catalog, not two fans hunting for
collaborations.

*Alternative considered:* write-all-artists / read-any-artist. It closes the bypass, at the cost of
**collab bleed** — queueing `ATEEZ × Hongjoong` locks Hongjoong's solo work too, and the resulting
`errorText` names an artist nobody requested. Worse on compilations and classical recordings, where
one track can carry a dozen artists and lock all of them at once. The bypass is cheaper than the
bleed.

`artists[0]` being the primary artist is a Spotify **convention**, not a documented guarantee. We
rely on it knowingly.

### Among transient gates, the longest remaining wait wins — not the most specific

Three cooldowns can trip on the same request with independent windows. Once `errorCooldown` exists,
the choice of which one to report stops being cosmetic and becomes **advice**:

```
track cooldown     5 min remaining  ─┐
global artist     58 min remaining  ─┼─▶  all three trip on one request
per-user artist   22 min remaining  ─┘

  most specific (track)  →  "try again in 5 minutes"   ← viewer retries, is rejected again
  longest remaining      →  "try again in 58 minutes"  ← true
```

Reporting the most specific reason tells the viewer to come back at a time they will still be
blocked. That makes the bot a liar, through the streamer's own chat message. So:

- **Permanent** rejections (`blocked-term`, `explicit`, `too-long`) are evaluated first, first match
  wins. A too-long track is always too long; "don't ask again" is more useful than "ask again later"
  when both are true.
- **Transient** rejections (the three cooldowns) are evaluated together, and the one with the
  greatest `remainingMs` is reported.

This is observable behavior, so it is specified rather than left to implementation order.

*Alternative considered:* specificity ordering (track → per-user artist → global artist). Simpler to
implement, and wrong for the reason above.

### `isRecent()` becomes `remainingMs()`

The boolean reader cannot support either the max-remaining tiebreak or the `errorCooldown` output.
`remainingMs(key, windowMs, now) → number` returns `0` when not blocked, preserving the
`windowMs <= 0` disable check. Every gate reads it; the tiebreak is a `max` over three calls.

`errorCooldown` is `Math.ceil(remainingMs / 1000)` — **ceil, not floor**, or a viewer 400ms from
expiry is told to try again in zero seconds.

This makes `errorCooldown: 0` unambiguous by construction: a cooldown rejection always has
`remainingMs > 0`, therefore `ceil(...) >= 1`, therefore `0` can only ever mean "not rejected by a
cooldown". It also lines up with Firebot's `0`-means-disabled convention.

### One namespaced ledger map, not three

```
track:<uri>
artist:<artistId>
user-artist:<lowercased-username>:<artistId>
```

Chosen for simplicity, and because a single map is a readable registry when debugging why a request
was blocked. The cost is that `requesterOf()` is only meaningful for a `track:` key — three separate
maps would make that a type error instead of a convention. We take the convention and document it;
request volume on a stream cannot make this map large enough for the structure to matter, and no
pruning is required.

### Writes are unconditional; only reads are gated

`record()` already writes on every successful queue regardless of window size, and `isRecent()`
returns `false` when `windowMs <= 0`. That was incidental. It is now load-bearing.

With windows configured **per effect**, a lax effect (artist cooldown `0`, e.g. a VIP-only request
button) shares the same ledger as a strict one. If the lax effect skipped *writing* artist rows, the
songs queued through it would not count toward the strict effect's diversity window, silently
punching a hole in it. So: always record every key; gate only on read.

### Usernames are lowercased, and a blank username skips the per-user gate

The ledger takes `trigger?.metadata?.username ?? ""`. Lowercasing handles Twitch's display-name vs
login distinction; nobody renames their Twitch account to dodge a song cooldown.

An empty username is a real value — a Request Song effect fired from a timer, a startup event, or
any non-user trigger has none. Without a guard, every such request would share one bucket keyed
`user-artist::<artistId>` and the streamer's own automation would rate-limit itself. **A blank
username skips the per-user gate entirely.** Those triggers are streamer-controlled and deliberate.

### `errorText` uses `{brace}` placeholders, never `$`

`errorText` interpolates track and artist names. Real artist names contain `$` — **A$AP Rocky**,
**Ke$ha**. If Firebot expands `$`-variables inside a substituted output value, a `$`-based template
breaks on ordinary input, no adversary required, and possibly worse than breaking.

We did not confirm Firebot's expansion semantics for output values. We do not need to: using
`{artist}` / `{cooldown}` placeholders with a small internal string replacement sidesteps the
question entirely. This is the same instinct as the existing spec's quote-injection handling in
search queries.

`errorTextFor(reason)` is a single exhaustive map over the shared `ErrorReason` type, which is why
`errorText` is cheap to carry to `makePlaybackEffect` and `getCurrentTrackEffect` as well —
those already emit `errorReason` and would otherwise be the only effects without its friendly form.
`errorCooldown` stays Request-Song-only; nothing else has a cooldown to report.

### All new restrictions default to disabled

`0` disables each restriction, per Firebot convention. Global artist cooldown, per-user artist
cooldown, and max track length all ship at `0`; the track cooldown keeps today's default of `30`.

This means the jukebox protection this change is named for is **off until a streamer turns it on**,
and the section sits near the bottom of the effect options where it may be skipped. That is the
deliberate trade: fewer surprises on upgrade over a shipped opinion about how a stream should sound.
7 minutes / 420s appears as suggested copy for max length, not as a default.

## Risks / Trade-offs

- **An innocent viewer is rejected because someone else queued that artist.** → Intended. `errorText`
  must state the artist was played recently, never that the requester did something wrong.

- **The collab bypass lets a determined stacker through.** → Accepted; write-all/read-any trades it
  for collab bleed, which is worse and more confusing. Recorded as a spec scenario so a future
  reader sees a decision, not an oversight.

- **`artists[0]` is convention, not contract.** → If Spotify reorders artists, the wrong artist is
  gated. Low likelihood, self-correcting within one cooldown window, and visible in the search
  diagnostics once artist IDs are logged there.

- **Existing streamers silently lose a customized `noRepeatMinutes`.** → Unavoidable given the move
  to per-effect config. Mitigated by the major version bump and an explicit migration note in the
  changeset; the new per-effect default matches the old script-parameter default of 30, so only
  streamers who changed it are affected.

- **New restrictions ship disabled, so most streamers never get the protection.** → Accepted, and it
  is the reason the defaults question was decided deliberately rather than by omission. Revisit if
  streamers report jukebox stacking after upgrading.

- **A future refactor quietly reverts max-remaining to first-match-wins.** → The tiebreak test is the
  executable form of that decision: three transient gates tripping with different windows, asserting
  the longest wins and that `errorCooldown` matches it.

- **The single namespaced map allows `requesterOf("artist:...")`.** → Meaningless rather than
  dangerous; it returns the requester of whoever last queued that artist. Guarded by convention and
  a comment, not by the type system.

## Migration Plan

1. Add the three restriction fields to the effect model, defaulting to `0`, inlining defaults in
   `optionsController` and declaring them in `types/params.ts`.
2. Move `noRepeatMinutes` to the effect model with default `30`. **Remove** it from
   `getDefaultParameters()` in `main.ts` — leaving it would show a setting that does nothing.
3. Ship a `major` changeset whose note states plainly: the no-repeat window is now configured on
   each Request Song effect, and streamers who changed it from 30 must set it again.

Rollback is a version pin; nothing persists across the upgrade, since the ledger is in-memory and
cleared on `stop()`.

## Open Questions

None blocking. Two worth revisiting after release:

- Whether Firebot expands variables inside substituted output values. Sidestepped by brace
  placeholders, but it determines whether a streamer can safely interpolate `errorText` into a chat
  message that also uses `$` variables.
- Whether the new restrictions should default to non-zero in a later major, once there is evidence
  about how many streamers enable them.
