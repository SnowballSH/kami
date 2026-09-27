import { same } from "../core/same";
import type { NoteId } from "../notes/types";
import type { Rule, RuleId, WorldPhysics } from "../rules/types";

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

/**
 * The standing laws of the current board, and the world they fold into over the ground they stand
 * on — whatever else the fold reads, such as the room's own world. `resolve` must depend only on
 * the rules and the ground it is given: its answer is kept until the rules change or `ground()`
 * returns a different value.
 */
export class RuleBook<Ground> {
  private rules: readonly Rule[] = [];
  private folded: { readonly ground: Ground; readonly physics: WorldPhysics } | null = null;

  constructor(
    private readonly resolve: (rules: readonly Rule[], ground: Ground) => WorldPhysics,
    private readonly ground: () => Ground,
  ) {}

  get physics(): WorldPhysics {
    const ground = this.ground();
    if (this.folded === null || this.folded.ground !== ground)
      this.folded = { ground, physics: this.resolve(this.rules, ground) };
    return this.folded.physics;
  }

  get all(): readonly Rule[] {
    return this.rules;
  }

  enact(rule: Rule): void {
    this.set([...this.rules, rule]);
  }

  /** Every law the note carried — one, or a whole scene's worth — no longer standing. */
  repealByNote(noteId: NoteId): readonly Rule[] {
    const repealed = this.rules.filter((candidate) => candidate.noteId === noteId);
    if (repealed.length > 0) this.set(this.rules.filter((rule) => rule.noteId !== noteId));
    return repealed;
  }

  /**
   * A law written elsewhere takes its place in the chronology, so every device folds the same
   * sequence; the same law again (or a corrected copy) replaces itself. Returns whether the book changed.
   */
  place(rule: Rule): boolean {
    const known = this.rules.find((candidate) => candidate.id === rule.id);
    if (known !== undefined && same(known, rule)) return false;
    const others = this.rules.filter((candidate) => candidate.id !== rule.id);
    const after = others.findIndex((candidate) => candidate.createdAt > rule.createdAt);
    this.set(
      after === -1 ? [...others, rule] : [...others.slice(0, after), rule, ...others.slice(after)],
    );
    return true;
  }

  repeal(id: RuleId): Rule | null {
    const repealed = this.rules.find((candidate) => candidate.id === id) ?? null;
    if (repealed !== null) this.set(this.rules.filter((rule) => rule.id !== id));
    return repealed;
  }

  replaceAll(rules: readonly Rule[]): void {
    this.set([...rules]);
  }

  private set(rules: readonly Rule[]): void {
    this.rules = rules;
    this.folded = null;
  }
}
