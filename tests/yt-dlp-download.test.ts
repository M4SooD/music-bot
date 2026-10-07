import { EventEmitter } from "node:events";
import {
  access,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { downloadMediaAsMp3 } from "../src/media/yt-dlp-download.js";
import {
  runYtDlpProcess,
  type SpawnYtDlpProcess,
} from "../src/media/yt-dlp-process.js";

type FakeChildProcess = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};

function createSpawn(
  run: (arguments_: string[], child: FakeChildProcess) => void | Promise<void>,
): SpawnYtDlpProcess {
  return (_executable, arguments_) => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(() => true),
    });

    queueMicrotask(() => {
      void Promise.resolve(run(arguments_, child)).catch((error: unknown) => {
        child.emit("error", error);
      });
    });

    return child;
  };
}

function getOutputPath(arguments_: string[], id = "track-123"): string {
  const outputOptionIndex = arguments_.indexOf("-o");
  const outputTemplate = arguments_[outputOptionIndex + 1];

  if (!outputTemplate) {
    throw new Error("Missing test output template");
  }

  return outputTemplate
    .replace("%(id)s", id)
    .replace("%(ext)s", "mp3");
}

function createSuccessfulSpawn(
  onArguments?: (arguments_: string[]) => void,
): SpawnYtDlpProcess {
  return createSpawn(async (arguments_, child) => {
    onArguments?.(arguments_);
    const filePath = getOutputPath(arguments_);
    await writeFile(filePath, "fake mp3 data");
    child.stdout.emit("data", Buffer.from(`${filePath}\n`));
    child.emit("close", 0);
  });
}

