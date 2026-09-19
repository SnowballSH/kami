// @vitest-environment node
import { createSocket } from "node:dgram";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryControllerHub } from "./hub";
import { ManualClock } from "./testing/manualClock";
import { listenOnUdp, type UdpListener } from "./udpListener";

const LOOPBACK = "127.0.0.1";

const sendDatagram = (port: number, text: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const socket = createSocket("udp4");
    socket.send(text, port, LOOPBACK, (error) => {
      socket.close();
      if (error === null) resolve();
      else reject(error);
    });
  });

let hub: InMemoryControllerHub;
let listener: UdpListener;

beforeEach(async () => {
  hub = new InMemoryControllerHub(new ManualClock());
  listener = await listenOnUdp(hub, 0, { host: LOOPBACK, log: () => {} });
});

afterEach(async () => {
  await listener.close();
  hub.close();
});

describe("the UDP listener", () => {
  it("binds a free port when asked for port 0 and says which", () => {
    expect(listener.port).toBeGreaterThan(0);
    expect(listener.description).toBe(`UDP :${listener.port}`);
  });

  it("carries a datagram from the wire into the hub", async () => {
    await sendDatagram(listener.port, "kami arcade 100 0 A\n");
    await vi.waitFor(() =>
      expect(hub.list()).toEqual([
        {
          id: "arcade",
          x: 1,
          y: 0,
          held: ["right", "up"],
          buttons: ["a"],
          transport: "udp",
          idleMs: 0,
        },
      ]),
    );
  });

  it("reads every line of a datagram and shrugs at anything that is not ours", async () => {
    await sendDatagram(listener.port, "GET / HTTP/1.1\r\nkami one -100 0\r\nkami two 0 -100");
    await vi.waitFor(() => expect(hub.list().map(({ id }) => id)).toEqual(["one", "two"]));
    expect(hub.list().map(({ held }) => held)).toEqual([["left"], ["down"]]);
  });

  it("refuses a port that is taken instead of throwing later", async () => {
    await expect(listenOnUdp(hub, listener.port, { host: LOOPBACK })).rejects.toThrow();
  });
});
