import type { Stroke } from "../../src/core/geometry";
import { INPUT_LIMITS } from "../../src/core/inputLimits";
import type { RuleCompiler } from "../../src/rules/types";
import type { Beautifier } from "../beautify/beautifier";
import { controllerEventStream } from "../controllers/eventStream";
import { isControllerId, parseControllerReading } from "../controllers/message";
import { noContent } from "../controllers/responses";
import type { ControllerHub } from "../controllers/types";
import { type BoardRepository, type EntityKind, isEntityKind } from "../db/boardRepository";
import type { ExemplarSource } from "../exemplar/exemplars";
import { type NatureTable, quickdrawNatureTable } from "../natures/natureTable";
import { isCertain } from "../recognition/certainty";
import type { Reading } from "../recognition/types";
import {
  beautifyRequestSchema,
  boardIdSchema,
  compileRequestSchema,
  entityIdSchema,
  noteSchema,
  recognizeRequestSchema,
  ruleSchema,
  speakRequestSchema,
  storedDrawingSchema,
  transcribeRequestSchema,
} from "../schemas";
import type { HandwritingTranscriber } from "../transcribe/llmTranscriber";
import type { Speaker } from "../voice/types";
import { ApiAccess } from "./access";
import {
  audio,
  badRequest,
  json,
  notFound,
  notImplemented,
  ok,
  type Parsed,
  parseJsonBody,
  parseTextBody,
  parseWith,
} from "./responses";
import { Router } from "./router";

export interface RankOptions {
  /** The drawing is still under the pen: guess from what there is, do not give up. */
  readonly partial?: boolean;
}

export interface SketchRecognizer {
  read(strokes: readonly Stroke[], options?: RankOptions): Promise<Reading>;
}

const MAX_GUESSES = 3;
const CONFIDENCE_DECIMALS = 3;

const recognitionOf = ({ ranking, certainAbove }: Reading, natures: NatureTable) => {
  const best = natures.merge(ranking).slice(0, MAX_GUESSES);
  const described = best.map(({ category }) => natures.describe(category));
  return {
    guesses: best.map(({ category }) => category),
    confidence: best.map(({ confidence }) => Number(confidence.toFixed(CONFIDENCE_DECIMALS))),
    names: described.map(({ name }) => name),
    natures: described.map(({ nature }) => nature),
    strengths: described.map(({ strength }) => strength),
    lines: described.map(({ line }) => line),
    certain: isCertain(best[0], certainAbove),
  };
};

export interface ApiDependencies {
  readonly access?: ApiAccess;
  readonly boards: BoardRepository;
  readonly recognizer: SketchRecognizer;
  readonly compiler: RuleCompiler;
  readonly beautifier: Beautifier;
  readonly controllers: ControllerHub;
  /** Reads the player's handwriting; null when no vision-capable model is configured. */
  readonly transcriber?: HandwritingTranscriber | null;
  /** Gives Kami a voice; null without Deepgram, and then he only writes. */
  readonly speaker?: Speaker | null;
  readonly natures?: NatureTable;
  /** Drawings for Kami to ink himself ("summon a rabbit"); without one, every summons is 404. */
  readonly exemplars?: ExemplarSource;
}

const NO_EXEMPLARS: ExemplarSource = { categories: [], exemplar: () => Promise.resolve(null) };

const INVALID_CONTROLLER_ID = "a controller id is 1–32 of a-z, 0-9 and '-'";
const INVALID_CONTROLLER_STATE = "the body is '<x> <y> [buttons]', e.g. '100 0 A'";

interface IdentifiedEntity {
  readonly id: string;
  readonly entity: object;
}

const identified = <Entity extends object>(
  parsed: Parsed<Entity>,
  idOf: (entity: Entity) => string,
): Parsed<IdentifiedEntity> =>
  parsed.ok ? { ok: true, value: { id: idOf(parsed.value), entity: parsed.value } } : parsed;

const parseEntity = async (
  kind: EntityKind,
  request: Request,
): Promise<Parsed<IdentifiedEntity>> => {
  switch (kind) {
    case "drawings":
      return identified(
        await parseJsonBody(request, storedDrawingSchema),
        (stored) => stored.drawing.id,
      );
    case "notes":
      return identified(
        await parseJsonBody(request, noteSchema, INPUT_LIMITS.textBytes),
        (note) => note.id,
      );
    case "rules":
      return identified(
        await parseJsonBody(request, ruleSchema, INPUT_LIMITS.textBytes),
        (rule) => rule.id,
      );
  }
};

interface EntityAddress {
  readonly boardId: string;
  readonly kind: EntityKind;
  readonly id: string;
}

const parseAddress = (params: {
  readonly board: string;
  readonly kind: string;
  readonly id: string;
}): Parsed<EntityAddress> => {
  if (!isEntityKind(params.kind)) return { ok: false, response: notFound() };
  const boardId = parseWith(boardIdSchema, params.board, "board id");
  if (!boardId.ok) return boardId;
  const id = parseWith(entityIdSchema, params.id, "id");
  if (!id.ok) return id;
  return { ok: true, value: { boardId: boardId.value, kind: params.kind, id: id.value } };
};

