import { describe, expect, it } from "vitest";
import { RemoteSceneCompiler } from "./remoteSceneCompiler";

const ATLANTIS = {
  place: "Atlantis",
  line: "Mind the fish.",
  laws: [{ effect: { governs: "airDrag", value: 4 }, explanation: "air drag = 4" }],
  props: [{ word: "fish", at: { x: -100, y: -200 }, size: 0.5 }],
};

const answering = (body: unknown) => new RemoteSceneCompiler(async () => Response.json(body));

describe("RemoteSceneCompiler", () => {
  it("posts the words and returns the server's scene", async () => {
    const seen: unknown[] = [];
    const compiler = new RemoteSceneCompiler(async (path, init) => {
      seen.push({ path, body: JSON.parse(String(init?.body)) });
      return Response.json({ scene: ATLANTIS });
    });
    expect(await compiler.compile("take us to atlantis")).toEqual(ATLANTIS);
    expect(seen).toEqual([{ path: "/api/scene", body: { text: "take us to atlantis" } }]);
  });

  it.each<[string, unknown]>([
    ["no scene", { scene: null }],
    [
      "a law outside its domain",
      {
        scene: {
          ...ATLANTIS,
          laws: [{ ...ATLANTIS.laws[0], effect: { governs: "airDrag", value: 99 } }],
        },
      },
    ],
    ["a prop without a place", { scene: { ...ATLANTIS, props: [{ word: "fish", size: 1 }] } }],
    ["no line", { scene: { ...ATLANTIS, line: undefined } }],
  ])("returns null for %s", async (_what, body) => {
    expect(await answering(body).compile("take us to atlantis")).toBeNull();
  });

  it("returns null when the server is away", async () => {
    const compiler = new RemoteSceneCompiler(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await compiler.compile("take us to atlantis")).toBeNull();
  });
});
