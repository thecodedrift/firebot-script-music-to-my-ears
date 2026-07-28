## Why

The raw fallback's relevance floor exists to stop a fuzzy search from queueing a track nobody asked
for. It accepts any candidate sharing at least one token with the query — and every token counts
equally, so a shared `the` clears it. A request for `!sr Walk The Dinosaur by Ninja Sex Party`
resolved to **"The Decision"** on exactly that basis.

Any query containing a common word therefore has effectively no floor at all, which is most of
them.

Refs [#23](https://github.com/thecodedrift/firebot-script-music-to-my-ears/issues/23).

## What Changes

- The floor now requires overlap on a **content token** — a query token that is not a function word
  (`the`, `a`, `and`, `of`, `by`, `feat`, …). A candidate whose only commonality with the request is
  a function word is treated as no match, and the request outputs `not-found`.
- When a query is made **entirely** of function words — `The The`, `You And Me` — there are no
  content tokens to require, and the floor falls back to its current any-token behavior rather than
  refusing every candidate.
- Ranking is deliberately untouched: candidates are still scored on all query tokens. Only the
  floor, which is the correctness gate, changes.

## Capabilities

### Modified Capabilities
- `song-requests`: the zero-overlap floor in "Filtered Search Validation And Raw Fallback" becomes a
  content-token floor, with the all-function-words query called out as the case that keeps the old
  behavior.

## Impact

- `src/services/api.ts` — a function-word set, a `contentTokens` helper, and the floor check in
  `searchTrack`.
- A request that resolved to a genuinely relevant track is unaffected. A request that previously
  queued an unrelated track on a shared function word now reports `not-found`, which the effect
  already turns into a friendly "couldn't find that" for the viewer.
