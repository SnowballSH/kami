import { readConfig } from "../config";
import { connectDatabase } from "../db/connect";
import { QUICKDRAW_CATEGORIES } from "./categories";
import { fetchCategoryDrawings, toStrokes } from "./dataset";
import {
  HIGH_CONFIDENCE,
  type LabelledSketch,
  type Outcome,
  runTrial,
  sweepLeaderFloor,
  TRIALS,
  type Trial,
  tally,
} from "./evaluation";
import { DEFAULT_RECOGNIZER_OPTIONS, QuickdrawRecognizer } from "./recognizer";
import { QuickdrawSampleRepository } from "./sampleRepository";

const HOLDOUT_PER_CATEGORY = 50;
const LEADER_FLOORS = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] as const;

const percent = (hits: number, total: number): string =>
  total === 0 ? "n/a" : `${((hits / total) * 100).toFixed(1)}%`;

const fetchUnseen = async (
  repository: QuickdrawSampleRepository,
  category: string,
): Promise<readonly LabelledSketch[]> => {
  const ingested = await repository.keyIdsOf(category);
  const fetched = await fetchCategoryDrawings(category, ingested.size + HOLDOUT_PER_CATEGORY);
  return fetched
    .filter(({ keyId }) => !ingested.has(keyId))
    .slice(0, HOLDOUT_PER_CATEGORY)
    .map(({ drawing }) => ({ category, strokes: toStrokes(drawing) }));
};

const isTrial =
  (trial: Trial) =>
  (outcome: Outcome): boolean =>
    outcome.fraction === trial.fraction && outcome.partial === trial.partial;

const trialName = ({ fraction, partial }: Trial): string =>
  `${Math.round(fraction * 100)}% ${partial ? "live" : "finished"}`;

const printCategory = (category: string, outcomes: readonly Outcome[]): void => {
  const finished = tally(outcomes.filter(({ partial }) => !partial));
  console.log(
    `${category.padEnd(16)} top-1 ${percent(finished.top1, finished.tested).padStart(6)}  top-3 ${percent(finished.top3, finished.tested).padStart(6)}`,
  );
};

const printTrials = (outcomes: readonly Outcome[]): void => {
  console.log(
    `\n${"ink".padEnd(14)} top-1   top-3   speaks  right when speaking   conf>=${HIGH_CONFIDENCE}: share / right   ms/query`,
  );
  for (const trial of TRIALS) {
    const score = tally(outcomes.filter(isTrial(trial)));
    console.log(
      [
        trialName(trial).padEnd(14),
        percent(score.top1, score.tested).padEnd(7),
        percent(score.top3, score.tested).padEnd(7),
        percent(score.spoke, score.tested).padEnd(7),
        percent(score.spokeRight, score.spoke).padEnd(21),
        `${percent(score.confident, score.tested)} / ${percent(score.confidentRight, score.confident)}`.padEnd(
          28,
        ),
        score.meanMilliseconds.toFixed(1),
      ].join(" "),
    );
  }
};

const printFloorSweep = (outcomes: readonly Outcome[]): void => {
  const live = outcomes.filter(({ partial }) => partial);
  console.log(
    `\nLeader floor for live guesses (now ${DEFAULT_RECOGNIZER_OPTIONS.partialLeaderFloor}), over ${live.length} live trials:`,
  );
  for (const { floor, spoke, spokeRight } of sweepLeaderFloor(live, LEADER_FLOORS)) {
    console.log(
      `  >= ${floor.toFixed(1)}  speaks ${percent(spoke, live.length).padStart(6)}  right ${percent(spokeRight, spoke).padStart(6)}`,
    );
  }
};

const connection = await connectDatabase(readConfig().database);
try {
  const repository = new QuickdrawSampleRepository(connection.db);
  const recognizer = new QuickdrawRecognizer(await repository.loadFeatures());
  console.log(
    `Index: ${recognizer.size} sketches in ${recognizer.rows} rows, from ${connection.description}`,
  );

  const outcomes: Outcome[] = [];
  for (const category of QUICKDRAW_CATEGORIES) {
    const unseen = await fetchUnseen(repository, category);
    const ofCategory = unseen.flatMap((sketch) =>
      TRIALS.map((trial) => runTrial(recognizer, sketch, trial)),
    );
    outcomes.push(...ofCategory);
    printCategory(category, ofCategory);
  }

  console.log(
    `\n${outcomes.length / TRIALS.length} unseen sketches, each shown ${TRIALS.length} ways`,
  );
  printTrials(outcomes);
  printFloorSweep(outcomes);
} finally {
  await connection.close();
}
