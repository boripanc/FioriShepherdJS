/**
 * Resolves texts in tour definitions. A text can be a plain string or an object with one
 * entry per language, e.g. { "en": "Create", "de": "Anlegen", "default": "Create" }.
 */
sap.ui.define([], function () {
	"use strict";

	function getLanguage() {
		var Localization = sap.ui.require("sap/base/i18n/Localization");
		if (Localization && Localization.getLanguage) {
			return Localization.getLanguage();
		}
		return sap.ui.getCore().getConfiguration().getLanguage();
	}

	return {
		getLanguage: getLanguage,

		resolve: function (vText) {
			if (vText === undefined || vText === null) {
				return "";
			}
			if (typeof vText !== "object") {
				return String(vText);
			}
			var sLang = (getLanguage() || "en").replace("_", "-");
			var sShort = sLang.split("-")[0].toLowerCase();
			var aCandidates = [sLang, sLang.toLowerCase(), sShort, "default", "en"];
			for (var i = 0; i < aCandidates.length; i++) {
				if (vText[aCandidates[i]] !== undefined) {
					return String(vText[aCandidates[i]]);
				}
			}
			var aKeys = Object.keys(vText);
			return aKeys.length ? String(vText[aKeys[0]]) : "";
		}
	};
});
