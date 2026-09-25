/**
 * Which optional fields a chat-completions request carries. Servers that reject one say so with a
 * 400; the shape then loses one feature at a time, in an order that gives up the least first:
 * structured output before reasoning control, the token-limit spelling and the temperature last.
 */
export const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export type ResponseFormatMode = "json_schema" | "json_object" | "none";

export type TokenLimitField = "max_tokens" | "max_completion_tokens";

export interface RequestShape {
  /** Send `reasoning_effort` (the configured level). */
  readonly reasoning: boolean;
  readonly responseFormat: ResponseFormatMode;
  readonly tokenLimit: TokenLimitField;
  /** Send `temperature: 0`; the gpt-5 family accepts only the default. */
  readonly temperature: boolean;
}

export const DEFAULT_REQUEST_SHAPE: RequestShape = {
  reasoning: true,
  responseFormat: "json_schema",
  tokenLimit: "max_tokens",
  temperature: true,
};

interface Feature {
  /** Field names an error message would mention when this feature is the problem. */
  readonly fields: readonly string[];
  /** The shape with one step less of this feature, or null when there is nothing left to drop. */
  readonly degrade: (shape: RequestShape) => RequestShape | null;
}

const NEXT_RESPONSE_FORMAT: Readonly<Record<ResponseFormatMode, ResponseFormatMode | null>> = {
  json_schema: "json_object",
  json_object: "none",
  none: null,
};

const FEATURES: readonly Feature[] = [
  {
    fields: ["response_format", "json_schema"],
    degrade: (shape) => {
      const responseFormat = NEXT_RESPONSE_FORMAT[shape.responseFormat];
      return responseFormat === null ? null : { ...shape, responseFormat };
    },
  },
  {
    fields: ["reasoning_effort"],
    degrade: (shape) => (shape.reasoning ? { ...shape, reasoning: false } : null),
  },
  {
    fields: ["max_tokens"],
    degrade: (shape) =>
      shape.tokenLimit === "max_tokens" ? { ...shape, tokenLimit: "max_completion_tokens" } : null,
  },
  {
    fields: ["temperature"],
    degrade: (shape) => (shape.temperature ? { ...shape, temperature: false } : null),
  },
];

const mentions = (errorBody: string, field: string): boolean =>
  new RegExp(`(^|[^a-z_])${field}([^a-z_]|$)`, "i").test(errorBody);

/**
 * The shape to try after a 400: the feature the error names when it names one we send, otherwise
 * the next in order. Null when every optional feature is already gone — the request itself is bad.
 */
export const degradeAfterRejection = (
  shape: RequestShape,
  errorBody: string,
): RequestShape | null => {
  const blamed = FEATURES.find((feature) =>
    feature.fields.some((field) => mentions(errorBody, field)),
  );
  const fromBlame = blamed?.degrade(shape) ?? null;
  if (fromBlame !== null) return fromBlame;
  for (const feature of FEATURES) {
    const next = feature.degrade(shape);
    if (next !== null) return next;
  }
  return null;
};

export const isReasoningEffort = (value: string): value is ReasoningEffort =>
  (REASONING_EFFORTS as readonly string[]).includes(value);

/** `off` means never send the field; anything else must be one of the known levels. */
export const parseReasoningEffort = (value: string, variable: string): ReasoningEffort | null => {
  const level = value.trim().toLowerCase();
  if (level === "off") return null;
  if (isReasoningEffort(level)) return level;
  throw new Error(
    `${variable} must be one of ${REASONING_EFFORTS.join(", ")} or off, not "${value}"`,
  );
};
