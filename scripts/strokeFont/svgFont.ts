export interface SvgGlyph {
  readonly unicode: string;
  readonly advance: number;
  readonly pathData: string;
}

export interface SvgFont {
  readonly family: string;
  readonly unitsPerEm: number;
  readonly ascent: number;
  readonly descent: number;
  readonly glyphs: readonly SvgGlyph[];
  /** The `Key: value` lines of the file's `<metadata>` block, in order. */
  readonly metadata: ReadonlyMap<string, string>;
}

type Attributes = ReadonlyMap<string, string>;

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  apos: "'",
  quot: '"',
  lt: "<",
  gt: ">",
};

const ENTITY = /&(#x[0-9a-fA-F]+|#\d+|\w+);/g;
const ATTRIBUTE = /([\w-]+)\s*=\s*"([^"]*)"/g;
const METADATA_LINE = /^([^:]+):\s+(.+)$/;

const decodeEntity = (entity: string, body: string): string => {
  if (body.startsWith("#x")) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
  if (body.startsWith("#")) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
  return NAMED_ENTITIES[body] ?? entity;
};

export const decodeXmlEntities = (text: string): string => text.replace(ENTITY, decodeEntity);

const attributesOf = (element: string): Attributes =>
  new Map(
    [...element.matchAll(ATTRIBUTE)].map(([, name = "", value = ""]) => [
      name,
      decodeXmlEntities(value),
    ]),
  );

const elementsNamed = (svg: string, tag: string): Attributes[] =>
  [...svg.matchAll(new RegExp(`<${tag}\\s[^>]*>`, "g"))].map(([element]) => attributesOf(element));

const requiredNumber = (attributes: Attributes, name: string): number => {
  const value = Number(attributes.get(name));
  if (!Number.isFinite(value)) throw new Error(`svg font: missing numeric attribute "${name}"`);
  return value;
};

const metadataOf = (svg: string): Map<string, string> => {
  const block = /<metadata>([\s\S]*?)<\/metadata>/.exec(svg)?.[1] ?? "";
  return new Map(
    block
      .split("\n")
      .map((line) => METADATA_LINE.exec(line.trim()))
      .filter((match) => match !== null)
      .map(([, key = "", value = ""]) => [key.trim(), decodeXmlEntities(value.trim())]),
  );
};

export const parseSvgFont = (svg: string): SvgFont => {
  const [font] = elementsNamed(svg, "font");
  const [face] = elementsNamed(svg, "font-face");
  if (font === undefined || face === undefined) throw new Error("svg font: no <font> found");
  const defaultAdvance = requiredNumber(font, "horiz-adv-x");
  return {
    family: face.get("font-family") ?? font.get("id") ?? "",
    unitsPerEm: requiredNumber(face, "units-per-em"),
    ascent: requiredNumber(face, "ascent"),
    descent: requiredNumber(face, "descent"),
    metadata: metadataOf(svg),
    glyphs: elementsNamed(svg, "glyph").map((glyph) => ({
      unicode: glyph.get("unicode") ?? "",
      advance: glyph.has("horiz-adv-x") ? requiredNumber(glyph, "horiz-adv-x") : defaultAdvance,
      pathData: glyph.get("d") ?? "",
    })),
  };
};
