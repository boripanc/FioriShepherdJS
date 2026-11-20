# Fiori Guided Tours (ShepherdJS plugin for SAP Fiori Launchpad)

A SAP Fiori Launchpad (FLP) plugin that shows step-by-step guided tours inside Fiori apps,
powered by [ShepherdJS](https://github.com/shepherd-pro/shepherd).

- **One plugin for every app.** The plugin loads with the Launchpad and works out which app the user is in.
  Tours are plain JSON files, so no app needs to be changed.
- **"Guided Tour" button in the shell header.** It appears only in apps that have a tour; with more than one
  tour the user picks from a list.
- **Auto-start on first visit** (per tour, remembered per user and browser). Bump a tour's `version` to show it again after a change.
- **Fiori look.** Popups use the SAP theming variables, so they follow Horizon, Quartz, dark and high-contrast themes.
- **Robust targeting.** Point steps at UI5 controls by id suffix or by control type + property, not only by CSS selector,
  because Launchpad-generated DOM ids are long and unstable.
- **Interactive steps.** A step can wait for the user to click the highlighted element (`advanceOn`), wait for a
  dialog to open (`waitFor`) and skip itself when its element isn't on screen (`skipIfMissing`).
- **Multilingual texts.** Any text can be `{ "en": "...", "de": "...", "th": "..." }`; the user's Fiori language is used.
- **Point-and-click tour editor.** Authors build tours inside the Launchpad: click "Add step", click a control,
  type the text. No JSON or ids needed (see [Tour editor](#tour-editor-no-json-needed)).
- **Lightweight.** ShepherdJS (50 KB) is only downloaded when a tour actually starts, and the editor only when an author opens it.

![Tour step highlighting the Create button](docs/create-step.png)

## Try it locally

Requires Node.js 18+.

```bash
npm install
npm start          # opens http://localhost:8080/test/flpSandbox.html
```

The sandbox Launchpad has one demo app ("Manage Sales Orders"). Open it and its tour starts by itself.
Use the header button (book icon) to start tours again. To see the auto-start once more, run
`localStorage.clear()` in the browser console.

Open `http://localhost:8080/test/flpSandbox.html?fiori-guide-editor=true` to try the tour editor.

End-to-end tests (Playwright) drive the sandbox, one for the tours and one for the editor:

```bash
npm run serve &    # dev server on port 8080
npx playwright --version || npm i -D playwright
npm test
```

## Tour editor (no JSON needed)

![Tour editor](docs/editor-step.png)

1. Open the Launchpad with `?fiori-guide-editor=true` in the URL (before the `#`), e.g.
   `https://<host>/sap/bc/ui2/flp?fiori-guide-editor=true#SalesOrder-manage`. A pencil button appears in the shell header.
2. Open the app you want to explain and press the pencil. The editor panel opens on the side (the ⟷ button moves it to the other side).
3. Choose **+ New tour** (or pick an existing tour to change it) and give it a name.
4. Press **Add step**, then click the element in the app the step should point at. The click does not trigger the app.
   The editor shows what it picked and how reliable the reference is:
   - *stable*: the control has an id from the app's view (e.g. `statusFilter`)
   - *good*: found by type and text (e.g. the Button "Create")
   - *fragile*: only a CSS path; pick a labeled element or its parent instead.
   The ⤢ button switches to the surrounding, larger control (e.g. the whole filter instead of one of its buttons).
5. Type a title and text, choose where the popup appears, and optionally tick
   **Wait until the user clicks the element** for hands-on steps. **Add message** adds a centered step without an element.
6. **Preview** plays the tour, **Save draft** keeps it in this browser (only you see it, as a normal tour in the Guided Tour button).
7. **Export** produces the complete `index.json` (existing tours plus your drafts). Hand it to your Fiori administrator,
   who replaces `tours/index.json` (or the file at `toursUrl`) and deploys. Saving a changed existing tour bumps its
   `version`, so users see the updated tour once.

`enableEditor` controls access: `"url"` (default, as above), `true` (always) or `false` (never, e.g. in production).
Drafts never leave the author's browser until they are exported, so the editor is safe to leave on: other users see nothing.

## Writing tours by hand

Tours live in [`webapp/tours/`](webapp/tours). `index.json` is the catalog; each entry says which app a tour belongs to.

```json
{
  "tours": [
    {
      "id": "salesorder-overview",
      "title": { "en": "Find and create sales orders", "de": "Kundenaufträge suchen und anlegen" },
      "intent": "SalesOrder-manage",
      "version": 1,
      "url": "salesorder-overview.json"
    }
  ]
}
```

| Catalog field | Meaning |
|---|---|
| `id` | Unique id (required). |
| `title` | Shown in the tour chooser. Text or `{ "lang": "text" }`. |
| `intent` | `SemanticObject-action` of the app, wildcard (`SalesOrder-*`) or a list. `Shell-home` is the Launchpad home page. |
| `appId` | Alternative or addition to `intent`: the app's `sap.app/id` (works however the app was opened). |
| `innerHash` | Optional regular expression for the in-app route, i.e. the hash part after `&/` (e.g. `^SalesOrder\\(` for the object page). |
| `autoStart` | `true`/`false`; overrides the plugin-wide setting for this tour. |
| `version` | Number. Users who finished version 1 see the tour again automatically when you set it to 2. |
| `url` | Steps file, relative to `index.json`. Or put a `steps` array directly in the entry. |
| `modal` | `false` turns off dimming of the rest of the screen. |

A steps file:

```json
{
  "steps": [
    { "title": "Welcome", "text": "<p>This tour shows how to create a sales order.</p>" },
    { "title": "Search", "text": "Type a customer name.", "target": { "controlId": "searchField" }, "position": "bottom" },
    { "title": "Create", "text": "Click <b>Create</b>.", "target": { "controlType": "sap.m.Button", "properties": { "text": "Create" } }, "advanceOn": "click" },
    { "title": "Details", "text": "Fill in the form.", "target": { "controlId": "createDialog" }, "position": "right", "waitFor": 3000 }
  ]
}
```

| Step field | Meaning |
|---|---|
| `title`, `text` | Text or `{ "lang": "text" }`. `text` may contain simple HTML. |
| `target` | What to highlight. Leave out for a centered message. See below. |
| `position` | `top`, `bottom`, `left`, `right`, optionally with `-start` / `-end`, or `auto`. Default `bottom`. |
| `waitFor` | Milliseconds to wait for the target to appear (default 5000). If it never appears, the step is shown centered. |
| `skipIfMissing` | `true` skips the step when its target is not on screen. |
| `advanceOn` | `"click"` (or another DOM event): go to the next step when the user does this on the target. The Next button is hidden unless `showNext: true`. |
| `canClickTarget` | `false` blocks clicks on the highlighted element. |
| `classes` | Extra CSS classes for the popup. |

### Targets

| Form | Finds |
|---|---|
| `{ "controlId": "btnCreate" }` | The UI5 control whose id is `btnCreate` or ends with `--btnCreate`. This is the id from the app's XML view, so it survives the Launchpad's id prefixes. Best choice for freestyle apps and Fiori elements apps with stable ids. |
| `{ "controlType": "sap.m.Button", "properties": { "text": "Create" } }` | The first visible control of that type with those property values. Handy when an app has no stable ids. |
| `"#some .css"` or `{ "selector": "..." }` | Plain CSS selector. |
| `"index": 1` | (any object form) take the second visible match instead of the first. |
| `"subSelector": ".sapMInputBaseInner"` | (any object form) highlight an element inside the control. |

Tip: to find control ids, open the app, press `Ctrl+Alt+Shift+S` (UI5 Diagnostics) or use the UI5 Inspector browser extension.

## Plugin configuration

Defaults are in `manifest.json` (`sap.ui5/config/fioriGuide`). The Launchpad can override them per plugin
(target mapping parameters on ABAP, plugin `config` in the sandbox or a CDM site):

| Parameter | Default | Meaning |
|---|---|---|
| `toursUrl` | the plugin's own `tours/` folder | Where `index.json` lives. Point it to a separate BSP or static location so tours can be updated without redeploying the plugin. |
| `autoStart` | `true` | Start a tour automatically the first time a user opens its app. |
| `autoStartDelay` | `1000` | Milliseconds to wait after the app loads before auto-starting. |
| `showHeaderButton` | `true` | Show the Guided Tour button in the shell header. |
| `hideButtonWithoutTours` | `true` | Hide the button in apps that have no tour. |
| `enableEditor` | `"url"` | Tour editor access: `"url"` (with `?fiori-guide-editor=true`), `true` or `false`. |

## Starting tours from an app

Apps can start or reset tours through the UI5 EventBus, without depending on the plugin:

```js
sap.ui.getCore().getEventBus().publish("fiori.shepherd.guide", "start", { tourId: "salesorder-overview" });
sap.ui.getCore().getEventBus().publish("fiori.shepherd.guide", "reset", { tourId: "salesorder-overview" }); // or {} for all
```

## Deploying

### SAP S/4HANA / ABAP Front-End Server (on-premise)

1. Build: `npm run build` (output in `dist/`).
2. Deploy `dist/` as a BSP application, e.g. `ZFIORI_GUIDE`, with the SAP Fiori tools deploy command
   (`npx fiori deploy`, after `npm i -D @sap/ux-ui5-tooling` and a `ui5-deploy.yaml`) or report `/UI5/UI5_REPOSITORY_LOAD`.
   Then run `/UI5/APP_INDEX_CALCULATE` for the BSP.
3. In the Launchpad Designer / app manager, create a technical catalog entry (or use a custom catalog) with a
   **target mapping**: semantic object `Shell`, action `plugin`, application type *SAPUI5 Fiori App*,
   URL `/sap/bc/ui5_ui5/sap/zfiori_guide`, ID `fiori.shepherd.guide`. Add plugin parameters (table above) as target mapping parameters if needed.
4. Add the catalog to the business roles whose users should get tours.
5. On newer SAP_UI releases, also activate the plugin in `/UI2/FLP_CUS_CONF` (or `/UI2/FLP_SYS_CONF`) under *FLP Plugins*.

### SAP BTP (Build Work Zone)

The plugin is a standard FLP plugin (`sap.flp.type: "plugin"`), so it can be deployed to the HTML5 Application
Repository with an MTA and added in the Site Manager's Content Manager, then assigned to a role. That needs an
`xs-app.json`, an `mta.yaml` and a `sap.cloud` section in `manifest.json`, which are not part of this first version.

## Project layout

```
webapp/
  Component.js              plugin entry: config, header button, app tracking, auto-start, EventBus API
  manifest.json             sap.flp.type = plugin, Shell-plugin inbound, default config
  lib/TourRegistry.js       loads the catalog and matches tours to the current app
  lib/TourRunner.js         turns tour JSON into a Shepherd tour (buttons, progress, advanceOn, waiting)
  lib/TargetResolver.js     finds the DOM element for a step (controlId / controlType / CSS)
  lib/AppContext.js         intent, app id and in-app route of the current app
  lib/SeenStore.js          remembers finished tours (localStorage)
  lib/ShepherdLoader.js     lazy-loads ShepherdJS and its CSS
  lib/DraftStore.js         editor drafts in localStorage
  lib/editor/               tour editor (loaded on demand): TourEditor, ElementPicker, SelectorBuilder
  lib/thirdparty/           bundled ShepherdJS (generated, see below)
  css/guide.css             Fiori theme for the popups
  css/editor.css            editor panel and element picker
  tours/                    tour catalog and step files
  test/flpSandbox.html      local Launchpad sandbox
  test/demoapp/             demo app used by the sandbox and the smoke test
scripts/bundle-shepherd.mjs bundles ShepherdJS into webapp/lib/thirdparty
scripts/smoke-test.mjs      Playwright end-to-end test of tours
scripts/editor-test.mjs     Playwright end-to-end test of the editor
```

## ShepherdJS version and license

The bundled ShepherdJS is pinned to **13.0.0, the last MIT-licensed release**. From 14.0 on, ShepherdJS is
dual-licensed under AGPL-3.0 or a paid commercial license, which usually does not suit internal SAP landscapes.
To upgrade anyway, change the version in `package.json` and run `npm run build:shepherd`.

The bundled file is committed so the plugin can be deployed without a build step. Its dependencies
(`@floating-ui/dom`, MIT; `deepmerge-ts`, BSD-3-Clause) are included in it.
