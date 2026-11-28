/**
 * The page a guide starts on ("start" in the tour definition), so a guide can be started from
 * anywhere: the plugin takes the user there first and then begins the guide.
 *
 *   "#SalesOrder-manage"                          a Launchpad hash (intent, parameters, &/route)
 *   "#Shell-startGUI?sap-ui2-tcode=WE02"          a SAP GUI transaction in the Launchpad
 *   "/sap/bc/ui2/flp?sap-client=200#Shell-home"   another Launchpad URL on the same server
 *
 * "Being at" the start page means: same intent, every parameter of the start hash has the same
 * value in the current hash, and the current in-app route begins with the start's route.
 * A URL part (before "#") must also match the current page (path and its query parameters).
 */
sap.ui.define([], function () {
	"use strict";

	function splitHash(sHash) {
		var sRaw = (sHash || "").replace(/^#/, "");
		try {
			sRaw = decodeURIComponent(sRaw);
		} catch (e) {
			// keep it as it is
		}
		var iInner = sRaw.indexOf("&/");
		var sShell = iInner >= 0 ? sRaw.slice(0, iInner) : sRaw;
		var sInner = iInner >= 0 ? sRaw.slice(iInner + 2) : "";
		var iQuery = sShell.indexOf("?");
		var sIntent = iQuery >= 0 ? sShell.slice(0, iQuery) : sShell;
		var mParams = {};
		if (iQuery >= 0) {
			sShell.slice(iQuery + 1).split("&").forEach(function (sPair) {
				if (!sPair) {
					return;
				}
				var iEq = sPair.indexOf("=");
				var sKey = iEq >= 0 ? sPair.slice(0, iEq) : sPair;
				mParams[sKey] = iEq >= 0 ? sPair.slice(iEq + 1) : "";
			});
		}
		return { intent: sIntent || "Shell-home", params: mParams, inner: sInner };
	}

	/** { url: absolute URL without hash, or "" for "this page", hash: "#..." } */
	function parse(sStart) {
		var s = String(sStart || "").trim();
		var iHash = s.indexOf("#");
		var sBase = iHash >= 0 ? s.slice(0, iHash) : s;
		var sHash = iHash >= 0 ? s.slice(iHash) : "";
		var sUrl = "";
		if (sBase) {
			try {
				sUrl = new URL(sBase, window.location.href).toString();
			} catch (e) {
				sUrl = "";
			}
		}
		return { url: sUrl, hash: sHash };
	}

	function hashMatches(sStartHash, sCurrentHash) {
		if (!sStartHash) {
			return true;
		}
		var oStart = splitHash(sStartHash);
		var oNow = splitHash(sCurrentHash);
		if (oStart.intent.toLowerCase() !== oNow.intent.toLowerCase()) {
			return false;
		}
		var bParams = Object.keys(oStart.params).every(function (sKey) {
			return oNow.params[sKey] !== undefined && oNow.params[sKey].toLowerCase() === oStart.params[sKey].toLowerCase();
		});
		return bParams && oNow.inner.indexOf(oStart.inner) === 0;
	}

	function urlMatches(sStartUrl, oLocation) {
		if (!sStartUrl) {
			return true;
		}
		var oStart = new URL(sStartUrl);
		var oNow = new URL(oLocation.href);
		if (oStart.origin !== oNow.origin || oStart.pathname.replace(/\/$/, "") !== oNow.pathname.replace(/\/$/, "")) {
			return false;
		}
		var bAll = true;
		oStart.searchParams.forEach(function (sValue, sKey) {
			if (oNow.searchParams.get(sKey) !== sValue) {
				bAll = false;
			}
		});
		return bAll;
	}

	return {
		parse: parse,
		splitHash: splitHash,

		/** Is the user on the start page now? */
		isAt: function (sStart, oLocation) {
			if (!sStart) {
				return true;
			}
			oLocation = oLocation || window.location;
			var oStart = parse(sStart);
			return urlMatches(oStart.url, oLocation) && hashMatches(oStart.hash, oLocation.hash);
		},

		/**
		 * Start parameters narrow where a guide is offered: a guide that starts at
		 * "#Shell-startGUI?sap-ui2-tcode=WE02" belongs to WE02, not to every SAP GUI transaction.
		 * Only applies when the start intent is the current intent.
		 */
		paramsMatch: function (sStart, sCurrentHash) {
			if (!sStart) {
				return true;
			}
			var oStart = splitHash(parse(sStart).hash);
			var oNow = splitHash(sCurrentHash);
			if (!parse(sStart).hash || oStart.intent.toLowerCase() !== oNow.intent.toLowerCase()) {
				return true;
			}
			return Object.keys(oStart.params).every(function (sKey) {
				return oNow.params[sKey] !== undefined && oNow.params[sKey].toLowerCase() === oStart.params[sKey].toLowerCase();
			});
		},

		/** Takes the user to the start page (a new page load only when the URL part differs). */
		go: function (sStart) {
			var oStart = parse(sStart);
			if (oStart.url && !urlMatches(oStart.url, window.location)) {
				window.location.href = oStart.url + oStart.hash;
				return;
			}
			if (oStart.hash) {
				window.location.hash = oStart.hash;
			}
		},

		/**
		 * A start page for a new guide made on the current page: the app's intent, plus the
		 * transaction for SAP GUI (its parameters say which transaction it is). Other parameters
		 * often point at one record, so they are left out.
		 */
		suggestion: function () {
			var oNow = splitHash(window.location.hash);
			var bGui = /startGUI|startWDA|tcode/i.test(oNow.intent) || oNow.params["sap-ui2-tcode"] !== undefined;
			if (!bGui) {
				return "#" + oNow.intent;
			}
			var aParams = Object.keys(oNow.params).filter(function (sKey) {
				return /tcode|transaction/i.test(sKey);
			}).map(function (sKey) {
				return sKey + "=" + oNow.params[sKey];
			});
			return "#" + oNow.intent + (aParams.length ? "?" + aParams.join("&") : "");
		},

		/** The shell part of the current hash (without the in-app route), e.g. for the editor. */
		currentShellHash: function () {
			var sRaw = (window.location.hash || "").replace(/^#/, "");
			var iInner = sRaw.indexOf("&/");
			return "#" + (iInner >= 0 ? sRaw.slice(0, iInner) : sRaw || "Shell-home");
		}
	};
});
