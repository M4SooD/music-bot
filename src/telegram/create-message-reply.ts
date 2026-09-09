import { classifyInput } from "../domain/classify-input.js";
import {
  inspectMediaUrl,
  type MediaInspectionResult,
} from "../media/yt-dlp.js";
import {
  createInputReply,
  createMediaInspectionErrorReply,
  createMediaInspectionReply,
} from "./input-reply.js";

type MediaInspector = (url: string) => Promise<MediaInspectionResult>;

export async function createMessageReply(
  messageText: string,
  inspect: MediaInspector = inspectMediaUrl,
): Promise<string> {
  const input = classifyInput(messageText);

  if (
    input.type !== "known-provider-url" ||
    (input.provider !== "youtube" && input.provider !== "soundcloud")
  ) {
    return createInputReply(input);
  }

  try {
    const metadata = await inspect(input.url);
    return createMediaInspectionReply(metadata, input.provider);
  } catch {
    return createMediaInspectionErrorReply();
  }
}
