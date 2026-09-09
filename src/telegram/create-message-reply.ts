import { classifyInput } from "../domain/classify-input.js";
import {
  inspectMediaUrl,
  type MediaInspectionResult,
} from "../media/yt-dlp.js";
import { assertSafePublicUrl } from "../security/assert-safe-public-url.js";
import {
  createInputReply,
  createMediaInspectionErrorReply,
  createMediaInspectionReply,
  createUnsafeUrlReply,
} from "./input-reply.js";

type MediaInspector = (url: string) => Promise<MediaInspectionResult>;
type PublicUrlSafetyGuard = (url: string) => Promise<void>;

async function inspectAndCreateReply(
  url: string,
  inspect: MediaInspector,
  provider?: "youtube" | "soundcloud",
): Promise<string> {
  try {
    const metadata = await inspect(url);
    return createMediaInspectionReply(metadata, provider);
  } catch {
    return createMediaInspectionErrorReply();
  }
}

export async function createMessageReply(
  messageText: string,
  inspect: MediaInspector = inspectMediaUrl,
  assertSafe: PublicUrlSafetyGuard = assertSafePublicUrl,
): Promise<string> {
  const input = classifyInput(messageText);

  if (input.type === "generic-url") {
    try {
      await assertSafe(input.url);
    } catch {
      return createUnsafeUrlReply();
    }

    return inspectAndCreateReply(input.url, inspect);
  }

  if (
    input.type === "known-provider-url" &&
    (input.provider === "youtube" || input.provider === "soundcloud")
  ) {
    return inspectAndCreateReply(input.url, inspect, input.provider);
  }

  return createInputReply(input);
}
