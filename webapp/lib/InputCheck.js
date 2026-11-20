/**
 * "Type this" steps: compares what the user typed with the value the step expects,
 * e.g. a transaction code.
 *
 *   expectValue  "VA01", ["VA01", "VA02"] or a regular expression written as "/^VA0[12]$/i"
 *   tcode        true: ignore the /n and /o prefixes users often type before transaction codes
 * Comparison ignores upper/lower case and surrounding spaces.
 */
sap.ui.define([], function () {
	"use strict";

	function normalize(sValue, bTcode) {
		var s = String(sValue || "").trim();
		if (bTcode) {
			s = s.replace(/^\/[nNoO]\s*/, "");
		}
		return s.toUpperCase();
	}

	function toRegex(sExpected) {
		var aMatch = /^\/(.+)\/([a-z]*)$/.exec(sExpected);
		if (!aMatch) {
			return null;
		}
		try {
			return new RegExp(aMatch[1], aMatch[2].indexOf("i") >= 0 ? aMatch[2] : aMatch[2] + "i");
		} catch (e) {
			return null;
		}
	}

	return {
		matches: function (sValue, vExpected, bTcode) {
			var aExpected = Array.isArray(vExpected) ? vExpected : [vExpected];
			return aExpected.some(function (sExpected) {
				var oRegex = toRegex(String(sExpected));
				if (oRegex) {
					return oRegex.test(String(sValue || "").trim());
				}
				return normalize(sValue, bTcode) === normalize(sExpected, bTcode);
			});
		},

		/** What to show the user, e.g. "VA01". */
		display: function (vExpected, sHint) {
			if (sHint) {
				return sHint;
			}
			var sFirst = String(Array.isArray(vExpected) ? vExpected[0] : vExpected);
			return toRegex(sFirst) ? sFirst.replace(/^\/|\/[a-z]*$/g, "") : sFirst;
		},

		/** The text field inside a target (UI5 inputs render an <input> inside a <div>). */
		inputOf: function (oDom) {
			if (!oDom) {
				return null;
			}
			if (/^(INPUT|TEXTAREA)$/.test(oDom.tagName) || oDom.isContentEditable) {
				return oDom;
			}
			return oDom.querySelector("input:not([type=hidden]), textarea, [contenteditable=true]");
		},

		valueOf: function (oInput) {
			return oInput ? (oInput.value !== undefined ? oInput.value : oInput.textContent) : "";
		}
	};
});
