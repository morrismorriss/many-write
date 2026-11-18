import { describe, expect, it } from "vitest";
import { isSafeId, isSafeNotesPath, isSafeSegment, nodePath, type ProjectFile } from "./model";
import { normalizeData } from "./store";
import { getTemplate, TEMPLATES } from "../formats/templates";

describe("project.json paths stay inside the project", () => {
  it("accepts plain names and refuses anything that leaves the folder", () => {
    for (const ok of ["01-scene-1.md", "Act One", "café.md", ".trash-ish"]) expect(isSafeSegment(ok), ok).toBe(true);
    for (const bad of ["", ".", "..", "../x.md", "a/b.md", "a\\b.md", "/etc/passwd", "C:x.md", "C:\\x", "x\0.md", 3, null]) expect(isSafeSegment(bad), String(bad)).toBe(false);
    expect(isSafeNotesPath("notes/scene-1-abc123.md")).toBe(true);
    for (const bad of ["notes/../../x.md", "../notes/x.md", "/notes/x.md", "notes/a/b.md", "notes/x.txt"]) expect(isSafeNotesPath(bad), bad).toBe(false);
  });

  it("accepts plain ids and refuses ids that could steer a path", () => {
    for (const ok of ["abc123", "n-1", "café"]) expect(isSafeId(ok), ok).toBe(true);
    for (const bad of ["", ".", "..", "a/b", "a\\b", "../x", 3, null, undefined, "x".repeat(129)]) expect(isSafeId(bad), String(bad)).toBe(false);
  });

  it("rewrites hostile binder entries when a project is loaded", () => {
    const data = {
      title: "Evil",
      template: "stage-play",
      binder: [
        {
          id: "m",
          kind: "folder",
          title: "Manuscript",
          role: "manuscript",
          file: "../../outside",
          children: [
            { id: "a", kind: "doc", title: "Scene", file: "../../../.bashrc", notes: "../../.ssh/config" },
            { id: "b", kind: "doc", title: "Abs", file: "/etc/passwd" },
            { id: "c", kind: "doc", title: "Fine", file: "01-fine.md", notes: "notes/fine-c.md" },
          ],
        },
      ],
    } as unknown as ProjectFile;
    const d = normalizeData(data);
    for (const id of ["a", "b", "c"]) {
      const p = nodePath(d, id)!;
      expect(p.split("/").every((seg) => seg !== ".." && seg !== ""), p).toBe(true);
      expect(p.startsWith("manuscript/"), p).toBe(true);
    }
    expect(nodePath(d, "a")).toBe("manuscript/scene.md");
    const nodes = d.binder.find((n) => n.role === "manuscript")!.children!;
    expect(nodes[0].notes).toBeUndefined();
    expect(nodes[2].notes).toBe("notes/fine-c.md");
  });

  it("replaces an id that could steer a path, and drops an icon that is not a segment", () => {
    const data = {
      title: "Evil",
      template: "stage-play",
      binder: [
        {
          id: "m",
          kind: "folder",
          title: "Manuscript",
          role: "manuscript",
          file: "manuscript",
          children: [
            { id: "../../../../etc/evil", kind: "doc", title: "Scene", file: "s.md", icon: "a/b" },
            { id: "a/b", kind: "doc", title: "Other", file: "o.md", icon: "scene" },
          ],
        },
      ],
    } as unknown as ProjectFile;
    const d = normalizeData(data);
    const nodes = d.binder.find((n) => n.role === "manuscript")!.children!;
    for (const n of nodes) {
      expect(isSafeId(n.id), n.id).toBe(true);
      expect(n.id).not.toContain("/");
    }
    // An icon that is not a plain segment is dropped; a real one survives.
    expect(nodes[0].icon).toBeUndefined();
    expect(nodes[1].icon).toBe("scene");
  });
});

describe("prototype keys in project.json", () => {
  it("falls back to a real template for an inherited key", () => {
    for (const id of ["constructor", "__proto__", "toString", "valueOf", "hasOwnProperty"]) {
      const d = normalizeData({ title: "Evil", template: id, binder: [] } as unknown as ProjectFile);
      expect(d.template, id).toBe("stage-play");
      const t = getTemplate(d.template);
      expect(t.elements.length, id).toBeGreaterThan(0);
      expect(t.mode, id).toBe("script");
    }
  });

  it("getTemplate never returns a prototype member", () => {
    for (const id of ["constructor", "__proto__", "toString", "watch", "not-a-template"]) {
      const t = getTemplate(id);
      expect(t).toBe(TEMPLATES["stage-play"]);
      expect(Array.isArray(t.elements)).toBe(true);
    }
    expect(getTemplate("book")).toBe(TEMPLATES.book);
  });
});
