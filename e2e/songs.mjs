// Songs in a musical: "/song" in a stage play, the Enter flow through a song,
// the file convention (~~ title, ~ lyrics) and the typeset preview. Usage:
//   cargo run -p manywrite-devserver &   npx vite &   node e2e/songs.mjs
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
fs.rmSync(path.join(DIR, "Test Musical"), { recursive: true, force: true });

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = path.join(DIR, "Test Musical");
const scene1 = path.join(root, "manuscript/01-act-one/01-scene-1.md");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1480, height: 920 }, deviceScaleFactor: Number(process.env.MW_DPR ?? 1) });
page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));

const pill = async () => (await page.getByTestId("type-pill").innerText()).trim();
const type = async (text) => page.keyboard.type(text, { delay: 5 });

await page.goto(URL);
await page.getByTestId("new-project").click();
await page.getByTestId("tmpl-stage-play").click();
await page.getByTestId("new-title").fill("Test Musical");
await page.getByTestId("new-location").fill(DIR);
await page.getByTestId("create-project").click();
await page.getByTestId("editor").waitFor();

await page.getByTestId("editor").click();
await page.keyboard.press("Control+End");
await type("Scene 1");
await page.keyboard.press("Enter");
await type("A street at dusk.");

// "/song" at the end of a direction starts the song on its own line.
await type(" /song");
ok((await page.locator(".popup-menu[data-kind=slash]").innerText()).includes("Song"), "/song offers the Song block");
await page.keyboard.press("Enter");
ok((await pill()) === "Song", "/song -> a Song line");
await type("The Long Way Home");
await page.keyboard.press("Enter");
ok((await pill()) === "Character", "Enter after the song title -> character");
await type("Anna");
await page.keyboard.press("Enter");
ok((await pill()) === "Lyric", "Enter after a cue inside a song -> lyric");
await type("I walked the road alone");
await page.keyboard.press("Enter");
ok((await pill()) === "Lyric", "Enter after a lyric -> the next lyric");
await type("And never looked behind");
await page.keyboard.press("Enter");
await type("(");
ok((await pill()) === "Parenthetical", "( on an empty lyric -> parenthetical");
await type("to Ben");
await page.keyboard.press("Enter");
ok((await pill()) === "Lyric", "Enter in a parenthetical inside a song -> lyric");
await type("Until you");
await page.keyboard.press("Enter");
await page.keyboard.press("Enter");
ok((await pill()) === "Character", "Enter on an empty lyric -> the next singer's cue");
await type("Ben");
await page.keyboard.press("Enter");
ok((await pill()) === "Lyric", "the second singer also gets a lyric");
await type("Sing it again");
await page.keyboard.press("Enter");
await page.keyboard.press("Enter"); // -> character
await page.keyboard.press("Enter"); // empty character -> stage direction
ok((await pill()) === "Stage direction", "and on out of the song to a direction");
await type("The music stops.");
await page.keyboard.press("Enter");
await type("Anna");
await page.keyboard.press("Enter");
ok((await pill()) === "Lyric", "a cue after a direction inside the song is still sung");
await page.keyboard.press("Tab");
ok((await pill()) === "Parenthetical", "Tab moves on from a lyric");
await page.keyboard.press("Shift+Tab");
await page.keyboard.press("Shift+Tab");
ok((await pill()) === "Dialogue", "Shift-Tab back to spoken dialogue");
await type("That was lovely.");
await page.keyboard.press("Enter");
await type("Ben");
await page.keyboard.press("Enter");
ok((await pill()) === "Dialogue", "after spoken dialogue the song is over: dialogue again");
await type("Thanks.");

await sleep(2400);
const saved = fs.readFileSync(scene1, "utf8");
console.log("---- scene file on disk ----\n" + saved + "----");
ok(saved.includes("A street at dusk.\n\n~~ The Long Way Home"), "song title saved as ~~ on its own line");
ok(saved.includes("ANNA\n~I walked the road alone\n~And never looked behind\n(to Ben)\n~Until you"), "lyrics saved with ~ under the cue");
ok(saved.includes("BEN\n~Sing it again"), "second singer saved");
ok(saved.includes("ANNA\nThat was lovely."), "spoken dialogue after the song");

// The typeset preview renders the song.
await sleep(1500);
const label = await page.getByTestId("page-label").innerText();
ok(/Page \d+ of \d+/.test(label), `preview typesets the song (${label})`);
await page.screenshot({ path: path.join(SHOTS, "songs.png") });

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll song checks passed");
process.exit(failures ? 1 : 0);
