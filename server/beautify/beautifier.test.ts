// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createBeautifier, type FetchLike } from "./beautifier";

const STROKES = [
  [
    { x: 0, y: 0 },
    { x: 10, y: 10 },
  ],
];

describe("createBeautifier", () => {
  it("posts the request to the endpoint with its bearer token and passes the answer through", async () => {
    const seen: { url: string; headers: Headers; body: unknown }[] = [];
    const model: FetchLike = async (url, init) => {
      seen.push({ url, headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
      return Response.json({ tidied: STROKES, added: [] });
    };
    const beautifier = createBeautifier(
      { url: "https://eye.test/complete", apiKey: "tidy" },
      model,
    );
    const answer = await beautifier.beautify({ strokes: STROKES, name: "a cat", strength: 0.5 });
    expect(await answer?.json()).toEqual({ tidied: STROKES, added: [] });
    expect(answer?.headers.get("content-type")).toContain("application/json");
    expect(seen[0]).toMatchObject({
      url: "https://eye.test/complete",
      body: { strokes: STROKES, name: "a cat", strength: 0.5 },
    });
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer tidy");
  });

  it("sends no token without one, and is null when nothing is attached or the model fails", async () => {
    const seen: Headers[] = [];
    const bare: FetchLike = async (_url, init) => {
      seen.push(new Headers(init?.headers));
      return new Response("boom", { status: 500 });
    };
    expect(
      await createBeautifier({ url: "http://tidy.test" }, bare).beautify({ strokes: STROKES }),
    ).toBeNull();
    expect(seen[0]?.has("authorization")).toBe(false);
    expect(await createBeautifier(null, bare).beautify({ strokes: STROKES })).toBeNull();
    expect(seen).toHaveLength(1);
  });
});
