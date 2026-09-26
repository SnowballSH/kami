import { type EventStreamSettings, eventStreamResponse } from "../http/eventStream";
import type { ControllerHub, ControllerState } from "./types";

const eventOf = (state: ControllerState): string => `data: ${JSON.stringify(state)}\n\n`;

/** Server-Sent Events for one controller: its state now, then every change, until the client leaves. */
export const controllerEventStream = (
  hub: ControllerHub,
  id: string,
  settings: Partial<EventStreamSettings> = {},
): Response =>
  eventStreamResponse((send) => hub.subscribe(id, (state) => send(eventOf(state))), settings);
