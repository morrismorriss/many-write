// Characters speaking at once: "^" at the end of a cue, "/simultaneous", dragging a name to
// the side, the grid the editor lays them on, and the file convention (a caret on the joined
// cues). Usage:
//   cargo run -p manywrite-devserver &   npx vite &   node e2e/simultaneous.mjs
// Env: MW_URL (default http://localhost:1420), MW_E2E_DIR (projects folder), MW_SHOTS (screenshot folder).

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const { chromium } = createRequire(import.meta.url)("playwright");

const URL = process.env.MW_URL ?? "http://localhost:1420";
const DIR = process.env.MW_E2E_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), "mw-e2e-"));
const SHOTS = process.env.MW_SHOTS ?? "e2e/out";
fs.mkdirSync(SHOTS, { recursive: true });
fs.rmSync(path.join(DIR, "Test Duet"), { recursive: true, force: true });
fs.rmSync(path.join(DIR, "Test Drag"), { recursive: true, force: true });
fs.rmSync(path.join(DIR, "Test Move"), { recursive: true, force: true });
fs.rmSync(path.join(DIR, "Test Drop"), { recursive: true, force: true });
fs.rmSync(path.join(DIR, "Test Cut"), { recursive: true, force: true });

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) failures++;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1480, height: 920 }, deviceScaleFactor: Number(process.env.MW_DPR ?? 1) });
page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));

const type = async (text) => page.keyboard.type(text, { delay: 5 });
const pill = async () => (await page.getByTestId("type-pill").innerText()).trim();
// Every line of a row carries a column: the two halves of the page start at grid lines 1 and 31.
const columns = () =>
  page.$$eval(".mw-editor > p[data-sim]", (ps) =>
    ps.filter((p) => !p.className.includes("is-empty")).map((p) => getComputedStyle(p).gridColumnStart),
  );
// No two lines may sit on top of each other, and a cue must stand above its own dialogue.
const layout = () =>
  page.$$eval(".mw-editor > p", (ps) => {
    const rows = ps
      .map((p) => ({ text: p.textContent.replace("⠿", "").trim(), box: p.getBoundingClientRect() }))
      .filter((r) => r.text);
    const overlapping = [];
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i].box;
        const b = rows[j].box;
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) {
          overlapping.push(`${rows[i].text}/${rows[j].text}`);
        }
      }
    }
    const at = (text) => rows.find((r) => r.text === text)?.box;
    const order = [["ANNA", "Left."], ["BEN", "Right."]].every(([cue, line]) => (at(cue) && at(line) ? at(cue).top < at(line).top : true));
    return { overlapping, order };
  });

const newProject = async (title) => {
  await page.goto(URL);
  await page.getByTestId("new-project").click();
  await page.getByTestId("tmpl-stage-play").click();
  await page.getByTestId("new-title").fill(title);
  await page.getByTestId("new-location").fill(DIR);
  await page.getByTestId("create-project").click();
  await page.getByTestId("editor").waitFor();
  await page.getByTestId("editor").click();
  await page.keyboard.press("Control+End");
};

// ---- a caret at the end of a cue joins it to the speaker above
await newProject("Test Duet");
await type("Scene 1");
await page.keyboard.press("Enter");
await type("A quay at dawn.");
await page.keyboard.press("Enter");
await type("Anna");
await page.keyboard.press("Enter");
await type("Left.");
await page.keyboard.press("Enter");
await type("Ben");
await type("^");
ok((await pill()) === "Character", "^ keeps the line a cue");
let cols = await columns();
ok(cols.join() === "1,1,31", `the joined cue moves to the right half (${cols.join(", ")})`);
await page.keyboard.press("Enter");
ok((await pill()) === "Dialogue", "Enter under a joined cue writes its dialogue");
await type("Right.");
cols = await columns();
ok(cols.join() === "1,1,31,31", `its dialogue stays in the right column (${cols.join(", ")})`);
let laid = await layout();
ok(laid.overlapping.length === 0, `no line is printed over another (${laid.overlapping.join(", ") || "clean"})`);
ok(laid.order, "each cue stands above its own dialogue");
await page.keyboard.press("Enter");
ok((await pill()) === "Character", "the next cue is a line of its own again");

// ---- "/simultaneous" does the same, from the slash menu
await type("Cy");
await page.keyboard.press("Enter");
await type("Third.");
await page.keyboard.press("Enter");
await type("Dee");
await type(" /simultaneous");
ok((await page.locator(".popup-menu[data-kind=slash]").innerText()).toLowerCase().includes("together"), "/simultaneous is offered");
await page.keyboard.press("Enter");
ok((await pill()) === "Character", "/simultaneous keeps the line a cue");
await page.keyboard.press("Enter");
await type("Fourth.");
await page.keyboard.press("Enter");
await type("Eve");
await type("^");
await page.keyboard.press("Enter");
await type("Fifth.");
cols = await columns();
ok(cols.join() === "1,1,31,31,1,1,21,21,41,41", `a third speaker makes a row of three, evenly spread, under the pair above (${cols.join(", ")})`);
laid = await layout();
ok(laid.overlapping.length === 0, `the row of three does not overlap (${laid.overlapping.join(", ") || "clean"})`);
await page.screenshot({ path: path.join(SHOTS, "simultaneous-rows.png") });

await page.waitForTimeout(1200);
const duet = fs.readFileSync(path.join(DIR, "Test Duet", "manuscript", "01-act-one", "01-scene-1.md"), "utf8");
ok(/^ANNA\nLeft\.$/m.test(duet), "the first speaker stays plain in the file");
ok(/^BEN \^\nRight\.$/m.test(duet), "the second speaker is marked with a caret");
ok(/^DEE \^\nFourth\.$/m.test(duet), "and so is the third");

