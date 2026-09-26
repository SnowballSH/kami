// @vitest-environment node
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acceptedEncodings, createStaticSite, type SiteHandler } from "./staticSite";

const BIG_SCRIPT = `console.log('kami');\n${"const padding = 'the same line again';\n".repeat(200)}`;

describe("createStaticSite", () => {
  let root: string;
  let site: SiteHandler;
  const get = (path: string, init: RequestInit = {}) =>
    site(new Request(`http://kami.test${path}`, init));

  beforeAll(async () => {
    const base = await mkdtemp(join(tmpdir(), "kami-site-"));
    root = join(base, "dist");
    await mkdir(join(root, "assets"), { recursive: true });
    await writeFile(join(root, "index.html"), "<!doctype html><title>Kami</title>");
    await writeFile(join(root, "assets", "app-abc123.js"), BIG_SCRIPT);
    await writeFile(join(root, "assets", "tiny-abc123.js"), "1");
    await writeFile(join(root, "favicon.png"), Buffer.alloc(4096, 7));
    await writeFile(join(base, "secret.txt"), "not yours");
    site = createStaticSite(root);
  });

  afterAll(() => rm(join(root, ".."), { recursive: true, force: true }));

  it("serves the app shell at / and for board URLs", async () => {
    for (const path of ["/", "/?board=wonderland", "/some/deep/link"]) {
      const response = await get(path);
      expect(response?.headers.get("content-type")).toContain("text/html");
      expect(response?.headers.get("cache-control")).toBe("no-cache");
      expect(await response?.text()).toContain("Kami");
    }
  });

  it("serves files when the directory is given with a trailing slash", async () => {
    const slashed = createStaticSite(`${root}/`);
    const response = await slashed(new Request("http://kami.test/assets/app-abc123.js"));
    expect(response?.headers.get("content-type")).toContain("javascript");
  });

  it("serves hashed assets as immutable", async () => {
    const response = await get("/assets/app-abc123.js");
    expect(response?.headers.get("content-type")).toContain("javascript");
    expect(response?.headers.get("cache-control")).toContain("immutable");
  });

  it("compresses text the client can take, brotli before gzip, and varies on it", async () => {
    const brotli = await get("/assets/app-abc123.js", {
      headers: { "accept-encoding": "gzip, deflate, br" },
    });
    expect(brotli?.headers.get("content-encoding")).toBe("br");
    expect(brotli?.headers.get("vary")).toBe("accept-encoding");
    expect(Number(brotli?.headers.get("content-length"))).toBeLessThan(BIG_SCRIPT.length / 4);
    expect(
      brotliDecompressSync(
        new Uint8Array((await brotli?.arrayBuffer()) ?? new ArrayBuffer(0)),
      ).toString(),
    ).toBe(BIG_SCRIPT);

    const gzip = await get("/assets/app-abc123.js", { headers: { "accept-encoding": "gzip" } });
    expect(gzip?.headers.get("content-encoding")).toBe("gzip");
    expect(
      gunzipSync(new Uint8Array((await gzip?.arrayBuffer()) ?? new ArrayBuffer(0))).toString(),
    ).toBe(BIG_SCRIPT);

    const plain = await get("/assets/app-abc123.js");
    expect(plain?.headers.has("content-encoding")).toBe(false);
    expect(await plain?.text()).toBe(BIG_SCRIPT);
  });

  it("leaves tiny files and images alone", async () => {
    const headers = { "accept-encoding": "br, gzip" };
    const tiny = await get("/assets/tiny-abc123.js", { headers });
    expect(tiny?.headers.has("content-encoding")).toBe(false);
    const image = await get("/favicon.png", { headers });
    expect(image?.headers.has("content-encoding")).toBe(false);
    expect(image?.headers.has("vary")).toBe(false);
    expect(image?.headers.get("content-type")).toBe("image/png");
  });

  it("answers 304 to a browser that already holds the file", async () => {
    const first = await get("/");
    const etag = first?.headers.get("etag") ?? "";
    expect(etag).toMatch(/^".+"$/);
    const again = await get("/", { headers: { "if-none-match": etag } });
    expect(again?.status).toBe(304);
    expect(again?.headers.get("etag")).toBe(etag);
    expect(await again?.text()).toBe("");
  });

  it("notices a rebuilt shell but never re-reads a hashed asset", async () => {
    const before = (await get("/"))?.headers.get("etag");
    await writeFile(join(root, "index.html"), "<!doctype html><title>Kami, rebuilt</title>");
    const later = new Date(Date.now() + 5_000);
    await utimes(join(root, "index.html"), later, later);
    const after = await get("/");
    expect(after?.headers.get("etag")).not.toBe(before);
    expect(await after?.text()).toContain("rebuilt");

    await writeFile(join(root, "assets", "app-abc123.js"), "changed in place");
    expect(await (await get("/assets/app-abc123.js"))?.text()).toBe(BIG_SCRIPT);
  });

  it("answers HEAD with the headers and no body", async () => {
    const response = await get("/assets/app-abc123.js", { method: "HEAD" });
    expect(response?.headers.get("content-length")).toBe(String(BIG_SCRIPT.length));
    expect(await response?.text()).toBe("");
  });

  it("answers null for a missing asset rather than the shell", async () => {
    expect(await get("/assets/gone.js")).toBeNull();
  });

  it("never reads outside its directory", async () => {
    for (const path of ["/../secret.txt", "/%2e%2e/secret.txt", "/assets/../../secret.txt"]) {
      const response = await get(path);
      expect(response === null ? "" : await response.text()).not.toContain("not yours");
    }
  });

  it("leaves writes to the API", async () => {
    expect(await get("/", { method: "POST" })).toBeNull();
  });
});

describe("acceptedEncodings", () => {
  it("reads the header the way browsers write it", () => {
    expect(acceptedEncodings(null)).toEqual([]);
    expect(acceptedEncodings("gzip, deflate, br, zstd")).toEqual(["br", "gzip"]);
    expect(acceptedEncodings("gzip;q=1.0, identity; q=0.5, *;q=0")).toEqual(["gzip"]);
    expect(acceptedEncodings("br;q=0, gzip")).toEqual(["gzip"]);
    expect(acceptedEncodings("identity")).toEqual([]);
  });
});
