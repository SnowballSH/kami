import type { PressedListener } from "../ui/walkIntent";
import { RemoteStick } from "./remoteStick";
import { selectedControllerId } from "./selection";

export { RemoteStick } from "./remoteStick";
export type * from "./types";

/**
 * The stick `?controller=` asks for (docs/controllers.md), with its CAT button bound to `onCat`;
 * null when it is `off` or the browser has no `EventSource`.
 */
export function createRemoteStick(
  onPressedChange: PressedListener,
  onCat?: () => void,
): RemoteStick | null {
  if (typeof EventSource === "undefined") return null;
  const controllerId = selectedControllerId(window.location.search);
  if (controllerId === null) return null;
  return new RemoteStick(onPressedChange, {
    controllerId,
    openEventSource: (url) => new EventSource(url),
    ...(onCat === undefined ? {} : { onCat }),
  });
}
