import { classifyInput } from "../domain/classify-input.js";
import {
  inspectMediaUrl,
  type MediaInspectionResult,
} from "../media/yt-dlp.js";
import { assertSafePublicUrl } from "../security/assert-safe-public-url.js";
import {
  createInputReply,
  createMediaInspectionErrorReply,
  createUnsafeUrlReply,
} from "./input-reply.js";

export type MessagePreparationDependencies = {
  inspect?: (url: string) => Promise<MediaInspectionResult>;
  assertSafe?: (url: string) => Promise<void>;
};

export type PreparedMessage =
  | { type: "text"; text: string }
  | { type: "media"; url: string; metadata: MediaInspectionResult };

async function inspectAndPrepareMedia(
  url: string,
  inspect: NonNullable<MessagePreparationDependencies["inspect"]>,
): Promise<PreparedMessage> {
  try {
    const metadata = await inspect(url);
    return { type: "media", url, metadata };
  } catch {
    return { type: "text", text: createMediaInspectionErrorReply() };
  }
}

export async function prepareMessage(
  messageText: string,
  {
    inspect = inspectMediaUrl,
    assertSafe = assertSafePublicUrl,
  }: MessagePreparationDependencies = {},
): Promise<PreparedMessage> {
  const input = classifyInput(messageText);

  if (input.type === "generic-url") {
    try {
      await assertSafe(input.url);
    } catch {
      return { type: "text", text: createUnsafeUrlReply() };
    }

    return inspectAndPrepareMedia(input.url, inspect);
  }

  if (
    input.type === "known-provider-url" &&
    (input.provider === "youtube" || input.provider === "soundcloud")
  ) {
    return inspectAndPrepareMedia(input.url, inspect);
  }

  return { type: "text", text: createInputReply(input) };
}
