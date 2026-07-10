import { Track } from "../shared/types";

/**
 * Returns the first configured blocked term that appears (case-insensitive) as
 * a substring of the track's artist or track name, or undefined if none match.
 * Blank terms are ignored.
 */
export function findBlockedTerm(track: Track, blockedTerms: string[]): string | undefined {
  const haystack = `${track.artist} ${track.name}`.toLowerCase();
  for (const raw of blockedTerms) {
    const term = raw.trim().toLowerCase();
    if (term && haystack.includes(term)) {
      return term;
    }
  }
  return undefined;
}

/** True when the track is explicit and explicit tracks are not allowed. */
export function isExplicitBlocked(track: Track, allowExplicit: boolean): boolean {
  return !allowExplicit && track.explicit;
}

/**
 * True when the track runs longer than `maxSeconds`. A maximum of 0 (or less)
 * disables the check, per Firebot's convention.
 */
export function isTooLong(track: Track, maxSeconds: number): boolean {
  if (maxSeconds <= 0) {
    return false;
  }
  return track.durationMs > maxSeconds * 1000;
}
