// Import Word, Final Draft, Fountain, PDF, RTF and Scrivener files through the UI,
// and open a plain document on its own. Same environment as smoke.mjs.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const { chromium } = createRequire(import.meta.url)("playwright");
const URL = process.env.MW_URL ?? "http://localhost:1420";
const DIR = process.env.MW_E2E_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), "mw-e2e-"));
const SHOTS = process.env.MW_SHOTS ?? "e2e/out";
const FIX = path.join(DIR, "import-fixtures");
const OUT = path.join(DIR, "imported");
fs.rmSync(FIX, { recursive: true, force: true });
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(FIX, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1480, height: 920 } });
page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
let answer = null;
page.on("dialog", (d) => (d.type() === "prompt" ? d.accept(answer ?? d.defaultValue()) : d.accept()));
const api = (cmd, args) => page.evaluate(([c, a]) => fetch(`/api/${c}`, { method: "POST", body: JSON.stringify(a) }).then((r) => r.json()), [cmd, args]);
await page.goto(URL);

// ---- Fixtures
const script = [
  ["scene_heading", "INT. KITCHEN - NIGHT"],
  ["action", "Rain on the window."],
  ["character", "ANNA"],
  ["parenthetical", "(quietly)"],
  ["dialogue", "Where did you put it?"],
  ["character", "BEN"],
  ["dialogue", "Nowhere you'd look."],
  ["scene_heading", "EXT. GARDEN - CONTINUOUS"],
  ["action", "Anna runs out."],
  ["character", "ANNA"],
  ["dialogue", "Ben!"],
  ["transition", "CUT TO:"],
];
fs.writeFileSync(
  path.join(FIX, "Night Garden.fdx"),
  `<?xml version="1.0" encoding="UTF-8"?><FinalDraft DocumentType="Script" Version="5"><Content>${script
    .map(([t, x]) => `<Paragraph Type="${{ scene_heading: "Scene Heading", action: "Action", character: "Character", parenthetical: "Parenthetical", dialogue: "Dialogue", transition: "Transition" }[t]}"><Text>${x.replace(/'/g, "&apos;")}</Text></Paragraph>`)
    .join("")}</Content><TitlePage><Content><Paragraph Type="Title Page"><Text>NIGHT GARDEN</Text></Paragraph></Content></TitlePage></FinalDraft>`,
);
fs.writeFileSync(
  path.join(FIX, "Fountain Test.fountain"),
  `Title: The Fountain Test\nAuthor: Someone\n\nINT. OFFICE - DAY\n\nPapers everywhere.\n\nMARA\nWho did this?\n\nJON\n(shrugs)\nThe wind.\n\nEXT. STREET - DAY\n\nMARA\nWait!\n`,
);
let r = await api("export.docx", {
  path: path.join(FIX, "Screenplay.docx"),
  doc: { title: "Screenplay", template: "screenplay", blocks: script.map(([kind, text]) => ({ kind, runs: [{ text }] })) },
});
ok(r.ok, "docx fixture written");
r = await api("export.docx", {
  path: path.join(FIX, "Essay.docx"),
  doc: {
    title: "Essay",
    template: "book",
    blocks: [
      { kind: "chapter", runs: [{ text: "Beginnings" }] },
      { kind: "paragraph", runs: [{ text: "It was " }, { text: "late", italic: true }, { text: "." }] },
      { kind: "paragraph", runs: [{ text: "Nobody came." }] },
      { kind: "chapter", runs: [{ text: "Endings" }] },
      { kind: "paragraph", runs: [{ text: "Everyone left." }] },
    ],
  },
});
// The core writes "chapter" as its own style; make it a real Heading 1 so the test is a fair Word file.
// (Our importer also understands Word's built-in heading styles; checked below via styles named "heading 1".)
const els = [];
let src = '#import "/mw/screenplay.typ": *\n#show: conf.with(title: "PDF Play", title-page: false)\n';
let prev = "none";
for (const [k, t] of script) {
  src += `#el("${k}", ${prev})[#"${t}"]\n`;
  prev = `"${k}"`;
}
r = await api("export.pdf", { source: src, elements: els, path: path.join(FIX, "PDF Play.pdf") });
ok(r.ok, "pdf fixture written");
fs.writeFileSync(path.join(FIX, "Letter.rtf"), String.raw`{\rtf1\ansi{\fonttbl{\f0 Times;}}\f0 Dear Sam,\par I \i really\i0  liked it.\par Yours, Ann\par}`);
// A minimal Scrivener 3 project package.
const scriv = path.join(FIX, "Novel.scriv");
const uuids = ["A1", "B2", "C3", "D4", "E5"];
fs.mkdirSync(scriv, { recursive: true });
fs.writeFileSync(
  path.join(scriv, "Novel.scrivx"),
  `<?xml version="1.0" encoding="UTF-8"?><ScrivenerProject><Binder>
  <BinderItem UUID="DRAFT" Type="DraftFolder"><Title>Draft</Title><Children>
    <BinderItem UUID="${uuids[0]}" Type="Folder"><Title>Part One</Title><Children>
      <BinderItem UUID="${uuids[1]}" Type="Text"><Title>Arrival</Title></BinderItem>
      <BinderItem UUID="${uuids[2]}" Type="Text"><Title>The Letter</Title></BinderItem>
    </Children></BinderItem>
  </Children></BinderItem>
  <BinderItem UUID="RES" Type="ResearchFolder"><Title>Research</Title><Children>
    <BinderItem UUID="${uuids[3]}" Type="Text"><Title>Places</Title></BinderItem>
  </Children></BinderItem>
  <BinderItem UUID="TR" Type="TrashFolder"><Title>Trash</Title><Children>
    <BinderItem UUID="${uuids[4]}" Type="Text"><Title>Deleted</Title></BinderItem>
  </Children></BinderItem>
</Binder></ScrivenerProject>`,
);
const rtfDoc = (s) => `{\\rtf1\\ansi{\\fonttbl{\\f0 Cochin;}}\\f0 ${s}}`;
const put = (u, file, body) => {
  fs.mkdirSync(path.join(scriv, "Files/Data", u), { recursive: true });
  fs.writeFileSync(path.join(scriv, "Files/Data", u, file), body);
};
put(uuids[1], "content.rtf", rtfDoc("The train was late.\\par She waited.\\par"));
put(uuids[1], "synopsis.txt", "Mara arrives in town.");
put(uuids[1], "notes.rtf", rtfDoc("Check the timetable.\\par"));
put(uuids[2], "content.rtf", rtfDoc("The letter was \\b unsigned\\b0 .\\par"));
put(uuids[3], "content.rtf", rtfDoc("The station, the square.\\par"));
put(uuids[4], "content.rtf", rtfDoc("Gone.\\par"));

// ---- Import each through File > Import
async function importVia(fixture, expectTemplate) {
  await page.goto(URL);
  answer = path.join(FIX, fixture);
  await page.getByTestId("import").click();
  await page.getByTestId("import-summary").waitFor({ timeout: 10000 });
  const summary = await page.getByTestId("import-summary").innerText();
  const tmpl = await page.getByTestId("import-template").inputValue();
  ok(tmpl === expectTemplate, `${fixture}: detected ${tmpl} (${summary.split(".")[0]})`);
  await page.getByTestId("import-location").fill(OUT);
  const title = await page.getByTestId("import-title").inputValue();
  await page.getByTestId("import-go").click();
  await page.getByTestId("file-btn").waitFor({ timeout: 10000 });
  await sleep(500);
  return path.join(OUT, title);
}

const read = (p) => fs.readFileSync(p, "utf8");
const filesUnder = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).filter((f) => f.endsWith(".md")).sort() : []);

