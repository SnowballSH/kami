/** What a Kami sidecar (ml/sidecar.py) says it can do, from one look at its GET /health. */
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { type AuthenticatedEndpoint, endpointHeaders, type FetchLike } from "../http/endpoint";
import { sidecarUrl } from "../recognition/sidecarUrl";

export interface SidecarCapabilities {
  readonly eye: boolean;
  readonly handwriting: boolean;
}

const HEALTH_TIMEOUT_MS = 1_000;

/** A sidecar from before handwriting reports no capabilities: it is an Eye and nothing else. */
const LEGACY_EYE: SidecarCapabilities = { eye: true, handwriting: false };

const healthSchema = z.object({
  ok: z.literal(true),
  capabilities: z.object({ eye: z.boolean(), handwriting: z.boolean() }).optional(),
});

/** Null when nothing answers, or the answer is not a sidecar's health report. */
export const fetchSidecarCapabilities = async (
  sidecar: AuthenticatedEndpoint,
  fetchFn: FetchLike = fetch,
  timeoutMs = HEALTH_TIMEOUT_MS,
): Promise<SidecarCapabilities | null> => {
  try {
    const answer = await fetchFn(sidecarUrl(sidecar.url, "health"), {
      headers: endpointHeaders(sidecar),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!answer.ok) return null;
    const health = healthSchema.safeParse(await answer.json());
    if (!health.success) return null;
    return health.data.capabilities ?? LEGACY_EYE;
  } catch {
    return null;
  }
};

export interface SidecarWait {
  readonly timeoutMs: number;
  readonly pollMs: number;
  readonly now?: () => number;
  /** Stops waiting at once, as if the sidecar never came up. */
  readonly signal?: AbortSignal;
}

/** Resolves even when `signal` aborts, so a stopped wait just ends. */
export const pause = (ms: number, signal?: AbortSignal): Promise<void> =>
  sleep(ms, undefined, signal === undefined ? {} : { signal }).catch(() => {});

/** Asks `/health` every `pollMs` until the sidecar answers; null when `timeoutMs` passes first. */
export const waitForSidecar = async (
  sidecar: AuthenticatedEndpoint,
  fetchFn: FetchLike,
  { timeoutMs, pollMs, now = Date.now, signal }: SidecarWait,
): Promise<SidecarCapabilities | null> => {
  const deadline = now() + timeoutMs;
  while (signal?.aborted !== true) {
    const capabilities = await fetchSidecarCapabilities(sidecar, fetchFn);
    if (capabilities !== null) return capabilities;
    if (now() + pollMs > deadline) return null;
    await pause(pollMs, signal);
  }
  return null;
};
