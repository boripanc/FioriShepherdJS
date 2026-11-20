/**
 * Remembers which tours (and which version of them) a user has already finished or
 * dismissed, so auto-start only happens once. Stored in the browser's localStorage.
 */
sap.ui.define([], function () {
	"use strict";

	var PREFIX = "fiori.shepherd.guide.seen.";

	function storage() {
		try {
			return window.localStorage;
		} catch (e) {
			return null; // blocked by browser settings
		}
	}

	function versionOf(oTour) {
		return String(oTour.version || 1);
	}

	return {
		hasSeen: function (oTour) {
			var oStorage = storage();
			return !!oStorage && oStorage.getItem(PREFIX + oTour.id) === versionOf(oTour);
		},

		markSeen: function (oTour) {
			var oStorage = storage();
			if (oStorage) {
				try {
					oStorage.setItem(PREFIX + oTour.id, versionOf(oTour));
				} catch (e) {
					// quota exceeded or similar; auto-start will simply happen again
				}
			}
		},

		/**
		 * @param {string} [sTourId] reset one tour, or all tours when omitted
		 */
		reset: function (sTourId) {
			var oStorage = storage();
			if (!oStorage) {
				return;
			}
			if (sTourId) {
				oStorage.removeItem(PREFIX + sTourId);
				return;
			}
			Object.keys(oStorage).forEach(function (sKey) {
				if (sKey.indexOf(PREFIX) === 0) {
					oStorage.removeItem(sKey);
				}
			});
		}
	};
});
