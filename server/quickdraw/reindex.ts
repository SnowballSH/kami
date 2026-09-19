import { readConfig } from "../config";
import { connectDatabase } from "../db/connect";
import { reindexStoredSketches } from "./indexing";
import { PREFIX_FRACTIONS } from "./prefix";
import { QuickdrawSampleRepository } from "./sampleRepository";

const connection = await connectDatabase(readConfig().database);
try {
  const repository = new QuickdrawSampleRepository(connection.db);
  const sketches = await reindexStoredSketches(repository);
  const rows = (await repository.loadFeatures()).length;
  const shares = PREFIX_FRACTIONS.map((fraction) => `${Math.round(fraction * 100)}%`).join(", ");
  console.log(
    `Re-indexed ${sketches} stored sketches at ${shares} of their points: ${rows} rows (${connection.description})`,
  );
} finally {
  await connection.close();
}
