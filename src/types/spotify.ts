/** OAuth credentials taken from script parameters. */
export interface ClientCredentials {
  id: string;
  secret: string;
}

/**
 * The live OAuth token Firebot stores on the integration definition after the
 * account is linked. Read at runtime via
 * `integrationManager.getIntegrationById(id).definition.auth`.
 */
export interface AuthDefinition {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type?: string;
}

/** Spotify token endpoint response (refresh_token usually omitted on refresh). */
export interface SpotifyRefreshTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
  refresh_token?: string;
}

/** Minimal subset of a Spotify track object we consume. */
export interface SpotifyTrack {
  uri: string;
  name: string;
  explicit: boolean;
  duration_ms: number;
  artists: Array<{ name: string }>;
  type: string;
  /**
   * Present only when Spotify applies track relinking, which requires the
   * request to supply a `market`. We deliberately send none (see the note above
   * `SEARCH_LIMIT` in `services/api.ts`), so on our responses this field is
   * effectively always `undefined`. `false` would mean the track can't be played
   * for the linked account/region.
   */
  is_playable?: boolean;
  /** Why a track is unplayable: `market`, `product`, or `explicit`. */
  restrictions?: { reason?: string };
}

export interface SpotifySearchResponse {
  tracks?: {
    items: SpotifyTrack[];
    /** Total matches Spotify found, which is not the number of `items` returned. */
    total?: number;
    /** Page size Spotify applied, i.e. the `limit` we asked for. */
    limit?: number;
  };
}

export interface SpotifyCurrentlyPlayingResponse {
  is_playing: boolean;
  item: SpotifyTrack | null;
}

/** Spotify error envelope (player endpoints include a `reason` code). */
export interface SpotifyErrorResponse {
  error?: {
    status: number;
    message: string;
    reason?: string;
  };
}
