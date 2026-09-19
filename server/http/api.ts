import type { Stroke } from "../../src/core/geometry";
import type { RuleCompiler } from "../../src/rules/types";
import { type BoardRepository, type EntityKind, isEntityKind } from "../db/boardRepository";
import {
  boardIdSchema,
  compileRequestSchema,
  entityIdSchema,
  noteSchema,
  recognizeRequestSchema,
  ruleSchema,
  storedDrawingSchema,
} from "../schemas";
import { badRequest, json, notFound, ok, type Parsed, parseJsonBody, parseWith } from "./responses";
import { Router } from "./router";

export interface SketchRecognizer {
  recognize(strokes: readonly Stroke[]): readonly string[];
}

export interface ApiDependencies {
  readonly boards: BoardRepository;
  readonly recognizer: SketchRecognizer;
  readonly compiler: RuleCompiler;
}

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
      return identified(await parseJsonBody(request, noteSchema), (note) => note.id);
    case "rules":
      return identified(await parseJsonBody(request, ruleSchema), (rule) => rule.id);
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

export const createApi = ({ boards, recognizer, compiler }: ApiDependencies): Router =>
  new Router()
    .on("GET", "/api/boards", async () => json({ boards: await boards.summaries() }))
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
      return body.ok ? json({ guesses: recognizer.recognize(body.value.strokes) }) : body.response;
    })
    .on("POST", "/api/compile", async ({ request }) => {
      const body = await parseJsonBody(request, compileRequestSchema);
      return body.ok ? json({ rule: await compiler.compile(body.value.text) }) : body.response;
    });
