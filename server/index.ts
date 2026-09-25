import { INPUT_LIMITS } from "../src/core/inputLimits";
import { createBeautifier } from "./beautify/beautifier";
import { createLlmCompiler } from "./compile/llmCompiler";
import { readConfig } from "./config";
import { startControllers } from "./controllers";
import { BoardRepository } from "./db/boardRepository";
import { connectDatabase } from "./db/connect";
import { categoryOf, createExemplarSource } from "./exemplar/exemplars";
import { ApiAccess } from "./http/access";
import { createApi } from "./http/api";
import { type SocketData, socketsOf } from "./http/sockets";
import { createStaticSite } from "./http/staticSite";
import { quickdrawNatureTable } from "./natures/natureTable";
import { buildFeatureMatrix } from "./quickdraw/featureMatrix";
import { QuickdrawSampleRepository } from "./quickdraw/sampleRepository";
import { describeSeed, seedQuickdraw } from "./quickdraw/seed";
import { createRecognizerChain } from "./recognition/chain";
import { createKnnRanker } from "./recognition/ranking/ranker";
import { createLlmSceneCompiler } from "./scene/llmSceneCompiler";
import { createSketchLibrary } from "./sketch";
import { isStageSocket, stageSockets } from "./stage/socket";
import { createLlmTranscriber } from "./transcribe/llmTranscriber";
import { VOICE_SOCKET_PATH, voiceSockets } from "./voice/socket";
import { createSpeaker } from "./voice/speaker";

const API_PREFIX = "/api";

const log = (line: string): void => console.log(`  ${line}`);

const config = readConfig();
const connection = await connectDatabase(config.database);

const boards = new BoardRepository(connection.db);
await boards.ensureIndexes();

const samples = new QuickdrawSampleRepository(connection.db);
const seeded = await seedQuickdraw(samples, config.quickdrawSnapshot);
const knn = createKnnRanker(buildFeatureMatrix(await samples.loadFeatures()), {
  threads: config.recognizerThreads,
  log,
});
const sketches = await createSketchLibrary(config.sketchesDirectory, { stored: samples, log });
const eye = createRecognizerChain(config.recognizer, knn.ranker, { log });

const controllers = await startControllers(config.controllers, { log });

const compiler = createLlmCompiler(config.llm);
const transcriber = createLlmTranscriber(config.transcribe);
const access = new ApiAccess(config.access);
const voice = voiceSockets(config.voice, access);
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
  speaker: createSpeaker(config.voice),
  scenes: createLlmSceneCompiler(
    config.llm,
    (word) => categoryOf(word, quickdrawNatureTable) !== null,
  ),
});
const site = config.webDirectory === null ? null : createStaticSite(config.webDirectory);
const isApiCall = (request: Request): boolean =>
  new URL(request.url).pathname.startsWith(API_PREFIX);

const isVoiceSocket = (request: Request): boolean =>
  new URL(request.url).pathname === VOICE_SOCKET_PATH;

const serving = {
  maxRequestBodySize: INPUT_LIMITS.sketchBytes,
  fetch: async (request, listening) => {
    if (isVoiceSocket(request)) return voice.upgrade(request, listening);
    if (isStageSocket(request)) return stage.upgrade(request, listening);
    return isApiCall(request) || site === null
      ? api.handle(request)
      : ((await site(request)) ?? api.handle(request));
  },
  websocket: socketsOf(voice.websocket, stage.websocket),
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
    : `Kami server on https://${config.hostname}:${config.tls.port} (microphone-capable)`,
);
log(`memory: ${connection.description}`);
log(`game: ${config.webDirectory ?? "not built (Vite serves it in development)"}`);
log(describeSeed(seeded, config.quickdrawSnapshot));
log(
  knn.size > 0
    ? `recognition: ${knn.size} Quick, Draw! sketches; ${knn.describe()}`
    : "recognition: empty (run `bun run quickdraw:ingest` or set KAMI_QUICKDRAW_SNAPSHOT)",
);
void eye.describe().then(log);
log(`beautifier: ${config.beautifier?.url ?? "none attached"}`);
log(sketches.describe());
log(`controllers: ${controllers.description}`);
log("big screen: open /?screen on the monitor; it shows whichever device is drawing");
console.log(
  `  voice: ${config.voice === null ? "off (set DEEPGRAM_API_KEY)" : `${config.voice.listenModel} in, ${config.voice.speakModel} out`}`,
);
log(`model compile: ${config.llm === null ? "off" : config.llm.model}`);
log(
  `handwriting: ${config.transcribe === null ? "off" : `${config.transcribe.model} (checking vision)`}`,
);

/**
 * One request each, in sequence: the rules model is asked "hello" so a cold local model loads before
 * the first player needs it (skipped with KAMI_LLM_WARM_UP=off, where every request is paid for); the
 * handwriting reader's image check is what enables /api/transcribe, so it always runs, once.
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
  log(`handwriting reader ${reads ? "is ready" : "disabled: image check failed"}`);
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
 * Closing politely can wait for ever on a socket that will not close (a voice stream held open to
 * Deepgram did, with the https listener already gone). Everything that must survive lives in
 * MongoDB, a process of its own, so after a short grace the server simply leaves.
 */
const SHUTDOWN_GRACE_MS = 3000;

const shutDown = once(async () => {
  setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS).unref();
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
