import { Effects } from "@crowbartools/firebot-custom-scripts-types/types/effects";
import { getParams, logger } from "../../modules";
import { queueTrack, searchTrack, toErrorReason } from "../../services/api";
import { errorTextFor } from "../../services/errorText";
import { record } from "../../services/ledger";
import {
  BlockHit,
  findBlock,
  isExplicitBlocked,
  isTooLong,
  parseBlockList,
} from "../../services/moderation";
import { cooldownSeconds, resolveCooldown } from "../../services/restrictions";
import { namespaced } from "../../shared/constants";
import { ErrorReason, Track } from "../../shared/types";
import {
  DEFAULT_ARTIST_COOLDOWN_MINUTES,
  DEFAULT_BLOCKED_TERMS,
  DEFAULT_MAX_TRACK_LENGTH_SECONDS,
  DEFAULT_NO_REPEAT_MINUTES,
  DEFAULT_USER_ARTIST_COOLDOWN_MINUTES,
} from "../../types/params";

interface Model {
  query: string;
  allowExplicit: boolean;
  /**
   * Per-effect blocklist, one entry per line (terms, or Spotify artist/track
   * links/URIs). A `string[]` from an effect saved before this became a textarea
   * is still accepted; `parseBlockList` handles both.
   */
  blockedTerms: string | string[];
  /** Minutes the same track is ineligible to be requested again. 0 disables. */
  noRepeatMinutes: number;
  /** Minutes an artist is ineligible for anyone. 0 disables. */
  artistCooldownMinutes: number;
  /** Minutes an artist is ineligible for the same requester. 0 disables. */
  userArtistCooldownMinutes: number;
  /** Longest track that may be queued, in seconds. 0 disables. */
  maxTrackLengthSeconds: number;
  /** Emit verbose search diagnostics for this effect. Off by default. */
  enableLogging: boolean;
}

interface Outputs {
  success: boolean;
  trackUri: string;
  trackName: string;
  artistName: string;
  errorReason: ErrorReason | "";
  errorText: string;
  /** Seconds until the reported cooldown expires; 0 for every other reason. */
  errorCooldown: number;
}

/** Maps what the blocklist matched to the effect's `errorReason` output. */
const BLOCK_REASON: Record<BlockHit["kind"], ErrorReason> = {
  term: "blocked-term",
  artist: "blocked-artist",
  track: "blocked-track",
};

/**
 * Reads a numeric model field, falling back only when it was never set.
 *
 * Accepts a numeric string as well as a number: Firebot's `firebot-input` may
 * hand back `"60"` rather than `60`. Rejecting a string here would silently fall
 * back to the default and quietly disable a restriction the streamer configured.
 */
