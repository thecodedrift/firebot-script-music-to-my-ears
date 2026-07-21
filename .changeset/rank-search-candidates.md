---
"firebot-script-music-to-my-ears": patch
---

Song requests now rank Spotify search results by relevance instead of blindly taking the first
result. Candidates are scored by how many query tokens appear in the track and artist names, and the
best-matching one is queued (ties keep Spotify's order). The raw fallback also gains a relevance
floor: when no candidate shares any word with the request, it reports "not found" rather than queuing
an unrelated track. Fixes requests like `Come play - advance` that previously queued a wildly wrong
song.
