import type { WebSocketHandler } from "bun";
import { MAX_MESSAGE_BYTES } from "../../src/stage/wire";
import type { StageSocketData } from "../stage/socket";

/** Bun serves one WebSocket handler per server; the stage is the only socket Kami opens. */
export type SocketData = StageSocketData;

export const socketsOf = (
  stage: WebSocketHandler<StageSocketData>,
): WebSocketHandler<SocketData> => ({
  maxPayloadLength: MAX_MESSAGE_BYTES,
  ...stage,
});