// ---- dragging a name to the side of another name
await newProject("Test Drag");
await type("Scene 1");
await page.keyboard.press("Enter");
await type("A quay at dawn.");
await page.keyboard.press("Enter");
await type("Anna");
await page.keyboard.press("Enter");
await type("Left.");
await page.keyboard.press("Enter");
await type("Ben");
await page.keyboard.press("Enter");
await type("Right.");
const anna = page.locator(".ProseMirror p.el-character", { hasText: /ANNA/i }).first();
const ben = page.locator(".ProseMirror p.el-character", { hasText: /BEN/i }).first();
const target = await anna.boundingBox();
await ben.hover();
const grip = await ben.locator(".mw-grip").boundingBox();
ok(!!grip, "a grip appears beside the character name");
await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
await page.mouse.down();
// Dropping on the name itself is the gesture people try first.
await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
ok((await page.locator(".mw-drop-side").count()) === 1, "the line it would join is highlighted while dragging");
await page.screenshot({ path: path.join(SHOTS, "simultaneous-drag.png") });
await page.mouse.up();
cols = await columns();
ok(cols.join() === "1,1,31,31", `dropping onto the name shares the line (${cols.join(", ")})`);
laid = await layout();
ok(laid.overlapping.length === 0, `and nothing overlaps after the drag (${laid.overlapping.join(", ") || "clean"})`);

await page.waitForTimeout(1200);
const drag = fs.readFileSync(path.join(DIR, "Test Drag", "manuscript", "01-act-one", "01-scene-1.md"), "utf8");
ok(/^BEN \^\nRight\.$/m.test(drag), "and the file records it");

// ---- the edge of a name moves the cue instead of pairing it
await newProject("Test Move");
await type("Scene 1");
await page.keyboard.press("Enter");
await type("A quay at dawn.");
await page.keyboard.press("Enter");
await type("Anna");
await page.keyboard.press("Enter");
await type("Left.");
await page.keyboard.press("Enter");
await type("Ben");
await page.keyboard.press("Enter");
await type("Right.");
const annaAgain = page.locator(".mw-editor > p.el-character", { hasText: /ANNA/i }).first();
const benAgain = page.locator(".mw-editor > p.el-character", { hasText: /BEN/i }).first();
const top = await annaAgain.boundingBox();
await benAgain.hover();
const gripAgain = await benAgain.locator(".mw-grip").boundingBox();
await page.mouse.move(gripAgain.x + gripAgain.width / 2, gripAgain.y + gripAgain.height / 2);
await page.mouse.down();
await page.mouse.move(top.x + top.width / 2, top.y + 2, { steps: 8 });
ok((await page.locator(".mw-drop-before").count()) === 1, "the top edge of a name offers a move, not a column");
await page.mouse.up();
await page.waitForTimeout(1200);
const moved = fs.readFileSync(path.join(DIR, "Test Move", "manuscript", "01-act-one", "01-scene-1.md"), "utf8");
ok(/^BEN\nRight\.\n\nANNA$/m.test(moved), "the cue moves above the other speaker");

// ---- taking a speaker out closes the row up
const selectLines = async (first, last) => {
  const a = await page.locator(".mw-editor > p", { hasText: first }).first().boundingBox();
  const b = await page.locator(".mw-editor > p", { hasText: last }).first().boundingBox();
  await page.mouse.move(a.x + 60, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width - 6, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
};
const sims = () => page.$$eval(".mw-editor > p.el", (ps) => ps.filter((p) => !p.className.includes("is-empty")).map((p) => p.dataset.sim ?? "-"));

await newProject("Test Drop");
for (const step of ["Scene 1", "ENTER", "A quay at dawn.", "ENTER", "Anna", "ENTER", "Left.", "ENTER", "Ben", "^", "ENTER", "Right."]) {
  if (step === "ENTER") await page.keyboard.press("Enter");
  else await type(step);
}
await selectLines(/BEN/i, /Right\./);
await page.keyboard.press("Delete");
await page.waitForTimeout(1200);
ok((await sims()).every((s) => s === "-"), `the singer left behind goes back to a plain, full-width cue (${(await sims()).join(", ")})`);
ok((await columns()).length === 0, "no line keeps a column");
const cut = fs.readFileSync(path.join(DIR, "Test Drop", "manuscript", "01-act-one", "01-scene-1.md"), "utf8");
ok(/^ANNA\nLeft\.$/m.test(cut) && !cut.includes("^"), "and the file has no caret left");

await newProject("Test Cut");
for (const step of ["Scene 1", "ENTER", "A quay at dawn.", "ENTER", "Anna", "ENTER", "Left.", "ENTER", "Ben", "^", "ENTER", "Right.", "ENTER", "Cy", "^", "ENTER", "Middle."]) {
  if (step === "ENTER") await page.keyboard.press("Enter");
  else await type(step);
}
ok((await columns()).join() === "1,1,21,21,41,41", "three singers stand in three columns");
await selectLines(/BEN/i, /Right\./);
await page.keyboard.press("Delete");
await page.waitForTimeout(1200);
ok((await columns()).join() === "1,1,31,31", `the two who are left share the row evenly (${(await columns()).join(", ")})`);
const reflowed = fs.readFileSync(path.join(DIR, "Test Cut", "manuscript", "01-act-one", "01-scene-1.md"), "utf8");
ok(/^ANNA\nLeft\.\n\nCY \^$/m.test(reflowed), "the third singer is marked with the caret it now needs");

await browser.close();
console.log(failures ? `${failures} check(s) failed` : "All simultaneous checks passed");
process.exit(failures ? 1 : 0);
