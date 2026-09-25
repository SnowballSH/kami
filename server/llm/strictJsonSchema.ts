import { z } from "zod";

export type JsonSchema = Readonly<Record<string, unknown>>;

const DROPPED_KEYWORDS = new Set(["$schema", "minLength", "maxLength"]);
const SCHEMA_LISTS = new Set(["anyOf", "oneOf", "allOf", "prefixItems"]);
const SCHEMA_MAPS = new Set(["properties", "$defs", "definitions"]);
const SCHEMA_VALUES = new Set(["items", "not"]);

const isSchema = (value: unknown): value is JsonSchema =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNullable = (schema: JsonSchema): boolean =>
  schema.type === "null" ||
  (Array.isArray(schema.type) && schema.type.includes("null")) ||
  (Array.isArray(schema.anyOf) &&
    schema.anyOf.some((branch) => isSchema(branch) && isNullable(branch)));

const mapValues = (
  map: JsonSchema,
  transform: (schema: JsonSchema) => JsonSchema,
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(map).map(([key, value]) => [key, isSchema(value) ? transform(value) : value]),
  );

const strictValue = (keyword: string, value: unknown): unknown => {
  if (SCHEMA_LISTS.has(keyword) && Array.isArray(value))
    return value.map((branch) => (isSchema(branch) ? strictNode(branch) : branch));
  if (SCHEMA_MAPS.has(keyword) && isSchema(value)) return mapValues(value, strictNode);
  if (SCHEMA_VALUES.has(keyword) && isSchema(value)) return strictNode(value);
  return value;
};

const closeObject = (schema: Record<string, unknown>): Record<string, unknown> => {
  const properties = isSchema(schema.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const names = Object.keys(properties);
  for (const name of names) {
    const property = properties[name];
    if (!required.has(name) && isSchema(property) && !isNullable(property))
      throw new Error(
        `strict JSON schema: optional property "${name}" must also be nullable (use .nullish())`,
      );
  }
  return { ...schema, properties, required: names, additionalProperties: false };
};

function strictNode(schema: JsonSchema): JsonSchema {
  const strict: Record<string, unknown> = {};
  for (const [keyword, value] of Object.entries(schema)) {
    if (DROPPED_KEYWORDS.has(keyword)) continue;
    const renamed = keyword === "oneOf" ? "anyOf" : keyword;
    if (renamed in strict) throw new Error(`strict JSON schema: both oneOf and anyOf on one node`);
    strict[renamed] = strictValue(keyword, value);
  }
  return schema.type === "object" ? closeObject(strict) : strict;
}

/**
 * The JSON schema of a reply for OpenAI's strict structured outputs, which take a subset of JSON
 * Schema: `anyOf` but not `oneOf`, every object closed with every property required (an optional
 * one is spelled as a nullable one), and no string-length bounds. The zod schema stays the
 * validator of what comes back, so an optional property must accept null there too; one that does
 * not is refused here, at start-up, rather than as a reply that never parses.
 */
export const strictJsonSchema = (schema: z.ZodType): JsonSchema =>
  strictNode(z.toJSONSchema(schema) as JsonSchema);
