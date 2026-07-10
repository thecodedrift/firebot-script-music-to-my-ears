# firebot-music-to-my-ears

## 2.0.0

### Major Changes

- f0f42df: Add jukebox protection to the Request Song effect, and ship a friendly failure message with every
  error.

  **Breaking: the no-repeat window moved.** It is no longer a script setting. Each Request Song effect
  now has its own **Same track cooldown (minutes)** under a new **Restrictions** section, defaulting to
  30 — the same value the script setting defaulted to. If you had changed the old **No-Repeat Window**
  from 30, set it again on each Request Song effect after upgrading. Nothing else changes behavior.

  **Jukebox protection.** The no-repeat window stops the same _track_ being requeued, but nothing
  stopped the same _artist_ from crowding out the queue: two fans of one band could stack hours of it
  without ever repeating a track. Three new per-effect restrictions, all disabled by default:

  - **Artist cooldown** — how long before that artist can be requested again **by anyone**. This
    protects the variety of the playlist, so it applies to every viewer, not only the one who requested
    the artist. Only the track's primary artist is gated, and artists are matched by Spotify id rather
    than by name.
  - **Artist cooldown per viewer** — how long before the _same_ viewer can request that artist again.
    Skipped entirely for triggers that carry no username, such as timers.
  - **Maximum track length** — rejects anything longer than the configured number of seconds.

  Each has its own `errorReason`: `artist-recently-played`, `user-artist-recently-played`, `too-long`.

  **When several cooldowns apply at once, the one with the longest remaining wait is reported** — not
  the most specific one. Telling a viewer "try again in 5 minutes" while a 58-minute artist cooldown is
  still running would send them back to be rejected a second time.

  **Two new outputs.** `errorText` is a prebuilt message you can send straight to chat, on the Request
  Song effect and on every other effect that reports an `errorReason`. `errorCooldown` is the remaining
  wait in whole seconds, and is `0` whenever the failure was not a cooldown. Branch on `errorReason` when
  you want your own wording; use `errorText` when you don't.

## 1.1.0

### Minor Changes

- c454930: Normalize song-request searches with Spotify field filters, and add opt-in per-effect logging.

  A request shaped `<title> by <artist>` (or `<title> - <artist>`) is now sent to Spotify as
  `track:"<title>" artist:"<artist>"` instead of as one free-text blob, which stops artist words from
  competing with track titles for rank. `seven dollars by happy birthday mr baskets` narrows from 13
  loosely-related matches to the 1 correct one.

  The split only happens when the separator appears exactly once, and the result is validated by
  whole-token containment before it is accepted — so a title that contains the separator, like
  `Stand By Me`, is caught and retried once with the raw query rather than queuing the wrong song.
  Any query that does not split, or whose filtered result fails validation, behaves exactly as before.

  The Request Song effect also gains an **Enable logging** checkbox (default off). When on, it logs
  each search attempt: the query sent to Spotify, the total number of matches, every candidate
  returned, which one was selected, and the raw response — enough to diagnose a wrong match after the
  fact. It is verbose by design, which is why it is opt-in.

## 1.0.4

### Patch Changes

- 3ca1a27: Fix empty `errorReason` (and all other outputs) on the failure path of every
  Spotify effect. Firebot's effect-runner only registers an effect's `outputs`
  when the effect reports a truthy top-level `success`; on `success: false` it
  logs the effect as failed and discards `outputs` entirely. Our effects returned
  top-level `success: false` on failure, so `$effectOutput[errorReason]` resolved
  to empty and the widget could not surface why a request failed.

  The effect still ran to completion — it evaluated the request and produced a
  verdict — so the failure branches now return top-level `success: true` and carry
  the real pass/fail in `outputs.success` (which the streamer branches on), keeping
  `errorReason` intact. Applies to Request Song, Get Current Track, and the shared
  playback factory behind Skip / Play-Resume / Pause.

## 1.0.3

### Patch Changes

