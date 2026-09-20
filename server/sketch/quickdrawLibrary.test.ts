// @vitest-environment node
import { describe, expect, it } from "vitest";
import { QuickdrawLibrary } from "./quickdrawLibrary";

const line = (keyId: string, drawing: number[][][]) =>
  `${JSON.stringify({ key_id: keyId, word: "rabbit", recognized: true, drawing })}\n`;

describe("QuickdrawLibrary", () => {
  it("fetches a category once from Quick, Draw! and hands out its drawings as strokes", async () => {
    const fetched: string[] = [];
    const library = new QuickdrawLibrary(
      async (url) => {
        fetched.push(url);
        return new Response(
          line("1", [
            [
              [0, 10],
              [0, 20],
            ],
          ]) +
            line("2", [
              [
                [5, 6],
                [7, 8],
              ],
            ]),
        );
      },
      () => 0,
    );
    expect(library.categories).toContain("rabbit");
    expect(await library.pick("rabbit")).toEqual({
      category: "rabbit",
      strokes: [
        [
          { x: 0, y: 0 },
          { x: 10, y: 20 },
        ],
      ],
    });
    await library.pick("rabbit");
    expect(fetched).toEqual([
      "https://storage.googleapis.com/quickdraw_dataset/full/simplified/rabbit.ndjson",
    ]);
  });

  it("has nothing for an unknown category or when the dataset is unreachable", async () => {
    const library = new QuickdrawLibrary(async () => new Response("gone", { status: 503 }));
    expect(await library.pick("unicorn")).toBeNull();
    expect(await library.pick("rabbit")).toBeNull();
  });
});
