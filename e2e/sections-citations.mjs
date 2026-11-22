// Version 0.7: sections inside book chapters, which formats start each
// document on a new page, the new binder icons, and "/cite" citations that
// are remembered. Same environment as smoke.mjs.
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
const type = (t) => page.keyboard.type(t, { delay: 3 });
const project = (root) => JSON.parse(fs.readFileSync(path.join(root, "project.json"), "utf8"));
const section = (root, role) => project(root).binder.find((n) => n.role === role);

async function create(template, title) {
  const root = path.join(DIR, title);
  fs.rmSync(root, { recursive: true, force: true });
  await page.goto(URL);
  await page.getByTestId("new-project").click();
  await page.getByTestId(`tmpl-${template}`).click();
  await page.getByTestId("new-title").fill(title);
  await page.getByTestId("new-location").fill(DIR);
  await page.getByTestId("create-project").click();
  await page.getByTestId("editor").waitFor();
  await page.getByTestId("editor").click();
  await page.keyboard.press("Control+End");
  return root;
}

// ---- Book: sections inside a chapter
{
  const root = await create("book", "Sectioned Book");
  await type("The storm came in at noon.");
  await sleep(1300);
  await page.getByTestId("binder-Chapter 1").hover();
  await page.getByTestId("add-section-Chapter 1").click();
  await sleep(1200);
  let ms = section(root, "manuscript");
  const ch = ms.children[0];
  ok(ch.kind === "folder" && ch.chapter === true && ch.title === "Chapter 1", "the chapter became a chapter folder");
  ok(ch.children.map((c) => c.title).join() === "Section 1,Section 2", `it holds Section 1 and Section 2 (${ch.children.map((c) => c.title)})`);
  const s1 = path.join(root, "manuscript", ch.file, ch.children[0].file);
  ok(fs.existsSync(s1) && fs.readFileSync(s1, "utf8").includes("The storm came in at noon."), "the chapter's text is kept as Section 1");
  ok(await page.getByTestId("binder-Section 2").isVisible(), "the sections show under the chapter in the binder");
  await page.getByTestId("editor").click();
  await type("The wind followed.");
  // A new chapter from the section header goes after the chapter, not inside it.
  await page.getByTestId("add-doc-manuscript").click();
  await sleep(1200);
  ms = section(root, "manuscript");
  ok(ms.children.length === 2 && ms.children[1].kind === "doc" && ms.children[1].title === "Chapter 2", `New chapter goes after the chapter (${ms.children.map((c) => c.title)})`);
  await page.getByTestId("binder-Section 2").click();
  await page.getByTestId("binder-Section 2").hover();
  await page.getByTestId("add-section-Section 2").click();
  await sleep(1000);
  ms = section(root, "manuscript");
  ok(ms.children[0].children.map((c) => c.title).join() === "Section 1,Section 2,Section 3", "+ on a section adds another section after it");
  await page.screenshot({ path: path.join(SHOTS, "book-sections.png") });

  // ---- The new icons
  await page.getByTestId("icon-Section 3").click();
  for (const k of ["monster", "octopus", "unchecked", "checked"]) ok(await page.getByTestId(`icon-choice-${k}`).isVisible(), `the icon picker offers ${k}`);
  await page.screenshot({ path: path.join(SHOTS, "icon-picker-new.png") });
  await page.getByTestId("icon-choice-octopus").click();
  await sleep(700);
  ok(section(root, "manuscript").children[0].children[2].icon === "octopus", "the octopus icon is saved");

  // ---- "/cite" in a book: MLA by default, adds a Works Cited page
  await page.getByTestId("binder-Section 1").click();
  await page.getByTestId("editor").click();
  await page.keyboard.press("Control+End");
  await type(" As she wrote /cite");
  ok(await page.locator(".popup-menu .menu-item", { hasText: "Citation…" }).isVisible(), "/cite offers a new citation");
  await page.keyboard.press("Enter");
  await page.getByTestId("citation-dialog").waitFor();
  await page.getByTestId("cite-first-0").fill("Toni");
  await page.getByTestId("cite-last-0").fill("Morrison");
  await page.getByTestId("cite-title").fill("Beloved");
  await page.getByTestId("cite-publisher").fill("Knopf");
  await page.getByTestId("cite-year").fill("1987");
  await page.getByTestId("cite-page").fill("23");
  ok((await page.getByTestId("cite-preview-entry").innerText()) === "Morrison, Toni. Beloved. Knopf, 1987.", "the dialog previews the Works Cited entry");
  await page.screenshot({ path: path.join(SHOTS, "citation-dialog.png") });
  await page.getByTestId("cite-insert").click();
  await sleep(1800);
  ok((await page.getByTestId("editor").innerText()).includes("As she wrote (Morrison 23)"), "the in-text citation goes at the cursor");
  const back = section(root, "back");
  const wc = back.children.find((n) => n.title === "Works Cited");
  ok(!!wc, "a Works Cited page was added to the back matter");
  const wcText = wc ? fs.readFileSync(path.join(root, "back-matter", wc.file), "utf8") : "";
  ok(wcText.includes("- Morrison, Toni. *Beloved*. Knopf, 1987."), `the entry is on it (${wcText.trim()})`);
  ok(project(root).sources?.length === 1, "the source is remembered in project.json");

  // Cited again: one click.
  await type(". Later /cite");
  const again = page.locator(".popup-menu .menu-item", { hasText: "Cite Morrison — Beloved" });
  ok(await again.isVisible(), "the next /cite offers the remembered source");
  await page.screenshot({ path: path.join(SHOTS, "cite-remembered.png") });
  await again.dispatchEvent("mousedown");
  await sleep(300);
  await type(" 40");
  await sleep(1300);
  ok((await page.getByTestId("editor").innerText()).includes("Later (Morrison 40)"), "a remembered source is cited with the cursor ready for the page");
  ok(project(root).sources.length === 1, "it is not stored twice");
  const wcAfter = fs.readFileSync(path.join(root, "back-matter", wc.file), "utf8");
  ok(wcAfter.split("Morrison").length === 2, "and not listed twice");
}

