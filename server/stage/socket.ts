import type { Server, ServerWebSocket, WebSocketHandler } from "bun";
import {
  ROLE_PARAM,
  STAGE_NAME_PATTERN,
  STAGE_SOCKET_PREFIX,
  type StageRole,
} from "../../src/stage/wire";
import type { ApiAccess, SocketGrant } from "../http/access";
import { badRequest, notFound } from "../http/responses";
import { type Seat, StageHub } from "./stageHub";

const AUTHORIZATION_INTERVAL_MS = 15_000;

export interface StageSocketData {
  readonly kind: "stage";
  readonly stage: string;
  readonly role: StageRole;
  readonly access: SocketGrant;
  seat: Seat | null;
  authorizationTimer: ReturnType<typeof setInterval> | null;
}

type StageClient = Pick<
  ServerWebSocket<StageSocketData>,
  "data" | "send" | "close" | "getBufferedAmount"
>;

export const isStageSocket = (request: Request): boolean =>
  new URL(request.url).pathname.startsWith(STAGE_SOCKET_PREFIX);

const roleOf = (url: URL): StageRole | null => {
  const role = url.searchParams.get(ROLE_PARAM);
  return role === "source" || role === "screen" ? role : null;
};

/** The big screen: playing devices show what they render, screens watch (`docs/screen.md`). */
export const stageSockets = (access: ApiAccess, hub: StageHub = new StageHub()) => {
  const leave = (socket: StageClient): void => {
    if (socket.data.authorizationTimer !== null) clearInterval(socket.data.authorizationTimer);
    socket.data.authorizationTimer = null;
    if (socket.data.seat !== null) hub.left(socket.data.stage, socket.data.seat);
    socket.data.seat = null;
  };

  const authorized = (socket: StageClient): boolean => {
    if (socket.data.access.authorized()) return true;
    leave(socket);
    socket.close(1008, "access expired");
    return false;
  };

  return {
    upgrade: (
      request: Request,
      server: Pick<Server<StageSocketData>, "upgrade">,
    ): Response | undefined => {
      const grant = access.openSocket(request);
      if (grant instanceof Response) return grant;
      const url = new URL(request.url);
      const stage = url.pathname.slice(STAGE_SOCKET_PREFIX.length);
      const role = roleOf(url);
      if (!STAGE_NAME_PATTERN.test(stage)) return notFound();
      if (role === null) return badRequest("role must be source or screen");
      const data: StageSocketData = {
        kind: "stage",
        stage,
        role,
        access: grant,
        seat: null,
        authorizationTimer: null,
      };
      return server.upgrade(request, { data })
        ? undefined
        : badRequest("WebSocket upgrade required");
    },
    websocket: {
      open: (socket: StageClient) => {
        if (!authorized(socket)) return;
        const seat: Seat = {
          send: (message) => void socket.send(message),
          buffered: () => socket.getBufferedAmount(),
        };
        socket.data.seat = seat;
        socket.data.authorizationTimer = setInterval(
          () => authorized(socket),
          AUTHORIZATION_INTERVAL_MS,
        );
        const stage = hub.stage(socket.data.stage);
        if (socket.data.role === "source") stage.sourceJoined(seat);
        else stage.screenJoined(seat);
      },
      message: (socket: StageClient, message: string | Buffer) => {
        if (typeof message !== "string" || socket.data.seat === null) return;
        if (authorized(socket)) hub.stage(socket.data.stage).said(socket.data.seat, message);
      },
      close: (socket: StageClient) => leave(socket),
    } satisfies WebSocketHandler<StageSocketData>,
  };
};
