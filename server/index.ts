import { INPUT_LIMITS } from "../src/core/inputLimits";
import { createBeautifier } from "./beautify/beautifier";
import { createLlmCompiler } from "./compile/llmCompiler";
import { readConfig } from "./config";
import { startControllers } from "./controllers";
import { BoardRepository } from "./db/boardRepository";
import { connectDatabase } from "./db/connect";
import { dropRetiredCollections } from "./db/retiredCollections";
import { categoryOf, createExemplarSource } from "./exemplar/exemplars";
import { ApiAccess } from "./http/access";
import { describeAccess } from "./http/accessConfig";
import { createApi } from "./http/api";
import { type SocketData, socketsOf } from "./http/sockets";
import { createStaticSite } from "./http/staticSite";
import { quickdrawNatureTable } from "./natures/natureTable";
import { indexPathsFor, loadQuickdrawCorpus } from "./quickdraw/corpus";
import { createRecognizerChain } from "./recognition/chain";
import { createKnnRanker } from "./recognition/ranking/ranker";
import { createLlmSceneCompiler } from "./scene/llmSceneCompiler";
import { SidecarSupervisor } from "./sidecar/supervisor";
import { createSketchLibrary } from "./sketch";
import { isStageSocket, stageSockets } from "./stage/socket";
import { createTranscriber } from "./transcribe/transcriber";

const API_PREFIX = "/api";

const log = (line: string): void => console.log(`  ${line}`);

const config = readConfig();
const sidecar = config.sidecar === null ? null : new SidecarSupervisor(config.sidecar, { log });
sidecar?.start();
const connection = await connectDatabase(config.database);

const boards = new BoardRepository(connection.db);
await boards.ensureIndexes();
const retired = await dropRetiredCollections(connection.db);

const quickdraw = await loadQuickdrawCorpus(
  config.quickdrawSnapshot,
  indexPathsFor(config.quickdrawSnapshot, config.database.embeddedDataDirectory),
);
const knn = createKnnRanker(quickdraw.corpus.matrix, { threads: config.recognizerThreads, log });
const sketches = await createSketchLibrary(config.sketchesDirectory, {
  stored: quickdraw.corpus,
  log,
});
const eye = createRecognizerChain(config.recognizer, knn.ranker, { log });

const controllers = await startControllers(config.controllers, { log });

const compiler = createLlmCompiler(config.llm);
const transcriber = createTranscriber({ sidecar: config.handwriting, vision: config.transcribe });
const access = new ApiAccess(config.access);
const stage = stageSockets(access);
const api = createApi({
  access,
  boards,
  recognizer: eye.recognizer,
  compiler,
  beautifier: createBeautifier(config.beautifier),
  controllers: controllers.hub,
  transcriber,
  exemplars: createExemplarSource(sketches, quickdrawNatureTable),
  scenes: createLlmSceneCompiler(
    config.llm,
    (word) => categoryOf(word, quickdrawNatureTable) !== null,
  ),
});
const site = config.webDirectory === null ? null : createStaticSite(config.webDirectory);
const isApiCall = (request: Request): boolean =>
  new URL(request.url).pathname.startsWith(API_PREFIX);

const serving = {
  maxRequestBodySize: INPUT_LIMITS.sketchBytes,
  fetch: async (request, listening) => {
    if (isStageSocket(request)) return stage.upgrade(request, listening);
    const peer = listening.requestIP(request)?.address;
    return isApiCall(request) || site === null
      ? api.handle(request, peer)
      : ((await site(request)) ?? api.handle(request, peer));
  },
  websocket: socketsOf(stage.websocket),
} satisfies Pick<Bun.Serve.Options<SocketData>, "fetch" | "websocket" | "maxRequestBodySize">;

const server = Bun.serve<SocketData>({
  ...serving,
  port: config.port,
  hostname: config.hostname,
});
const tlsServer =
  config.tls === null
    ? null
    : Bun.serve<SocketData>({
        ...serving,
        port: config.tls.port,
        hostname: config.hostname,
        tls: {
          cert: Bun.file(config.tls.certFile),
          key: Bun.file(config.tls.keyFile),
        },
      });

console.log(`Kami server on http://${config.hostname}:${server.port} (${config.access.mode})`);
console.log(
  config.tls === null
    ? "  https: off (set KAMI_TLS_CERT/KAMI_TLS_KEY)"
    : `Kami server on https://${config.hostname}:${config.tls.port}`,
);
log(`access: ${describeAccess(config.access)}`);
log(`memory: ${connection.description}`);
log(`game: ${config.webDirectory ?? "not built (Vite serves it in development)"}`);
if (retired.length > 0) log(`memory: dropped ${retired.join(", ")}, which nothing reads any more`);
log(quickdraw.description);
log(
  knn.size > 0
    ? `recognition: ${knn.size} Quick, Draw! sketches; ${knn.describe()}`
    : "recognition: empty (run `bun run quickdraw:ingest`, or point KAMI_QUICKDRAW_SNAPSHOT at a corpus)",
);
void (sidecar?.whenUp() ?? Promise.resolve()).then(() => eye.describe()).then(log);
log(`beautifier: ${config.beautifier?.url ?? "none attached"}`);
log(sketches.describe());
log(`controllers: ${controllers.description}`);
log("big screen: open /?screen on the monitor; it shows whichever device is drawing");
log(`model compile: ${config.llm === null ? "off" : config.llm.model}`);
log(
  sidecar === null
    ? "sidecar: off (KAMI_SIDECAR=auto starts ml/sidecar.py beside the server)"
    : `sidecar: starting ${config.sidecar?.script} on ${sidecar.url}`,
);
log(
  `handwriting: ${transcriber === null ? "off" : `${transcriber.candidates.join(", then ")} (checking)`}`,
);

/**
 * One request each, in sequence: the rules model is asked "hello" so a cold local model loads before
 * the first player needs it (skipped with KAMI_LLM_WARM_UP=off, where every request is paid for); the
 * handwriting reader's start-up check is what enables /api/transcribe, so it always runs, once.
 */
const warmUp = async (): Promise<void> => {
  if (config.llm !== null) {
    if (config.warmUp) {
      const awake = await compiler.warmUp();
      log(`model ${awake ? "is awake" : "did not answer (check KAMI_LLM_URL)"}`);
    } else {
      log("model warm-up skipped (KAMI_LLM_WARM_UP=off)");
    }
  }
  if (transcriber === null) return;
  const reads = await transcriber.warmUp();
  log(
    reads
      ? `handwriting reader is ready: ${transcriber.chosen}`
      : "handwriting reader disabled: no reader passed its start-up check",
  );
};
void warmUp();

const once = (task: () => Promise<void>): (() => Promise<void>) => {
  let started: Promise<void> | undefined;
  return () => {
    started ??= task();
    return started;
  };
};

/**
 * Closing politely can wait for ever on a socket that will not close. Everything that must
 * survive lives in MongoDB, a process of its own, so after a short grace the server simply leaves.
 */
const SHUTDOWN_GRACE_MS = 3000;
const SIDECAR_GRACE_MS = 1500;

const shutDown = once(async () => {
  setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS).unref();
  await sidecar?.stop(SIDECAR_GRACE_MS);
  await controllers.close();
  await tlsServer?.stop(true);
  await server.stop(true);
  knn.close();
  await connection.close();
  process.exit(0);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void shutDown());
}
