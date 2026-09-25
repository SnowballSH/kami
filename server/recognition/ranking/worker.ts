/** A ranking thread: given the shared feature matrix once, it answers rank requests for ever. */
import { parentPort } from "node:worker_threads";
import { QuickdrawRecognizer } from "../../quickdraw/recognizer";
import type { FromWorker, ToWorker } from "./protocol";

export const createWorkerState = (post: (message: FromWorker) => void) => {
  let recognizer: QuickdrawRecognizer | null = null;
  return (message: ToWorker): void => {
    if (message.type === "load") {
      recognizer = new QuickdrawRecognizer(message.matrix, message.options);
      return;
    }
    const reading = recognizer?.read(message.strokes, message.options) ?? {
      ranking: [],
      certainAbove: null,
    };
    post({ type: "reading", id: message.id, reading });
  };
};

if (parentPort !== null) {
  const port = parentPort;
  port.on(
    "message",
    createWorkerState((message) => port.postMessage(message)),
  );
}
