import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";

const INDEX_DOCUMENT = "index.html";
const IMMUTABLE_ASSETS = `${sep}assets${sep}`;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

export type SiteHandler = (request: Request) => Promise<Response | null>;

const fileWithin = (root: string, pathname: string): string | null => {
  const wanted = normalize(join(root, decodeURIComponent(pathname)));
  return wanted === root || wanted.startsWith(root + sep) ? wanted : null;
};

const serve = async (path: string): Promise<Response | null> => {
  try {
    const body = await readFile(path);
    return new Response(body, {
      headers: {
        "content-type": CONTENT_TYPES[extname(path)] ?? "application/octet-stream",
        "cache-control": path.includes(IMMUTABLE_ASSETS)
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      },
    });
  } catch {
    return null;
  }
};

/** Serves the built game from `directory`; any path that is not a file gets the app shell. */
export const createStaticSite = (directory: string): SiteHandler => {
  const root = normalize(directory);
  return async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") return null;
    let file: string | null;
    try {
      file = fileWithin(root, new URL(request.url).pathname);
    } catch {
      return null;
    }
    if (file === null) return null;
    const isAsset = extname(file) !== "";
    return (
      (isAsset ? await serve(file) : null) ?? (isAsset ? null : serve(join(root, INDEX_DOCUMENT)))
    );
  };
};
