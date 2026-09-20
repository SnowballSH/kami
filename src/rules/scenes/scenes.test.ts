import { describe, expect, it } from "vitest";
import { ATLAS, placeCalled } from "./atlas";
import { AtlasSceneCompiler } from "./sceneCompiler";
import { destinationOf } from "./travel";

describe("destinationOf", () => {
  it.each([
    ["teleport us to the moon", "moon"],
    ["Kami, please take us to Mars!", "mars"],
    ["let's go underwater", "underwater"],
    ["go to space", "space"],
    ["bring us to the north pole please", "north pole"],
    ["welcome to Candy Land", "candy land"],
    ["next stop: the beach", "beach"],
    ["can you send alice back home now", "home"],
    ["we're going to a haunted house", "haunted house"],
  ])("%s → %s", (text, where) => {
    expect(destinationOf(text)).toBe(where);
  });

  it.each(["it is night", "summon a rabbit", "the moon", "go", "gravity off", "take us"])(
    "%s asks to go nowhere",
    (text) => {
      expect(destinationOf(text)).toBeNull();
    },
  );
});

describe("the atlas", () => {
  it("answers every alias with a scene that has at least one law, each setting once", () => {
    for (const { aliases, scene } of ATLAS) {
      for (const alias of aliases) expect(placeCalled(alias)).toBe(scene);
      expect(scene.laws.length).toBeGreaterThan(0);
      const settings = scene.laws.map((law) => law.effect.governs);
      expect(new Set(settings).size).toBe(settings.length);
      expect(scene.line.length).toBeGreaterThan(0);
    }
  });

  it("finds a place by its last words and says nothing for the unknown", () => {
    expect(placeCalled("dark side of the moon")).toBe(placeCalled("moon"));
    expect(placeCalled("narnia")).toBeNull();
  });
});

describe("AtlasSceneCompiler", () => {
  const farther = { asked: [] as string[] };
  const compiler = new AtlasSceneCompiler({
    compile: (text) => {
      farther.asked.push(text);
      return Promise.resolve(null);
    },
  });

  it("answers from the atlas first and only asks farther for places it lacks", async () => {
    expect(await compiler.compile("teleport us to the moon")).toBe(placeCalled("moon"));
    expect(farther.asked).toEqual([]);
    expect(await compiler.compile("take us to narnia")).toBeNull();
    expect(farther.asked).toEqual(["take us to narnia"]);
    expect(await compiler.compile("it is night")).toBeNull();
    expect(farther.asked).toEqual(["take us to narnia"]);
  });
});
