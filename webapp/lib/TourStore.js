/**
 * Client for the tour database API: two n8n webhook workflows in front of an n8n data
 * table (see n8n/README.md). Any backend with the same four calls works too.
 *
 *   GET  {toursApiUrl}/tours           -> { tours: [catalog entry, ...] }   (no steps)
 *   GET  {toursApiUrl}/tour?id=<id>    -> { tour: full tour with steps }
 *   POST {toursApiUrl}/save            body { key, tour, user } -> { ok, id, version, updatedAt }
 *   POST {toursApiUrl}/delete          body { key, id, user }   -> { ok, id }
 *
 * Writes carry the publishing key in the body (no custom header, so the CORS preflight
 * stays simple). The author types the key in once; it is kept in this browser only.
 */
sap.ui.define([], function () {
	"use strict";

	var KEY_STORAGE = "fiori.shepherd.guide.publishKey";

	function TourStore(sApiUrl) {
		this._sApiUrl = String(sApiUrl || "").replace(/\/+$/, "");
	}

	TourStore.prototype.isEnabled = function () {
		return !!this._sApiUrl;
	};

	TourStore.prototype._request = function (sMethod, sPath, oBody) {
		var mHeaders = { Accept: "application/json" };
		if (oBody) {
			mHeaders["Content-Type"] = "application/json";
		}
		return fetch(this._sApiUrl + sPath, {
			method: sMethod,
			mode: "cors",
			credentials: "omit",
			headers: mHeaders,
			body: oBody ? JSON.stringify(oBody) : undefined
		}).then(function (oResponse) {
			return oResponse.text().then(function (sText) {
				var oData = null;
				try {
					oData = sText ? JSON.parse(sText) : null;
				} catch (e) {
					oData = null;
				}
				if (!oResponse.ok || (oData && oData.ok === false)) {
					var oError = new Error((oData && oData.message) || ("HTTP " + oResponse.status + " for " + sPath));
					oError.status = oResponse.ok ? 400 : oResponse.status;
					throw oError;
				}
				return oData;
			});
		});
	};

	/** Catalog entries stored in the database (without steps). */
	TourStore.prototype.list = function () {
		return this._request("GET", "/tours").then(function (oData) {
			var aTours = (oData && oData.tours) || (Array.isArray(oData) ? oData : []);
			return aTours.filter(function (oTour) {
				return oTour && oTour.id;
			}).map(function (oTour) {
				return Object.assign({}, oTour, { source: "db" });
			});
		});
	};

	/** One tour with its steps. */
	TourStore.prototype.get = function (sId) {
		return this._request("GET", "/tour?id=" + encodeURIComponent(sId)).then(function (oData) {
			var oTour = oData && (oData.tour || oData);
			if (!oTour || !Array.isArray(oTour.steps)) {
				throw new Error("Tour " + sId + " was not found in the database");
			}
			return oTour;
		});
	};

	TourStore.prototype.save = function (oTour, sUser) {
		return this._request("POST", "/save", { key: TourStore.getKey(), tour: oTour, user: sUser || "" });
	};

	TourStore.prototype.remove = function (sId, sUser) {
		return this._request("POST", "/delete", { key: TourStore.getKey(), id: sId, user: sUser || "" });
	};

	TourStore.getKey = function () {
		try {
			return window.localStorage.getItem(KEY_STORAGE) || "";
		} catch (e) {
			return "";
		}
	};

	TourStore.setKey = function (sKey) {
		try {
			if (sKey) {
				window.localStorage.setItem(KEY_STORAGE, sKey);
			} else {
				window.localStorage.removeItem(KEY_STORAGE);
			}
		} catch (e) {
			// private mode: the author types the key again next time
		}
	};

	return TourStore;
});
