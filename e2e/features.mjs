// Version 0.2 features, end to end: character picker, slash menu, Notion-style
// notes, images, front/back matter, archive, find & replace, stats, goals,
// pomodoro, File menu and production mode (locked pages). Same environment as smoke.mjs.
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
const root = path.join(DIR, "Feature Play");
fs.rmSync(root, { recursive: true, force: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1480, height: 920 }, deviceScaleFactor: Number(process.env.MW_DPR ?? 1) });
page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
page.on("dialog", (d) => d.accept());
const type = (t) => page.keyboard.type(t, { delay: 4 });
const pill = async () => (await page.getByTestId("type-pill").innerText()).trim();
const popup = page.locator(".popup-menu:visible");
const api = (cmd, args) => page.evaluate(([c, a]) => fetch(`/api/${c}`, { method: "POST", headers: { "X-Many-Write": "1" }, body: JSON.stringify(a) }).then((r) => r.json()).then((j) => j.value), [cmd, args]);
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const editor = page.getByTestId("editor");

// ---- Create a play and write a little
await page.goto(URL);
await page.getByTestId("new-project").click();
await page.getByTestId("new-title").fill("Feature Play");
await page.getByTestId("new-location").fill(DIR);
await page.getByTestId("create-project").click();
await editor.waitFor();
await editor.click();
await page.keyboard.press("Control+End");
await type("Scene 1");
await page.keyboard.press("Enter");
await type("A kitchen.");
await page.keyboard.press("Enter");
await type("Anna");
await page.keyboard.press("Escape");
await page.keyboard.press("Enter");
await type("Where is it?");
await page.keyboard.press("Enter");
await type("Ben");
await page.keyboard.press("Enter");
await type("Gone.");
await page.keyboard.press("Enter");

// ---- Character picker (Scrivener-style)
ok(await popup.isVisible(), "an empty character line lists the names already used");
const names = await popup.locator(".menu-item").allInnerTexts();
ok(names.includes("ANNA") && names.includes("BEN"), `picker shows ANNA and BEN (${names})`);
await type("b");
ok((await popup.locator(".menu-item").allInnerTexts()).join() === "BEN", "typing filters the list");
await page.keyboard.press("Enter");
ok((await pill()) === "Dialogue", "picking a name moves on to dialogue");
await type("Still gone.");
await page.keyboard.press("Enter");
await page.keyboard.press("ArrowDown");
await page.keyboard.press("ArrowDown");
await page.keyboard.press("Enter");
ok((await pill()) === "Dialogue", "arrow keys + Enter pick from the list");
await type("Then find it.");
await page.keyboard.press("Enter");
await page.keyboard.press("Enter"); // empty character -> direction (the list does not steal Enter)
ok((await pill()) === "Stage direction", "Enter on an empty cue still switches to stage direction");

// ---- Slash menu in a script
await type("/");
ok(await popup.isVisible(), "/ opens the block menu");
await type("trans");
await page.keyboard.press("Enter");
ok((await pill()) === "Transition", "/trans + Enter makes a transition");
await type("Blackout.");
await sleep(2400);
let scene = read("manuscript/01-act-one/01-scene-1.md");
ok(scene.includes("BEN\nStill gone.") && scene.includes("ANNA\nThen find it.") && scene.includes("> BLACKOUT.") && !scene.includes("/"), "picked names and slash command saved cleanly");

