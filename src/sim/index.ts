import { MatterSimulation } from "./simulation";
import type { Simulation } from "./types";

export * from "./types";

export function createSimulation(): Simulation {
  return new MatterSimulation();
}
