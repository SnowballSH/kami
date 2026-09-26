import { describe, expect, it } from "vitest";
import type { Stroke } from "../core/geometry";
import { ARRIVAL_MS, RETRACE_MS } from "../ink/retrace";
import type { Drawing, DrawingId } from "../ink/types";
import type { DrawingPose } from "../sim/types";
import { InkLedger } from "./inkLedger";

const id = "drawing-1" as DrawingId;
const drawn: Stroke[] = [
  [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
  ],
];
const tidied: Stroke[] = [
  [
    { x: 0, y: 2 },
    { x: 10, y: 2 },
  ],
  [
    { x: 20, y: 0 },
    { x: 20, y: 10 },
  ],
];
const drawing: Drawing = { id, strokes: drawn, cost: 10 };
const poses: DrawingPose[] = [
  {
    id,
    pose: { origin: { x: 5, y: 0 }, position: { x: 5, y: 0 }, angle: 0, scale: 1 },
    lit: false,
  },
];

describe("InkLedger.retrace", () => {
  it("shows the tidied strokes once the ink has glided there, and keeps handing back the same ones", () => {
    const ledger = new InkLedger();
    ledger.add(drawing);
    ledger.retrace(id, tidied, 1000);

    expect(ledger.views(poses, 1000)[0]?.drawing.strokes).toEqual(drawn);
    const settled = ledger.views(poses, 1000 + RETRACE_MS)[0]?.drawing.strokes;
    expect(settled).toBe(tidied);
    expect(ledger.views(poses, 5000 + RETRACE_MS)[0]?.drawing.strokes).toBe(settled);
    expect(ledger.get(id)?.drawing.strokes).toBe(tidied);
  });

  it("tells the autopilot about the ink the body was built from, which Alice can really stand on", () => {
    const ledger = new InkLedger();
    ledger.add(drawing);
    expect(ledger.sceneInks(poses)[0]?.drawing.strokes).toBe(drawn);
    ledger.retrace(id, tidied, 1000);
    expect(ledger.sceneInks(poses)[0]?.drawing.strokes).toBe(drawn);
  });

  it("says where moving ink is settling, and stops saying so once it has settled", () => {
    const ledger = new InkLedger();
    ledger.add(drawing);
    ledger.retrace(id, tidied, 1000);
    expect(ledger.views(poses, 1100)[0]?.settling).toEqual({
      drawing: { ...drawing, strokes: tidied },
      motion: { kind: "retrace", from: drawn, startedAtMs: 1000 },
    });
    expect(ledger.views(poses, 1000 + RETRACE_MS)[0]?.settling).toBeUndefined();
  });

  it("keeps inking Kami's own drawing in when it is tidied mid-stroke, and glides a later tidy", () => {
    const ledger = new InkLedger();
    ledger.conjure(drawing, 0);
    ledger.retrace(id, tidied, ARRIVAL_MS / 2);
    expect(ledger.get(id)?.motion).toEqual({ kind: "arrival", startedAtMs: 0 });
    ledger.retrace(id, drawn, ARRIVAL_MS);
    expect(ledger.get(id)?.motion).toEqual({
      kind: "retrace",
      from: tidied,
      startedAtMs: ARRIVAL_MS,
    });
  });

  it("has nothing to retrace for ink that is gone", () => {
    expect(new InkLedger().retrace(id, tidied, 0)).toBeNull();
  });
});
