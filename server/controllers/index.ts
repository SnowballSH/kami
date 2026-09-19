/** The physical-controller relay: one hub, fed by UDP, serial and `POST /api/controllers/:id/state`. */
import { InMemoryControllerHub } from "./hub";
import { listenOnSerial } from "./serialListener";
import type {
  ControllerHub,
  ControllerInput,
  ControllerTransportConfig,
  HubClock,
  Log,
} from "./types";
import { listenOnUdp } from "./udpListener";

export interface Controllers {
  readonly hub: ControllerHub;
  readonly description: string;
  close(): Promise<void>;
}

export interface ControllersSettings {
  readonly log: Log;
  readonly clock: HubClock;
}

const HTTP_INPUT = "HTTP POST";

const udpInput = async (
  hub: ControllerHub,
  port: number,
  log: Log,
): Promise<ControllerInput | null> => {
  try {
    return await listenOnUdp(hub, port, { log });
  } catch (error) {
    log(
      `controllers: UDP :${port} is unavailable (${error instanceof Error ? error.message : error})`,
    );
    return null;
  }
};

/** Never rejects: a transport that cannot start is logged and left out, the rest carry on. */
export const startControllers = async (
  { udpPort, serialDevice }: ControllerTransportConfig,
  { log = console.log, clock }: Partial<ControllersSettings> = {},
): Promise<Controllers> => {
  const hub = new InMemoryControllerHub(clock);
  const inputs = [
    udpPort === null ? null : await udpInput(hub, udpPort, log),
    serialDevice === null ? null : listenOnSerial(hub, serialDevice, { log }),
  ].filter((input) => input !== null);
  return {
    hub,
    description: [...inputs.map(({ description }) => description), HTTP_INPUT].join(", "),
    close: async () => {
      await Promise.all(inputs.map((input) => input.close()));
      hub.close();
    },
  };
};
