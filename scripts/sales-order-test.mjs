// Plays the VA01 sales order tour (test/tours/sales-order-gui.json) end to end against the mock
// SAP GUI for HTML. Start the dev server first (npm run serve), then: node scripts/sales-order-test.mjs
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://localhost:8080/test/flpSandbox.html";
const SHOTS = process.env.SHOTS || "screenshots/sales-order";
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: Number(process.env.DPR || 1) });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

let failed = false;
function check(cond, msg) {
	console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
	if (!cond) failed = true;
}
const visibleStep = () => page.locator(".shepherd-element:visible");
const waitForStep = (sTitle, iTimeout = 15000) => page.waitForFunction((s) => {
	const el = [...document.querySelectorAll(".shepherd-element")].find((e) => e.getClientRects().length > 0);
	return el && el.querySelector(".shepherd-title")?.textContent.trim() === s;
}, sTitle, { timeout: iTimeout });
// the step is attached to an element (not shown in the middle of the screen)
const attached = () => page.evaluate(() => {
	const el = [...document.querySelectorAll(".shepherd-element")].find((e) => e.getClientRects().length > 0);
	return !!el && el.hasAttribute("data-popper-placement");
});
const next = () => visibleStep().locator(".fioriGuideBtnPrimary").click();
let iShot = 0;
const shot = async (name) => { await page.waitForTimeout(900); await page.screenshot({ path: `${SHOTS}/${++iShot}-${name}.png` }); };

try {
	await page.goto(BASE + "#Shell-home");
	await page.evaluate(() => {
		localStorage.clear();
		localStorage.setItem("fiori.shepherd.guide.seen.salesorder-overview", "1");
	});
	await page.reload();
	await page.waitForSelector("#fioriShepherdGuideHeaderButton", { timeout: 60000 });
	// the guide's start page, as on an ABAP front-end server
	await page.evaluate(() => { window.location.hash = "#Shell-startGUI?sap-ui2-tcode=VA01"; });
	await waitForStep("Create a sales order", 30000);
	check(true, "Tour starts when VA01 is opened with #Shell-startGUI?sap-ui2-tcode=VA01");
	await shot("welcome");
	await next();

	const gui = page.frameLocator("iframe");
	await waitForStep("Order type");
	check((await gui.locator("h1").textContent()) === "Create Sales Documents", "SAP GUI opened VA01 directly");
	check(await attached(), "Order type step points at the field");
	await shot("order-type");
	await gui.locator("[title='Sales Document Type']").type("OR");

	for (const [title, sel, val] of [
		["Sales organization", "Sales Organization", "1010"],
		["Distribution channel", "Distribution Channel", "10"],
		["Division", "Division", "00"]
	]) {
		await waitForStep(title);
		check(await attached(), `${title} step points at the field`);
		if (title === "Sales organization") await shot("sales-org");
		await gui.locator(`[title='${sel}']`).fill(val);
		await next();
	}

	await waitForStep("Go to the order");
	check(await attached(), "Enter step points at the Enter button");
	await shot("to-overview");
	await gui.locator("[id='M0:36::btn[0]']").click();

	await waitForStep("Sold-to party");
	check((await gui.locator("h1").textContent()) === "Create Standard Order: Overview", "Overview screen is open");
	check(await attached(), "Sold-to party step points at the field");
	await shot("sold-to");
	await gui.locator("[title='Sold-To Party']").fill("17100001");
	await next();

	for (const [title, val] of [
		["Ship-to party", null],
		["Customer reference", "PO-2026-001"],
		["Requested delivery date", "15.12.2026"],
		["Material", "TG11"],
		["Order quantity", "5"]
	]) {
		await waitForStep(title);
		check(await attached(), `${title} step points at the field`);
		if (title === "Material") await shot("material");
		if (val) {
			const map = { "Customer reference": "Customer Reference", "Requested delivery date": "Requested delivery date", "Material": "Material", "Order quantity": "Order Quantity" };
			await gui.locator(`[title='${map[title]}']`).first().fill(val);
		}
		await next();
	}

	await waitForStep("Check the item");
	await next();
	await waitForStep("Save the order");
	check(await attached(), "Save step points at the Save button");
	await shot("save");
	await gui.locator("[id='M0:36::btn[11]']").click();

	await waitForStep("Order created");
	check(/4711 has been saved/.test(await gui.locator("[id='wnd[0]/sbar']").textContent()), "Order is saved in the mock");
	await shot("done");
	await next();
	await page.waitForTimeout(600);
	check(await visibleStep().count() === 0, "Done closes the tour");
} catch (e) {
	failed = true;
	console.error(e);
	await page.screenshot({ path: `${SHOTS}/error.png` });
}

const relevant = errors.filter((e) => /shepherd|fiori\.shepherd\.guide|guide/i.test(e));
check(relevant.length === 0, "No plugin errors in the console" + (relevant.length ? ": " + relevant.join(" | ") : ""));
await browser.close();
process.exit(failed ? 1 : 0);
