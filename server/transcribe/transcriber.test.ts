// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Stroke } from "../../src/core/geometry";
import type { FetchLike } from "../recognition/types";
import { FirstReadyTranscriber } from "./chain";
import { createTranscriber } from "./transcriber";
import type { HandwritingTranscriber } from "./types";

const WORDS: readonly Stroke[] = [[{ x: 0, y: 0 }]];

const scripted = (passes: boolean, says: string, warmUps: string[]): HandwritingTranscriber => {
  let ready = false;
  return {
    get ready() {
      return ready;
    },
    warmUp: async () => {
      warmUps.push(says);
      ready = passes;
      return passes;
    },
    transcribe: async () => says,
  };
};

describe("FirstReadyTranscriber", () => {
  it("reads with the first reader whose check passes, and only asks the rest if it must", async () => {
    const warmUps: string[] = [];
    const chain = new FirstReadyTranscriber([
      { name: "local", transcriber: scripted(false, "local", warmUps) },
      { name: "vision", transcriber: scripted(true, "vision", warmUps) },
      { name: "spare", transcriber: scripted(true, "spare", warmUps) },
    ]);
    expect(chain.ready).toBe(false);
    expect(await chain.transcribe(WORDS)).toBeNull();
    expect(await chain.warmUp()).toBe(true);
    expect(chain.chosen).toBe("vision");
    expect(chain.ready).toBe(true);
    expect(await chain.transcribe(WORDS)).toBe("vision");
    expect(warmUps).toEqual(["local", "vision"]);
  });

  it("is not ready when no reader passes", async () => {
    const chain = new FirstReadyTranscriber([
      { name: "local", transcriber: scripted(false, "local", []) },
    ]);
    expect(await chain.warmUp()).toBe(false);
    expect(chain.chosen).toBeNull();
    expect(chain.ready).toBe(false);
  });
});

describe("createTranscriber", () => {
  const nothing: FetchLike = async () => Response.json({}, { status: 404 });

  it("puts the sidecar's local reader before the vision model", () => {
    const both = createTranscriber(
      { sidecar: { url: "http://127.0.0.1:8790" }, vision: { url: "http://llm", model: "eyes" } },
      nothing,
    );
    expect(both?.candidates).toEqual(["local reader (http://127.0.0.1:8790)", "vision model eyes"]);
    expect(
      createTranscriber({ sidecar: null, vision: { url: "http://llm", model: "eyes" } }, nothing)
        ?.candidates,
    ).toEqual(["vision model eyes"]);
  });

  it("is null without either reader", () => {
    expect(createTranscriber({ sidecar: null, vision: null }, nothing)).toBeNull();
  });
});
