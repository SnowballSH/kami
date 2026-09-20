import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { animatedGif, WORDMARK_GIF } from "./gif";
import { lockupSvg, markSvg, wordmarkFrames, wordmarkSvg } from "./logo";

const ASSETS_DIR = process.argv[2] ?? "src/brand/assets";
const FAVICON = process.argv[3] ?? "public/kami-mark.svg";
const GIF_NAME = "kami-wordmark.gif";

const FILES: Readonly<Record<string, () => string>> = {
  "kami-wordmark.svg": wordmarkSvg,
  "kami-mark.svg": markSvg,
  "kami-lockup.svg": lockupSvg,
};

const emit = async (path: string, contents: string | Uint8Array): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
  console.log(`wrote ${path}`);
};

for (const [name, render] of Object.entries(FILES)) await emit(join(ASSETS_DIR, name), render());
await emit(FAVICON, markSvg());
await emit(join(ASSETS_DIR, GIF_NAME), animatedGif(wordmarkFrames(), WORDMARK_GIF));
