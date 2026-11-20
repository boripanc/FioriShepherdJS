/**
 * Turns a tour definition (JSON) into a running ShepherdJS tour.
 *
 * Step fields:
 *   id             optional step id
 *   title, text    text or { lang: text }; "text" may contain simple HTML
 *   target         see TargetResolver; omit for a centered step
 *   position       "top" | "bottom" | "left" | "right" (+ "-start" / "-end"), "auto"; default "bottom"
 *   waitFor        ms to wait for the target to appear (default 5000)
 *   skipIfMissing  skip the step when the target is not on screen
 *   advanceOn      "click" (or another DOM event): go to the next step when the user does this on the target;
 *                  with expectValue: "enter" (default) or "input" (as soon as the value is right)
 *   expectValue    the user must type this into the target field, e.g. "VA01" (see InputCheck)
 *   expectHint     what to show instead of expectValue (useful for regular expressions)
 *   blockWrongValue false lets Enter through even when the typed value is wrong (default: blocked)
 *   tcode          "VA01": shortcut for a transaction code step in SAP GUI for HTML (command field,
 *                  ignores /n and /o, continues on Enter)
 *   showNext       keep the Next button although advanceOn is set
 *   canClickTarget false blocks clicks on the highlighted element (default true)
 *   classes        extra CSS classes for the step popup
 *
 * Tour fields: steps (required), modal (default true: dims the rest of the screen).
 */
