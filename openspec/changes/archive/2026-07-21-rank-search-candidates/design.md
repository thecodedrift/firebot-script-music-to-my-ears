## Context

`searchTrack` (`src/services/api.ts`) resolves a request in at most two Spotify `/search` calls: a
normalized `track:"…" artist:"…"` filtered attempt, then a raw free-text fallback. `runSearch`
fetches `SEARCH_LIMIT = 5` candidates and "selects" one with
`items.find((item) => item.is_playable !== false)`. Because we send no `market` parameter,
`is_playable` is never populated, so that predicate never rejects anything and selection is always
`items[0]` — Spotify's own first result. The filtered path gates `items[0]` with `validateMatch`
(token containment); the raw path returns `items[0]` with no gate at all.

That unvalidated raw path is the defect: `Come play - advance` split into
`track:"Come play" artist:"advance"`, failed validation (no artist "advance"), fell through to a
raw search, and queued Spotify's first raw hit — `Tippy Toes by XG` — which shares nothing with the
request. The genuinely-wanted "Come Play" was among the 5 fetched candidates but was discarded by
"take the first". The signal to pick correctly was already in hand.

The `SEARCH_LIMIT` comment anticipates exactly this change: 5 candidates are fetched and the
opt-in diagnostics log all of them specifically so a ranking behavior could later use them.

## Goals / Non-Goals

**Goals:**
- Select the returned candidate most relevant to the query instead of blindly taking the first.
- Give the raw fallback a relevance floor so a request with no relevant candidate fails as
  `not-found` rather than queuing a wrong track.
- Reuse the existing token normalization; keep the two-search maximum and `SEARCH_LIMIT = 5`.
- Keep the filtered path's observable behavior when its first result already validates.

**Non-Goals:**
- Sending a `market` parameter or using `is_playable` to rank/filter. This is deferred to a
  separate "Country of Play" change (a global 2-letter country-code parameter, default empty) that
  will populate `is_playable` and make playability rejections — `not-found` / `not-playable` — fire
  appropriately. That change composes with this one: the best pick becomes the highest-overlap
  candidate *among playable ones*, i.e. `selectBest` gains a playability pre-filter while the
  ranking and zero-overlap floor introduced here stay as they are.
- Raising `SEARCH_LIMIT` — the wanted track is already in the top few; more candidates do not help.
- Changing query normalization/splitting, moderation, restrictions, cooldowns, or effect outputs.
- Fuzzy/edit-distance similarity — token overlap on the existing normalization is enough here.

## Decisions

**Rank by token overlap; tie-break on Spotify order.** Score each candidate by the count of distinct
query tokens present in the union of its track-name tokens and its artists'-name tokens, using the
existing `tokenize`. Pick the highest score; on a tie keep Spotify's order (stable select over the
returned list, so the earliest equal-scorer wins). Overlap is chosen over edit-distance because it
matches the existing `validateMatch` model, is trivially explainable in diagnostics, and directly
separates the bug case (`Come Play` = 2, `Tippy Toes` = 0). Ties preserving Spotify order means
single-word and already-correct queries behave exactly as today (all candidates that contain the
one token tie, so `items[0]` still wins).

**Score the filtered path against parsed title+artist, the raw path against the raw query.** Each
path scores against the tokens it actually searched for. On the filtered path this is
behavior-preserving: a candidate that passes `validateMatch` contains every parsed title and artist
token, i.e. has maximal overlap, so when `items[0]` validates today it remains the selected, maximal
candidate. The only new filtered behavior is that when `items[0]` fails validation but a
later candidate would pass, ranking can surface that passing candidate instead of falling through —
strictly fewer wrong fall-throughs, never a worse result.

**Zero-overlap floor on the raw path only.** If the best raw candidate shares no query token, select
nothing so the effect reports `not-found`. Zero (not a fraction) is the floor: it is the minimum
that rejects a wholly-irrelevant result like `Tippy Toes` while never rejecting a candidate that
shares any token with what the viewer typed. A fractional floor risks rejecting valid requests where
the viewer added noise words (as `advance` was here), so it is avoided. The filtered path keeps its
stricter containment validation and needs no separate floor.

**Where the code changes.** Selection moves out of the `is_playable` find. `runSearch` (or a small
`selectBest(items, queryTokens)` helper it calls) takes the scoring tokens and returns the
best-overlap candidate; the raw-path branch in `searchTrack` applies the zero-overlap floor before
accepting. The opt-in diagnostics already log every candidate and the selected one, so they keep
working and now show the ranked pick.

## Risks / Trade-offs

- [The wanted track is outside the 5 fetched candidates] → Ranking cannot reach it and the floor
  yields `not-found`. This is strictly better than today's wrong-track outcome, and for the reported
  case the track was confirmed in the top 3. `SEARCH_LIMIT` stays 5 by decision.
- [A short, generic query ranks a popular-but-wrong track equal to the intended one] → Equal overlap
  ties break on Spotify's order, which is its popularity/relevance ranking — the same track chosen
  today. No regression versus current behavior for these queries.
- [Overlap counts a common token like `the` as relevance] → Possible in principle, but the tie-break
  and the existing normalization bound the impact, and no separate stop-word list is introduced to
  keep the change small. Revisit only if diagnostics show it mattering.
- [Proceeding ahead of the "collect diagnostics first" plan] → Accepted by the maintainer on the
  strength of this concrete, reproduced failure; the diagnostics remain available to validate the
  ranked selection after the change.

## Open Questions

None outstanding. Stop-word handling remains deferred to its own future change; `market`-based
playability ranking is deferred to the "Country of Play" change described under Non-Goals.
