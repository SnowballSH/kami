import type { SvgFont, SvgGlyph } from "./svgFont";

const SOURCE_PACKAGE = "hersheytext";
const OFL_TEXT_URL = "https://openfontlicense.org/open-font-license-official-text/";

export interface FontProvenance {
  readonly sourcePath: string;
  readonly outputName: string;
  readonly additions: readonly SvgGlyph[];
}

const additionsNote = (font: SvgFont, additions: readonly SvgGlyph[]): string[] => {
  if (additions.length === 0) return [];
  const characters = additions.map((glyph) => `"${glyph.unicode}"`).join(", ");
  return [
    `Added for Kami and not part of ${font.family}: ${characters} (\`scripts/strokeFont/kamiGlyphs.ts\`).`,
    "",
  ];
};

export const licenceNotice = (
  font: SvgFont,
  { sourcePath, outputName, additions }: FontProvenance,
): string =>
  [
    `# ${font.family}`,
    "",
    `\`${outputName}\` is a converted subset of \`${sourcePath}\` from the \`${SOURCE_PACKAGE}\` package,`,
    "built by `scripts/buildStrokeFont.ts`. The attribution below is copied from that file's metadata.",
    "",
    ...[...font.metadata].map(([key, value]) => `- **${key}:** ${value}`),
    "",
    ...additionsNote(font, additions),
    "The font, and this derivative of it, is licensed under the SIL Open Font License, Version 1.1:",
    `<${OFL_TEXT_URL}>`,
    "",
  ].join("\n");
