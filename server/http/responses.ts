import type { z } from "zod";
import { INPUT_LIMITS } from "../../src/core/inputLimits";
import { BodyTooLargeError, readBoundedText } from "../../src/core/readBody";

export const json = (body: unknown, status = 200): Response => Response.json(body, { status });

export const ok = (): Response => json({ ok: true });

export const audio = (body: ArrayBuffer, contentType = "audio/mpeg"): Response =>
  new Response(body, { headers: { "content-type": contentType } });

export const preflight = (): Response => new Response(null, { status: 204 });

export const badRequest = (error: string, issues: readonly string[] = []): Response =>
  json({ error, issues }, 400);

export const notFound = (): Response => json({ error: "not found" }, 404);

export const notImplemented = (error: string): Response => json({ error }, 501);

export const busy = (error: string, retryAfterSeconds = 1): Response =>
  new Response(JSON.stringify({ error }), {
    status: 503,
    headers: { "content-type": "application/json", "retry-after": String(retryAfterSeconds) },
  });

export const serverError = (): Response => json({ error: "internal error" }, 500);

const describeIssues = (error: z.ZodError): readonly string[] =>
  error.issues.map((issue) => `${issue.path.join(".") || "(body)"}: ${issue.message}`);

export type Parsed<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly response: Response };

export const parseWith = <Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
  what: string,
): Parsed<z.output<Schema>> => {
  const result = schema.safeParse(input);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, response: badRequest(`invalid ${what}`, describeIssues(result.error)) };
};

export const parseJsonBody = async <Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
  maxBytes: number = INPUT_LIMITS.sketchBytes,
): Promise<Parsed<z.output<Schema>>> => {
  const text = await parseTextBody(request, maxBytes);
  if (!text.ok) return text;
  try {
    const body: unknown = JSON.parse(text.value);
    return parseWith(schema, body, "body");
  } catch {
    return { ok: false, response: badRequest("body is not JSON") };
  }
};

export const parseTextBody = async (
  request: Request,
  maxBytes: number,
): Promise<Parsed<string>> => {
  try {
    return { ok: true, value: await readBoundedText(request, maxBytes) };
  } catch (error) {
    return {
      ok: false,
      response:
        error instanceof BodyTooLargeError
          ? json({ error: error.message }, 413)
          : badRequest("body could not be read"),
    };
  }
};
