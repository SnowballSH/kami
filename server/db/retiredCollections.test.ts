// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startMemoryDatabase } from "../testing/memoryDatabase";
import type { DatabaseConnection } from "./connect";
import { dropRetiredCollections } from "./retiredCollections";

describe("dropRetiredCollections", () => {
  let connection: DatabaseConnection;

  beforeAll(async () => {
    connection = await startMemoryDatabase();
  }, 120_000);

  afterAll(async () => {
    await connection.close();
  });

  it("drops the old sketch collection once and leaves the boards alone", async () => {
    await connection.db.collection("quickdraw").insertOne({ category: "cat" });
    await connection.db.collection("boards").insertOne({ name: "kept" });

    expect(await dropRetiredCollections(connection.db)).toEqual(["quickdraw"]);
    expect(await dropRetiredCollections(connection.db)).toEqual([]);
    const names = (await connection.db.listCollections().toArray()).map(({ name }) => name);
    expect(names).toEqual(["boards"]);
  });
});
