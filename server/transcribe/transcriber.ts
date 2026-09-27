import type { AuthenticatedEndpoint, FetchLike } from "../http/endpoint";
import type { LlmConfig } from "../llm/chatClient";
import { FirstReadyTranscriber, type NamedTranscriber } from "./chain";
import { LlmTranscriber } from "./llmTranscriber";
import { VocabularyCorrector } from "./proofread/corrector";
import { createKamiLexicon } from "./proofread/lexicon";
import { LlmRepairer } from "./proofread/repairer";
import { ProofreadingReader } from "./proofreadingReader";
import { SidecarTranscriber } from "./sidecarTranscriber";
import type { HandwritingTranscriber } from "./types";

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

/**
 * What `/api/transcribe` reads with: the transcriber's words proofread against the game's
 * vocabulary, and a second opinion from `repair` (a text model) on settled notes it was unsure of.
 */
export const createNoteReader = (
  transcriber: HandwritingTranscriber,
  repair: LlmConfig | null,
  fetchFn: FetchLike = fetch,
): ProofreadingReader => {
  const lexicon = createKamiLexicon();
  return new ProofreadingReader(
    transcriber,
    new VocabularyCorrector(lexicon),
    repair === null ? null : new LlmRepairer(repair, lexicon, fetchFn),
  );
};