- 01b21a9: Stop sending the deprecated `market=from_token` parameter on Spotify track and
  search requests. Spotify removed `from_token` in its November 2024 API changes
  and now rejects it (with a misleading error) on some endpoints and accounts,
  which could make name searches fail while direct links still worked. With a
  valid user token, Spotify uses the account's own country automatically, so the
  correct per-account catalog and `is_playable` are preserved without the
  deprecated value. Also adds a debug log when a name search resolves to no
  playable track, so the previously silent "not found" path is diagnosable.

  Adds a triage debug block on every failed Spotify response capturing the
  request shape, the response (status, status text, retry-after / request-id,
  body), and the derived error. It deliberately omits the Authorization header,
  access token, and client secret, and redacts user-content query values (search
  text, track uris) from the logged endpoint.

## 1.0.2

### Patch Changes

- a4031ac: Rename the package to `firebot-script-music-to-my-ears` to match the renamed
  GitHub repository. The package is private (unpublished) and the build output
  name (`scriptOutputName`) is unchanged, so the Firebot-loaded script file is
  unaffected.
- 04921cd: Harden Spotify token handling and add scope diagnostics.

  - **Expired-token protection** — when Spotify rejects a call with a 401 (the
    token was revoked or rotated behind our back and the local expiry timer can't
    see it), the request now forces a token refresh and retries once instead of
    failing.
  - **Scope validation logging** — on every token refresh we compare the scopes
    Spotify actually granted against the scopes we request and warn when any are
    missing (typically `user-modify-playback-state`, the cause of "Insufficient
    client scope"), pointing at a re-link. Debug logging confirms the token is
    valid when all scopes are present.
  - **Single source of truth for the token** — the access token is now read only
    from the integration definition Firebot persists, removing the parallel
    captured-token fallback that could diverge from the live linked token.

## 1.0.1

### Patch Changes

- a349f0f: Fix Spotify song-request matching and add per-account playability checks.

  - **Better search matches** — Spotify's relevance ranking is unreliable at
    `limit=1` (it could return a worse match than the obvious one, e.g. "The Mystic
    Crystal" for "Walk The Dinosaur by Ninja Sex Party"). Requests now fetch
    several results and pick the first playable one, which also tolerates noisy
    queries (a stray `by`, or a leaked `!sr` command prefix).
  - **Direct track links** — a Spotify track URL, `spotify:track:` URI, or bare
    track id is now resolved directly to that exact track instead of being run as
    a text search.
  - **Region/playability gating** — search and track lookups use `market=from_token`
    so results are filtered to what the linked account can play; a specifically
    requested but unplayable track now fails with the new `not-playable` error
    reason instead of being queued or mis-reported.

## 1.0.0

### Major Changes

- ef07824: Initial release: a Firebot custom script that adds Spotify song-request and
  playback effects, built as a single self-contained CommonJS bundle.

  - **Spotify integration** — links a Spotify account via Firebot's OAuth flow with
    automatic token refresh; client id/secret and the no-repeat window are
    configured on the script settings page.
  - **Request Song effect** — searches Spotify (tracks only; podcasts excluded),
    moderates, and queues in one atomic action, outputting `success` plus an
    `errorReason` (`not-found` / `blocked-term` / `explicit` / `recently-played` /
    `no-active-device` / `not-premium` / `not-linked`) so streamers can branch
    (e.g. refund a redemption) on a single condition. Moderation is a per-effect
    substring blocked-terms list (pre-filled with `karaoke`, `instrumental`,
    `inst.`), an optional "allow explicit tracks" toggle, and a no-repeat window.
  - **Playback effects** — Skip Track, Play / Resume, and Pause.
  - **Get Current Track effect** — outputs the now-playing track plus the requester,
    attributed via an in-memory ledger that also backs the no-repeat check.

### Minor Changes

- ef07824: Add project automation: CI (lint, typecheck, build, test) on PRs and main, Jest
  tests covering moderation, the no-repeat/requester ledger, API error mapping, and
  the run()/stop() lifecycle, Changesets-based versioning, a release workflow that
  attaches the built bundle to a GitHub Release, and a stack-aware OpenSpec archive
  check.
