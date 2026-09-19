import { readConfig } from "../config";
import { connectDatabase } from "../db/connect";
import { QUICKDRAW_CATEGORIES } from "./categories";
import { fetchCategoryDrawings, toStrokes } from "./dataset";
import { QuickdrawRecognizer } from "./recognizer";
import { QuickdrawSampleRepository } from "./sampleRepository";

const HOLDOUT_PER_CATEGORY = 50;

interface CategoryScore {
  readonly category: string;
  readonly tested: number;
  readonly top1: number;
  readonly top3: number;
}

const percent = (hits: number, total: number): string =>
  total === 0 ? "n/a" : `${((hits / total) * 100).toFixed(1)}%`;

const connection = await connectDatabase(readConfig().database);
try {
  const repository = new QuickdrawSampleRepository(connection.db);
  const recognizer = new QuickdrawRecognizer(await repository.loadFeatures());
  console.log(`Index: ${recognizer.size} sketches from ${connection.description}`);

  const scores: CategoryScore[] = [];
  for (const category of QUICKDRAW_CATEGORIES) {
    const ingested = await repository.keyIdsOf(category);
    const fetched = await fetchCategoryDrawings(category, ingested.size + HOLDOUT_PER_CATEGORY);
    const unseen = fetched
      .filter(({ keyId }) => !ingested.has(keyId))
      .slice(0, HOLDOUT_PER_CATEGORY);
    const guesses = unseen.map(({ drawing }) => recognizer.recognize(toStrokes(drawing)));
    const score = {
      category,
      tested: unseen.length,
      top1: guesses.filter((guess) => guess[0] === category).length,
      top3: guesses.filter((guess) => guess.includes(category)).length,
    };
    scores.push(score);
    console.log(
      `${category.padEnd(16)} top-1 ${percent(score.top1, score.tested).padStart(6)}  top-3 ${percent(score.top3, score.tested).padStart(6)}`,
    );
  }

  const tested = scores.reduce((sum, score) => sum + score.tested, 0);
  const top1 = scores.reduce((sum, score) => sum + score.top1, 0);
  const top3 = scores.reduce((sum, score) => sum + score.top3, 0);
  console.log(
    `Overall on ${tested} unseen sketches: top-1 ${percent(top1, tested)}, top-3 ${percent(top3, tested)}`,
  );
} finally {
  await connection.close();
}
