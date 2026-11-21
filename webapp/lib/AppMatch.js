/**
 * Decides whether "where the user is" (see AppContext) matches an app description.
 *
 * An app description is what tours and steps use to say where they belong:
 *   "SalesOrder-manage"                 an intent, wildcards allowed ("SalesOrder-*")
 *   ["SalesOrder-manage", "Shell-home"] any of several intents
 *   { intent, appId, innerHash, hash }  the full form; innerHash is a regular expression for
 *                                       the in-app route, hash is where "Continue" takes the user
 */
sap.ui.define(["sap/base/Log"], function (Log) {
	"use strict";

	function toArray(v) {
		if (v === undefined || v === null || v === "") {
			return [];
		}
		return Array.isArray(v) ? v : [v];
	}

	function wildcardMatch(sPattern, sValue) {
		if (sPattern === "*") {
			return true;
		}
		var sRegex = "^" + String(sPattern).split("*").map(function (sPart) {
			return sPart.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
		}).join(".*") + "$";
		return new RegExp(sRegex).test(sValue);
	}

	/** Turns the short forms into { intent, appId, innerHash, hash }. */
	function normalize(vApp) {
		if (!vApp) {
			return null;
		}
		if (typeof vApp === "string" || Array.isArray(vApp)) {
			return { intent: vApp };
		}
		return vApp;
	}

	/**
	 * @param {object} oApp app description with intent and/or appId (and optional innerHash)
	 * @param {object} oContext from AppContext.fromHash
	 * @param {boolean} [bEmptyMatchesAll] an app description without intent/appId matches everywhere
	 */
	function matches(oApp, oContext, bEmptyMatchesAll) {
		var aIntents = toArray(oApp && oApp.intent);
		var aAppIds = toArray(oApp && oApp.appId);
		if (!aIntents.length && !aAppIds.length) {
			if (!bEmptyMatchesAll) {
				return false;
			}
		} else {
			var bIntentOk = aIntents.some(function (s) {
				return wildcardMatch(s, oContext.intent);
			});
			var bAppOk = aAppIds.some(function (s) {
				return wildcardMatch(s, oContext.appId || "");
			});
			if (!bIntentOk && !bAppOk) {
				return false;
			}
		}
		if (oApp && oApp.innerHash !== undefined && oApp.innerHash !== null) {
			try {
				return new RegExp(oApp.innerHash).test(oContext.innerHash || "");
			} catch (e) {
				Log.error("Invalid innerHash pattern " + oApp.innerHash, e, "fiori.shepherd.guide");
				return false;
			}
		}
		return true;
	}

	/** A URL hash that opens the app, or "" when it can't be worked out (wildcards, appId only). */
	function hashOf(oApp) {
		if (!oApp) {
			return "";
		}
		if (oApp.hash) {
			return "#" + String(oApp.hash).replace(/^#/, "");
		}
		var aIntents = toArray(oApp.intent).filter(function (s) {
			return String(s).indexOf("*") < 0;
		});
		return aIntents.length ? "#" + aIntents[0] : "";
	}

	/** A readable name for messages, e.g. "SalesOrder-manage". */
	function labelOf(oApp) {
		var aAll = toArray(oApp && oApp.intent).concat(toArray(oApp && oApp.appId));
		return aAll.length ? String(aAll[0]) : "";
	}

	return {
		toArray: toArray,
		wildcardMatch: wildcardMatch,
		normalize: normalize,
		matches: matches,
		hashOf: hashOf,
		labelOf: labelOf
	};
});
