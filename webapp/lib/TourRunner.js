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
 *   advanceOn      "click" (or another DOM event): go to the next step when the user does this on the target
 *   showNext       keep the Next button although advanceOn is set
 *   canClickTarget false blocks clicks on the highlighted element (default true)
 *   classes        extra CSS classes for the step popup
 *
 * Tour fields: steps (required), modal (default true: dims the rest of the screen).
 */
sap.ui.define([
	"./ShepherdLoader",
	"./TargetResolver",
	"./Text"
], function (ShepherdLoader, TargetResolver, Text) {
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

	TourRunner.prototype._buildStep = function (oTour, oStep, iIndex, iCount) {
		var oBundle = this._oBundle;
		var bLast = iIndex === iCount - 1;
		var vTarget = oStep.target;
		var sAdvanceEvent = typeof oStep.advanceOn === "string" ? oStep.advanceOn
			: oStep.advanceOn && oStep.advanceOn.event;
		var sStepId = oStep.id ? String(oStep.id).replace(/[^\w-]/g, "_") : "step-" + (iIndex + 1);
		var oFound = null;
		var fnAdvanceListener = null;

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
				action: function () {
					if (bLast) {
						oTour.complete();
					} else {
						oTour.next();
					}
				}
			});
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
					if (sAdvanceEvent && oFound) {
						var oTarget = oFound;
						fnAdvanceListener = function () {
							oTarget.removeEventListener(sAdvanceEvent, fnAdvanceListener, true);
							fnAdvanceListener = null;
							// let the app react to the click first (e.g. open a dialog)
							setTimeout(function () {
								if (oTour.isActive() && oTour.getCurrentStep() && oTour.getCurrentStep().id === sStepId) {
									if (bLast) {
										oTour.complete();
									} else {
										oTour.next();
									}
								}
							}, 50);
						};
						oTarget.addEventListener(sAdvanceEvent, fnAdvanceListener, true);
					}
				},
				hide: function () {
					if (fnAdvanceListener && oFound) {
						oFound.removeEventListener(sAdvanceEvent, fnAdvanceListener, true);
						fnAdvanceListener = null;
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
					return oFound || TargetResolver.resolve(vTarget);
				},
				on: oStep.position || "bottom"
			};
			oOptions.beforeShowPromise = function () {
				return TargetResolver.waitFor(vTarget, oStep.waitFor).then(function (oDom) {
					oFound = oDom;
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
