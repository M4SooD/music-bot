import { InputFile, type Context } from "grammy";
import { describe, expect, it, vi } from "vitest";

import type { MediaInspectionResult } from "../src/media/yt-dlp.js";
import { handleMessage } from "../src/telegram/handle-message.js";

function fixture() {
  const calls: string[] = [];
  const metadata: MediaInspectionResult = {
    id: "media-id",
    title: "Example title",
    artist: "Example artist",
    uploader: "Example uploader",
    source: "SoundCloud",
  };
  const cleanup = vi.fn(async () => { calls.push("cleanup"); });
  const file = {
    filePath: "C:/fake/track.mp3",
    fileName: "track.mp3",
    sizeBytes: 123,
    cleanup,
  };
  const assertSafe = vi.fn(async (_url: string) => { calls.push("safety"); });
  const inspect = vi.fn(async (_url: string) => {
    calls.push("inspect");
    return metadata;
  });
  const download = vi.fn(async (_url: string) => {
    calls.push("download");
    return file;
  });
  const reply = vi.fn<Context["reply"]>().mockImplementation(async () => {
    calls.push("reply");
    return {} as Awaited<ReturnType<Context["reply"]>>;
  });
  const replyWithAudio = vi.fn<Context["replyWithAudio"]>().mockImplementation(async () => {
    calls.push("audio");
    expect(cleanup).not.toHaveBeenCalled();
    return {} as Awaited<ReturnType<Context["replyWithAudio"]>>;
  });
  return {
    calls, metadata, file, cleanup, assertSafe, inspect, download,
    transport: { reply, replyWithAudio },
    dependencies: { assertSafe, inspect, download },
  };
}

