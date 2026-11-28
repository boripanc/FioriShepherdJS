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
 *
 * With a tour database (TourStore, config toursApiUrl) its tours are added to the file
 * catalog and win over a file tour with the same id. If the database cannot be reached,
 * the file catalog is used alone.
 */
sap.ui.define(["sap/base/Log", "./AppMatch"], function (Log, AppMatch) {
	"use strict";

	function fetchJson(sUrl) {
		return fetch(sUrl, { credentials: "same-origin", headers: { Accept: "application/json" } }).then(function (oResponse) {
			if (!oResponse.ok) {
				throw new Error("HTTP " + oResponse.status + " for " + sUrl);
			}
			return oResponse.json();
		});
	}

	function matches(oTour, oContext) {
		return AppMatch.matches(oTour, oContext);
	}

	/**
	 * @param {string} sBaseUrl folder of index.json
	 * @param {object} [oStore] TourStore for tours kept in a database
	 */
	function TourRegistry(sBaseUrl, oStore) {
		this._sBaseUrl = String(sBaseUrl || "").replace(/\/?$/, "/");
		this._oStore = oStore && oStore.isEnabled() ? oStore : null;
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

	/** Forgets loaded tours, e.g. after the editor published to the database. */
	TourRegistry.prototype.reload = function () {
		this._pIndex = null;
		this._mTours = {};
	};

	TourRegistry.prototype.loadIndex = function () {
		if (!this._pIndex) {
			var oStore = this._oStore;
			var pDb = oStore ? oStore.list().catch(function (oError) {
				Log.error("Could not load tours from the tour database, using the catalog file only", oError, "fiori.shepherd.guide");
				return [];
			}) : Promise.resolve([]);
			this._pIndex = Promise.all([this._loadFileIndex(), pDb]).then(function (aResults) {
				var aDb = aResults[1];
				var mDb = {};
				aDb.forEach(function (oTour) {
					mDb[oTour.id] = true;
				});
				return aResults[0].filter(function (oTour) {
					return !mDb[oTour.id];
				}).concat(aDb);
			});
		}
		return this._pIndex;
	};

	TourRegistry.prototype._loadFileIndex = function () {
		var sUrl = this._sBaseUrl + "index.json";
		return fetchJson(sUrl).then(function (oData) {
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
		if (oEntry.source === "db" && this._oStore) {
			if (!this._mTours[oEntry.id]) {
				this._mTours[oEntry.id] = this._oStore.get(oEntry.id).then(function (oData) {
					return Object.assign({}, oData, oEntry, { steps: oData.steps || [] });
				}, function (oError) {
					delete this._mTours[oEntry.id];
					throw oError;
				}.bind(this));
			}
			return this._mTours[oEntry.id];
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
