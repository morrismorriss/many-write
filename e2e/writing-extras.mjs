// End-to-end check of essays (MLA and Chicago), Works Cited / Bibliography,
// book scene breaks, text-message bubbles, the copyright page, archiving from
// the binder and theme background pictures. Usage as for smoke.mjs.

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const { chromium } = createRequire(import.meta.url)("playwright");

const URL = process.env.MW_URL ?? "http://localhost:1420";
const DIR = process.env.MW_E2E_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), "mw-e2e-"));
const SHOTS = process.env.MW_SHOTS ?? "e2e/out";
fs.mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1480, height: 920 }, deviceScaleFactor: Number(process.env.MW_DPR ?? 1) });
page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
page.on("dialog", (d) => d.accept());
const type = (t) => page.keyboard.type(t, { delay: 4 });
const api = (cmd, args) =>
  page.evaluate(([c, a]) => fetch(`/api/${c}`, { method: "POST", headers: { "X-Many-Write": "1" }, body: JSON.stringify(a) }).then((r) => r.json()).then((j) => j.value), [cmd, args]);
const pageText = async (i) => (await api("typst.pageText", { index: i })) ?? "";
const pageCount = async () => {
  const label = await page.getByTestId("page-label").innerText();
  return Number(label.match(/of (\d+)/)?.[1] ?? label.match(/\/\s*(\d+)/)?.[1] ?? 1);
};
const editor = page.getByTestId("editor");

async function newProject(template, title, author, extra) {
  await page.goto(URL);
  await page.getByTestId("new-project").click();
  await page.getByTestId(`tmpl-${template}`).click();
  if (extra) await extra();
  await page.getByTestId("new-title").fill(title);
  await page.getByLabel("Author").fill(author);
  await page.getByTestId("new-location").fill(DIR);
  await page.getByTestId("create-project").click();
  await editor.waitFor();
  return path.join(DIR, title);
}

async function openSettings() {
  await page.getByTestId("file-btn").click();
  await page.getByText("Project settings…").click();
  await page.getByRole("dialog", { name: "Project settings" }).waitFor();
}
const saveSettings = () => page.getByRole("dialog", { name: "Project settings" }).getByRole("button", { name: "Save" }).click();

/** Apply a block type from the slash menu on a fresh empty line. */
async function slash(filter) {
  await type("/" + filter);
  await sleep(150);
  await page.keyboard.press("Enter");
}

// ---- MLA essay
let root = await newProject("essay", "On Rivers", "Ada Lovelace", async () => {
  ok(await page.getByTestId("essay-style").isVisible(), "choosing Essay shows the MLA / Chicago choice");
  await page.getByTestId("style-mla").click();
});
const worksCited = path.join(root, "back-matter/01-works-cited.md");
ok(fs.existsSync(worksCited) && fs.readFileSync(worksCited, "utf8") === "", "MLA essay starts with an empty Works Cited page (the example source is grey hint text)");
ok(JSON.parse(fs.readFileSync(path.join(root, "project.json"), "utf8")).settings.essayStyle === "mla", "style saved in project.json");
await openSettings();
await page.getByTestId("essay-instructor").fill("Professor Byron");
await page.getByTestId("essay-course").fill("English 101");
await saveSettings();
await editor.click();
for (let i = 0; i < 6; i++) {
  await type("The river runs past the town and the people watch it go by, every single day of the year, in rain and in sun. ".repeat(3));
  await page.keyboard.press("Enter");
}
await sleep(2500);
let first = await pageText(0);
ok(first.startsWith("Lovelace 1"), `MLA running head: "${first.slice(0, 20)}"`);
ok(first.includes("Professor Byron") && first.includes("English 101") && first.includes("On Rivers"), "MLA heading block and title on page 1");
let n = await pageCount();
ok((await pageText(n - 1)).includes("Works Cited"), "Works Cited typeset on the last page");
await page.screenshot({ path: path.join(SHOTS, "essay-mla.png") });
await page.getByTestId("binder-Works Cited").click();
await sleep(1500);
await page.screenshot({ path: path.join(SHOTS, "essay-works-cited.png") });

// ---- Chicago essay
root = await newProject("essay", "Bridges", "Grace Hopper", () => page.getByTestId("style-chicago").click());
ok(fs.existsSync(path.join(root, "back-matter/01-bibliography.md")), "Chicago essay starts with a Bibliography page");
await editor.click();
await type("Bridges were built to last. ".repeat(20));
await sleep(2500);
first = await pageText(0);
ok(first.startsWith("Bridges") && !/^\d/.test(first), "Chicago title page, unnumbered");
ok((await pageText(1)).trim().startsWith("2"), "first text page is numbered 2");
await page.screenshot({ path: path.join(SHOTS, "essay-chicago.png") });

