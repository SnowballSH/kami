import wordmarkUrl from "../brand/assets/kami-wordmark.gif";
import { MODE_PARAM } from "../game/launch";
import { BOSS_MODE_ID, type GameModeId, PUZZLE_MODE_ID, SANDBOX_MODE_ID } from "../modes";
import { el } from "./dom";
import { activateOnTap } from "./tap";
import "./styles/start.css";

interface Choice {
  readonly id: GameModeId;
  readonly name: string;
  readonly line: string;
}

/** The only three ways to play; one tap and the page is open. */
export const START_CHOICES: readonly Choice[] = [
  {
    id: SANDBOX_MODE_ID,
    name: "Sandbox",
    line: "An endless page. Draw anything; ask Kami for help.",
  },
  {
    id: PUZZLE_MODE_ID,
    name: "Puzzle",
    line: "Rooms to think your way through. The ink eater is loose.",
  },
  { id: BOSS_MODE_ID, name: "Boss", line: "Two players: one draws, one moves. Start as a heart." },
];

const DATASET_URL = "https://github.com/googlecreativelab/quickdraw-dataset";
const DATASET_LICENCE_URL = "https://creativecommons.org/licenses/by/4.0/";

const linkTo = (href: string, text: string): HTMLAnchorElement =>
  el("a", { text, attrs: { href, target: "_blank", rel: "noreferrer" } });

/** The drawings Kami learnt from, summons and tidies with are other people's: CC BY 4.0 asks that we say so. */
const datasetCredit = (): HTMLElement =>
  el("p", { className: "start-credit" }, [
    "Kami learnt to see from ",
    linkTo(DATASET_URL, "The Quick, Draw! Dataset"),
    ", made available by Google under ",
    linkTo(DATASET_LICENCE_URL, "CC BY 4.0"),
    ".",
  ]);

/** Whether the address already says how to play. */
export const modeChosen = (search: string): boolean => new URLSearchParams(search).has(MODE_PARAM);

/** Offers Sandbox / Puzzle / Boss when the address names no mode, then starts. */
export const chooseMode = (
  root: HTMLElement,
  start: (root: HTMLElement) => void,
  host: Window = window,
): void => {
  if (modeChosen(host.location.search)) {
    start(root);
    return;
  }
  const choose = (id: GameModeId): void => {
    const url = new URL(host.location.href);
    url.searchParams.set(MODE_PARAM, id);
    host.history.replaceState(null, "", url);
    screen.remove();
    start(root);
  };
  const buttons = START_CHOICES.map(({ id, name, line }) => {
    const button = el(
      "button",
      { attrs: { type: "button", "data-mode": id, "aria-label": `Start ${name}` } },
      [el("strong", { text: name }), el("span", { text: line })],
    );
    activateOnTap(button, () => choose(id));
    return button;
  });
  const [first] = buttons;
  if (first !== undefined) first.autofocus = true;
  const screen = el("div", { className: "start-screen" }, [
    el("h1", {}, [
      el("img", {
        className: "start-wordmark",
        attrs: { width: "960", height: "446", src: wordmarkUrl, alt: "kami" },
      }),
    ]),
    el("div", { className: "start-choices" }, buttons),
    datasetCredit(),
  ]);
  root.append(screen);
};
