import type { NoteId } from "../notes/types";
import type { Rule, WorldPhysics } from "../rules/types";

/** Laws by the note that wrote them, in the order the notes were written. */
export const groupedByNote = (
  rules: readonly Rule[],
): ReadonlyMap<NoteId, readonly [Rule, ...Rule[]]> => {
  const byNote = new Map<NoteId, [Rule, ...Rule[]]>();
  for (const rule of rules) {
    const ofNote = byNote.get(rule.noteId);
    if (ofNote === undefined) byNote.set(rule.noteId, [rule]);
    else ofNote.push(rule);
  }
  return byNote;
};

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

  /** Every law the note carried — one, or a whole scene's worth — no longer standing. */
  repealByNote(noteId: NoteId): readonly Rule[] {
    const repealed = this.rules.filter((candidate) => candidate.noteId === noteId);
    if (repealed.length > 0) this.rules = this.rules.filter((rule) => rule.noteId !== noteId);
    return repealed;
  }

  replaceAll(rules: readonly Rule[]): void {
    this.rules = [...rules];
  }
}
