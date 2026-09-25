// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { FetchLike } from "../llm/chatClient";
import { createLlmSceneCompiler, PROP_REACH, PROP_SIZE, parseSceneReply } from "./llmSceneCompiler";

const CONFIG = { url: "http://llm.example:8000", model: "kami-scenes", apiKey: "secret" } as const;

const DRAWABLE = new Set(["star", "moon", "cactus"]);
const drawable = (word: string): boolean => DRAWABLE.has(word);

const modelSaying =
  (content: string, seen: string[] = []): FetchLike =>
  async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
    seen.push(body.messages.at(-1)?.content ?? "");
    return Response.json({ choices: [{ message: { role: "assistant", content } }] });
  };

const MARS = JSON.stringify({
  place: "Mars",
  laws: [
    { effect: { governs: "gravity", x: 0, y: 0.38 }, explanation: "gravity = 0.38 g" },
    { effect: { governs: "temperature", value: -60 }, explanation: "bitter cold" },
  ],
  props: [
    { word: "cactus", at: { x: -200, y: -120 }, size: 1 },
    { word: "star", at: { x: 900, y: -900 }, size: 9 },
    { word: "dragon", at: { x: 0, y: -100 }, size: 1 },
  ],
  line: "Red dust everywhere.",
});

describe("parseSceneReply", () => {
  it("keeps the typed laws, clamps props into reach and drops words Kami cannot draw", () => {
    const scene = parseSceneReply(MARS, drawable);
    expect(scene?.place).toBe("Mars");
    expect(scene?.line).toBe("Red dust everywhere.");
    expect(scene?.laws.map((law) => law.effect.governs)).toEqual(["gravity", "temperature"]);
    expect(scene?.props).toEqual([
      { word: "cactus", at: { x: -200, y: -120 }, size: 1 },
      { word: "star", at: { x: PROP_REACH.x, y: PROP_REACH.yHigh }, size: PROP_SIZE.max },
    ]);
  });

  it("keeps only the first law over each setting, and at most five", () => {
    const laws = ["gravity", "wind", "gravity", "daylight", "friction", "airDrag", "timeScale"].map(
      (governs, i) => ({
        effect:
          governs === "gravity" || governs === "wind"
            ? { governs, x: 0, y: 0.1 * (i + 1) }
            : { governs, value: 0.5 },
        explanation: `${governs} ${i}`,
      }),
    );
    const scene = parseSceneReply(JSON.stringify({ place: "Somewhere", laws }), drawable);
    expect(scene?.laws.map((law) => law.explanation)).toEqual([
      "gravity 0",
      "wind 1",
      "daylight 3",
      "friction 4",
      "airDrag 5",
    ]);
    expect(scene?.line).toBe("Somewhere. Here we are.");
  });

  it("is null for no place, an empty scene, or prose without JSON", () => {
    expect(parseSceneReply('{"place":null}', drawable)).toBeNull();
    expect(parseSceneReply('{"place":"Nowhere","laws":[],"props":[]}', drawable)).toBeNull();
    expect(parseSceneReply('{"place":"Nowhere","props":[{"word":"dragon"}]}', drawable)).toBeNull();
    expect(parseSceneReply("I would rather not.", drawable)).toBeNull();
    expect(
      parseSceneReply('{"place":"X","laws":[{"effect":{"governs":"magic"}}]}', drawable),
    ).toBeNull();
  });
});

describe("createLlmSceneCompiler", () => {
  it("sends the sentence to the model and returns its scene", async () => {
    const seen: string[] = [];
    const scene = await createLlmSceneCompiler(CONFIG, drawable, modelSaying(MARS, seen)).compile(
      "take us to mars",
    );
    expect(seen).toEqual(["take us to mars"]);
    expect(scene?.place).toBe("Mars");
  });

  it("knows no places without a model", async () => {
    expect(await createLlmSceneCompiler(null, drawable).compile("take us to mars")).toBeNull();
  });
});
