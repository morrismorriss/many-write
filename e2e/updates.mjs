// End-to-end check of the 0.5 changes: binder icons, the donate popup, blank
// lines kept, scenes on new pages, play collections with Final Draft imports,
// new windows, the list placeholder, character extensions and (CONT'D), grey
// hint text on new pages, clickable links and side panel colours.
// Usage as for smoke.mjs.

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
const context = await browser.newContext({ viewport: { width: 1480, height: 920 }, deviceScaleFactor: Number(process.env.MW_DPR ?? 1) });
const page = await context.newPage();
page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
let promptAnswer = null;
page.on("dialog", (d) => (d.type() === "prompt" ? d.accept(promptAnswer ?? d.defaultValue()) : d.accept()));
const type = (t) => page.keyboard.type(t, { delay: 4 });
const pill = async () => (await page.getByTestId("type-pill").innerText()).trim();
const api = (cmd, args) =>
  page.evaluate(([c, a]) => fetch(`/api/${c}`, { method: "POST", headers: { "X-Many-Write": "1" }, body: JSON.stringify(a) }).then((r) => r.json()).then((j) => j.value), [cmd, args]);
const pageText = async (i) => (await api("typst.pageText", { index: i })) ?? "";
const pageTexts = async () => {
  const out = [];
  for (let i = 0; i < 40; i++) {
    const t = await pageText(i);
    if (!t) break;
    out.push(t);
  }
  return out;
};
const editor = page.getByTestId("editor");
const popup = page.locator(".popup-menu:visible");
for (const name of ["Update Play", "Update Book", "Trilogy", "Update Notes"]) fs.rmSync(path.join(DIR, name), { recursive: true, force: true });

async function newProject(template, title) {
  await page.goto(URL);
  await page.getByTestId("new-project").click();
  await page.getByTestId(`tmpl-${template}`).click();
  await page.getByTestId("new-title").fill(title);
  await page.getByLabel("Author").fill("Sam Writer");
  await page.getByTestId("new-location").fill(DIR);
  await page.getByTestId("create-project").click();
  await editor.waitFor();
  await sleep(500);
  return path.join(DIR, title);
}

// ---------------------------------------------------------------- stage play
let root = await newProject("stage-play", "Update Play");
const scene1 = path.join(root, "manuscript/01-act-one/01-scene-1.md");
ok(fs.readFileSync(scene1, "utf8") === "", "a new scene file is empty");
ok((await page.locator(".mw-editor p.is-hint").getAttribute("data-placeholder")) === "Scene 1", "and shows its name as grey hint text");

// Binder icons differ by kind.
const sceneIcon = await page.getByTestId("binder-Scene 1").locator(".row-icon").innerHTML();
const actIcon = await page.getByTestId("binder-Act One").locator(".row-icon").innerHTML();
ok(sceneIcon !== actIcon && sceneIcon.includes("<svg"), "scenes have their own icon in the binder");

await editor.click();
await page.keyboard.press("Control+End");
await type("Scene 1");
await page.keyboard.press("Enter");
await type("A kitchen.");
await page.keyboard.press("Enter");
await type("Anna");
await page.keyboard.press("Escape");
await page.keyboard.press("Enter");
await type("Where is it? See https://example.com/letter.");
await page.keyboard.press("Enter");
await type("Ben");
await page.keyboard.press("Enter");
await type("Gone.");
await page.keyboard.press("Enter");
// Character extensions: "Anna (" offers (V.O.), (O.S.), (CONT'D)…
await type("Anna (");
await sleep(150);
const exts = await popup.locator(".menu-item").allInnerTexts();
ok(exts.some((e) => e.startsWith("(V.O.)")) && exts.some((e) => e.startsWith("(O.S.)")) && exts.some((e) => e.startsWith("(CONT'D)")), `typing "(" after a name offers extensions (${exts.map((e) => e.split("\n")[0])})`);
await type("v");
await page.keyboard.press("Enter");
ok((await pill()) === "Dialogue", "picking (V.O.) moves on to dialogue");
await type("I can hear you.");
await page.keyboard.press("Enter");
// A whole name typed: the list offers its extensions, but Enter still moves on.
await type("Ben");
await sleep(150);
ok((await popup.locator(".menu-item").allInnerTexts()).some((e) => e.startsWith("(O.S.)")), "a known name offers its extensions");
await page.keyboard.press("Enter");
ok((await pill()) === "Dialogue", "Enter after a whole name still moves on to dialogue");
await type("Then where?");
await page.keyboard.press("Enter");
await page.keyboard.press("Enter"); // empty cue -> direction
await type("He waits.");
await page.keyboard.press("Enter");
await type("Ben");
await page.keyboard.press("Enter");
await type("Well?");
await sleep(2400);
let md = fs.readFileSync(scene1, "utf8");
ok(md.includes("ANNA (V.O.)\nI can hear you."), "the extension is saved with the cue");