// ---- Characters page with Notion-style blocks
await page.getByTestId("add-doc-characters").click();
await sleep(600);
await editor.waitFor();
await page.keyboard.press("Control+End");
ok((await page.locator(".mw-editor p.is-hint").getAttribute("data-placeholder")) === "Character name", "a new character page is empty, with grey hint text");
await type("Anna");
await page.keyboard.press("Enter");
await type("/todo");
await page.keyboard.press("Enter");
ok((await pill()) === "To-do", "/todo makes a to-do");
await type("Find a surname");
await page.keyboard.press("Enter");
await type("Decide her age");
await page.keyboard.press("Enter");
await page.keyboard.press("Enter"); // empty to-do leaves the list
ok((await pill()) === "Text", "Enter on an empty to-do leaves the list");
await type("- ");
ok((await pill()) === "Bulleted list", "typing '- ' starts a bulleted list");
await type("Hates the sea");
await page.keyboard.press("Enter");
await page.keyboard.press("Enter");
await type("! ");
ok((await pill()) === "Callout", "'! ' starts a callout");
await type("Never apologises.");
// Tick the first to-do by clicking its box.
const todo = page.locator(".el-todo").first();
const box = await todo.boundingBox();
await page.mouse.click(box.x + 8, box.y + box.height / 2);
await sleep(2400);
const charFile = fs.readdirSync(path.join(root, "characters"))[0];
const charMd = read(`characters/${charFile}`);
ok(charMd.includes("- [x] Find a surname\n- [ ] Decide her age"), "to-dos saved as markdown checkboxes, ticked by clicking");
ok(charMd.includes("- Hates the sea") && charMd.includes("> [!note] Never apologises."), "bullets and callouts saved Obsidian-style");
ok(charMd.startsWith("# Anna\n"), "the name typed over the hint is the page's heading");
await page.screenshot({ path: path.join(SHOTS, "20-character-page.png") });

// ---- Images with /image
await page.getByTestId("add-doc-research").click();
await sleep(600);
await page.keyboard.press("Control+End");
await page.keyboard.press("Enter");
const chooser = page.waitForEvent("filechooser");
await type("/image");
await page.keyboard.press("Enter");
await (await chooser).setFiles(path.resolve("assets/icon.png"));
await page.locator("figure.mw-image img[src^='data:']").waitFor({ timeout: 5000 });
ok(true, "/image inserts a picture into the page");
await type("Under the picture.");
await sleep(2400);
const assets = fs.readdirSync(path.join(root, "assets"));
const researchMd = read(`research/${fs.readdirSync(path.join(root, "research"))[0]}`);
ok(assets.length === 1 && researchMd.includes(`![](assets/${assets[0]})`), `image copied into assets/ and linked as markdown (${assets[0]})`);
await page.screenshot({ path: path.join(SHOTS, "21-image.png") });

// ---- Front matter
await page.getByTestId("add-doc-front").click();
await page.getByTestId("preset-Cast of characters").click();
await sleep(1500);
ok(fs.existsSync(path.join(root, "front-matter/01-cast-of-characters.md")), "front matter page created from a preset");
let titled = false;
for (let i = 0; i < 4; i++) titled ||= ((await api("typst.pageText", { index: i })) ?? "").includes("CAST OF CHARACTERS");
ok(!titled, "a front matter page's title is left off the page, like a scene's");

// ---- Archive: drag a scene into it
await page.getByTestId("binder-Act One").click();
await page.getByTestId("binder-Act One").getByTitle("New document in this folder").click();
await sleep(900);
await page.getByTestId("binder-Scene 2").dragTo(page.getByTestId("section-archive"));
await sleep(1200);
ok(fs.readdirSync(path.join(root, "archive")).length === 1, "a scene dragged onto Archive moves into archive/");
await page.screenshot({ path: path.join(SHOTS, "22-binder.png") });

// ---- Find & replace across the script
await page.getByTestId("binder-Scene 1").click();
await sleep(400);
await page.keyboard.press("Control+Shift+F");
await page.getByTestId("find-input").fill("Gone");
await sleep(300);
ok((await page.getByTestId("find-count").innerText()).includes("of 2"), "finds matches across the script");
await page.getByTestId("replace-input").fill("Lost");
await page.getByTestId("replace-all").click();
await sleep(2600);
scene = read("manuscript/01-act-one/01-scene-1.md");
ok(scene.includes("Lost.") && scene.includes("Still lost.") === false && scene.includes("Still Lost."), "replace all keeps the rest of each line");
await page.getByTestId("find-input").fill("kitchen");
await page.getByTestId("find-next").click();
await sleep(300);
ok((await page.locator(".search-hit.current").count()) === 1, "the current match is highlighted in the editor");
await page.keyboard.press("Escape");

