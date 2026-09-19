import { browserFetch, type FetchLike } from "../persistence/api";
import { listenSocketUrl } from "./api";
import { Ears } from "./ears";
import { BrowserMicrophone } from "./microphone";
import { ElementAudioSink, Mouth } from "./mouth";
import type { DialVoice, EarsHandlers, Voice } from "./types";

export type { EarsHandlers, Voice } from "./types";

const dialBrowser =
  (location: Location): DialVoice =>
  (sampleRate, handlers, { wake }) => {
    const socket = new WebSocket(listenSocketUrl(sampleRate, location, { wake }));
    socket.binaryType = "arraybuffer";
    socket.addEventListener("open", () => handlers.opened());
    socket.addEventListener("message", (event) => handlers.message(String(event.data)));
    socket.addEventListener("close", () => handlers.closed());
    socket.addEventListener("error", () => socket.close());
    return {
      send: (data) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(data);
      },
      close: () => socket.close(),
    };
  };

export const createVoice = (
  handlers: EarsHandlers,
  fetchFn: FetchLike = browserFetch,
  location: Location = window.location,
): Voice => {
  const ears = new Ears(new BrowserMicrophone(), dialBrowser(location), handlers);
  const mouth = new Mouth(new ElementAudioSink(), fetchFn);
  return {
    hold: () => ears.hold(),
    release: () => ears.release(),
    wake: (enabled) => ears.wake(enabled),
    get listening() {
      return ears.listening;
    },
    get waking() {
      return ears.waking;
    },
    say: (text) => mouth.say(text),
    hush: () => mouth.hush(),
  };
};
