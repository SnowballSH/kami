import { describe, expect, it } from "vitest";
import { ALICE_HERSELF } from "../sim/types";
import { createDirector, EmbodiedDirector } from "./embodiedDirector";
import { EMBODIED_MODE, GAME_MODES, modeFor } from "./modes";
import { allowsLaw, opensWithAlice, refusalLine } from "./policy";
import { NOTHING_HUNGRY_LINE, SANDBOX_MODE, SANDBOX_MODE_ID } from "./sandboxMode";

describe("the sandbox mode", () => {
  it("is found by id and listed among the modes", () => {
    expect(modeFor("sandbox")).toBe(SANDBOX_MODE);
    expect(SANDBOX_MODE.id).toBe(SANDBOX_MODE_ID);
    expect(GAME_MODES).toContain(SANDBOX_MODE);
  });

  it("is an endless shared page with a body on it, no goal, and Kami only helping when asked", () => {
    expect(SANDBOX_MODE.page).toBe("endless");
    expect(SANDBOX_MODE.sharing).toBe("live");
    expect(SANDBOX_MODE.help).toBe("on-request");
    expect(SANDBOX_MODE.win).toEqual({ kind: "endless" });
    expect(SANDBOX_MODE.loss).toEqual({ kind: "respawn" });
    expect(SANDBOX_MODE.autopilot).toBe("allowed");
    expect(opensWithAlice(SANDBOX_MODE)).toBe(true);
  });

  it("forbids the ink eater and nothing else, refusing it in lore", () => {
    expect(allowsLaw(SANDBOX_MODE.laws, "inkEater")).toBe(false);
    expect(allowsLaw(SANDBOX_MODE.laws, "gravity")).toBe(true);
    expect(allowsLaw(SANDBOX_MODE.laws, "clones")).toBe(true);
    expect(refusalLine(SANDBOX_MODE, "inkEater", "stock")).toBe(NOTHING_HUNGRY_LINE);
    expect(refusalLine(SANDBOX_MODE, "gravity", "stock")).toBe("stock");
    expect(refusalLine(EMBODIED_MODE, "inkEater", "stock")).toBe("stock");
  });

  it("plays under the embodied director, which never declares it won", () => {
    const director = createDirector(SANDBOX_MODE);
    expect(director).toBeInstanceOf(EmbodiedDirector);
    expect(director?.won({ type: "goal-reached", who: ALICE_HERSELF })).toBe(false);
  });

  it("today's modes are rooms played alone with help offered", () => {
    for (const mode of GAME_MODES.filter((candidate) => candidate !== SANDBOX_MODE)) {
      expect(mode.page).toBe("room");
      expect(mode.sharing).toBe("alone");
      expect(mode.help).toBe("offered");
    }
  });
});
