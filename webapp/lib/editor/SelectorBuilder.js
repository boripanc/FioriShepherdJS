/**
 * Turns a clicked DOM element into a step "target" that will still find the same
 * element next time, after a reload and in another user's browser.
 *
 * Preference order (most to least stable):
 *   1. { controlId }   the control's own id from the app's view (the part after the last "--"),
 *                      only when that id was written by a developer (not generated like "__button3")
 *   2. { controlType, properties }   e.g. the sap.m.Button with text "Create" (+ "index" if needed)
 *   3. the same two strategies for the parent controls, up to a few levels
 *   4. { selector }    CSS fallback, flagged as fragile
 * Every candidate is checked with TargetResolver: it must resolve to the clicked control.
 */
sap.ui.define(["../TargetResolver"], function (TargetResolver) {
	"use strict";

	var IDENTIFYING_PROPERTIES = ["text", "title", "label", "tooltip", "placeholder", "headerText", "name", "icon", "key"];
	var MAX_PARENT_LEVELS = 6;

	function registryGet(sId) {
		var ElementRegistry = sap.ui.require("sap/ui/core/ElementRegistry");
		if (ElementRegistry && ElementRegistry.get) {
			return ElementRegistry.get(sId);
		}
		var Element = sap.ui.require("sap/ui/core/Element");
		if (Element && Element.registry) {
			return Element.registry.get(sId);
		}
		return sap.ui.getCore().byId(sId);
	}

	/** Closest UI5 control that owns the given DOM node. */
	function controlFor(oDom) {
		for (var oNode = oDom; oNode && oNode !== document.body; oNode = oNode.parentElement) {
			if (oNode.id && oNode.hasAttribute("data-sap-ui")) {
				var oControl = registryGet(oNode.id);
				if (oControl) {
					return oControl;
				}
			}
		}
		return null;
	}

	/** "application-SO-manage-component---main--btnCreate" -> "btnCreate"; null when generated. */
	function stableLocalId(sId) {
		var sLocal = sId.indexOf("--") >= 0 ? sId.slice(sId.lastIndexOf("--") + 2) : sId;
		// generated ids: "__button3", "__xmlview0", "__item5-...-0", clones of list items
		if (!sLocal || /^__/.test(sLocal) || /-\d+$/.test(sLocal) || sId.indexOf("--") < 0) {
			return null;
		}
		return sLocal;
	}

	function describe(oControl) {
		return oControl.getMetadata().getName().split(".").pop();
	}

	function sameTarget(oTarget, oControl) {
		var oDom = TargetResolver.resolve(oTarget);
		var oControlDom = oControl.getDomRef();
		return !!oDom && oDom === oControlDom;
	}

	function byId(oControl) {
		var sLocal = stableLocalId(oControl.getId());
		if (!sLocal) {
			return null;
		}
		var oTarget = { controlId: sLocal };
		return sameTarget(oTarget, oControl) ? oTarget : null;
	}

	function byProperties(oControl) {
		var mProps = oControl.getMetadata().getAllProperties();
		var sType = oControl.getMetadata().getName();
		for (var i = 0; i < IDENTIFYING_PROPERTIES.length; i++) {
			var sName = IDENTIFYING_PROPERTIES[i];
			if (!mProps[sName]) {
				continue;
			}
			var vValue = oControl.getProperty(sName);
			if (typeof vValue !== "string" || !vValue.trim() || vValue.length > 80) {
				continue;
			}
			var oProps = {};
			oProps[sName] = vValue;
			var oTarget = { controlType: sType, properties: oProps };
			// pick the index that points at this very control, if the text is not unique
			for (var iIndex = 0; iIndex < 5; iIndex++) {
				if (iIndex) {
					oTarget.index = iIndex;
				}
				if (sameTarget(oTarget, oControl)) {
					return oTarget;
				}
			}
		}
		return null;
	}

	function cssFallback(oDom) {
		var aParts = [];
		for (var oNode = oDom; oNode && oNode !== document.body && aParts.length < 4; oNode = oNode.parentElement) {
			var sPart = oNode.tagName.toLowerCase();
			var aClasses = Array.prototype.filter.call(oNode.classList, function (s) {
				return /^sap[A-Z]/.test(s) && !/(Focus|Hover|Active|Pressed|Selected)/.test(s);
			}).slice(0, 2);
			if (aClasses.length) {
				sPart += "." + aClasses.join(".");
			}
			aParts.unshift(sPart);
		}
		return { selector: aParts.join(" > ") };
	}

	function fromControl(oControl, oDom) {
		for (var iLevel = 0; oControl && iLevel < MAX_PARENT_LEVELS; iLevel++) {
			var oControlDom = oControl.getDomRef && oControl.getDomRef();
			if (oControlDom) {
				var oTarget = byId(oControl);
				if (oTarget) {
					return { target: oTarget, element: oControlDom, control: oControl, label: describe(oControl) + " \u201c" + oTarget.controlId + "\u201d", quality: "stable" };
				}
				oTarget = byProperties(oControl);
				if (oTarget) {
					var sProp = Object.keys(oTarget.properties)[0];
					return { target: oTarget, element: oControlDom, control: oControl, label: describe(oControl) + " \u201c" + oTarget.properties[sProp] + "\u201d", quality: "good" };
				}
			}
			oControl = oControl.getParent && oControl.getParent();
			if (oControl && !oControl.getDomRef) {
				break;
			}
		}
		var oFallback = cssFallback(oDom);
		var oFound = TargetResolver.resolve(oFallback);
		if (oFound) {
			return { target: oFallback, element: oFound, control: controlFor(oFound), label: oFallback.selector, quality: "fragile" };
		}
		return null;
	}

	return {
		controlFor: controlFor,

		/**
		 * @param {HTMLElement} oDom the clicked element
		 * @returns {{target: object, element: HTMLElement, control: object, label: string, quality: string}|null}
		 *   quality: "stable" (developer id), "good" (type + text), "fragile" (CSS)
		 */
		build: function (oDom) {
			return fromControl(controlFor(oDom), oDom);
		},

		/**
		 * Same as build, but for the next larger control around a previous result
		 * ("the whole filter bar instead of one of its buttons").
		 */
		buildParent: function (oPrevious) {
			var oParent = oPrevious && oPrevious.control && oPrevious.control.getParent();
			while (oParent && oParent.getDomRef && oPrevious.element && oParent.getDomRef() === oPrevious.element) {
				oParent = oParent.getParent(); // same DOM element, not really larger
			}
			if (!oParent || !oParent.getDomRef || !oParent.getDomRef()) {
				return null;
			}
			return fromControl(oParent, oParent.getDomRef());
		},

		_stableLocalId: stableLocalId // for tests
	};
});
