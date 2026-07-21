## Context

`searchTrack` / `getTrack` (`src/services/api.ts`) send no `market` parameter. A long comment there
explains why: Spotify deprecated `market=from_token` (Nov 2024) and now rejects it on some
accounts, and with a valid user token the account's own country is applied automatically. The cost,
also documented there, is that `is_playable` is only returned when Spotify applies track relinking —
which requires an explicit `market` — so responses carry no playability signal, and the
`rank-search-candidates` change deliberately ranks without one.

This change lets a streamer supply an explicit `market` via a single global parameter, turning
`is_playable` back on for both search and lookup. It is the deferred second half called out in the
`rank-search-candidates` design.

## Goals / Non-Goals

**Goals:**
- One global, optional country code that, when set, scopes Spotify search and lookup to that market.
- Exclude unplayable candidates from ranking, and raise `not-playable` for an unplayable direct URL.
- A default (empty) that changes nothing about today's behavior.
- Reject a malformed code locally instead of forwarding it to Spotify.

**Non-Goals:**
- Per-effect or per-request market overrides — one global code is enough.
- Reintroducing `market=from_token` — it is deprecated; only an explicit 2-letter code is sent.
- Changing token-based auth, query normalization/splitting, moderation, restrictions, or the
  relevance ranking/floor themselves (this only narrows what ranking sees).

## Decisions

**A validated global parameter, empty by default.** Add `spotifyCountryCode` to `Params` and to
`getDefaultParameters()` as a `string` titled "Country of Play", default `""`. A single `market`
helper in `api.ts` reads it via `getParams()`, trims it, and returns an uppercased code only when it
is exactly two ASCII letters; otherwise `undefined`. Two letters is the ISO 3166-1 alpha-2 shape
Spotify accepts; anything else is a user typo and is safer dropped than forwarded (a bad `market`
can 400 or silently distort results). Uppercasing is normalization — Spotify treats `us` and `US`
alike, but normalizing keeps logs and comparisons consistent.

**Send `market` from two sites, gated on the helper.** `runSearch` appends `market` to the
`/search` query and `getTrack` appends it to `/tracks/{id}` when the helper returns a code. Both use
the existing `URLSearchParams`, so an absent code simply omits the param — no branching in the
request shape. `market` is a structural parameter, not user content, so it is not added to
`REDACTED_PARAMS`; like `type` and `limit` it stays visible in the triage log.

**Playability pre-filter lives in `selectBest`.** `selectBest` skips candidates with
`is_playable === false` before scoring. This is exactly a no-op when no market is sent, because the
field is then `undefined` and `=== false` is never true — so the `rank-search-candidates` behavior
is unchanged for the default. When a market is set and every returned candidate is unplayable,
`selectBest` returns `undefined`, which the filtered path treats as "no result" (falls through) and
the raw path turns into `not-found` via its existing guard. Putting the filter in `selectBest`
rather than `runSearch` keeps one selection funnel and matches the seam the prior change described.

**Direct lookup needs no new code.** `getTrack` already throws `NotPlayableError` on
`is_playable === false`; today it never fires because the field is absent. Adding `market` to its
request activates that path for region-locked URLs, and `toErrorReason` already maps it to
`not-playable`.

## Risks / Trade-offs

- [A streamer sets a market their linked account can't actually play from] → Results reflect that
  market's catalog and more requests resolve to `not-found`/`not-playable`. That is the feature
  working as asked; the empty default keeps anyone who does not want it unaffected.
- [An explicit `market` returns fewer/relinked results than the implicit account catalog] → Only
  streamers who opt in see this; it is the documented consequence of sending `market`, and it is the
  same mechanism that provides `is_playable`.
- [Overly strict validation rejecting a legitimate code] → ISO alpha-2 is exactly two letters, so
  the two-letter rule cannot reject a valid code; it only drops malformed input.
- [Interaction with the stacked `rank-search-candidates` change] → This PR targets that branch and
  modifies the same `selectBest`; it is intended to merge after it.

## Open Questions

None. Whether to later validate the code against a fixed ISO list (rather than shape only) is left
open but unnecessary now — Spotify rejects an unknown-but-well-shaped code on its own, and the
helper already blocks the common typo cases.
