// End-to-end check of the version 1 acceptance criteria, against the real UI
// and the real core (via the dev server). Usage:
//   cargo run -p manywrite-devserver &   npx vite &   node e2e/smoke.mjs
// Env: MW_URL (default http://localhost:1420), MW_E2E_DIR (projects folder),
//      MW_CONFIG_DIR (the dev server's config folder), MW_SHOTS (screenshot folder).

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Playwright may be installed globally (require resolves NODE_PATH; ESM imports do not).
const { chromium } = createRequire(import.meta.url)("playwright");

const URL = process.env.MW_URL ?? "http://localhost:1420";
const DIR = process.env.MW_E2E_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), "mw-e2e-"));
const CONFIG = process.env.MW_CONFIG_DIR ?? ".manywrite-dev-config";
const SHOTS = process.env.MW_SHOTS ?? "e2e/out";
fs.mkdirSync(SHOTS, { recursive: true });
fs.rmSync(path.join(DIR, "Test Play"), { recursive: true, force: true });

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = path.join(DIR, "Test Play");
const scene1 = path.join(root, "manuscript/01-act-one/01-scene-1.md");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1480, height: 920 }, deviceScaleFactor: Number(process.env.MW_DPR ?? 1) });
page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
let promptAnswer = null;
page.on("dialog", (d) => (d.type() === "prompt" ? d.accept(promptAnswer ?? d.defaultValue()) : d.accept()));

const pill = () => page.getByTestId("type-pill").innerText();
const type = async (text) => page.keyboard.type(text, { delay: 5 });

// ---- 1. Create a stage play project
await page.goto(URL);
await page.getByTestId("new-project").click();
await page.getByTestId("tmpl-stage-play").click();
await page.getByTestId("new-title").fill("Test Play");
await page.getByTestId("new-location").fill(DIR);
await page.getByTestId("create-project").click();
await page.getByTestId("editor").waitFor();
ok(fs.existsSync(path.join(root, "project.json")), "project folder created with project.json");
ok(fs.existsSync(scene1), "first scene file created");

// ---- 2. Enter/Tab flow
const editor = page.getByTestId("editor");
await editor.click();
await page.keyboard.press("Control+End");
ok((await pill()).trim() === "Scene heading", "cursor starts on the scene heading");
await page.keyboard.press("Enter");
ok((await pill()).trim() === "Stage direction", "Enter after scene heading -> stage direction");
await type("A kitchen. Morning.");
await page.keyboard.press("Enter");
ok((await pill()).trim() === "Character", "Enter after direction -> character");
await type("Anna");
await page.keyboard.press("Enter");
ok((await pill()).trim() === "Dialogue", "Enter after character -> dialogue");
await type("I told you already.");
await page.keyboard.press("Enter");
ok((await pill()).trim() === "Character", "Enter after dialogue -> character");
await type("Ben");
await page.keyboard.press("Enter");
await type("(");
ok((await pill()).trim() === "Parenthetical", "typing ( on empty dialogue -> parenthetical");
await type("quietly");
await page.keyboard.press("Enter");
ok((await pill()).trim() === "Dialogue", "Enter in parenthetical -> dialogue");
await type("Did you?");
await page.keyboard.press("Enter");
ok((await pill()).trim() === "Character", "-> character");
await page.keyboard.press("Enter");
ok((await pill()).trim() === "Stage direction", "Enter on empty character -> stage direction");
await page.keyboard.press("Enter");
ok((await pill()).trim() === "Transition", "Enter on empty line again -> transition");
await page.keyboard.press("Tab");
ok((await pill()).trim() !== "Transition", "Tab overrides the type");
await page.keyboard.press("Shift+Tab");
ok((await pill()).trim() === "Transition", "Shift-Tab goes back");
await type("Blackout.");
// Character autocomplete: "AN" + Enter completes to ANNA.
await page.keyboard.press("Enter"); // -> scene heading
await type("Scene 2");
await page.keyboard.press("Enter"); // -> direction
await page.keyboard.press("Enter"); // empty direction -> transition (cycle)
await page.keyboard.press("Enter"); // -> scene heading
await page.keyboard.press("Enter"); // -> character
await type("An");
await page.keyboard.press("Enter");
await type("Hello again.");

