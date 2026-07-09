import { Effects } from "@crowbartools/firebot-custom-scripts-types/types/effects";
import { getParams, logger } from "../../modules";
import { queueTrack, searchTrack, toErrorReason } from "../../services/api";
import { isRecent, record } from "../../services/ledger";
import { findBlockedTerm, isExplicitBlocked } from "../../services/moderation";
import { namespaced } from "../../shared/constants";
import { ErrorReason, Track } from "../../shared/types";
import { DEFAULT_BLOCKED_TERMS } from "../../types/params";

interface Model {
  query: string;
  allowExplicit: boolean;
  /** Per-effect blocked terms (substring, case-insensitive). */
  blockedTerms: string[];
  /** Emit verbose search diagnostics for this effect. Off by default. */
  enableLogging: boolean;
}

interface Outputs {
  success: boolean;
  trackUri: string;
  trackName: string;
  artistName: string;
  errorReason: ErrorReason | "";
}

function failure(reason: ErrorReason, track?: Track): { success: boolean; outputs: Outputs } {
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
          "Why the request failed: not-found, not-playable, blocked-term, explicit, " +
          "recently-played, no-active-device, not-premium, not-linked.",
        defaultName: "errorReason",
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
    </eos-container>
    <eos-container header="Blocked Terms" pad-top="true">
      <editable-list model="effect.blockedTerms" settings="blockedTermsSettings"></editable-list>
      <p class="muted">
        A track is rejected when any term appears (case-insensitive) in its artist or track name.
      </p>
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
  // The default terms are intentionally inlined here for that reason; the backend
  // onTriggerEvent uses the imported DEFAULT_BLOCKED_TERMS instead.
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

      const { noRepeatMinutes } = getParams();
      if (isRecent(track.uri, noRepeatMinutes * 60_000)) {
        return failure("recently-played", track);
      }

      await queueTrack(track.uri);
      // Atomic with the check above: record only what was actually queued.
      record(track.uri, trigger?.metadata?.username ?? "");

      return {
        success: true,
        outputs: {
          success: true,
          trackUri: track.uri,
          trackName: track.name,
          artistName: track.artist,
          errorReason: "",
        },
      };
    } catch (error) {
      logger.warn(`Request Song failed: ${String(error)}`);
      return failure(toErrorReason(error), track);
    }
  },
};