// ---- Book: centred chapter title, bubbles, scene breaks
root = await newProject("book", "Hearts", "Morgan Writer");
ok(await page.getByTestId("doc-title").evaluate((el) => getComputedStyle(el).textAlign === "center"), "chapter title is centred in the editor");
await editor.click();
await type("She looked at her phone.");
await page.keyboard.press("Enter");
await slash("text message (left");
await type("Are you up?");
await page.keyboard.press("Enter");
await type("Hello?");
await page.keyboard.press("Enter");
await slash("text message (right");
await type("Yes. Why?");
await page.keyboard.press("Enter");
await page.keyboard.press("Enter");
await slash("scene break");
await page.keyboard.press("Enter");
await type("The next morning.");
await sleep(2500);
const chapter = fs.readFileSync(path.join(root, "manuscript/01-chapter-1.md"), "utf8");
ok(chapter.includes("> [!text-left] Are you up?\n\n> [!text-left] Hello?\n\n> [!text-right] Yes. Why?"), "bubbles saved as > [!text-left] / > [!text-right]");
ok((await page.locator(".el-text_right").evaluate((el) => getComputedStyle(el).marginLeft)) !== "0px", "right bubble sits on the right in the editor");
await openSettings();
await page.getByTestId("break-hearts").click();
await saveSettings();
await sleep(2500);
ok((await pageText((await pageCount()) - 1)).includes("♥"), "hearts scene break typeset");
ok((await page.locator(".el-scene_break").first().evaluate((el) => getComputedStyle(el, "::before").content)).includes("♥"), "editor shows the hearts too");
await page.screenshot({ path: path.join(SHOTS, "book-bubbles-hearts.png") });
await openSettings();
const chooser = page.waitForEvent("filechooser");
await page.getByTestId("break-image").click();
await (await chooser).setFiles(path.resolve("assets/icon.png"));
await sleep(500);
await saveSettings();
await sleep(2500);
const settings = JSON.parse(fs.readFileSync(path.join(root, "project.json"), "utf8")).settings;
ok(settings.sceneBreak === "image" && fs.existsSync(path.join(root, settings.sceneBreakImage)), "custom scene break picture copied into the project");
ok((await page.locator(".el-scene_break").first().evaluate((el) => getComputedStyle(el, "::before").backgroundImage)).startsWith('url("data:image/png'), "editor shows the picture");
await page.screenshot({ path: path.join(SHOTS, "book-break-picture.png") });

// ---- Copyright page
await page.getByTestId("add-doc-front").click();
await page.getByTestId("preset-Copyright").click();
await page.getByRole("dialog", { name: "Copyright page" }).waitFor();
await page.screenshot({ path: path.join(SHOTS, "copyright-dialog.png") });
await page.getByTestId("clause-fiction").check();
await page.getByTestId("clause-moral").check();
await page.getByTestId("copyright-create").click();
await sleep(1500);
const copyright = fs.readFileSync(path.join(root, "front-matter", fs.readdirSync(path.join(root, "front-matter"))[0]), "utf8");
ok(copyright.startsWith(`Copyright © ${new Date().getFullYear()} by Morgan Writer`), "copyright notice uses the author");
ok(copyright.includes("All rights reserved.") && copyright.includes("entirely a work of fiction") && copyright.includes("Morgan Writer asserts the moral right"), "chosen clauses added");
ok(!copyright.includes("Designations"), "unticked clauses left out");

// ---- Character page template
await page.getByTestId("add-doc-characters").click();
await sleep(1200);
const chars = path.join(root, "characters");
ok(fs.readFileSync(path.join(chars, fs.readdirSync(chars)[0]), "utf8") === "", "a new character page starts empty");

// ---- Archive button
await page.getByTestId("binder-Chapter 1").hover();
await page.getByTestId("archive-Chapter 1").click();
await sleep(1500);
ok(fs.existsSync(path.join(root, "archive")) && fs.readdirSync(path.join(root, "archive")).some((f) => f.includes("chapter-1")), "archive button moves the chapter into the Archive");
ok(!fs.readdirSync(path.join(root, "manuscript")).some((f) => f.includes("chapter-1")), "and out of the manuscript");

// ---- Document: bubbles
root = await newProject("document", "Chat Log", "Morgan Writer");
await editor.click();
await slash("text message (right");
await type("On my way");
await sleep(2500);
const docFile = fs.readdirSync(path.join(root, "manuscript"))[0];
ok(fs.readFileSync(path.join(root, "manuscript", docFile), "utf8").includes("> [!text-right] On my way"), "documents have text bubbles too");

// ---- Theme with a background picture
const bg = path.join(SHOTS, "bg-source.png");
const maker = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await maker.setContent(`<body style="margin:0;height:100vh;background:radial-gradient(circle at 30% 40%, #ffd6e7, transparent 55%), radial-gradient(circle at 75% 70%, #c9e4ff, transparent 50%), linear-gradient(135deg,#fff3d6,#e8f7ee)"></body>`);
await maker.screenshot({ path: bg });
await maker.close();
await page.getByTestId("theme-btn").click();
await page.getByTestId("theme-build").click();
const chooser2 = page.waitForEvent("filechooser");
await page.getByTestId("bg-choose").click();
await (await chooser2).setFiles(bg);
await page.getByTestId("bg-thumb").waitFor();
await page.getByTestId("bg-strength").fill("60");
await page.getByTestId("theme-name").fill("Garden");
await page.screenshot({ path: path.join(SHOTS, "theme-builder-picture.png") });
await page.getByTestId("save-theme").click();
await sleep(800);
const bgVar = await page.evaluate(() => document.documentElement.style.getPropertyValue("--bg-image"));
ok(bgVar.startsWith('url("data:image/'), "theme background picture applied");
await page.screenshot({ path: path.join(SHOTS, "theme-picture.png") });

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
