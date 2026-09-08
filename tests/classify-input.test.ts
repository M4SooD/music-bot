import { describe, expect, it } from "vitest";

import { classifyInput } from "../src/domain/classify-input.js";

describe("classifyInput", () => {
  it.each([
    ["Spotify", "https://open.spotify.com/track/123", "spotify"],
    ["Deezer", "https://www.deezer.com/track/123", "deezer"],
    ["Apple Music", "https://music.apple.com/us/album/example/123", "apple-music"],
    ["YouTube", "https://www.youtube.com/watch?v=abc", "youtube"],
    ["YouTube Music", "https://music.youtube.com/watch?v=abc", "youtube"],
    ["YouTube short URL", "https://youtu.be/abc", "youtube"],
    ["SoundCloud", "https://soundcloud.com/artist/track", "soundcloud"],
  ] as const)("classifies a %s URL as a known provider", (_, url, provider) => {
    expect(classifyInput(url)).toEqual({
      type: "known-provider-url",
      provider,
      url,
    });
  });

  it("classifies an unknown valid HTTPS URL as a generic URL", () => {
    const url = "https://example.com/music/track";

    expect(classifyInput(url)).toEqual({ type: "generic-url", url });
  });

  it("classifies an unknown valid HTTP URL as a generic URL", () => {
    const url = "http://example.com/music/track";

    expect(classifyInput(url)).toEqual({ type: "generic-url", url });
  });

  it("does not match a known provider name across a hostname boundary", () => {
    const url = "https://youtube.com.example.com/watch?v=abc";

    expect(classifyInput(url)).toEqual({ type: "generic-url", url });
  });

  it("does not treat inherited object property names as providers", () => {
    const url = "https://constructor/track";

    expect(classifyInput(url)).toEqual({ type: "generic-url", url });
  });

  it("classifies an ordinary song name as a text search", () => {
    expect(classifyInput("Massive Attack Teardrop")).toEqual({
      type: "text-search",
      query: "Massive Attack Teardrop",
    });
  });

  it("normalizes surrounding URL whitespace", () => {
    expect(classifyInput("  https://open.spotify.com/track/123  \n")).toEqual({
      type: "known-provider-url",
      provider: "spotify",
      url: "https://open.spotify.com/track/123",
    });
  });

  it("normalizes surrounding and repeated search whitespace", () => {
    expect(classifyInput("  Massive   Attack\nTeardrop  ")).toEqual({
      type: "text-search",
      query: "Massive Attack Teardrop",
    });
  });

  it("treats malformed URL-like text as a text search", () => {
    expect(classifyInput("https://[not-a-valid-url")).toEqual({
      type: "text-search",
      query: "https://[not-a-valid-url",
    });
  });

  it("classifies empty input explicitly", () => {
    expect(classifyInput("   ")).toEqual({ type: "empty" });
  });
});
