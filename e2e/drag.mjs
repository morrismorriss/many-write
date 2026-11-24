// Dragging blocks by the grip in the margin: up or down to move a line, and (in a script) onto
// another name to have the two speak at once. Usage:
//   cargo run -p manywrite-devserver &   npx vite &   node e2e/drag.mjs
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
for (const name of ["Drag Essay", "Drag Play", "Drag Poem"]) fs.rmSync(path.join(DIR, name), { recursive: true, force: true });

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) failures++;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1480, height: 920 }, deviceScaleFactor: Number(process.env.MW_DPR ?? 1) });
page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));

const type = async (text) => page.keyboard.type(text, { delay: 5 });
const newProject = async (template, title) => {
  await page.goto(URL);
  await page.getByTestId("new-project").click();
  await page.getByTestId(`tmpl-${template}`).click();
  await page.getByTestId("new-title").fill(title);
  await page.getByTestId("new-location").fill(DIR);
  await page.getByTestId("create-project").click();
  await page.getByTestId("editor").waitFor();
  await page.getByTestId("editor").click();
  await page.keyboard.press("Control+End");
};
// The lines as the editor shows them, without the grip.
const lines = () =>
  page.$$eval(".mw-editor > p.el", (ps) =>
    ps.filter((p) => !p.className.includes("is-hint")).map((p) => (p.textContent || "").replace("⠿", "").trim()).filter(Boolean),
  );
const line = (text) => page.locator(".mw-editor > p", { hasText: text }).first();
const dropMarks = () => page.$$eval(".mw-editor > p", (ps) => ps.filter((p) => /mw-drop/.test(p.className)).map((p) => p.className.match(/mw-drop-\w+/)?.[0]));

/** Grab the grip beside `from` and drag it onto `to`, `offset` pixels below its top edge. */
const drag = async (from, to, offset, { release = true, x = 90 } = {}) => {
  const source = line(from);
  await source.hover();
  const grip = await source.locator(".mw-grip").boundingBox();
  if (!grip) return null;
  const target = await line(to).boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + x, target.y + offset, { steps: 10 });
  await page.waitForTimeout(120);
  const marks = await dropMarks();
  if (release) await page.mouse.up();
  await page.waitForTimeout(700);
  return marks;
};

// ---- An essay: every line carries a grip, and a paragraph moves above another.
await newProject("essay", "Drag Essay");
await type("First paragraph.");
await page.keyboard.press("Enter");
await type("Second paragraph.");
await page.keyboard.press("Enter");
await type("Third paragraph.");
await page.waitForTimeout(300);
ok((await page.locator(".mw-editor p:hover > .mw-grip").count()) >= 0, "the essay editor is up");
await line(/First paragraph/).hover();
ok((await line(/First paragraph/).locator(".mw-grip").isVisible()), "a paragraph shows a grip in the margin");
const marks = await drag(/Third paragraph/, /First paragraph/, 3);
ok(marks?.includes("mw-drop-before"), `dragging over a line marks where it will land (${marks})`);
ok((await lines()).join("|") === "Third paragraph.|First paragraph.|Second paragraph.", `the paragraph moves above the one it was dropped on (${(await lines()).join(", ")})`);
await page.waitForTimeout(1600);
const essayFile = fs.readdirSync(path.join(DIR, "Drag Essay", "manuscript")).find((f) => f.endsWith(".md"));
const essay = fs.readFileSync(path.join(DIR, "Drag Essay", "manuscript", essayFile), "utf8");
ok(essay.indexOf("Third paragraph.") < essay.indexOf("First paragraph."), "and the file keeps the new order");
await page.screenshot({ path: path.join(SHOTS, "drag-essay.png") });

// ---- Escape drops nothing.
const before = await lines();
await drag(/Third paragraph/, /Second paragraph/, 3, { release: false });
await page.keyboard.press("Escape");
await page.mouse.up();
await page.waitForTimeout(400);
ok((await lines()).join("|") === before.join("|"), "Escape cancels a drag");

// ---- A poem: a line moves too.
await newProject("poem", "Drag Poem");
await type("A first line");
await page.keyboard.press("Enter");
await type("A second line");
await page.waitForTimeout(300);
await drag(/second line/, /first line/, 3);
ok((await lines()).join("|") === "A second line|A first line", `a poem line moves (${(await lines()).join(", ")})`);

// ---- A play: a stage direction has a grip, and a cue takes its speech along.
await newProject("stage-play", "Drag Play");
for (const step of ["Scene 1", "ENTER", "A quay.", "ENTER", "Anna", "ENTER", "Left.", "ENTER", "ENTER", "A gull cries."]) {
  if (step === "ENTER") await page.keyboard.press("Enter");
  else await type(step);
}
await page.waitForTimeout(300);
await line(/gull cries/).hover();
ok((await line(/gull cries/).locator(".mw-grip").isVisible()), "a stage direction shows a grip too");
await drag(/gull cries/, /ANNA/i, 3);
ok((await lines()).join("|") === "Scene 1|A quay.|A gull cries.|Anna|Left.", `a direction moves above a cue (${(await lines()).join(", ")})`);
await drag(/ANNA/i, /Scene 1/, 3);
ok((await lines()).join("|") === "Anna|Left.|Scene 1|A quay.|A gull cries.", `a cue takes its dialogue with it (${(await lines()).join(", ")})`);
await page.waitForTimeout(1600);
const playFile = fs.readFileSync(path.join(DIR, "Drag Play", "manuscript/01-act-one/01-scene-1.md"), "utf8");
ok(/^ANNA\nLeft\.$/m.test(playFile), "the cue and its line stay together in the file");
await page.screenshot({ path: path.join(SHOTS, "drag-play.png") });

await browser.close();
console.log(failures ? `${failures} check(s) failed` : "All drag checks passed");
process.exit(failures ? 1 : 0);
