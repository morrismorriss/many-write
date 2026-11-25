import { describe, expect, it } from "vitest";
import type { Block } from "./markdown";
import type { ManuscriptItem } from "./typst";
import { buildReport, castListNames, formatEighths, measureScenes, pageLabels, parseSlug, reportCsv, reportTypst, sceneList, scenesOf } from "./report";

const b = (type: Block["type"], text: string, sim?: number): Block => ({ type, runs: [{ text }], ...(sim !== undefined ? { sim } : {}) });
const doc = (id: string, title: string, blocks: Block[]): ManuscriptItem => ({ kind: "doc", id, title, blocks });

describe("scene headings", () => {
  it("reads interior/exterior, location and time", () => {
    expect(parseSlug("INT. KITCHEN - NIGHT")).toEqual({ ie: "INT", location: "KITCHEN", time: "NIGHT" });
    expect(parseSlug("ext. the old pier – dawn")).toEqual({ ie: "EXT", location: "THE OLD PIER", time: "DAWN" });
    expect(parseSlug("INT./EXT. ANNA'S CAR - MOVING - DAY")).toEqual({ ie: "INT/EXT", location: "ANNA'S CAR - MOVING", time: "DAY" });
    expect(parseSlug("I/E TRAIN - CONTINUOUS #12#")).toEqual({ ie: "INT/EXT", location: "TRAIN", time: "CONTINUOUS" });
    expect(parseSlug("INTERVIEW ROOM")).toEqual({ ie: "", location: "INTERVIEW ROOM", time: "" });
    expect(parseSlug("MONTAGE - SUMMER")).toEqual({ ie: "", location: "MONTAGE - SUMMER", time: "" });
  });
});

describe("scenes", () => {
  const screenplay: ManuscriptItem[] = [
    { kind: "matter", id: "cast", title: "Cast", blocks: [b("paragraph", "ANNA, a teacher")], where: "front" },
    doc("s1", "Scene 1", [
      b("scene_heading", "INT. KITCHEN - NIGHT"),
      b("action", "ANNA stirs a pot. BEN watches from the door. A DOG sleeps."),
      b("character", "ANNA"),
      b("dialogue", "You're late again."),
      b("character", "ANNA (CONT'D)"),
      b("parenthetical", "(not looking up)"),
      b("dialogue", "Sit down."),
      b("scene_heading", "EXT. GARDEN - DAY"),
      b("character", "BEN"),
      b("dialogue", "Where did she go?"),
      b("character", "CARA", 0),
      b("dialogue", "Out.", 0),
      b("character", "ANNA", 1),
      b("dialogue", "Out there.", 1),
    ]),
    doc("s2", "Scene 2", [b("action", "Annabel arrives. Nobody notices ANNABEL.")]),
    doc("empty", "Scene 3", [b("action", "")]),
  ];

  it("splits documents at scene headings and names untitled scenes after their document", () => {
    const sc = scenesOf(screenplay);
    expect(sc.map((s) => [s.number, s.docId, s.start, s.end, s.heading])).toEqual([
      [1, "s1", 0, 7, "INT. KITCHEN - NIGHT"],
      [2, "s1", 7, 14, "EXT. GARDEN - DAY"],
      [3, "s2", 0, 1, "Scene 2"],
    ]);
  });

  it("counts speeches and words per speaker, column by column", () => {
    const [one, two] = scenesOf(screenplay);
    expect(Object.fromEntries(one.speakers)).toEqual({ ANNA: { speeches: 2, words: 5 } });
    expect(Object.fromEntries(two.speakers)).toEqual({ BEN: { speeches: 1, words: 4 }, CARA: { speeches: 1, words: 1 }, ANNA: { speeches: 1, words: 2 } });
  });

  it("finds characters named in capitals in the action without speaking", () => {
    const [one, , three] = scenesOf(screenplay);
    expect([...one.silent]).toEqual(["BEN"]);
    // "ANNA" inside "ANNABEL" is not Anna, and mixed case is not a mention.
    expect([...three.silent]).toEqual([]);
  });

  it("builds the cast, locations and day/night split", () => {
    const r = buildReport(screenplay, true);
    expect(r.cast.map((c) => [c.name, c.speeches, c.words, c.speaking, c.silent, c.scenes])).toEqual([
      ["ANNA", 3, 7, 2, 0, [1, 2]],
      ["BEN", 1, 4, 1, 1, [1, 2]],
      ["CARA", 1, 1, 1, 0, [2]],
    ]);
    expect(r.locations.map((l) => [l.location, l.ie, l.times, l.scenes])).toEqual([
      ["GARDEN", ["EXT"], ["DAY"], [2]],
      ["KITCHEN", ["INT"], ["NIGHT"], [1]],
    ]);
    expect(r.split).toEqual({ int: 1, ext: 1, both: 0, day: 1, night: 1, other: 0 });
  });

  it("numbers scenes from 1 in each play of a collection, under their acts", () => {
    const items: ManuscriptItem[] = [
      { kind: "play", id: "p1", title: "Morning" },
      { kind: "folder", id: "a1", title: "Act One", depth: 1 },
      doc("x", "Scene 1", [b("character", "ANNA"), b("dialogue", "Hi.")]),
      doc("y", "Scene 2", [b("character", "BEN"), b("dialogue", "Bye.")]),
      { kind: "play", id: "p2", title: "Evening" },
      { kind: "folder", id: "a2", title: "Act One", depth: 1 },
      doc("z", "Scene 1", [b("character", "ANNA"), b("dialogue", "Again.")]),
    ];
    const r = buildReport(items, false);
    expect(r.scenes.map((s) => [s.play, s.act, s.number])).toEqual([
      ["Morning", "Act One", 1],
      ["Morning", "Act One", 2],
      ["Evening", "Act One", 1],
    ]);
    const plot = reportCsv(r, "plot").trim().split("\r\n");
    expect(plot).toEqual(["Character,Morning 1,Morning 2,Evening 1", "ANNA,S,,S", "BEN,,S,"]);
    expect(r.locations).toEqual([]);
  });
});

