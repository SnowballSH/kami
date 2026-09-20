declare module "gifenc" {
  export type Palette = readonly (readonly number[])[];

  export interface FrameOptions {
    readonly palette?: Palette;
    readonly delay?: number;
    readonly repeat?: number;
    readonly transparent?: boolean;
    readonly transparentIndex?: number;
    readonly dispose?: number;
    readonly first?: boolean;
  }

  export interface Encoder {
    writeFrame(index: Uint8Array, width: number, height: number, options?: FrameOptions): void;
    finish(): void;
    bytes(): Uint8Array;
  }

  export function GIFEncoder(options?: {
    readonly auto?: boolean;
    readonly initialCapacity?: number;
  }): Encoder;
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number): Palette;
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette): Uint8Array;
}
