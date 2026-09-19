import type { WorldEdit, WorldFacts } from "../world/types";
import { NO_SPELL_LINE, SPELLBOOK } from "./spellbook";
import type { Decree } from "./types";

const CLAUSE_BREAK = /[;,!\n]+|\.(?!\d)|\b(?:and|then|also)\b/;

export const normalizeSpell = (text: string): string =>
  text
    .toLowerCase()
    .replace(/²/g, "^2")
    .replace(/[×]/g, "x")
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .trim();

const castClause = (clause: string, facts: WorldFacts): Decree | null => {
  for (const spell of SPELLBOOK) {
    const match = clause.match(spell.pattern);
    if (match === null) continue;
    const edits = spell.cast(match, facts);
    if (edits.length > 0) return { edits, line: spell.line };
  }
  return null;
};

/** The scripted Cat's whole understanding of words aimed at the world. */
export const decree = (text: string, facts: WorldFacts): Decree => {
  const clauses = normalizeSpell(text)
    .split(CLAUSE_BREAK)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
  const edits: WorldEdit[] = [];
  let line = NO_SPELL_LINE;
  for (const clause of clauses) {
    const cast = castClause(clause, facts);
    if (cast === null) continue;
    edits.push(...cast.edits);
    line = cast.line;
  }
  return { edits, line };
};
