import { describe, expect, it, vi } from "vitest";

import {
  createSpotifyTrackResolver,
  parseSpotifyTrackUrl,
  SpotifyResolutionError,
  type SpotifyResolverOptions,
} from "../src/providers/spotify.js";

const id = "4cOdK2wGLETKBW3PvgPWqT";
const otherId = "11dFghVXANMlKmJXsNCbNl";
const url = `https://open.spotify.com/track/${id}`;
const requested = { provider: "spotify", entityType: "track", itemId: id, url };
const token = { access_token: "offline-token", token_type: "Bearer", expires_in: 3600 };
const track = {
  type: "track", id, name: " Song ",
  artists: [{ name: " First " }, { name: "Second" }],
  duration_ms: 213000,
  album: { name: "Album", release_date: "1987-07-27", release_date_precision: "day" },
  external_ids: { isrc: "GBARL8700012" }, explicit: true,
};

function json(value: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(value), { status, headers });
}

function setup(options: SpotifyResolverOptions = {}) {
  const http = vi.fn<typeof fetch>(async (input) =>
    String(input).includes("/api/token") ? json(token) : json(track),
  );
  const resolver = createSpotifyTrackResolver({ clientId: "offline-client", clientSecret: "offline-secret", fetch: http, ...options });
  return { http, resolver };
}

describe("Spotify URL parsing", () => {
  it.each([url, `${url}?si=share&utm_source=copy`, `${url}/`, `https://open.spotify.com/intl-de/track/${id}?si=share`])(
    "canonicalizes %s", (input) => expect(parseSpotifyTrackUrl(input)).toEqual(requested),
  );

  it.each([
    `https://open.spotify.com/album/${id}`,
    `https://open.spotify.com/playlist/${id}`,
    `https://open.spotify.com/episode/${id}`,
    `https://open.spotify.com/artist/${id}`,
    `https://open.spotify.com.example.com/track/${id}`,
    `https://example.com/track/${id}`,
    "https://[bad", "not a url", "https://open.spotify.com/track/",
    "https://open.spotify.com/track/123", `https://open.spotify.com/track/${id}!`,
    `https://open.spotify.com/track/${id}/extra`,
    `https://open.spotify.com/intl-german/track/${id}`,
    `http://open.spotify.com/track/${id}`,
    `https://user:pass@open.spotify.com/track/${id}`,
    `https://open.spotify.com:444/track/${id}`,
  ])("rejects %s without making network requests", async (input) => {
    const { http, resolver } = setup();
    expect(() => parseSpotifyTrackUrl(input)).toThrow(SpotifyResolutionError);
    await expect(resolver.resolve(input)).rejects.toMatchObject({ code: "INVALID_REFERENCE" });
    expect(http).not.toHaveBeenCalled();
  });

  it("validates market before network access and does not infer it from locale", async () => {
    const { http, resolver } = setup();
    expect(parseSpotifyTrackUrl(`https://open.spotify.com/intl-de/track/${id}`)).not.toHaveProperty("market");
    await expect(resolver.resolve(url, { market: "bad" })).rejects.toMatchObject({ code: "INVALID_REFERENCE" });
    expect(http).not.toHaveBeenCalled();
  });
});

