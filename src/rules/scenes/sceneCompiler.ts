import type { Scene, SceneCompiler } from "../types";
import { placeCalled } from "./atlas";
import { destinationOf } from "./travel";

/**
 * "Teleport us to the moon": the atlas answers for the places it knows; anywhere else is put to
 * `farther` (a model, when there is one) with the whole sentence. Words that ask to go nowhere
 * are nobody's business here.
 */
export class AtlasSceneCompiler implements SceneCompiler {
  constructor(private readonly farther: SceneCompiler | null = null) {}

  async compile(text: string): Promise<Scene | null> {
    const where = destinationOf(text);
    if (where === null) return null;
    return placeCalled(where) ?? (await this.farther?.compile(text)) ?? null;
  }
}
