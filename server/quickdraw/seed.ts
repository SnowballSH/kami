import type { QuickdrawSampleRepository } from "./sampleRepository";
import { importSnapshot } from "./snapshotFile";

export type SeedOutcome =
  | { readonly kind: "none" }
  | { readonly kind: "kept" }
  | { readonly kind: "imported"; readonly sketches: number }
  | { readonly kind: "failed"; readonly reason: string };

/**
 * A fresh container knows no sketches, and nobody is there to run the ingest; so an empty
 * collection is filled from the snapshot named at start-up (`snapshotFile.ts`). One that already
 * holds sketches is left exactly as it is, whatever the file says.
 */
export const seedQuickdraw = async (
  repository: QuickdrawSampleRepository,
  snapshotPath: string | null,
): Promise<SeedOutcome> => {
  if (snapshotPath === null) return { kind: "none" };
  if (!(await repository.isEmpty())) return { kind: "kept" };
  try {
    return { kind: "imported", sketches: await importSnapshot(repository, snapshotPath) };
  } catch (error) {
    return { kind: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
};

export const describeSeed = (outcome: SeedOutcome, snapshotPath: string | null): string => {
  switch (outcome.kind) {
    case "none":
      return "quickdraw seed: none (set KAMI_QUICKDRAW_SNAPSHOT to fill an empty database)";
    case "kept":
      return `quickdraw seed: database already holds sketches, ${snapshotPath} not read`;
    case "imported":
      return `quickdraw seed: imported ${outcome.sketches} sketches from ${snapshotPath}`;
    case "failed":
      return `quickdraw seed: could not import ${snapshotPath}: ${outcome.reason}`;
  }
};