describe("cast list", () => {
  const items: ManuscriptItem[] = [
    {
      kind: "matter",
      id: "c",
      title: "Cast of characters",
      where: "front",
      blocks: [b("paragraph", "ANNA, thirties, a teacher."), b("paragraph", "THE GHOST - silent throughout"), b("paragraph", "MR. FINCH: a neighbour"), b("paragraph", "Time: the present."), b("paragraph", "NOBODY")],
    },
    doc("s", "Scene 1", [b("direction", "ANNA reads. THE GHOST crosses behind her."), b("character", "ANNA"), b("dialogue", "Who's there?")]),
  ];

  it("reads names in capitals at the start of each line", () => {
    expect(castListNames(items)).toEqual(["ANNA", "THE GHOST", "MR. FINCH", "NOBODY"]);
  });

  it("finds silent characters from the cast list and keeps those who never appear", () => {
    const r = buildReport(items, false);
    expect([...r.scenes[0].silent]).toEqual(["THE GHOST"]);
    expect(r.cast.map((c) => [c.name, c.speaking, c.silent])).toEqual([
      ["ANNA", 1, 0],
      ["THE GHOST", 0, 1],
      ["MR. FINCH", 0, 0],
      ["NOBODY", 0, 0],
    ]);
  });
});

describe("pages", () => {
  it("prints front matter unnumbered and starts the script at 1", () => {
    const ids = ["cast#0", "s1#0", "s1#1", "s2#0"];
    expect(pageLabels(4, ids, [2, 3, 4, 4], (d) => d === "cast")).toEqual(["1", null, "1", "2"]);
  });

  it("restarts at 1 for each play of a collection", () => {
    const ids = ["p1#-1", "a#0", "b#0", "p2#-1", "c#0"];
    const front = (d: string) => d.startsWith("p");
    expect(pageLabels(5, ids, [1, 2, 3, 4, 5], front)).toEqual([null, "1", "2", null, "1"]);
  });

  it("follows locked pages and A-pages in production mode", () => {
    const ids = ["s#0", "s#1", "s#2", "s#3"];
    const locks = new Map([
      ["s#0", { page: 1, hard: true }],
      ["s#1", { page: 2, hard: true, letter: 1 }],
      ["s#3", { page: 3, hard: true }],
    ]);
    // Page 2 was rewritten (2A) and ran onto another page (2B).
    expect(pageLabels(5, ids, [2, 3, 4, 5], () => false, locks)).toEqual(["1", "1", "2A", "2B", "3"]);
  });

  it("measures scene length in eighths of a page", () => {
    const items = [doc("d", "S", [b("scene_heading", "INT. A - DAY"), b("action", "x"), b("scene_heading", "INT. B - DAY"), b("action", "y")])];
    const scenes = scenesOf(items);
    // A 792pt page has a 648pt text area. Scene 1 takes a quarter of page 1;
    // scene 2 runs from halfway down page 1 to a quarter down page 2.
    measureScenes(scenes, {
      ids: ["d#0", "d#1", "d#2", "d#3"],
      first: [1, 1, 1, 2],
      last: [1, 1, 1, 2],
      tops: [82, 100, 406, 0],
      bottoms: [82, 72 + 162 - 3, 406, 72 + 162 - 3],
      pageHeight: 792,
      labels: ["1", "2"],
    });
    expect(scenes.map((s) => s.pages)).toEqual([
      { first: "1", last: "1", eighths: 2 },
      { first: "1", last: "2", eighths: 6 },
    ]);
  });
});

describe("formatting", () => {
  it("writes eighths the way schedules do", () => {
    expect([1, 8, 11, 16, 3].map(formatEighths)).toEqual(["1/8", "1", "1 3/8", "2", "3/8"]);
  });

  it("collapses runs of scene numbers", () => {
    expect(sceneList([1, 2, 3, 5, 7, 8])).toEqual("1–3, 5, 7–8");
  });

  it("quotes CSV cells that need it", () => {
    const r = buildReport([doc("d", "S", [b("scene_heading", 'INT. "THE BAR", LATER - NIGHT'), b("character", "ANNA"), b("dialogue", "Hi.")])], true);
    expect(reportCsv(r, "scenes").split("\r\n")[1]).toBe('1,,"INT. ""THE BAR"", LATER - NIGHT",INT,"""THE BAR"", LATER",NIGHT,,,ANNA,');
  });

  it("escapes text in the Typst source", () => {
    const r = buildReport([doc("d", "S", [b("scene_heading", 'INT. A "B" \\ C - DAY'), b("character", "ANNA"), b("dialogue", "Hi.")])], true);
    const src = reportTypst(r, { title: 'My "Play"', author: "", paper: "us-letter" }, "today");
    expect(src).toContain('"A \\"B\\" \\\\ C"');
    expect(src).toContain('"My \\"Play\\""');
    expect(src).toContain("= Locations");
  });
});
