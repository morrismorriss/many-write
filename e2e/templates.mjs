// Creates one project per template, writes a little in each and checks the
// files and the typeset preview. Same environment as smoke.mjs.
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
const type = (t) => page.keyboard.type(t, { delay: 3 });
const pill = async () => (await page.getByTestId("type-pill").innerText()).trim();

async function create(template, title) {
  fs.rmSync(path.join(DIR, title), { recursive: true, force: true });
  await page.goto(URL);
  await page.getByTestId("new-project").click();
  await page.getByTestId(`tmpl-${template}`).click();
  await page.getByTestId("new-title").fill(title);
  await page.getByTestId("new-location").fill(DIR);
  await page.getByTestId("create-project").click();
  await page.getByTestId("editor").waitFor();
  await page.getByTestId("editor").click();
  await page.keyboard.press("Control+End");
  return path.join(DIR, title);
}

// ---- Screenplay
{
  const root = await create("screenplay", "Test Screenplay");
  await page.keyboard.press("Enter");
  ok((await pill()) === "Action", "screenplay: heading -> action");
  await type("Rain hammers the window.");
  await page.keyboard.press("Enter");
  await type("Mara");
  await page.keyboard.press("Enter");
  await type("We should go.");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  ok((await pill()) === "Action", "screenplay: empty character -> action");
  await page.keyboard.press("Enter");
  await type("Cut to:");
  await sleep(2400);
  const md = fs.readFileSync(path.join(root, "manuscript/01-scene-1.md"), "utf8");
  ok(md === "## INT. LOCATION - DAY\n\nRain hammers the window.\n\nMARA\nWe should go.\n\n> CUT TO:\n", "screenplay file follows the convention");
  ok((await page.getByTestId("orphan-status").count()) === 0, "screenplay preview has no layout issues");
  await page.screenshot({ path: path.join(SHOTS, "10-screenplay.png") });
}

// ---- Poem: indentation and blank lines kept exactly
{
  const root = await create("poem", "Test Poem");
  await page.keyboard.press("Control+a");
  await type("Low Tide");
  await page.keyboard.press("Enter");
  ok((await pill()) === "Line", "poem: title -> line");
  await type("The sea goes out");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await type("and leaves its glass behind,");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await type("a hundred small suns.");
  await sleep(2400);
  const md = fs.readFileSync(path.join(root, "manuscript/01-poem-1.md"), "utf8");
  ok(md === "# Low Tide\n\nThe sea goes out\n    and leaves its glass behind,\n\na hundred small suns.\n", `poem file keeps indentation and stanza break (${JSON.stringify(md)})`);
  await sleep(500);
  await page.screenshot({ path: path.join(SHOTS, "11-poem.png") });
}

// ---- Book
{
  const root = await create("book", "Test Book");
  await type("It was the first warm day of the year, and nobody in the village could remember why they had been afraid. ");
  await type("The river had gone down. The bridge held. ".repeat(6));
  await page.keyboard.press("Enter");
  await type("By noon the square was full.");
  await page.keyboard.press("Tab");
  ok((await pill()) === "Heading", "book: Tab cycles paragraph -> heading");
  await page.keyboard.press("Shift+Tab");
  await sleep(2400);
  const md = fs.readFileSync(path.join(root, "manuscript/01-chapter-1.md"), "utf8");
  ok(md.endsWith("\n\nBy noon the square was full.\n"), "book paragraphs separated by blank lines");
  await sleep(600);
  const label = await page.getByTestId("page-label").innerText();
  ok(/of 3/.test(label), `book has title page, blank verso and chapter (${label})`);
  await page.screenshot({ path: path.join(SHOTS, "12-book.png") });
}

// ---- Article
{
  const root = await create("article", "Test Article");
  await type("Why plain files win");
  await page.keyboard.press("Tab");
  ok((await pill()) === "Heading", "article: Tab makes a heading");
  await page.keyboard.press("Enter");
  await type("Because they outlive the apps that made them.");
  await sleep(2400);
  const md = fs.readFileSync(path.join(root, "manuscript/01-section-1.md"), "utf8");
  ok(md === "## Why plain files win\n\nBecause they outlive the apps that made them.\n", `article file is plain markdown (${JSON.stringify(md)})`);
  await page.screenshot({ path: path.join(SHOTS, "13-article.png") });
}

// ---- Document: a plain document with lists and to-dos, typeset
{
  const root = await create("document", "Test Document");
  await type("Shopping");
  await page.keyboard.press("Enter");
  await type("- ");
  ok((await pill()) === "Bulleted list", "document: '- ' starts a list");
  await type("Bread");
  await page.keyboard.press("Enter");
  await type("Milk");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await type("1. ");
  await type("First");
  await page.keyboard.press("Enter");
  await type("Second");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await type("[] ");
  await type("Call Sam");
  await sleep(2400);
  const md = fs.readFileSync(path.join(root, "manuscript/01-page-1.md"), "utf8");
  ok(md === "Shopping\n\n- Bread\n- Milk\n\n1. First\n2. Second\n\n- [ ] Call Sam\n", `document file is plain markdown (${JSON.stringify(md)})`);
  ok((await page.getByTestId("orphan-status").count()) === 0 && /of 1/.test(await page.getByTestId("page-label").innerText()), "document typesets on one page");
  await page.screenshot({ path: path.join(SHOTS, "14-document.png") });
}

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
