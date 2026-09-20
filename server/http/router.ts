import type { ApiAccess } from "./access";
import { badRequest, notFound, preflight, serverError } from "./responses";

export type HttpMethod = "GET" | "PUT" | "POST" | "DELETE";

export type PathParams<Path extends string> = Path extends `${string}:${infer Param}/${infer Rest}`
  ? Param | PathParams<Rest>
  : Path extends `${string}:${infer Param}`
    ? Param
    : never;

export interface RouteContext<Path extends string> {
  readonly request: Request;
  readonly params: Readonly<Record<PathParams<Path>, string>>;
}

export type RouteHandler<Path extends string> = (
  context: RouteContext<Path>,
) => Response | Promise<Response>;

interface Route {
  readonly method: HttpMethod;
  readonly segments: readonly string[];
  readonly respond: (
    request: Request,
    params: Record<string, string>,
  ) => Response | Promise<Response>;
}

const PARAM_PREFIX = ":";

const segmentsOf = (path: string): readonly string[] =>
  path.split("/").filter((segment) => segment.length > 0);

const matchSegments = (
  pattern: readonly string[],
  actual: readonly string[],
): Record<string, string> | null => {
  if (pattern.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (const [index, expected] of pattern.entries()) {
    const segment = actual[index] ?? "";
    if (expected.startsWith(PARAM_PREFIX)) {
      params[expected.slice(PARAM_PREFIX.length)] = decodeURIComponent(segment);
    } else if (expected !== segment) {
      return null;
    }
  }
  return params;
};

export class Router {
  readonly #routes: Route[] = [];

  constructor(private readonly access?: ApiAccess) {}

  on<Path extends string>(method: HttpMethod, path: Path, handler: RouteHandler<Path>): this {
    this.#routes.push({
      method,
      segments: segmentsOf(path),
      respond: (request, params) =>
        handler({ request, params: params as Record<PathParams<Path>, string> }),
    });
    return this;
  }

  readonly handle = async (request: Request): Promise<Response> => {
    return this.access === undefined
      ? this.#route(request)
      : this.access.handle(request, this.#route);
  };

  readonly #route = async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") return preflight();
    const actual = segmentsOf(new URL(request.url).pathname);
    try {
      for (const route of this.#routes) {
        if (route.method !== request.method) continue;
        const params = matchSegments(route.segments, actual);
        if (params !== null) return await route.respond(request, params);
      }
      return notFound();
    } catch (error) {
      if (error instanceof URIError) return badRequest("malformed path");
      console.error(`${request.method} ${request.url} failed`, error);
      return serverError();
    }
  };
}
