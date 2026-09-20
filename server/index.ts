import { createBeautifier } from "./beautify/beautifier";
import { createLlmCompiler } from "./compile/llmCompiler";
import { readConfig } from "./config";
import { startControllers } from "./controllers";
import { BoardRepository } from "./db/boardRepository";
import { connectDatabase } from "./db/connect";
import { createApi } from "./http/api";
import { createStaticSite } from "./http/staticSite";
import { QuickdrawRecognizer } from "./quickdraw/recognizer";
import { QuickdrawSampleRepository } from "./quickdraw/sampleRepository";
import { createRecognizerChain } from "./recognition/chain";
import { createLlmTranscriber } from "./transcribe/llmTranscriber";

const API_PREFIX = "/api";

const config = readConfig();
const connection = await connectDatabase(config.database);

const boards = new BoardRepository(connection.db);
await boards.ensureIndexes();

const knn = new QuickdrawRecognizer(
  await new QuickdrawSampleRepository(connection.db).loadFeatures(),
);
const eye = createRecognizerChain(config.recognizerUrl, knn, {
  log: (line) => console.log(`  ${line}`),
});

const controllers = await startControllers(config.controllers, {
  log: (line) => console.log(`  ${line}`),
});

const compiler = createLlmCompiler(config.llm);
const transcriber = createLlmTranscriber(config.transcribe);
const api = createApi({
  boards,
  recognizer: eye.recognizer,
  compiler,
  beautifier: createBeautifier(config.beautifyUrl),
  controllers: controllers.hub,
  transcriber,
});
const site = config.webDirectory === null ? null : createStaticSite(config.webDirectory);
const isApiCall = (request: Request): boolean =>
  new URL(request.url).pathname.startsWith(API_PREFIX);

const server = Bun.serve({
  port: config.port,
  hostname: "0.0.0.0",
  fetch: async (request) =>
    isApiCall(request) || site === null
      ? api.handle(request)
      : ((await site(request)) ?? api.handle(request)),
});

console.log(`Kami server on http://localhost:${server.port}`);
console.log(`  memory: ${connection.description}`);
console.log(`  game: ${config.webDirectory ?? "not built (Vite serves it in development)"}`);
console.log(
  knn.size > 0
    ? `  recognition: ${knn.size} Quick, Draw! sketches`
    : "  recognition: empty (run `bun run quickdraw:ingest`)",
);
void eye.describe().then((line) => console.log(`  ${line}`));
console.log(`  beautifier: ${config.beautifyUrl ?? "none attached"}`);
console.log(`  controllers: ${controllers.description}`);
console.log(`  model compile: ${config.llm === null ? "off" : config.llm.model}`);
console.log(
  `  handwriting: ${config.transcribe === null ? "off" : `${config.transcribe.model} (checking vision)`}`,
);
void compiler
  .warmUp()
  .then((awake) => {
    if (config.llm !== null)
      console.log(`  model ${awake ? "is awake" : "did not answer (is the GX10 tunnel up?)"}`);
  })
  .then(async () => {
    if (transcriber === null) return;
    const reads = await transcriber.warmUp();
    console.log(`  handwriting reader ${reads ? "is ready" : "disabled: image check failed"}`);
  });

const once = (task: () => Promise<void>): (() => Promise<void>) => {
  let started: Promise<void> | undefined;
  return () => {
    started ??= task();
    return started;
  };
};

const shutDown = once(async () => {
  await controllers.close();
  await server.stop(true);
  await connection.close();
  process.exit(0);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void shutDown());
}
