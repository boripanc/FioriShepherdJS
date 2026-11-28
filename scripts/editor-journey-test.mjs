// Tour editor: recording one tour across two apps (Launchpad home -> Manage Sales Orders).
// Start the dev server first (npm run serve), then: npm test
import { toggleEditor } from "./editor-menu.mjs";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = (process.env.BASE_URL || "http://localhost:8080/test/flpSandbox.html") + "?fiori-guide-editor=true";
const SHOTS = "screenshots/editor";
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

let failed = false;
function check(cond, msg) {
	console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
	if (!cond) failed = true;
}
const pickAt = async (locator) => {
	await page.click("#fioriGuideEditorAddStep");
	await page.waitForTimeout(300);
	const box = await locator.boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
	await page.waitForTimeout(500);
};

try {
	await page.goto(BASE + "#Shell-home");
	await page.evaluate(() => {
		localStorage.clear();
		localStorage.setItem("fiori.shepherd.guide.seen.salesorder-overview", "1");
		localStorage.setItem("fiori.shepherd.guide.seen.sales-order-gui", "2");
	});
	await page.reload();
	await page.waitForSelector("#fioriShepherdGuideHeaderButton", { timeout: 60000 });
	await page.waitForTimeout(1500);
	await toggleEditor(page);
	await page.waitForSelector("#fioriGuideEditor .sapMPage", { timeout: 20000 });
	await page.waitForTimeout(800);

	// new tour on the home page: step 1 = the app tile
	await page.click("#fioriGuideEditor .sapMSlt");
	await page.click(".sapMSelectList li:has-text('+ New tour')");
	await page.waitForTimeout(400);
	await page.fill("#fioriGuideEditorTourTitle-inner", "Find an order from the home page");
	await pickAt(page.locator(".sapMGT:has-text('Manage Sales Orders')"));
	await page.fill("#fioriGuideEditorStepTitleInput-inner", "Open the app");
	await page.click("#fioriGuideEditorThen");
	await page.click(".sapMSelectList:visible li:text-is('Click the element')");

	// the author opens the app; the editor keeps the tour
	await page.evaluate(() => { window.location.hash = "#SalesOrder-manage"; });
	await page.waitForSelector("[id$='--ordersTable']", { timeout: 30000 });
	await page.waitForTimeout(1500);
	check((await page.inputValue("#fioriGuideEditorTourTitle-inner")) === "Find an order from the home page", "Editor keeps the tour when the author opens another app");

	// step 2 in the app
	await pickAt(page.locator("[id$='--searchField']"));
	const firstStep = await page.locator("#fioriGuideEditor .fioriGuideEditorStepTarget").first().textContent();
	check(/Shell-home/.test(firstStep) && /Manage Sales Orders/.test(firstStep), `Steps are labeled with their app once the tour spans two apps (${firstStep.trim()})`);
	await page.fill("#fioriGuideEditorStepTitleInput-inner", "Search");
	await page.waitForTimeout(400);
	await page.screenshot({ path: `${SHOTS}/journey-recording.png` });
	await page.click("#fioriGuideEditorSave");
	await page.waitForTimeout(1200);
	const drafts = await page.evaluate(() => JSON.parse(localStorage.getItem("fiori.shepherd.guide.drafts") || "{}"));
	const draft = Object.values(drafts).find((d) => d.title === "Find an order from the home page");
	check(!!draft && draft.steps.length === 2, "Draft saved with both steps");
	check(draft && draft.intent === "Shell-home" && !draft.steps[0].app, "Tour belongs to the app it was started in");
	check(draft && draft.steps[1].app === "SalesOrder-manage", `Step added in the other app is saved with "app" (${draft && JSON.stringify(draft.steps[1].app)})`);
	check(draft && draft.steps[0].advanceOn === "click", "Tile step waits for the click");

	// the saved draft can be replayed across both apps
	await page.click("#fioriGuideEditorPreview");
	await page.waitForFunction(() => location.hash.startsWith("#Shell-home"), null, { timeout: 15000 });
	await page.waitForSelector(".shepherd-target.sapMGT", { timeout: 20000 });
	check(true, "Preview opens the tour's first app and points at the tile");
	await page.click(".shepherd-target");
	await page.waitForFunction(() => document.querySelector(".shepherd-target")?.id.endsWith("--searchField"), null, { timeout: 30000 });
	check(true, "Preview goes on in the second app after the tile click");
} catch (e) {
	failed = true;
	console.error(e);
	await page.screenshot({ path: `${SHOTS}/journey-error.png` });
}

const relevant = errors.filter((e) => /shepherd|fiori\.shepherd\.guide|guide/i.test(e));
check(relevant.length === 0, "No plugin errors in the console" + (relevant.length ? ": " + relevant.join(" | ") : ""));
await browser.close();
process.exit(failed ? 1 : 0);