describe("Spotify authentication", () => {
  it("uses Basic authentication and the Client Credentials form, then a bearer Get Track", async () => {
    const { http, resolver } = setup();
    await resolver.resolve(url, { market: "DE" });
    expect(http.mock.calls[0]).toEqual(["https://accounts.spotify.com/api/token", expect.objectContaining({
      method: "POST", redirect: "error", signal: expect.any(AbortSignal),
      headers: {
        Authorization: `Basic ${Buffer.from("offline-client:offline-secret").toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      }, body: "grant_type=client_credentials",
    })]);
    expect(http.mock.calls[1]).toEqual([`https://api.spotify.com/v1/tracks/${id}?market=DE`, expect.objectContaining({
      method: "GET", headers: { Authorization: "Bearer offline-token" }, redirect: "error",
    })]);
  });

  it("reuses tokens and refreshes at the safety margin and after expiry", async () => {
    let time = 0;
    const { http, resolver } = setup({ now: () => time });
    await resolver.resolve(url);
    time = 3_569_999;
    await resolver.resolve(url);
    expect(http.mock.calls.filter(([input]) => String(input).includes("/api/token"))).toHaveLength(1);
    time = 3_570_000;
    await resolver.resolve(url);
    time = 7_200_000;
    await resolver.resolve(url);
    expect(http.mock.calls.filter(([input]) => String(input).includes("/api/token"))).toHaveLength(3);
  });

  it("shares a pending token request across concurrent callers, including refresh", async () => {
    let time = 0;
    const { http, resolver } = setup({ now: () => time });
    await Promise.all(Array.from({ length: 5 }, () => resolver.resolve(url)));
    expect(http).toHaveBeenCalledTimes(6);
    time = 3_600_000;
    await Promise.all(Array.from({ length: 5 }, () => resolver.resolve(url)));
    expect(http).toHaveBeenCalledTimes(12);
  });

  it.each([{ clientId: "" }, { clientSecret: "" }, { clientId: "   " }])("rejects missing credentials %j", async (options) => {
    const { http, resolver } = setup(options);
    await expect(resolver.resolve(url)).rejects.toMatchObject({ code: "CREDENTIALS_MISSING" });
    expect(http).not.toHaveBeenCalled();
  });

  it.each([400, 401, 403])("classifies token status %s as authentication failure", async (status) => {
    const { http, resolver } = setup();
    http.mockResolvedValueOnce(json({ error: "offline-secret" }, status));
    await expect(resolver.resolve(url)).rejects.toMatchObject({ code: "AUTHENTICATION_FAILED" });
    expect(http).toHaveBeenCalledTimes(1);
  });

  it.each([null, {}, { ...token, access_token: "" }, { ...token, access_token: "invalid token" },
    { ...token, expires_in: 0 }, { ...token, expires_in: "3600" }, { ...token, token_type: "Basic" }])(
    "rejects malformed token response %j", async (value) => {
      const { http, resolver } = setup();
      http.mockResolvedValueOnce(json(value));
      await expect(resolver.resolve(url)).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
      expect(http).toHaveBeenCalledTimes(1);
    },
  );

  it("clears a failed pending token request so a later call can succeed", async () => {
    const { http, resolver } = setup();
    http.mockResolvedValueOnce(json({}, 401));
    const results = await Promise.allSettled([resolver.resolve(url), resolver.resolve(url)]);
    expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(http).toHaveBeenCalledTimes(1);
    await expect(resolver.resolve(url)).resolves.toHaveProperty("title", "Song");
    expect(http).toHaveBeenCalledTimes(3);
  });

  it("invalidates a rejected bearer token without retrying the failed request", async () => {
    const { http, resolver } = setup();
    http.mockResolvedValueOnce(json(token)).mockResolvedValueOnce(json({}, 401));
    await expect(resolver.resolve(url)).rejects.toMatchObject({ code: "AUTHENTICATION_FAILED" });
    expect(http).toHaveBeenCalledTimes(2);
    await resolver.resolve(url);
    expect(http).toHaveBeenCalledTimes(4);
  });

  it("does not invalidate a newer token when an older in-flight request fails", async () => {
    let time = 0;
    let finishOldRequest!: (response: Response) => void;
    let markOldRequestStarted!: () => void;
    const oldRequestStarted = new Promise<void>((resolve) => { markOldRequestStarted = resolve; });
    const oldResponse = new Promise<Response>((resolve) => { finishOldRequest = resolve; });
    const { http, resolver } = setup({ now: () => time });
    http.mockResolvedValueOnce(json(token)).mockImplementationOnce(async () => {
      markOldRequestStarted();
      return oldResponse;
    });
    const oldResult = resolver.resolve(url).catch((error: unknown) => error);
    await oldRequestStarted;
    time = 3_600_000;
    http.mockResolvedValueOnce(json({ ...token, access_token: "new-offline-token" }));
    await resolver.resolve(url);
    finishOldRequest(json({}, 401));
    expect(await oldResult).toMatchObject({ code: "AUTHENTICATION_FAILED" });
    await resolver.resolve(url);
    expect(http.mock.calls.filter(([input]) => String(input).includes("/api/token"))).toHaveLength(2);
    expect(http.mock.calls.at(-1)?.[1]?.headers).toEqual({ Authorization: "Bearer new-offline-token" });
  });
});

describe("Spotify normalization", () => {
  it("normalizes metadata with ordered artists and provider references", async () => {
    const { resolver } = setup();
    expect(await resolver.resolve(url)).toEqual({
      references: [requested], title: "Song", artists: ["First", "Second"],
      durationMs: 213000, album: { name: "Album", releaseDate: "1987-07-27", releaseDatePrecision: "day" },
      isrc: "GBARL8700012", explicit: true,
    });
  });

  it("retains requested and different returned references with market context", async () => {
    const { http, resolver } = setup();
    http.mockResolvedValueOnce(json(token)).mockResolvedValueOnce(json({ ...track, id: otherId }));
    expect((await resolver.resolve(url, { market: "DE" })).references).toEqual([
      { ...requested, market: "DE" },
      { ...requested, itemId: otherId, url: `https://open.spotify.com/track/${otherId}`, market: "DE" },
    ]);
  });

  it("allows absent optional metadata with valid artists", async () => {
    const { http, resolver } = setup();
    http.mockResolvedValueOnce(json(token)).mockResolvedValueOnce(json({
      type: "track", id, name: "Song", artists: [{ name: "First" }],
    }));
    expect(await resolver.resolve(url)).toEqual({ references: [requested], title: "Song", artists: ["First"] });
  });

  it.each([
    { label: "empty array", artists: [] },
    { label: "null entry", artists: [null] },
    { label: "non-object entry", artists: ["First"] },
    { label: "array entry", artists: [[{ name: "First" }]] },
    { label: "missing name", artists: [{}] },
    { label: "non-string name", artists: [{ name: 123 }] },
    { label: "empty name", artists: [{ name: "" }] },
    { label: "whitespace-only name", artists: [{ name: " \t\n " }] },
    { label: "valid then null", artists: [{ name: "First" }, null] },
    { label: "malformed then valid", artists: [{}, { name: "Second" }] },
    { label: "valid then empty name", artists: [{ name: "First" }, { name: "" }] },
  ])("rejects artists with $label", async ({ artists }) => {
    const { http, resolver } = setup();
    http.mockResolvedValueOnce(json(token)).mockResolvedValueOnce(json({ ...track, artists }));
    await expect(resolver.resolve(url)).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
  });

  it("does not interpret explicit false as confirmed clean lyrics; missing ISRC is allowed", async () => {
    const { http, resolver } = setup();
    http.mockResolvedValueOnce(json(token)).mockResolvedValueOnce(json({ ...track, explicit: false, external_ids: {} }));
    const result = await resolver.resolve(url);
    expect(result).not.toHaveProperty("explicit");
    expect(result).not.toHaveProperty("isrc");
  });

  it.each([["1987", "year"], ["1987-07", "month"], ["1987-07-27", "day"]])(
    "retains release date %s with precision %s", async (date, precision) => {
      const { http, resolver } = setup();
      http.mockResolvedValueOnce(json(token)).mockResolvedValueOnce(json({ ...track, album: { release_date: date, release_date_precision: precision } }));
      expect((await resolver.resolve(url)).album).toEqual({ releaseDate: date, releaseDatePrecision: precision });
    },
  );

  it.each([null, [], {}, { ...track, type: "episode" }, { ...track, id: "bad" },
    { ...track, name: undefined }, { ...track, name: " " }, { ...track, artists: [] },
    { ...track, artists: [{ name: " " }, null] }, { ...track, artists: {} },
    { ...track, duration_ms: -1 }, { ...track, duration_ms: "123" }, { ...track, explicit: "false" },
    { ...track, album: "bad" }, { ...track, album: { release_date: "1987", release_date_precision: "week" } },
    { ...track, external_ids: { isrc: 123 } }])("rejects malformed track %j", async (value) => {
    const { http, resolver } = setup();
    http.mockResolvedValueOnce(json(token)).mockResolvedValueOnce(json(value));
    await expect(resolver.resolve(url)).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
  });
});

describe("Spotify provider failures", () => {
  it.each([404, 403, 500])("classifies track HTTP %s without exposing its body or retrying", async (status) => {
    const { http, resolver } = setup();
    http.mockResolvedValueOnce(json(token)).mockResolvedValueOnce(json({ message: "offline-secret" }, status));
    await expect(resolver.resolve(url)).rejects.toMatchObject({ code: status === 404 ? "TRACK_UNAVAILABLE" : "REQUEST_FAILED" });
    expect(http).toHaveBeenCalledTimes(2);
  });

  it.each([{ ...track, is_playable: false }, { ...track, restrictions: { reason: "market" } }])(
    "classifies unavailable successful response", async (value) => {
      const { http, resolver } = setup();
      http.mockResolvedValueOnce(json(token)).mockResolvedValueOnce(json(value));
      await expect(resolver.resolve(url)).rejects.toMatchObject({ code: "TRACK_UNAVAILABLE" });
    },
  );

  it.each([["42", 42], ["Thu, 01 Jan 1970 00:01:00 GMT", 60], ["bad", undefined], ["-1", undefined], ["1.5", undefined]])(
    "represents Retry-After %s without retrying", async (header, seconds) => {
      const { http, resolver } = setup({ now: () => 0 });
      http.mockResolvedValueOnce(json(token)).mockResolvedValueOnce(json({}, 429, { "Retry-After": header }));
      await expect(resolver.resolve(url)).rejects.toMatchObject({ code: "RATE_LIMITED", retryAfterSeconds: seconds });
      expect(http).toHaveBeenCalledTimes(2);
    },
  );

  it("also represents token-endpoint rate limits", async () => {
    const { http, resolver } = setup();
    http.mockResolvedValueOnce(json({}, 429, { "Retry-After": "12" }));
    await expect(resolver.resolve(url)).rejects.toMatchObject({ code: "RATE_LIMITED", retryAfterSeconds: 12 });
    expect(http).toHaveBeenCalledTimes(1);
  });

  it.each(["token", "track"])("sanitizes thrown fetch exceptions at the %s endpoint", async (endpoint) => {
    const { http, resolver } = setup();
    if (endpoint === "track") http.mockResolvedValueOnce(json(token));
    http.mockRejectedValueOnce(new Error("Authorization: offline-secret"));
    const error = await resolver.resolve(url).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(SpotifyResolutionError);
    expect(error).toMatchObject({ code: "REQUEST_FAILED", message: "Spotify request failed." });
    expect(String(error)).not.toContain("offline-secret");
    expect(error).not.toHaveProperty("cause");
  });

  it.each(["token", "track"])("rejects invalid JSON at the %s endpoint safely", async (endpoint) => {
    const { http, resolver } = setup();
    if (endpoint === "track") http.mockResolvedValueOnce(json(token));
    http.mockResolvedValueOnce(new Response("not JSON: offline-secret"));
    await expect(resolver.resolve(url)).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
  });
});