// ---- 3. Autosave after about a second
await sleep(2400);
const saved = fs.readFileSync(scene1, "utf8");
console.log("---- scene file on disk ----\n" + saved + "----");
ok(saved.includes("ANNA\nI told you already."), "cue and dialogue saved in the convention");
ok(saved.includes("BEN\n(quietly)\nDid you?"), "parenthetical saved between cue and dialogue");
ok(saved.includes("> BLACKOUT."), "transition saved with >");
ok(saved.includes("ANNA\nHello again."), "character name autocompleted");
ok((await page.getByTestId("save-status").innerText()) === "Saved", "status shows Saved");

// ---- 4. Live preview
await sleep(800);
const label = await page.getByTestId("page-label").innerText();
ok(/Page \d+ of 2/.test(label), `preview paginates (${label})`);
ok((await page.getByTestId("orphan-status").count()) === 0, "no layout issues (the warning only appears when there is one)");
await page.screenshot({ path: path.join(SHOTS, "01-light.png") });

// ---- 5. Notes
await page.getByTestId("notes").fill("Anna is lying about the letter.");
await sleep(1600);
const proj = JSON.parse(fs.readFileSync(path.join(root, "project.json"), "utf8"));
const notesRel = proj.binder.find((r) => r.role === "manuscript").children[0].children[0].notes;
ok(notesRel && fs.readFileSync(path.join(root, notesRel), "utf8") === "Anna is lying about the letter.\n", "notes saved to their own linked file");

// ---- 6. Outside edit is detected and reloaded
fs.writeFileSync(scene1, saved.replace("Did you?", "Did you, really?"));
await sleep(3000);
ok((await editor.innerText()).includes("Did you, really?"), "outside edit reloaded into the editor");

// ---- 7. Outside edit while typing -> conflict banner, nothing overwritten
await editor.click();
await page.keyboard.press("Control+End");
await type(" Typing now");
fs.writeFileSync(scene1, fs.readFileSync(scene1, "utf8").replace("A kitchen.", "A big kitchen."));
await sleep(3000);
const banner = await page.getByTestId("conflict-banner").isVisible().catch(() => false);
const onDisk = fs.readFileSync(scene1, "utf8");
ok(banner || onDisk.includes("A big kitchen."), "clashing outside edit is never silently overwritten");
if (banner) {
  await page.getByTestId("keep-mine").click();
  await sleep(600);
  const trash = fs.readdirSync(path.join(root, ".trash"));
  ok(trash.some((f) => f.includes("outside-edit")), "the outside version was kept in .trash");
}

// ---- 8. Binder: add a scene, reorder by dragging, files renumbered
await page.getByTestId("add-doc-manuscript").click();
await sleep(800);
await page.getByTestId("binder-Act One").click();
await sleep(300);
await page.getByTestId("binder-Act One").getByTitle("New document in this folder").click();
await sleep(900);
let names = fs.readdirSync(path.join(root, "manuscript/01-act-one")).sort();
// "+" on the section adds after the selected scene, inside Act One; "+" on the folder adds at its end.
ok(names.join(",") === "01-scene-1.md,02-scene-2.md,03-scene-3.md", `new scenes land inside the act, numbered (${names})`);
const before = fs.readFileSync(path.join(root, "manuscript/01-act-one/01-scene-1.md"), "utf8");
await page.getByTestId("binder-Scene 3").dragTo(page.getByTestId("binder-Scene 1"), { targetPosition: { x: 40, y: 3 } });
await sleep(1200);
names = fs.readdirSync(path.join(root, "manuscript/01-act-one")).sort();
ok(names.join(",") === "01-scene-3.md,02-scene-1.md,03-scene-2.md", `drag reorder renames prefixes (${names})`);
ok(fs.readFileSync(path.join(root, "manuscript/01-act-one/02-scene-1.md"), "utf8") === before, "reordering never rewrote file contents");