// ---- Words and pages
await page.getByTestId("stats-btn").click();
const stats = await page.getByTestId("stats-panel").innerText();
ok(/Scene 1\s+\d+\s+1 page/.test(stats) && /words/.test(stats), "stats show words and pages per scene");
await page.screenshot({ path: path.join(SHOTS, "23-stats.png") });
await page.getByTestId("stats-btn").click();

// ---- Goals
await page.getByTestId("goals-btn").click();
await page.getByTestId("goal-daily").fill("3000");
ok(/ \/ 3,000$/.test(await page.getByTestId("goal-today").innerText()), "the daily goal can be set");
// The week follows the computer's calendar: 7 days, today marked, named by the system.
const week = await page.getByTestId("goal-week").evaluate((el) =>
  [...el.querySelectorAll(".goal-day")].map((d) => ({ label: d.querySelector("small").textContent, today: d.classList.contains("today") })),
);
const todayName = await page.evaluate(() => new Date().toLocaleDateString(undefined, { weekday: "short" }));
ok(week.length === 7 && week.filter((d) => d.today).length === 1 && week.find((d) => d.today).label === todayName, `this week, with today (${todayName}) marked: ${week.map((d) => d.label).join(" ")}`);
ok(!week.some((d) => /Invalid/i.test(d.label)) && new Set(week.map((d) => d.label)).size === 7, "seven distinct, valid day names");
await page.screenshot({ path: path.join(SHOTS, "24-goals.png") });
await sleep(2500);
ok(JSON.parse(read("goals.json")).daily === 3000, "goals saved in the project folder");
await page.keyboard.press("Escape");

// ---- Pomodoro
await page.getByTestId("pomodoro-btn").click();
await page.getByTestId("pomodoro-start").click();
await sleep(2200);
const t = await page.getByTestId("pomodoro-time").innerText();
ok(/^24:5\d$/.test(t), `pomodoro counts down (${t})`);
await page.screenshot({ path: path.join(SHOTS, "25-pomodoro.png") });
await page.keyboard.press("Escape");

// ---- Spell check toggle
await page.getByTestId("file-btn").click();
await page.getByTestId("toggle-spellcheck").click();
ok((await editor.getAttribute("spellcheck")) === "false", "spell check can be switched off");
await page.getByTestId("toggle-spellcheck").click();
ok((await editor.getAttribute("spellcheck")) === "true", "and on again");
await page.keyboard.press("Escape");

