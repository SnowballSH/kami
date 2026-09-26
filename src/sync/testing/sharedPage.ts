import { FakeEventSource } from "../../controller/testing/fakeEventSource";
import { MemoryBoardStore } from "../../game/testing/fakes";
import type { DrawingId } from "../../ink/types";
import type { Note, NoteId } from "../../notes/types";
import type { BoardSnapshot, FeedCursor, StoredDrawing } from "../../persistence/types";
import type { Rule, RuleId } from "../../rules/types";
import { BoardLink } from "../boardLink";
import {
  type BoardChange,
  type BoardEdit,
  deletionOf,
  type FeedMessage,
  type PeerId,
  parseCursor,
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
 * where each says its Alice is reaches them all. Stands in for `server/sync` in the client's tests,
 * down to the cursor a load carries and the `since` a stream resumes from.
 */
export class SharedPage extends MemoryBoardStore {
  private boot = "first";
  private seq = 0;
  private log: { readonly boardId: string; readonly change: BoardChange }[] = [];
  private readonly lines: Line[] = [];
  private heldLoads: Promise<void> | null = null;
  private heldMessages: { readonly source: FakeEventSource; readonly data: string }[] | null = null;
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
    return this.lines
      .filter((line) => line.boardId === boardId && !line.source.closed)
      .map((line) => line.peer);
  }

  /** The streams opened to the page so far, oldest first. */
  streamsOf(peer: PeerId): readonly FakeEventSource[] {
    return this.lines.filter((line) => line.peer === peer).map((line) => line.source);
  }

  /** The server forgetting a device: its stream ends and the others hear it left. */
  drop(peer: PeerId): void {
    const gone = this.lines.filter((line) => line.peer === peer && !line.source.closed);
    for (const line of gone) {
      line.source.close();
      this.tell(line.boardId, { type: "presence", peer, alice: null });
    }
  }

  /** The server starting over: a new life, numbered from zero, remembering what it stored. */
  restart(boot: string): void {
    for (const line of this.lines) line.source.close();
    this.boot = boot;
    this.seq = 0;
    this.log = [];
  }

  /** Loads read the page when asked but answer only once the returned function is called. */
  holdLoads(): () => void {
    let release = (): void => {};
    this.heldLoads = new Promise((resolve) => {
      release = () => {
        this.heldLoads = null;
        resolve();
      };
    });
    return release;
  }

  /** Streams carry nothing until `deliver`: the latency between a write and its echo. */
  holdMessages(): void {
    this.heldMessages ??= [];
  }

  deliver(): void {
    const held = this.heldMessages ?? [];
    this.heldMessages = null;
    for (const { source, data } of held) if (!source.closed) source.send(data);
  }

  tell(boardId: string, message: FeedMessage): void {
    for (const line of [...this.lines]) {
      if (line.boardId === boardId && !line.source.closed) this.send(line.source, message);
    }
  }

  override async load(boardId: string): Promise<BoardSnapshot> {
    const cursor: FeedCursor = { boot: this.boot, seq: this.seq };
    const snapshot = { ...(await super.load(boardId)), cursor };
    if (this.heldLoads !== null) await this.heldLoads;
    return snapshot;
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
    const change: BoardChange = { ...edit, seq: this.seq };
    this.log.push({ boardId, change });
    this.tell(boardId, change);
  }

  private send(source: FakeEventSource, message: FeedMessage): void {
    const data = JSON.stringify(message);
    if (this.heldMessages === null) source.send(data);
    else this.heldMessages.push({ source, data });
  }

  private open(url: string, peer: PeerId): FakeEventSource {
    const boardId = boardIdIn(url);
    const source = new FakeEventSource(url);
    this.lines.push({ boardId, peer, source });
    const raw = new URL(url, "http://kami.test").searchParams.get("since");
    const since = raw === null ? null : parseCursor(raw);
    if (since === null) this.send(source, { type: "cursor", seq: this.seq, boot: this.boot });
    else if ((since.boot !== null && since.boot !== this.boot) || since.seq > this.seq)
      this.send(source, { type: "resync", seq: this.seq, boot: this.boot });
    else
      for (const { change } of this.log.filter((entry) => entry.boardId === boardId))
        if (change.seq > since.seq) this.send(source, change);
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
}

const boardIdIn = (url: string): string => {
  const segment = new URL(url, "http://kami.test").pathname.split("/")[BOARD_ID_SEGMENT];
  if (segment === undefined) throw new Error(`No board in ${url}`);
  return decodeURIComponent(segment);
};
