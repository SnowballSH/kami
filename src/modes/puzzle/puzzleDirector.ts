import type { BoardDefinition } from "../../board/types";
import { EARTH } from "../../rules/types";
import { EmbodiedDirector } from "../embodiedDirector";
import type { PlayerState, RoomStaging } from "../types";
import { PUZZLE_MODE } from "./mode";
import { PUZZLE_ROOMS, type PuzzleRoom } from "./rooms";

const INK_EATER_LOOSE = 1;

const stagingOf = (board: BoardDefinition, room: PuzzleRoom, at: number): RoomStaging => ({
  world: { ...EARTH, inkEater: INK_EATER_LOOSE, ...room.world },
  laws: { kind: "only", dials: [...room.dials, "inkEater"] },
  card: {
    mode: PUZZLE_MODE.card.title,
    title: board.title,
    line: board.zones[0]?.intro ?? PUZZLE_MODE.card.opening,
    mark: `room ${at + 1} of ${PUZZLE_ROOMS.length}`,
  },
  closing: room.closing,
  next: PUZZLE_ROOMS[at + 1]?.boardId ?? null,
});

/** The embodied referee with rooms: each board it opens is staged as the puzzle room it is, or played plainly when it is not one. */
export class PuzzleDirector extends EmbodiedDirector {
  override room: RoomStaging | null = null;

  override open(board: BoardDefinition): PlayerState {
    const at = PUZZLE_ROOMS.findIndex((room) => room.boardId === board.id);
    const room = PUZZLE_ROOMS[at];
    this.room = room === undefined ? null : stagingOf(board, room, at);
    return super.open(board);
  }
}
