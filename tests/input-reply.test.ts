import { describe, expect, it } from "vitest";

import type { KnownProvider } from "../src/domain/classify-input.js";
import { createInputReply } from "../src/telegram/input-reply.js";

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
});
