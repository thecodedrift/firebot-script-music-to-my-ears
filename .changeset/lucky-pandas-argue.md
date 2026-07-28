---
"firebot-script-music-to-my-ears": patch
---

Stop a song request from queueing an unrelated track that happens to share a common word. The raw
search fallback accepted any candidate sharing at least one token with the request, and every token
counted equally — so a shared `the` was enough. A request for `walk the dinosaur by ninja sex party`
could come back with **"The Decision"**.

The floor now requires a shared **content token**: a word that is not an article, conjunction,
preposition, or feature marker. A candidate whose only commonality is a function word is reported as
not-found instead of queued. Pronouns still count (`Stand By Me`, `Call Me Maybe`), and a query made
entirely of function words — `The The`, `You And Me` — keeps the old behavior so it stays findable.

Ranking is unchanged: it still weighs every token, because choosing between related candidates is a
different question from deciding whether a candidate is related at all.
