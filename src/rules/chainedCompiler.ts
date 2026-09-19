import type { CompiledRule, RuleCompiler } from "./types";

const attempt = async (compiler: RuleCompiler, text: string): Promise<CompiledRule | null> => {
  try {
    return await compiler.compile(text);
  } catch {
    return null;
  }
};

export class ChainedRuleCompiler implements RuleCompiler {
  readonly #compilers: readonly RuleCompiler[];

  constructor(compilers: readonly RuleCompiler[]) {
    this.#compilers = [...compilers];
  }

  async compile(text: string): Promise<CompiledRule | null> {
    for (const compiler of this.#compilers) {
      const rule = await attempt(compiler, text);
      if (rule !== null) return rule;
    }
    return null;
  }
}
