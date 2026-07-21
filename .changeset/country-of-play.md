---
"firebot-script-music-to-my-ears": minor
---

Add an optional global "Country of Play" setting — a 2-letter country code (e.g. `US`, `GB`, `DE`).
When set, song requests resolve against that country's Spotify catalog: the code is sent as the
Spotify `market`, region-locked tracks are dropped from the results instead of being queued, and a
pasted link to a track that can't play in that country reports "not playable". Leaving it blank keeps
today's behavior (your linked account's country is used automatically). This pairs with relevance
ranking so requests match a playable track more often.
