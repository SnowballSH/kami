/** Builds what /api/recognize asks: the sidecar over the k-NN when a sidecar is configured, else the k-NN alone. */
import type { AuthenticatedEndpoint } from "../http/endpoint";
import { FallbackRecognizer } from "./fallbackRecognizer";
import { checkEyeHealth, describeEye } from "./health";
import { asSketchRanker } from "./inProcessRanker";
import { RemoteSketchRecognizer } from "./remoteRecognizer";
import type { FetchLike, InProcessSketchRanker, SketchRanker } from "./types";

export interface RecognizerChain {
  readonly recognizer: SketchRanker;
  describe(): Promise<string>;
}

export interface ChainSettings {
  readonly log: (line: string) => void;
  readonly fetchFn: FetchLike;
}

const EYE_NOT_CONFIGURED = "eye: not configured (KAMI_RECOGNIZER_URL), using k-NN";
const EYE_WENT_QUIET = "eye: stopped answering, using k-NN";
const EYE_CAME_BACK = "eye: answering again";

export const createRecognizerChain = (
  sidecar: AuthenticatedEndpoint | null,
  knn: InProcessSketchRanker,
  { log = console.log, fetchFn = fetch }: Partial<ChainSettings> = {},
): RecognizerChain => {
  const floor = asSketchRanker(knn);
  if (sidecar === null) {
    return { recognizer: floor, describe: async () => EYE_NOT_CONFIGURED };
  }
  return {
    recognizer: new FallbackRecognizer(new RemoteSketchRecognizer(sidecar, fetchFn), floor, {
      onPrimaryAvailabilityChange: (available) => log(available ? EYE_CAME_BACK : EYE_WENT_QUIET),
    }),
    describe: async () => describeEye(await checkEyeHealth(sidecar, fetchFn)),
  };
};
