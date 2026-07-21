/**
 * Test-harness glue: feeds fake Firebot modules + params into the real script
 * code so we can drive the actual `searchTrack()` / `spotifyFetch()` path
 * against the live Spotify API from a plain Node process.
 *
 * Nothing here reimplements the API client. We only stand in for the Firebot
 * runtime boundary (`initModules`) so the production code under `src/` runs
 * unchanged and any real bug reproduces.
 */
import type { ScriptModules } from "@crowbartools/firebot-custom-scripts-types";

import { resetAuthCache } from "../../src/services/auth";
import { initModules } from "../../src/modules";
import { INTEGRATION_ID } from "../../src/shared/constants";
import type { AuthDefinition } from "../../src/types/spotify";

export interface HarnessEnv {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

/**
 * True when all credentials needed for live Spotify calls are present.
 * Used by the integration tests to decide whether to skip (auth is a run-once
 * `pnpm spotify:auth` setup, not something CI has).
 */
export function hasSpotifyCreds(): boolean {
  return Boolean(
    process.env.SPOTIFY_CLIENT_ID &&
      process.env.SPOTIFY_CLIENT_SECRET &&
      process.env.SPOTIFY_REFRESH_TOKEN
  );
}

/**
 * Reads the credentials the harness needs from `process.env`, failing loudly
 * with guidance when something is missing.
 */
export function readEnv(requireRefreshToken = true): HarnessEnv {
  const clientId = process.env.SPOTIFY_CLIENT_ID ?? "";
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET ?? "";
  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN ?? "";

  const missing: string[] = [];
  if (!clientId) missing.push("SPOTIFY_CLIENT_ID");
  if (!clientSecret) missing.push("SPOTIFY_CLIENT_SECRET");
  if (requireRefreshToken && !refreshToken) missing.push("SPOTIFY_REFRESH_TOKEN");

  if (missing.length > 0) {
    const hint = missing.includes("SPOTIFY_REFRESH_TOKEN")
      ? "\nRun `pnpm spotify:auth` to obtain a refresh token."
      : "\nCopy .env.example to .env and fill in your Spotify app credentials.";
    throw new Error(`Missing required env var(s): ${missing.join(", ")}.${hint}`);
  }

  return { clientId, clientSecret, refreshToken };
}

/** Console-backed logger matching Firebot's logger shape. */
const consoleLogger = {
  debug: (msg: string, ...meta: unknown[]) => console.debug(`[debug] ${msg}`, ...meta),
  info: (msg: string, ...meta: unknown[]) => console.info(`[info] ${msg}`, ...meta),
  warn: (msg: string, ...meta: unknown[]) => console.warn(`[warn] ${msg}`, ...meta),
  error: (msg: string, ...meta: unknown[]) => console.error(`[error] ${msg}`, ...meta),
};

/**
 * Initializes the real script modules with fakes seeded from the harness env.
 *
 * The fake `integrationManager` mirrors how Firebot stores the OAuth token on
 * `integration.definition.auth`. We seed a placeholder access token (so the
 * `not-linked` guard passes) and the real refresh token; the very first API
 * call then exercises the real `refreshAccessToken()` flow to mint a live token.
 */
export function initHarnessModules(env: HarnessEnv): void {
  const definition: { auth: AuthDefinition } = {
    auth: {
      access_token: "seed-token-will-be-refreshed",
      refresh_token: env.refreshToken,
      expires_in: 0,
      token_type: "Bearer",
    },
  };
  const integration = { definition };

  const integrationManager = {
    getIntegrationById: (id: string) => (id === INTEGRATION_ID ? integration : undefined),
    // Persist the refreshed token back onto our fake integration, like Firebot does.
    saveIntegrationAuth: (target: { definition?: { auth?: AuthDefinition } }, auth: AuthDefinition) => {
      if (target.definition) {
        target.definition.auth = auth;
      }
    },
  };

  const modules = {
    logger: consoleLogger,
    integrationManager,
  } as unknown as ScriptModules;

  initModules(modules, {
    spotifyClientId: env.clientId,
    spotifyClientSecret: env.clientSecret,
    // Optional market for live runs; empty by default so behavior is unchanged.
    spotifyCountryCode: process.env.SPOTIFY_COUNTRY_CODE ?? "",
  });

  // Clear any cached expiry from a prior init in this process, so the seeded
  // placeholder token isn't trusted as "fresh" and the first call refreshes.
  resetAuthCache();
}
