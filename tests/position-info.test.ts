import { describe, expect, it } from "vitest";
import { decodePositionTicks, encodeTicksForTest } from "../src/protocol/position-info.js";

describe("PositionInfo packing", () => {
  it("decodes positive and negative int24 ticks at deployed offsets", () => {
    const packed = encodeTicksForTest(-887220, 887220);
    expect(decodePositionTicks(packed)).toEqual({ tickLower: -887220, tickUpper: 887220 });
  });

  it("ignores the low subscriber byte", () => {
    const packed = encodeTicksForTest(-60, 120) | 1n;
    expect(decodePositionTicks(packed)).toEqual({ tickLower: -60, tickUpper: 120 });
  });
});
