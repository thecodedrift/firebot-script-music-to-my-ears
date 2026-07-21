import { Firebot } from "@crowbartools/firebot-custom-scripts-types";
import { getModules, initModules, logger, setParams } from "./modules";
import { Params } from "./types/params";
import {
  registerSpotifyIntegration,
  teardownSpotifyIntegration,
} from "./services/integration";
import { clear as clearLedger } from "./services/ledger";
import { AllEffects } from "./firebot/effects";

// Injected from package.json at build time; falls back outside the webpack build.
const VERSION = typeof __SCRIPT_VERSION__ !== "undefined" ? __SCRIPT_VERSION__ : "0.0.0";

const script: Firebot.CustomScript<Params> = {
  getScriptManifest: () => ({
    name: "Music to My Ears",
    description: "Spotify song-request and playback effects for Firebot.",
    author: "codedrift",
    version: VERSION,
    firebotVersion: "5",
    startupOnly: true,
  }),

  getDefaultParameters: () => ({
    spotifyClientId: {
      type: "string",
      title: "Spotify Client ID",
      description:
        "From your Spotify app at https://developer.spotify.com/dashboard. " +
        "Add `http://127.0.0.1:7472/api/v1/auth/callback` as a Redirect URI on that app.",
      tip:
        "Authentication can't be done from inside Firebot's prompts. After entering these " +
        "credentials, link your Spotify account from the Integrations page, then restart Firebot " +
        "if you change the credentials.",
      default: "",
    },
    spotifyClientSecret: {
      type: "password",
      title: "Spotify Client Secret",
      description: "The client secret for the same Spotify app.",
      default: "",
    },
    spotifyCountryCode: {
      type: "string",
      title: "Country of Play",
      description:
        "Optional 2-letter country code (ISO 3166-1 alpha-2, e.g. US, GB, DE) used as the " +
        "Spotify market. When set, requests resolve against that country's catalog and " +
        "region-locked tracks are rejected instead of queued. Leave blank to use your linked " +
        "account's country automatically.",
      default: "",
    },
  }),

  run: (runRequest) => {
    const params = runRequest.parameters as Params;
    initModules(runRequest.modules, params);
    logger.info("Music to My Ears: starting up");

    registerSpotifyIntegration({
      id: params.spotifyClientId,
      secret: params.spotifyClientSecret,
    });

    const { effectManager } = runRequest.modules;
    for (const effect of AllEffects) {
      effectManager.registerEffect(effect);
      logger.debug(`Registered effect ${effect.definition.id}`);
    }
  },

  parametersUpdated: (parameters) => {
    setParams(parameters);
  },

  stop: () => {
    logger.info("Music to My Ears: stopping, tearing down registrations");
    const { effectManager } = getModules();
    for (const effect of AllEffects) {
      effectManager.unregisterEffect(effect.definition.id);
    }
    teardownSpotifyIntegration();
    clearLedger();
  },
};

export default script;
