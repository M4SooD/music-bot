import { InputFile, type Context } from "grammy";

import {
  downloadMediaAsMp3,
  type DownloadedMediaFile,
} from "../media/yt-dlp-download.js";
import {
  createMediaDownloadErrorReply,
  createMediaUploadErrorReply,
} from "./input-reply.js";
import {
  prepareMessage,
  type MessagePreparationDependencies,
} from "./prepare-message.js";

type MessageTransport = Pick<Context, "reply" | "replyWithAudio">;
type MessageDependencies = MessagePreparationDependencies & {
  download?: (url: string) => Promise<DownloadedMediaFile>;
};

export async function handleMessage(
  messageText: string,
  transport: MessageTransport,
  dependencies: MessageDependencies = {},
): Promise<void> {
  const message = await prepareMessage(messageText, dependencies);

  if (message.type === "text") {
    await transport.reply(message.text);
    return;
  }

  await transport.reply("Preparing your audio…");

  let file: DownloadedMediaFile;
  try {
    file = await (dependencies.download ?? downloadMediaAsMp3)(message.url);
  } catch {
    await transport.reply(createMediaDownloadErrorReply());
    return;
  }

  try {
    const performer = message.metadata?.artist ?? message.metadata?.uploader;
    await transport.replyWithAudio(new InputFile(file.filePath, file.fileName), {
      ...(message.metadata && { title: message.metadata.title }),
      ...(performer && { performer }),
    });
  } catch {
    await transport.reply(createMediaUploadErrorReply());
  } finally {
    // InputFile reads lazily: ownership lasts until the upload request settles.
    await file.cleanup();
  }
}
