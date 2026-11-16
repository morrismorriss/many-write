import { describe, expect, it } from "vitest";
import { calendarWeek, emptyGoals, firstDayOfWeek, observe, resetToday, wordsToday } from "./goals";

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

  it("shows the calendar week the computer uses, across a month end", () => {
    const g = observe(emptyGoals(), 100, "2026-12-01");
    // Tuesday 1 December 2026; Monday-first week.
    const mon = calendarWeek(g, new Date(2026, 11, 1), 1);
    expect(mon.map((d) => d.key)).toEqual(["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06"]);
    expect(mon.map((d) => d.date.getDay())).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(mon[1].today && !mon[1].future && mon[2].future).toBe(true);
    // Sunday-first week.
    const sun = calendarWeek(g, new Date(2026, 11, 1), 7);
    expect(sun[0].key).toBe("2026-11-29");
    expect(sun[0].date.getDay()).toBe(0);
    // On a Sunday with a Monday-first week, Sunday is the last day shown.
    expect(calendarWeek(g, new Date(2026, 11, 6), 1)[6].today).toBe(true);
  });

  it("knows which day weeks start on", () => {
    expect(firstDayOfWeek("en-US")).toBe(7);
    expect(firstDayOfWeek("en-GB")).toBe(1);
    expect(firstDayOfWeek("de-DE")).toBe(1);
  });
});
