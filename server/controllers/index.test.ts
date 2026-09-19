// @vitest-environment node
import { describe, expect, it } from "vitest";
import { startControllers } from "./index";

const ANY_FREE_PORT = 0;

describe("startControllers", () => {
  it("still takes HTTP reports with every transport switched off", async () => {
    const controllers = await startControllers({ udpPort: null, serialDevice: null });
    expect(controllers.description).toBe("HTTP POST");
    controllers.hub.report("arcade", { x: 100, y: 0, buttons: [] }, "http");
    expect(controllers.hub.list()).toHaveLength(1);
    await controllers.close();
    expect(controllers.hub.list()).toEqual([]);
  });

  it("says what it listens on", async () => {
    const controllers = await startControllers(
      { udpPort: ANY_FREE_PORT, serialDevice: "/dev/kami-no-such-stick" },
      { log: () => {} },
    );
    expect(controllers.description).toMatch(
      /^UDP :\d+, serial \/dev\/kami-no-such-stick, HTTP POST$/,
    );
    await controllers.close();
  });

  it("carries on without UDP when the port is taken", async () => {
    const logged: string[] = [];
    const squatter = await startControllers({ udpPort: ANY_FREE_PORT, serialDevice: null });
    const taken = Number(/\d+/.exec(squatter.description)?.[0]);
    const controllers = await startControllers(
      { udpPort: taken, serialDevice: null },
      { log: (line) => logged.push(line) },
    );
    expect(controllers.description).toBe("HTTP POST");
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain(`UDP :${taken} is unavailable`);
    await controllers.close();
    await squatter.close();
  });
});
