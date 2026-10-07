import type {
  ProviderReference,
  ResolvedTrackMetadata,
} from "../domain/resolved-track-metadata.js";

const messages = {
  INVALID_REFERENCE: "Invalid Spotify track URL or market.",
  CREDENTIALS_MISSING: "Spotify application credentials are missing.",
  AUTHENTICATION_FAILED: "Spotify authentication failed.",
  RATE_LIMITED: "Spotify request was rate limited.",
  TRACK_UNAVAILABLE: "Spotify track is unavailable.",
  REQUEST_FAILED: "Spotify request failed.",
  MALFORMED_RESPONSE: "Spotify returned malformed metadata.",
} as const;

export type SpotifyResolutionErrorCode = keyof typeof messages;

export class SpotifyResolutionError extends Error {
  constructor(
    public readonly code: SpotifyResolutionErrorCode,
    public readonly retryAfterSeconds?: number,
  ) {
    super(messages[code]);
    this.name = "SpotifyResolutionError";
  }
}

const trackIdPattern = /^[A-Za-z0-9]{22}$/;

function reference(itemId: string, market?: string): ProviderReference {
  return {
    provider: "spotify",
    entityType: "track",
    itemId,
    url: `https://open.spotify.com/track/${itemId}`,
    ...(market === undefined ? {} : { market }),
  };
}

export function parseSpotifyTrackUrl(
  input: string,
  market?: string,
): ProviderReference {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new SpotifyResolutionError("INVALID_REFERENCE");
  }
  const match = /^\/(?:intl-[a-z]{2}\/)?track\/([A-Za-z0-9]{22})\/?$/.exec(url.pathname);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "open.spotify.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    !match ||
    (market !== undefined && !/^[A-Z]{2}$/.test(market))
  ) {
    throw new SpotifyResolutionError("INVALID_REFERENCE");
  }
  // Locale/share parameters are not market selection. Store a canonical URL.
  return reference(match[1], market);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function malformed(): never {
  throw new SpotifyResolutionError("MALFORMED_RESPONSE");
}

function normalize(
  value: unknown,
  requested: ProviderReference,
): ResolvedTrackMetadata {
  if (
    !record(value) || value.type !== "track" ||
    typeof value.id !== "string" || !trackIdPattern.test(value.id)
  ) malformed();
  const title = text(value.name);
  if (!title || !Array.isArray(value.artists) || value.artists.length === 0) malformed();
  const artists = value.artists.map((artist) => {
    if (!record(artist)) malformed();
    const name = text(artist.name);
    if (!name) malformed();
    return name;
  });
  if (
    value.is_playable === false ||
    (record(value.restrictions) && text(value.restrictions.reason))
  ) {
    throw new SpotifyResolutionError("TRACK_UNAVAILABLE");
  }
  const result: ResolvedTrackMetadata = {
    references: [requested],
    title,
    artists,
  };
  if (value.id !== requested.itemId) {
    result.references.push(reference(value.id, requested.market));
  }
  if (value.duration_ms !== undefined) {
    if (
      typeof value.duration_ms !== "number" ||
      !Number.isSafeInteger(value.duration_ms) || value.duration_ms < 0
    ) malformed();
    result.durationMs = value.duration_ms;
  }
  if (value.explicit !== undefined && typeof value.explicit !== "boolean") malformed();
  // Spotify false means non-explicit OR unknown; do not assert clean lyrics.
  if (value.explicit === true) result.explicit = true;
  if (value.external_ids !== undefined) {
    if (!record(value.external_ids)) malformed();
    if (
      value.external_ids.isrc !== undefined &&
      typeof value.external_ids.isrc !== "string"
    ) malformed();
    const isrc = text(value.external_ids.isrc);
    if (isrc) result.isrc = isrc;
  }
  if (value.album !== undefined) {
    if (!record(value.album)) malformed();
    const album: NonNullable<ResolvedTrackMetadata["album"]> = {};
    if (value.album.name !== undefined && typeof value.album.name !== "string") {
      malformed();
    }
    const name = text(value.album.name);
    if (name) album.name = name;
    if (
      value.album.release_date !== undefined ||
      value.album.release_date_precision !== undefined
    ) {
      const precision = value.album.release_date_precision;
      const date = text(value.album.release_date);
      const patterns = {
        year: /^\d{4}$/,
        month: /^\d{4}-(0[1-9]|1[0-2])$/,
        day: /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/,
      };
      if (
        (precision !== "year" && precision !== "month" && precision !== "day") ||
        !date || !patterns[precision].test(date)
      ) malformed();
      album.releaseDate = date;
      album.releaseDatePrecision = precision;
    }
    if (Object.keys(album).length > 0) result.album = album;
  }
  return result;
}

