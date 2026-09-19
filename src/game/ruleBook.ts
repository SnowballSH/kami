import type { NoteId } from "../notes/types";
import type { Rule, WorldPhysics } from "../rules/types";

/** The standing laws of the current board. */
export class RuleBook {
  private rules: readonly Rule[] = [];

  constructor(private readonly resolve: (rules: readonly Rule[]) => WorldPhysics) {}

  get physics(): WorldPhysics {
    return this.resolve(this.rules);
  }

  get all(): readonly Rule[] {
    return this.rules;
  }

  enact(rule: Rule): void {
    this.rules = [...this.rules, rule];
  }

  repealByNote(noteId: NoteId): Rule | null {
    const rule = this.rules.find((candidate) => candidate.noteId === noteId) ?? null;
    if (rule !== null) this.rules = this.rules.filter((candidate) => candidate !== rule);
    return rule;
  }

  replaceAll(rules: readonly Rule[]): void {
    this.rules = [...rules];
  }
}
