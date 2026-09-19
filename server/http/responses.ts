import type { z } from "zod";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, PUT, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
} as const;

export const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: CORS_HEADERS });

export const ok = (): Response => json({ ok: true });

export const preflight = (): Response => new Response(null, { status: 204, headers: CORS_HEADERS });

export const badRequest = (error: string, issues: readonly string[] = []): Response =>
  json({ error, issues }, 400);

export const notFound = (): Response => json({ error: "not found" }, 404);

export const notImplemented = (error: string): Response => json({ error }, 501);

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
): Promise<Parsed<z.output<Schema>>> => {
  const body: unknown = await request.json().catch(() => undefined);
  return body === undefined
    ? { ok: false, response: badRequest("body is not JSON") }
    : parseWith(schema, body, "body");
};