export function num(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function failure(
  reason: ErrorReason,
  track?: Track,
  cooldown = 0,
  artistName?: string
): { success: boolean; outputs: Outputs } {
  // Top-level `success` must stay `true`: Firebot's effect-runner only registers
  // `outputs` when the effect reports success (it discards them on `success: false`),
  // which would blank out `errorReason` for downstream effects. The pass/fail the
  // streamer branches on lives in `outputs.success`, not here.
  return {
    success: true,
    outputs: {
      success: false,
      trackUri: "",
      trackName: track?.name ?? "",
      artistName: track?.artist ?? "",
      errorReason: reason,
      errorText: errorTextFor(reason, {
        trackName: track?.name,
        // Default to the primary artist (what the artist cooldowns key on), but
        // let the caller override with the artist that actually matched: a
        // blocked *featured* artist must be named, not the primary credit.
        artistName: artistName ?? track?.artists[0],
        cooldown: cooldown || undefined,
      }),
      errorCooldown: cooldown,
    },
  };
}

export const requestSongEffect: Effects.EffectType<Model, unknown, Outputs> = {
  definition: {
    id: namespaced("request-song"),
    name: "Request Song (Spotify)",
    description: "Searches, moderates, and queues a track. Outputs success or a reason it failed.",
    icon: "fad fa-plus-circle",
    categories: ["integrations"],
    outputs: [
      {
        label: "Success",
        description: "Whether the track passed moderation and was queued.",
        defaultName: "success",
      },
      {
        label: "Track URI",
        description: "Spotify URI of the queued track (empty on failure).",
        defaultName: "trackUri",
      },
      { label: "Track Name", description: "Name of the matched track.", defaultName: "trackName" },
      {
        label: "Artist Name",
        description: "Artist(s) of the matched track.",
        defaultName: "artistName",
      },
      {
        label: "Error Reason",
        description:
          "Why the request failed: not-found, not-playable, blocked-term, blocked-artist, " +
          "blocked-track, explicit, too-long, " +
          "recently-played, artist-recently-played, user-artist-recently-played, " +
          "no-active-device, not-premium, not-linked, unknown.",
        defaultName: "errorReason",
      },
      {
        label: "Error Text",
        description: "A friendly explanation of the failure, ready to send to chat.",
        defaultName: "errorText",
      },
      {
        label: "Error Cooldown",
        description:
          "Seconds until the reported cooldown expires. 0 when the failure was not a cooldown.",
        defaultName: "errorCooldown",
      },
    ],
  },
  optionsTemplate: `
    <eos-container header="Song Request">
      <firebot-input
        model="effect.query"
        placeholder-text="Search query (track name, artist, or Spotify URL)"
      />
      <p class="muted">Supports replace variables, e.g. <code>$arg[all]</code>.</p>
    </eos-container>
    <eos-container header="Moderation" pad-top="true">
      <label class="control-fb control--checkbox">Allow explicit tracks
        <input type="checkbox" ng-model="effect.allowExplicit" />
        <div class="control__indicator"></div>
      </label>
      <p class="muted">When off (default), tracks Spotify marks explicit are rejected.</p>
      <h4 style="margin-top:15px">Blocked terms, artists &amp; tracks</h4>
      <textarea
        ng-model="effect.blockedTerms"
        class="form-control"
        rows="4"
        placeholder="One per line: a term, or a Spotify artist/track link"
      ></textarea>
      <p class="muted">
        One entry per line. A Spotify <b>artist</b> or <b>track</b> link (or URI) blocks that exact
        artist or track — so you can ban an artist without banning their name as a word. Any other
        line is a term, rejected when it appears (case-insensitive) in the artist or track name. The
        global blocklist in the script settings applies here too.
      </p>
    </eos-container>
    <eos-container header="Restrictions" pad-top="true">
      <p class="muted">
        Keeps one track — or one artist — from crowding out the queue. Set any to
        <code>0</code> to turn it off.
      </p>
      <firebot-input
        input-title="Same track cooldown (minutes)"
        input-type="number"
        model="effect.noRepeatMinutes"
        placeholder-text="30"
      />
      <p class="muted">How long before the same track can be requested again.</p>
      <firebot-input
        input-title="Artist cooldown (minutes)"
        input-type="number"
        model="effect.artistCooldownMinutes"
        placeholder-text="0"
        style="margin-top:10px"
      />
      <p class="muted">
        How long before that artist can be requested again <b>by anyone</b>. This protects the
        variety of the playlist, so it applies to every viewer — not only the one who requested it.
      </p>
      <firebot-input
        input-title="Artist cooldown per viewer (minutes)"
        input-type="number"
        model="effect.userArtistCooldownMinutes"
        placeholder-text="0"
        style="margin-top:10px"
      />
      <p class="muted">How long before the <b>same viewer</b> can request that artist again.</p>
      <firebot-input
        input-title="Maximum track length (seconds)"
        input-type="number"
        model="effect.maxTrackLengthSeconds"
        placeholder-text="0"
        style="margin-top:10px"
      />
      <p class="muted">Longest track that may be queued. 420 is a reasonable 7-minute cap.</p>
    </eos-container>
    <eos-container header="Troubleshooting" pad-top="true">
      <label class="control-fb control--checkbox">Enable logging
        <input type="checkbox" ng-model="effect.enableLogging" />
        <div class="control__indicator"></div>
      </label>
      <p class="muted">
        When on, writes the Spotify search query, every candidate returned, the total number of
        matches, and the raw response to the Firebot log — and logs each rejected request with the
        reason it was turned away. Verbose by design — turn it on to work out why a request matched
        the wrong track or was refused, then turn it back off.
      </p>
    </eos-container>
  `,
  // IMPORTANT: optionsController is stringified and eval'd on the FRONTEND, so it
  // must not reference any bundled import or module variable (that throws e.g.
  // "params_1 is not defined"). Use only $scope, Angular services, and literals.
  // The defaults are intentionally inlined here for that reason; the backend
  // onTriggerEvent uses the imported DEFAULT_* constants instead. Keep in sync
  // with src/types/params.ts.
  optionsController: ($scope) => {
    // Migrate an effect saved when this was an editable-list: its `string[]`
    // becomes newline text so it renders in the textarea and re-saves in the new
    // shape. Seed the defaults on a brand-new effect; an emptied field ("") is a
    // deliberate "no entries" and is left alone.
    if (Array.isArray($scope.effect.blockedTerms)) {
      $scope.effect.blockedTerms = $scope.effect.blockedTerms.join("\n");
    } else if ($scope.effect.blockedTerms === undefined) {
      $scope.effect.blockedTerms = "karaoke\ninstrumental\ninst.";
    }
    if ($scope.effect.enableLogging === undefined) {
      $scope.effect.enableLogging = false;
    }
    if ($scope.effect.noRepeatMinutes === undefined) {
      $scope.effect.noRepeatMinutes = 30;
    }
    if ($scope.effect.artistCooldownMinutes === undefined) {
      $scope.effect.artistCooldownMinutes = 0;
    }
    if ($scope.effect.userArtistCooldownMinutes === undefined) {
      $scope.effect.userArtistCooldownMinutes = 0;
    }
    if ($scope.effect.maxTrackLengthSeconds === undefined) {
      $scope.effect.maxTrackLengthSeconds = 0;
    }
  },
  onTriggerEvent: async ({ effect, trigger }) => {
    const log = Boolean(effect.enableLogging);

    // Same gate as the search diagnostics: when logging is on, record why a
    // request was turned away, so a streamer can see the rejection that follows
    // the search rather than only the search. Emitted at `info` so the checkbox
    // alone surfaces it, without raising Firebot's global log level.
    const reject = (reason: ErrorReason, track?: Track, cooldown = 0, artistName?: string) => {
      if (log) {
        logger.info(
          `Song request rejected [${reason}]: ${JSON.stringify({
            track: track?.name,
            artist: artistName ?? track?.artists[0],
            uri: track?.uri,
            ...(cooldown ? { retryInSeconds: cooldown } : {}),
          })}`
        );
      }
      return failure(reason, track, cooldown, artistName);
    };

    const query = (effect.query ?? "").trim();
    if (!query) {
      return reject("not-found");
    }

    let track: Track | undefined;
    try {
      track = await searchTrack(query, { log });
      if (!track) {
        return reject("not-found");
      }

      // Permanent rejections first, first match wins: a track that is too long or
      // explicit will never succeed, so "don't ask again" beats "ask again later".
      //
      // The global blocklist (script settings) is merged ahead of this effect's
      // own list. A never-set per-effect field falls back to the defaults; an
      // empty string is a deliberate "no entries" and is honored as such.
      const perEffect =
        effect.blockedTerms === undefined ? DEFAULT_BLOCKED_TERMS : effect.blockedTerms;
      const blocked = findBlock(track, [
        ...parseBlockList(getParams().spotifyBlockList),
        ...parseBlockList(perEffect),
      ]);
      if (blocked) {
        return reject(BLOCK_REASON[blocked.kind], track, 0, blocked.artist);
      }
      if (isExplicitBlocked(track, Boolean(effect.allowExplicit))) {
        return reject("explicit", track);
      }
      if (isTooLong(track, num(effect.maxTrackLengthSeconds, DEFAULT_MAX_TRACK_LENGTH_SECONDS))) {
        return reject("too-long", track);
      }

      // Then the transient cooldowns, resolved together: when several apply, the
      // one with the longest remaining wait is reported, so the retry advice in
      // `errorCooldown` is true rather than merely specific.
      const requestedBy = trigger?.metadata?.username ?? "";
      const hit = resolveCooldown(track, requestedBy, {
        noRepeatMinutes: num(effect.noRepeatMinutes, DEFAULT_NO_REPEAT_MINUTES),
        artistCooldownMinutes: num(effect.artistCooldownMinutes, DEFAULT_ARTIST_COOLDOWN_MINUTES),
        userArtistCooldownMinutes: num(
          effect.userArtistCooldownMinutes,
          DEFAULT_USER_ARTIST_COOLDOWN_MINUTES
        ),
      });
      if (hit) {
        return reject(hit.reason, track, cooldownSeconds(hit.remainingMs));
      }

      await queueTrack(track.uri);
      // Atomic with the checks above: record only what was actually queued. Writes
      // are unconditional — a disabled window here must not hole another effect's.
      record(track.uri, requestedBy, track.artistIds[0]);

      return {
        success: true,
        outputs: {
          success: true,
          trackUri: track.uri,
          trackName: track.name,
          artistName: track.artist,
          errorReason: "",
          errorText: "",
          errorCooldown: 0,
        },
      };
    } catch (error) {
      logger.warn(`Request Song failed: ${String(error)}`);
      return failure(toErrorReason(error), track);
    }
  },
};
