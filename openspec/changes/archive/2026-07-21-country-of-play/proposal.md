## Why

The script sends no `market` parameter to Spotify, so search and lookup responses never carry
`is_playable`. Region-locked tracks are therefore queued anyway (they only fail later, at playback,
if at all), and the relevance ranking cannot tell a playable candidate from one the account can
never play. Streamers have no way to say "resolve requests against my country's catalog." A single
global country code closes that gap and makes `not-found` / `not-playable` fire when — and only
when — a track truly cannot be played.

## What Changes

- A new global script parameter **Country of Play**: a 2-letter ISO 3166-1 alpha-2 country code,
  defaulting to an empty string. Empty means "send no `market`", preserving today's behavior exactly.
- When a valid code is set, the script SHALL send it as the `market` parameter on track search and
  on direct track lookup. Spotify then applies track relinking and populates `is_playable`.
- Candidate selection SHALL exclude unplayable candidates (`is_playable === false`) before ranking
  by token overlap. With no code set, `is_playable` is absent and nothing is excluded — identical to
  current behavior. When every candidate is unplayable, the search resolves to nothing (`not-found`).
- A direct track URL/URI/id that the configured market cannot play SHALL surface as `not-playable`
  (the existing `NotPlayableError` path, which only activates once `is_playable` is populated).
- An invalid code (not exactly two ASCII letters) SHALL be treated as unset — no `market` is sent —
  rather than passed through to Spotify.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `spotify-integration`: the "Configuration Parameters" requirement gains the Country of Play code
  (previously "client id and client secret only"), and a new requirement defines how a set code
  becomes the `market` on search and lookup and what an invalid code does.
- `song-requests`: the candidate-selection requirement changes so ranking is performed over playable
  candidates only when a market is in effect; with none, selection is unchanged.

## Impact

- Code: `src/types/params.ts` (add `spotifyCountryCode`), `src/main.ts` (`getDefaultParameters`),
  `src/services/api.ts` (`market`/validation helper; `market` on `runSearch` and `getTrack`;
  `selectBest` playability pre-filter; rewrite the "no market" rationale comment).
- Tests: `src/services/api.test.ts` — market appended when configured and omitted/invalid when not;
  unplayable candidates excluded from ranking; `getTrack` raises `NotPlayableError` under a market.
- Behavior: default (empty) is a no-op. With a code set, region-locked tracks stop being queued and
  resolve to `not-found`/`not-playable`. Composes with the relevance ranking already shipped.
- Depends on the `rank-search-candidates` change: this edits the same `selectBest`/selection path.
