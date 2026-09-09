import { spawn } from "node:child_process";

const YT_DLP_EXECUTABLE = "yt-dlp";
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

export type YtDlpInspectionResult = {
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

export function parseYtDlpJson(output: string): YtDlpInspectionResult {
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
): Promise<YtDlpInspectionResult> {
  const normalizedUrl = url.trim();
  validateMediaUrl(normalizedUrl);

  return new Promise((resolve, reject) => {
    const child = spawn(YT_DLP_EXECUTABLE, [...YT_DLP_ARGUMENTS, normalizedUrl], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let outputLimitExceeded = false;

    const settle = (callback: () => void): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      callback();
    };

    const collectOutput = (
      chunk: Buffer,
      chunks: Buffer[],
      currentBytes: number,
    ): number => {
      const nextBytes = currentBytes + chunk.length;

      if (nextBytes > MAX_OUTPUT_BYTES) {
        outputLimitExceeded = true;
        child.kill("SIGKILL");
        return nextBytes;
      }

      chunks.push(chunk);
      return nextBytes;
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes = collectOutput(chunk, stdoutChunks, stdoutBytes);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes = collectOutput(chunk, stderrChunks, stderrBytes);
    });

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      settle(() => {
        reject(
          new YtDlpInspectionError(
            "PROCESS_TIMEOUT",
            `yt-dlp inspection timed out after ${DEFAULT_TIMEOUT_MS}ms`,
          ),
        );
      });
    }, DEFAULT_TIMEOUT_MS);

    child.on("error", (error: NodeJS.ErrnoException) => {
      settle(() => {
        if (error.code === "ENOENT") {
          reject(
            new YtDlpInspectionError(
              "EXECUTABLE_NOT_FOUND",
              "yt-dlp executable was not found on PATH",
              { cause: error },
            ),
          );
          return;
        }

        reject(
          new YtDlpInspectionError(
            "PROCESS_START_FAILED",
            "yt-dlp process could not be started",
            { cause: error },
          ),
        );
      });
    });

    child.on("close", (exitCode) => {
      settle(() => {
        if (outputLimitExceeded) {
          reject(
            new YtDlpInspectionError(
              "OUTPUT_LIMIT_EXCEEDED",
              `yt-dlp output exceeded the ${MAX_OUTPUT_BYTES}-byte limit`,
            ),
          );
          return;
        }

        const stdout = Buffer.concat(stdoutChunks).toString("utf8");
        if (exitCode !== 0) {
          reject(
            new YtDlpInspectionError(
              "PROCESS_EXIT_FAILED",
              "yt-dlp exited with a non-zero exit code",
            ),
          );
          return;
        }

        try {
          resolve(parseYtDlpJson(stdout));
        } catch (error) {
          reject(error);
        }
      });
    });
  });
}
