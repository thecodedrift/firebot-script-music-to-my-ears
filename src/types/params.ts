/**
 * User-configurable script parameters, resolved by Firebot from
 * `getDefaultParameters()` and supplied on `runRequest.parameters`.
 *
 * Moderation filters and request restrictions are deliberately NOT here: they
 * live on each Request Song effect, so changing them takes effect without
 * restarting Firebot.
 */
export interface Params {
  /** Spotify application client id (from the Spotify developer dashboard). */
  spotifyClientId: string;
  /** Spotify application client secret. */
  spotifyClientSecret: string;
  /**
   * Optional "Country of Play": a 2-letter ISO 3166-1 alpha-2 code sent as the
   * Spotify `market`. Empty (the default) sends no market. See `market()` in
   * `services/api.ts` for how it is validated and applied.
   */
  spotifyCountryCode: string;
  /**
   * Optional global blocklist, one entry per line. Each line is classified by
   * shape: a Spotify artist or track link/URI blocks that exact artist or
   * track; any other line is a case-insensitive term matched against artist and
   * track names. Empty (the default) blocks nothing. Applied to every song
   * request on top of each Request Song effect's own blocked list. See
   * `parseBlockList` / `findBlock` in `services/moderation.ts`.
   */
  spotifyBlockList: string;
}

/**
 * Defaults pre-filled on each Request Song effect (editable per effect).
 *
 * These are duplicated as literals inside the effect's `optionsController`,
 * which Firebot stringifies and evaluates on the FRONTEND — it cannot reference
 * any bundled import, so it cannot read the constants below. Keep the two in
 * sync; the backend `onTriggerEvent` uses these.
 */
export const DEFAULT_BLOCKED_TERMS = ["karaoke", "instrumental", "inst."];

/** Minutes a queued track is ineligible to be requested again. */
export const DEFAULT_NO_REPEAT_MINUTES = 30;

/**
 * The jukebox-protection restrictions ship disabled. `0` disables each, per
 * Firebot convention. Off by default so upgrading changes no behavior; a
 * streamer opts in when one artist starts crowding out the queue.
 */
export const DEFAULT_ARTIST_COOLDOWN_MINUTES = 0;
export const DEFAULT_USER_ARTIST_COOLDOWN_MINUTES = 0;
export const DEFAULT_MAX_TRACK_LENGTH_SECONDS = 0;