// ---- Production mode: lock; an edited page becomes 2A, its old version goes to the Archive
const long = Array.from({ length: 70 }, (_, i) => `${i % 2 ? "BEN" : "ANNA"}\nLine ${i}: words to fill the page and push the layout along nicely.`).join("\n\n");
const scenePath = path.join(root, "manuscript/01-act-one/01-scene-1.md");
fs.writeFileSync(scenePath, `## Scene 1\n\n${long}\n`);
await sleep(3500);
const before = await page.getByTestId("page-label").innerText();
await page.getByTestId("production-btn").click();
await page.getByTestId("lock-pages").click();
await sleep(1500);
let prod = JSON.parse(read("production.json"));
ok(prod.active && prod.anchors.length >= 3 && prod.baseline, `pages locked (${prod.anchors.length} anchors, preview ${before})`);
const labelsOf = async (rev) => {
  const out = [];
  for (let i = 0; i < 14; i++) {
    const x = (await api("typst.pageText", { index: i })) ?? "";
    if (x.startsWith(`${rev} Rev.`)) out.push((x.match(new RegExp(`^${rev} Rev\\. \\S+ (\\d+[A-Z]*)\\. `)) ?? [])[1] ?? "-");
    if (!x) break;
  }
  return out;
};
// The director asks for more on page 2: add speeches just after the line that starts page 2.
const page2Line = prod.anchors.find((a) => a.page === 2).index; // index of page 2's first line in the scene
const lines = `## Scene 1\n\n${long}\n`.split("\n\n");
const extra = Array.from({ length: 8 }, (_, i) => `ANNA\nA new rewrite line ${i} that the director asked for.`);
lines.splice(page2Line + 1, 0, ...extra);
fs.writeFileSync(scenePath, lines.join("\n\n"));
await sleep(5000);
let labels = await labelsOf("White");
console.log("     page labels:", labels.join(", "));
ok(labels[0] === "-" && labels[1] === "1" && labels[2] === "2A" && labels[3] === "2B" && labels[4] === "3", `cast page unnumbered, page 1 numbered, edited page 2 prints as 2A, its overflow 2B, page 3 keeps its number (${labels.join(" ")})`);
const archiveFiles = fs.readdirSync(path.join(root, "archive"));
const oldPage = archiveFiles.find((f) => f.includes("page-2"));
ok(!!oldPage, `the old page 2 was moved to the Archive (${archiveFiles})`);
ok(oldPage && read(`archive/${oldPage}`).includes("Line ") && !read(`archive/${oldPage}`).includes("rewrite"), "the archived page holds the page as it was before the edit");
// Choose the letter: make the revised page 2B.
await page.getByTestId("production-btn").click();
await page.getByTestId("revised-pages").waitFor();
// Really on screen (not clipped by its container): the element at its centre belongs to it.
ok(
  await page.getByTestId("revised-pages").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  }),
  "the production panel is visible on screen",
);
await page.getByTestId("page-letter-2").selectOption({ value: "2" });
await page.keyboard.press("Escape");
await sleep(2500);
labels = await labelsOf("White");
ok(labels[2] === "2B" && labels[3] === "2C" && labels[4] === "3", `the writer can pick the letter: 2B, then 2C (${labels.join(" ")})`);
await page.screenshot({ path: path.join(SHOTS, "26-production.png") });
await page.getByTestId("production-btn").click();
await page.screenshot({ path: path.join(SHOTS, "27-production-panel.png") });
await page.getByTestId("old-version-2").click();
await sleep(500);
ok((await page.getByTestId("doc-title").inputValue()).startsWith("Page 2 — replaced in White revision"), "Old version opens the archived page");
const texts = [];
for (let i = 0; i < 14; i++) texts.push((await api("typst.pageText", { index: i })) ?? "");
ok(texts.some((x) => x.includes("*")), "rewritten lines are marked with * in the margin");
// Next revision: Blue. 2B stays 2B; marks clear; editing it again moves it on to 2C.
await page.getByTestId("production-btn").click();
await page.getByTestId("next-revision").click();
await sleep(3000);
labels = await labelsOf("Blue");
const texts2 = [];
for (let i = 0; i < 14; i++) texts2.push((await api("typst.pageText", { index: i })) ?? "");
ok(labels[2] === "2B" && !texts2.some((x) => x.includes("*")), `next revision: Blue, marks cleared, 2B kept (${labels.join(" ")})`);
fs.writeFileSync(scenePath, read("manuscript/01-act-one/01-scene-1.md").replace("A new rewrite line 0 that", "A newer rewrite line 0 that"));
await sleep(5000);
labels = await labelsOf("Blue");
ok(labels[2] === "2C", `editing it again in the Blue revision makes it 2C (${labels.join(" ")})`);
ok(fs.readdirSync(path.join(root, "archive")).some((f) => f.startsWith("page-2b-replaced-in-blue")), `and page 2B as it was is archived too (${fs.readdirSync(path.join(root, "archive"))})`);

// ---- File menu
await page.getByTestId("file-btn").click();
ok((await page.locator(".file-menu").innerText()).toLowerCase().includes("recent projects") && (await page.locator(".file-menu .two-line").count()) >= 2, "File menu lists recent projects");
await page.getByTestId("file-new").click();
await page.getByTestId("new-title").waitFor();
ok(true, "File > New project opens the new-project form");

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
