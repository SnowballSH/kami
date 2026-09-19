import { readFile, writeFile } from "node:fs/promises";
import { serializeStrokeFont, toStrokeFontData } from "./strokeFont/convert";
import { KAMI_GLYPHS } from "./strokeFont/kamiGlyphs";
import { licenceNotice } from "./strokeFont/licenceNotice";
import { parseSvgFont } from "./strokeFont/svgFont";

const SOURCE_PATH = "node_modules/hersheytext/svg_fonts/EMSFelix.svg";
const OUTPUT_DIRECTORY = "src/handwriting/fonts";
const FONT_FILE = "emsFelix.json";
const LICENCE_FILE = "LICENSE-EMSFelix.md";

const projectFile = (path: string): URL => new URL(`../${path}`, import.meta.url);

const svgFont = parseSvgFont(await readFile(projectFile(SOURCE_PATH), "utf8"));
const fontJson = serializeStrokeFont(toStrokeFontData(svgFont, KAMI_GLYPHS));
const notice = licenceNotice(svgFont, {
  sourcePath: SOURCE_PATH,
  outputName: FONT_FILE,
  additions: KAMI_GLYPHS,
});

await writeFile(projectFile(`${OUTPUT_DIRECTORY}/${FONT_FILE}`), fontJson);
await writeFile(projectFile(`${OUTPUT_DIRECTORY}/${LICENCE_FILE}`), notice);

console.log(`${svgFont.family}: wrote ${FONT_FILE} (${fontJson.length} bytes) and ${LICENCE_FILE}`);