// ---- Essay (Chicago): the essay's style is used
{
  await page.goto(URL);
  const root = path.join(DIR, "Cited Essay");
  fs.rmSync(root, { recursive: true, force: true });
  await page.getByTestId("new-project").click();
  await page.getByTestId("tmpl-essay").click();
  await page.getByTestId("essay-style").getByRole("button", { name: "Chicago" }).click();
  await page.getByTestId("new-title").fill("Cited Essay");
  await page.getByTestId("new-location").fill(DIR);
  await page.getByTestId("create-project").click();
  await page.getByTestId("editor").waitFor();
  await page.getByTestId("editor").click();
  await type("Tides are slow /citation");
  await page.keyboard.press("Enter");
  await page.getByTestId("citation-dialog").waitFor();
  ok(!(await page.getByTestId("cite-style").isVisible().catch(() => false)), "an essay's citation style is fixed by the essay");
  await page.getByTestId("cite-kind").getByRole("button", { name: "Web page" }).click();
  await page.getByTestId("cite-title").fill("How Tides Work");
  await page.getByTestId("cite-container").fill("Ocean Facts");
  await page.getByTestId("cite-year").fill("2024");
  await page.getByTestId("cite-url").fill("https://www.example.com/tides");
  await page.getByTestId("cite-insert").click();
  await sleep(1800);
  ok(!(await page.getByTestId("editor").innerText()).includes("(“How Tides Work” 2024)"), "Chicago notes puts no author–date citation in the text");
  const ms = section(root, "manuscript").children[0];
  const scene = fs.readFileSync(path.join(root, "manuscript", ms.file), "utf8");
  ok(/Tides are slow ?\[\^1\]/.test(scene), `a note marker follows the text (${scene.trim()})`);
  ok(/^\[\^1\]: “How Tides Work,” Ocean Facts, 2024/m.test(scene), "the note carries the full reference");
  const bib = section(root, "back").children.find((n) => n.title === "Bibliography");
  const text = fs.readFileSync(path.join(root, "back-matter", bib.file), "utf8");
  ok(text.includes("“How Tides Work.” Ocean Facts. 2024."), `the essay's Bibliography gets the entry (${text.trim()})`);
}

// ---- Screenplays run scenes on by default; stage plays don't
{
  await create("screenplay", "Run On Screenplay");
  await page.getByTestId("file-btn").click();
  await page.getByText("Project settings…").click();
  ok(!(await page.getByTestId("scene-new-page").isChecked()), "screenplay scenes run on by default");
  await page.keyboard.press("Escape");
}

await browser.close();
console.log(failures ? `${failures} check(s) failed` : "All checks passed");
process.exit(failures ? 1 : 0);
