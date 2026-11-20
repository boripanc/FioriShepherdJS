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
- **Lightweight.** ShepherdJS (50 KB) is only downloaded when a tour actually starts.

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

An end-to-end smoke test (Playwright) drives the sandbox:

```bash
npm run serve &    # dev server on port 8080
npx playwright --version || npm i -D playwright
npm test
```

## Writing tours

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
  lib/thirdparty/           bundled ShepherdJS (generated, see below)
  css/guide.css             Fiori theme for the popups
  tours/                    tour catalog and step files
  test/flpSandbox.html      local Launchpad sandbox
  test/demoapp/             demo app used by the sandbox and the smoke test
scripts/bundle-shepherd.mjs bundles ShepherdJS into webapp/lib/thirdparty
scripts/smoke-test.mjs      Playwright end-to-end test
```

## ShepherdJS version and license

The bundled ShepherdJS is pinned to **13.0.0, the last MIT-licensed release**. From 14.0 on, ShepherdJS is
dual-licensed under AGPL-3.0 or a paid commercial license, which usually does not suit internal SAP landscapes.
To upgrade anyway, change the version in `package.json` and run `npm run build:shepherd`.

The bundled file is committed so the plugin can be deployed without a build step. Its dependencies
(`@floating-ui/dom`, MIT; `deepmerge-ts`, BSD-3-Clause) are included in it.
