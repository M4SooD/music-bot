import {
  runYtDlpProcess,
  YtDlpProcessError,
} from "./yt-dlp-process.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;

const YT_DLP_ARGUMENTS = [
  "--js-runtimes",
  "node",
  "--dump-single-json",
  "--skip-download",
  "--no-playlist",
  "--",
] as const;

export type MediaInspectionResult = {
  id: string;
  title: string;
  artist?: string;
  uploader?: string;
  durationSeconds?: number;
  thumbnailUrl?: string;
  source: string;
  webpageUrl?: string;
};

export type YtDlpInspectionErrorCode =
  | "INVALID_URL"
  | "EXECUTABLE_NOT_FOUND"
  | "PROCESS_START_FAILED"
  | "PROCESS_EXIT_FAILED"
  | "PROCESS_TIMEOUT"
  | "OUTPUT_LIMIT_EXCEEDED"
  | "INVALID_JSON"
  | "MISSING_METADATA";

export class YtDlpInspectionError extends Error {
  constructor(
    public readonly code: YtDlpInspectionErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "YtDlpInspectionError";
  }
}

type YtDlpJson = Record<string, unknown>;

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function requiredString(
  metadata: YtDlpJson,
  field: "id" | "title",
): string {
  const value = optionalString(metadata[field]);

  if (!value) {
    throw new YtDlpInspectionError(
      "MISSING_METADATA",
      `yt-dlp output is missing required metadata field: ${field}`,
    );
  }

  return value;
}

export function parseYtDlpJson(output: string): MediaInspectionResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(output);
  } catch (error) {
    throw new YtDlpInspectionError(
      "INVALID_JSON",
      "yt-dlp returned invalid JSON output",
      { cause: error },
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new YtDlpInspectionError(
      "MISSING_METADATA",
      "yt-dlp output is not a single media metadata object",
    );
  }

  const metadata: YtDlpJson = parsed as YtDlpJson;
  const source =
    optionalString(metadata.extractor_key) ?? optionalString(metadata.extractor);

  if (!source) {
    throw new YtDlpInspectionError(
      "MISSING_METADATA",
      "yt-dlp output is missing required metadata field: extractor",
    );
  }

  const duration = metadata.duration;
  const durationSeconds =
    typeof duration === "number" && Number.isFinite(duration) && duration >= 0
      ? duration
      : undefined;
  const artist = optionalString(metadata.artist);
  const uploader = optionalString(metadata.uploader);
  const thumbnailUrl = optionalString(metadata.thumbnail);
  const webpageUrl = optionalString(metadata.webpage_url);

  return {
    id: requiredString(metadata, "id"),
    title: requiredString(metadata, "title"),
    ...(artist && { artist }),
    ...(uploader && { uploader }),
    ...(durationSeconds !== undefined && { durationSeconds }),
    ...(thumbnailUrl && { thumbnailUrl }),
    source,
    ...(webpageUrl && { webpageUrl }),
  };
}

function validateMediaUrl(value: string): void {
  let url: URL;

  try {
    url = new URL(value);
  } catch (error) {
    throw new YtDlpInspectionError("INVALID_URL", "Media URL is invalid", {
      cause: error,
    });
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new YtDlpInspectionError(
      "INVALID_URL",
      "Media URL must use HTTP or HTTPS",
    );
  }
}

export async function inspectMediaUrl(
  url: string,
): Promise<MediaInspectionResult> {
  const normalizedUrl = url.trim();
  validateMediaUrl(normalizedUrl);

  let output: string;

  try {
    output = await runYtDlpProcess([...YT_DLP_ARGUMENTS, normalizedUrl], {
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxOutputBytes: MAX_OUTPUT_BYTES,
    });
  } catch (error) {
    if (error instanceof YtDlpProcessError) {
      const message =
        error.code === "PROCESS_TIMEOUT"
          ? `yt-dlp inspection timed out after ${DEFAULT_TIMEOUT_MS}ms`
          : error.message;

      throw new YtDlpInspectionError(error.code, message, { cause: error });
    }

    throw error;
  }

  return parseYtDlpJson(output);
}
