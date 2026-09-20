import type { ServerWebSocket, WebSocketHandler } from "bun";
import type { StageSocketData } from "../stage/socket";
import type { VoiceSocketData } from "../voice/socket";

/** Bun serves one WebSocket handler per server; every socket says which of ours it belongs to. */
export type SocketData = VoiceSocketData | StageSocketData;

const isStage = (socket: ServerWebSocket<SocketData>): socket is ServerWebSocket<StageSocketData> =>
  socket.data.kind === "stage";

const isVoice = (socket: ServerWebSocket<SocketData>): socket is ServerWebSocket<VoiceSocketData> =>
  socket.data.kind === "voice";

export const socketsOf = (
  voice: WebSocketHandler<VoiceSocketData>,
  stage: WebSocketHandler<StageSocketData>,
): WebSocketHandler<SocketData> => ({
  open: (socket) => {
    if (isStage(socket)) void stage.open?.(socket);
    else if (isVoice(socket)) void voice.open?.(socket);
  },
  message: (socket, message) => {
    if (isStage(socket)) void stage.message(socket, message);
    else if (isVoice(socket)) void voice.message(socket, message);
  },
  close: (socket, code, reason) => {
    if (isStage(socket)) void stage.close?.(socket, code, reason);
    else if (isVoice(socket)) void voice.close?.(socket, code, reason);
  },
});