// ---- 9. Close and reopen: nothing lost
await page.goto(`${URL}/?project=${encodeURIComponent(root)}`);
await page.getByTestId("binder-Scene 1").click();
await page.getByTestId("editor").waitFor();
await sleep(500);
const text = await page.getByTestId("editor").innerText();
ok(text.includes("I told you already.") && text.includes("Typing now"), "reopened project shows everything");

// ---- 10. Themes
for (const id of ["dark", "pink", "light"]) {
  await page.getByTestId("theme-btn").click();
  await page.getByTestId(`theme-${id}`).click();
  await sleep(250);
  if (id !== "light") await page.screenshot({ path: path.join(SHOTS, `02-${id}.png`) });
}
const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
ok(bg === "rgb(255, 255, 255)", "switching themes applies colours");
await page.getByTestId("theme-btn").click();
await page.getByTestId("theme-build").click();
await page.getByTestId("theme-name").fill("Night Ink");
await page.getByTestId("hex-background").fill("#1d2230");
await page.getByTestId("hex-sidebar").fill("#252b3b");
await page.getByTestId("hex-text").fill("#2a3040");
await sleep(150);
ok((await page.getByTestId("contrast").innerText()).includes("hard to read"), "contrast check warns about unreadable text");
await page.screenshot({ path: path.join(SHOTS, "03-theme-builder-warning.png") });
await page.getByTestId("hex-text").fill("#e8e4da");
await page.getByTestId("hex-accent").fill("#f0b45a");
await sleep(150);
ok(!(await page.getByTestId("contrast").innerText()).includes("hard to read"), "readable colours pass the check");
await page.screenshot({ path: path.join(SHOTS, "04-theme-builder.png") });
await page.getByTestId("save-theme").click();
await sleep(600);
ok(fs.existsSync(path.join(CONFIG, "themes/custom-night-ink.json")), "custom theme saved as a small file");
const panels = await page.evaluate(() => [".sidebar", ".preview-pane", ".main"].map((s) => getComputedStyle(document.querySelector(s)).backgroundColor));
ok(panels[0] === "rgb(37, 43, 59)" && panels[1] === panels[0] && panels[2] === "rgb(29, 34, 48)", `custom theme colours both side panels and the editor (${panels.join(" / ")})`);
await page.screenshot({ path: path.join(SHOTS, "05-custom-theme.png") });
await page.getByTestId("theme-btn").click();
await page.getByTestId("theme-light").click();

// ---- 11. Collapsible panels
await page.getByTestId("toggle-binder").click();
await page.getByTestId("toggle-preview").click();
await sleep(400);
ok(await page.getByTestId("toggle-binder").isVisible(), "binder arrow stays visible when collapsed");
await page.screenshot({ path: path.join(SHOTS, "06-collapsed.png") });
await page.getByTestId("toggle-binder").click();
await page.getByTestId("toggle-preview").click();
await sleep(400);

// ---- 12. Exports
const exportsDir = path.join(root, "exports");
for (const fmt of ["pdf", "docx", "fdx", "fountain", "epub"]) {
  promptAnswer = path.join(exportsDir, `Test Play.${fmt}`);
  await page.getByTestId("export-btn").click();
  await page.getByTestId(`export-${fmt}`).click();
  await sleep(1500);
  ok(fs.existsSync(promptAnswer) && fs.statSync(promptAnswer).size > 100, `exported ${fmt}`);
}
ok(fs.readFileSync(path.join(exportsDir, "Test Play.pdf")).subarray(0, 4).toString() === "%PDF", "PDF is a PDF");

// ---- 13. Plain files readable without the app
const md = fs.readFileSync(path.join(root, "manuscript/01-act-one/02-scene-1.md"), "utf8");
ok(!md.includes("{") && md.includes("ANNA"), "scene file is plain readable text");
ok(fs.readFileSync(path.join(root, "README.md"), "utf8").includes("Character cue"), "project README documents the convention");

await page.screenshot({ path: path.join(SHOTS, "07-final.png") });
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