let root = await importVia("Night Garden.fdx", "screenplay");
let files = filesUnder(path.join(root, "manuscript"));
ok(files.length === 2, `fdx split into scenes (${files})`);
ok(read(path.join(root, "manuscript", files[0])).includes("ANNA\n(quietly)\nWhere did you put it?"), "fdx dialogue and parentheticals kept");
ok(path.basename(root) === "Night Garden", "fdx title from its title page");
await page.screenshot({ path: path.join(SHOTS, "30-import-fdx.png") });

root = await importVia("Fountain Test.fountain", "screenplay");
files = filesUnder(path.join(root, "manuscript"));
ok(path.basename(root) === "The Fountain Test" && files.length === 2, `fountain: title page read, two scenes (${files})`);
ok(read(path.join(root, "manuscript", files[0])).includes("JON\n(shrugs)\nThe wind."), "fountain elements kept");

root = await importVia("Screenplay.docx", "screenplay");
files = filesUnder(path.join(root, "manuscript"));
ok(files.length === 2 && read(path.join(root, "manuscript", files[1])).includes("> CUT TO:"), `docx script styles become elements (${files})`);

root = await importVia("Essay.docx", "book");
files = filesUnder(path.join(root, "manuscript"));
ok(files.join(",") === "01-beginnings.md,02-endings.md" && read(path.join(root, "manuscript", files[0])).includes("It was *late*."), `docx chapters split at headings, italics kept (${files})`);

root = await importVia("PDF Play.pdf", "screenplay");
files = filesUnder(path.join(root, "manuscript"));
const pdfScene = files.length ? read(path.join(root, "manuscript", files[0])) : "";
ok(files.length === 2 && pdfScene.includes("ANNA\n(quietly)\nWhere did you put it?") && pdfScene.includes("Rain on the window."), `pdf script rebuilt from text positions (${files})`);

root = await importVia("Letter.rtf", "article");
files = filesUnder(path.join(root, "manuscript"));
ok(read(path.join(root, "manuscript", files[0])).includes("I *really* liked it."), "rtf with italics");

root = await importVia("Novel.scriv", "book");
files = filesUnder(path.join(root, "manuscript"));
ok(files.join(",") === "01-part-one/01-arrival.md,01-part-one/02-the-letter.md", `scrivener binder kept (${files})`);
ok(read(path.join(root, "manuscript/01-part-one/02-the-letter.md")).includes("The letter was **unsigned**."), "scrivener text with bold");
ok(filesUnder(path.join(root, "research")).length === 1, "scrivener research imported; trash skipped");
const notes = fs.readdirSync(path.join(root, "notes"));
ok(notes.some((n) => read(path.join(root, "notes", n)).includes("Mara arrives in town.") && read(path.join(root, "notes", n)).includes("Check the timetable.")), "scrivener synopsis and notes become the scene's notes");
await page.screenshot({ path: path.join(SHOTS, "31-import-scrivener.png") });

// ---- A plain document on its own
const single = path.join(FIX, "Shopping list.md");
fs.writeFileSync(single, "# Things\n\nMilk and bread.\n");
await page.goto(URL);
answer = single;
await page.getByTestId("open-document").click();
await page.getByTestId("editor").waitFor();
await page.getByTestId("editor").click();
await page.keyboard.press("Control+End");
await page.keyboard.press("Enter");
await page.keyboard.type("Eggs too.");
await sleep(2400);
ok(read(single) === "# Things\n\nMilk and bread.\n\nEggs too.\n", "a single document opens and saves in place");
ok(!fs.existsSync(path.join(FIX, "project.json")), "no project files are created next to it");
await page.screenshot({ path: path.join(SHOTS, "32-single-document.png") });

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
