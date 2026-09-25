// @vitest-environment node
import { describe, expect, it } from "vitest";
import { checkEyeHealth, describeEye } from "./health";
import type { FetchLike } from "./types";

const SIDECAR = "http://127.0.0.1:8790";

const healthy: FetchLike = async (url) =>
  url === `${SIDECAR}/health`
    ? Response.json({ ok: true, classes: 345, model: "resnet18-64" })
    : Response.json({ error: "not found" }, { status: 404 });

const down: FetchLike = async () => {
  throw new TypeError("connection refused");
};

describe("checkEyeHealth", () => {
  it("reads the model and class count from /health", async () => {
    const health = await checkEyeHealth({ url: SIDECAR }, healthy);
    expect(health).toEqual({ model: "resnet18-64", classes: 345 });
    expect(describeEye(health)).toBe("eye: resnet18-64 (345 classes)");
  });

  it("shows the sidecar's bearer token when it has one", async () => {
    const seen: Headers[] = [];
    const guarded: FetchLike = async (_url, init) => {
      seen.push(new Headers(init?.headers));
      return Response.json({ ok: true, classes: 345, model: "resnet18-64" });
    };
    await checkEyeHealth({ url: SIDECAR, apiKey: "eye-key" }, guarded);
    await checkEyeHealth({ url: SIDECAR }, guarded);
    expect(seen[0]?.get("authorization")).toBe("Bearer eye-key");
    expect(seen[1]?.has("authorization")).toBe(false);
  });

  it("is null when nothing listens or the answer is not a health report", async () => {
    expect(await checkEyeHealth({ url: SIDECAR }, down)).toBeNull();
    expect(
      await checkEyeHealth({ url: SIDECAR }, async () => Response.json({ ok: false })),
    ).toBeNull();
    expect(describeEye(null)).toBe("eye: not running, using k-NN");
  });
});
