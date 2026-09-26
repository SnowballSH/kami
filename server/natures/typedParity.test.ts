// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ruleOn } from "../../src/cat/ruling";
import type { Nature } from "../../src/cat/types";
import { quickdrawNatureTable } from "./natureTable";

/** Categories the Eye gives a nature but a typed name deliberately leaves as plain ink. */
const PLAIN_WHEN_TYPED: Readonly<Record<string, string>> = {
  bridge: "'a bridge' is the flat shape's plain-ink guess chip, and must mean what it promised",
  bush: "no one nature a player would expect from a bush",
  "see saw": "a seesaw tips; it is not something to bounce on",
  toaster: "the Eye's pop-up joke; typed, a toaster could as well be heavy",
  yoga: "the Eye sees a pose; typed, it names nothing",
  jail: "bars are climbable only in the Eye's picture",
  "roller coaster": "the track is ground to ride, not a ladder",
  spreadsheet: "the Eye's grid joke; typed, it names nothing",
  door: "drawn keys open drawn doors; the word must stay a plain door",
  garden: "a garden is scenery, not the way out",
  lighter: "'lighter' is also the comparative of light: 'a lighter rock'",
};

const ANIMALS_MOVE = "spec: any animal goes into the nature that says how it moves";
const SPEC_LANTERN = "spec lists it under lantern; the Eye's own reading differs";

/** Categories the typed name deliberately rules differently from the Eye, and why. */
const TYPED_DIFFERENTLY: Readonly<
  Record<string, { readonly nature: Nature; readonly why: string }>
> = {
  "animal migration": {
    nature: "walker",
    why: "typed, 'animal' walks; the Eye's birds are its guess",
  },
  candle: { nature: "lantern", why: SPEC_LANTERN },
  crocodile: { nature: "walker", why: ANIMALS_MOVE },
  giraffe: { nature: "walker", why: ANIMALS_MOVE },
  hedgehog: { nature: "walker", why: `${ANIMALS_MOVE}; it flees Alice by temper` },
  lantern: { nature: "lantern", why: SPEC_LANTERN },
  "light bulb": { nature: "lantern", why: "a bulb lights the night, as 'bulb' does" },
  rhinoceros: { nature: "walker", why: `${ANIMALS_MOVE}, as 'rhino' does` },
  spider: { nature: "walker", why: ANIMALS_MOVE },
  star: { nature: "lantern", why: "a star shines; the lexicon has always lit it" },
  streetlight: { nature: "lantern", why: "street lamps and lampposts are lanterns" },
  sun: { nature: "attractor", why: "spec lists the sun under attractor" },
};

const typed = (category: string): Nature =>
  ruleOn(category, { allowed: "all", drawingIsDot: false }).nature;

const seen = quickdrawNatureTable.categories
  .map((category) => ({ category, nature: quickdrawNatureTable.describe(category).nature }))
  .filter(({ nature }) => nature !== "ink");

describe("typed names and the Eye", () => {
  it("give a nature to every name the Eye gives one, bar the deliberate exceptions", () => {
    const plain = seen
      .filter(({ category }) => typed(category) === "ink")
      .map(({ category }) => category);
    expect(plain.sort()).toEqual(Object.keys(PLAIN_WHEN_TYPED).sort());
  });

  it("agree on the nature, bar the creatures and lights the spec sorts by what they do", () => {
    const disagreements = Object.fromEntries(
      seen
        .map(({ category, nature }) => ({ category, nature, said: typed(category) }))
        .filter(({ nature, said }) => said !== "ink" && said !== nature)
        .map(({ category, said }) => [category, said]),
    );
    const allowed = Object.fromEntries(
      Object.entries(TYPED_DIFFERENTLY).map(([category, { nature }]) => [category, nature]),
    );
    expect(disagreements).toEqual(allowed);
  });
});
