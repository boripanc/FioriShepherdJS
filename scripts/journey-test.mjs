// A tour that goes across apps and survives a page reload (test/tours/order-journey.json).
// Start the dev server first (npm run serve), then: npm test
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
const visibleStep = ".shepherd-element:visible";
const stepTitle = async () => (await page.locator(`${visibleStep} .shepherd-title`).textContent()).trim();
const waitForStep = async (sTitle, iTimeout = 30000) => {
	await page.waitForFunction((s) => {
		const el = [...document.querySelectorAll(".shepherd-element")].find((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden");
		return el && el.querySelector(".shepherd-title")?.textContent.trim() === s;
	}, sTitle, { timeout: iTimeout });
};
const session = () => page.evaluate(() => JSON.parse(sessionStorage.getItem("fiori.shepherd.guide.session") || "null"));
const openFromHeader = async (sButtonText) => {
	await page.click("#fioriShepherdGuideHeaderButton");
	await page.click(`.sapMActionSheet .sapMBtn:has-text("${sButtonText}")`, { timeout: 10000 });
};

try {
	await page.goto(BASE + "#Shell-home");
	await page.waitForSelector("#fioriShepherdGuideHeaderButton", { timeout: 60000 });
	await page.waitForTimeout(1500);
	await openFromHeader("From the Launchpad to a sales order");
	await waitForStep("From the Launchpad to SAP GUI", 10000);
	check(true, "Journey tour starts on the Launchpad home page");
	await page.click(`${visibleStep} .fioriGuideBtnPrimary`);
	await waitForStep("Open the app", 10000);
	check((await page.evaluate(() => document.querySelector(".shepherd-target")?.className || "")).includes("sapMGT"), "Step points at the app tile");
	await page.waitForTimeout(400);
	await page.screenshot({ path: `${SHOTS}/journey-1-tile.png` });

	// 1) across apps: clicking the tile opens the app and the tour goes on there
	await page.click(".shepherd-target");
	await waitForStep("Check existing orders");
	check(page.url().includes("#SalesOrder-manage"), "Clicking the tile opened the app");
	const target = await page.evaluate(() => document.querySelector(".shepherd-target")?.id || "");
	check(target.endsWith("--searchField"), `Tour goes on in the app it opened (${target})`);
	check(await page.locator(`${visibleStep} .fioriGuideBtnSecondary`).count() === 0, "No Back button into the previous app");
	check((await session())?.index === 2, "Progress is kept in sessionStorage");
	await page.waitForTimeout(400);
	await page.screenshot({ path: `${SHOTS}/journey-2-in-app.png` });

	// 2) full page reload: the tour comes back at the same step
	await page.reload();
	await waitForStep("Check existing orders", 60000);
	check(true, "After a page reload the tour continues at the same step");

	// 3) Next into the SAP GUI app opens that app, and the tour goes on there
	await page.click(`${visibleStep} .fioriGuideBtnPrimary`);
	await waitForStep("Create the order in SAP GUI", 10000);
	await page.click(`${visibleStep} .fioriGuideBtnPrimary`);
	await waitForStep("Order type");
	check(page.url().includes("#Shell-startGUI?sap-ui2-tcode=VA01"), "Next opened the SAP GUI transaction named by the step");
	await page.waitForTimeout(400);
	await page.screenshot({ path: `${SHOTS}/journey-3-gui.png` });

	// 4) leaving for an unrelated page pauses the tour; returning resumes it
	await page.evaluate(() => { window.location.hash = "#Shell-home"; });
	await page.waitForTimeout(2500);
	check(await page.locator(visibleStep).count() === 0, "Going to another app pauses the tour (nothing shown)");
	check((await session())?.index === 4, "The paused step is remembered");
	await page.click("#fioriShepherdGuideHeaderButton");
	await page.waitForSelector("#fioriShepherdGuideContinue", { timeout: 10000 });
	check(/Continue .*step 5 of 5/.test(await page.locator("#fioriShepherdGuideContinue").textContent()), "Header button offers to continue the paused tour");
	await page.waitForTimeout(400);
	await page.screenshot({ path: `${SHOTS}/journey-4-continue.png` });
	await page.click("#fioriShepherdGuideContinue");
	await waitForStep("Order type", 15000);
	check(page.url().includes("#Shell-startGUI?sap-ui2-tcode=VA01"), "Continue opens the app of the paused step and the tour goes on");

	const gui = page.frameLocator("iframe");
	await gui.locator("[title='Sales Document Type']").type("OR");
	await page.waitForTimeout(1500);
	check(await page.locator(visibleStep).count() === 0, "Last step finishes the tour");
	check(await session() === null, "Finished tour is no longer kept");
	check(await page.evaluate(() => localStorage.getItem("fiori.shepherd.guide.seen.order-journey")) === "1", "Finished tour is remembered as seen");

	// 5) closing a tour (X) ends it for good: no resume after a reload
	await page.evaluate(() => { window.location.hash = "#Shell-home"; });
	await page.waitForTimeout(1500);
	await openFromHeader("From the Launchpad to a sales order");
	await waitForStep("From the Launchpad to SAP GUI", 10000);
	await page.click(`${visibleStep} .shepherd-cancel-icon`);
	check(await session() === null, "Closing the tour forgets it");
	await page.reload();
	await page.waitForSelector("#fioriShepherdGuideHeaderButton", { timeout: 60000 });
	await page.waitForTimeout(3000);
	check(await page.locator(visibleStep).count() === 0, "A closed tour does not come back after a reload");
} catch (e) {
	failed = true;
	console.error(e);
	await page.waitForTimeout(500);
	await page.screenshot({ path: `${SHOTS}/journey-error.png` });
}

const relevant = errors.filter((e) => /shepherd|fiori\.shepherd\.guide|guide/i.test(e));
check(relevant.length === 0, "No plugin errors in the console" + (relevant.length ? ": " + relevant.join(" | ") : ""));
await browser.close();
process.exit(failed ? 1 : 0);
