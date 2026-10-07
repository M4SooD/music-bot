import { spawn } from "node:child_process";

const YT_DLP_EXECUTABLE = "yt-dlp";

export type YtDlpProcessErrorCode =
  | "EXECUTABLE_NOT_FOUND"
  | "PROCESS_START_FAILED"
  | "PROCESS_EXIT_FAILED"
  | "PROCESS_TIMEOUT"
  | "OUTPUT_LIMIT_EXCEEDED";

export class YtDlpProcessError extends Error {
  constructor(
    public readonly code: YtDlpProcessErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "YtDlpProcessError";
  }
}

type OutputStream = {
  on(event: "data", listener: (chunk: Buffer) => void): unknown;
};

type YtDlpChildProcess = {
  stdout: OutputStream;
  stderr: OutputStream;
  kill(signal?: NodeJS.Signals | number): boolean;
  on(
    event: "error",
    listener: (error: NodeJS.ErrnoException) => void,
  ): unknown;
  on(
    event: "close",
    listener: (exitCode: number | null) => void,
  ): unknown;
};

export type SpawnYtDlpProcess = (
  executable: string,
  arguments_: string[],
) => YtDlpChildProcess;

const spawnYtDlpProcess: SpawnYtDlpProcess = (executable, arguments_) =>
  spawn(executable, arguments_, {
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

type RunYtDlpProcessOptions = {
  timeoutMs: number;
  maxOutputBytes: number;
  spawnProcess?: SpawnYtDlpProcess;
};

export function runYtDlpProcess(
  arguments_: readonly string[],
  {
    timeoutMs,
    maxOutputBytes,
    spawnProcess = spawnYtDlpProcess,
  }: RunYtDlpProcessOptions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let child: YtDlpChildProcess;

    try {
      child = spawnProcess(YT_DLP_EXECUTABLE, [...arguments_]);
    } catch (error) {
      reject(
        new YtDlpProcessError(
          "PROCESS_START_FAILED",
          "yt-dlp process could not be started",
          { cause: error },
        ),
      );
      return;
    }

    const stdoutChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let timedOut = false;
    let outputLimitExceeded = false;
    let timeout: NodeJS.Timeout | undefined;

    const settle = (callback: () => void): void => {
      if (settled) {
        return;
      }

      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      callback();
    };

    const collectOutput = (
      chunk: Buffer,
      currentBytes: number,
      keep: boolean,
    ): number => {
      const nextBytes = currentBytes + chunk.length;

      if (nextBytes > maxOutputBytes) {
        outputLimitExceeded = true;
        child.kill("SIGKILL");
        return nextBytes;
      }

      if (keep) {
        stdoutChunks.push(chunk);
      }

      return nextBytes;
    };

    child.stdout.on("data", (chunk) => {
      stdoutBytes = collectOutput(chunk, stdoutBytes, true);
    });

    child.stderr.on("data", (chunk) => {
      stderrBytes = collectOutput(chunk, stderrBytes, false);
    });

    timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.on("error", (error) => {
      if (timedOut) {
        return;
      }

      settle(() => {
        if (error.code === "ENOENT") {
          reject(
            new YtDlpProcessError(
              "EXECUTABLE_NOT_FOUND",
              "yt-dlp executable was not found on PATH",
              { cause: error },
            ),
          );
          return;
        }

        reject(
          new YtDlpProcessError(
            "PROCESS_START_FAILED",
            "yt-dlp process could not be started",
            { cause: error },
          ),
        );
      });
    });

    child.on("close", (exitCode) => {
      settle(() => {
        if (timedOut) {
          reject(
            new YtDlpProcessError(
              "PROCESS_TIMEOUT",
              `yt-dlp process timed out after ${timeoutMs}ms`,
            ),
          );
          return;
        }

        if (outputLimitExceeded) {
          reject(
            new YtDlpProcessError(
              "OUTPUT_LIMIT_EXCEEDED",
              `yt-dlp output exceeded the ${maxOutputBytes}-byte limit`,
            ),
          );
          return;
        }

        if (exitCode !== 0) {
          reject(
            new YtDlpProcessError(
              "PROCESS_EXIT_FAILED",
              "yt-dlp exited with a non-zero exit code",
            ),
          );
          return;
        }

        resolve(Buffer.concat(stdoutChunks).toString("utf8"));
      });
    });
  });
}
