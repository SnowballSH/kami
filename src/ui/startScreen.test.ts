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
    expect(buttons.map((button) => button.dataset["mode"])).toEqual(["sandbox", "puzzle", "boss"]);
    buttons[2]?.click();
    expect(started).toBe(1);
    expect(window.location.search).toBe("?board=ours&mode=boss");
    expect(modeChosen(window.location.search)).toBe(true);
    expect(host.querySelector(".start-screen")).toBeNull();
  });
});
