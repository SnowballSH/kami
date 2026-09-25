/**
 * A corpus index on disk (docs: server/README.md, "Quick, Draw!"), little-endian throughout:
 *
 *   "KAMIQDX1" | u32 header bytes | header JSON | pad to 8 | u16 row categories | pad to 4 | f32 features
 *
 * The header names the key it was built for, so a reader asks for a key and gets null for anything
 * else. The two arrays are read straight into shared memory, the one copy every thread ranks against.
 */
import { mkdir, open, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type { CorpusIndex } from "./corpusIndex";
import { simplifiedStrokeSchema } from "./dataset";
import { FEATURE_LENGTH } from "./feature";
import { allocateFeatureMatrix } from "./featureMatrix";

const MAGIC = new TextEncoder().encode("KAMIQDX1");
const LENGTH_BYTES = Uint32Array.BYTES_PER_ELEMENT;
const HEADER_OFFSET = MAGIC.length + LENGTH_BYTES;

const headerSchema = z.object({
  key: z.string(),
  featureLength: z.literal(FEATURE_LENGTH),
  rows: z.number().int().nonnegative(),
  completeRows: z.number().int().nonnegative(),
  categories: z.array(z.string()),
  summons: z.array(
    z.object({
      category: z.string(),
      keyId: z.string(),
      drawing: z.array(simplifiedStrokeSchema),
    }),
  ),
});

const alignedTo = (offset: number, alignment: number): number =>
  Math.ceil(offset / alignment) * alignment;

interface Layout {
  readonly rowCategoriesAt: number;
  readonly featuresAt: number;
}

const layoutOf = (headerBytes: number, rows: number): Layout => {
  const rowCategoriesAt = alignedTo(HEADER_OFFSET + headerBytes, 8);
  return {
    rowCategoriesAt,
    featuresAt: alignedTo(rowCategoriesAt + rows * Uint16Array.BYTES_PER_ELEMENT, 4),
  };
};

const bytesOf = (view: ArrayBufferView): Uint8Array =>
  new Uint8Array(view.buffer, view.byteOffset, view.byteLength);

const lengthPrefix = (value: number): Uint8Array => {
  const bytes = new Uint8Array(LENGTH_BYTES);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
};

export const writeIndexFile = async (
  path: string,
  key: string,
  { matrix, summons }: CorpusIndex,
): Promise<void> => {
  const rows = matrix.rowCategories.length;
  const header = {
    key,
    featureLength: FEATURE_LENGTH,
    rows,
    completeRows: matrix.completeRows,
    categories: matrix.categories,
    summons: [...summons.values()].flat(),
  };
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const { rowCategoriesAt, featuresAt } = layoutOf(headerBytes.length, rows);
  const chunks: readonly (readonly [number, Uint8Array])[] = [
    [0, MAGIC],
    [MAGIC.length, lengthPrefix(headerBytes.length)],
    [HEADER_OFFSET, headerBytes],
    [rowCategoriesAt, bytesOf(matrix.rowCategories)],
    [featuresAt, bytesOf(matrix.features)],
  ];
  await mkdir(dirname(path), { recursive: true });
  const partial = `${path}.${process.pid}.partial`;
  const file = await open(partial, "w");
  try {
    for (const [position, bytes] of chunks) await file.write(bytes, 0, bytes.length, position);
  } finally {
    await file.close();
  }
  await rename(partial, path);
};

const readExactly = async (
  file: Awaited<ReturnType<typeof open>>,
  into: Uint8Array,
  position: number,
): Promise<boolean> => {
  let filled = 0;
  while (filled < into.length) {
    const { bytesRead } = await file.read(into, filled, into.length - filled, position + filled);
    if (bytesRead === 0) return false;
    filled += bytesRead;
  }
  return true;
};

const hasMagic = (bytes: Uint8Array): boolean =>
  MAGIC.every((byte, index) => bytes[index] === byte);

/** The index at `path` if it was built for `key`; null when it is missing, stale or damaged. */
export const readIndexFile = async (path: string, key: string): Promise<CorpusIndex | null> => {
  const file = await open(path, "r").catch(() => null);
  if (file === null) return null;
  try {
    const prefix = new Uint8Array(HEADER_OFFSET);
    if (!(await readExactly(file, prefix, 0)) || !hasMagic(prefix)) return null;
    const headerLength = new DataView(prefix.buffer).getUint32(MAGIC.length, true);
    const headerBytes = new Uint8Array(headerLength);
    if (!(await readExactly(file, headerBytes, HEADER_OFFSET))) return null;
    const parsed = headerSchema.safeParse(JSON.parse(new TextDecoder().decode(headerBytes)));
    if (!parsed.success || parsed.data.key !== key) return null;
    const { rows, completeRows, categories, summons } = parsed.data;
    const matrix = allocateFeatureMatrix(categories, rows, completeRows);
    const { rowCategoriesAt, featuresAt } = layoutOf(headerLength, rows);
    const complete =
      (await readExactly(file, bytesOf(matrix.rowCategories), rowCategoriesAt)) &&
      (await readExactly(file, bytesOf(matrix.features), featuresAt));
    return complete ? { matrix, summons: Map.groupBy(summons, ({ category }) => category) } : null;
  } catch {
    return null;
  } finally {
    await file.close();
  }
};
