import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { lockupSvg, markSvg, wordmarkSvg } from "./logo";

const ASSETS_DIR = process.argv[2] ?? "src/brand/assets";
const FAVICON = process.argv[3] ?? "public/kami-mark.svg";

const FILES: Readonly<Record<string, () => string>> = {
  "kami-wordmark.svg": wordmarkSvg,
  "kami-mark.svg": markSvg,
  "kami-lockup.svg": lockupSvg,
};

const emit = async (path: string, svg: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, svg);
  console.log(`wrote ${path}`);
};

for (const [name, render] of Object.entries(FILES)) await emit(join(ASSETS_DIR, name), render());
await emit(FAVICON, markSvg());
