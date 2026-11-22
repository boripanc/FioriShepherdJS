// T-code step against a stricter SAP GUI mock (?strict=1): the GUI handles Enter itself before
// the field sees it and loads a new page for the transaction, like SAP GUI for HTML can.
// Start the dev server first (npm run serve), then: npm test
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = (process.env.BASE_URL || "http://localhost:8080/test/flpSandbox.html") + "?fiori-guide-editor=true";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

let failed = false;
function check(cond, msg) {
	console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
	if (!cond) failed = true;
}
const waitForStep = (sTitle, iTimeout = 15000) => page.waitForFunction((s) => {
	const el = [...document.querySelectorAll(".shepherd-element")].find((e) => e.getClientRects().length > 0);
	return el && el.querySelector(".shepherd-title")?.textContent.trim() === s;
}, sTitle, { timeout: iTimeout });

try {
	await page.goto(BASE + "#Shell-home");
	await page.evaluate(() => {
		localStorage.clear();
		localStorage.setItem("fiori.shepherd.guide.drafts", JSON.stringify({
			"strict-gui": {
				id: "strict-gui", title: "Strict GUI", intent: "SalesDocument-createGuiStrict", autoStart: true, version: 1,
				steps: [
					{ id: "tcode", title: "Start the transaction", text: "Type VA01 and press Enter.", tcode: "VA01" },
					{ id: "order-type", title: "Order type", text: "Enter OR.", target: { frame: true, selector: "[title='Sales Document Type']" }, waitFor: 8000 }
				]
			}
		}));
	});
	await page.reload();
	await page.waitForSelector("#fioriShepherdGuideHeaderButton", { timeout: 60000 });
	await page.waitForTimeout(1000);
	await page.evaluate(() => { window.location.hash = "#SalesDocument-createGuiStrict"; });
	await waitForStep("Start the transaction", 30000);
	const gui = page.frameLocator("iframe");
	await gui.locator("#ToolbarOkCode").fill("VA01");
	await gui.locator("#ToolbarOkCode").press("Enter");
	await gui.locator("h1:has-text('Create Sales Documents')").waitFor({ timeout: 10000 });
	check(true, "The strict GUI mock opened VA01 on a new page");
	await waitForStep("Order type");
	check(true, "The tour goes on after the GUI handled Enter itself and loaded a new page");
	const attached = await page.evaluate(() => !!document.querySelector(".fioriGuideFrameProxy"));
	check(attached, "The next step points at the field on the new page");
} catch (e) {
	failed = true;
	console.error(e);
	await page.screenshot({ path: "screenshots/gui-strict-error.png" });
}
const relevant = errors.filter((e) => /shepherd|fiori\.shepherd\.guide|guide/i.test(e));
check(relevant.length === 0, "No plugin errors in the console" + (relevant.length ? ": " + relevant.join(" | ") : ""));
await browser.close();
process.exit(failed ? 1 : 0);
