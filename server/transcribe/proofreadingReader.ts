import { createHash } from "node:crypto";
import type { Stroke } from "../../src/core/geometry";
import { Recent } from "../recent";
import type { VocabularyCorrector } from "./proofread/corrector";
import { doubtfulWords } from "./proofread/doubt";
import type { HandwritingRepairer } from "./proofread/repairer";
import type { HandwritingTranscriber, Transcript } from "./types";

export interface ReadOptions {
  readonly signal?: AbortSignal;
  /** The player stopped writing: this is the note's final ink, worth a second opinion. */
  readonly settled?: boolean;
}

export interface Reading {
  /** The words, or null for a drawing. */
  readonly text: string | null;
  /** The reader was unsure, and asking again with `settled` would have a model reconsider. */
  readonly unsure: boolean;
}

/** What `/api/transcribe` asks: the words these strokes say, as well as they can be told. */
export interface NoteReader {
  readonly ready: boolean;
  read(strokes: readonly Stroke[], options?: ReadOptions): Promise<Reading>;
}

const RECENT_READS = 64;
const NOT_WRITING: Reading = { text: null, unsure: false };

const keyOf = (strokes: readonly Stroke[]): string =>
  createHash("sha256").update(JSON.stringify(strokes)).digest("base64url");

/**
 * The reading `/api/transcribe` answers with: the chosen reader's transcript, proofread against
 * the game's vocabulary, and — for settled ink the reader was unsure of — a text model's second
 * opinion. Recent transcripts are remembered by their strokes, so the settled read of ink that was
 * already read on the last pen lift costs no second read.
 */
export class ProofreadingReader implements NoteReader {
  readonly #transcriber: HandwritingTranscriber;
  readonly #corrector: VocabularyCorrector;
  readonly #repairer: HandwritingRepairer | null;
  readonly #recent = new Recent<Transcript>(RECENT_READS);

  constructor(
    transcriber: HandwritingTranscriber,
    corrector: VocabularyCorrector,
    repairer: HandwritingRepairer | null,
  ) {
    this.#transcriber = transcriber;
    this.#corrector = corrector;
    this.#repairer = repairer;
  }

  get ready(): boolean {
    return this.#transcriber.ready;
  }

  async read(
    strokes: readonly Stroke[],
    { signal, settled = false }: ReadOptions = {},
  ): Promise<Reading> {
    const transcript = await this.#transcriptOf(strokes, signal);
    if (transcript === null) return NOT_WRITING;
    const proofread = this.#corrector.correct(transcript);
    const unsure =
      this.#repairer !== null &&
      transcript.sureness !== undefined &&
      doubtfulWords(proofread).length > 0;
    if (!unsure || !settled || this.#repairer === null) return { text: proofread.text, unsure };
    const repair = await this.#repairer.repair(proofread, signal);
    return { text: repair === undefined ? proofread.text : repair.text, unsure: false };
  }

  async #transcriptOf(
    strokes: readonly Stroke[],
    signal?: AbortSignal,
  ): Promise<Transcript | null> {
    const key = keyOf(strokes);
    const remembered = this.#recent.get(key);
    if (remembered !== undefined) return remembered;
    const transcript = await this.#transcriber.transcribe(
      strokes,
      signal === undefined ? {} : { signal },
    );
    if (transcript !== null) this.#recent.set(key, transcript);
    return transcript;
  }
}
