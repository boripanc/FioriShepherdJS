/**
 * Finds the DOM element a tour step points at. Fiori apps rarely have stable DOM ids
 * (the Launchpad prefixes them, e.g. "application-SalesOrder-manage-component---main--btnCreate"),
 * so a target can be described in several ways:
 *
 *   "#css .selector"                                  plain CSS selector string
 *   { "selector": "#css .selector" }                  same, as object
 *   { "controlId": "btnCreate" }                      UI5 control whose id is, or ends with "--btnCreate"
 *   { "controlType": "sap.m.Button",
 *     "properties": { "text": "Create" } }            first visible control of that type with those properties
 *
 * Optional extras for the object forms:
 *   "index": 1             pick the n-th visible match (0-based)
 *   "subSelector": ".x"    CSS selector inside the control's DOM element
 */
sap.ui.define([], function () {
	"use strict";

	function allElements() {
		var ElementRegistry = sap.ui.require("sap/ui/core/ElementRegistry");
		if (ElementRegistry && ElementRegistry.all) {
			return ElementRegistry.all();
		}
		var Element = sap.ui.require("sap/ui/core/Element");
		if (Element && Element.registry) {
			return Element.registry.all();
		}
		return {};
	}

	function isVisible(oDom) {
		return !!oDom && oDom.isConnected !== false && oDom.getClientRects().length > 0;
	}

	function domOf(oControl) {
		return oControl && oControl.getDomRef ? oControl.getDomRef() : null;
	}

	function propsMatch(oControl, mProps) {
		return Object.keys(mProps || {}).every(function (sName) {
			var vExpected = mProps[sName];
			var vActual;
			try {
				vActual = oControl.getProperty(sName);
			} catch (e) {
				return false;
			}
			if (typeof vExpected === "string" && typeof vActual === "string") {
				return vActual.trim() === vExpected.trim();
			}
			return vActual === vExpected;
		});
	}

	function controlsFor(oTarget) {
		var mAll = allElements();
		var aIds = Object.keys(mAll);
		if (oTarget.controlId) {
			var sId = oTarget.controlId;
			if (mAll[sId]) {
				return [mAll[sId]];
			}
			return aIds.filter(function (s) {
				return s.slice(-(sId.length + 2)) === "--" + sId;
			}).map(function (s) {
				return mAll[s];
			});
		}
		if (oTarget.controlType) {
			return aIds.map(function (s) {
				return mAll[s];
			}).filter(function (oControl) {
				return oControl.isA && oControl.isA(oTarget.controlType) && propsMatch(oControl, oTarget.properties);
			});
		}
		return [];
	}

	function resolve(vTarget) {
		if (!vTarget) {
			return null;
		}
		var oTarget = typeof vTarget === "string" ? { selector: vTarget } : vTarget;
		var aCandidates;

		if (oTarget.selector) {
			aCandidates = Array.prototype.slice.call(document.querySelectorAll(oTarget.selector));
		} else {
			aCandidates = controlsFor(oTarget).map(domOf);
		}
		if (oTarget.subSelector) {
			aCandidates = aCandidates.map(function (oDom) {
				return oDom && oDom.querySelector(oTarget.subSelector);
			});
		}
		var aVisible = aCandidates.filter(isVisible);
		return aVisible[oTarget.index || 0] || null;
	}

	/**
	 * Waits until the target is rendered and visible.
	 * @returns {Promise<HTMLElement|null>} the element, or null after the timeout
	 */
	function waitFor(vTarget, iTimeout) {
		var iEnd = Date.now() + (iTimeout === undefined ? 5000 : iTimeout);
		return new Promise(function (fnResolve) {
			(function poll() {
				var oDom = resolve(vTarget);
				if (oDom || Date.now() >= iEnd) {
					fnResolve(oDom);
					return;
				}
				setTimeout(poll, 150);
			})();
		});
	}

	return {
		resolve: resolve,
		waitFor: waitFor
	};
});
