/**
 * A corpus index on disk (server/README.md, "Quick, Draw!"), in the machine's own byte order,
 * which is little-endian everywhere Kami runs:
 *
 *   "KAMIQDX2" | u32 header bytes | header JSON | then each matrix array, each starting at a multiple of 8
 *
 * The header names the key it was built for, so a reader asks for a key and gets null for anything
 * else. The arrays are read straight into shared memory, the one copy every thread ranks against.
 */
import { mkdir, open, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type { CorpusIndex } from "./corpusIndex";
import { simplifiedStrokeSchema } from "./dataset";
import { FEATURE_LENGTH } from "./feature";
import { allocateFeatureMatrix, type FeatureMatrix, rowCountOf } from "./featureMatrix";

const MAGIC = new TextEncoder().encode("KAMIQDX2");
const LENGTH_BYTES = Uint32Array.BYTES_PER_ELEMENT;
const HEADER_OFFSET = MAGIC.length + LENGTH_BYTES;
const SECTION_ALIGNMENT = 8;

const headerSchema = z.object({
  key: z.string(),
  featureLength: z.literal(FEATURE_LENGTH),
  rows: z.number().int().nonnegative(),
  nonZero: z.number().int().nonnegative(),
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

type OpenFile = Awaited<ReturnType<typeof open>>;

const bytesOf = (view: ArrayBufferView): Uint8Array =>
  new Uint8Array(view.buffer, view.byteOffset, view.byteLength);

const sectionsOf = ({ rowCategories, rowStarts, cells, values }: FeatureMatrix) =>
  [rowCategories, rowStarts, cells, values].map(bytesOf);

/** Where each section starts: one after the other, each on an aligned offset past the header. */
const offsetsOf = (headerBytes: number, sections: readonly Uint8Array[]): readonly number[] => {
  const offsets: number[] = [];
  let next = HEADER_OFFSET + headerBytes;
  for (const section of sections) {
    const at = Math.ceil(next / SECTION_ALIGNMENT) * SECTION_ALIGNMENT;
    offsets.push(at);
    next = at + section.length;
  }
  return offsets;
};

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
  const header = {
    key,
    featureLength: FEATURE_LENGTH,
    rows: rowCountOf(matrix),
    nonZero: matrix.values.length,
    completeRows: matrix.completeRows,
    categories: matrix.categories,
    summons: [...summons.values()].flat(),
  };
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const sections = sectionsOf(matrix);
  const offsets = offsetsOf(headerBytes.length, sections);
  const chunks: readonly (readonly [number, Uint8Array])[] = [
    [0, MAGIC],
    [MAGIC.length, lengthPrefix(headerBytes.length)],
    [HEADER_OFFSET, headerBytes],
    ...sections.map((section, index) => [offsets[index] ?? 0, section] as const),
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
  file: OpenFile,
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

const readAll = async (
  file: OpenFile,
  sections: readonly Uint8Array[],
  offsets: readonly number[],
): Promise<boolean> => {
  for (const [index, section] of sections.entries()) {
    if (!(await readExactly(file, section, offsets[index] ?? 0))) return false;
  }
  return true;
};

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
    const { summons, ...shape } = parsed.data;
    const matrix = allocateFeatureMatrix(shape);
    const sections = sectionsOf(matrix);
    if (!(await readAll(file, sections, offsetsOf(headerLength, sections)))) return null;
    return { matrix, summons: Map.groupBy(summons, ({ category }) => category) };
  } catch {
    return null;
  } finally {
    await file.close();
  }
};
