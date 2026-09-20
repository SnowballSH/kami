import { describe, expect, it } from "vitest";
import type { FetchLike } from "./api";
import { HttpSketchCatalogue } from "./httpSketchCatalogue";

describe("HttpSketchCatalogue", () => {
  it("lists what the server has pictures of", async () => {
    const paths: string[] = [];
    const catalogue = new HttpSketchCatalogue(async (path) => {
      paths.push(path);
      return Response.json({ categories: ["rabbit", "hot air balloon"] });
    });
    expect(await catalogue.categories()).toEqual(["rabbit", "hot air balloon"]);
    expect(paths).toEqual(["/api/exemplars"]);
  });

  it.each<[string, FetchLike]>([
    ["a server that is down", async () => new Response("down", { status: 503 })],
    ["a shape it does not know", async () => Response.json({ categories: [1, 2] })],
    ["a network that is down", async () => Promise.reject(new TypeError("Failed to fetch"))],
    ["not JSON", async () => new Response("<html>", { status: 200 })],
  ])("lists nothing for %s", async (_name, fetchFn) => {
    expect(await new HttpSketchCatalogue(fetchFn).categories()).toEqual([]);
  });
});
