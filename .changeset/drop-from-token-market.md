---
"firebot-script-music-to-my-ears": patch
---

Stop sending the deprecated `market=from_token` parameter on Spotify track and
search requests. Spotify removed `from_token` in its November 2024 API changes
and now rejects it (with a misleading error) on some endpoints and accounts,
which could make name searches fail while direct links still worked. With a
valid user token, Spotify uses the account's own country automatically, so the
correct per-account catalog and `is_playable` are preserved without the
deprecated value. Also adds a debug log when a name search resolves to no
playable track, so the previously silent "not found" path is diagnosable.

Adds a triage debug block on every failed Spotify response capturing the
request shape, the response (status, status text, retry-after / request-id,
body), and the derived error. It deliberately omits the Authorization header,
access token, and client secret, and redacts user-content query values (search
text, track uris) from the logged endpoint.
