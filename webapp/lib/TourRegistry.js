/**
 * Reads the tour catalog (index.json) and finds the tours that belong to the current app.
 *
 * Catalog entry fields:
 *   id         (required) unique tour id
 *   title      text or { lang: text }
 *   intent     "SemanticObject-action", wildcard "SalesOrder-*", or an array of them
 *   appId      sap.app/id of the app, or an array
 *   innerHash  optional regular expression for the in-app route (hash part after "&/")
 *   autoStart  overrides the plugin's autoStart setting for this tour
 *   version    bump to auto-start the tour again for users who already saw it
 *   url        file with the steps, relative to the catalog; or put "steps" inline
 */
sap.ui.define(["sap/base/Log"], function (Log) {
	"use strict";

	function fetchJson(sUrl) {
		return fetch(sUrl, { credentials: "same-origin", headers: { Accept: "application/json" } }).then(function (oResponse) {
			if (!oResponse.ok) {
				throw new Error("HTTP " + oResponse.status + " for " + sUrl);
			}
			return oResponse.json();
		});
	}

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
		var sRegex = "^" + sPattern.split("*").map(function (sPart) {
			return sPart.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
		}).join(".*") + "$";
		return new RegExp(sRegex).test(sValue);
	}

	function matches(oTour, oContext) {
		var aIntents = toArray(oTour.intent);
		var aAppIds = toArray(oTour.appId);
		if (!aIntents.length && !aAppIds.length) {
			return false;
		}
		var bIntentOk = aIntents.some(function (s) {
			return wildcardMatch(s, oContext.intent);
		});
		var bAppOk = aAppIds.some(function (s) {
			return wildcardMatch(s, oContext.appId || "");
		});
		if (!bIntentOk && !bAppOk) {
			return false;
		}
		if (oTour.innerHash !== undefined) {
			try {
				return new RegExp(oTour.innerHash).test(oContext.innerHash || "");
			} catch (e) {
				Log.error("Invalid innerHash pattern in tour " + oTour.id, e, "fiori.shepherd.guide");
				return false;
			}
		}
		return true;
	}

	function TourRegistry(sBaseUrl) {
		this._sBaseUrl = String(sBaseUrl || "").replace(/\/?$/, "/");
		this._pIndex = null;
		this._mTours = {};
		this._fnOverlay = null;
	}

	/**
	 * Adds tours that are not in the catalog file, e.g. editor drafts in this browser.
	 * They replace catalog tours with the same id.
	 * @param {function(): object[]} fnOverlay
	 */
	TourRegistry.prototype.setOverlay = function (fnOverlay) {
		this._fnOverlay = fnOverlay;
	};

	/** Catalog tours plus overlay tours. */
	TourRegistry.prototype.loadAll = function () {
		var fnOverlay = this._fnOverlay;
		return this.loadIndex().then(function (aTours) {
			var aExtra = fnOverlay ? fnOverlay() || [] : [];
			if (!aExtra.length) {
				return aTours;
			}
			var mExtra = {};
			aExtra.forEach(function (oTour) {
				mExtra[oTour.id] = true;
			});
			return aTours.filter(function (oTour) {
				return !mExtra[oTour.id];
			}).concat(aExtra.map(function (oTour) {
				return Object.assign({ isDraft: true }, oTour);
			}));
		});
	};

	TourRegistry.prototype.loadIndex = function () {
		if (!this._pIndex) {
			var sUrl = this._sBaseUrl + "index.json";
			this._pIndex = fetchJson(sUrl).then(function (oData) {
				return ((oData && oData.tours) || []).filter(function (oTour) {
					if (!oTour.id) {
						Log.warning("Ignoring tour without id in " + sUrl, "", "fiori.shepherd.guide");
						return false;
					}
					return true;
				});
			}).catch(function (oError) {
				Log.error("Could not load the tour catalog " + sUrl, oError, "fiori.shepherd.guide");
				return [];
			});
		}
		return this._pIndex;
	};

	TourRegistry.prototype.findTours = function (oContext) {
		return this.loadAll().then(function (aTours) {
			return aTours.filter(function (oTour) {
				return matches(oTour, oContext);
			});
		});
	};

	TourRegistry.prototype.getById = function (sId) {
		return this.loadAll().then(function (aTours) {
			return aTours.find(function (oTour) {
				return oTour.id === sId;
			});
		});
	};

	/**
	 * Returns the full tour (catalog entry merged with its step file).
	 */
	TourRegistry.prototype.loadTour = function (oEntry) {
		if (Array.isArray(oEntry.steps)) {
			return Promise.resolve(oEntry);
		}
		if (!oEntry.url) {
			return Promise.reject(new Error("Tour " + oEntry.id + " has neither steps nor url"));
		}
		if (!this._mTours[oEntry.id]) {
			var sUrl = new URL(oEntry.url, new URL(this._sBaseUrl, window.location.href)).toString();
			this._mTours[oEntry.id] = fetchJson(sUrl).then(function (oData) {
				return Object.assign({}, oData, oEntry, { steps: oData.steps || [] });
			}, function (oError) {
				delete this._mTours[oEntry.id];
				throw oError;
			}.bind(this));
		}
		return this._mTours[oEntry.id];
	};

	TourRegistry._matches = matches; // exposed for tests
	return TourRegistry;
});
