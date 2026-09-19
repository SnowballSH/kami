import { createSocket } from "node:dgram";
import { linesOf, reportLines } from "./lines";
import type { ControllerHub, ControllerInput, Log } from "./types";

const EVERY_INTERFACE = "0.0.0.0";

export interface UdpListener extends ControllerInput {
  readonly port: number;
}

export interface UdpListenerSettings {
  readonly host: string;
  readonly log: Log;
}

/** Resolves once the socket is bound; rejects when the port cannot be had. Port 0 picks a free one. */
export const listenOnUdp = (
  hub: ControllerHub,
  port: number,
  { host = EVERY_INTERFACE, log = console.log }: Partial<UdpListenerSettings> = {},
): Promise<UdpListener> =>
  new Promise((resolve, reject) => {
    const socket = createSocket("udp4");
    const refuse = (error: Error): void => {
      socket.close();
      reject(error);
    };
    socket.once("error", refuse);
    socket.on("message", (datagram) => reportLines(hub, linesOf(datagram.toString("utf8")), "udp"));
    socket.bind(port, host, () => {
      socket.off("error", refuse);
      socket.on("error", (error) => log(`controllers: UDP socket error (${error.message})`));
      const bound = socket.address().port;
      resolve({
        port: bound,
        description: `UDP :${bound}`,
        close: () => new Promise<void>((closed) => socket.close(() => closed())),
      });
    });
  });
