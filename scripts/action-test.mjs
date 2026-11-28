// Steps the guide does for the user: fillValue (+ pressEnter) and autoClick, in a UI5 app and in
// the SAP GUI for HTML mock. Start the dev server first (npm run serve), then: npm test
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
const waitForStep = (sTitle, iTimeout = 15000) => page.waitForFunction((s) => {
	const el = [...document.querySelectorAll(".shepherd-element")].find((e) => e.getClientRects().length > 0);
	return el && el.querySelector(".shepherd-title")?.textContent.trim() === s;
}, sTitle, { timeout: iTimeout });
const nextButtons = () => page.locator(".shepherd-element:visible .fioriGuideBtnPrimary").count();

try {
	await page.goto(BASE + "#Shell-home");
	await page.evaluate(() => {
		localStorage.clear();
		localStorage.setItem("fiori.shepherd.guide.seen.salesorder-overview", "1");
		localStorage.setItem("fiori.shepherd.guide.seen.sales-order-gui", "1");
		localStorage.setItem("fiori.shepherd.guide.drafts", JSON.stringify({
			"auto-ui5": {
				id: "auto-ui5", title: "Auto UI5", intent: "SalesOrder-manage", autoStart: true, version: 1,
				steps: [
					{ id: "search", title: "Search", text: "The guide searches for you.", target: { controlId: "searchField" }, fillValue: "Domestic", pressEnter: true, actionDelay: 600 },
					{ id: "create", title: "Create", text: "The guide opens the dialog.", target: { selector: ".sapMBtn:has(.sapMBtnEmphasized)" }, autoClick: true, actionDelay: 600 },
					{ id: "customer", title: "Customer", text: "A sample customer.", target: { controlId: "newCustomer" }, fillValue: "ACME Corp", actionDelay: 300 },
					{ id: "end", title: "End", text: "Done." }
				]
			},
			"auto-gui": {
				id: "auto-gui", title: "Auto GUI", intent: "SalesDocument-createGui", autoStart: true, version: 1,
				steps: [
					{ id: "tc", title: "Transaction", text: "The guide starts VA01.", target: { webgui: "okcode" }, fillValue: "VA01", pressEnter: true, actionDelay: 300, waitFor: 15000 },
					{ id: "otype", title: "Order type", text: "Sample order type.", target: { frame: true, selector: "[title='Sales Document Type']" }, fillValue: "OR", actionDelay: 300, waitFor: 8000 },
					{ id: "enter", title: "Continue", text: "The guide goes back.", target: { frame: true, selector: "[id='M0:36::btn[3]']" }, autoClick: true, actionDelay: 300 },
					{ id: "end", title: "End", text: "Done." }
				]
			}
		}));
	});
	await page.reload();
	await page.waitForSelector("#fioriShepherdGuideHeaderButton", { timeout: 60000 });
	await page.waitForTimeout(1000);

	// UI5 app
	await page.evaluate(() => { window.location.hash = "#SalesOrder-manage"; });
	await waitForStep("Search", 30000);
	await page.locator(".shepherd-element:visible .fioriGuideAuto").first().waitFor({ timeout: 5000 }).catch(() => {});
	check(await page.locator(".shepherd-element:visible .fioriGuideAuto").count() === 1, "An auto step says the guide does it");
	check(await nextButtons() === 0, "An auto step has no Next button");
	await page.screenshot({ path: "screenshots/auto-1-search.png" });
	await waitForStep("Create");
	const search = await page.evaluate(() => {
		const oField = sap.ui.getCore().byId(document.querySelector("[id$='--searchField']").id);
		const oTable = sap.ui.getCore().byId(document.querySelector("[id$='--ordersTable']").id);
		return { value: oField.getValue(), rows: oTable.getItems().length };
	});
	check(search.value === "Domestic", `fillValue set the UI5 SearchField value (${search.value})`);
	check(search.rows > 0 && search.rows < 4, `pressEnter ran the app's search (${search.rows} rows)`);
	await waitForStep("Customer");
	check(await page.locator(".sapMDialog:visible").count() === 1, "autoClick pressed the Create button and the dialog opened");
	await page.waitForSelector("[data-shepherd-step-id='customer'] .fioriGuideAutoDone", { timeout: 5000 });
	const customer = await page.evaluate(() => sap.ui.getCore().byId(document.querySelector("[id$='--newCustomer']").id).getValue());
	check(customer === "ACME Corp", `fillValue filled the dialog input (${customer})`);
	check(await nextButtons() === 1, "A fill-only step keeps its Next button");
	await page.screenshot({ path: "screenshots/auto-2-dialog.png" });
	await page.click(".shepherd-element:visible .fioriGuideBtnPrimary");
	await waitForStep("End");
	await page.click(".shepherd-element:visible .fioriGuideBtnPrimary");
	await page.keyboard.press("Escape");

	// SAP GUI for HTML mock
	await page.evaluate(() => { window.location.hash = "#SalesDocument-createGui"; });
	await waitForStep("Transaction", 30000);
	const gui = page.frameLocator("iframe");
	await gui.locator("h1:has-text('Create Sales Documents')").waitFor({ timeout: 10000 });
	check(true, "fillValue + pressEnter started VA01 in the GUI mock");
	await waitForStep("Order type");
	await page.waitForTimeout(800);
	check(await gui.locator("[title='Sales Document Type']").inputValue() === "OR", "fillValue filled a SAP GUI field");
	await page.click(".shepherd-element:visible .fioriGuideBtnPrimary");
	await waitForStep("Continue");
	await waitForStep("End");
	check(true, "autoClick on a SAP GUI element goes on by itself");
	await page.screenshot({ path: "screenshots/auto-3-gui.png" });
} catch (e) {
	failed = true;
	console.error(e);
	await page.screenshot({ path: "screenshots/auto-error.png" });
}
const relevant = errors.filter((e) => /shepherd|fiori\.shepherd\.guide|guide/i.test(e));
check(relevant.length === 0, "No plugin errors in the console" + (relevant.length ? ": " + relevant.join(" | ") : ""));
await browser.close();
process.exit(failed ? 1 : 0);
