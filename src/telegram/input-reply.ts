import type {
  ClassifiedInput,
  KnownProvider,
} from "../domain/classify-input.js";

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
