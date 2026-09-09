import { describe, expect, it, vi } from "vitest";

import { createMessageReply } from "../src/telegram/create-message-reply.js";

describe("createMessageReply", () => {
  it.each([
    ["YouTube", "https://youtu.be/video-123", "youtube"],
    [
      "SoundCloud",
      "https://soundcloud.com/example/track-456",
      "soundcloud",
    ],
  ] as const)("inspects a %s URL and formats its metadata", async (_, url, source) => {
    const inspect = vi.fn().mockResolvedValue({
      id: "media-id",
      title: "Example title",
      uploader: "Example uploader",
      durationSeconds: 125,
      source,
    });

    await expect(createMessageReply(url, inspect)).resolves.toBe(
      `Title: Example title\nArtist: Example uploader\nDuration: 2:05\nSource: ${_}`,
    );
    expect(inspect).toHaveBeenCalledOnce();
    expect(inspect).toHaveBeenCalledWith(url);
  });

  it("checks a generic URL before inspecting and formats its metadata", async () => {
    const calls: string[] = [];
    const assertSafe = vi.fn(async () => {
      calls.push("safety");
    });
    const inspect = vi.fn(async () => {
      calls.push("inspection");
      return {
        id: "media-id",
        title: "Example title",
        artist: "Example artist",
        durationSeconds: 65,
        source: "GenericMedia",
      };
    });
    const url = "https://media.example.test/track";

    await expect(createMessageReply(url, inspect, assertSafe)).resolves.toBe(
      "Title: Example title\nArtist: Example artist\nDuration: 1:05\nSource: GenericMedia",
    );
    expect(calls).toEqual(["safety", "inspection"]);
    expect(assertSafe).toHaveBeenCalledWith(url);
    expect(inspect).toHaveBeenCalledWith(url);
  });

  it("does not inspect a generic URL rejected by the safety guard", async () => {
    const assertSafe = vi
      .fn()
      .mockRejectedValue(
        new Error("Resolved to 10.0.0.8 at internal.example.test"),
      );
    const inspect = vi.fn();

    const reply = await createMessageReply(
      "https://internal.example.test/track",
      inspect,
      assertSafe,
    );

    expect(reply).toBe("This link cannot be accessed safely.");
    expect(reply).not.toContain("10.0.0.8");
    expect(reply).not.toContain("internal.example.test");
    expect(assertSafe).toHaveBeenCalledOnce();
    expect(inspect).not.toHaveBeenCalled();
  });

  it("uses the media-inspection failure reply for a safe generic URL", async () => {
    const assertSafe = vi.fn().mockResolvedValue(undefined);
    const inspect = vi
      .fn()
      .mockRejectedValue(new Error("yt-dlp unsupported extractor details"));

    const reply = await createMessageReply(
      "https://media.example.test/broken",
      inspect,
      assertSafe,
    );

    expect(reply).toBe(
      "I couldn't inspect that media link. Please try again later.",
    );
    expect(assertSafe).toHaveBeenCalledOnce();
    expect(inspect).toHaveBeenCalledOnce();
  });

  it.each([
    ["https://open.spotify.com/track/123", "Spotify link recognized."],
    ["https://www.deezer.com/track/123", "Deezer link recognized."],
    [
      "https://music.apple.com/us/album/example/123",
      "Apple Music link recognized.",
    ],
    ["Massive Attack Teardrop", "Search recognized: Massive Attack Teardrop"],
    ["   ", "Please send a music link or search query."],
  ])("preserves the existing reply for %s", async (messageText, expected) => {
    const inspect = vi.fn();
    const assertSafe = vi.fn();

    await expect(
      createMessageReply(messageText, inspect, assertSafe),
    ).resolves.toBe(expected);
    expect(inspect).not.toHaveBeenCalled();
    expect(assertSafe).not.toHaveBeenCalled();
  });

  it("returns a safe message when inspection fails", async () => {
    const inspect = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "spawn C:\\tools\\yt-dlp.exe failed: private stderr and stack details",
        ),
      );

    const reply = await createMessageReply(
      "https://www.youtube.com/watch?v=video-123",
      inspect,
    );

    expect(reply).toBe(
      "I couldn't inspect that media link. Please try again later.",
    );
    expect(reply).not.toContain("yt-dlp");
    expect(reply).not.toContain("stderr");
    expect(reply).not.toContain("C:\\tools");
  });
});
