import { artistKey, remainingMs, trackKey, userArtistKey } from "./ledger";
import { ErrorReason, Track } from "../shared/types";

/** Cooldown windows, in minutes. 0 disables the corresponding check. */
export interface CooldownWindows {
  noRepeatMinutes: number;
  artistCooldownMinutes: number;
  userArtistCooldownMinutes: number;
}

/** The cooldown that governs a rejection, and how long it still has to run. */
export interface CooldownHit {
  reason: ErrorReason;
  remainingMs: number;
}

const MINUTE_MS = 60_000;

/**
 * Resolves which cooldown, if any, blocks this track for this requester.
 *
 * When several cooldowns apply at once, the one with the GREATEST remaining wait
 * wins — not the most specific one. `errorCooldown` is advice a streamer pipes
 * into chat, and reporting the shorter of two live cooldowns would tell the
 * requester to retry at a moment they would be rejected again. Specificity would
 * pick `recently-played` (5 minutes left) over an artist cooldown with 58; that
 * answer is more precise about the cause and useless about the remedy.
 *
 * The per-requester check is skipped entirely when `requestedBy` is blank: a
 * trigger with no username is a timer or a startup event, and bucketing all of
 * them together would let the streamer's own automation rate-limit itself.
 *
 * Returns undefined when no cooldown applies.
 */
export function resolveCooldown(
  track: Track,
  requestedBy: string,
  windows: CooldownWindows,
  now: number = Date.now()
): CooldownHit | undefined {
  const primaryArtistId = track.artistIds[0];

  const hits: CooldownHit[] = [
    {
      reason: "recently-played",
      remainingMs: remainingMs(trackKey(track.uri), windows.noRepeatMinutes * MINUTE_MS, now),
    },
  ];

  if (primaryArtistId) {
    hits.push({
      reason: "artist-recently-played",
      remainingMs: remainingMs(
        artistKey(primaryArtistId),
        windows.artistCooldownMinutes * MINUTE_MS,
        now
      ),
    });

    if (requestedBy) {
      hits.push({
        reason: "user-artist-recently-played",
        remainingMs: remainingMs(
          userArtistKey(requestedBy, primaryArtistId),
          windows.userArtistCooldownMinutes * MINUTE_MS,
          now
        ),
      });
    }
  }

  // A disabled or elapsed window contributes 0 remaining, so it can never win.
  const live = hits.filter((hit) => hit.remainingMs > 0);
  if (live.length === 0) {
    return undefined;
  }
  return live.reduce((longest, hit) => (hit.remainingMs > longest.remainingMs ? hit : longest));
}

/**
 * Remaining cooldown in whole seconds, rounded UP: a viewer 400ms from expiry
 * must be told 1 second, never 0. Because a cooldown rejection always has a
 * remaining wait above zero, this is at least 1 whenever a cooldown is reported
 * — so `errorCooldown: 0` unambiguously means "not rejected by a cooldown".
 */
export function cooldownSeconds(remaining: number): number {
  return Math.ceil(Math.max(0, remaining) / 1000);
}
