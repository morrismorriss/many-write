// Binder: selecting several items and dragging them in and out of folders,
// choosing icons, and a subtitle on the title page. Same environment as smoke.mjs.
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
const root = path.join(DIR, "Binder Play");
fs.rmSync(root, { recursive: true, force: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1480, height: 920 }, deviceScaleFactor: Number(process.env.MW_DPR ?? 1) });
page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
page.on("dialog", (d) => d.accept());
const api = (cmd, args) =>
  page.evaluate(([c, a]) => fetch(`/api/${c}`, { method: "POST", headers: { "X-Many-Write": "1" }, body: JSON.stringify(a) }).then((r) => r.json()).then((j) => j.value), [cmd, args]);
const project = () => JSON.parse(fs.readFileSync(path.join(root, "project.json"), "utf8"));
const manuscript = () => project().binder.find((n) => n.role === "manuscript");
const titles = (nodes) => nodes.map((n) => n.title);
const mod = process.platform === "darwin" ? "Meta" : "Control";

await page.goto(URL);
await page.getByTestId("new-project").click();
await page.getByTestId("new-title").fill("Binder Play");
await page.getByTestId("new-location").fill(DIR);
await page.getByTestId("create-project").click();
await page.getByTestId("editor").waitFor();

// Three scenes in Act One.
for (let i = 0; i < 2; i++) {
  await page.getByTestId("binder-Act One").hover();
  await page.getByTestId("binder-Act One").getByTitle("New document in this folder").click();
  await sleep(300);
}
await sleep(500);
let act = manuscript().children.find((n) => n.title === "Act One");
ok(titles(act.children).join() === "Scene 1,Scene 2,Scene 3", `Act One holds three scenes (${titles(act.children)})`);

// ---- Select two with ⌘/Ctrl-click and drag them out of the folder.
await page.getByTestId("binder-Scene 2").click();
await page.getByTestId("binder-Scene 3").click({ modifiers: [mod] });
ok((await page.locator(".binder-row.selected").count()) === 2, "⌘/Ctrl-click selects a second item");
await page.getByTestId("binder-Scene 2").dragTo(page.getByTestId("end-manuscript"));
await sleep(800);
let ms = manuscript();
act = ms.children.find((n) => n.title === "Act One");
ok(titles(act.children).join() === "Scene 1", `both scenes left Act One (${titles(act.children)})`);
ok(titles(ms.children).join() === "Act One,Scene 2,Scene 3", `they sit after Act One, in order (${titles(ms.children)})`);
ok(fs.existsSync(path.join(root, "manuscript", "02-scene-2.md")) && fs.existsSync(path.join(root, "manuscript", "03-scene-3.md")), "their files moved out of the act folder");

// ---- Shift-click a range and drag it back into the folder.
await page.getByTestId("binder-Scene 2").click();
await page.getByTestId("binder-Scene 3").click({ modifiers: ["Shift"] });
ok((await page.locator(".binder-row.selected").count()) === 2, "Shift-click selects a range");
await page.getByTestId("binder-Scene 3").dragTo(page.getByTestId("binder-Act One"));
await sleep(800);
ms = manuscript();
act = ms.children.find((n) => n.title === "Act One");
ok(titles(act.children).join() === "Scene 1,Scene 2,Scene 3", `both went back into Act One, in order (${titles(act.children)})`);
ok(titles(ms.children).join() === "Act One", "nothing is left outside the act");

// ---- A plain click goes back to one item.
await page.getByTestId("binder-Scene 1").click();
ok((await page.locator(".binder-row.selected").count()) === 1, "a plain click selects just one item");

// ---- Icons
const iconSvg = (t) => page.getByTestId(`icon-${t}`).innerHTML();
const before = await iconSvg("Scene 1");
await page.getByTestId("icon-Scene 1").click();
ok(await page.getByTestId("icon-picker").isVisible(), "clicking a binder icon opens the icon picker");
await page.screenshot({ path: path.join(SHOTS, "binder-icon-picker.png") });
await page.getByTestId("icon-choice-star").click();
await sleep(400);
ok(!(await page.getByTestId("icon-picker").isVisible().catch(() => false)), "choosing an icon closes the picker");
ok((await iconSvg("Scene 1")) !== before, "the row shows the new icon");
const all = (nodes) => nodes.flatMap((n) => [n, ...all(n.children ?? [])]);
const findIn = (nodes, t) => all(nodes).find((n) => n.title === t);
await sleep(600);
ok(findIn(project().binder, "Scene 1")?.icon === "star", "the icon is saved in project.json");

// Several at once.
await page.getByTestId("binder-Scene 2").click();
await page.getByTestId("binder-Scene 3").click({ modifiers: ["Shift"] });
await page.getByTestId("icon-Scene 3").click();
ok((await page.locator(".icon-picker-head").innerText()).includes("2"), "with two selected, the picker changes both");
await page.getByTestId("icon-choice-moon").click();
await sleep(800);
ok(findIn(project().binder, "Scene 2")?.icon === "moon" && findIn(project().binder, "Scene 3")?.icon === "moon", "both rows got the moon");
// Folders too, and back to the default.
await page.getByTestId("icon-Act One").click();
await page.getByTestId("icon-choice-flag").click();
await sleep(600);
ok(findIn(project().binder, "Act One")?.icon === "flag", "a folder can have an icon");
await page.getByTestId("icon-Scene 1").click();
await page.getByTestId("icon-choice-default").click();
await sleep(600);
ok(findIn(project().binder, "Scene 1")?.icon === undefined && (await iconSvg("Scene 1")) === before, "Default icon restores the original");
// Clicking the icon doesn't open or rename the item.
ok((await page.locator(".binder .rename").count()) === 0, "clicking icons never starts a rename");
// Escape closes the picker.
await page.getByTestId("icon-Scene 1").click();
await page.keyboard.press("Escape");
ok(!(await page.getByTestId("icon-picker").isVisible().catch(() => false)), "Escape closes the picker");

// ---- Subtitle
await page.getByTestId("file-btn").click();
await page.getByText("Project settings…").click();
await page.getByTestId("settings-subtitle").fill("A Comedy in One Act");
await page.getByRole("dialog", { name: "Project settings" }).getByRole("button", { name: "Save" }).click();
await sleep(600);
ok(project().subtitle === "A Comedy in One Act", "the subtitle is saved in project.json");
let first = "";
for (let i = 0; i < 20 && !first.includes("A Comedy in One Act"); i++) {
  await sleep(400);
  first = (await api("typst.pageText", { index: 0 })) ?? "";
}
ok(first.includes("BINDER PLAY") && first.includes("A Comedy in One Act"), `the title page shows the subtitle under the title (${first.slice(0, 80).replace(/\s+/g, " ")})`);
await page.screenshot({ path: path.join(SHOTS, "binder-subtitle.png") });

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll binder checks passed");
process.exit(failures ? 1 : 0);
