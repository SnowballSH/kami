/**
 * How badly does sketch ranking stall the event loop, on this machine, with and without a worker?
 *
 *   bun scripts/bench/recognizerLatency.ts [rows=50000] [threads=1] [requestEveryMs=40]
 *
 * Builds a synthetic feature matrix the size of the real one, keeps a 5 ms timer running as a proxy
 * for every other request the server would be answering, and fires live-guess requests at the rate
 * a few iPads would. It prints the ranking cost and how late the timer ran under each setup.
 */

import { FEATURE_LENGTH } from "../../server/quickdraw/feature";
import { buildFeatureMatrix, type LabelledFeature } from "../../server/quickdraw/featureMatrix";
import { createKnnRanker } from "../../server/recognition/ranking/ranker";
import { circleSketch, lineSketch } from "../../server/testing/sketches";

const ROWS = Number(process.argv[2] ?? 50_000);
const THREADS = Number(process.argv[3] ?? 1);
const CATEGORIES = 345;
const TICK_MS = 5;
const REQUEST_EVERY_MS = Number(process.argv[4] ?? 40);
const RUN_MS = 3_000;

const unitVector = (seed: number): Float32Array => {
  const feature = new Float32Array(FEATURE_LENGTH);
  let state = seed * 2654435761;
  let norm = 0;
  for (let cell = 0; cell < FEATURE_LENGTH; cell += 1) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    const value = state / 0x7fffffff > 0.85 ? state / 0x7fffffff : 0;
    feature[cell] = value;
    norm += value * value;
  }
  const scale = norm > 0 ? 1 / Math.sqrt(norm) : 0;
  for (let cell = 0; cell < FEATURE_LENGTH; cell += 1) feature[cell] = (feature[cell] ?? 0) * scale;
  return feature;
};

const syntheticSamples = (rows: number): readonly LabelledFeature[] =>
  Array.from({ length: rows }, (_, row) => ({
    category: `category-${row % CATEGORIES}`,
    feature: unitVector(row + 1),
    fraction: row % 3 === 0 ? 0.5 : 1,
  }));

const percentile = (sorted: readonly number[], share: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0;

const measure = async (threads: number): Promise<void> => {
  const matrix = buildFeatureMatrix(syntheticSamples(ROWS));
  const knn = createKnnRanker(matrix, { threads, log: console.log });
  const sketches = [
    circleSketch({ x: 0, y: 0 }, 100, 0.02),
    lineSketch({ x: 0, y: 0 }, { x: 300, y: 20 }),
  ];

  const first = performance.now();
  await knn.ranker.read(sketches[0] ?? [], { partial: true });
  const warmMs = performance.now() - first;

  const lags: number[] = [];
  let lastTick = performance.now();
  const ticker = setInterval(() => {
    const now = performance.now();
    lags.push(now - lastTick - TICK_MS);
    lastTick = now;
  }, TICK_MS);

  const queryMs: number[] = [];
  let answered = 0;
  let silenced = 0;
  const started = performance.now();
  const requests: Promise<void>[] = [];
  const firing = setInterval(() => {
    const sketch = sketches[answered % sketches.length] ?? [];
    const begun = performance.now();
    requests.push(
      Promise.resolve(knn.ranker.read(sketch, { partial: true }))
        .then((reading) => {
          queryMs.push(performance.now() - begun);
          if (reading.ranking.length === 0) silenced += 1;
        })
        .catch(() => {}),
    );
    answered += 1;
  }, REQUEST_EVERY_MS);
  await new Promise((resolve) => setTimeout(resolve, RUN_MS));
  clearInterval(firing);
  await Promise.all(requests);
  clearInterval(ticker);
  const description = knn.describe();
  knn.close();

  const elapsed = performance.now() - started;
  const sortedLags = lags.toSorted((a, b) => a - b);
  const sortedQueries = queryMs.toSorted((a, b) => a - b);
  console.log(`\n${description}`);
  console.log(`  rows ${matrix.rowCategories.length}, first query ${warmMs.toFixed(1)} ms`);
  console.log(
    `  ${answered} live guesses in ${(elapsed / 1000).toFixed(1)} s: median ${percentile(sortedQueries, 0.5).toFixed(1)} ms, p99 ${percentile(sortedQueries, 0.99).toFixed(1)} ms round trip, ${silenced} answered with silence`,
  );
  console.log(
    `  event-loop lag on a ${TICK_MS} ms timer: median ${percentile(sortedLags, 0.5).toFixed(1)} ms, p99 ${percentile(sortedLags, 0.99).toFixed(1)} ms, max ${(sortedLags.at(-1) ?? 0).toFixed(1)} ms`,
  );
};

await measure(0);
await measure(THREADS);
