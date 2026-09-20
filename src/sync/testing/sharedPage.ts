import { FakeEventSource } from "../../controller/testing/fakeEventSource";
import { MemoryBoardStore } from "../../game/testing/fakes";
import type { DrawingId } from "../../ink/types";
import type { Note, NoteId } from "../../notes/types";
import type { StoredDrawing } from "../../persistence/types";
import type { Rule, RuleId } from "../../rules/types";
import { BoardLink } from "../boardLink";
import {
  type BoardEdit,
  deletionOf,
  type FeedMessage,
  type PeerId,
  presenceReportSchema,
} from "../wire";

const BOARD_ID_SEGMENT = 3;

interface Line {
  readonly boardId: string;
  readonly peer: PeerId;
  readonly source: FakeEventSource;
}

/**
 * The server as several devices see it, in memory: what one saves the others hear, numbered, and
 * where each says its Alice is reaches them all. Stands in for `server/sync` in the client's tests.
 */
export class SharedPage extends MemoryBoardStore {
  private seq = 0;
  private readonly lines: Line[] = [];
  readonly presences: { readonly boardId: string; readonly peer: PeerId }[] = [];

  link(peer: PeerId, presenceIntervalMs?: number): BoardLink {
    return new BoardLink({
      peer,
      openEventSource: (url) => this.open(url, peer),
      fetch: (url, init) => this.post(url, init),
      ...(presenceIntervalMs === undefined ? {} : { presenceIntervalMs }),
    });
  }

  peersOn(boardId: string): readonly PeerId[] {
    return this.lines.filter((line) => line.boardId === boardId).map((line) => line.peer);
  }

  /** The server forgetting a device: its stream ends and the others hear it left. */
  drop(peer: PeerId): void {
    const gone = this.lines.filter((line) => line.peer === peer);
    for (const line of gone) {
      line.source.close();
      this.tell(line.boardId, { type: "presence", peer, alice: null });
    }
    this.forget(peer);
  }

  tell(boardId: string, message: FeedMessage): void {
    for (const line of [...this.lines]) {
      if (line.boardId === boardId && !line.source.closed)
        line.source.send(JSON.stringify(message));
    }
  }

  override saveDrawing(boardId: string, stored: StoredDrawing): void {
    super.saveDrawing(boardId, stored);
    this.relay(boardId, { type: "put", kind: "drawings", id: stored.drawing.id, entity: stored });
  }

  override deleteDrawing(boardId: string, id: DrawingId): void {
    super.deleteDrawing(boardId, id);
    this.relay(boardId, deletionOf("drawings", id));
  }

  override saveNote(boardId: string, note: Note): void {
    super.saveNote(boardId, note);
    this.relay(boardId, { type: "put", kind: "notes", id: note.id, entity: note });
  }

  override deleteNote(boardId: string, id: NoteId): void {
    super.deleteNote(boardId, id);
    this.relay(boardId, deletionOf("notes", id));
  }

  override saveRule(boardId: string, rule: Rule): void {
    super.saveRule(boardId, rule);
    this.relay(boardId, { type: "put", kind: "rules", id: rule.id, entity: rule });
  }

  override deleteRule(boardId: string, id: RuleId): void {
    super.deleteRule(boardId, id);
    this.relay(boardId, deletionOf("rules", id));
  }

  override clear(boardId: string): void {
    super.clear(boardId);
    this.relay(boardId, { type: "clear" });
  }

  private relay(boardId: string, edit: BoardEdit): void {
    this.seq += 1;
    this.tell(boardId, { ...edit, seq: this.seq });
  }

  private open(url: string, peer: PeerId): FakeEventSource {
    this.forget(peer);
    const source = new FakeEventSource(url);
    this.lines.push({ boardId: boardIdIn(url), peer, source });
    return source;
  }

  private post(url: string, init?: RequestInit): Promise<Response> {
    const report = presenceReportSchema.safeParse(JSON.parse(String(init?.body)));
    if (!report.success) return Promise.resolve(new Response(null, { status: 400 }));
    const boardId = boardIdIn(url);
    this.presences.push({ boardId, peer: report.data.peer });
    this.tell(boardId, { type: "presence", ...report.data });
    return Promise.resolve(new Response(null, { status: 204 }));
  }

  private forget(peer: PeerId): void {
    for (let index = this.lines.length - 1; index >= 0; index -= 1) {
      if (this.lines[index]?.peer === peer) this.lines.splice(index, 1);
    }
  }
}

const boardIdIn = (url: string): string => {
  const segment = new URL(url, "http://kami.test").pathname.split("/")[BOARD_ID_SEGMENT];
  if (segment === undefined) throw new Error(`No board in ${url}`);
  return decodeURIComponent(segment);
};
