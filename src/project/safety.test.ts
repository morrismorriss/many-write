import { describe, expect, it } from "vitest";
import { isSafeNotesPath, isSafeSegment, nodePath, type ProjectFile } from "./model";
import { normalizeData } from "./store";

describe("project.json paths stay inside the project", () => {
  it("accepts plain names and refuses anything that leaves the folder", () => {
    for (const ok of ["01-scene-1.md", "Act One", "café.md", ".trash-ish"]) expect(isSafeSegment(ok), ok).toBe(true);
    for (const bad of ["", ".", "..", "../x.md", "a/b.md", "a\\b.md", "/etc/passwd", "C:x.md", "C:\\x", "x\0.md", 3, null]) expect(isSafeSegment(bad), String(bad)).toBe(false);
    expect(isSafeNotesPath("notes/scene-1-abc123.md")).toBe(true);
    for (const bad of ["notes/../../x.md", "../notes/x.md", "/notes/x.md", "notes/a/b.md", "notes/x.txt"]) expect(isSafeNotesPath(bad), bad).toBe(false);
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
});
