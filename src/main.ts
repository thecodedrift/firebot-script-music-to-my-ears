import { Firebot } from "@crowbartools/firebot-custom-scripts-types";
import {
  getFirebotVersion,
  getModules,
  getParams,
  initModules,
  logger,
  setParams,
} from "./modules";
import { Params } from "./types/params";
import { registerSpotifyIntegration, teardownSpotifyIntegration } from "./services/integration";
import { clear as clearDebugLog, snapshot } from "./services/debugLog";
import { clear as clearLedger } from "./services/ledger";
import { AllEffects } from "./firebot/effects";
import { namespaced } from "./shared/constants";

// Injected from package.json at build time; falls back outside the webpack build.
const VERSION = typeof __SCRIPT_VERSION__ !== "undefined" ? __SCRIPT_VERSION__ : "0.0.0";

/** Fired by the "Copy debug log" button on the script configuration page. */
const COPY_DEBUG_LOG_EVENT = namespaced("copy-debug-log");

/** The id `frontendCommunicator.onAsync` returns, so `stop()` can unregister. */
let copyDebugLogHandlerId: string | undefined;

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
    spotifyBlockList: {
      type: "string",
      useTextArea: true,
      title: "Blocked artists, tracks & terms",
      description:
        "Optional global blocklist, one entry per line, applied to every song request on top of " +
        "each Request Song effect's own blocked list. A Spotify artist or track link/URI (or a " +
        "bare id) blocks that exact artist or track — so you can ban an artist without banning " +
        "their name as a word; any other line is a case-insensitive term matched against the " +
        "artist and track names. Leave blank to block nothing.",
      default: "",
    },
    // Not a setting: a button, rendered last, that copies the session debug log.
    // Firebot loads this bundle in a SEPARATE process to render this page and
    // calls getDefaultParameters with no modules, so nothing here can read the
    // running script's state — the version is a build-time constant, and the log
    // itself is fetched by the click, which reaches the running script.
    copyDebugLog: {
      type: "button",
      title: `Debug log (Music to My Ears v${VERSION})`,
      description:
        "Copies this Firebot session's Music to My Ears log to your clipboard, including the " +
        "script and Firebot versions and your settings with the client id and secret left out. " +
        "Paste it into a bug report so a broken song request can be traced.",
      tip: "The log is kept in memory only, and is lost when Firebot restarts.",
      buttonText: "Copy debug log",
      backendEventName: COPY_DEBUG_LOG_EVENT,
    },
  }),

  run: (runRequest) => {
    const params = runRequest.parameters as Params;
    initModules(runRequest.modules, params, runRequest.firebot?.version);
    logger.info(`Music to My Ears: starting up (v${VERSION})`);

    const { frontendCommunicator } = runRequest.modules;
    copyDebugLogHandlerId = frontendCommunicator.onAsync(COPY_DEBUG_LOG_EVENT, async () => {
      // Firebot's own "Copy Debug Info" button works exactly this way: the
      // backend hands the text to the frontend, which owns the clipboard.
      frontendCommunicator.send("copy-to-clipboard", {
        text: snapshot({
          scriptVersion: VERSION,
          firebotVersion: getFirebotVersion(),
          params: getParams(),
        }),
        toastMessage: "Music to My Ears debug log copied to clipboard",
      });
    });

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
    const { effectManager, frontendCommunicator } = getModules();
    for (const effect of AllEffects) {
      effectManager.unregisterEffect(effect.definition.id);
    }
    if (copyDebugLogHandlerId) {
      frontendCommunicator.off(COPY_DEBUG_LOG_EVENT, copyDebugLogHandlerId);
      copyDebugLogHandlerId = undefined;
    }
    teardownSpotifyIntegration();
    clearLedger();
    // Last: the lines above are worth keeping if anything here goes wrong.
    clearDebugLog();
  },
};

export default script;
