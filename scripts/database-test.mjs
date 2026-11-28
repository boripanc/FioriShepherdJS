// Tours stored in a database through the n8n API (TourStore), against a mocked API.
// Start the dev server first (npm run serve), then: node scripts/database-test.mjs
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const API = "https://n8n.mock/webhook/fiori-guide";
const BASE = (process.env.BASE_URL || "http://localhost:8080/test/flpSandbox.html") +
	"?fiori-guide-editor=true&toursApi=" + encodeURIComponent(API);
const SHOTS = "screenshots/database";
const KEY = "secret-key";
mkdirSync(SHOTS, { recursive: true });

// in-memory "data table", same shape as the n8n workflows return
const db = {
	"db-tour": {
		id: "db-tour",
		title: { en: "Tour from the database" },
		intent: "SalesOrder-manage",
		autoStart: false,
		version: 3,
		steps: [{ title: "Hello from n8n", text: "This step was loaded from the tour database." }]
	}
};
let apiDown = false;
const calls = [];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
await context.route(API + "/**", async (route) => {
	const req = route.request();
	const url = new URL(req.url());
	const path = url.pathname.replace("/webhook/fiori-guide", "");
	calls.push(req.method() + " " + path);
	const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, accept" };
	const json = (status, body) => route.fulfill({ status, headers: Object.assign({ "Content-Type": "application/json" }, cors), body: JSON.stringify(body) });
	if (req.method() === "OPTIONS") {
		return route.fulfill({ status: 204, headers: cors });
	}
	if (apiDown) {
		return json(500, { message: "down" });
	}
	if (req.method() === "GET" && path === "/tours") {
		return json(200, { tours: Object.values(db).map((t) => { const e = Object.assign({}, t); delete e.steps; return e; }) });
	}
	if (req.method() === "GET" && path === "/tour") {
		const t = db[url.searchParams.get("id")];
		return t ? json(200, { tour: t }) : json(404, { ok: false, message: "not found" });
	}
	const body = req.postDataJSON() || {};
	if (body.key !== KEY) {
		return json(401, { ok: false, message: "Wrong publishing key" });
	}
	if (path === "/save") {
		db[body.tour.id] = body.tour;
		return json(200, { ok: true, id: body.tour.id, version: body.tour.version });
	}
	if (path === "/delete") {
		delete db[body.id];
		return json(200, { ok: true, id: body.id });
	}
	return json(404, { ok: false });
});

