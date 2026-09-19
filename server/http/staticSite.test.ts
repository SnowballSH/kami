// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createStaticSite, type SiteHandler } from "./staticSite";

describe("createStaticSite", () => {
  let root: string;
  let site: SiteHandler;
  const get = (path: string, method = "GET") =>
    site(new Request(`http://kami.test${path}`, { method }));

  beforeAll(async () => {
    const base = await mkdtemp(join(tmpdir(), "kami-site-"));
    root = join(base, "dist");
    await mkdir(join(root, "assets"), { recursive: true });
    await writeFile(join(root, "index.html"), "<!doctype html><title>Kami</title>");
    await writeFile(join(root, "assets", "app-abc123.js"), "console.log('kami')");
    await writeFile(join(base, "secret.txt"), "not yours");
    site = createStaticSite(root);
  });

  afterAll(() => rm(join(root, ".."), { recursive: true, force: true }));

  it("serves the app shell at / and for board URLs", async () => {
    for (const path of ["/", "/?board=wonderland", "/some/deep/link"]) {
      const response = await get(path);
      expect(response?.headers.get("content-type")).toContain("text/html");
      expect(await response?.text()).toContain("Kami");
    }
  });

  it("serves hashed assets as immutable", async () => {
    const response = await get("/assets/app-abc123.js");
    expect(response?.headers.get("content-type")).toContain("javascript");
    expect(response?.headers.get("cache-control")).toContain("immutable");
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
    expect(await get("/", "POST")).toBeNull();
  });
});
