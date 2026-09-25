import { dirname } from "node:path";
import type { Env } from "../env/env";
import type { FetchLike } from "../recognition/types";
import { fetchSidecarCapabilities, type SidecarCapabilities } from "./health";
import { type ManagedSidecarConfig, managedSidecarUrl, sidecarEnvironment } from "./managed";

export interface SidecarProcess {
  /** Resolves with the exit code once the process has ended, however it ended. */
  readonly exited: Promise<number | null>;
  kill(signal: NodeJS.Signals): void;
}

export interface SpawnRequest {
  readonly command: readonly string[];
  readonly env: Record<string, string>;
  readonly cwd: string;
  /** Each line the process writes, stdout and stderr alike. */
  readonly onLine: (line: string) => void;
}

/** Throws when the process cannot be started at all (no such interpreter). */
export type SpawnSidecar = (request: SpawnRequest) => SidecarProcess;

export interface Backoff {
  readonly initialMs: number;
  readonly maxMs: number;
  /** A run at least this long was healthy: the next crash waits `initialMs` again. */
  readonly healthyAfterMs: number;
}

export const DEFAULT_BACKOFF: Backoff = { initialMs: 1_000, maxMs: 60_000, healthyAfterMs: 60_000 };

export interface SupervisorOptions {
  readonly spawn: SpawnSidecar;
  readonly log: (line: string) => void;
  readonly env: Env;
  readonly backoff: Backoff;
  readonly now: () => number;
  readonly fetchFn: FetchLike;
}

const forwardLines = async (
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<void> => {
  const decoder = new TextDecoder();
  let pending = "";
  for await (const bytes of stream) {
    const lines = (pending + decoder.decode(bytes, { stream: true })).split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) if (line.trim() !== "") onLine(line.trimEnd());
  }
  if (pending.trim() !== "") onLine(pending.trimEnd());
};

export const spawnWithBun: SpawnSidecar = ({ command, env, cwd, onLine }) => {
  const child = Bun.spawn([...command], {
    env,
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  void forwardLines(child.stdout, onLine);
  void forwardLines(child.stderr, onLine);
  return { exited: child.exited, kill: (signal) => child.kill(signal) };
};

const SIDECAR_PREFIX = "sidecar: ";

/**
 * Runs ml/sidecar.py as a child process for as long as the server runs: its output goes to the
 * server's log line by line, a crash restarts it after a doubling pause (reset by a long healthy
 * run), and stopping asks it to finish (SIGINT) before it is killed.
 */
export class SidecarSupervisor {
  readonly #config: ManagedSidecarConfig;
  readonly #options: SupervisorOptions;
  #child: SidecarProcess | null = null;
  #stopping = false;
  readonly #wakers = new Set<() => void>();
  #supervising: Promise<void> | null = null;

  constructor(config: ManagedSidecarConfig, options: Partial<SupervisorOptions> = {}) {
    this.#config = config;
    this.#options = {
      spawn: spawnWithBun,
      log: console.log,
      env: process.env,
      backoff: DEFAULT_BACKOFF,
      now: Date.now,
      fetchFn: fetch,
      ...options,
    };
  }

  get url(): string {
    return managedSidecarUrl(this.#config);
  }

  start(): void {
    this.#supervising ??= this.#supervise();
  }

  /** Resolves with what the sidecar can do once it answers /health, or null if it never does. */
  async whenUp(timeoutMs = 120_000, pollMs = 500): Promise<SidecarCapabilities | null> {
    const deadline = this.#options.now() + timeoutMs;
    while (!this.#stopping) {
      const capabilities = await fetchSidecarCapabilities({ url: this.url }, this.#options.fetchFn);
      if (capabilities !== null) return capabilities;
      if (this.#options.now() + pollMs > deadline) return null;
      await this.#pause(pollMs);
    }
    return null;
  }

  async stop(graceMs = 2_000): Promise<void> {
    this.#stopping = true;
    for (const wake of this.#wakers) wake();
    const child = this.#child;
    if (child !== null) {
      child.kill("SIGINT");
      const ended = await Promise.race([
        child.exited.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), graceMs).unref?.()),
      ]);
      if (!ended) child.kill("SIGKILL");
    }
    await this.#supervising;
  }

  async #supervise(): Promise<void> {
    const { backoff, log, now } = this.#options;
    let delayMs = backoff.initialMs;
    while (!this.#stopping) {
      const started = now();
      const child = this.#launch();
      if (child === null) return;
      this.#child = child;
      const code = await child.exited;
      this.#child = null;
      if (this.#stopping) break;
      if (now() - started >= backoff.healthyAfterMs) delayMs = backoff.initialMs;
      log(`${SIDECAR_PREFIX}exited with ${code ?? "a signal"}; restarting in ${delayMs / 1000} s`);
      await this.#pause(delayMs);
      delayMs = Math.min(delayMs * 2, backoff.maxMs);
    }
  }

  #launch(): SidecarProcess | null {
    const { python, script } = this.#config;
    const { spawn, log, env } = this.#options;
    try {
      return spawn({
        command: [python, script],
        env: sidecarEnvironment(this.#config, env),
        cwd: dirname(script),
        onLine: (line) => log(`${SIDECAR_PREFIX}${line}`),
      });
    } catch (error) {
      log(`${SIDECAR_PREFIX}cannot start ${python} ${script}: ${(error as Error).message}`);
      return null;
    }
  }

  /** A pause that `stop` cuts short. */
  #pause(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        this.#wakers.delete(done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.#wakers.add(done);
    });
  }
}
