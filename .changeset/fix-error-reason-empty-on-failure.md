---
"firebot-script-music-to-my-ears": patch
---

Fix empty `errorReason` (and all other outputs) on the failure path of every
Spotify effect. Firebot's effect-runner only registers an effect's `outputs`
when the effect reports a truthy top-level `success`; on `success: false` it
logs the effect as failed and discards `outputs` entirely. Our effects returned
top-level `success: false` on failure, so `$effectOutput[errorReason]` resolved
to empty and the widget could not surface why a request failed.

The effect still ran to completion — it evaluated the request and produced a
verdict — so the failure branches now return top-level `success: true` and carry
the real pass/fail in `outputs.success` (which the streamer branches on), keeping
`errorReason` intact. Applies to Request Song, Get Current Track, and the shared
playback factory behind Skip / Play-Resume / Pause.
