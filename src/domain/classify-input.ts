export type KnownProvider =
  | "spotify"
  | "deezer"
  | "apple-music"
  | "youtube"
  | "soundcloud";

export type ClassifiedInput =
  | {
      type: "empty";
    }
  | {
      type: "known-provider-url";
      provider: KnownProvider;
      url: string;
    }
  | {
      type: "generic-url";
      url: string;
    }
  | {
      type: "text-search";
      query: string;
    };

const providerByHostname = new Map<string, KnownProvider>([
  ["open.spotify.com", "spotify"],
  ["deezer.com", "deezer"],
  ["www.deezer.com", "deezer"],
  ["music.apple.com", "apple-music"],
  ["youtube.com", "youtube"],
  ["www.youtube.com", "youtube"],
  ["music.youtube.com", "youtube"],
  ["youtu.be", "youtube"],
  ["soundcloud.com", "soundcloud"],
  ["www.soundcloud.com", "soundcloud"],
]);

export function classifyInput(input: string): ClassifiedInput {
  const normalizedInput = input.trim();

  if (normalizedInput === "") {
    return { type: "empty" };
  }

  try {
    const url = new URL(normalizedInput);

    if (url.protocol === "http:" || url.protocol === "https:") {
      const provider = providerByHostname.get(url.hostname.toLowerCase());

      if (provider) {
        return {
          type: "known-provider-url",
          provider,
          url: normalizedInput,
        };
      }

      return { type: "generic-url", url: normalizedInput };
    }
  } catch {
    // Non-URLs and malformed URL-like input are valid text searches.
  }

  return {
    type: "text-search",
    query: normalizedInput.replace(/\s+/g, " "),
  };
}
