# Music to My Ears

A custom script for [Firebot](https://github.com/crowbartools/Firebot) that lets your Twitch
viewers request music and control playback through **Spotify**. It ships a small toolkit of
Firebot **effects** (Actions) that you wire into your own commands, channel-point redemptions, or
buttons — you choose the trigger and the chat messaging; the script handles search, moderation,
queueing, and playback.

> **Spotify Premium is required.** Queue, skip, play, and pause all need a Premium account with an
> active playback device (the Spotify app open and playing somewhere).

## Features

- **Request Song** — searches Spotify (tracks only; podcasts/episodes are never returned),
  moderates, and queues the track in one atomic action. Outputs a single `success` flag plus an
  `errorReason`, so you can branch (e.g. refund a redemption) on one condition.
  - Per-effect **blocked-terms** list (case-insensitive substring match on artist + track name),
    pre-filled with `karaoke`, `instrumental`, `inst.`
  - Per-effect **"allow explicit tracks"** toggle (off by default)
  - **Jukebox protection**: cooldowns on the same track, on an artist (for everyone), and on an
    artist per viewer — so one band can't crowd out the queue — plus a **maximum track length**
  - A ready-to-send **`errorText`** for every failure, and an **`errorCooldown`** telling the viewer
    when to try again
- **Skip Track**, **Play / Resume**, **Pause** — single-action playback controls.
- **Get Current Track** — outputs the now-playing track plus **who requested it**.

No system command is registered — the trigger (`!sr`, a reward, a button) and all chat replies are
yours to design using the effects' outputs.

## Requirements

- Firebot v5 (5.65+)
- A Spotify **Premium** account
- A Spotify application (free to create) for OAuth credentials

## Installation

1. **Create a Spotify app** at the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
   - Add this exact **Redirect URI** (note: `127.0.0.1`, not `localhost`, and no trailing `2`):
     ```
     http://127.0.0.1:7472/api/v1/auth/callback
     ```
   - Copy the **Client ID** and **Client Secret**.
2. **Download** `musicToMyEars.js` from the [latest release](../../releases/latest).
3. In Firebot: **Settings → Scripts → Manage Startup Scripts → Add New Script**, and select the
   downloaded file.
4. Open the script's settings, paste your **Client ID** and **Client Secret**, save, then **fully
   restart Firebot** (the credentials are read when the integration registers at startup).
5. Go to **Settings → Integrations**, find **Music to My Ears (Spotify)**, and **Link** your
   account. Authorize in the browser; you'll be redirected back and the integration will show as
   connected.

## Configuration (script settings page)

| Setting                        | Description                                                       |
| ------------------------------ | ----------------------------------------------------------------- |
| **Spotify Client ID / Secret** | From your Spotify app. Changing these requires a Firebot restart. |
| **Copy debug log**             | Copies this session's log to your clipboard for a bug report.     |

Everything else — moderation filters and the request restrictions below — is configured **per
Request Song effect** (so a clean `!sr` and a looser one can differ), not on this page.

### Reporting a problem

The script keeps its own log of everything it does during the Firebot session — every search, every
candidate Spotify returned, and the reason behind every refused request — whatever your Firebot log
level is set to. Nothing needs turning on first.

When a request goes wrong, open the script settings page and click **Copy debug log**, then paste
the result into your bug report. It carries the script and Firebot versions and your settings, with
the client id and secret left out. The log lives in memory only, so copy it before restarting
Firebot.

### Restrictions (per Request Song effect)

| Restriction                                | Default | Description                                                                        |
| ------------------------------------------ | ------- | ---------------------------------------------------------------------------------- |
| **Same track cooldown (minutes)**          | `30`    | How long before the same track can be requested again.                             |
| **Artist cooldown (minutes)**              | `0`     | How long before that artist can be requested again **by anyone**.                  |
| **Artist cooldown per viewer (minutes)**   | `0`     | How long before the **same viewer** can request that artist again.                 |
| **Maximum track length (seconds)**         | `0`     | Longest track that may be queued. `420` is a reasonable 7-minute cap.              |

Set any restriction to `0` to disable it. The three cooldowns ship disabled except the same-track
one; turn on the artist cooldown when one band starts crowding out the queue.

The **artist cooldown applies to every viewer**, not just the one who requested the artist. It exists
to protect the variety of the playlist, so a viewer who has requested nothing may still be told an
artist was played recently. That is intended. Only the track's **primary** artist is gated.

When more than one cooldown applies at once, the effect reports the one with the **longest** remaining
wait — so `errorCooldown` is always a time at which the request will actually succeed.

## Usage

Wire the effects into your own command. A typical song-request command (`!sr`):

1. **Command trigger** `!sr` (or a channel-point reward).
2. **Request Song (Spotify)** effect:
   - **Search query**: `$arg[all]` (or `$redemptionMessage` for a reward). Also accepts a
     Spotify track link (or `spotify:track:` URI / id), which queues that exact track.
     A command trigger that leaks into the text (`!sr Toxic by Britney Spears`, which happens
     with a raw message or a viewer who repeats the trigger) is stripped, so you can wire the
     whole message straight in.
   - Adjust the blocked-terms list / explicit toggle as desired
3. **Branch on the outputs** (effect outputs are read with `$effectOutput[name]`):
   - When `$effectOutput[success]` is `true` → **Chat** effect:
     `🎵 Queued "$effectOutput[trackName]" by $effectOutput[artistName]`
   - Otherwise → send `$effectOutput[errorText]` straight to chat, or branch on
     `$effectOutput[errorReason]` for custom wording (refund the redemption, whisper the viewer, etc.)

### Request Song outputs

| Output                                  | Meaning                                                                                                           |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `success`                               | `true` if the track passed moderation and was queued                                                              |
| `trackUri` / `trackName` / `artistName` | The matched track (empty on failure)                                                                              |
| `errorReason`                           | `not-found` · `not-playable` · `blocked-term` · `explicit` · `too-long` · `recently-played` · `artist-recently-played` · `user-artist-recently-played` · `no-active-device` · `not-premium` · `not-linked` · `unknown` |
| `errorText`                             | A friendly explanation of the failure, ready to send to chat (empty on success)                                   |
| `errorCooldown`                         | Seconds until the reported cooldown expires. `0` when the failure wasn't a cooldown                               |

### Get Current Track outputs

`isPlaying`, `trackName`, `artistName`, `trackUri`, `requestedBy` (who requested the current track
via Request Song, or empty if it wasn't a request), plus `errorReason` and `errorText`.

Playback effects (**Skip / Play / Resume / Pause**) each output `success`, an `errorReason`
(`no-active-device` / `not-premium` / `not-linked`), and an `errorText` so you can react to failures.

## Development

```bash
pnpm install
pnpm build           # production single-file bundle → dist/musicToMyEars.js
pnpm build:dev       # dev build + deploy into Firebot (see below)
pnpm test            # jest
pnpm lint            # eslint
pnpm typecheck       # tsc --noEmit
```

To auto-deploy a dev build into your Firebot profile, point `FIREBOT_SCRIPTS_DIR` at your profile's
`scripts` folder:

```bash
FIREBOT_SCRIPTS_DIR="/path/to/Firebot/v5/profiles/Main Profile/scripts" pnpm build:dev
```

Architecture and conventions are documented in
[.conventions/architecture.md](.conventions/architecture.md). The project uses
[OpenSpec](https://github.com/Fission-AI/OpenSpec) for spec-driven development — run it through the
package script (`pnpm openspec <command>`).

### Releasing

Versioning and changelogs are managed with [Changesets](https://github.com/changesets/changesets):

1. Add a changeset describing your change: `pnpm changeset`
2. On merge to `main`, CI opens a **"Version Packages"** PR that bumps the version and updates the
   changelog.
3. Merging that PR builds the bundle, tags the version, and publishes a **GitHub Release** with
   `musicToMyEars.js` attached.

## License

MIT
