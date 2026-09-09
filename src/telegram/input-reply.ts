import type {
  ClassifiedInput,
  KnownProvider,
} from "../domain/classify-input.js";
import type { MediaInspectionResult } from "../media/yt-dlp.js";

const providerLabels = {
  spotify: "Spotify",
  deezer: "Deezer",
  "apple-music": "Apple Music",
  youtube: "YouTube",
  soundcloud: "SoundCloud",
} satisfies Record<KnownProvider, string>;

export function createInputReply(input: ClassifiedInput): string {
  switch (input.type) {
    case "known-provider-url":
      return `${providerLabels[input.provider]} link recognized.`;
    case "generic-url":
      return "Link recognized, but support for this source has not been checked yet.";
    case "text-search":
      return `Search recognized: ${input.query}`;
    case "empty":
      return "Please send a music link or search query.";
  }
}

function formatDuration(durationSeconds: number): string {
  const totalSeconds = Math.round(durationSeconds);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function createMediaInspectionReply(
  metadata: MediaInspectionResult,
  provider?: Extract<KnownProvider, "youtube" | "soundcloud">,
): string {
  const creator = metadata.artist ?? metadata.uploader;
  const lines = [
    `Title: ${metadata.title}`,
    ...(creator ? [`Artist: ${creator}`] : []),
    ...(metadata.durationSeconds !== undefined
      ? [`Duration: ${formatDuration(metadata.durationSeconds)}`]
      : []),
    `Source: ${provider ? providerLabels[provider] : metadata.source}`,
  ];

  return lines.join("\n");
}

export function createMediaInspectionErrorReply(): string {
  return "I couldn't inspect that media link. Please try again later.";
}

export function createUnsafeUrlReply(): string {
  return "This link cannot be accessed safely.";
}
