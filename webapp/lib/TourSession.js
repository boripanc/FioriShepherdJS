/**
 * Remembers the tour that is in progress and the step the user is on, so the tour can go on
 * after the user moves to another app or reloads the page. Stored in the browser tab's
 * sessionStorage: it is gone when the tab is closed, and other tabs don't see it.
 */
sap.ui.define([], function () {
	"use strict";

	var KEY = "fiori.shepherd.guide.session";
	var DEFAULT_MAX_AGE_MINUTES = 30;

	function storage() {
		try {
			return window.sessionStorage;
		} catch (e) {
			return null; // blocked by browser settings
		}
	}

	return {
		/**
		 * @param {{def: object, index: number, preview: boolean}} oState
		 */
		save: function (oState) {
			var oStorage = storage();
			if (!oStorage) {
				return;
			}
			try {
				oStorage.setItem(KEY, JSON.stringify(Object.assign({}, oState, { time: Date.now() })));
			} catch (e) {
				// quota exceeded or similar; the tour just won't survive a reload
			}
		},

		/**
		 * @param {number} [iMaxAgeMinutes] ignore (and forget) a tour left longer ago than this
		 * @returns {{def: object, index: number, preview: boolean, time: number}|null}
		 */
		load: function (iMaxAgeMinutes) {
			var oStorage = storage();
			var sRaw = oStorage && oStorage.getItem(KEY);
			if (!sRaw) {
				return null;
			}
			try {
				var oState = JSON.parse(sRaw);
				var iMaxAge = (iMaxAgeMinutes > 0 ? iMaxAgeMinutes : DEFAULT_MAX_AGE_MINUTES) * 60000;
				var aSteps = oState && oState.def && oState.def.steps;
				if (!Array.isArray(aSteps) || !(oState.index >= 0 && oState.index < aSteps.length)
					|| Date.now() - oState.time > iMaxAge) {
					oStorage.removeItem(KEY);
					return null;
				}
				return oState;
			} catch (e) {
				oStorage.removeItem(KEY);
				return null;
			}
		},

		clear: function () {
			var oStorage = storage();
			if (oStorage) {
				oStorage.removeItem(KEY);
			}
		}
	};
});
