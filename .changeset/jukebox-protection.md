---
"firebot-script-music-to-my-ears": major
---

Add jukebox protection to the Request Song effect, and ship a friendly failure message with every
error.

**Breaking: the no-repeat window moved.** It is no longer a script setting. Each Request Song effect
now has its own **Same track cooldown (minutes)** under a new **Restrictions** section, defaulting to
30 — the same value the script setting defaulted to. If you had changed the old **No-Repeat Window**
from 30, set it again on each Request Song effect after upgrading. Nothing else changes behavior.

**Jukebox protection.** The no-repeat window stops the same *track* being requeued, but nothing
stopped the same *artist* from crowding out the queue: two fans of one band could stack hours of it
without ever repeating a track. Three new per-effect restrictions, all disabled by default:

- **Artist cooldown** — how long before that artist can be requested again **by anyone**. This
  protects the variety of the playlist, so it applies to every viewer, not only the one who requested
  the artist. Only the track's primary artist is gated, and artists are matched by Spotify id rather
  than by name.
- **Artist cooldown per viewer** — how long before the *same* viewer can request that artist again.
  Skipped entirely for triggers that carry no username, such as timers.
- **Maximum track length** — rejects anything longer than the configured number of seconds.

Each has its own `errorReason`: `artist-recently-played`, `user-artist-recently-played`, `too-long`.

**When several cooldowns apply at once, the one with the longest remaining wait is reported** — not
the most specific one. Telling a viewer "try again in 5 minutes" while a 58-minute artist cooldown is
still running would send them back to be rejected a second time.

**Two new outputs.** `errorText` is a prebuilt message you can send straight to chat, on the Request
Song effect and on every other effect that reports an `errorReason`. `errorCooldown` is the remaining
wait in whole seconds, and is `0` whenever the failure was not a cooldown. Branch on `errorReason` when
you want your own wording; use `errorText` when you don't.