describe("handleMessage", () => {
  it.each([
    ["SoundCloud", "https://soundcloud.com/example/track-456"],
    ["YouTube", "https://youtu.be/video-123"],
  ])("downloads and uploads %s audio before cleaning exactly once", async (_, url) => {
    const f = fixture();
    await handleMessage(url, f.transport, f.dependencies);

    expect(f.calls).toEqual(["inspect", "reply", "download", "audio", "cleanup"]);
    expect(f.assertSafe).not.toHaveBeenCalled();
    expect(f.download).toHaveBeenCalledExactlyOnceWith(url);
    expect(f.transport.replyWithAudio).toHaveBeenCalledExactlyOnceWith(
      expect.any(InputFile), { title: "Example title", performer: "Example artist" },
    );
    const audio = f.transport.replyWithAudio.mock.calls[0]?.[0];
    expect(audio).toMatchObject({ fileData: f.file.filePath, filename: f.file.fileName });
    expect(f.cleanup).toHaveBeenCalledOnce();
  });

  it("guards generic URLs before inspection and download, then uploads and cleans", async () => {
    const f = fixture();
    const url = "https://media.example.test/track";
    await handleMessage(url, f.transport, f.dependencies);

    expect(f.calls).toEqual(["safety", "inspect", "reply", "download", "audio", "cleanup"]);
    expect(f.assertSafe).toHaveBeenCalledExactlyOnceWith(url);
    expect(f.inspect).toHaveBeenCalledExactlyOnceWith(url);
    expect(f.download).toHaveBeenCalledExactlyOnceWith(url);
    expect(f.cleanup).toHaveBeenCalledOnce();
  });

  it("never inspects or downloads an unsafe generic URL", async () => {
    const f = fixture();
    f.assertSafe.mockRejectedValue(new Error("DNS internal.example.test resolved to 10.0.0.8"));
    await handleMessage("https://internal.example.test/track", f.transport, f.dependencies);

    expect(f.transport.reply).toHaveBeenCalledExactlyOnceWith("This link cannot be accessed safely.");
    expect(f.inspect).not.toHaveBeenCalled();
    expect(f.download).not.toHaveBeenCalled();
    expect(f.transport.replyWithAudio).not.toHaveBeenCalled();
    expect(f.cleanup).not.toHaveBeenCalled();
  });

  it.each([true, false])("sends a fixed safe download error (inspection succeeds: %s)", async (inspectionSucceeds) => {
    const f = fixture();
    if (!inspectionSucceeds) f.inspect.mockRejectedValue(new Error("private inspection stderr"));
    f.download.mockRejectedValue(new Error("yt-dlp stderr C:\\private\\temp stack details LOGIN_REQUIRED"));
    await handleMessage("https://soundcloud.com/example/track", f.transport, f.dependencies);

    expect(f.transport.reply.mock.calls.map(([text]) => text)).toEqual([
      "Preparing your audio…",
      "I couldn't download that media link. Please try again later.",
    ]);
    expect(f.download).toHaveBeenCalledOnce();
    expect(f.transport.replyWithAudio).not.toHaveBeenCalled();
    expect(f.cleanup).not.toHaveBeenCalled();
  });

  it("cleans even when both upload and the safe error reply fail", async () => {
    const f = fixture();
    f.transport.replyWithAudio.mockRejectedValue(new Error("Telegram private error"));
    f.transport.reply.mockResolvedValueOnce({} as Awaited<ReturnType<Context["reply"]>>)
      .mockRejectedValueOnce(new Error("Error reply failed"));

    await expect(handleMessage("https://soundcloud.com/example/track", f.transport, f.dependencies))
      .rejects.toThrow("Error reply failed");
    expect(f.cleanup).toHaveBeenCalledOnce();
  });

  it.each([true, false])("sends a safe upload error and cleans (inspection succeeds: %s)", async (inspectionSucceeds) => {
    const f = fixture();
    if (!inspectionSucceeds) f.inspect.mockRejectedValue(new Error("private inspection stderr"));
    f.transport.replyWithAudio.mockRejectedValue(new Error("Telegram private error C:\\temp\\track.mp3"));
    await handleMessage("https://soundcloud.com/example/track", f.transport, f.dependencies);

    expect(f.transport.reply).toHaveBeenLastCalledWith("I couldn't send the audio. Please try again later.");
    expect(f.cleanup).toHaveBeenCalledOnce();
  });

  it.each([
    ["resolve", true], ["reject", true],
    ["resolve", false], ["reject", false],
  ] as const)("keeps the resource until upload settles (%s, inspection succeeds: %s)", async (outcome, inspectionSucceeds) => {
    const f = fixture();
    if (!inspectionSucceeds) f.inspect.mockRejectedValue(new Error("private inspection stderr"));
    let resolveUpload!: (value: Awaited<ReturnType<Context["replyWithAudio"]>>) => void;
    let rejectUpload!: (error: Error) => void;
    const upload = new Promise<Awaited<ReturnType<Context["replyWithAudio"]>>>((resolve, reject) => {
      resolveUpload = resolve;
      rejectUpload = reject;
    });
    let started!: () => void;
    const uploadStarted = new Promise<void>((resolve) => { started = resolve; });
    f.transport.replyWithAudio.mockImplementation(() => { started(); return upload; });
    const handling = handleMessage("https://soundcloud.com/example/track", f.transport, f.dependencies);
    await uploadStarted;
    expect(f.cleanup).not.toHaveBeenCalled();
    if (outcome === "resolve") resolveUpload({} as Awaited<ReturnType<Context["replyWithAudio"]>>);
    else rejectUpload(new Error("Upload failed"));
    await handling;
    expect(f.cleanup).toHaveBeenCalledOnce();
  });

  it("cleans if preparing audio metadata throws after download", async () => {
    const f = fixture();
    Object.defineProperty(f.metadata, "artist", { get() { throw new Error("Metadata access failed"); } });
    await handleMessage("https://soundcloud.com/example/track", f.transport, f.dependencies);

    expect(f.download).toHaveBeenCalledOnce();
    expect(f.transport.replyWithAudio).not.toHaveBeenCalled();
    expect(f.transport.reply).toHaveBeenLastCalledWith("I couldn't send the audio. Please try again later.");
    expect(f.cleanup).toHaveBeenCalledOnce();
  });

  it("uses uploader when artist is unavailable", async () => {
    const f = fixture();
    f.inspect.mockResolvedValue({
      id: "id", title: "Title", uploader: "Uploader", source: "SoundCloud",
    });
    await handleMessage("https://soundcloud.com/example/track", f.transport, f.dependencies);
    expect(f.transport.replyWithAudio).toHaveBeenCalledWith(expect.any(InputFile), { title: "Title", performer: "Uploader" });
  });

  it("does not acquire resources if the processing acknowledgement fails", async () => {
    const f = fixture();
    f.transport.reply.mockRejectedValue(new Error("Telegram unavailable"));
    await expect(handleMessage("https://soundcloud.com/example/track", f.transport, f.dependencies)).rejects.toThrow("Telegram unavailable");
    expect(f.download).not.toHaveBeenCalled();
  });

  it("surfaces a cleanup failure to the bot error handler without claiming download failure", async () => {
    const f = fixture();
    f.cleanup.mockRejectedValue(new Error("Cleanup failed"));
    await expect(handleMessage("https://soundcloud.com/example/track", f.transport, f.dependencies))
      .rejects.toThrow("Cleanup failed");
    expect(f.transport.replyWithAudio).toHaveBeenCalledOnce();
    expect(f.cleanup).toHaveBeenCalledOnce();
    expect(f.transport.reply).toHaveBeenCalledExactlyOnceWith("Preparing your audio…");
  });

  it.each([
    ["https://soundcloud.com/example/track", false],
    ["https://youtu.be/video-123", false],
    ["https://media.example.test/track", true],
    ["http://media.example.test/track", true],
  ])("downloads and uploads without metadata when inspection fails for %s", async (url, generic) => {
    const f = fixture();
    f.inspect.mockImplementation(async () => {
      f.calls.push("inspect");
      throw new Error("private yt-dlp stderr C:\\temp\\media and stack details");
    });
    await handleMessage(url, f.transport, f.dependencies);

    expect(f.calls).toEqual([
      ...(generic ? ["safety"] : []), "inspect", "reply", "download", "audio", "cleanup",
    ]);
    if (generic) expect(f.assertSafe).toHaveBeenCalledExactlyOnceWith(url);
    else expect(f.assertSafe).not.toHaveBeenCalled();
    expect(f.inspect).toHaveBeenCalledExactlyOnceWith(url);
    expect(f.download).toHaveBeenCalledExactlyOnceWith(url);
    expect(f.transport.reply).toHaveBeenCalledExactlyOnceWith("Preparing your audio…");
    expect(f.transport.replyWithAudio).toHaveBeenCalledExactlyOnceWith(expect.any(InputFile), {});
    expect(f.transport.replyWithAudio.mock.calls[0]?.[0]).toMatchObject({
      fileData: f.file.filePath, filename: f.file.fileName,
    });
    expect(f.cleanup).toHaveBeenCalledOnce();
  });

  it.each([
    ["https://open.spotify.com/track/123", "Spotify link recognized."],
    ["https://www.deezer.com/track/123", "Deezer link recognized."],
    ["https://music.apple.com/us/album/example/123", "Apple Music link recognized."],
    ["Massive Attack Teardrop", "Search recognized: Massive Attack Teardrop"],
    ["   ", "Please send a music link or search query."],
  ])("preserves the text response for %s", async (text, expected) => {
    const f = fixture();
    await handleMessage(text, f.transport, f.dependencies);
    expect(f.transport.reply).toHaveBeenCalledExactlyOnceWith(expected);
    expect(f.assertSafe).not.toHaveBeenCalled();
    expect(f.inspect).not.toHaveBeenCalled();
    expect(f.download).not.toHaveBeenCalled();
    expect(f.transport.replyWithAudio).not.toHaveBeenCalled();
    expect(f.cleanup).not.toHaveBeenCalled();
  });
});
