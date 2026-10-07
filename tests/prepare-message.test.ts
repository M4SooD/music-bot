import { describe, expect, it, vi } from "vitest";

import { prepareMessage } from "../src/telegram/prepare-message.js";

describe("prepareMessage", () => {
  it("returns inspected metadata and the original guarded URL for delivery", async () => {
    const url = "https://media.example.test/track";
    const metadata = {
      id: "media-id",
      title: "Example title",
      artist: "Example artist",
      source: "GenericMedia",
      webpageUrl: "https://other.example.test/track",
    };
    const inspect = vi.fn().mockResolvedValue(metadata);
    const assertSafe = vi.fn().mockResolvedValue(undefined);

    await expect(prepareMessage(url, { inspect, assertSafe })).resolves.toEqual({
      type: "media", url, metadata,
    });
  });

  it.each([
    "https://youtu.be/video-123",
    "https://soundcloud.com/example/track-456",
    "https://media.example.test/track",
    "http://media.example.test/track",
  ])("prepares media without metadata when inspection fails for %s", async (url) => {
    const inspect = vi.fn().mockRejectedValue(
      new Error("private yt-dlp stderr C:\\temp\\media and stack details"),
    );
    const assertSafe = vi.fn().mockResolvedValue(undefined);

    await expect(prepareMessage(url, { inspect, assertSafe })).resolves.toEqual({
      type: "media", url,
    });
    expect(inspect).toHaveBeenCalledExactlyOnceWith(url);
  });
});
