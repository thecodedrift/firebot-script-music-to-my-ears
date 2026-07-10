import { Effects } from "@crowbartools/firebot-custom-scripts-types/types/effects";
import { logger } from "../../modules";
import { queueTrack, searchTrack, toErrorReason } from "../../services/api";
import { errorTextFor } from "../../services/errorText";
import { record } from "../../services/ledger";
import { findBlockedTerm, isExplicitBlocked, isTooLong } from "../../services/moderation";
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
  /** Per-effect blocked terms (substring, case-insensitive). */
  blockedTerms: string[];
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
  cooldown = 0
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
        // The primary artist, not the joined credit list: that is what the
        // artist cooldowns key on, so it is what the message must name.
        artistName: track?.artists[0],
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
          "Why the request failed: not-found, not-playable, blocked-term, explicit, too-long, " +
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
      <h4 style="margin-top:15px">Blocked terms</h4>
      <editable-list model="effect.blockedTerms" settings="blockedTermsSettings"></editable-list>
      <p class="muted">
        A track is rejected when any term appears (case-insensitive) in its artist or track name.
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
        matches, and the raw response to the Firebot log. Verbose by design — turn it on to work
        out why a request matched the wrong track, then turn it back off.
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
    $scope.blockedTermsSettings = {
      sortable: false,
      showIndex: false,
      addLabel: "Add term",
      editLabel: "Edit term",
      inputPlaceholder: "Enter blocked term",
      noneAddedText: "No blocked terms",
      noDuplicates: true,
      trigger: $scope.trigger,
      triggerMeta: $scope.triggerMeta,
    };
    // Seed defaults on a fresh effect; an emptied list stays empty (means "no terms").
    if ($scope.effect.blockedTerms === undefined) {
      $scope.effect.blockedTerms = ["karaoke", "instrumental", "inst."];
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
    const query = (effect.query ?? "").trim();
    if (!query) {
      return failure("not-found");
    }

    let track: Track | undefined;
    try {
      track = await searchTrack(query, { log: Boolean(effect.enableLogging) });
      if (!track) {
        return failure("not-found");
      }

      // Permanent rejections first, first match wins: a track that is too long or
      // explicit will never succeed, so "don't ask again" beats "ask again later".
      //
      // Per-effect terms; fall back to defaults only when the field was never set.
      const blockedTerms = Array.isArray(effect.blockedTerms)
        ? effect.blockedTerms
        : DEFAULT_BLOCKED_TERMS;
      if (findBlockedTerm(track, blockedTerms)) {
        return failure("blocked-term", track);
      }
      if (isExplicitBlocked(track, Boolean(effect.allowExplicit))) {
        return failure("explicit", track);
      }
      if (isTooLong(track, num(effect.maxTrackLengthSeconds, DEFAULT_MAX_TRACK_LENGTH_SECONDS))) {
        return failure("too-long", track);
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
        return failure(hit.reason, track, cooldownSeconds(hit.remainingMs));
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
