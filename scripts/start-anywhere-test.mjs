// Starting a guide from anywhere: "All guides" in the Guided Tour button, and the plugin
// taking the user to the guide's start page (hash, hash with parameters, or another URL).
// Start the dev server first (npm run serve), then: npm test
import { toggleEditor } from "./editor-menu.mjs";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const SANDBOX = process.env.BASE_URL || "http://localhost:8080/test/flpSandbox.html";
const BASE = SANDBOX + "?fiori-guide-editor=true";
const SHOTS = "screenshots";
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

let failed = false;
function check(cond, msg) {
	console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
	if (!cond) failed = true;
}
const waitForStep = (sTitle, iTimeout = 30000) => page.waitForFunction((s) => {
	const el = [...document.querySelectorAll(".shepherd-element")].find((e) => e.getClientRects().length > 0);
	return el && el.querySelector(".shepherd-title")?.textContent.trim() === s;
}, sTitle, { timeout: iTimeout });
const ready = async () => {
	await page.waitForSelector("#fioriShepherdGuideHeaderButton", { timeout: 60000 });
	await page.waitForTimeout(1500);
};
const chooseFromAllGuides = async (sTitle) => {
	await page.click("#fioriShepherdGuideHeaderButton");
	const all = page.locator("#fioriShepherdGuideAllGuides");
	if (await all.isVisible({ timeout: 3000 }).catch(() => false)) {
		await all.click();
	}
	await page.waitForSelector("#fioriShepherdGuideAllGuidesDialog-dialog .sapMSLI", { timeout: 10000 });
	await page.fill("#fioriShepherdGuideAllGuidesDialog-searchField-I", sTitle.slice(0, 12));
	await page.waitForTimeout(500);
	await page.click(`#fioriShepherdGuideAllGuidesDialog-dialog .sapMSLI:has-text("${sTitle}")`);
};
const DRAFTS = {
	"we02-like": {
		id: "we02-like", title: "Guide with a start page", intent: "SalesDocument-createGui", autoStart: false, version: 1,
		start: "#SalesDocument-createGui?mode=demo",
		steps: [{ id: "s1", title: "Started on the start page", text: "The guide took you here." }]
	},
	"other-url": {
		id: "other-url", title: "Guide on another Launchpad URL", intent: "SalesOrder-manage", autoStart: false, version: 1,
		start: "flpSandbox.html?fiori-guide-editor=true&demo=1#SalesOrder-manage",
		steps: [{ id: "s1", title: "Opened from another URL", text: "The guide opened another Launchpad URL.", target: { controlId: "searchField" } }]
	}
};

try {
	await page.goto(BASE + "#Shell-home");
	await page.evaluate((d) => {
		localStorage.clear();
		["salesorder-overview", "sales-order-gui"].forEach((id) => localStorage.setItem("fiori.shepherd.guide.seen." + id, "1"));
		localStorage.setItem("fiori.shepherd.guide.drafts", JSON.stringify(d));
	}, DRAFTS);
	await page.reload();
	await ready();

	// 1) a guide of another app, started from the home page
	await page.click("#fioriShepherdGuideHeaderButton");
	await page.waitForSelector("#fioriShepherdGuideAllGuides", { timeout: 10000 });
	check(true, "The Guided Tour button offers \"All guides\"");
	await page.click("#fioriShepherdGuideAllGuides");
	await page.waitForSelector("#fioriShepherdGuideAllGuidesDialog-dialog .sapMSLI", { timeout: 10000 });
	const n = await page.locator("#fioriShepherdGuideAllGuidesDialog-dialog .sapMSLI").count();
	check(n >= 5, `All guides lists every guide (${n})`);
	await page.fill("#fioriShepherdGuideAllGuidesDialog-searchField-I", "SAP GUI");
	await page.waitForTimeout(600);
	const nFiltered = await page.locator("#fioriShepherdGuideAllGuidesDialog-dialog .sapMSLI").count();
	check(nFiltered > 0 && nFiltered < n, `Search narrows the list (${nFiltered})`);
	await page.screenshot({ path: `${SHOTS}/all-guides.png` });
	await page.click(`#fioriShepherdGuideAllGuidesDialog-dialog .sapMSLI:has-text("Create a sales order in SAP GUI")`);
	await waitForStep("Create a sales order");
	check(page.url().includes("#Shell-startGUI?sap-ui2-tcode=VA01"), "Choosing a guide of another app opens its start page and starts the guide");
	await page.click(".shepherd-element:visible .shepherd-cancel-icon");

	// 2) a start page with parameters: offered everywhere, belongs only to that exact page
	await page.waitForTimeout(800);
	const here = await page.evaluate(() => sap.ui.getCore().getEventBus && true);
	await page.click("#fioriShepherdGuideHeaderButton");
	await page.waitForTimeout(600);
	const inChooser = await page.locator(".sapMActionSheet .sapMBtn:has-text('Guide with a start page')").count();
	check(here && inChooser === 0, "A guide whose start page has parameters is not listed for the same app without them");
	await page.keyboard.press("Escape");
	await page.waitForTimeout(400);
	await chooseFromAllGuides("Guide with a start page");
	await waitForStep("Started on the start page");
	check(/#SalesDocument-createGui\?mode=demo/.test(page.url()), `The guide opened its start page with its parameters (${page.url().split("#")[1]})`);
	await page.click(".shepherd-element:visible .shepherd-cancel-icon");

	// 3) a start page on another URL: a new page load, then the guide begins
	await page.evaluate(() => { window.location.hash = "#Shell-home"; });
	await ready();
	await chooseFromAllGuides("Guide on another Launchpad URL");
	await page.waitForURL(/demo=1/, { timeout: 30000 });
	await waitForStep("Opened from another URL", 60000);
	const target = await page.evaluate(() => document.querySelector(".shepherd-target")?.id || "");
	check(target.endsWith("--searchField"), "After loading the other URL the guide begins on its first step");
	await page.click(".shepherd-element:visible .shepherd-cancel-icon");

	// 4) the editor fills in a start page for new guides
	await toggleEditor(page);
	await page.waitForSelector("#fioriGuideEditor .sapMPage", { timeout: 20000 });
	await page.waitForTimeout(800);
	await page.click("#fioriGuideEditor .sapMSlt");
	await page.click(".sapMSelectList li:has-text('+ New tour')");
	await page.waitForTimeout(400);
	check((await page.inputValue("#fioriGuideEditorStartPage-inner")) === "#SalesOrder-manage", "A new guide gets the current page as its start page");
} catch (e) {
	failed = true;
	console.error(e);
	await page.screenshot({ path: `${SHOTS}/start-anywhere-error.png` });
}
const relevant = errors.filter((e) => /shepherd|fiori\.shepherd\.guide|guide/i.test(e));
check(relevant.length === 0, "No plugin errors in the console" + (relevant.length ? ": " + relevant.join(" | ") : ""));
await browser.close();
process.exit(failed ? 1 : 0);
