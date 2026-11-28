// The tour editor is an entry in the Guided Tour menu (no ?fiori-guide-editor=true needed),
// and editorUsers limits it to some SAP user IDs.
// Start the dev server first (npm run serve), then: npm test
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const SANDBOX = process.env.BASE_URL || "http://localhost:8080/test/flpSandbox.html";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

let failed = false;
function check(cond, msg) {
	console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
	if (!cond) failed = true;
}

async function menuHasEditor(sQuery) {
	await page.goto("about:blank");
	await page.goto(SANDBOX + sQuery + "#Shell-home");
	await page.waitForSelector("#fioriShepherdGuideHeaderButton", { timeout: 60000 });
	await page.waitForTimeout(1500);
	await page.click("#fioriShepherdGuideHeaderButton");
	await page.waitForTimeout(1200);
	const bEntry = await page.locator("#fioriShepherdGuideEditorEntry").isVisible();
	await page.keyboard.press("Escape");
	await page.waitForTimeout(300);
	return bEntry;
}

try {
	await page.goto(SANDBOX + "#Shell-home");
	await page.evaluate(() => localStorage.clear());

	check(await menuHasEditor("?editorUsers=*"), "Every user gets \"Add or edit guides\" in the menu without a URL flag");
	check(!(await page.locator("#fioriShepherdGuideEditorButton").count()), "No separate editor button in the shell header");

	const sUser = await page.evaluate(() => sap.ushell.Container.getServiceAsync("UserInfo").then((o) => o.getId()));
	check(await menuHasEditor("?editorUsers=" + encodeURIComponent("someone, " + sUser.toLowerCase())),
		`A user listed in editorUsers (${sUser}, any case) gets the editor`);
	check(!(await menuHasEditor("?editorUsers=SOMEONE_ELSE")), "A user not in editorUsers does not get the editor");

	await menuHasEditor("?editorUsers=*");
	await page.click("#fioriShepherdGuideHeaderButton");
	await page.click("#fioriShepherdGuideEditorEntry");
	await page.waitForSelector("#fioriGuideEditor .sapMPage", { timeout: 20000 });
	check(true, "The menu entry opens the editor");
	await page.click("#fioriShepherdGuideHeaderButton");
	await page.waitForSelector("#fioriShepherdGuideEditorEntry", { state: "visible" });
	const sText = await page.locator("#fioriShepherdGuideEditorEntry").textContent();
	check(/close/i.test(sText), `While it is open the entry closes it ("${sText.trim()}")`);
	await page.click("#fioriShepherdGuideEditorEntry");
	await page.waitForTimeout(600);
	check(!(await page.locator("#fioriGuideEditor .sapMPage").isVisible()), "Editor closes from the menu");

	const aPluginErrors = errors.filter((s) => /shepherd|guide/i.test(s));
	check(aPluginErrors.length === 0, "No plugin errors" + (aPluginErrors.length ? ": " + aPluginErrors.join(" | ") : ""));
} catch (e) {
	check(false, "Unexpected error: " + e.message);
} finally {
	await browser.close();
}
process.exit(failed ? 1 : 0);
