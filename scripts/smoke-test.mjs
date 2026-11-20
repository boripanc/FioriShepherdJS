// End-to-end smoke test in the Launchpad sandbox.
// Start the dev server first (npm run serve), then: npm test
// Uses Playwright (any installed version): npm i -D playwright, if it is not available globally.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://localhost:8080/test/flpSandbox.html";
const SHOTS = "screenshots";
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
const stepTitle = () => page.locator(".shepherd-element:visible .shepherd-title").textContent();

try {
	// Launchpad home: header button exists (a home tour is configured, autoStart false)
	await page.goto(BASE + "#Shell-home");
	await page.waitForSelector("#fioriShepherdGuideHeaderButton", { timeout: 60000 });
	check(true, "Guided Tour button is in the shell header on the home page");
	await page.waitForTimeout(1500);
	check(await page.locator(".shepherd-element").count() === 0, "Home tour does not auto-start");
	await page.click("#fioriShepherdGuideHeaderButton");
	await page.waitForSelector(".shepherd-element", { timeout: 10000 });
	check((await stepTitle()).trim() === "Welcome!", "Home tour starts from the header button");
	await page.waitForTimeout(500);
	await page.screenshot({ path: `${SHOTS}/1-home-tour.png` });
	await page.click(".shepherd-element:visible .shepherd-cancel-icon");
	check(await page.locator(".shepherd-element:visible").count() === 0, "Close icon ends the tour");

	// Open the demo app: the sales order tour auto-starts once
	await page.evaluate(() => { window.location.hash = "#SalesOrder-manage"; });
	await page.waitForSelector(".shepherd-element", { timeout: 30000 });
	check((await stepTitle()).trim() === "Manage Sales Orders", "App tour auto-starts on first visit");
	await page.waitForTimeout(500);
	await page.screenshot({ path: `${SHOTS}/2-app-intro.png` });

	await page.click(".shepherd-element:visible .fioriGuideBtnPrimary");
	await page.waitForTimeout(800);
	check((await stepTitle()).trim() === "Search for orders", "Next goes to step 2");
	const attached = await page.evaluate(() => document.querySelector(".shepherd-target")?.id || "");
	check(attached.endsWith("--searchField"), `Step 2 highlights the search field by controlId (${attached})`);
	await page.waitForTimeout(500);
	await page.screenshot({ path: `${SHOTS}/3-search-step.png` });

	await page.click(".shepherd-element:visible .fioriGuideBtnPrimary");
	await page.waitForTimeout(800);
	await page.click(".shepherd-element:visible .fioriGuideBtnPrimary");
	await page.waitForTimeout(800);
	check((await stepTitle()).trim() === "Create an order", "Step 4 targets the Create button by type + text");
	check(await page.locator(".shepherd-element:visible .fioriGuideBtnPrimary").count() === 0, "advanceOn step hides the Next button");
	await page.waitForTimeout(500);
	await page.screenshot({ path: `${SHOTS}/4-create-step.png` });

	await page.click(".shepherd-target");
	await page.waitForTimeout(1500);
	check((await stepTitle()).trim() === "Enter the details", "Clicking Create advances the tour and the dialog step waits for the dialog");
	await page.waitForTimeout(500);
	await page.screenshot({ path: `${SHOTS}/5-dialog-step.png` });

	await page.click(".shepherd-element:visible .fioriGuideBtnPrimary");
	await page.waitForTimeout(800);
	check(await page.locator(".shepherd-element:visible").count() === 0, "skipIfMissing step is skipped and the tour completes");
	const seen = await page.evaluate(() => localStorage.getItem("fiori.shepherd.guide.seen.salesorder-overview"));
	check(seen === "1", "Finished tour is remembered");

	// Reload the app: no auto-start the second time
	await page.reload();
	await page.waitForSelector("#fioriShepherdGuideHeaderButton", { timeout: 60000 });
	await page.waitForTimeout(3000);
	check(await page.locator(".shepherd-element:visible").count() === 0, "Tour does not auto-start again");

	// Two tours match this app -> the header button offers a choice
	await page.click("#fioriShepherdGuideHeaderButton");
	await page.waitForSelector(".sapMActionSheet", { timeout: 10000 });
	check(await page.locator(".sapMActionSheet .sapMBtn").count() >= 2, "Header button lists both app tours");
	await page.waitForTimeout(500);
	await page.screenshot({ path: `${SHOTS}/6-chooser.png` });
} catch (e) {
	failed = true;
	console.error(e);
	await page.waitForTimeout(500);
	await page.screenshot({ path: `${SHOTS}/error.png` });
}

const relevant = errors.filter((e) => /shepherd|fiori\.shepherd\.guide|guide/i.test(e));
check(relevant.length === 0, "No plugin errors in the console" + (relevant.length ? ": " + relevant.join(" | ") : ""));
if (errors.length) console.log("Other console errors (sandbox noise):\n  " + errors.slice(0, 8).join("\n  "));
await browser.close();
process.exit(failed ? 1 : 0);
