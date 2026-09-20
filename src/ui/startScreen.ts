import wordmarkUrl from "../brand/assets/kami-wordmark.gif";
import { MODE_PARAM } from "../game/launch";
import { BOSS_MODE_ID, type GameModeId, PUZZLE_MODE_ID, SANDBOX_MODE_ID } from "../modes";
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

const linkTo = (href: string, text: string): HTMLAnchorElement => {
  const link = document.createElement("a");
  link.href = href;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = text;
  return link;
};

/** The drawings Kami learnt from, summons and tidies with are other people's: CC BY 4.0 asks that we say so. */
const datasetCredit = (): HTMLElement => {
  const credit = document.createElement("p");
  credit.className = "start-credit";
  credit.append(
    "Kami learnt to see from ",
    linkTo(DATASET_URL, "The Quick, Draw! Dataset"),
    ", made available by Google under ",
    linkTo(DATASET_LICENCE_URL, "CC BY 4.0"),
    ".",
  );
  return credit;
};

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
  const screen = document.createElement("div");
  screen.className = "start-screen";
  const heading = document.createElement("h1");
  const wordmark = document.createElement("img");
  wordmark.className = "start-wordmark";
  wordmark.src = wordmarkUrl;
  wordmark.alt = "kami";
  heading.append(wordmark);
  const choices = document.createElement("div");
  choices.className = "start-choices";
  for (const choice of START_CHOICES) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset["mode"] = choice.id;
    const name = document.createElement("strong");
    name.textContent = choice.name;
    const line = document.createElement("span");
    line.textContent = choice.line;
    button.append(name, line);
    button.addEventListener("click", () => {
      const url = new URL(host.location.href);
      url.searchParams.set(MODE_PARAM, choice.id);
      host.history.replaceState(null, "", url);
      screen.remove();
      start(root);
    });
    choices.append(button);
  }
  screen.append(heading, choices, datasetCredit());
  root.append(screen);
};
