import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chooseMode, modeChosen, START_CHOICES } from "./startScreen";

const root = (): HTMLElement => {
  const element = document.createElement("main");
  document.body.append(element);
  return element;
};

beforeEach(() => window.history.replaceState(null, "", "/"));
afterEach(() => document.body.replaceChildren());

describe("start screen", () => {
  it("offers exactly Sandbox, Puzzle and Boss", () => {
    expect(START_CHOICES.map((choice) => choice.name)).toEqual(["Sandbox", "Puzzle", "Boss"]);
    expect(START_CHOICES.map((choice) => choice.id)).toEqual(["sandbox", "puzzle", "boss"]);
  });

  it("credits the dataset Kami learnt from, with its licence", () => {
    const host = root();
    chooseMode(host, () => {});
    const links = [...host.querySelectorAll<HTMLAnchorElement>(".start-credit a")];
    expect(host.querySelector(".start-credit")?.textContent).toContain("Quick, Draw!");
    expect(links.map((link) => link.href)).toEqual([
      "https://github.com/googlecreativelab/quickdraw-dataset",
      "https://creativecommons.org/licenses/by/4.0/",
    ]);
  });

  it("starts straight away when the address already names a mode", () => {
    window.history.replaceState(null, "", "/?mode=puzzle");
    const host = root();
    let started = 0;
    chooseMode(host, () => started++);
    expect(started).toBe(1);
    expect(host.querySelector(".start-screen")).toBeNull();
  });

  it("puts the tapped mode in the address and starts", () => {
    window.history.replaceState(null, "", "/?board=ours");
    const host = root();
    let started = 0;
    chooseMode(host, () => started++);
    expect(started).toBe(0);
    const buttons = [...host.querySelectorAll<HTMLButtonElement>(".start-choices button")];
    expect(buttons.map((button) => button.dataset.mode)).toEqual(["sandbox", "puzzle", "boss"]);
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Start Sandbox",
      "Start Puzzle",
      "Start Boss",
    ]);
    expect(buttons[0]?.autofocus).toBe(true);
    expect(buttons[0]?.getAttribute("type")).toBe("button");
    expect(buttons[0]?.getAttribute("aria-label")).toBe("Start Sandbox");
    expect(host.querySelector<HTMLImageElement>(".start-wordmark")).toMatchObject({
      width: 960,
      height: 446,
    });
    buttons[2]?.click();
    expect(started).toBe(1);
    expect(window.location.search).toBe("?board=ours&mode=boss");
    expect(modeChosen(window.location.search)).toBe(true);
    expect(host.querySelector(".start-screen")).toBeNull();
  });
});
