import type { SvgGlyph } from "./svgFont";

/** Glyphs drawn for Kami's wordmark, in the font's own units and y-up convention. Not part of EMS Readability. */
export const KAMI_GLYPHS: readonly SvgGlyph[] = [
  {
    unicode: "紙",
    advance: 1000,
    pathData: [
      "M 262 700 L 196 610 L 128 548 L 212 556 L 300 584",
      "M 322 640 L 214 492 L 100 392 L 236 404 L 372 440",
      "M 318 500 L 352 462 L 388 408",
      "M 238 396 L 244 200 L 240 10 L 196 58",
      "M 146 284 L 116 190 L 70 104",
      "M 326 288 L 368 204 L 410 132",
      "M 836 694 L 700 650 L 540 612",
      "M 540 612 L 534 340 L 530 64 L 600 110 L 668 172",
      "M 534 392 L 720 402 L 912 426",
      "M 700 650 L 724 440 L 776 250 L 850 100 L 928 38 L 944 170",
    ].join(" "),
  },
];
