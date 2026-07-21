## Why

A viewer requested "Come Play" (the Arcane track by Stray Kids / Young Miko) as `Come play - advance` and the bot queued `Tippy Toes by XG` — a track that shares nothing with the request. The cause is that the raw fallback search accepts Spotify's first result with no relevance check: when the filtered search fails, whatever Spotify ranks first is queued, however irrelevant. Selection is effectively "take `items[0]`" because the `is_playable` predicate it uses can never reject anything without a `market` parameter, which we deliberately do not send. The correct track was in the fetched candidate list (top 3), so the information to pick it was already present and thrown away.

## What Changes

- Candidate selection stops being "the first result". The search stage SHALL rank the returned candidates by **token overlap** with the query — how many distinct query tokens appear in the candidate's track name and artist names combined — and select the highest-scoring candidate, keeping Spotify's original order as the tie-breaker.
- A **zero-overlap floor**: when the best candidate shares no query token, the search returns nothing (the effect reports `not-found`) rather than queuing an irrelevant track.
- This applies to the raw fallback search, which today accepts its result **without validation**. Ranking + the floor replace that blind acceptance. The filtered path keeps its existing token-containment validation gate; selecting the best-overlap candidate there is behavior-preserving, because any candidate that passes that validation already has full overlap.
- No change to `SEARCH_LIMIT` (stays 5), the two-search-maximum, query normalization/splitting, moderation, restrictions, or the decision not to send `market`. Scoring reuses the existing token normalization.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `song-requests`: The "Filtered Search Validation And Raw Fallback" requirement changes how a candidate is selected — from Spotify's first result to the best token-overlap candidate — and replaces the raw fallback's "accept without validation" with a zero-overlap floor that yields `not-found` when nothing relevant is returned.

## Impact

- Code: `src/services/api.ts` — candidate selection in `runSearch` / `searchTrack` (the `items.find(is_playable)` selection and the unvalidated raw-fallback return). Reuses the existing `tokenize` helper.
- Tests: `src/services/api.test.ts` — new cases for overlap ranking and the zero-overlap floor; existing raw-fallback expectations reviewed for the ranked-selection behavior.
- Behavior: requests that previously matched an irrelevant track now either recover the correct one (when it is among the fetched candidates) or fail cleanly as `not-found`. No API surface, parameters, or effect outputs change.
- Diagnostics: the opt-in search log already records every candidate and the selected one; the selected candidate now reflects ranking rather than `items[0]`.