export const createApi = ({
  boards,
  recognizer,
  compiler,
  beautifier,
  controllers,
  transcriber = null,
  speaker = null,
  natures = quickdrawNatureTable,
  exemplars = NO_EXEMPLARS,
  access = new ApiAccess(),
}: ApiDependencies): Router =>
  new Router(access)
    .on("GET", "/api/boards", async ({ request }) => {
      const summaries = await boards.summaries();
      return json({ boards: access.visible(request, "boards", summaries) });
    })
    .on("GET", "/api/boards/:board", async ({ params }) => {
      const boardId = parseWith(boardIdSchema, params.board, "board id");
      return boardId.ok ? json(await boards.snapshot(boardId.value)) : boardId.response;
    })
    .on("DELETE", "/api/boards/:board", async ({ params }) => {
      const boardId = parseWith(boardIdSchema, params.board, "board id");
      if (!boardId.ok) return boardId.response;
      await boards.clear(boardId.value);
      return ok();
    })
    .on("PUT", "/api/boards/:board/:kind/:id", async ({ request, params }) => {
      const address = parseAddress(params);
      if (!address.ok) return address.response;
      const { boardId, kind, id } = address.value;
      const body = await parseEntity(kind, request);
      if (!body.ok) return body.response;
      if (body.value.id !== id) return badRequest("the id in the path and in the body differ");
      await boards.upsert(kind, boardId, id, body.value.entity);
      return ok();
    })
    .on("DELETE", "/api/boards/:board/:kind/:id", async ({ params }) => {
      const address = parseAddress(params);
      if (!address.ok) return address.response;
      await boards.remove(address.value.kind, address.value.boardId, address.value.id);
      return ok();
    })
    .on("POST", "/api/recognize", async ({ request }) => {
      const body = await parseJsonBody(request, recognizeRequestSchema);
      if (!body.ok) return body.response;
      const { strokes, partial = false } = body.value;
      return json(recognitionOf(await recognizer.read(strokes, { partial }), natures));
    })
    .on("POST", "/api/beautify", async ({ request }) => {
      const body = await parseJsonBody(request, beautifyRequestSchema);
      if (!body.ok) return body.response;
      return (await beautifier.beautify(body.value)) ?? notImplemented("no beautifier is attached");
    })
    .on("GET", "/api/exemplars", () => json({ categories: exemplars.categories }))
    .on("GET", "/api/exemplar", async ({ request }) => {
      const word = new URL(request.url).searchParams.get("word")?.trim() ?? "";
      if (word.length === 0) return badRequest("say what to draw: ?word=rabbit");
      const exemplar = await exemplars.exemplar(word);
      return exemplar === null ? json({ error: `no picture of ${word}` }, 404) : json(exemplar);
    })
    .on("POST", "/api/compile", async ({ request }) => {
      const body = await parseJsonBody(request, compileRequestSchema, INPUT_LIMITS.textBytes);
      return body.ok ? json({ rule: await compiler.compile(body.value.text) }) : body.response;
    })
    .on("GET", "/api/controllers", ({ request }) =>
      json(access.visible(request, "controllers", controllers.list())),
    )
    .on("POST", "/api/controllers/:id/state", async ({ request, params }) => {
      if (!isControllerId(params.id)) return badRequest(INVALID_CONTROLLER_ID);
      const body = await parseTextBody(request, INPUT_LIMITS.controllerBytes);
      if (!body.ok) return body.response;
      const reading = parseControllerReading(body.value);
      if (reading === null) return badRequest(INVALID_CONTROLLER_STATE);
      controllers.report(params.id, reading, "http");
      return noContent();
    })
    .on("GET", "/api/controllers/:id/events", ({ request, params }) =>
      isControllerId(params.id)
        ? controllerEventStream(controllers, params.id, {
            signal: request.signal,
            authorized: () => access.allowsController(request, params.id),
          })
        : badRequest(INVALID_CONTROLLER_ID),
    )
    .on("POST", "/api/transcribe", async ({ request }) => {
      if (transcriber === null || !transcriber.ready)
        return notImplemented("no verified handwriting reader is available");
      const body = await parseJsonBody(request, transcribeRequestSchema);
      if (!body.ok) return body.response;
      const text = await transcriber.transcribe(body.value.strokes, { signal: request.signal });
      return json({ text });
    })
    .on("POST", "/api/voice/speak", async ({ request }) => {
      if (speaker === null) return notImplemented("no voice is attached");
      const body = await parseJsonBody(request, speakRequestSchema);
      if (!body.ok) return body.response;
      const spoken = await speaker.speak(body.value.text, { signal: request.signal });
      return spoken === null ? notImplemented("Deepgram did not answer") : audio(spoken);
    });
