import { lstat, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  runYtDlpProcess,
  type SpawnYtDlpProcess,
  YtDlpProcessError,
  type YtDlpProcessErrorCode,
} from "./yt-dlp-process.js";

export const YT_DLP_DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

const MAX_OUTPUT_BYTES = 1024 * 1024;
const TEMP_DIRECTORY_PREFIX = "songdrop-ytdlp-";

export type YtDlpDownloadErrorCode =
  | "INVALID_URL"
  | "TEMP_DIRECTORY_FAILED"
  | YtDlpProcessErrorCode
  | "MISSING_OUTPUT_PATH"
  | "INVALID_OUTPUT_PATH"
  | "OUTPUT_PATH_OUTSIDE_TEMP_DIRECTORY"
  | "OUTPUT_FILE_INVALID"
  | "CLEANUP_FAILED";

export class YtDlpDownloadError extends Error {
  constructor(
    public readonly code: YtDlpDownloadErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "YtDlpDownloadError";
  }
}

export type DownloadedMediaFile = {
  filePath: string;
  fileName: string;
  sizeBytes: number;
  cleanup: () => Promise<void>;
};

type DownloadDependencies = {
  spawnProcess?: SpawnYtDlpProcess;
  temporaryDirectoryRoot?: string;
};

function validateMediaUrl(value: string): void {
  let url: URL;

  try {
    url = new URL(value);
  } catch (error) {
    throw new YtDlpDownloadError("INVALID_URL", "Media URL is invalid", {
      cause: error,
    });
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new YtDlpDownloadError(
      "INVALID_URL",
      "Media URL must use HTTP or HTTPS",
    );
  }
}

function getPrintedPath(output: string): string {
  const lines = output.split(/\r?\n/);

  while (lines.at(-1) === "") {
    lines.pop();
  }

  if (lines.length === 0 || lines[0]?.trim() === "") {
    throw new YtDlpDownloadError(
      "MISSING_OUTPUT_PATH",
      "yt-dlp did not return the downloaded file path",
    );
  }

  if (lines.length !== 1) {
    throw new YtDlpDownloadError(
      "INVALID_OUTPUT_PATH",
      "yt-dlp returned an ambiguous downloaded file path",
    );
  }

  return lines[0];
}

function isOwnedPath(directory: string, candidate: string): boolean {
  const relativePath = relative(directory, candidate);

  return (
    relativePath !== "" &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
}

async function removeOwnedDirectory(directory: string): Promise<void> {
  try {
    await rm(directory, { recursive: true, force: true });
  } catch (error) {
    throw new YtDlpDownloadError(
      "CLEANUP_FAILED",
      "Temporary media files could not be removed",
      { cause: error },
    );
  }
}

function createCleanup(directory: string): () => Promise<void> {
  let cleanupPromise: Promise<void> | undefined;

  return async () => {
    cleanupPromise ??= removeOwnedDirectory(directory);
    await cleanupPromise;
  };
}

function mapProcessError(error: YtDlpProcessError): YtDlpDownloadError {
  const message =
    error.code === "PROCESS_TIMEOUT"
      ? `yt-dlp download timed out after ${YT_DLP_DOWNLOAD_TIMEOUT_MS}ms`
      : error.message;

  return new YtDlpDownloadError(error.code, message, { cause: error });
}

export async function downloadMediaAsMp3(
  url: string,
  dependencies: DownloadDependencies = {},
): Promise<DownloadedMediaFile> {
  const normalizedUrl = url.trim();
  validateMediaUrl(normalizedUrl);

  let temporaryDirectory: string;

  try {
    temporaryDirectory = await mkdtemp(
      join(
        dependencies.temporaryDirectoryRoot ?? tmpdir(),
        TEMP_DIRECTORY_PREFIX,
      ),
    );
  } catch (error) {
    throw new YtDlpDownloadError(
      "TEMP_DIRECTORY_FAILED",
      "Temporary media directory could not be created",
      { cause: error },
    );
  }

  try {
    const outputTemplate = join(temporaryDirectory, "%(id)s.%(ext)s");
    const output = await runYtDlpProcess(
      [
        "--js-runtimes",
        "node",
        "--no-playlist",
        "-x",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "192K",
        "--print",
        "after_move:filepath",
        "-o",
        outputTemplate,
        "--",
        normalizedUrl,
      ],
      {
        timeoutMs: YT_DLP_DOWNLOAD_TIMEOUT_MS,
        maxOutputBytes: MAX_OUTPUT_BYTES,
        ...(dependencies.spawnProcess && {
          spawnProcess: dependencies.spawnProcess,
        }),
      },
    );
    const printedPath = getPrintedPath(output);

    if (!isAbsolute(printedPath)) {
      throw new YtDlpDownloadError(
        "INVALID_OUTPUT_PATH",
        "yt-dlp returned a non-absolute downloaded file path",
      );
    }

    const filePath = resolve(printedPath);
    const ownedDirectoryPath = resolve(temporaryDirectory);

    if (!isOwnedPath(ownedDirectoryPath, filePath)) {
      throw new YtDlpDownloadError(
        "OUTPUT_PATH_OUTSIDE_TEMP_DIRECTORY",
        "yt-dlp returned a file path outside its temporary directory",
      );
    }

    let fileStats;

    try {
      fileStats = await lstat(filePath);
    } catch (error) {
      throw new YtDlpDownloadError(
        "OUTPUT_FILE_INVALID",
        "Downloaded media file does not exist or cannot be inspected",
        { cause: error },
      );
    }

    if (!fileStats.isFile()) {
      throw new YtDlpDownloadError(
        "OUTPUT_FILE_INVALID",
        "Downloaded media output is not a regular file",
      );
    }

    let realDirectoryPath: string;
    let realFilePath: string;

    try {
      [realDirectoryPath, realFilePath] = await Promise.all([
        realpath(ownedDirectoryPath),
        realpath(filePath),
      ]);
    } catch (error) {
      throw new YtDlpDownloadError(
        "OUTPUT_FILE_INVALID",
        "Downloaded media file could not be resolved",
        { cause: error },
      );
    }

    if (!isOwnedPath(realDirectoryPath, realFilePath)) {
      throw new YtDlpDownloadError(
        "OUTPUT_PATH_OUTSIDE_TEMP_DIRECTORY",
        "Downloaded media file resolves outside its temporary directory",
      );
    }

    return {
      filePath: realFilePath,
      fileName: basename(realFilePath),
      sizeBytes: fileStats.size,
      cleanup: createCleanup(temporaryDirectory),
    };
  } catch (error) {
    let operationError: unknown = error;

    if (error instanceof YtDlpProcessError) {
      operationError = mapProcessError(error);
    }

    try {
      await removeOwnedDirectory(temporaryDirectory);
    } catch (cleanupError) {
      throw new YtDlpDownloadError(
        "CLEANUP_FAILED",
        "The media download failed and temporary files could not be removed",
        { cause: new AggregateError([operationError, cleanupError]) },
      );
    }

    throw operationError;
  }
}