export type SpotifyResolverOptions = {
  clientId?: string;
  clientSecret?: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
};

export function createSpotifyTrackResolver({
  clientId = process.env.SPOTIFY_CLIENT_ID,
  clientSecret = process.env.SPOTIFY_CLIENT_SECRET,
  fetch: http = globalThis.fetch,
  now = Date.now,
}: SpotifyResolverOptions = {}) {
  let cached: { token: string; refreshAt: number } | undefined;
  let pendingToken: Promise<string> | undefined;

  async function request(
    url: string,
    init: RequestInit,
    authentication = false,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await http(url, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      // Never propagate the fetch exception, headers, URL, or response body.
      throw new SpotifyResolutionError("REQUEST_FAILED");
    }
    if (response.status === 429) {
      const header = response.headers.get("retry-after");
      let seconds: number | undefined;
      if (header !== null) {
        if (/^\d+$/.test(header)) seconds = Number(header);
        else if (/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(header)) {
          const date = Date.parse(header);
          if (Number.isFinite(date)) seconds = Math.max(0, Math.ceil((date - now()) / 1000));
        }
      }
      throw new SpotifyResolutionError(
        "RATE_LIMITED",
        Number.isFinite(seconds) ? seconds : undefined,
      );
    }
    if (!response.ok) {
      if (response.status === 401 || (authentication && [400, 403].includes(response.status))) {
        throw new SpotifyResolutionError("AUTHENTICATION_FAILED");
      }
      if (!authentication && response.status === 404) {
        throw new SpotifyResolutionError("TRACK_UNAVAILABLE");
      }
      throw new SpotifyResolutionError("REQUEST_FAILED");
    }
    try {
      return await response.json();
    } catch {
      throw new SpotifyResolutionError("MALFORMED_RESPONSE");
    }
  }

  async function obtainToken(): Promise<string> {
    if (!clientId?.trim() || !clientSecret?.trim()) {
      throw new SpotifyResolutionError("CREDENTIALS_MISSING");
    }
    const startedAt = now();
    const value = await request("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "client_credentials" }).toString(),
    }, true);
    if (
      !record(value) || !text(value.access_token) ||
      typeof value.access_token !== "string" || /\s/.test(value.access_token) ||
      typeof value.token_type !== "string" || value.token_type.toLowerCase() !== "bearer" ||
      typeof value.expires_in !== "number" ||
      !Number.isFinite(value.expires_in) || value.expires_in <= 0
    ) malformed();
    const lifetime = value.expires_in * 1000;
    if (!Number.isFinite(lifetime) || !Number.isFinite(startedAt + lifetime)) malformed();
    cached = {
      token: value.access_token,
      refreshAt: startedAt + lifetime - Math.min(30_000, lifetime * 0.1),
    };
    return cached.token;
  }

  async function getToken(): Promise<string> {
    if (cached && now() < cached.refreshAt) return cached.token;
    if (!pendingToken) pendingToken = obtainToken();
    const current = pendingToken;
    try {
      return await current;
    } finally {
      if (pendingToken === current) pendingToken = undefined;
    }
  }

  return {
    async resolve(
      url: string,
      options: { market?: string } = {},
    ): Promise<ResolvedTrackMetadata> {
      const requested = parseSpotifyTrackUrl(url, options.market);
      const token = await getToken();
      const endpoint = new URL(`https://api.spotify.com/v1/tracks/${requested.itemId}`);
      if (requested.market) endpoint.searchParams.set("market", requested.market);
      try {
        const value = await request(endpoint.toString(), {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        });
        return normalize(value, requested);
      } catch (error) {
        // Invalidate only the token used by this request; a newer token may exist.
        if (
          error instanceof SpotifyResolutionError &&
          error.code === "AUTHENTICATION_FAILED" && cached?.token === token
        ) cached = undefined;
        throw error;
      }
    },
  };
}
