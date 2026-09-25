import { readConfig } from "../config";
import { indexPathsFor, loadQuickdrawCorpus } from "./corpus";
import { DEFAULT_SAMPLES_PER_CATEGORY, ingestQuickdraw } from "./ingestion";

const samplesPerCategoryFromArgs = (args: readonly string[]): number => {
  const requested = Number(args[0]);
  return Number.isInteger(requested) && requested > 0 ? requested : DEFAULT_SAMPLES_PER_CATEGORY;
};

const config = readConfig();
const snapshot = config.quickdrawSnapshot;
console.log(`Ingesting Quick, Draw! into ${snapshot}`);
const reports = await ingestQuickdraw(snapshot, {
  samplesPerCategory: samplesPerCategoryFromArgs(process.argv.slice(2)),
  log: console.log,
});
const total = reports.reduce((sum, { samples }) => sum + samples, 0);
console.log(`Done: ${total} drawings across ${reports.length} categories.`);
const { description } = await loadQuickdrawCorpus(
  snapshot,
  indexPathsFor(snapshot, config.database.embeddedDataDirectory),
);
console.log(description);
