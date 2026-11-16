import { describe, expect, it } from "vitest";
import { emptyGoals, observe, resetToday, wordsToday } from "./goals";

describe("goals", () => {
  it("counts words written since the day began, and resets to any value", () => {
    let g = observe(emptyGoals(), 5000, "2026-11-16");
    g = observe(g, 6200, "2026-11-16");
    expect(wordsToday(g, 6200, "2026-11-16")).toBe(1200);
    g = resetToday(g, 6200, 0, "2026-11-16");
    expect(wordsToday(g, 6300, "2026-11-16")).toBe(100);
    g = resetToday(g, 6300, 2500, "2026-11-16");
    expect(wordsToday(g, 6300, "2026-11-16")).toBe(2500);
    // A new day starts from that day's first total.
    g = observe(g, 6300, "2026-11-17");
    expect(wordsToday(g, 6400, "2026-11-17")).toBe(100);
  });
});
