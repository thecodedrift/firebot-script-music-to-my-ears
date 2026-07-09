## Why

The Request Song effect sends the viewer's raw text straight to Spotify's `/v1/search?type=track`
and queues the top hit. Filler words and artist tokens compete against track titles in Spotify's
ranking, so a query like `seven dollars by happy birthday mr baskets` can resolve to a track the
requester plainly did not ask for. When that happens the streamer has no way to see what was
searched, what came back, or why that result won — the only observable output is a wrong song in
the queue.

This change makes the failure diagnosable (opt-in logging) and makes it rarer (query normalization
via Spotify field filters).

## What Changes

- Add a per-effect **"Enable Logging"** checkbox to the Request Song effect, default **off**,
  rendered at the bottom of the options template. It gates all new logging below.
- When enabled, log the outgoing Spotify search request, the raw response, the total number of
  matches returned, the full candidate list, and which candidate was selected.
- Normalize the search query using Spotify's documented `track:` and `artist:` field filters.
  The query is split into title/artist only when a separator (`by` as a whole word, or `-`)
  appears **exactly once**; otherwise the raw query is used unchanged.
- Validate the filtered search's chosen result against the parsed title/artist. On validation
  failure, or on zero results, **fall back once** to the raw free-text query. Validation — not the
  split rule — is what keeps a title like `Stand By Me` from being mangled into
  `track:"Stand" artist:"Me"`.
- When logging is enabled, both attempts (filtered, then raw fallback) are logged so the streamer
  can see which one won.
- Correct the misleading comments in `src/services/api.ts` that claim the effect selects "the first
  playable result". `is_playable` is only present when track relinking applies, so the current
  `find(is_playable !== false)` always selects `items[0]` and `SEARCH_LIMIT = 5` buys nothing.
  **Comments only — no behavior change.** A real fix is deferred to a separate change.

Not breaking: the checkbox defaults off, and normalization falls back to today's exact behavior
whenever the split does not apply or its result fails validation.

## Capabilities

### New Capabilities

None. This change modifies existing capabilities only.

### Modified Capabilities

- `song-requests`: Adds two requirements — **Search Query Normalization** (the split rule, the
  filtered-then-raw fallback, and the result-validation gate) and **Opt-In Request Diagnostics**
  (the per-effect logging checkbox and what it emits). The existing *Request Song Effect*
  requirement gains a scenario covering the fallback path.
- `spotify-integration`: Modifies **Authenticated API Client** to distinguish the two logging
  channels — the always-on failure-triage log stays redacted (`q`, `uri`, `uris`), while opt-in
  diagnostics may include the query text and response body by the streamer's explicit choice.
  Neither channel may ever emit the bearer token or client secret.

## Impact

- `src/services/api.ts` — `searchTrack()` gains an options argument carrying the logging flag;
  new query-normalization and result-validation helpers; corrected comments around `SEARCH_LIMIT`
  and the `is_playable` selection.
- `src/firebot/effects/requestSongEffect.ts` — new `enableLogging` model field, new checkbox in
  `optionsTemplate`, threaded through to `searchTrack()`. The `optionsController` is stringified
  and eval'd on the frontend, so the default must be seeded with literals only.
- `src/services/api.test.ts` — new coverage for the split rule, the validation gate, the raw
  fallback, and the logging on/off behavior.
- No new dependencies. No change to the Spotify request surface beyond the `q` value itself; the
  `market` parameter is still deliberately omitted.
- Ships with a changeset (`.changeset/*.md`).
