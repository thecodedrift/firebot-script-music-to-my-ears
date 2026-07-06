import { Effects } from "@crowbartools/firebot-custom-scripts-types/types/effects";
import { logger } from "../../modules";
import { toErrorReason } from "../../services/api";
import { namespaced } from "../../shared/constants";
import { ErrorReason } from "../../shared/types";

type Model = Record<string, never>;

interface Outputs {
  success: boolean;
  errorReason: ErrorReason | "";
}

/**
 * Builds a no-option playback-control effect that runs a single API action and
 * reports `success` plus an `errorReason` (e.g. `no-active-device`/`not-premium`).
 */
export function makePlaybackEffect(opts: {
  id: string;
  name: string;
  description: string;
  icon: string;
  action: () => Promise<void>;
}): Effects.EffectType<Model, unknown, Outputs> {
  return {
    definition: {
      id: namespaced(opts.id),
      name: opts.name,
      description: opts.description,
      icon: opts.icon,
      categories: ["integrations"],
      outputs: [
        { label: "Success", description: "Whether the action succeeded.", defaultName: "success" },
        {
          label: "Error Reason",
          description: "Failure reason, when the action fails.",
          defaultName: "errorReason",
        },
      ],
    },
    optionsTemplate: `
      <eos-container header="${opts.name}">
        <p class="muted">${opts.description} This effect has no options.</p>
      </eos-container>
    `,
    onTriggerEvent: async () => {
      try {
        await opts.action();
        return { success: true, outputs: { success: true, errorReason: "" } };
      } catch (error) {
        logger.warn(`${opts.name} failed: ${String(error)}`);
        // Top-level `success` stays `true` so Firebot keeps `outputs`; it discards
        // them on `success: false`, which would blank the failure's `errorReason`.
        // The real pass/fail the streamer branches on is `outputs.success`.
        return { success: true, outputs: { success: false, errorReason: toErrorReason(error) } };
      }
    },
  };
}
