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
import { QuickdrawRecognizer } from "./quickdraw/recognizer";
import { QuickdrawSampleRepository } from "./quickdraw/sampleRepository";
import { createRecognizerChain } from "./recognition/chain";
import { createLlmSceneCompiler } from "./scene/llmSceneCompiler";
import { createSketchLibrary } from "./sketch";
import { isStageSocket, stageSockets } from "./stage/socket";
import { createLlmTranscriber } from "./transcribe/llmTranscriber";
import { VOICE_SOCKET_PATH, voiceSockets } from "./voice/socket";
import { createSpeaker } from "./voice/speaker";

const API_PREFIX = "/api";

const config = readConfig();
const connection = await connectDatabase(config.database);

const boards = new BoardRepository(connection.db);
await boards.ensureIndexes();

const samples = new QuickdrawSampleRepository(connection.db);
const knn = new QuickdrawRecognizer(await samples.loadFeatures());
const sketches = await createSketchLibrary(config.sketchesDirectory, {
  stored: samples,
  log: (line) => console.log(`  ${line}`),
});
const eye = createRecognizerChain(config.recognizerUrl, knn, {
  log: (line) => console.log(`  ${line}`),
});

const controllers = await startControllers(config.controllers, {
  log: (line) => console.log(`  ${line}`),
});

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
  beautifier: createBeautifier(config.beautifyUrl),
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
console.log(`  memory: ${connection.description}`);
console.log(`  game: ${config.webDirectory ?? "not built (Vite serves it in development)"}`);
console.log(
  knn.size > 0
    ? `  recognition: ${knn.size} Quick, Draw! sketches`
    : "  recognition: empty (run `bun run quickdraw:ingest`)",
);
void eye.describe().then((line) => console.log(`  ${line}`));
console.log(`  beautifier: ${config.beautifyUrl ?? "none attached"}`);
console.log(`  ${sketches.describe()}`);
console.log(`  controllers: ${controllers.description}`);
console.log("  big screen: open /?screen on the monitor; it shows whichever device is drawing");
console.log(
  `  voice: ${config.voice === null ? "off (set DEEPGRAM_API_KEY)" : `${config.voice.listenModel} in, ${config.voice.speakModel} out`}`,
);
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
  await tlsServer?.stop(true);
  await server.stop(true);
  await connection.close();
  process.exit(0);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void shutDown());
}