sap.ui.define([
	"./ShepherdLoader",
	"./TargetResolver",
	"./Text",
	"./FrameProxy",
	"./InputCheck"
], function (ShepherdLoader, TargetResolver, Text, FrameProxy, InputCheck) {
	"use strict";

	function TourRunner(mSettings) {
		this._oBundle = mSettings.bundle;
		this._oTour = null;
	}

	TourRunner.prototype.isActive = function () {
		return !!(this._oTour && this._oTour.isActive());
	};

	TourRunner.prototype.cancel = function () {
		if (this.isActive()) {
			this._oTour.cancel();
		}
	};

	/**
	 * @param {object} oDef tour definition (catalog entry merged with its steps)
	 * @param {{onFinish: function}} [mOptions]
	 * @returns {Promise<object>} the Shepherd tour once started
	 */
	TourRunner.prototype.start = function (oDef, mOptions) {
		var that = this;
		mOptions = mOptions || {};
		return ShepherdLoader.load().then(function (Shepherd) {
			that.cancel();

			var aSteps = (oDef.steps || []).filter(Boolean);
			if (!aSteps.length) {
				throw new Error("Tour " + oDef.id + " has no steps");
			}

			var oTour = new Shepherd.Tour({
				tourName: oDef.id,
				useModalOverlay: oDef.modal !== false,
				exitOnEsc: true,
				keyboardNavigation: true,
				defaultStepOptions: {
					classes: "fioriGuideStep",
					scrollTo: { behavior: "smooth", block: "center" },
					cancelIcon: { enabled: true, label: that._oBundle.getText("cancelTour") },
					modalOverlayOpeningPadding: 6,
					modalOverlayOpeningRadius: 8
				}
			});

			aSteps.forEach(function (oStep, i) {
				oTour.addStep(that._buildStep(oTour, oStep, i, aSteps.length));
			});

			var bFinished = false;
			var fnFinish = function () {
				if (!bFinished) {
					bFinished = true;
					if (mOptions.onFinish) {
						mOptions.onFinish();
					}
				}
			};
			oTour.on("complete", fnFinish);
			oTour.on("cancel", fnFinish);

			that._oTour = oTour;
			oTour.start();
			return oTour;
		});
	};

	/** Applies shortcuts: "tcode" steps default to the SAP GUI command field and Enter. */
	function normalizeStep(oStep) {
		if (!oStep.tcode) {
			return oStep;
		}
		var oOut = Object.assign({}, oStep);
		if (typeof oStep.tcode === "string" && oOut.expectValue === undefined) {
			oOut.expectValue = oStep.tcode;
		}
		oOut.tcode = true;
		if (!oOut.target) {
			oOut.target = { webgui: "okcode" };
		}
		if (!oOut.advanceOn) {
			oOut.advanceOn = "enter";
		}
		return oOut;
	}

	TourRunner.prototype._buildStep = function (oTour, oStepIn, iIndex, iCount) {
		var oBundle = this._oBundle;
		var oStep = normalizeStep(oStepIn);
		var bLast = iIndex === iCount - 1;
		var vTarget = oStep.target;
		var bExpect = oStep.expectValue !== undefined && oStep.expectValue !== null && oStep.expectValue !== "";
		var sAdvanceEvent = typeof oStep.advanceOn === "string" ? oStep.advanceOn
			: oStep.advanceOn && oStep.advanceOn.event;
		if (bExpect && sAdvanceEvent !== "input") {
			sAdvanceEvent = "enter"; // typed values are confirmed with Enter unless stated otherwise
		}
		var sStepId = oStep.id ? String(oStep.id).replace(/[^\w-]/g, "_") : "step-" + (iIndex + 1);
		var oFound = null; // the real element (may be inside an iframe)
		var oProxy = null; // stand-in in the Launchpad page for elements inside an iframe
		var aCleanup = [];

		function goOn() {
			if (oTour.isActive() && oTour.getCurrentStep() && oTour.getCurrentStep().id === sStepId) {
				if (bLast) {
					oTour.complete();
				} else {
					oTour.next();
				}
			}
		}

		function listen(oTarget, sEvent, fn) {
			oTarget.addEventListener(sEvent, fn, true);
			aCleanup.push(function () {
				oTarget.removeEventListener(sEvent, fn, true);
			});
		}

		var aButtons = [];
		if (iIndex > 0) {
			aButtons.push({
				text: oBundle.getText("btnBack"),
				classes: "fioriGuideBtn fioriGuideBtnSecondary",
				secondary: true,
				action: function () {
					oTour.back();
				}
			});
		}
		if (!sAdvanceEvent || oStep.showNext) {
			aButtons.push({
				text: oBundle.getText(bLast ? "btnDone" : "btnNext"),
				classes: "fioriGuideBtn fioriGuideBtnPrimary",
				action: goOn
			});
		}

		function setupExpectedValue(oStepEl) {
			var oInput = InputCheck.inputOf(oFound);
			var sShown = InputCheck.display(oStep.expectValue, Text.resolve(oStep.expectHint));
			var oBox = document.createElement("div");
			oBox.className = "fioriGuideExpect";
			var oLabel = document.createElement("span");
			oLabel.className = "fioriGuideExpectLabel";
			oLabel.textContent = oBundle.getText(sAdvanceEvent === "enter" ? "typeThenEnter" : "typeThis");
			var oValue = document.createElement("code");
			oValue.className = "fioriGuideExpectValue";
			oValue.textContent = sShown;
			var oState = document.createElement("span");
			oState.className = "fioriGuideExpectState";
			oState.setAttribute("aria-live", "polite");
			oBox.appendChild(oLabel);
			oBox.appendChild(oValue);
			oBox.appendChild(oState);
			var oText = oStepEl && (oStepEl.querySelector(".shepherd-text") || oStepEl.querySelector(".shepherd-content"));
			if (oText) {
				oText.appendChild(oBox);
			}
			if (!oInput) {
				return;
			}

			function isRight() {
				return InputCheck.matches(InputCheck.valueOf(oInput), oStep.expectValue, oStep.tcode);
			}
			function refresh(bShowError) {
				var bRight = isRight();
				oBox.classList.toggle("fioriGuideExpectOk", bRight);
				oBox.classList.toggle("fioriGuideExpectError", !bRight && !!bShowError);
				oState.textContent = bRight ? "\u2713" : bShowError ? oBundle.getText("typeWrong", [sShown]) : "";
			}
			var bDone = false;
			listen(oInput, "input", function () {
				refresh(false);
				if (sAdvanceEvent === "input" && isRight() && !bDone) {
					bDone = true;
					setTimeout(goOn, 400);
				}
			});
			if (sAdvanceEvent === "enter") {
				listen(oInput, "keydown", function (oEvent) {
					if (oEvent.key !== "Enter" || bDone) {
						return;
					}
					if (isRight()) {
						bDone = true;
						refresh(false);
						// let the app (e.g. SAP GUI) process Enter and open the next screen first
						setTimeout(goOn, 300);
					} else if (oStep.blockWrongValue !== false) {
						oEvent.preventDefault();
						oEvent.stopPropagation();
						oEvent.stopImmediatePropagation();
						refresh(true);
						oBox.classList.remove("fioriGuideShake");
						void oBox.offsetWidth; // restart the animation
						oBox.classList.add("fioriGuideShake");
					}
				});
			}
			refresh(false);
			setTimeout(function () {
				try {
					oInput.focus({ preventScroll: true });
				} catch (e) {
					// element not focusable
				}
			}, 350);
		}

		var oOptions = {
			id: sStepId,
			title: Text.resolve(oStep.title),
			text: Text.resolve(oStep.text),
			buttons: aButtons,
			canClickTarget: oStep.canClickTarget !== false,
			when: {
				show: function () {
					var oStepEl = this.getElement();
					var oFooter = oStepEl && oStepEl.querySelector(".shepherd-footer");
					if (oFooter && iCount > 1) {
						var oProgress = document.createElement("span");
						oProgress.className = "fioriGuideProgress";
						oProgress.textContent = oBundle.getText("stepProgress", [iIndex + 1, iCount]);
						oFooter.insertBefore(oProgress, oFooter.firstChild);
					}
					if (bExpect && oFound) {
						setupExpectedValue(oStepEl);
					} else if (sAdvanceEvent && sAdvanceEvent !== "enter" && sAdvanceEvent !== "input" && oFound) {
						var bFired = false;
						listen(oFound, sAdvanceEvent, function () {
							if (!bFired) {
								bFired = true;
								// let the app react to the click first (e.g. open a dialog)
								setTimeout(goOn, 50);
							}
						});
					}
				},
				hide: function () {
					aCleanup.splice(0).forEach(function (fn) {
						fn();
					});
					if (oProxy) {
						oProxy.destroy();
						oProxy = null;
					}
				}
			}
		};

		if (oStep.classes) {
			oOptions.classes = "fioriGuideStep " + oStep.classes;
		}

		if (vTarget) {
			oOptions.attachTo = {
				element: function () {
					var oDom = oFound || TargetResolver.resolve(vTarget);
					if (FrameProxy.isInFrame(oDom)) {
						if (!oProxy) {
							oProxy = new FrameProxy(oDom);
						}
						return oProxy.getElement();
					}
					return oDom;
				},
				on: oStep.position || "bottom"
			};
			oOptions.beforeShowPromise = function () {
				return TargetResolver.waitFor(vTarget, oStep.waitFor).then(function (oDom) {
					oFound = oDom;
					if (oProxy) {
						oProxy.destroy();
						oProxy = null;
					}
				});
			};
			if (oStep.skipIfMissing) {
				oOptions.showOn = function () {
					return !!TargetResolver.resolve(vTarget);
				};
			}
		}

		return oOptions;
	};

	return TourRunner;
});
