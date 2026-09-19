import { describe, expect, it } from "vitest";
import type { FetchLike } from "./api";
import { RemoteRuleCompiler } from "./remoteRuleCompiler";

const MARS = { effect: { governs: "gravity", x: 0, y: 0.38 }, explanation: "gravity = 0.38 g" };

describe("RemoteRuleCompiler", () => {
  it("posts the text and returns the server's rule", async () => {
    const seen: { path: string; method: string | undefined; body: unknown }[] = [];
    const compiler = new RemoteRuleCompiler(async (path, init) => {
      seen.push({ path, method: init?.method, body: JSON.parse(String(init?.body)) });
      return Response.json({ rule: MARS });
    });
    expect(await compiler.compile("like the red planet")).toEqual(MARS);
    expect(seen).toEqual([
      { path: "/api/compile", method: "POST", body: { text: "like the red planet" } },
    ]);
  });

  it.each([
    { governs: "clones", value: 2 },
    { governs: "temperature", value: 95 },
    { governs: "daylight", value: 0 },
    { governs: "flight", value: 1 },
    { governs: "walkSpeed", value: 2 },
    { governs: "aliceSize", value: 0.5 },
    { governs: "attraction", value: -1 },
  ])("accepts a law on Alice or the weather from the model: $governs", async (effect) => {
    const rule = { effect, explanation: "as the model put it" };
    const compiler = new RemoteRuleCompiler(async () => Response.json({ rule }));
    expect(await compiler.compile("whatever the grammar did not know")).toEqual(rule);
  });

  it("returns null when the server has no model or does not see a rule", async () => {
    const compiler = new RemoteRuleCompiler(async () => Response.json({ rule: null }));
    expect(await compiler.compile("a mushroom")).toBeNull();
  });

  it.each<[string, FetchLike]>([
    [
      "the server is away",
      async () => {
        throw new TypeError("Failed to fetch");
      },
    ],
    ["the server errors", async () => new Response("boom", { status: 500 })],
    ["the body is not JSON", async () => new Response("<html>")],
    [
      "the effect is unknown",
      async () => Response.json({ rule: { ...MARS, effect: { governs: "magnetism", value: 1 } } }),
    ],
    [
      "a number is missing",
      async () => Response.json({ rule: { ...MARS, effect: { governs: "gravity", x: 0 } } }),
    ],
    ["the gloss is missing", async () => Response.json({ rule: { effect: MARS.effect } })],
  ])("returns null when %s", async (_what, fetchFn) => {
    expect(await new RemoteRuleCompiler(fetchFn).compile("g = moon")).toBeNull();
  });
});