describe("downloadMediaAsMp3", () => {
  let temporaryDirectoryRoot: string;

  beforeEach(async () => {
    temporaryDirectoryRoot = await mkdtemp(
      join(tmpdir(), "songdrop-download-test-"),
    );
  });

  afterEach(async () => {
    await rm(temporaryDirectoryRoot, { recursive: true, force: true });
  });

  it("returns the verified MP3 and uses the required yt-dlp arguments", async () => {
    let receivedArguments: string[] = [];
    const url = "https://media.example.test/watch?v=123";
    const result = await downloadMediaAsMp3(url, {
      temporaryDirectoryRoot,
      spawnProcess: createSuccessfulSpawn((arguments_) => {
        receivedArguments = arguments_;
      }),
    });
    const outputTemplate = join(
      dirname(result.filePath),
      "%(id)s.%(ext)s",
    );

    expect(result).toMatchObject({
      fileName: "track-123.mp3",
      sizeBytes: Buffer.byteLength("fake mp3 data"),
    });
    await expect(access(result.filePath)).resolves.toBeUndefined();
    expect(receivedArguments).toEqual([
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
      url,
    ]);

    await result.cleanup();
  });

  it("gives concurrent downloads unique owned temporary directories", async () => {
    const spawnProcess = createSuccessfulSpawn();
    const [first, second] = await Promise.all([
      downloadMediaAsMp3("https://example.test/first", {
        temporaryDirectoryRoot,
        spawnProcess,
      }),
      downloadMediaAsMp3("https://example.test/second", {
        temporaryDirectoryRoot,
        spawnProcess,
      }),
    ]);

    expect(dirname(first.filePath)).not.toBe(dirname(second.filePath));

    await Promise.all([first.cleanup(), second.cleanup()]);
  });

  it("rejects a printed path outside the operation directory and cleans up", async () => {
    const outsidePath = join(temporaryDirectoryRoot, "outside.mp3");
    const spawnProcess = createSpawn(async (_arguments, child) => {
      await writeFile(outsidePath, "not owned by the operation");
      child.stdout.emit("data", Buffer.from(`${outsidePath}\n`));
      child.emit("close", 0);
    });

    await expect(
      downloadMediaAsMp3("https://example.test/media", {
        temporaryDirectoryRoot,
        spawnProcess,
      }),
    ).rejects.toMatchObject({
      code: "OUTPUT_PATH_OUTSIDE_TEMP_DIRECTORY",
    });
    expect(await readdir(temporaryDirectoryRoot)).toEqual(["outside.mp3"]);
  });

  it("rejects missing final-path output and removes partial files", async () => {
    const spawnProcess = createSpawn(async (arguments_, child) => {
      await writeFile(getOutputPath(arguments_, "partial"), "partial data");
      child.emit("close", 0);
    });

    await expect(
      downloadMediaAsMp3("https://example.test/media", {
        temporaryDirectoryRoot,
        spawnProcess,
      }),
    ).rejects.toMatchObject({
      code: "MISSING_OUTPUT_PATH",
    });
    expect(await readdir(temporaryDirectoryRoot)).toEqual([]);
  });

  it("rejects a missing final file and cleans up the operation directory", async () => {
    const spawnProcess = createSpawn((arguments_, child) => {
      const missingPath = getOutputPath(arguments_, "missing");
      child.stdout.emit("data", Buffer.from(`${missingPath}\n`));
      child.emit("close", 0);
    });

    await expect(
      downloadMediaAsMp3("https://example.test/media", {
        temporaryDirectoryRoot,
        spawnProcess,
      }),
    ).rejects.toMatchObject({
      code: "OUTPUT_FILE_INVALID",
    });
    expect(await readdir(temporaryDirectoryRoot)).toEqual([]);
  });

  it("keeps a successful file until explicit idempotent cleanup", async () => {
    const result = await downloadMediaAsMp3("https://example.test/media", {
      temporaryDirectoryRoot,
      spawnProcess: createSuccessfulSpawn(),
    });
    const ownedDirectory = dirname(result.filePath);

    await expect(access(result.filePath)).resolves.toBeUndefined();
    await result.cleanup();
    await result.cleanup();
    await expect(access(ownedDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["not a URL", "file:///tmp/media.mp3", "ftp://example.test/a.mp3"])(
    "rejects an invalid or non-HTTP URL: %s",
    async (url) => {
      const spawnProcess = vi.fn() as unknown as SpawnYtDlpProcess;

      await expect(
        downloadMediaAsMp3(url, { temporaryDirectoryRoot, spawnProcess }),
      ).rejects.toMatchObject({
        code: "INVALID_URL",
      });
      expect(spawnProcess).not.toHaveBeenCalled();
      expect(await readdir(temporaryDirectoryRoot)).toEqual([]);
    },
  );

  it("maps a missing yt-dlp executable without exposing process details", async () => {
    const spawnProcess = createSpawn((_arguments, child) => {
      child.emit(
        "error",
        Object.assign(new Error("spawn details that should remain internal"), {
          code: "ENOENT",
        }),
      );
    });

    await expect(
      downloadMediaAsMp3("https://example.test/media", {
        temporaryDirectoryRoot,
        spawnProcess,
      }),
    ).rejects.toMatchObject({
      code: "EXECUTABLE_NOT_FOUND",
      message: "yt-dlp executable was not found on PATH",
    });
    expect(await readdir(temporaryDirectoryRoot)).toEqual([]);
  });

  it("maps a non-zero process exit and removes partial files", async () => {
    const spawnProcess = createSpawn(async (arguments_, child) => {
      await writeFile(getOutputPath(arguments_, "partial"), "partial data");
      child.stderr.emit("data", Buffer.from("private extractor details"));
      child.emit("close", 2);
    });

    await expect(
      downloadMediaAsMp3("https://example.test/media", {
        temporaryDirectoryRoot,
        spawnProcess,
      }),
    ).rejects.toMatchObject({
      code: "PROCESS_EXIT_FAILED",
      message: "yt-dlp exited with a non-zero exit code",
    });
    expect(await readdir(temporaryDirectoryRoot)).toEqual([]);
  });
});

describe("runYtDlpProcess", () => {
  it("rejects excessive stderr and kills the process", async () => {
    let childProcess: FakeChildProcess | undefined;
    const spawnProcess = createSpawn((_arguments, child) => {
      childProcess = child;
      child.stderr.emit("data", Buffer.alloc(17));
      child.emit("close", 1);
    });

    await expect(
      runYtDlpProcess([], {
        timeoutMs: 1_000,
        maxOutputBytes: 16,
        spawnProcess,
      }),
    ).rejects.toMatchObject({ code: "OUTPUT_LIMIT_EXCEEDED" });
    expect(childProcess?.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it.each([null, 0, 1])(
    "waits for close before rejecting a timed-out process (exit code %s)",
    async (exitCode) => {
      vi.useFakeTimers();

      try {
        let childProcess: FakeChildProcess | undefined;
        const spawnProcess = createSpawn((_arguments, child) => {
          childProcess = child;
        });
        const processResult = runYtDlpProcess([], {
          timeoutMs: 100,
          maxOutputBytes: 16,
          spawnProcess,
        });
        const rejection = expect(processResult).rejects.toMatchObject({
          code: "PROCESS_TIMEOUT",
        });
        const onSettled = vi.fn();
        void processResult.then(onSettled, onSettled);

        await vi.advanceTimersByTimeAsync(100);
        expect(childProcess?.kill).toHaveBeenCalledWith("SIGKILL");
        expect(onSettled).not.toHaveBeenCalled();

        childProcess?.emit("error", new Error("termination error"));
        await Promise.resolve();
        expect(onSettled).not.toHaveBeenCalled();

        childProcess?.emit("close", exitCode);
        await rejection;
        expect(onSettled).toHaveBeenCalledTimes(1);

        childProcess?.emit("close", 0);
        childProcess?.emit("error", new Error("late process error"));
        await Promise.resolve();
        expect(onSettled).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("maps a synchronous process-start failure", async () => {
    const spawnProcess = (() => {
      throw new Error("private spawn failure details");
    }) as SpawnYtDlpProcess;

    await expect(
      runYtDlpProcess([], {
        timeoutMs: 1_000,
        maxOutputBytes: 16,
        spawnProcess,
      }),
    ).rejects.toMatchObject({
      code: "PROCESS_START_FAILED",
      message: "yt-dlp process could not be started",
    });
  });
});
