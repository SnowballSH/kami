import { describe, expect, it } from "vitest";
import type { FetchLike } from "./api";
import { HttpSketchLibrary } from "./httpSketchLibrary";

const SQUARE = [
  [
    { x: 0, y: 0 },
    { x: 255, y: 0 },
    { x: 255, y: 255 },
  ],
];

describe("HttpSketchLibrary", () => {
  it("lists the catalogue once and fetches a sketch by category", async () => {
    const paths: string[] = [];
    const library = new HttpSketchLibrary(async (path) => {
      paths.push(path);
      return path === "/api/sketches"
        ? Response.json({ categories: ["rabbit", "hot air balloon"] })
        : Response.json({ category: "hot air balloon", strokes: SQUARE });
    });
    expect(await library.categories()).toEqual(["rabbit", "hot air balloon"]);
    expect(await library.categories()).toEqual(["rabbit", "hot air balloon"]);
    expect(await library.sketch("hot air balloon")).toEqual(SQUARE);
    expect(paths).toEqual(["/api/sketches", "/api/sketches/hot%20air%20balloon"]);
  });

  it("asks for the catalogue again when the server had nothing to say", async () => {
    let calls = 0;
    const library = new HttpSketchLibrary(async () => {
      calls++;
      return calls === 1
        ? new Response("down", { status: 503 })
        : Response.json({ categories: ["a"] });
    });
    expect(await library.categories()).toEqual([]);
    expect(await library.categories()).toEqual(["a"]);
    expect(calls).toBe(2);
  });

  it.each<[string, FetchLike]>([
    ["an unknown category", async () => new Response("no", { status: 404 })],
    ["an empty sketch", async () => Response.json({ category: "x", strokes: [] })],
    ["a shape it does not know", async () => Response.json({ strokes: [[[0, 0]]] })],
    ["a network that is down", async () => Promise.reject(new TypeError("Failed to fetch"))],
    ["not JSON", async () => new Response("<html>", { status: 200 })],
  ])("has no sketch for %s", async (_name, fetchFn) => {
    expect(await new HttpSketchLibrary(fetchFn).sketch("rabbit")).toBeNull();
  });
});
