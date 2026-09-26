import type { BoardDefinition } from "../board/types";
import type { PenScript } from "../handwriting/types";
import type { InkMotion } from "../ink/retrace";
import type { Drawing, DrawingId } from "../ink/types";
import type { NoteId } from "../notes/types";
import type { InkView, NoteView, RenderFrame } from "../render/types";
import type { DrawnBody } from "../sim/body/types";
import type { AliceLook, AliceSnapshot, WorldSnapshot } from "../sim/types";
import type { LawListing } from "../ui/types";

/** A stage is one big screen's worth of play: devices that draw on it and screens that show it. */
export const STAGE_SOCKET_PREFIX = "/api/stage/";
export const DEFAULT_STAGE = "main";
export const STAGE_NAME_PATTERN = /^[a-z0-9-]{1,32}$/;
export const ROLE_PARAM = "role";

/** A `source` is a device someone plays on; a `screen` only watches. */
export type StageRole = "source" | "screen";

/** What a source says. Everything but `active` is shown on the screens while that source is live. */
export const SHOWN_KINDS = ["board", "ink", "note", "body", "laws", "frame"] as const;
export type ShownKind = (typeof SHOWN_KINDS)[number];
/** `active`: someone is drawing on this device; said even while it rests, to ask for the stage. */
export type SourceKind = ShownKind | "active";
/** What the server tells a source: `go` — a screen is watching you, start over from the board; `rest` — nobody is. */
export type DirectionKind = "go" | "rest";
/** What the server tells a screen besides what the live source shows: nobody is playing. */
export type ScreenKind = ShownKind | "offstage";

export const FRAME_KIND: ShownKind = "frame";
export const MAX_FRAME_BYTES = 512 * 1024;
export const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;

/** CSS px of the source's canvas: the screen fits the same stretch of board into its own. */
export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/** An ink without its strokes, which travel once in an `ink` message and again only when they change. */
export type LeanInk = Omit<InkView, "drawing" | "settling"> & { readonly id: DrawingId };

/**
 * A drawing as it settles: its final strokes, and while it is still coming in the motion that
 * brings it there, which the screen plays on the frames' own clock rather than being sent it.
 */
export type StagedInk = Drawing & { readonly motion?: InkMotion };
/** A note without its script, which travels once in a `note` message. */
export type LeanNote = Omit<NoteView, "script">;

/** A body the player drew for Alice travels once in a `body` message; her look then names it. */
export type LeanLook =
  | Extract<AliceLook, { kind: "alice" }>
  | (Omit<Extract<AliceLook, { kind: "drawn" }>, "body"> & { readonly bodyRef: number });
export type LeanAlice = Omit<AliceSnapshot, "look"> & { readonly look: LeanLook };

export interface LeanWorld extends Omit<WorldSnapshot, "alice" | "twins"> {
  readonly alice: LeanAlice | null;
  readonly twins: readonly LeanAlice[];
}

export interface LeanFrame extends Omit<RenderFrame, "inks" | "notes" | "world" | "ghosts"> {
  readonly inks: readonly LeanInk[];
  readonly notes: readonly LeanNote[];
  readonly world: LeanWorld;
  readonly ghosts?: readonly LeanAlice[];
  readonly viewport: Viewport;
}

export interface StageBodies {
  readonly board: BoardDefinition;
  readonly ink: StagedInk;
  readonly note: { readonly id: NoteId; readonly script: PenScript };
  readonly body: { readonly ref: number; readonly body: DrawnBody };
  readonly laws: readonly LawListing[];
  readonly frame: LeanFrame;
}

export type ShownMessage = {
  readonly [Kind in ShownKind]: { readonly kind: Kind; readonly body: StageBodies[Kind] };
}[ShownKind];

const SEPARATOR = "\n";

/**
 * On the wire a message is its kind, a newline, and a JSON body (empty for the bare kinds), so the
 * server can tell a frame it may drop from a drawing it must deliver without parsing either.
 */
export const pack = (kind: string, body?: unknown): string =>
  body === undefined ? kind : `${kind}${SEPARATOR}${JSON.stringify(body)}`;

export const kindOf = (message: string): string => {
  const end = message.indexOf(SEPARATOR);
  return end === -1 ? message : message.slice(0, end);
};

const isShownKind = (kind: string): kind is ShownKind =>
  (SHOWN_KINDS as readonly string[]).includes(kind);

/** Null for anything that is not a shown message with a JSON body; the body's shape is the source's word. */
export const unpackShown = (message: string): ShownMessage | null => {
  const kind = kindOf(message);
  if (!isShownKind(kind) || message.length <= kind.length + SEPARATOR.length) return null;
  try {
    const body: unknown = JSON.parse(message.slice(kind.length + SEPARATOR.length));
    return typeof body === "object" && body !== null ? ({ kind, body } as ShownMessage) : null;
  } catch {
    return null;
  }
};

export const stageNameOf = (asked: string | null): string =>
  asked !== null && STAGE_NAME_PATTERN.test(asked) ? asked : DEFAULT_STAGE;

export const stageSocketUrl = (stage: string, role: StageRole, location: Location): string => {
  const url = new URL(`${STAGE_SOCKET_PREFIX}${stage}`, location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.search = "";
  url.searchParams.set(ROLE_PARAM, role);
  return url.toString();
};
