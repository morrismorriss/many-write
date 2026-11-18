import { describe, expect, it } from "vitest";
import { BINDER_ICONS } from "./icons";

// BINDER_ICONS keys are stored in project.json, which may be shared or hand-edited.
// A key inherited from Object.prototype must never be treated as a real icon
// (its `.Icon` would be undefined and React would blank the binder).
describe("binder icon lookup", () => {
  it("has no inherited key, so a lookup can only find a real icon", () => {
    for (const key of ["constructor", "__proto__", "toString", "valueOf", "hasOwnProperty"]) {
      expect(Object.hasOwn(BINDER_ICONS, key), key).toBe(false);
    }
    // The guarded lookup the Binder uses.
    const lookup = (key: string) => (Object.hasOwn(BINDER_ICONS, key) ? BINDER_ICONS[key] : undefined);
    for (const key of ["constructor", "__proto__", "toString"]) expect(lookup(key), key).toBeUndefined();
    expect(lookup("scene")?.Icon).toBeTruthy();
  });
});
