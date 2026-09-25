import type { LlmConfig } from "../compile/llmCompiler";
import type { AuthenticatedEndpoint } from "../http/endpoint";
import type { FetchLike } from "../recognition/types";
import { FirstReadyTranscriber, type NamedTranscriber } from "./chain";
import { LlmTranscriber } from "./llmTranscriber";
import { SidecarTranscriber } from "./sidecarTranscriber";

export interface HandwritingReaders {
  /** The sidecar's local reader (`POST /read`): first choice whenever one is configured. */
  readonly sidecar: AuthenticatedEndpoint | null;
  /** A vision-capable chat model: the fallback when there is no local reader or it fails its check. */
  readonly vision: LlmConfig | null;
}

/** Null when neither reader is configured; `/api/transcribe` then answers 501. */
export const createTranscriber = (
  { sidecar, vision }: HandwritingReaders,
  fetchFn: FetchLike = fetch,
): FirstReadyTranscriber | null => {
  const candidates: NamedTranscriber[] = [
    ...(sidecar === null
      ? []
      : [
          {
            name: `local reader (${sidecar.url})`,
            transcriber: new SidecarTranscriber(sidecar, fetchFn),
          },
        ]),
    ...(vision === null
      ? []
      : [
          {
            name: `vision model ${vision.model}`,
            transcriber: new LlmTranscriber(vision, fetchFn),
          },
        ]),
  ];
  return candidates.length === 0 ? null : new FirstReadyTranscriber(candidates);
};
