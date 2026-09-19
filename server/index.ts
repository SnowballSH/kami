import { createLlmCompiler } from "./compile/llmCompiler";
import { readConfig } from "./config";
import { BoardRepository } from "./db/boardRepository";
import { connectDatabase } from "./db/connect";
import { createApi } from "./http/api";
import { createStaticSite } from "./http/staticSite";
import { QuickdrawRecognizer } from "./quickdraw/recognizer";
import { QuickdrawSampleRepository } from "./quickdraw/sampleRepository";

const API_PREFIX = "/api";

const config = readConfig();
const connection = await connectDatabase(config.database);

const boards = new BoardRepository(connection.db);
await boards.ensureIndexes();

const recognizer = new QuickdrawRecognizer(
  await new QuickdrawSampleRepository(connection.db).loadFeatures(),
);

const compiler = createLlmCompiler(config.llm);
const api = createApi({ boards, recognizer, compiler });
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
  recognizer.size > 0
    ? `  recognition: ${recognizer.size} Quick, Draw! sketches`
    : "  recognition: empty (run `bun run quickdraw:ingest`)",
);
console.log(`  model compile: ${config.llm === null ? "off" : config.llm.model}`);
if (config.llm !== null) {
  void compiler
    .warmUp()
    .then((awake) =>
      console.log(`  model ${awake ? "is awake" : "did not answer (is the GX10 tunnel up?)"}`),
    );
}

const once = (task: () => Promise<void>): (() => Promise<void>) => {
  let started: Promise<void> | undefined;
  return () => {
    started ??= task();
    return started;
  };
};

const shutDown = once(async () => {
  await server.stop(true);
  await connection.close();
  process.exit(0);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void shutDown());
}
