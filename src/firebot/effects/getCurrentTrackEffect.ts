import { Effects } from "@crowbartools/firebot-custom-scripts-types/types/effects";
import { logger } from "../../modules";
import { currentTrack, toErrorReason } from "../../services/api";
import { errorTextFor } from "../../services/errorText";
import { requesterOf } from "../../services/ledger";
import { namespaced } from "../../shared/constants";
import { ErrorReason } from "../../shared/types";

type Model = Record<string, never>;

interface Outputs {
  isPlaying: boolean;
  trackName: string;
  artistName: string;
  trackUri: string;
  requestedBy: string;
  errorReason: ErrorReason | "";
  errorText: string;
}

export const getCurrentTrackEffect: Effects.EffectType<Model, unknown, Outputs> = {
  definition: {
    id: namespaced("get-current-track"),
    name: "Get Current Track (Spotify)",
    description: "Outputs the currently playing Spotify track and who requested it.",
    icon: "fad fa-music",
    categories: ["integrations"],
    outputs: [
      {
        label: "Is Playing",
        description: "Whether a track is currently playing.",
        defaultName: "isPlaying",
      },
      { label: "Track Name", description: "Name of the current track.", defaultName: "trackName" },
      {
        label: "Artist Name",
        description: "Artist(s) of the current track.",
        defaultName: "artistName",
      },
      { label: "Track URI", description: "Spotify URI of the current track.", defaultName: "trackUri" },
      {
        label: "Requested By",
        description: "Who requested the current track (empty if it was not a request).",
        defaultName: "requestedBy",
      },
      {
        label: "Error Reason",
        description: "Failure reason, when the lookup fails.",
        defaultName: "errorReason",
      },
      {
        label: "Error Text",
        description: "A friendly explanation of the failure, ready to send to chat.",
        defaultName: "errorText",
      },
    ],
  },
  optionsTemplate: `
    <eos-container header="Get Current Track">
      <p class="muted">Outputs the currently playing Spotify track. This effect has no options.</p>
    </eos-container>
  `,
  onTriggerEvent: async () => {
    try {
      const { track, isPlaying } = await currentTrack();
      return {
        success: true,
        outputs: {
          isPlaying,
          trackName: track?.name ?? "",
          artistName: track?.artist ?? "",
          trackUri: track?.uri ?? "",
          requestedBy: track ? requesterOf(track.uri) ?? "" : "",
          errorReason: "",
          errorText: "",
        },
      };
    } catch (error) {
      logger.warn(`Get Current Track failed: ${String(error)}`);
      const reason = toErrorReason(error);
      // Top-level `success` stays `true` so Firebot keeps `outputs`; it discards
      // them on `success: false`, which would blank the failure's `errorReason`.
      // The real pass/fail the streamer branches on is `outputs.success`.
      return {
        success: true,
        outputs: {
          isPlaying: false,
          trackName: "",
          artistName: "",
          trackUri: "",
          requestedBy: "",
          errorReason: reason,
          errorText: errorTextFor(reason),
        },
      };
    }
  },
};
