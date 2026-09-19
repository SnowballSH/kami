import { readConfig } from "../config";
import { connectDatabase } from "../db/connect";
import { QUICKDRAW_CATEGORIES } from "./categories";
import { DEFAULT_SAMPLES_PER_CATEGORY, ingestQuickdraw } from "./ingestion";
import { QuickdrawSampleRepository } from "./sampleRepository";

const samplesPerCategoryFromArgs = (args: readonly string[]): number => {
  const requested = Number(args[0]);
  return Number.isInteger(requested) && requested > 0 ? requested : DEFAULT_SAMPLES_PER_CATEGORY;
};

const config = readConfig();
const connection = await connectDatabase(config.database);
try {
  console.log(`Ingesting Quick, Draw! into ${connection.description}`);
  const reports = await ingestQuickdraw(
    new QuickdrawSampleRepository(connection.db),
    QUICKDRAW_CATEGORIES,
    samplesPerCategoryFromArgs(process.argv.slice(2)),
  );
  const total = reports.reduce((sum, { samples }) => sum + samples, 0);
  console.log(`Done: ${total} drawings across ${reports.length} categories.`);
} finally {
  await connection.close();
}
