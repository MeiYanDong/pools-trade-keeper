import { describe, expect, it } from "vitest";
import { selectRoundRobin } from "../src/discovery/round-robin.js";

describe("round-robin inventory scheduling", () => {
  it("advances instead of rescanning the same prefix", () => {
    const ids = ["1", "2", "3", "4", "5"];
    const first = selectRoundRobin(ids, 0, 2);
    const second = selectRoundRobin(ids, first.nextIndex, 2);
    expect(first).toEqual({ selected: ["1", "2"], nextIndex: 2 });
    expect(second).toEqual({ selected: ["3", "4"], nextIndex: 4 });
  });

  it("wraps at the end of the inventory", () => {
    expect(selectRoundRobin(["1", "2", "3"], 2, 3)).toEqual({
      selected: ["3", "1", "2"],
      nextIndex: 2,
    });
  });
});
