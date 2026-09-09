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

  it.each([
    ["https://open.spotify.com/track/123", "Spotify link recognized."],
    ["https://www.deezer.com/track/123", "Deezer link recognized."],
    [
      "https://music.apple.com/us/album/example/123",
      "Apple Music link recognized.",
    ],
    [
      "https://example.com/music/track",
      "Link recognized, but support for this source has not been checked yet.",
    ],
    ["Massive Attack Teardrop", "Search recognized: Massive Attack Teardrop"],
    ["   ", "Please send a music link or search query."],
  ])("preserves the existing reply for %s", async (messageText, expected) => {
    const inspect = vi.fn();

    await expect(createMessageReply(messageText, inspect)).resolves.toBe(
      expected,
    );
    expect(inspect).not.toHaveBeenCalled();
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
