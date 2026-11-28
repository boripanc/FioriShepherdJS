// Opens or closes the tour editor through the Guided Tour menu ("Add or edit guides").
export async function toggleEditor(page) {
	await page.click("#fioriShepherdGuideHeaderButton");
	await page.waitForSelector("#fioriShepherdGuideEditorEntry", { state: "visible", timeout: 10000 });
	await page.click("#fioriShepherdGuideEditorEntry");
	await page.waitForTimeout(400);
}
