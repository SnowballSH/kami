import { Binary, type Collection, type Db } from "../db/mongo";
import type { SimplifiedStroke } from "./dataset";
import type { LabelledFeature } from "./recognizer";

export interface QuickdrawSample extends LabelledFeature {
  readonly keyId: string;
  readonly drawing: readonly SimplifiedStroke[];
}

export interface StoredSketch {
  readonly category: string;
  readonly keyId: string;
  readonly drawing: readonly SimplifiedStroke[];
}

interface SampleDocument {
  readonly category: string;
  readonly keyId: string;
  readonly drawing: readonly SimplifiedStroke[];
  readonly feature: Binary;
}

const encodeFeature = (feature: Float32Array): Binary =>
  new Binary(new Uint8Array(feature.buffer, feature.byteOffset, feature.byteLength));

const decodeFeature = (binary: Binary): Float32Array =>
  new Float32Array(Uint8Array.from(binary.buffer).buffer);

export class QuickdrawSampleRepository {
  readonly #samples: Collection<SampleDocument>;

  constructor(db: Db) {
    this.#samples = db.collection<SampleDocument>("quickdraw");
  }

  async ensureIndexes(): Promise<void> {
    await this.#samples.createIndex({ category: 1, keyId: 1 }, { unique: true });
  }

  async upsertCategory(category: string, samples: readonly QuickdrawSample[]): Promise<void> {
    if (samples.length === 0) return;
    await this.#samples.bulkWrite(
      samples.map(({ keyId, drawing, feature }) => ({
        replaceOne: {
          filter: { category, keyId },
          replacement: { category, keyId, drawing, feature: encodeFeature(feature) },
          upsert: true,
        },
      })),
      { ordered: false },
    );
    await this.#samples.deleteMany({
      category,
      keyId: { $nin: samples.map(({ keyId }) => keyId) },
    });
  }

  async retainCategories(categories: readonly string[]): Promise<void> {
    await this.#samples.deleteMany({ category: { $nin: [...categories] } });
  }

  async loadFeatures(): Promise<readonly LabelledFeature[]> {
    const documents = await this.#samples
      .find({}, { projection: { _id: 0, category: 1, feature: 1 } })
      .toArray();
    return documents.map(({ category, feature }) => ({
      category,
      feature: decodeFeature(feature),
    }));
  }

  /** Every stored drawing without its feature: what a snapshot needs, since features can be recomputed. */
  async loadDrawings(): Promise<readonly StoredSketch[]> {
    return this.#samples
      .find({}, { projection: { _id: 0, category: 1, keyId: 1, drawing: 1 } })
      .sort({ category: 1, keyId: 1 })
      .toArray();
  }

  async keyIdsOf(category: string): Promise<ReadonlySet<string>> {
    const documents = await this.#samples
      .find({ category }, { projection: { _id: 0, keyId: 1 } })
      .toArray();
    return new Set(documents.map(({ keyId }) => keyId));
  }
}
