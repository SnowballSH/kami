// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readConfig } from "./config";

const LLM = { KAMI_LLM_URL: "http://llm.test", KAMI_LLM_MODEL: "text-model" };

describe("readConfig", () => {
  it("summons from the exemplar set at KAMI_SKETCHES, or from Quick, Draw! without one", () => {
    expect(readConfig({}).sketchesDirectory).toBeNull();
    expect(readConfig({ KAMI_SKETCHES: " /srv/exemplars " }).sketchesDirectory).toBe(
      "/srv/exemplars",
    );
  });

  it("uses a dedicated transcription model without changing the compiler", () => {
    expect(readConfig(LLM).transcribe).toEqual(readConfig(LLM).llm);
    expect(readConfig({ ...LLM, KAMI_TRANSCRIBE_MODEL: " " }).transcribe).toEqual(
      readConfig(LLM).llm,
    );
    const config = readConfig({ ...LLM, KAMI_TRANSCRIBE_MODEL: " vision-model " });
    expect(config.transcribe?.model).toBe("vision-model");
    expect(config.llm?.model).toBe("text-model");
    expect(readConfig({ KAMI_TRANSCRIBE_MODEL: "vision-model" }).transcribe).toBeNull();
  });

  it("can enable handwriting independently of model compilation", () => {
    const config = readConfig({
      KAMI_LLM_URL: "http://llm.test",
      KAMI_TRANSCRIBE_MODEL: "vision-model",
    });
    expect(config.llm).toBeNull();
    expect(config.transcribe).toEqual({ url: "http://llm.test", model: "vision-model" });
  });

  it("lets the handwriting model live on another server with its own key", () => {
    const env = {
      ...LLM,
      KAMI_LLM_API_KEY: "rules-key",
      KAMI_TRANSCRIBE_URL: "http://vision.test/v1",
      KAMI_TRANSCRIBE_MODEL: "vision-model",
      KAMI_TRANSCRIBE_API_KEY: "vision-key",
    };
    expect(readConfig(env).transcribe).toEqual({
      url: "http://vision.test/v1",
      model: "vision-model",
      apiKey: "vision-key",
    });
    expect(readConfig(env).llm).toEqual({ ...readConfig(LLM).llm, apiKey: "rules-key" });
    const { KAMI_TRANSCRIBE_API_KEY: _key, ...sharedKey } = env;
    expect(readConfig(sharedKey).transcribe?.apiKey).toBe("rules-key");
    expect(
      readConfig({ KAMI_TRANSCRIBE_URL: "http://vision.test", KAMI_TRANSCRIBE_MODEL: "v" })
        .transcribe,
    ).toEqual({ url: "http://vision.test", model: "v" });
  });

  it("reads reasoning effort for each model, the handwriting one following the rules one", () => {
    expect(readConfig(LLM).llm).not.toHaveProperty("reasoningEffort");
    const high = readConfig({ ...LLM, KAMI_LLM_REASONING_EFFORT: "high" });
    expect(high.llm?.reasoningEffort).toBe("high");
    expect(high.transcribe?.reasoningEffort).toBe("high");
    const split = readConfig({
      ...LLM,
      KAMI_LLM_REASONING_EFFORT: "minimal",
      KAMI_TRANSCRIBE_REASONING_EFFORT: "off",
    });
    expect(split.llm?.reasoningEffort).toBe("minimal");
    expect(split.transcribe?.reasoningEffort).toBeNull();
    expect(() => readConfig({ ...LLM, KAMI_LLM_REASONING_EFFORT: "lots" })).toThrow(
      /KAMI_LLM_REASONING_EFFORT/,
    );
    expect(() => readConfig({ ...LLM, KAMI_TRANSCRIBE_REASONING_EFFORT: "lots" })).toThrow(
      /KAMI_TRANSCRIBE_REASONING_EFFORT/,
    );
  });

  it("warms the rules model up unless told not to", () => {
    expect(readConfig({}).warmUp).toBe(true);
    expect(readConfig({ KAMI_LLM_WARM_UP: "off" }).warmUp).toBe(false);
  });

  it("reads secrets from files when asked, and only then", () => {
    const files: Record<string, string> = {
      "/run/secrets/llm": "sk-file\n",
      "/run/secrets/mongo": "mongodb://db/kami\n",
    };
    const readFile = (path: string): string => {
      const content = files[path];
      if (content === undefined) throw new Error("ENOENT");
      return content;
    };
    const config = readConfig(
      {
        ...LLM,
        KAMI_LLM_API_KEY_FILE: "/run/secrets/llm",
        MONGODB_URI_FILE: "/run/secrets/mongo",
      },
      readFile,
    );
    expect(config.llm?.apiKey).toBe("sk-file");
    expect(config.database.uri).toBe("mongodb://db/kami");
    expect(() =>
      readConfig(
        { ...LLM, KAMI_LLM_API_KEY: "x", KAMI_LLM_API_KEY_FILE: "/run/secrets/llm" },
        readFile,
      ),
    ).toThrow(/not both/);
    expect(() => readConfig({ KAMI_LLM_API_KEY_FILE: "/nowhere" }, readFile)).toThrow(/nowhere/);
  });

  it("has no sidecar unless KAMI_RECOGNIZER_URL names one, with a bearer token when given", () => {
    expect(readConfig({}).recognizer).toBeNull();
    expect(readConfig({ KAMI_RECOGNIZER_URL: "   " }).recognizer).toBeNull();
    expect(readConfig({ KAMI_RECOGNIZER_URL: "off" }).recognizer).toBeNull();
    expect(readConfig({ KAMI_RECOGNIZER_URL: " http://127.0.0.1:8790 " }).recognizer).toEqual({
      url: "http://127.0.0.1:8790",
    });
    expect(
      readConfig({ KAMI_RECOGNIZER_URL: "https://eye.test", KAMI_RECOGNIZER_API_KEY: " eye-key " })
        .recognizer,
    ).toEqual({ url: "https://eye.test", apiKey: "eye-key" });
  });

  it("beautifies through the sidecar's /complete unless told where else, or off", () => {
    expect(readConfig({}).beautifier).toBeNull();
    expect(
      readConfig({ KAMI_RECOGNIZER_URL: "https://eye.test/", KAMI_RECOGNIZER_API_KEY: "eye-key" })
        .beautifier,
    ).toEqual({ url: "https://eye.test/complete", apiKey: "eye-key" });
    expect(
      readConfig({ KAMI_RECOGNIZER_URL: "https://eye.test", KAMI_BEAUTIFY_URL: "off" }).beautifier,
    ).toBeNull();
    expect(
      readConfig({
        KAMI_RECOGNIZER_URL: "https://eye.test",
        KAMI_RECOGNIZER_API_KEY: "eye-key",
        KAMI_BEAUTIFY_URL: "http://tidy.test/complete",
      }).beautifier,
    ).toEqual({ url: "http://tidy.test/complete" });
    expect(
      readConfig({
        KAMI_BEAUTIFY_URL: "http://tidy.test/complete",
        KAMI_BEAUTIFY_API_KEY: "tidy-key",
      }).beautifier,
    ).toEqual({ url: "http://tidy.test/complete", apiKey: "tidy-key" });
  });

  it("ranks sketches on one worker thread unless told otherwise", () => {
    expect(readConfig({}).recognizerThreads).toBe(1);
    expect(readConfig({ KAMI_RECOGNIZER_THREADS: "2" }).recognizerThreads).toBe(2);
    expect(readConfig({ KAMI_RECOGNIZER_THREADS: "0" }).recognizerThreads).toBe(0);
    expect(readConfig({ KAMI_RECOGNIZER_THREADS: "many" }).recognizerThreads).toBe(1);
  });

  it("keeps the embedded database small and where it is told", () => {
    expect(readConfig({}).database.embeddedDataDirectory).toMatch(/\.kami-data$/);
    expect(readConfig({ KAMI_DATA_DIR: " /var/lib/kami " }).database.embeddedDataDirectory).toBe(
      "/var/lib/kami",
    );
    expect(readConfig({}).database.embeddedCacheGb).toBe(0.25);
    expect(readConfig({ KAMI_MONGO_CACHE_GB: "0.5" }).database.embeddedCacheGb).toBe(0.5);
    expect(readConfig({ KAMI_MONGO_CACHE_GB: "lots" }).database.embeddedCacheGb).toBe(0.25);
  });

  it("reads the Quick, Draw! corpus from the data directory unless told otherwise", () => {
    expect(readConfig({ KAMI_DATA_DIR: "/data" }).quickdrawSnapshot).toBe(
      "/data/quickdraw.ndjson.gz",
    );
    expect(
      readConfig({ KAMI_QUICKDRAW_SNAPSHOT: " /srv/quickdraw.ndjson.gz " }).quickdrawSnapshot,
    ).toBe("/srv/quickdraw.ndjson.gz");
  });

  it("falls back to the default port on nonsense", () => {
    expect(readConfig({ PORT: "8799" }).port).toBe(8799);
    expect(readConfig({ PORT: "eighty" }).port).toBe(8787);
  });

  it("enables TLS when both certificate and key are configured", () => {
    expect(
      readConfig({
        KAMI_TLS_CERT: " /etc/kami/cert.pem ",
        KAMI_TLS_KEY: " /etc/kami/key.pem ",
        KAMI_TLS_PORT: " 9443 ",
      }).tls,
    ).toEqual({ certFile: "/etc/kami/cert.pem", keyFile: "/etc/kami/key.pem", port: 9443 });
    expect(readConfig({ KAMI_TLS_CERT: "/etc/kami/cert.pem" }).tls).toBeNull();
    expect(readConfig({ KAMI_TLS_KEY: "/etc/kami/key.pem" }).tls).toBeNull();
    expect(
      readConfig({ KAMI_TLS_CERT: "/etc/kami/cert.pem", KAMI_TLS_KEY: "/etc/kami/key.pem" }).tls
        ?.port,
    ).toBe(8443);
  });

  it("listens for controllers on UDP 8788 and any Arduino's serial line unless told otherwise", () => {
    expect(readConfig({}).controllers).toEqual({ udpPort: 8788, serialDevice: "auto" });
    expect(
      readConfig({ KAMI_CONTROLLER_UDP_PORT: " 9000 ", KAMI_CONTROLLER_SERIAL: " /dev/ttyUSB0 " })
        .controllers,
    ).toEqual({ udpPort: 9000, serialDevice: "/dev/ttyUSB0" });
    expect(readConfig({ KAMI_CONTROLLER_UDP_PORT: "loud" }).controllers.udpPort).toBe(8788);
  });

  it("switches a controller transport off with 'off'", () => {
    expect(
      readConfig({ KAMI_CONTROLLER_UDP_PORT: "off", KAMI_CONTROLLER_SERIAL: "OFF" }).controllers,
    ).toEqual({ udpPort: null, serialDevice: null });
  });
});
