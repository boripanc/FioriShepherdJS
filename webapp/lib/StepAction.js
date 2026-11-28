/**
 * Things a step can do for the user: fill a value into the highlighted field and click the
 * highlighted element. Works for UI5 controls (through the control, so that the app sees the
 * change: model binding, change / liveChange handlers) and for plain HTML fields such as the
 * fields of a SAP GUI for HTML screen in an iframe (through DOM events).
 */
sap.ui.define(["./InputCheck"], function (InputCheck) {
	"use strict";

	/** The UI5 control the element belongs to (in the Launchpad window only), or null. */
	function controlOf(oDom) {
		var oWin = oDom && oDom.ownerDocument && oDom.ownerDocument.defaultView;
		if (!oWin || !oWin.sap || !oWin.sap.ui) {
			return null;
		}
		try {
			var Element = oWin.sap.ui.require("sap/ui/core/Element");
			if (Element && Element.closestTo) {
				return Element.closestTo(oDom) || null;
			}
			var jQuery = oWin.jQuery || oWin.sap.ui.require("sap/ui/thirdparty/jquery");
			return jQuery ? jQuery(oDom).control(0) || null : null;
		} catch (e) {
			return null;
		}
	}

	/** Sets the DOM value so that frameworks which wrap the "value" property still see it. */
	function setDomValue(oInput, sValue) {
		if (oInput.isContentEditable && oInput.value === undefined) {
			oInput.textContent = sValue;
			return;
		}
		var oProto = Object.getPrototypeOf(oInput);
		var oDesc = oProto && Object.getOwnPropertyDescriptor(oProto, "value");
		if (oDesc && oDesc.set) {
			oDesc.set.call(oInput, sValue);
		} else {
			oInput.value = sValue;
		}
	}

	function fire(oTarget, sType, mInit, sClass) {
		var oWin = oTarget.ownerDocument.defaultView || window;
		var C = oWin[sClass || "Event"] || oWin.Event;
		var oEvent = new C(sType, Object.assign({ bubbles: true, cancelable: true, composed: true }, mInit));
		if (mInit && mInit.keyCode) {
			// browsers ignore keyCode / which in the constructor, but UI5 and SAP GUI read them
			Object.defineProperty(oEvent, "keyCode", { value: mInit.keyCode });
			Object.defineProperty(oEvent, "which", { value: mInit.keyCode });
		}
		oTarget.dispatchEvent(oEvent);
	}

	return {
		/**
		 * Puts sValue into the field inside oDom.
		 * @returns {boolean} false when there is no field to fill
		 */
		fill: function (oDom, sValue) {
			sValue = sValue === undefined || sValue === null ? "" : String(sValue);
			var oInput = InputCheck.inputOf(oDom);
			if (!oInput) {
				return false;
			}
			try {
				oInput.focus({ preventScroll: true });
			} catch (e) {
				// not focusable
			}
			var oControl = controlOf(oInput);
			if (oControl && typeof oControl.setValue === "function") {
				// through the control: updates its binding and tells the app (liveChange, change)
				oControl.setValue(sValue);
				setDomValue(oInput, sValue); // some controls only render the value later
				if (typeof oControl.fireLiveChange === "function") {
					oControl.fireLiveChange({ value: sValue, newValue: sValue });
				}
				if (typeof oControl.fireChange === "function") {
					oControl.fireChange({ value: sValue, newValue: sValue });
				}
				fire(oInput, "input");
				return true;
			}
			// plain HTML (SAP GUI for HTML and others): what a browser does when the user types
			setDomValue(oInput, sValue);
			fire(oInput, "input", { inputType: "insertText", data: sValue }, "InputEvent");
			fire(oInput, "change");
			return true;
		},

		/** Clicks oDom the way a mouse does (pointer, mouse and click events). */
		click: function (oDom) {
			if (!oDom || !oDom.isConnected) {
				return false;
			}
			var oRect = oDom.getBoundingClientRect();
			var mPos = {
				clientX: oRect.left + oRect.width / 2,
				clientY: oRect.top + oRect.height / 2,
				button: 0,
				view: oDom.ownerDocument.defaultView
			};
			// the innermost element at the centre gets the events, as with a real click
			var oAt = oDom.ownerDocument.elementFromPoint(mPos.clientX, mPos.clientY);
			var oTarget = oAt && oDom.contains(oAt) ? oAt : oDom;
			var mDown = Object.assign({ buttons: 1, pointerId: 1, pointerType: "mouse", isPrimary: true }, mPos);
			var mUp = Object.assign({ buttons: 0, pointerId: 1, pointerType: "mouse", isPrimary: true }, mPos);
			fire(oTarget, "pointerdown", mDown, "PointerEvent");
			fire(oTarget, "mousedown", mDown, "MouseEvent");
			try {
				oTarget.focus({ preventScroll: true });
			} catch (e) {
				// not focusable
			}
			fire(oTarget, "pointerup", mUp, "PointerEvent");
			fire(oTarget, "mouseup", mUp, "MouseEvent");
			fire(oTarget, "click", Object.assign({ detail: 1 }, mUp), "MouseEvent");
			return true;
		},

		/** Presses Enter in the field inside oDom (keydown, keypress, keyup). */
		pressEnter: function (oDom) {
			var oInput = InputCheck.inputOf(oDom) || oDom;
			if (!oInput) {
				return false;
			}
			var mKey = { key: "Enter", code: "Enter", keyCode: 13, which: 13 };
			fire(oInput, "keydown", mKey, "KeyboardEvent");
			fire(oInput, "keypress", mKey, "KeyboardEvent");
			fire(oInput, "keyup", mKey, "KeyboardEvent");
			return true;
		}
	};
});
