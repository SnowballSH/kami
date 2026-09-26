import { connect, type Socket } from "node:net";
import type { NoteId } from "../../../src/notes/types";
import { formatCursor, type PeerId } from "../../../src/sync/wire";
import type { EventStreamEnd } from "../../http/eventStream";
import { boardEventStream, sinceOf } from "../boardEventStream";
import { BoardFeed } from "../boardFeed";

/**
 * Run with Bun: serves a board's event stream, opens it from a raw TCP client that then stops reading,
 * and writes 256 KiB changes to the board until the server drops that stream. Prints one JSON
 * `StalledReaderReport`. `flood` writes as fast as it can; `trickle` writes slowly under a huge byte
 * limit, so only the stall deadline can end the stream.
 */

export type ProbeMode = "flood" | "trickle";

export interface StalledReaderReport {
  readonly bun: string;
  readonly end: EventStreamEnd | null;
  readonly recordedBytes: number;
  readonly rssBytes: number;
  readonly caughtUp: boolean;
  readonly resyncedFromStart: boolean;
}

export const PROBE_LIMIT_BYTES = 64 * 1024 * 1024;
export const PROBE_STALL_MS = 1_000;
const CHANGE_BYTES = 256 * 1024;
const BOARD = "board";

const bulkyNote = (id: string) => ({
  type: "put" as const,
  kind: "notes" as const,
  id,
  entity: {
    id: id as NoteId,
    author: "player" as const,
    text: "x".repeat(CHANGE_BYTES),
    position: { x: 0, y: 0 },
    tone: "plain" as const,
    createdAt: 1,
    fleeting: false,
  },
});

const openStalledReader = (port: number): Promise<Socket> =>
  new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1", () => {
      socket.write(`GET /events?peer=stalled HTTP/1.1\r\nHost: kami.test\r\n\r\n`);
      socket.pause();
      resolve(socket);
    });
  });

const readUntil = async (response: Response, marker: string): Promise<string> => {
  const reader = response.body?.getReader();
  if (reader === undefined) return "";
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes(marker)) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  await reader.cancel();
  return text;
};

const probe = async (mode: ProbeMode): Promise<StalledReaderReport> => {
  const feed = new BoardFeed();
  let end: EventStreamEnd | null = null;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (request) => {
      const peer = new URL(request.url).searchParams.get("peer");
      return boardEventStream(feed, BOARD, {
        since: sinceOf(request),
        signal: request.signal,
        ...(peer === "stalled" && {
          peer: peer as PeerId,
          keepAliveMs: 250,
          stallMs: PROBE_STALL_MS,
          ...(mode === "trickle" && { maxBacklogBytes: PROBE_LIMIT_BYTES }),
          onEnd: (ended) => {
            end = ended;
          },
        }),
      });
    },
  });
  if (server.port === undefined) throw new Error("the probe server listens on no port");
  const socket = await openStalledReader(server.port);
  await Bun.sleep(100);
  let recordedBytes = 0;
  for (let i = 0; end === null && recordedBytes < PROBE_LIMIT_BYTES; i++) {
    feed.record(BOARD, bulkyNote(`n${i}`));
    recordedBytes += CHANGE_BYTES;
    await Bun.sleep(mode === "flood" ? 1 : 50);
  }
  const rssBytes = process.memoryUsage().rss;
  const { seq } = feed.cursorOf(BOARD);
  const resume = formatCursor({ boot: feed.boot, seq: seq - 2 });
  const last = `id: ${formatCursor({ boot: feed.boot, seq })}\n`;
  const caughtUpText = await readUntil(
    await fetch(`${server.url}events`, { headers: { "last-event-id": resume } }),
    last,
  );
  const fromStart = await readUntil(
    await fetch(`${server.url}events?since=${formatCursor({ boot: feed.boot, seq: 0 })}`),
    '"type":"resync"',
  );
  socket.destroy();
  await server.stop(true);
  return {
    bun: Bun.version,
    end,
    recordedBytes,
    rssBytes,
    caughtUp:
      caughtUpText.includes(`id: ${formatCursor({ boot: feed.boot, seq: seq - 1 })}\n`) &&
      caughtUpText.includes(last) &&
      !caughtUpText.includes('"type":"resync"'),
    resyncedFromStart: fromStart.includes('"type":"resync"'),
  };
};

if (import.meta.main) {
  const mode = process.argv[2] === "trickle" ? "trickle" : "flood";
  console.log(JSON.stringify(await probe(mode)));
  process.exit(0);
}
