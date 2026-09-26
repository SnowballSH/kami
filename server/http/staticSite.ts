import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const INDEX_DOCUMENT = "index.html";
const IMMUTABLE_ASSETS = `${sep}assets${sep}`;
const IMMUTABLE = "public, max-age=31536000, immutable";
const REVALIDATE = "no-cache";
const MIN_COMPRESSIBLE_BYTES = 1024;
const MAX_CACHED_FILES = 512;
const GZIP_LEVEL = 6;
const BROTLI_QUALITY = 6;

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

const COMPRESSIBLE = new Set([".html", ".js", ".css", ".json", ".svg", ".webmanifest"]);

type Encoding = "br" | "gzip";

type Bytes = Uint8Array<ArrayBuffer>;

const ENCODINGS: readonly Encoding[] = ["br", "gzip"];

const compress: Readonly<Record<Encoding, (body: Bytes) => Bytes>> = {
  br: (body) =>
    new Uint8Array(
      brotliCompressSync(body, {
        params: {
          [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
          [constants.BROTLI_PARAM_SIZE_HINT]: body.byteLength,
        },
      }),
    ),
  gzip: (body) => new Uint8Array(gzipSync(body, { level: GZIP_LEVEL })),
};

interface CachedFile {
  readonly body: Bytes;
  readonly etag: string;
  readonly mtimeMs: number;
  readonly contentType: string;
  readonly compressible: boolean;
  readonly encoded: Map<Encoding, Bytes>;
}

export type SiteHandler = (request: Request) => Promise<Response | null>;

const fileWithin = (root: string, pathname: string): string | null => {
  const wanted = normalize(join(root, decodeURIComponent(pathname)));
  return wanted === root || wanted.startsWith(root + sep) ? wanted : null;
};

/** The encodings the client will take, best first; `br` is smaller, `gzip` is everywhere. */
export const acceptedEncodings = (acceptEncoding: string | null): readonly Encoding[] => {
  if (acceptEncoding === null) return [];
  const accepted = new Set<string>();
  for (const part of acceptEncoding.split(",")) {
    const [token, ...parameters] = part
      .trim()
      .split(";")
      .map((piece) => piece.trim());
    const refused = parameters.some((parameter) => /^q=0(\.0+)?$/.test(parameter));
    if (token !== undefined && token !== "" && !refused) accepted.add(token.toLowerCase());
  }
  return ENCODINGS.filter((encoding) => accepted.has(encoding));
};

/**
 * Serves the built game from `directory`; any path that is not a file gets the app shell. Files are
 * read once and kept in memory with their compressed forms, so a small box spends no disk or zlib
 * time on the second visitor. Hashed assets are immutable for a year; everything else revalidates
 * with an ETag and answers 304 when the browser already has it.
 */
export const createStaticSite = (directory: string): SiteHandler => {
  const root = resolve(directory);
  const cache = new Map<string, CachedFile>();

  const remember = (path: string, file: CachedFile): CachedFile => {
    cache.delete(path);
    if (cache.size >= MAX_CACHED_FILES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(path, file);
    return file;
  };

  const load = async (path: string): Promise<CachedFile | null> => {
    const immutable = path.includes(IMMUTABLE_ASSETS);
    const cached = cache.get(path);
    if (cached !== undefined && immutable) return cached;
    try {
      const { mtimeMs, size, isFile } = await stat(path).then((info) => ({
        mtimeMs: info.mtimeMs,
        size: info.size,
        isFile: info.isFile(),
      }));
      if (!isFile) return null;
      if (cached !== undefined && cached.mtimeMs === mtimeMs && cached.body.byteLength === size) {
        return cached;
      }
      const body = new Uint8Array(await readFile(path));
      const extension = extname(path);
      return remember(path, {
        body,
        etag: `"${size.toString(16)}-${Math.trunc(mtimeMs).toString(16)}"`,
        mtimeMs,
        contentType: CONTENT_TYPES[extension] ?? "application/octet-stream",
        compressible: COMPRESSIBLE.has(extension) && size >= MIN_COMPRESSIBLE_BYTES,
        encoded: new Map(),
      });
    } catch {
      return null;
    }
  };

  const encodedBody = (file: CachedFile, encoding: Encoding): Bytes => {
    const held = file.encoded.get(encoding);
    if (held !== undefined) return held;
    const compressed = compress[encoding](file.body);
    file.encoded.set(encoding, compressed);
    return compressed;
  };

  const respond = (request: Request, path: string, file: CachedFile): Response => {
    const headers = new Headers({
      "content-type": file.contentType,
      "cache-control": path.includes(IMMUTABLE_ASSETS) ? IMMUTABLE : REVALIDATE,
      etag: file.etag,
    });
    if (file.compressible) headers.set("vary", "accept-encoding");
    if (request.headers.get("if-none-match") === file.etag) {
      return new Response(null, { status: 304, headers });
    }
    const encoding = file.compressible
      ? acceptedEncodings(request.headers.get("accept-encoding"))[0]
      : undefined;
    const body = encoding === undefined ? file.body : encodedBody(file, encoding);
    if (encoding !== undefined) headers.set("content-encoding", encoding);
    headers.set("content-length", String(body.byteLength));
    return new Response(request.method === "HEAD" ? null : body, { headers });
  };

  return async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") return null;
    let path: string | null;
    try {
      path = fileWithin(root, new URL(request.url).pathname);
    } catch {
      return null;
    }
    if (path === null) return null;
    const isAsset = extname(path) !== "";
    if (isAsset) {
      const file = await load(path);
      return file === null ? null : respond(request, path, file);
    }
    const shellPath = join(root, INDEX_DOCUMENT);
    const shell = await load(shellPath);
    return shell === null ? null : respond(request, shellPath, shell);
  };
};
