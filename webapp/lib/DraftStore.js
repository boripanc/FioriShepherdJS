/**
 * Tours created or changed in the editor, kept in this browser until they are exported
 * and deployed. Drafts show up in the Launchpad right away, but only for the author.
 */
sap.ui.define([], function () {
	"use strict";

	var KEY = "fiori.shepherd.guide.drafts";

	function read() {
		try {
			return JSON.parse(window.localStorage.getItem(KEY) || "{}") || {};
		} catch (e) {
			return {};
		}
	}

	function write(mDrafts) {
		window.localStorage.setItem(KEY, JSON.stringify(mDrafts));
	}

	return {
		list: function () {
			var mDrafts = read();
			return Object.keys(mDrafts).map(function (sId) {
				return mDrafts[sId];
			});
		},
		get: function (sId) {
			return read()[sId] || null;
		},
		save: function (oTour) {
			var mDrafts = read();
			mDrafts[oTour.id] = oTour;
			write(mDrafts);
		},
		remove: function (sId) {
			var mDrafts = read();
			delete mDrafts[sId];
			write(mDrafts);
		},
		clear: function () {
			write({});
		}
	};
});
