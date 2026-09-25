// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { FetchLike } from "../recognition/types";
import type { ManagedSidecarConfig } from "./managed";
import {
  type Backoff,
  type SidecarProcess,
  SidecarSupervisor,
  type SpawnRequest,
  type SpawnSidecar,
} from "./supervisor";

const CONFIG: ManagedSidecarConfig = {
  python: "/app/ml/.venv/bin/python",
  script: "/app/ml/sidecar.py",
  port: 8790,
  threads: 1,
  eyeModel: "/models/kami-eye",
  handwritingModel: "/app/models/handwriting",
};

const QUICK: Backoff = { initialMs: 5, maxMs: 20, healthyAfterMs: 10_000 };

class FakeProcess implements SidecarProcess {
  readonly signals: NodeJS.Signals[] = [];
  readonly exited: Promise<number | null>;
  exit: (code: number | null) => void = () => {};

  constructor(private readonly obeys: readonly NodeJS.Signals[]) {
    this.exited = new Promise((resolve) => {
      this.exit = resolve;
    });
  }

  kill(signal: NodeJS.Signals): void {
    this.signals.push(signal);
    if (this.obeys.includes(signal)) this.exit(null);
  }
}

const recording = (obeys: readonly NodeJS.Signals[] = ["SIGINT"]) => {
  const spawned: { request: SpawnRequest; process: FakeProcess }[] = [];
  const spawn: SpawnSidecar = (request) => {
    const process = new FakeProcess(obeys);
    spawned.push({ request, process });
    return process;
  };
  return { spawn, spawned };
};

const until = async (condition: () => boolean): Promise<void> => {
  for (let tries = 0; tries < 200 && !condition(); tries += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  expect(condition()).toBe(true);
};

describe("SidecarSupervisor", () => {
  it("runs the sidecar with its settings and none of the server's secrets", async () => {
    const { spawn, spawned } = recording();
    const lines: string[] = [];
    const supervisor = new SidecarSupervisor(CONFIG, {
      spawn,
      log: (line) => lines.push(line),
      env: { PATH: "/usr/bin", KAMI_LLM_API_KEY: "secret", MONGODB_URI: "mongodb://secret" },
      backoff: QUICK,
    });
    supervisor.start();
    supervisor.start();
    expect(spawned).toHaveLength(1);
    const [{ request }] = spawned as [(typeof spawned)[number]];
    expect(request.command).toEqual([CONFIG.python, CONFIG.script]);
    expect(request.cwd).toBe("/app/ml");
    expect(request.env).toMatchObject({
      KAMI_EYE_HOST: "127.0.0.1",
      KAMI_EYE_PORT: "8790",
      KAMI_EYE_THREADS: "1",
      KAMI_EYE_MODEL: "/models/kami-eye",
      KAMI_HANDWRITING_MODEL: "/app/models/handwriting",
      PATH: "/usr/bin",
    });
    expect(JSON.stringify(request.env)).not.toContain("secret");
    request.onLine("listening on http://127.0.0.1:8790");
    expect(lines).toEqual(["sidecar: listening on http://127.0.0.1:8790"]);
    await supervisor.stop(50);
  });

  it("restarts a sidecar that dies, waiting longer each time", async () => {
    const { spawn, spawned } = recording();
    const lines: string[] = [];
    const supervisor = new SidecarSupervisor(CONFIG, {
      spawn,
      log: (line) => lines.push(line),
      backoff: QUICK,
    });
    supervisor.start();
    for (const attempt of [1, 2, 3]) {
      await until(() => spawned.length === attempt);
      spawned[attempt - 1]?.process.exit(1);
    }
    await until(() => spawned.length === 4);
    expect(lines.filter((line) => line.includes("restarting"))).toEqual([
      "sidecar: exited with 1; restarting in 0.005 s",
      "sidecar: exited with 1; restarting in 0.01 s",
      "sidecar: exited with 1; restarting in 0.02 s",
    ]);
    await supervisor.stop(50);
    expect(spawned).toHaveLength(4);
  });

  it("asks the sidecar to stop, then makes it", async () => {
    const polite = recording(["SIGINT"]);
    const gentle = new SidecarSupervisor(CONFIG, { spawn: polite.spawn, log: () => {} });
    gentle.start();
    await gentle.stop(50);
    expect(polite.spawned[0]?.process.signals).toEqual(["SIGINT"]);

    const stubborn = recording(["SIGKILL"]);
    const firm = new SidecarSupervisor(CONFIG, { spawn: stubborn.spawn, log: () => {} });
    firm.start();
    await firm.stop(10);
    expect(stubborn.spawned[0]?.process.signals).toEqual(["SIGINT", "SIGKILL"]);
    expect(stubborn.spawned).toHaveLength(1);
  });

  it("gives up, saying why, when there is no Python to run it with", async () => {
    const lines: string[] = [];
    const supervisor = new SidecarSupervisor(CONFIG, {
      spawn: () => {
        throw new Error("ENOENT");
      },
      log: (line) => lines.push(line),
    });
    supervisor.start();
    await supervisor.stop();
    expect(lines).toEqual([`sidecar: cannot start ${CONFIG.python} ${CONFIG.script}: ENOENT`]);
  });

  it("says what the sidecar can do once it answers", async () => {
    let looks = 0;
    const starting: FetchLike = async () => {
      looks += 1;
      if (looks < 3) throw new TypeError("connection refused");
      return Response.json({ ok: true, capabilities: { eye: false, handwriting: true } });
    };
    const supervisor = new SidecarSupervisor(CONFIG, { fetchFn: starting, log: () => {} });
    expect(supervisor.url).toBe("http://127.0.0.1:8790");
    expect(await supervisor.whenUp(1_000, 1)).toEqual({ eye: false, handwriting: true });
    const never = new SidecarSupervisor(CONFIG, {
      fetchFn: async () => {
        throw new TypeError("connection refused");
      },
    });
    expect(await never.whenUp(20, 5)).toBeNull();
  });
});
