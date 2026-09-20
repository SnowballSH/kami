import { Resvg } from "@resvg/resvg-js";
import { applyPalette, GIFEncoder, quantize } from "gifenc";

export const GIF_COLOURS = 64;

/** How the committed animated wordmark is rendered: one breath of the Sumikui at 12.5 fps. */
export const WORDMARK_GIF = { width: 960, frameMs: 80, background: "#ffffff" } as const;

export interface GifOptions {
  readonly width: number;
  readonly frameMs: number;
  readonly background: string;
}

const rasterise = (svg: string, { width, background }: GifOptions) =>
  new Resvg(svg, { fitTo: { mode: "width", value: width }, background }).render();

export const animatedGif = (frames: readonly string[], options: GifOptions): Uint8Array => {
  const gif = GIFEncoder();
  let palette: ReturnType<typeof quantize> | undefined;
  for (const frame of frames) {
    const image = rasterise(frame, options);
    const rgba = new Uint8Array(image.pixels);
    palette ??= quantize(rgba, GIF_COLOURS);
    gif.writeFrame(applyPalette(rgba, palette), image.width, image.height, {
      palette,
      delay: options.frameMs,
      repeat: 0,
    });
  }
  gif.finish();
  return gif.bytes();
};
