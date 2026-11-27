// End-to-end test of the point-and-click tour editor in the Launchpad sandbox.
// Start the dev server first (npm run serve), then: node scripts/editor-test.mjs
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = (process.env.BASE_URL || "http://localhost:8080/test/flpSandbox.html") + "?fiori-guide-editor=true";
const SHOTS = "screenshots/editor";
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

let failed = false;
function check(cond, msg) {
	console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
	if (!cond) failed = true;
}
const shot = async (name) => { await page.waitForTimeout(600); await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const visibleStep = () => page.locator(".shepherd-element:visible .shepherd-title").textContent();

try {
	// don't let the existing demo tour auto-start
	await page.goto(BASE + "#Shell-home");
	await page.evaluate(() => {
		localStorage.clear();
		localStorage.setItem("fiori.shepherd.guide.seen.salesorder-overview", "1");
	});
	await page.goto(BASE + "#SalesOrder-manage");
	await page.waitForSelector("#fioriShepherdGuideEditorButton", { timeout: 60000 });
	check(true, "Editor button is in the shell header when ?fiori-guide-editor=true");
	await page.waitForSelector("[id$='--ordersTable']", { timeout: 30000 });

	await page.click("#fioriShepherdGuideEditorButton");
	await page.waitForSelector("#fioriGuideEditor .sapMPage", { timeout: 20000 });
	await page.waitForTimeout(800);
	check(true, "Editor panel opens");
	await shot("1-editor-open");

	// start a new tour
	await page.click("#fioriGuideEditor .sapMSlt");
	await page.click(".sapMSelectList li:has-text('+ New tour')");
	await page.waitForTimeout(400);
	await page.fill("#fioriGuideEditorTourTitle-inner", "Filter orders by status");

	// step 1: pick the status filter
	await page.click("#fioriGuideEditorAddStep");
	await page.waitForTimeout(300);
	const filter = page.locator("[id$='--statusFilter']");
	const fb = await filter.boundingBox();
	await page.mouse.move(fb.x + 20, fb.y + fb.height / 2);
	await page.waitForTimeout(300);
	await shot("2-picking-element");
	await page.mouse.click(fb.x + 20, fb.y + fb.height / 2);
	await page.waitForTimeout(500);
	const targetLabel = async () => (await page.locator(".fioriGuideEditorStepForm .fioriGuideEditorTarget .sapMObjStatusText").textContent()).trim();
	const label0 = await targetLabel();
	check(/Button.*All/.test(label0), `Clicking a segment picks that segment by type + text (${label0})`);
	await page.click("#fioriGuideEditorWiden");
	await page.waitForTimeout(500);
	const label1 = await targetLabel();
	check(/statusFilter/.test(label1), `"Larger area" moves to the whole filter, found by its stable id (${label1})`);
	await page.fill("#fioriGuideEditorStepTitleInput-inner", "Filter by status");
	await page.fill("#fioriGuideEditorStepTextInput-inner", "Choose Open to see only the orders that still need your attention.");

	// step 2: pick the Create button (has a generated id -> type + text).
	// It is under the panel, so move the panel to the left first.
	await page.click("#fioriGuideEditorDock");
	await page.click("#fioriGuideEditorAddStep");
	await page.waitForTimeout(300);
	const create = page.locator("[id$='--page'] .sapMBtn:has-text('Create')");
	const cb = await create.boundingBox();
	await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
	await page.mouse.click(cb.x + cb.width / 2, cb.y + cb.height / 2);
	await page.waitForTimeout(500);
	const dialogOpen = await page.locator("[id$='--createDialog']").isVisible().catch(() => false);
	check(!dialogOpen, "Click while picking does not reach the app");
	const label2 = await targetLabel();
	check(/Button.*Create/.test(label2), `Element without own id falls back to type + text (${label2})`);
	await page.fill("#fioriGuideEditorStepTitleInput-inner", "Create a new order");
	await page.fill("#fioriGuideEditorStepTextInput-inner", "When you need a new order, start here.");
	// "the guide clicks it for the user" with a value to fill in, saved as autoClick / fillValue
	await page.click("#fioriGuideEditorAdvance");
	await page.click(".sapMSelectList li:has-text('The guide clicks the element for the user')");
	await page.fill("#fioriGuideEditorFillValue-inner", "Sample");
	check(!(await page.locator("#fioriGuideEditorPressEnter").isVisible()), "Press Enter is not offered when the guide clicks anyway");
	await page.click("#fioriGuideEditorSave");
	await page.waitForTimeout(1200);
	const autoDraft = Object.values(await page.evaluate(() => JSON.parse(localStorage.getItem("fiori.shepherd.guide.drafts") || "{}")))[0];
	check(autoDraft && autoDraft.steps[1].autoClick === true && autoDraft.steps[1].fillValue === "Sample" && !autoDraft.steps[1].advanceOn,
		"A step the guide clicks is saved with autoClick and fillValue");
	// saving reloads the tour: open step 2 again, the fill value comes back from the draft
	await page.locator("#fioriGuideEditor .fioriGuideEditorStepTarget").nth(1).click();
	await page.waitForTimeout(300);
	check(await page.inputValue("#fioriGuideEditorFillValue-inner") === "Sample", "The fill value is loaded back into the editor");
	await page.fill("#fioriGuideEditorFillValue-inner", "");
	await page.click("#fioriGuideEditorAdvance");
	await page.click(".sapMSelectList li:has-text('The user clicks the element')");
	await shot("3-step-details");

	// save the draft
	await page.click("#fioriGuideEditorSave");
	await page.waitForTimeout(1200);
	const drafts = await page.evaluate(() => JSON.parse(localStorage.getItem("fiori.shepherd.guide.drafts") || "{}"));
	const draft = Object.values(drafts)[0];
	check(!!draft && draft.steps.length === 2, "Draft saved with 2 steps");
	check(draft && draft.intent === "SalesOrder-manage", "Draft is attached to the current app");
	check(draft && draft.steps[0].target.controlId === "statusFilter", "Step 1 target is {controlId: statusFilter}");
	check(draft && draft.steps[1].target.controlType === "sap.m.Button" && draft.steps[1].advanceOn === "click", "Step 2 target is Button 'Create' and waits for a click");
	check(draft && !draft.steps[1].autoClick && draft.steps[1].fillValue === undefined, "Switching back to a user click drops autoClick and the empty fill value");
	await shot("4-saved");

	// preview
	await page.click("#fioriGuideEditorPreview");
	await page.waitForSelector(".shepherd-element", { timeout: 10000 });
	check((await visibleStep()).trim() === "Filter by status", "Preview runs the new tour");
	await shot("5-preview");
	await page.click(".shepherd-element:visible .shepherd-cancel-icon");

	// export
	await page.click("#fioriGuideEditorExport");
	await page.waitForSelector(".sapMDialog:has-text('Export tours')", { timeout: 10000 });
	const json = await page.locator(".sapMDialog .fioriGuideEditorJson textarea").inputValue();
	const exported = JSON.parse(json);
	check(exported.tours.some((t) => t.id === draft.id) && exported.tours.some((t) => t.id === "salesorder-overview"), "Export contains the existing tours and the draft");
	await shot("6-export");
	const [download] = await Promise.all([
		page.waitForEvent("download"),
		page.click(".sapMDialog button:has-text('Download index.json')")
	]);
	check(download.suggestedFilename() === "index.json", "Download gives index.json");
	await page.click(".sapMDialog button:has-text('Close')");

	// the draft is now offered by the Guided Tour button
	await page.click("#fioriShepherdGuideEditorButton"); // close editor
	await page.click("#fioriShepherdGuideHeaderButton");
	await page.waitForSelector(".sapMActionSheet", { timeout: 10000 });
	check(await page.locator(".sapMActionSheet .sapMBtn:has-text('Filter orders by status')").count() === 1, "Draft appears in the Guided Tour list");
	await shot("7-draft-in-tour-list");

	// editing an existing tour: open it and check the steps are loaded
	await page.keyboard.press("Escape");
	await page.click("#fioriShepherdGuideEditorButton");
	await page.click("#fioriGuideEditor .sapMSlt");
	await page.click(".sapMSelectList li:has-text('Find and create sales orders')");
	await page.waitForTimeout(800);
	check(await page.locator("#fioriGuideEditor .sapMList .sapMLIB").count() === 6, "Existing tour opens with its 6 steps");
	await shot("8-edit-existing");
	await page.click("#fioriShepherdGuideEditorButton"); // close editor

	// ---- transaction code steps in SAP GUI for HTML (mock screen in an iframe) ----
	await page.evaluate(() => localStorage.setItem("fiori.shepherd.guide.seen.sales-order-gui", "1"));
	await page.evaluate(() => { window.location.hash = "#SalesDocument-createGui"; });
	const gui = page.frameLocator("iframe");
	await gui.locator("#ToolbarOkCode").waitFor({ timeout: 30000 });
	await page.waitForTimeout(1500);
	await page.click("#fioriShepherdGuideEditorButton");
	await page.waitForTimeout(1000);
	await page.click("#fioriGuideEditor .sapMSlt");
	await page.click(".sapMSelectList li:has-text('+ New tour')");
	await page.fill("#fioriGuideEditorTourTitle-inner", "Start VA01");
	await page.click("#fioriGuideEditorAddTcode");
	await page.waitForTimeout(500);
	const tcodeLabel = await targetLabel();
	check(/command field/i.test(tcodeLabel), `"Add T-code step" targets the SAP GUI command field automatically (${tcodeLabel})`);
	await page.fill("#fioriGuideEditorExpectValue-inner", "VA01");
	await shot("9-tcode-step");

	// open VA01 in the GUI, then pick a field inside the GUI screen
	await gui.locator("#ToolbarOkCode").fill("VA01");
	await gui.locator("#ToolbarOkCode").press("Enter");
	await gui.locator("[title='Sales Document Type']").waitFor();
	// the GUI fields are on the left, so move the panel back to the right
	await page.click("#fioriGuideEditorDock");
	await page.click("#fioriGuideEditorAddStep");
	await page.waitForTimeout(300);
	const field = gui.locator("[title='Sales Document Type']");
	const fbox = await field.boundingBox();
	await page.mouse.move(fbox.x + 10, fbox.y + fbox.height / 2);
	await page.waitForTimeout(300);
	await shot("10-picking-in-gui");
	await page.mouse.click(fbox.x + 10, fbox.y + fbox.height / 2);
	await page.waitForTimeout(500);
	const guiLabel = await targetLabel();
	check(/Sales Document Type|Order Type|M0:46/.test(guiLabel), `Field inside the SAP GUI screen can be picked (${guiLabel})`);
	await page.fill("#fioriGuideEditorStepTitleInput-inner", "Order type");
	await page.click("#fioriGuideEditorAdvance");
	await page.click(".sapMSelectList li:has-text('The user types a value'):not(:has-text('Enter'))");
	await page.fill("#fioriGuideEditorExpectValue-inner", "OR");
	await page.click("#fioriGuideEditorSave");
	await page.waitForTimeout(1200);
	const drafts2 = await page.evaluate(() => JSON.parse(localStorage.getItem("fiori.shepherd.guide.drafts") || "{}"));
	const va01 = Object.values(drafts2).find((t) => t.title === "Start VA01");
	check(!!va01 && va01.steps[0].tcode === true && va01.steps[0].expectValue === "VA01" && va01.steps[0].target.webgui === "okcode", "T-code step saved as {tcode, expectValue: VA01, target: command field}");
	check(!!va01 && va01.steps[1].target.frame === true && va01.steps[1].expectValue === "OR" && va01.steps[1].advanceOn === "input", "GUI field step saved with a frame target and expected value");
	await shot("11-gui-tour-saved");
} catch (e) {
	failed = true;
	console.error(e);
	await page.screenshot({ path: `${SHOTS}/error.png` });
}

const relevant = errors.filter((e) => /shepherd|fioriGuide/i.test(e));
check(relevant.length === 0, "No plugin errors in the console" + (relevant.length ? ": " + relevant.join(" | ") : ""));
await browser.close();
process.exit(failed ? 1 : 0);
