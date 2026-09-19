// @vitest-environment node
import { describe, expect, it } from "vitest";
import { datasetUrl, fetchCategoryDrawings, parseSimplifiedNdjson, toStrokes } from "./dataset";

const line = (keyId: string, recognized: boolean): string =>
  JSON.stringify({
    word: "key",
    countrycode: "US",
    recognized,
    key_id: keyId,
    drawing: [
      [
        [0, 255],
        [10, 20],
      ],
    ],
  });

const NDJSON = [line("1", true), line("2", false), line("3", true), line("4", true)].join("\n");

describe("parseSimplifiedNdjson", () => {
  it("keeps recognised drawings and drops the line the byte range cut short", () => {
    const cutShort = `${NDJSON}\n${line("5", true).slice(0, 40)}`;
    expect(parseSimplifiedNdjson(cutShort, 10).map(({ keyId }) => keyId)).toEqual(["1", "3", "4"]);
  });

  it("takes only the first N", () => {
    expect(parseSimplifiedNdjson(`${NDJSON}\n`, 2).map(({ keyId }) => keyId)).toEqual(["1", "3"]);
  });

  it("turns [[xs],[ys]] strokes into points", () => {
    const [first] = parseSimplifiedNdjson(`${NDJSON}\n`, 1);
    expect(toStrokes(first?.drawing ?? [])).toEqual([
      [
        { x: 0, y: 10 },
        { x: 255, y: 20 },
      ],
    ]);
  });
});

describe("fetchCategoryDrawings", () => {
  it("asks for only the head of the file", async () => {
    const requests: { url: string; range: string | null }[] = [];
    const fakeFetch = async (url: string, init?: RequestInit): Promise<Response> => {
      requests.push({ url, range: new Headers(init?.headers).get("range") });
      return new Response(`${NDJSON}\n`, { status: 206 });
    };
    const drawings = await fetchCategoryDrawings("hot air balloon", 2, fakeFetch, 1000);
    expect(drawings).toHaveLength(2);
    expect(requests).toEqual([{ url: datasetUrl("hot air balloon"), range: "bytes=0-999" }]);
    expect(datasetUrl("hot air balloon")).toContain("hot%20air%20balloon.ndjson");
  });

  it("rejects when the dataset refuses", async () => {
    const refuse = async (): Promise<Response> => new Response("no", { status: 404 });
    await expect(fetchCategoryDrawings("key", 2, refuse)).rejects.toThrow("404");
  });
});
