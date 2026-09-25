/** One look at the sidecar's GET /health, so the start-up log can say whose eyes Kami is using. */
import { z } from "zod";
import { type AuthenticatedEndpoint, endpointHeaders } from "../http/endpoint";
import { sidecarUrl } from "./sidecarUrl";
import type { FetchLike } from "./types";

export interface EyeHealth {
  readonly model: string;
  readonly classes: number;
}

const HEALTH_TIMEOUT_MS = 1_000;

const healthSchema = z.object({
  ok: z.literal(true),
  classes: z.number().int().positive(),
  model: z.string().min(1),
});

export const checkEyeHealth = async (
  sidecar: AuthenticatedEndpoint,
  fetchFn: FetchLike = fetch,
): Promise<EyeHealth | null> => {
  try {
    const answer = await fetchFn(sidecarUrl(sidecar.url, "health"), {
      headers: endpointHeaders(sidecar),
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!answer.ok) return null;
    const health = healthSchema.safeParse(await answer.json());
    return health.success ? { model: health.data.model, classes: health.data.classes } : null;
  } catch {
    return null;
  }
};

export const describeEye = (health: EyeHealth | null): string =>
  health === null
    ? "eye: not running, using k-NN"
    : `eye: ${health.model} (${health.classes} classes)`;
