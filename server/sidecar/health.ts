/** What a Kami sidecar (ml/sidecar.py) says it can do, from one look at its GET /health. */
import { z } from "zod";
import { type AuthenticatedEndpoint, endpointHeaders } from "../http/endpoint";
import { sidecarUrl } from "../recognition/sidecarUrl";
import type { FetchLike } from "../recognition/types";

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
