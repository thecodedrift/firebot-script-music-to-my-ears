---
"firebot-script-music-to-my-ears": patch
---

Fix bug reports arriving with no logs. The script now keeps its own log of the Firebot session —
every search, candidate, and refused request, at every level and whatever your Firebot log level is
— and the script settings page has a **Copy debug log** button that puts the lot on your clipboard,
prefixed with the script and Firebot versions and your settings (client id and secret left out).

The per-effect **Enable logging** checkbox is gone with it. It defaulted to off, which meant the
records were missing from exactly the sessions that needed them; those diagnostics are now always
recorded, and they moved from `info` to `debug`, so Firebot's own log file gets quieter.