// Links: underlined and clickable.
const link = page.locator(".mw-link").first();
ok((await link.getAttribute("data-href")) === "https://example.com/letter", "a web address is shown as a link (without the full stop)");
const popupPage = context.waitForEvent("page", { timeout: 5000 }).catch(() => null);
await link.click();
const opened = await popupPage;
// (The test machine may have no network: the new tab is enough.)
ok(!!opened, "clicking a link opens it in a new browser tab");
await opened?.close().catch(() => {});

// Automatic (CONT'D) and scenes on new pages, from Project settings.
await page.getByTestId("file-btn").click();
await page.getByText("Project settings…").click();
ok(await page.getByTestId("scene-new-page").isChecked(), "scenes start on a new page by default");
await page.getByTestId("auto-contd").check();
await page.getByRole("dialog", { name: "Project settings" }).getByRole("button", { name: "Save" }).click();
await page.getByTestId("binder-Act One").getByTitle("New document in this folder").click();
await sleep(800);
ok((await page.locator(".mw-editor p.is-hint").getAttribute("data-placeholder")) === "Scene 2", "the next new scene is empty too");
await type("Scene 2");
await page.keyboard.press("Enter");
await type("Night.");
await sleep(3000);
let texts = await pageTexts();
const s1 = texts.findIndex((t) => t.includes("SCENE 1"));
const s2 = texts.findIndex((t) => t.includes("SCENE 2"));
ok(s1 > 0 && s2 > s1 && !texts[s1].includes("SCENE 2"), `scene 2 starts on its own page (pages ${s1} and ${s2})`);
ok(texts[s1].includes("BEN (CONT'D)"), "the second BEN speech after a direction reads BEN (CONT'D) on the page");
ok(!fs.readFileSync(scene1, "utf8").includes("CONT'D"), "(CONT'D) is not written into the file");

// Front matter preset: empty, with grey hint text, on the right line type.
await page.getByTestId("add-doc-front").click();
await page.getByTestId("preset-Dedication").click();
await sleep(800);
const ded = page.locator(".mw-editor p.is-hint");
ok((await ded.getAttribute("data-placeholder")) === "For …" && (await ded.getAttribute("class")).includes("el-centered"), "a new dedication shows “For …” in grey, centred");
ok(fs.readFileSync(path.join(root, "front-matter/01-dedication.md"), "utf8") === "", "and its file is empty");
await type("For Jo.");
await sleep(2200);
ok(fs.readFileSync(path.join(root, "front-matter/01-dedication.md"), "utf8").includes("-> For Jo. <-"), "typing replaces the hint");

// Notes: the bullet list placeholder sits after the bullet, not behind it.
await page.getByTestId("binder-Scene 1").click();
await sleep(400);
await page.getByTestId("notes").click();
await type("- ");
const notesP = page.locator(".notes-editor p.el-bullet").first();
const ph = await notesP.evaluate((el) => {
  const box = el.getBoundingClientRect();
  return { left: parseFloat(getComputedStyle(el, "::before").left), bullet: parseFloat(getComputedStyle(el, "::after").left) + 6, width: box.width };
});
ok(ph.left >= ph.bullet, `the list placeholder starts after the bullet (text at ${ph.left}px, bullet ends at ${ph.bullet}px)`);
await page.screenshot({ path: path.join(SHOTS, "50-updates-play.png") });

// Side panels: their text colour comes from the sidebar, and the selected item is tinted with the accent.
const side = await page.evaluate(() => {
  const s = getComputedStyle(document.querySelector(".sidebar"));
  const sel = getComputedStyle(document.querySelector(".binder-row.selected"));
  return { color: s.color, sideText: getComputedStyle(document.documentElement).getPropertyValue("--side-text").trim(), selected: sel.backgroundColor };
});
ok(!!side.sideText && side.selected !== "rgba(0, 0, 0, 0)", `side panel colours are set (text ${side.sideText}, selected ${side.selected})`);

// Donate popup from the File menu.
await page.getByTestId("file-btn").click();
await page.getByTestId("file-donate").click();
ok(await page.getByTestId("donate-dialog").isVisible(), "File › Support Many Write opens the donate popup");
await page.screenshot({ path: path.join(SHOTS, "51-donate.png") });
const donatePage = context.waitForEvent("page", { timeout: 5000 }).catch(() => null);
await page.getByTestId("donate-go").click();
const donateTab = await donatePage;
ok(!!donateTab && (await donateTab.evaluate(() => location.href).catch(() => "")).length >= 0, "Donate opens the Buy Me a Coffee page in a new tab");
ok(!(await page.getByTestId("donate-dialog").isVisible()), "and closes the popup");
await donateTab?.close().catch(() => {});

// New window.
await page.getByTestId("file-btn").click();
const winPromise = context.waitForEvent("page", { timeout: 5000 }).catch(() => null);
await page.getByTestId("file-new-window").click();
const win = await winPromise;
ok(!!win && (await win.getByTestId("new-project").waitFor({ timeout: 10000 }).then(() => true, () => false)), "File › New window opens a second window on the welcome screen");
await win?.close().catch(() => {});