const page = await context.newPage();
const errors = [];
// the sandbox's enterprise search lib is not installed locally; unrelated to tours
page.on("pageerror", (e) => { if (!/sap\/esh\//.test(e.message)) errors.push(e.message); });

let failed = false;
function check(cond, msg) {
	console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
	if (!cond) failed = true;
}
const shot = async (name) => { await page.waitForTimeout(500); await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const tourOptions = async () => {
	await page.click("#fioriGuideEditor .sapMSlt");
	await page.waitForTimeout(300);
	const texts = await page.locator(".sapMSelectList li").allTextContents();
	await page.keyboard.press("Escape");
	await page.waitForTimeout(200);
	return texts.map((s) => s.trim());
};

try {
	await page.goto(BASE + "#Shell-home");
	await page.evaluate(() => {
		localStorage.clear();
		localStorage.setItem("fiori.shepherd.guide.seen.salesorder-overview", "1");
	});
	await page.goto(BASE + "#SalesOrder-manage");
	await page.waitForSelector("#fioriShepherdGuideEditorButton", { timeout: 60000 });
	await page.waitForSelector("[id$='--ordersTable']", { timeout: 30000 });

	// 1. a database tour plays like a file tour
	await page.evaluate(() => sap.ui.getCore().getEventBus().publish("fiori.shepherd.guide", "start", { tourId: "db-tour" }));
	await page.waitForSelector(".shepherd-element:visible", { timeout: 10000 });
	const sTitle = (await page.locator(".shepherd-element:visible .shepherd-title").textContent()).trim();
	check(sTitle === "Hello from n8n", `Tour from the database starts with its steps (${sTitle})`);
	check(calls.includes("GET /tours") && calls.includes("GET /tour"), "Plugin called GET /tours and GET /tour?id=");
	await shot("1-db-tour");
	await page.keyboard.press("Escape");
	await page.waitForTimeout(400);

	// 2. editor lists file tours and database tours
	await page.click("#fioriShepherdGuideEditorButton");
	await page.waitForSelector("#fioriGuideEditor .sapMPage", { timeout: 20000 });
	await page.waitForTimeout(800);
	let opts = await tourOptions();
	check(opts.some((s) => s.startsWith("Tour from the database")) && opts.some((s) => s.startsWith("Find and create sales orders")),
		`Editor lists the database tour next to the index.json tours (${opts.join(" | ")})`);
	check(await page.locator("#fioriGuideEditorPublish").isVisible(), "Publish button is shown when toursApiUrl is set");

	// 3. new tour -> publish (wrong key first)
	await page.click("#fioriGuideEditor .sapMSlt");
	await page.click(".sapMSelectList li:has-text('+ New tour')");
	await page.waitForTimeout(400);
	await page.fill("#fioriGuideEditorTourTitle-inner", "Published from the editor");
	await page.click("#fioriGuideEditorAddMessage");
	await page.waitForTimeout(400);
	await page.fill("#fioriGuideEditorStepTitleInput-inner", "Welcome");
	await page.fill("#fioriGuideEditorStepTextInput-inner", "Saved in n8n.");
	await page.click("#fioriGuideEditorPublish");
	await page.waitForSelector("#fioriGuideEditorPublishKey-inner", { timeout: 10000 });
	await shot("2-publish-key");
	await page.fill("#fioriGuideEditorPublishKey-inner", "wrong");
	await page.click("#fioriGuideEditorPublishKeyOk");
	await page.waitForSelector(".sapMMessageBoxError", { timeout: 10000 });
	check(true, "Wrong publishing key shows an error");
	await page.click(".sapMMessageBoxError .sapMBtn");
	await page.waitForTimeout(400);
	const sDraftId = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("fiori.shepherd.guide.drafts") || "{}"))[0]);
	check(!!sDraftId, `The tour stays as a local draft when publishing fails (${sDraftId})`);

	await page.click("#fioriGuideEditorPublish");
	await page.waitForSelector("#fioriGuideEditorPublishKey-inner", { timeout: 10000 });
	await page.fill("#fioriGuideEditorPublishKey-inner", KEY);
	await page.click("#fioriGuideEditorPublishKeyOk");
	await page.waitForTimeout(1500);
	await shot("3-published");
	check(!!db[sDraftId] && db[sDraftId].steps[0].title === "Welcome", "Publish saved the tour with its steps in the database");
	const iDrafts = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("fiori.shepherd.guide.drafts") || "{}")).length);
	check(iDrafts === 0, "Local draft is removed after publishing");
	// footer buttons may sit in the overflow menu, so ask UI5 instead of the DOM
	const unpublishVisible = () => page.evaluate(() => sap.ui.getCore().byId("fioriGuideEditorUnpublish").getVisible());
	check(await unpublishVisible(), "\"Remove from database\" is offered for a published tour");

	// 4. publishing again does not ask for the key
	await page.click(".fioriGuideEditorContent .sapMLIB:has-text('Welcome')");
	await page.waitForTimeout(400);
	await page.fill("#fioriGuideEditorStepTitleInput-inner", "Welcome again");
	await page.click("#fioriGuideEditorPublish");
	await page.waitForTimeout(1500);
	check(db[sDraftId].steps[0].title === "Welcome again" && db[sDraftId].version === 2,
		`Changing and publishing again updates the database tour and bumps its version (v${db[sDraftId].version})`);

	// 5. remove from database
	await page.evaluate(() => sap.ui.getCore().byId("fioriGuideEditorUnpublish").firePress());
	await page.waitForSelector(".sapMMessageBoxQuestion", { timeout: 10000 });
	await page.click(".sapMMessageBoxQuestion .sapMBtn:has-text('OK')");
	await page.waitForTimeout(1500);
	check(!db[sDraftId], "\"Remove from database\" deletes the tour");
	opts = await tourOptions();
	check(!opts.some((s) => s.startsWith("Published from the editor")), "Removed tour is gone from the editor list");

	// 6. database down: index.json tours still work
	apiDown = true;
	await page.goto(BASE.replace("?", "?x=1&") + "#SalesOrder-manage");
	await page.waitForSelector("#fioriShepherdGuideEditorButton", { timeout: 60000 });
	await page.click("#fioriShepherdGuideEditorButton");
	await page.waitForSelector("#fioriGuideEditor .sapMPage", { timeout: 20000 });
	await page.waitForTimeout(800);
	opts = await tourOptions();
	check(opts.some((s) => s.startsWith("Find and create sales orders")) && !opts.some((s) => s.startsWith("Tour from the database")),
		"With the database down, the index.json tours still load");
} catch (e) {
	check(false, "Unexpected error: " + e.message);
	await page.screenshot({ path: `${SHOTS}/error.png` });
}

check(errors.length === 0, "No page errors" + (errors.length ? ": " + errors.join("; ") : ""));
await browser.close();
process.exit(failed ? 1 : 0);
