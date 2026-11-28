// "Follow the user": Next steps also move on when the user does the step directly in the app
// (UI5 app and SAP GUI for HTML mock, normal and strict). Start the dev server first (npm run serve).
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = (process.env.BASE_URL || "http://localhost:8080/test/flpSandbox.html") + "?fiori-guide-editor=true";
mkdirSync("screenshots", { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

let failed = false;
function check(cond, msg) {
	console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
	if (!cond) failed = true;
}
const title = () => page.evaluate(() => {
	const el = [...document.querySelectorAll(".shepherd-element")].find((e) => e.getClientRects().length > 0);
	return el ? el.querySelector(".shepherd-title")?.textContent.trim() : null;
});
const waitForStep = (sTitle, iTimeout = 15000) => page.waitForFunction((s) => {
	const el = [...document.querySelectorAll(".shepherd-element")].find((e) => e.getClientRects().length > 0);
	return el && el.querySelector(".shepherd-title")?.textContent.trim() === s;
}, sTitle, { timeout: iTimeout }).then(() => true, () => false);
const nextButtons = () => page.locator(".shepherd-element:visible .fioriGuideBtnPrimary").count();

const guiSteps = [
	{ id: "tc", title: "Transaction", text: "Type VA01 and press Enter.", target: { webgui: "okcode" }, waitFor: 15000 },
	{ id: "otype", title: "Order type", text: "Enter the order type.", target: { frame: true, selector: "[title='Sales Document Type']" }, waitFor: 8000 },
	{ id: "org", title: "Sales org", text: "Enter the sales organization.", target: { frame: true, selector: "[title='Sales Organization']" } },
	{ id: "back", title: "Back", text: "Go back.", target: { frame: true, selector: "[id='M0:36::btn[3]']" } },
	{ id: "end", title: "End", text: "Done." }
];

try {
	await page.goto(BASE + "#Shell-home");
	await page.evaluate((aSteps) => {
		localStorage.clear();
		localStorage.setItem("fiori.shepherd.guide.seen.salesorder-overview", "1");
		localStorage.setItem("fiori.shepherd.guide.seen.sales-order-gui", "2");
		localStorage.setItem("fiori.shepherd.guide.drafts", JSON.stringify({
			"follow-ui5": {
				id: "follow-ui5", title: "Follow UI5", intent: "SalesOrder-manage", autoStart: true, version: 1,
				steps: [
					{ id: "intro", title: "Intro", text: "Welcome." },
					{ id: "search", title: "Search", text: "Search for Domestic.", target: { controlId: "searchField" } },
					{ id: "filter", title: "Filter", text: "Only Next here.", target: { controlId: "statusFilter" }, followUser: false },
					{ id: "create", title: "Create", text: "Click Create.", target: { selector: ".sapMBtn:has(.sapMBtnEmphasized)" } },
					{ id: "customer", title: "Customer", text: "Enter a customer.", target: { controlId: "newCustomer" } },
					{ id: "save", title: "Save", text: "Save the order.", target: { selector: ".sapMDialog .sapMBtn:has(.sapMBtnEmphasized)" } },
					{ id: "table", title: "Table", text: "Your orders.", target: { controlId: "ordersTable" } },
					{ id: "end", title: "End", text: "Done." }
				]
			},
			"follow-gui": { id: "follow-gui", title: "Follow GUI", intent: "SalesDocument-createGui", autoStart: true, version: 1, modal: false, steps: aSteps },
			"follow-gui-strict": { id: "follow-gui-strict", title: "Follow GUI strict", intent: "SalesDocument-createGuiStrict", autoStart: true, version: 1, modal: false, steps: aSteps }
		}));
	}, guiSteps);
	await page.reload();
	await page.waitForSelector("#fioriShepherdGuideHeaderButton", { timeout: 60000 });
	await page.waitForTimeout(1000);

	// UI5 app
	await page.evaluate(() => { window.location.hash = "#SalesOrder-manage"; });
	check(await waitForStep("Intro", 30000), "UI5 tour started");
	await page.waitForTimeout(500);
	check(await nextButtons() === 1, "A follow step keeps its Next button");
	await page.mouse.click(1200, 600); // somewhere in the app, nothing new appears
	await page.waitForTimeout(1200);
	check(await title() === "Intro", "A click that changes nothing does not move the tour on");
	await page.click(".shepherd-element:visible .fioriGuideBtnPrimary");
	check(await waitForStep("Search"), "Next still works");

	const search = page.locator("[id$='--searchField'] input").first();
	await search.click();
	await page.waitForTimeout(500);
	check(await title() === "Search", "Clicking into a field does not move on");
	await search.pressSequentially("Domestic");
	await search.press("Enter");
	check(await waitForStep("Filter"), "Enter in the highlighted field moves on");

	await page.locator("[id$='--statusFilter'] .sapMSegBBtn").nth(1).click();
	await page.waitForTimeout(1000);
	check(await title() === "Filter", "followUser: false keeps the step until Next");
	await page.click(".shepherd-element:visible .fioriGuideBtnPrimary");
	check(await waitForStep("Create"), "Next on the opt-out step");

	await page.locator(".sapMBtn:has(.sapMBtnEmphasized)").first().click();
	check(await waitForStep("Customer"), "Clicking the highlighted button moves on (dialog step)");
	await page.screenshot({ path: "screenshots/follow-1-dialog.png" });
	const customer = page.locator("[id$='--newCustomer'] input").first();
	await customer.pressSequentially("ACME");
	await customer.press("Tab");
	check(await waitForStep("Save"), "Typing a value and leaving the field moves on");
	await page.locator(".sapMDialog .sapMBtn:has(.sapMBtnEmphasized)").first().click();
	check(await waitForStep("Table"), "Clicking Save in the dialog moves on");
	await page.click(".shepherd-element:visible .fioriGuideBtnPrimary");
	check(await waitForStep("End"), "End step");
	await page.click(".shepherd-element:visible .fioriGuideBtnPrimary");

	for (const [sIntent, sName] of [["SalesDocument-createGui", "GUI"], ["SalesDocument-createGuiStrict", "strict GUI"]]) {
		await page.evaluate((s) => { window.location.hash = "#" + s; }, sIntent);
		check(await waitForStep("Transaction", 30000), `${sName}: tour started`);
		const gui = page.frameLocator("iframe");
		await gui.locator("#ToolbarOkCode").pressSequentially("VA01");
		await gui.locator("#ToolbarOkCode").press("Enter");
		check(await waitForStep("Order type"), `${sName}: the user started VA01 and the tour moved on`);
		await page.waitForTimeout(400);
		await gui.locator("[title='Sales Document Type']").fill("");
		await gui.locator("[title='Sales Document Type']").pressSequentially("OR");
		await gui.locator("[title='Sales Document Type']").press("Tab");
		check(await waitForStep("Sales org"), `${sName}: typing in a GUI field and Tab moves on`);
		await gui.locator("[id='M0:36::btn[3]']").click(); // not modal: the user leaves the screen themselves
		check(await waitForStep("Back", 5000), `${sName}: the screen changed away (field gone, next element there) moves on`);
		await page.waitForTimeout(500);
		await page.click(".shepherd-element:visible .fioriGuideBtnPrimary");
		check(await waitForStep("End"), `${sName}: End step`);
		await page.screenshot({ path: `screenshots/follow-gui-${sName.replace(/\s/g, "-")}.png` });
		await page.click(".shepherd-element:visible .fioriGuideBtnPrimary");
		await page.evaluate(() => { window.location.hash = "#Shell-home"; });
		await page.waitForTimeout(1500);
	}
	const relevant = errors.filter((e) => /shepherd|fiori\.shepherd\.guide|guide/i.test(e));
	check(relevant.length === 0, "No plugin errors in the console" + (relevant.length ? ": " + relevant.join(" | ") : ""));
} catch (e) {
	console.log("FAIL  " + e.message);
	failed = true;
	await page.screenshot({ path: "screenshots/follow-error.png" });
} finally {
	await browser.close();
}
process.exit(failed ? 1 : 0);
