import { z } from "zod";
import type { VoiceMessage } from "./types";

const voiceMessageSchema: z.ZodType<VoiceMessage> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("listening") }),
  z.object({ type: z.literal("hearing"), text: z.string() }),
  z.object({ type: z.literal("heard"), text: z.string() }),
  z.object({ type: z.literal("trouble") }),
]);

export const readVoiceMessage = (raw: string): VoiceMessage | null => {
  try {
    const parsed = voiceMessageSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

export const DONE = JSON.stringify({ type: "done" });
