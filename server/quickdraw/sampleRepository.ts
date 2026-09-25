import { Binary, type Collection, type Db } from "../db/mongo";
import type { SimplifiedStroke } from "./dataset";
import { COMPLETE_FRACTION } from "./prefix";
import type { PrefixFeature } from "./prefixFeatures";
import type { LabelledFeature } from "./recognizer";

export interface StoredSketch {
  readonly category: string;
  readonly keyId: string;
  readonly drawing: readonly SimplifiedStroke[];
}

export interface QuickdrawSample extends StoredSketch {
  readonly features: readonly PrefixFeature[];
}

interface PrefixFeatureDocument {
  readonly fraction: number;
  readonly feature: Binary;
}

/** `feature` alone is how a sketch was stored before prefixes were indexed: the whole drawing. */
interface SampleDocument extends StoredSketch {
  readonly features?: readonly PrefixFeatureDocument[];
  readonly feature?: Binary;
}

const encodeFeature = (feature: Float32Array): Binary =>
  new Binary(new Uint8Array(feature.buffer, feature.byteOffset, feature.byteLength));

const decodeFeature = ({ buffer: bytes }: Binary): Float32Array =>
  new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

const storedFeaturesOf = ({
  features,
  feature,
}: Pick<SampleDocument, "features" | "feature">): readonly PrefixFeatureDocument[] => {
  if (features !== undefined) return features;
  return feature === undefined ? [] : [{ fraction: COMPLETE_FRACTION, feature }];
};

export class QuickdrawSampleRepository {
  readonly #samples: Collection<SampleDocument>;

  constructor(db: Db) {
    this.#samples = db.collection<SampleDocument>("quickdraw");
  }

  async ensureIndexes(): Promise<void> {
    await this.#samples.createIndex({ category: 1, keyId: 1 }, { unique: true });
  }

  async isEmpty(): Promise<boolean> {
    return (await this.#samples.estimatedDocumentCount()) === 0;
  }

  async upsertCategory(category: string, samples: readonly QuickdrawSample[]): Promise<void> {
    if (samples.length === 0) return;
    await this.#samples.bulkWrite(
      samples.map(({ keyId, drawing, features }) => ({
        replaceOne: {
          filter: { category, keyId },
          replacement: {
            category,
            keyId,
            drawing,
            features: features.map(({ fraction, feature }) => ({
              fraction,
              feature: encodeFeature(feature),
            })),
          },
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

  /** One row per indexed prefix of every sketch, the whole drawing included. */
  async loadFeatures(): Promise<readonly LabelledFeature[]> {
    const documents = await this.#samples
      .find({}, { projection: { _id: 0, category: 1, features: 1, feature: 1 } })
      .toArray();
    return documents.flatMap(({ category, ...stored }) =>
      storedFeaturesOf(stored).map(({ fraction, feature }) => ({
        category,
        fraction,
        feature: decodeFeature(feature),
      })),
    );
  }

  /** Every stored drawing without its features: what a snapshot or a re-index needs to recompute them. */
  async loadDrawings(): Promise<readonly StoredSketch[]> {
    return this.#samples
      .find({}, { projection: { _id: 0, category: 1, keyId: 1, drawing: 1 } })
      .sort({ category: 1, keyId: 1 })
      .toArray();
  }

  /** One stored drawing of the category, a different one each time; null for a category never ingested. */
  async anyOf(category: string): Promise<StoredSketch | null> {
    const [picked] = await this.#samples
      .aggregate<StoredSketch>([
        { $match: { category } },
        { $sample: { size: 1 } },
        { $project: { _id: 0, category: 1, keyId: 1, drawing: 1 } },
      ])
      .toArray();
    return picked ?? null;
  }

  async keyIdsOf(category: string): Promise<ReadonlySet<string>> {
    const documents = await this.#samples
      .find({ category }, { projection: { _id: 0, keyId: 1 } })
      .toArray();
    return new Set(documents.map(({ keyId }) => keyId));
  }
}
