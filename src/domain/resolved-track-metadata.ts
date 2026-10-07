import type { KnownProvider } from "./classify-input.js";

export type ProviderReference = {
  provider: KnownProvider;
  entityType: "track";
  itemId: string;
  url: string;
  market?: string;
};

// Resolution evidence only: none of these fields defines SongDrop Track identity.
export type ResolvedTrackMetadata = {
  references: ProviderReference[];
  title: string;
  artists: string[];
  durationMs?: number;
  album?: {
    name?: string;
    releaseDate?: string;
    releaseDatePrecision?: "year" | "month" | "day";
  };
  isrc?: string;
  // Omitted means unknown. Only use false when a provider establishes clean lyrics.
  explicit?: boolean;
};
