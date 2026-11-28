/**
 * "Follow the user": a step with a Next button also moves on when the user does the step
 * directly in the app, so they do not have to come back to the popup and press Next.
 *
 *   - Buttons, links, tiles, list items: the user clicks the highlighted element.
 *   - Fields (UI5 input or SAP GUI field): the user enters a value and presses Enter or leaves
 *     the field, or ticks a checkbox / picks an entry.
 *   - Drop-downs without a text field (sap.m.Select, <select>): the user picks another entry.
 *   - Anything else the user did in the app that leads on: after the user clicked or typed
 *     somewhere, the next step's element appears (it was not there when this step opened), or
 *     this step's element went away while the next one is on the screen (new screen, dialog
 *     closed, SAP GUI moved on).
 *
 * Clicks and keys in the guide's own popup do not count. Works across same-origin iframes
 * (SAP GUI for HTML).
 */
sap.ui.define(["./TargetResolver", "./InputCheck"], function (TargetResolver, InputCheck) {
	"use strict";

	var POLL_MS = 300;

	function contains(oOuter, oInner) {
		return !!(oOuter && oInner && (oOuter === oInner || (oOuter.contains && oOuter.contains(oInner))));
	}

	function isGuideUi(oNode) {
		var oEl = oNode && oNode.nodeType === 1 ? oNode : oNode && oNode.parentElement;
		return !!(oEl && oEl.closest && oEl.closest(".shepherd-element, .fioriGuideEditor, .fioriGuideMenu"));
	}

	/** The one text field / checkbox of the target, or null when it is not a field. */
	function fieldOf(oDom) {
		if (!oDom) {
			return null;
		}
		if (/^(INPUT|TEXTAREA)$/.test(oDom.tagName) || oDom.isContentEditable) {
			return oDom.type === "hidden" ? null : oDom;
		}
		var aFields = oDom.querySelectorAll("input:not([type=hidden]), textarea, [contenteditable=true]");
		return aFields.length === 1 ? aFields[0] : null;
	}

	function isPicker(oDom) {
		return !!oDom && (oDom.tagName === "SELECT" || (oDom.classList && oDom.classList.contains("sapMSlt"))
			|| (oDom.getAttribute && oDom.getAttribute("role") === "combobox" && !fieldOf(oDom)));
	}

	function pickerValue(oDom) {
		return oDom.tagName === "SELECT" ? oDom.value : (oDom.textContent || "").trim();
	}

	function valueOf(oField) {
		if (oField.type === "checkbox" || oField.type === "radio") {
			return oField.checked ? "x" : "";
		}
		return String(InputCheck.valueOf(oField) || "").trim();
	}

	/**
	 * Starts following the user for one step.
	 * @param {object} m
	 * @param {HTMLElement} [m.element] the highlighted element (may be inside an iframe)
	 * @param {any} [m.target] its target description, to find it again after the app re-rendered it
	 * @param {any} [m.nextTarget] target of the next step (same app), if any
	 * @param {function} m.onDone called once, when the user did the step
	 * @returns {function} stops following
	 */
	function follow(m) {
		var bDone = false;
		var bActed = false; // the user clicked or typed in the app since this step opened
		var aCleanup = [];
		var aDocs = [];

		function done(iDelay) {
			if (bDone) {
				return;
			}
			bDone = true;
			stop();
			// let the app react first (open a dialog, run the transaction, load the next screen)
			setTimeout(m.onDone, iDelay || 0);
		}

		function listen(oTarget, sEvent, fn) {
			try {
				oTarget.addEventListener(sEvent, fn, true);
			} catch (e) {
				return; // the page is gone
			}
			aCleanup.push(function () {
				try {
					oTarget.removeEventListener(sEvent, fn, true);
				} catch (e) {
					// the page is gone
				}
			});
		}

		/** The highlighted element as it is now (UI5 or SAP GUI may have drawn it again). */
		function current() {
			if (m.element && m.element.isConnected) {
				return m.element;
			}
			return m.target ? TargetResolver.resolve(m.target) : null;
		}

		var oField = fieldOf(m.element);
		var bPicker = !oField && isPicker(m.element);
		var sPicked = bPicker ? pickerValue(m.element) : "";

		function inTarget(oNode) {
			return contains(current(), oNode) || contains(m.element, oNode);
		}

		function onPointer(oEvent) {
			if (isGuideUi(oEvent.target)) {
				return;
			}
			bActed = true;
			if (oEvent.type === "click" && m.element && !oField && !bPicker && inTarget(oEvent.target)) {
				done(50);
			}
		}

		function onKey(oEvent) {
			if (isGuideUi(oEvent.target)) {
				return;
			}
			bActed = true;
			if (oField && (oEvent.key === "Enter" || oEvent.key === "Tab") && inTarget(oEvent.target)) {
				var oNow = fieldOf(current()) || oField;
				if (valueOf(oNow) || valueOf(oField)) {
					done(300);
				}
			}
		}

		function onInput(oEvent) {
			if (!isGuideUi(oEvent.target)) {
				bActed = true; // SAP GUI may swallow the keys, but typing still fires "input"
			}
		}

		function onChange(oEvent) {
			if (oField && inTarget(oEvent.target)) {
				var oNow = fieldOf(current()) || oField;
				if (valueOf(oNow) || oNow.type === "checkbox" || oNow.type === "radio") {
					done(300);
				}
			}
		}

		function watchDocument(oDoc) {
			if (!oDoc || aDocs.indexOf(oDoc) >= 0) {
				return;
			}
			aDocs.push(oDoc);
			var oWin = oDoc.defaultView;
			if (!oWin) {
				return;
			}
			// on the window, capture: before the app (SAP GUI) handles and maybe stops the event
			listen(oWin, "pointerdown", onPointer);
			listen(oWin, "click", onPointer);
			listen(oWin, "keydown", onKey);
			listen(oWin, "change", onChange);
			listen(oWin, "input", onInput);
		}

		function watchDocuments() {
			aDocs = aDocs.filter(function (oDoc) {
				return oDoc.defaultView; // pages that were replaced are gone
			});
			watchDocument(document);
			if (m.element) {
				watchDocument(m.element.ownerDocument);
			}
			TargetResolver.frameDocuments(true).forEach(watchDocument);
		}

		var bNextMissing = !!m.nextTarget && !TargetResolver.resolve(m.nextTarget);

		function check() {
			if (bDone) {
				return;
			}
			watchDocuments(); // SAP GUI replaces its page on every screen
			if (bPicker) {
				var oPicker = current();
				if (oPicker && pickerValue(oPicker) !== sPicked) {
					done(300);
					return;
				}
			}
			if (!bActed || !m.nextTarget) {
				return;
			}
			if (!TargetResolver.resolve(m.nextTarget)) {
				return;
			}
			var bGone = !!m.target && !TargetResolver.resolve(m.target);
			if (bNextMissing || bGone) {
				done(0);
			}
		}

		function stop() {
			aCleanup.splice(0).forEach(function (fn) {
				fn();
			});
			aDocs = [];
		}

		watchDocuments();
		var iPoll = setInterval(check, POLL_MS);
		aCleanup.push(function () {
			clearInterval(iPoll);
		});
		return function () {
			bDone = true;
			stop();
		};
	}

	return {
		follow: follow,
		fieldOf: fieldOf
	};
});
