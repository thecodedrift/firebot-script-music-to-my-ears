# firebot-music-to-my-ears

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
