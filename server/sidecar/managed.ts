import type { Env } from "../env/env";

/** The sidecar the server starts itself only ever listens on loopback. */
export const SIDECAR_HOST = "127.0.0.1";

/** How to run `ml/sidecar.py` as a child of the server (`KAMI_SIDECAR=auto`). */
export interface ManagedSidecarConfig {
  /** The Python that has the sidecar's dependencies, e.g. `ml/.venv/bin/python`. */
  readonly python: string;
  readonly script: string;
  readonly port: number;
  /** ONNX Runtime threads (KAMI_EYE_THREADS); null leaves Runtime its default. */
  readonly threads: number | null;
  /** Kami's Eye artefact directory; the sidecar serves without the Eye when it is absent. */
  readonly eyeModel: string;
  /** The handwriting bundle (`python -m handwriting.fetch`). */
  readonly handwritingModel: string;
}

export const managedSidecarUrl = ({ port }: ManagedSidecarConfig): string =>
  `http://${SIDECAR_HOST}:${port}`;

/** Only what a Python process needs: the server's secrets stay with the server. The sidecar stops
 * when the process named by KAMI_SIDECAR_PARENT_PID is no longer its parent. */
const INHERITED = ["PATH", "LANG", "LC_ALL", "TZ", "TMPDIR", "SSL_CERT_FILE"] as const;

export const sidecarEnvironment = (
  config: ManagedSidecarConfig,
  parent: Env,
  parentPid: number,
): Record<string, string> => {
  const environment: Record<string, string> = {
    KAMI_EYE_HOST: SIDECAR_HOST,
    KAMI_EYE_PORT: String(config.port),
    KAMI_EYE_MODEL: config.eyeModel,
    KAMI_HANDWRITING_MODEL: config.handwritingModel,
    PYTHONUNBUFFERED: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    OMP_NUM_THREADS: "1",
    KAMI_SIDECAR_PARENT_PID: String(parentPid),
  };
  if (config.threads !== null) environment.KAMI_EYE_THREADS = String(config.threads);
  for (const name of INHERITED) {
    const value = parent[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
};
