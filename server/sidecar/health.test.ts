// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { FetchLike } from "../recognition/types";
import { fetchSidecarCapabilities } from "./health";

const SIDECAR = { url: "http://127.0.0.1:8790/" };

const answering =
  (body: unknown, status = 200): FetchLike =>
  async (url) =>
    url === "http://127.0.0.1:8790/health"
      ? Response.json(body, { status })
      : Response.json({ error: "no route" }, { status: 404 });

describe("fetchSidecarCapabilities", () => {
  it("reads what the sidecar can do", async () => {
    const both = { ok: true, capabilities: { eye: true, handwriting: true }, classes: 345 };
    expect(await fetchSidecarCapabilities(SIDECAR, answering(both))).toEqual({
      eye: true,
      handwriting: true,
    });
  });

  it("takes a sidecar from before handwriting for an Eye alone", async () => {
    const legacy = { ok: true, classes: 345, model: "kami-eye" };
    expect(await fetchSidecarCapabilities(SIDECAR, answering(legacy))).toEqual({
      eye: true,
      handwriting: false,
    });
  });

  it("is null for anything but a health report", async () => {
    expect(await fetchSidecarCapabilities(SIDECAR, answering({ ok: false }))).toBeNull();
    expect(await fetchSidecarCapabilities(SIDECAR, answering({ ok: true }, 503))).toBeNull();
    const down: FetchLike = async () => {
      throw new TypeError("connection refused");
    };
    expect(await fetchSidecarCapabilities(SIDECAR, down)).toBeNull();
  });
});
