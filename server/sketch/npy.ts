/**
 * Reads the plain `.npy` files an exemplar set is made of (ml/CONTRACT.md): version 1 or 2 headers,
 * C order, little-endian, only the integer kinds the set uses. Anything else is refused.
 */

const MAGIC = "\u0093NUMPY";
const MAGIC_LENGTH = 6;
const VERSION_LENGTH = 2;

export type NpyArray = Uint8Array | Int32Array | Uint32Array;

type Descriptor = "|u1" | "<i4" | "<u4";

const DESCRIPTORS: Readonly<
  Record<Descriptor, (buffer: ArrayBuffer, offset: number, count: number) => NpyArray>
> = {
  "|u1": (buffer, offset, count) => new Uint8Array(buffer, offset, count),
  "<i4": (buffer, offset, count) => new Int32Array(buffer, offset, count),
  "<u4": (buffer, offset, count) => new Uint32Array(buffer, offset, count),
};

const isDescriptor = (value: string): value is Descriptor => value in DESCRIPTORS;

interface Header {
  readonly descriptor: Descriptor;
  readonly shape: readonly number[];
}

const parseHeader = (text: string): Header => {
  const descriptor = /'descr':\s*'([^']+)'/.exec(text)?.[1];
  const fortran = /'fortran_order':\s*(True|False)/.exec(text)?.[1];
  const shape = /'shape':\s*\(([^)]*)\)/.exec(text)?.[1];
  if (descriptor === undefined || fortran === undefined || shape === undefined)
    throw new Error(`npy: malformed header ${JSON.stringify(text.trim())}`);
  if (!isDescriptor(descriptor)) throw new Error(`npy: unsupported dtype ${descriptor}`);
  if (fortran !== "False") throw new Error("npy: Fortran order is not supported");
  return {
    descriptor,
    shape: shape
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map(Number),
  };
};

export interface Npy {
  readonly shape: readonly number[];
  readonly data: NpyArray;
}

export const parseNpy = (bytes: Uint8Array): Npy => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(...bytes.subarray(0, MAGIC_LENGTH));
  if (magic !== MAGIC) throw new Error("npy: not a .npy file");
  const major = view.getUint8(MAGIC_LENGTH);
  const headerLength =
    major === 1
      ? view.getUint16(MAGIC_LENGTH + VERSION_LENGTH, true)
      : view.getUint32(MAGIC_LENGTH + VERSION_LENGTH, true);
  const headerStart = MAGIC_LENGTH + VERSION_LENGTH + (major === 1 ? 2 : 4);
  const dataStart = headerStart + headerLength;
  const header = parseHeader(
    new TextDecoder("latin1").decode(bytes.subarray(headerStart, dataStart)),
  );
  const count = header.shape.reduce((product, size) => product * size, 1);
  const aligned = bytes.slice(dataStart);
  return { shape: header.shape, data: DESCRIPTORS[header.descriptor](aligned.buffer, 0, count) };
};