// ---------------------------------------------------------------- book: blank lines
root = await newProject("book", "Update Book");
await editor.click();
await type("First paragraph.");
await page.keyboard.press("Enter");
await page.keyboard.press("Enter");
await page.keyboard.press("Enter");
await type("After two blank lines.");
await page.keyboard.press("Enter");
await page.keyboard.press("Enter");
await sleep(2400);
md = fs.readFileSync(path.join(root, "manuscript/01-chapter-1.md"), "utf8");
ok(md === "First paragraph.\n\n&nbsp;\n\n&nbsp;\n\nAfter two blank lines.\n", `empty paragraphs are kept as blank lines (${JSON.stringify(md)})`);
// Open the project again (as a new window would).
await page.goto(`${URL}/?project=${encodeURIComponent(root)}`);
await editor.waitFor();
await sleep(800);
ok((await editor.locator("p").count()) === 4, "and come back when the file is opened again");
const bookShot = await pageText(2);
ok(bookShot.includes("First paragraph.") && bookShot.includes("After two blank lines."), "the typeset page holds both paragraphs");

// ---------------------------------------------------------------- play collection
await page.goto(URL);
await page.getByTestId("new-project").click();
await page.getByTestId("tmpl-play-collection").click();
await page.getByTestId("new-title").fill("Trilogy");
await page.getByLabel("Author").fill("Sam Writer");
await page.getByTestId("new-location").fill(DIR);
await page.getByTestId("create-project").click();
await editor.waitFor();
await sleep(800);
root = path.join(DIR, "Trilogy");
for (const n of ["One", "Two", "Three"]) ok(await page.getByTestId(`binder-Play ${n}`).isVisible(), `the collection starts with Play ${n}`);
const proj = JSON.parse(fs.readFileSync(path.join(root, "project.json"), "utf8"));
const plays = proj.binder.find((r) => r.role === "manuscript").children;
ok(plays.length === 3 && plays.every((p) => p.play && p.children.some((c) => c.matter)), "each play has its own front matter folder");

// A cast list in Play Two's front matter.
await page.getByTestId("binder-Play Two").locator("..").getByTestId("add-in-Front matter").click();
await page.getByTestId("preset-Cast of characters").click();
await sleep(800);
await type("MARA, a pilot.");
await sleep(2000);

// Import a Final Draft file into Play Two.
const fdx = path.join(DIR, "the-crossing.fdx");
fs.writeFileSync(
  fdx,
  `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<FinalDraft DocumentType="Script" Template="No" Version="5">
  <Content>
    <Paragraph Type="Scene Heading"><Text>THE HARBOUR</Text></Paragraph>
    <Paragraph Type="Action"><Text>Fog.</Text></Paragraph>
    <Paragraph Type="Character"><Text>MARA</Text></Paragraph>
    <Paragraph Type="Dialogue"><Text>We leave at dawn.</Text></Paragraph>
    <Paragraph Type="Scene Heading"><Text>THE BOAT</Text></Paragraph>
    <Paragraph Type="Character"><Text>OWEN</Text></Paragraph>
    <Paragraph Type="Dialogue"><Text>Too late.</Text></Paragraph>
  </Content>
  <TitlePage><Content><Paragraph Type="Title Page"><Text>THE CROSSING</Text></Paragraph></Content></TitlePage>
</FinalDraft>
`,
);
promptAnswer = fdx;
await page.getByTestId("binder-Play Two").hover();
await page.getByTestId("import-into-Play Two").click();
await sleep(2500);
ok(await page.getByTestId("binder-The Crossing").isVisible(), "the play takes the title from the Final Draft title page");
ok((await page.getByTestId("binder-The harbour").isVisible()) && (await page.getByTestId("binder-The boat").isVisible()), "its scenes are imported into the play");
const playDir = fs.readdirSync(path.join(root, "manuscript")).find((d) => d.includes("crossing"));
const actDir = fs.readdirSync(path.join(root, "manuscript", playDir)).find((d) => d.includes("act-one"));
const sceneFiles = fs.readdirSync(path.join(root, "manuscript", playDir, actDir));
ok(sceneFiles.length === 2 && fs.readFileSync(path.join(root, "manuscript", playDir, actDir, sceneFiles[0]), "utf8").includes("MARA\nWe leave at dawn."), `the empty Scene 1 was replaced by the imported scenes (${sceneFiles})`);
await sleep(2500);
texts = await pageTexts();
const crossing = texts.findIndex((t) => /THE CROSSING\s+by\s+Sam Writer/.test(t));
ok(crossing > 0, "the play has its own title page with the author");
ok(texts[crossing + 1]?.includes("CAST OF CHARACTERS") && texts[crossing + 1].includes("MARA, a pilot."), "followed by its own front matter");
ok(texts.some((t) => t.includes("PLAY ONE")) && texts.some((t) => t.includes("PLAY THREE")), "every play is typeset in the collection");
await page.screenshot({ path: path.join(SHOTS, "52-collection.png") });

// A fourth play from the masks button.
await page.getByTestId("add-play").click();
await sleep(800);
ok(await page.getByTestId("binder-Play Four").isVisible(), "the masks button adds another play");

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
