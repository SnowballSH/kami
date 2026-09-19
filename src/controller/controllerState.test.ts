import { describe, expect, it } from "vitest";
import { parseControllerState, pressedDirections } from "./controllerState";

describe("parseControllerState", () => {
  it("reads the event of docs/controllers.md", () => {
    const data = '{"x":-0.7,"y":0.85,"held":["left","up"],"buttons":["a"]}';

    expect(parseControllerState(data)).toEqual({
      x: -0.7,
      y: 0.85,
      held: ["left", "up"],
      buttons: ["a"],
    });
  });

  it("drops directions and buttons it does not know, so the server can grow", () => {
    const data = '{"x":0,"y":0,"held":["right","sideways",7],"buttons":["start","b",null]}';

    expect(parseControllerState(data)).toEqual({ x: 0, y: 0, held: ["right"], buttons: ["b"] });
  });

  it.each([
    ["no text", { x: 0, y: 0, held: [], buttons: [] }],
    ["broken JSON", '{"x":0,'],
    ["a list", "[]"],
    ["null", "null"],
    ["a bare number", "4"],
    ["missing held", '{"x":0,"y":0,"buttons":[]}'],
    ["missing buttons", '{"x":0,"y":0,"held":[]}'],
    ["held that is no list", '{"x":0,"y":0,"held":"left","buttons":[]}'],
    ["an axis that is no number", '{"x":"1","y":0,"held":[],"buttons":[]}'],
    ["a missing axis", '{"x":1,"held":[],"buttons":[]}'],
  ])("answers null for %s", (_, data) => {
    expect(parseControllerState(data)).toBeNull();
  });
});

describe("pressedDirections", () => {
  it("passes the held directions through", () => {
    const pressed = pressedDirections({ x: -1, y: -1, held: ["left", "down"], buttons: [] });

    expect([...pressed].sort()).toEqual(["down", "left"]);
  });

  it("counts button A as up, and leaves B, X and Y unbound", () => {
    expect([...pressedDirections({ x: 1, y: 0, held: ["right"], buttons: ["a"] })].sort()).toEqual([
      "right",
      "up",
    ]);
    expect([...pressedDirections({ x: 0, y: 1, held: ["up"], buttons: ["a"] })]).toEqual(["up"]);
    expect(pressedDirections({ x: 0, y: 0, held: [], buttons: ["b", "x", "y"] }).size).toBe(0);
  });
});
