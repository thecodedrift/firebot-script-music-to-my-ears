## Context

Two mechanisms guard the raw fallback. **Ranking** picks the candidate with the greatest token
overlap with the query; the **floor** then rejects the winner outright if it shares nothing with the
query. Ranking is best-effort — it decides which of several plausible tracks to take. The floor is
the correctness gate — it decides whether to queue anything at all.

The floor is currently `overlapScore(selected, rawTokens) > 0`, and `overlapScore` weighs every
token the same. "The Decision" shares `the` with `walk the dinosaur by ninja sex party`, scores 1,
and clears a gate that exists specifically to stop it.

## Goals / Non-Goals

**Goals:**

- A candidate has to share something meaningful with the request, not merely a function word.
- No legitimate request stops working — including requests whose every word is a function word.

**Non-Goals:**

- Changing how candidates are **ranked**. See below; this is the important boundary of the change.
- Any kind of fuzzy or semantic matching. The floor stays a token-set test.
- Stemming or a large stopword corpus. A short, closed list of function words is enough for the
  defect and is far easier to reason about.

## Decisions

### Change the floor, not the ranking

Tempting to score content tokens higher during ranking too, but it breaks specced behavior. The
raw fallback for `Stand By Me` ranks on the tokens `stand`, `by`, `me`; drop the function words and
`Stand` and `Stand By Me` both score 1 on `stand`, so Spotify's order decides — and the effect can
return `Stand`, the wrong track, in a scenario the spec calls out as recovering the right one.

Ranking benefits from every token, including weak ones, because it is choosing *between* candidates
that already relate to the query. The floor is asking a different question — "does this relate to
the query at all?" — and there a function word is worth nothing. Only the floor changes.

### A closed list of function words, deliberately short

Articles, conjunctions, prepositions, and the feature markers (`feat`, `ft`, `featuring`, `vs`).
Nothing else. Pronouns like `me`, `you`, and `my` are **not** on it: they carry real signal in
titles (`Stand By Me`, `Call Me Maybe`), and excluding them would reject matches that should stand.

The list is short on purpose. Every word added to it is a word that can no longer, by itself, keep
a request alive — so the bar for adding one is that it is genuinely meaningless as a search term.

### All-function-word queries keep the old floor

`The The` is a band. `You And Me` is a title. If a query's tokens are all function words, requiring
a content-token overlap would reject every candidate and make the request permanently unfindable.
In that case the floor falls back to any-token overlap: no worse than today, and the only queries
affected are ones where a function word is genuinely the whole signal.

## Risks / Trade-offs

- **A real match rejected because its only shared token is a function word** → Then the candidate
  shared nothing else with the request — not the title, not the artist — and queueing it was a
  coin flip. `not-found` with a friendly message is the better outcome.
- **The list will be wrong for some language** → Queries are matched against Spotify's global
  catalog and the list is English-only, so a non-English query is simply unaffected: none of its
  tokens are on the list, and it keeps today's behavior exactly.
