import { describe, expect, it } from "vitest";
import { selectedControllerId } from "./selection";

describe("selectedControllerId", () => {
  it("is the arcade stick unless the address names another", () => {
    expect(selectedControllerId("")).toBe("arcade");
    expect(selectedControllerId("?board=wonderland")).toBe("arcade");
    expect(selectedControllerId("?board=wonderland&controller=stick-2")).toBe("stick-2");
  });

  it("is none for off", () => {
    expect(selectedControllerId("?controller=off")).toBeNull();
  });

  it.each(["", "Arcade", "two words", "a/b", "x".repeat(33)])(
    "is none for the bad name %j",
    (name) => {
      expect(selectedControllerId(`?controller=${encodeURIComponent(name)}`)).toBeNull();
    },
  );
});
