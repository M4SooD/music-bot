import { describe, expect, it } from "vitest";

import type { KnownProvider } from "../src/domain/classify-input.js";
import {
  createInputReply,
  createMediaInspectionErrorReply,
  createMediaInspectionReply,
} from "../src/telegram/input-reply.js";

describe("createInputReply", () => {
  it.each([
    ["spotify", "Spotify"],
    ["deezer", "Deezer"],
    ["apple-music", "Apple Music"],
    ["youtube", "YouTube"],
    ["soundcloud", "SoundCloud"],
  ] satisfies ReadonlyArray<readonly [KnownProvider, string]>) (
    "acknowledges a %s provider URL",
    (provider, label) => {
      expect(
        createInputReply({
          type: "known-provider-url",
          provider,
          url: "https://example.com",
        }),
      ).toBe(`${label} link recognized.`);
    },
  );

  it("explains that support for a generic URL is unchecked", () => {
    expect(
      createInputReply({ type: "generic-url", url: "https://example.com" }),
    ).toBe(
      "Link recognized, but support for this source has not been checked yet.",
    );
  });

  it("acknowledges the normalized text search query", () => {
    expect(
      createInputReply({ type: "text-search", query: "Massive Attack Teardrop" }),
    ).toBe("Search recognized: Massive Attack Teardrop");
  });

  it("handles empty classified input defensively", () => {
    expect(createInputReply({ type: "empty" })).toBe(
      "Please send a music link or search query.",
    );
  });

  it("formats inspected media metadata concisely", () => {
    expect(
      createMediaInspectionReply(
        {
          id: "video-123",
          title: "Teardrop",
          artist: "Massive Attack",
          uploader: "Uploader is secondary",
          durationSeconds: 330.5,
          source: "Youtube",
        },
        "youtube",
      ),
    ).toBe(
      "Title: Teardrop\nArtist: Massive Attack\nDuration: 5:31\nSource: YouTube",
    );
  });

  it("falls back to uploader and omits unavailable optional metadata", () => {
    expect(
      createMediaInspectionReply(
        {
          id: "track-456",
          title: "Untitled upload",
          uploader: "Example uploader",
          source: "Soundcloud",
        },
        "soundcloud",
      ),
    ).toBe(
      "Title: Untitled upload\nArtist: Example uploader\nSource: SoundCloud",
    );
  });

  it("formats hour-long durations", () => {
    expect(
      createMediaInspectionReply(
        {
          id: "mix-789",
          title: "Long mix",
          durationSeconds: 3_661,
          source: "Youtube",
        },
        "youtube",
      ),
    ).toBe("Title: Long mix\nDuration: 1:01:01\nSource: YouTube");
  });

  it("returns a safe inspection failure message", () => {
    expect(createMediaInspectionErrorReply()).toBe(
      "I couldn't inspect that media link. Please try again later.",
    );
  });
});
