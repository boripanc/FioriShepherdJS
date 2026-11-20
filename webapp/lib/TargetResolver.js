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
 *   { "frame": true, "selector": "#x" }               CSS selector inside an embedded page (iframe) of the
 *                                                     same server, e.g. SAP GUI for HTML transactions.
 *                                                     "frame" can also be a CSS selector for the iframe.
 *   { "webgui": "okcode" }                            the command field (OK-code field) of SAP GUI for HTML
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

	/** Command field of SAP GUI for HTML, in current and older WebGUI renderings. */
	var WEBGUI_TARGETS = {
		okcode: "#ToolbarOkCode, input[name='~OkCode'], input[id$='okcd'], input[title='Command field' i]"
	};

	function isVisible(oDom) {
		if (!oDom || oDom.isConnected === false || oDom.getClientRects().length === 0) {
			return false;
		}
		var oFrame = frameElementOf(oDom);
		return !oFrame || isVisible(oFrame);
	}

	/** The iframe element that contains oDom, or null for the main page. */
	function frameElementOf(oDom) {
		var oWin = oDom && oDom.ownerDocument && oDom.ownerDocument.defaultView;
		try {
			return oWin && oWin !== window ? oWin.frameElement : null;
		} catch (e) {
			return null;
		}
	}

	/**
	 * Documents of the iframes we may look into: same-origin only (the browser does not
	 * allow reading pages from another server), searched up to 3 levels deep.
	 */
	function frameDocuments(vFrame, oDoc, iDepth) {
		oDoc = oDoc || document;
		iDepth = iDepth || 0;
		var aResult = [];
		if (iDepth > 3) {
			return aResult;
		}
		var sFrameSelector = typeof vFrame === "string" ? vFrame : "iframe, frame";
		var aFrames = Array.prototype.slice.call(oDoc.querySelectorAll("iframe, frame"));
		aFrames.forEach(function (oFrame) {
			var oInner;
			try {
				oInner = oFrame.contentDocument;
			} catch (e) {
				oInner = null; // other origin
			}
			if (!oInner || !oInner.body) {
				return;
			}
			if (iDepth > 0 || oFrame.matches(sFrameSelector)) {
				aResult.push(oInner);
			}
			aResult = aResult.concat(frameDocuments(vFrame, oInner, iDepth + 1));
		});
		return aResult;
	}

	function queryAll(oTarget) {
		var aDocs = oTarget.frame ? frameDocuments(oTarget.frame) : [document];
		var aResult = [];
		aDocs.forEach(function (oDoc) {
			try {
				aResult = aResult.concat(Array.prototype.slice.call(oDoc.querySelectorAll(oTarget.selector)));
			} catch (e) {
				// invalid selector: no match
			}
		});
		return aResult;
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

		if (oTarget.webgui) {
			oTarget = Object.assign({}, oTarget, { frame: oTarget.frame || true, selector: WEBGUI_TARGETS[oTarget.webgui] || oTarget.webgui });
		}
		if (oTarget.selector) {
			aCandidates = queryAll(oTarget);
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
		waitFor: waitFor,
		frameElementOf: frameElementOf,
		frameDocuments: frameDocuments
	};
});
