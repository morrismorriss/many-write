import { describe, expect, it } from "vitest";
import { computeAnchors, contextKey, hashKey, lineKey, pageLabel, resolveAnchors, revisedLines, snapshotOf } from "./production";
import type { Block } from "../formats/markdown";

const b = (type: Block["type"], text: string): Block => ({ type, runs: [{ text }] });

describe("production mode", () => {
  const doc = [b("scene_heading", "Scene 1"), b("character", "ANNA"), b("dialogue", "Hello."), b("direction", "She sits."), b("character", "BEN"), b("dialogue", "Hi.")];
  const keyAt = (_d: string, i: number) => (i < 0 ? "heading" : lineKey(doc[i]));

  it("records the first line of each page, and lines split across pages", () => {
    const ids = doc.map((_, i) => `d#${i}`);
    // Physical page 1 is the title page; script pages are 2 and 3. Line 3 runs from page 2 onto 3.
    const anchors = computeAnchors(ids, [2, 2, 2, 2, 3, 3], [2, 2, 2, 3, 3, 3], keyAt, 2, 3);
    expect(anchors.map((a) => [a.page, a.index, a.split])).toEqual([
      [1, 0, false],
      [2, 3, true],
    ]);
  });

  it("locks a page that starts with an act heading to the heading", () => {
    const ids = ["act#-1", ...doc.map((_, i) => `d#${i}`)];
    // The heading's own text is not traced (first = 0) but it sits above line 0 on page 2.
    const anchors = computeAnchors(ids, [0, 2, 2, 2, 2, 3, 3], [0, 2, 2, 2, 3, 3, 3], keyAt, 2, 3);
    expect(anchors.map((a) => [a.page, a.docId, a.index])).toEqual([
      [1, "act", -1],
      [2, "d", 3],
    ]);
  });

  it("tells repeated cues apart by the speech that follows", () => {
    const script = [b("character", "ANNA"), b("dialogue", "One."), b("character", "ANNA"), b("dialogue", "Two.")];
    const anchors = [{ page: 2, docId: "d", index: 2, key: hashKey(contextKey(script, 2)), split: false }];
    // Four new lines above: the nearest "ANNA" by position is now the wrong one.
    const edited = [b("character", "ANNA"), b("dialogue", "New."), b("character", "ANNA"), b("dialogue", "Newer."), ...script];
    expect([...resolveAnchors(anchors, () => edited).keys()]).toEqual(["d#6"]);
  });

  it("keeps a lock with its line when lines are added above", () => {
    const anchors = [{ page: 2, docId: "d", index: 4, key: hashKey(contextKey(doc, 4)), split: false }];
    const edited = [doc[0], b("direction", "New line."), b("direction", "Another."), ...doc.slice(1)];
    const map = resolveAnchors(anchors, () => edited);
    expect([...map.keys()]).toEqual(["d#6"]);
  });

  it("marks only changed and added lines", () => {
    const snap = snapshotOf([{ id: "d", blocks: doc }])["d"];
    const edited = [...doc];
    edited[2] = b("dialogue", "Hello again.");
    edited.splice(4, 0, b("direction", "A pause."));
    expect([...revisedLines(snap, edited)]).toEqual([2, 4]);
  });

  it("labels added pages 12A, 12B…", () => {
    expect([pageLabel(12, 0), pageLabel(12, 1), pageLabel(12, 2), pageLabel(3, 27)]).toEqual(["12", "12A", "12B", "3AA"]);
  });
});
