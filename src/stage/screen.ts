import wordmarkUrl from "../brand/assets/kami-wordmark.svg";
import { createHandwriting } from "../handwriting";
import { createRenderer } from "../render";
import { createLawsPanel } from "../ui";
import { paintQr } from "../ui/qr";
import type { StagedFrame } from "./decoder";
import { fittedCamera } from "./fit";
import { dialBrowser } from "./line";
import "./screen.css";
import { StageWatcher } from "./watcher";
import { stageNameOf, stageSocketUrl } from "./wire";

export const SCREEN_PARAM = "screen";
/** `?join=<address>`: where the audience points a device to play; shown as words and a QR code. */
export const JOIN_PARAM = "join";

export const isScreen = (search: string): boolean => new URLSearchParams(search).has(SCREEN_PARAM);

const WAITING_LINE = "Draw on an iPad and it appears here.";
const UNPAINTABLE = "Kami's screen could not paint a frame";

const element = <Tag extends keyof HTMLElementTagNameMap>(
  tag: Tag,
  className: string,
  text = "",
): HTMLElementTagNameMap[Tag] => {
  const made = document.createElement(tag);
  made.className = className;
  made.textContent = text;
  return made;
};

const joinCard = (address: string): HTMLElement => {
  const card = element("div", "kami-screen-join");
  const code = document.createElement("canvas");
  void paintQr(code, address).catch(() => code.remove());
  card.append(code, element("span", "kami-screen-address", address.replace(/^https?:\/\//, "")));
  return card;
};

/** The big screen: no pen, no HUD, only what the device in play is showing, as large as it fits. */
export function startScreen(root: HTMLElement, host: Window = window): void {
  const params = new URLSearchParams(host.location.search);
  const join = params.get(JOIN_PARAM);
  root.classList.add("kami-screen");

  const canvas = document.createElement("canvas");
  const renderer = createRenderer(canvas, createHandwriting());
  const laws = createLawsPanel(root, { onRepealLaw: () => {} });

  const curtain = element("div", "kami-screen-curtain");
  const wordmark = element("img", "kami-screen-wordmark");
  wordmark.src = wordmarkUrl;
  wordmark.alt = "Kami";
  curtain.append(wordmark, element("p", "kami-screen-line", WAITING_LINE));
  if (join !== null) curtain.append(joinCard(join));
  root.prepend(canvas);
  root.append(curtain);

  let showing: StagedFrame | null = null;
  let painting = false;
  const paint = (): void => {
    painting = false;
    if (showing === null) return;
    const { frame, viewport } = showing;
    showing = { viewport, frame: { ...frame, events: [] } };
    try {
      renderer.render({
        ...frame,
        camera: fittedCamera(frame.camera, viewport, renderer.viewport()),
      });
    } catch (error) {
      console.warn(UNPAINTABLE, error);
      showing = null;
    }
  };
  const repaint = (): void => {
    if (painting) return;
    painting = true;
    host.requestAnimationFrame(paint);
  };

  new ResizeObserver(() => {
    renderer.resize();
    repaint();
  }).observe(canvas);
  renderer.resize();

  new StageWatcher(
    dialBrowser(stageSocketUrl(stageNameOf(params.get(SCREEN_PARAM)), "screen", host.location)),
    {
      boardChanged: (board) => {
        showing = null;
        renderer.setBoard(board);
      },
      lawsChanged: (listed) => laws.setLaws(listed),
      frameArrived: (staged) => {
        const waiting = showing?.frame.events ?? [];
        showing = {
          viewport: staged.viewport,
          frame: { ...staged.frame, events: [...waiting, ...(staged.frame.events ?? [])] },
        };
        curtain.hidden = true;
        repaint();
      },
      wentDark: () => {
        showing = null;
        laws.setLaws([]);
        curtain.hidden = false;
      },
    },
  );
}
