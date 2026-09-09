import { describe, expect, it } from "vitest";

import {
  parseYtDlpJson,
  YtDlpInspectionError,
} from "../src/media/yt-dlp.js";

describe("parseYtDlpJson", () => {
  it("normalizes representative yt-dlp metadata", () => {
    const output = JSON.stringify({
      id: "video-123",
      title: "Teardrop",
      artist: "Massive Attack",
      uploader: "Massive Attack",
      duration: 330.5,
      thumbnail: "https://i.example.test/thumbnail.jpg",
      extractor: "youtube",
      extractor_key: "Youtube",
      webpage_url: "https://www.youtube.com/watch?v=video-123",
      formats: [{ format_id: "ignored" }],
      description: "also ignored",
    });

    expect(parseYtDlpJson(output)).toEqual({
      id: "video-123",
      title: "Teardrop",
      artist: "Massive Attack",
      uploader: "Massive Attack",
      durationSeconds: 330.5,
      thumbnailUrl: "https://i.example.test/thumbnail.jpg",
      source: "Youtube",
      webpageUrl: "https://www.youtube.com/watch?v=video-123",
    });
  });

  it("omits unavailable optional metadata", () => {
    expect(
      parseYtDlpJson(
        JSON.stringify({
          id: "audio-456",
          title: "Untitled upload",
          extractor: "generic",
          artist: null,
          uploader: "",
          duration: null,
          thumbnail: null,
          webpage_url: null,
        }),
      ),
    ).toEqual({
      id: "audio-456",
      title: "Untitled upload",
      source: "generic",
    });
  });

  it("rejects malformed JSON", () => {
    expect(() => parseYtDlpJson("not json")).toThrowError(
      expect.objectContaining<Partial<YtDlpInspectionError>>({
        code: "INVALID_JSON",
      }),
    );
  });

  it.each([
    [{ title: "Missing ID", extractor: "youtube" }, "id"],
    [{ id: "123", extractor: "youtube" }, "title"],
    [{ id: "123", title: "Missing source" }, "extractor"],
  ])("rejects missing required metadata: %s", (metadata, field) => {
    expect(() => parseYtDlpJson(JSON.stringify(metadata))).toThrowError(
      expect.objectContaining<Partial<YtDlpInspectionError>>({
        code: "MISSING_METADATA",
        message: expect.stringContaining(field) as unknown as string,
      }),
    );
  });
});
