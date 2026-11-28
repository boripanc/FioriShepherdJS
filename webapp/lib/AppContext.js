/**
 * Works out "where the user is" in the Launchpad: intent (SemanticObject-action),
 * the app's component id and the in-app route (the part of the hash after "&/").
 */
sap.ui.define([], function () {
	"use strict";

	var HOME_INTENTS = ["Shell-home", "Launchpad-openFLPPage"];

	function getAppId(oAppLifeCycle) {
		try {
			var oApp = oAppLifeCycle && oAppLifeCycle.getCurrentApplication();
			var oComponent = oApp && oApp.componentInstance;
			if (oComponent && oComponent.getManifestEntry) {
				return oComponent.getManifestEntry("/sap.app/id") || "";
			}
		} catch (e) {
			// not every app type has a component (e.g. GUI / WebDynpro); ignore
		}
		return "";
	}

	return {
		/**
		 * @param {string} sHash window.location.hash
		 * @param {object} [oAppLifeCycle] AppLifeCycle service
		 * @returns {{intent: string, semanticObject: string, action: string, appId: string, innerHash: string, isHome: boolean}}
		 */
		fromHash: function (sHash, oAppLifeCycle) {
			var sRaw = decodeURIComponent((sHash || "").replace(/^#/, ""));
			var iInner = sRaw.indexOf("&/");
			var sShellPart = iInner >= 0 ? sRaw.slice(0, iInner) : sRaw;
			var sInner = iInner >= 0 ? sRaw.slice(iInner + 2) : "";
			var aMatch = /^([\w.\/]+)-([\w.\/]+)/.exec(sShellPart);

			var sSemanticObject = aMatch ? aMatch[1] : "Shell";
			var sAction = aMatch ? aMatch[2] : "home";
			var sIntent = sSemanticObject + "-" + sAction;
			var bHome = HOME_INTENTS.indexOf(sIntent) >= 0;

			return {
				intent: sIntent,
				semanticObject: sSemanticObject,
				action: sAction,
				appId: bHome ? "" : getAppId(oAppLifeCycle),
				innerHash: sInner,
				hash: sHash || "",
				isHome: bHome
			};
		}
	};
});
