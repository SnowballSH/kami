import { describe, expect, it } from "vitest";
import { LineCycles } from "./lineCycles";

describe("LineCycles", () => {
  it("goes round each list on its own count", () => {
    const cycles = new LineCycles();
    const greetings = ["hello", "hi"];
    const farewells = ["bye"];
    expect([cycles.next(greetings), cycles.next(farewells), cycles.next(greetings)]).toEqual([
      "hello",
      "bye",
      "hi",
    ]);
    expect(cycles.next(greetings)).toBe("hello");
  });

  it("says nothing for an empty list", () => {
    expect(new LineCycles().next([])).toBe("");
  });
});
