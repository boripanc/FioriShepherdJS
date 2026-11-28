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
 *   fillValue      the tour types this into the target field for the user (UI5 input or SAP GUI field)
 *   pressEnter     after fillValue: the tour also presses Enter in the field and goes on
 *   autoClick      true: the tour clicks the target for the user (after fillValue, if any) and goes on
 *   actionDelay    ms the step is shown before the tour fills / clicks, so the user can follow
 *                  (default 1500)
 *   showNext       keep the Next button although advanceOn is set
 *   followUser     false: on a Next step, only the Next button moves on. By default (true) a Next
 *                  step also moves on when the user does it directly in the app: clicks the
 *                  highlighted element, enters a value in the highlighted field (Enter / Tab /
 *                  leaving it), or does something that brings up the next step's element
 *                  (see FollowUser)
 *   canClickTarget false blocks clicks on the highlighted element (default true)
 *   classes        extra CSS classes for the step popup
 *   app            the app this step is shown in, for tours that move on to another app (see
 *                  AppMatch): "SalesOrder-manage", or { intent, appId, innerHash, hash }.
 *                  A step without it stays in the app of the step before (the first steps: the
 *                  tour's own intent / appId). When the user is somewhere else, the tour pauses
 *                  and goes on by itself once the user opens that app.
 *
 * Tour fields: steps (required), modal (default true: dims the rest of the screen),
 *   followUser (false turns "follow the user" off for all steps of the tour).
 */
sap.ui.define([
	"./ShepherdLoader",
	"./TargetResolver",
	"./Text",
	"./FrameProxy",
	"./InputCheck",
	"./AppMatch",
	"./StepAction",
	"./FollowUser"
], function (ShepherdLoader, TargetResolver, Text, FrameProxy, InputCheck, AppMatch, StepAction, FollowUser) {
	"use strict";

	var ACTION_DELAY_MS = 1500; // how long a step is shown before the tour fills / clicks for the user
	var RESUME_WAIT_MS = 10000; // a freshly opened app may need a while to render its controls

	function TourRunner(mSettings) {
		this._oBundle = mSettings.bundle;
		this._oTour = null;
		this._oRun = null;
		this._iStarting = 0;
	}

	/**
	 * The app each step belongs to (see the "app" step field), as AppMatch descriptions.
	 * Steps before the first "app" belong to the tour's own apps (intent / appId, without
	 * innerHash, so that moving around inside the app keeps the tour going).
	 */
	TourRunner.stepApps = function (oDef) {
		var oCurrent = { intent: oDef.intent, appId: oDef.appId };
		return (oDef.steps || []).filter(Boolean).map(function (oStep) {
			if (oStep.app) {
				oCurrent = AppMatch.normalize(oStep.app);
			}
			return oCurrent;
		});
	};

	function sameApp(oA, oB) {
		return JSON.stringify(oA) === JSON.stringify(oB);
	}

	/**
	 * Where to go on with a paused tour in this app: the step it stopped at, or the step after it
	 * (the user opened the next app themselves). -1 when neither belongs to this app.
	 */
	TourRunner.resumeIndex = function (oDef, iIndex, oContext) {
		var aApps = TourRunner.stepApps(oDef);
		if (aApps[iIndex] && AppMatch.matches(aApps[iIndex], oContext, true)) {
			return iIndex;
		}
		if (aApps[iIndex + 1] && AppMatch.matches(aApps[iIndex + 1], oContext, true)) {
			return iIndex + 1;
		}
		return -1;
	};

	TourRunner.prototype.isActive = function () {
		return !!(this._oTour && this._oTour.isActive() && !(this._oRun && this._oRun.pausing));
	};

	/** Active, or about to start. */
	TourRunner.prototype.isBusy = function () {
		return this._iStarting > 0 || this.isActive();
	};

	TourRunner.prototype.cancel = function () {
		if (this._oTour && this._oTour.isActive()) {
			this._oTour.cancel();
		}
	};

	/**
	 * The user moved somewhere else (another app or screen). If the current step does not belong
	 * there, the tour pauses; whoever owns the tour resumes it later with start({startAt}).
	 * @param {object} oContext from AppContext.fromHash
	 */
	TourRunner.prototype.notifyContext = function (oContext) {
		var oRun = this._oRun;
		if (!this.isActive() || !oRun || oRun.waiting) {
			return; // a step that is still waiting for its element checks the app itself
		}
		var iIndex = this._oTour.steps.indexOf(this._oTour.getCurrentStep());
		if (iIndex >= 0 && !oRun.matches(iIndex, oContext)) {
			oRun.pause(iIndex, false, true);
		}
	};

	/**
	 * @param {object} oDef tour definition (catalog entry merged with its steps)
	 * @param {object} [mOptions]
	 * @param {function} [mOptions.onFinish] the user finished or closed the tour
	 * @param {function(number)} [mOptions.onStep] a step is about to be shown (index)
	 * @param {function(number, object, boolean)} [mOptions.onPause] the tour paused because the
	 *        step (index) belongs to another app (AppMatch description); true: the user pressed
	 *        Next, so it is fine to open that app for them
	 * @param {function(): object} [mOptions.getContext] where the user is now (AppContext)
	 * @param {number} [mOptions.startAt] index of the first step to show (resuming a tour)
	 * @returns {Promise<object>} the Shepherd tour once started
	 */
	TourRunner.prototype.start = function (oDef, mOptions) {
		var that = this;
		mOptions = mOptions || {};
		this._iStarting++;
		return ShepherdLoader.load().then(function (Shepherd) {
			that._iStarting--;
			that.cancel();

			var aSteps = (oDef.steps || []).filter(Boolean);
			if (!aSteps.length) {
				throw new Error("Tour " + oDef.id + " has no steps");
			}
			var iStartAt = Math.min(Math.max(mOptions.startAt || 0, 0), aSteps.length - 1);

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

			var aApps = TourRunner.stepApps(oDef);
			var oRun = {
				apps: aApps,
				steps: aSteps,
				followUser: oDef.followUser !== false,
				skipBefore: iStartAt, // steps before this are skipped (once) when resuming
				resumed: iStartAt > 0 || !!mOptions.resumed,
				lastShown: -1,
				waiting: false,
				pausing: false,
				navigateOnPause: false,
				matches: function (i, oContext) {
					return AppMatch.matches(aApps[i], oContext, true);
				},
				currentContext: function () {
					return mOptions.getContext ? mOptions.getContext() : null;
				},
				stepStarts: function (i) {
					if (mOptions.onStep) {
						mOptions.onStep(i);
					}
				},
				/** Ends the Shepherd tour but keeps it "in progress", to go on with start({startAt}). */
				pause: function (i, bNavigate, bNow) {
					if (oRun.pausing) {
						return;
					}
					oRun.pausing = true;
					if (mOptions.onPause) {
						mOptions.onPause(i, aApps[i], !!bNavigate);
					}
					var fnEnd = function () {
						if (oTour.isActive()) {
							oTour.cancel();
						}
					};
					if (bNow) {
						fnEnd();
					} else {
						setTimeout(fnEnd, 0); // not while Shepherd is in the middle of showing a step
					}
				}
			};

			aSteps.forEach(function (oStep, i) {
				oTour.addStep(that._buildStep(oTour, oStep, i, aSteps.length, oRun));
			});

			var bFinished = false;
			var fnFinish = function () {
				if (!bFinished && !oRun.pausing) {
					bFinished = true;
					if (mOptions.onFinish) {
						mOptions.onFinish();
					}
				}
			};
			oTour.on("complete", fnFinish);
			oTour.on("cancel", fnFinish);

			that._oTour = oTour;
			that._oRun = oRun;
			oTour.start();
			return oTour;
		}, function (oError) {
			that._iStarting--;
			throw oError;
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

	TourRunner.prototype._buildStep = function (oTour, oStepIn, iIndex, iCount, oRun) {
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
		var bFill = vTarget && oStep.fillValue !== undefined && oStep.fillValue !== null;
		// the tour moves on by itself after clicking / pressing Enter for the user
		var bAuto = !!vTarget && (oStep.autoClick === true || (bFill && oStep.pressEnter === true));
		// a Next step also moves on when the user does it in the app (see FollowUser)
		var bFollow = oRun.followUser && oStep.followUser !== false && !sAdvanceEvent && !bAuto && !bFill
			&& oStep.canClickTarget !== false;
		var vNextTarget = null;
		if (bFollow && !bLast && sameApp(oRun.apps[iIndex], oRun.apps[iIndex + 1])) {
			vNextTarget = normalizeStep(oRun.steps[iIndex + 1]).target || null;
		}
		var sStepId = oStep.id ? String(oStep.id).replace(/[^\w-]/g, "_") : "step-" + (iIndex + 1);
		var oFound = null; // the real element (may be inside an iframe)
		var oProxy = null; // stand-in in the Launchpad page for elements inside an iframe
		var aCleanup = [];

		function goOn(bFromButton) {
			if (oTour.isActive() && oTour.getCurrentStep() && oTour.getCurrentStep().id === sStepId) {
				if (bLast) {
					oTour.complete();
				} else {
					// Next may lead into another app: then it is fine to open that app for the user
					oRun.navigateOnPause = bFromButton === true;
					oTour.next();
					oRun.navigateOnPause = false;
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
		// going back into another app would only make the tour disappear
		if (iIndex > 0 && sameApp(oRun.apps[iIndex - 1], oRun.apps[iIndex])) {
			aButtons.push({
				text: oBundle.getText("btnBack"),
				classes: "fioriGuideBtn fioriGuideBtnSecondary",
				secondary: true,
				action: function () {
					oTour.back();
				}
			});
		}
		if ((!sAdvanceEvent && !bAuto) || oStep.showNext) {
			aButtons.push({
				text: oBundle.getText(bLast ? "btnDone" : "btnNext"),
				classes: "fioriGuideBtn fioriGuideBtnPrimary",
				action: function () {
					goOn(true);
				}
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
			var bWasRight = false; // the right value was in the field (the app may empty it later)
			listen(oInput, "input", function () {
				refresh(false);
				if (String(InputCheck.valueOf(oInput) || "").trim()) {
					bWasRight = isRight();
				}
				if (sAdvanceEvent === "input" && isRight() && !bDone) {
					bDone = true;
					setTimeout(goOn, 400);
				}
			});
			if (sAdvanceEvent === "enter") {
				// Listen on the window (capture) so this runs before the app's own key handling:
				// SAP GUI for HTML handles Enter itself and may stop the event before it reaches
				// the field.
				var oWin = oInput.ownerDocument.defaultView || window;
				listen(oWin, "keydown", function (oEvent) {
					if (oEvent.key !== "Enter" || bDone || !(oEvent.target === oInput || oInput.contains(oEvent.target))) {
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

				// Safety net when the Enter key is not seen (e.g. the app starts the transaction from
				// a button, or reloads its page): the right value was in the field and then the
				// screen changed (field gone, page replaced, or title / fields changed).
				var fnScreen = function () {
					try {
						var oDoc = oInput.ownerDocument;
						return oInput.isConnected && oDoc.defaultView
							? oDoc.title + "|" + oDoc.querySelectorAll("input, textarea").length : "";
					} catch (e) {
						return ""; // the page is gone
					}
				};
				var sScreen = fnScreen();
				var iWatch = setInterval(function () {
					if (bDone) {
						return;
					}
					var sNow = fnScreen();
					if (sNow && sNow === sScreen) {
						// the GUI empties the field when it runs the transaction: keep what we saw
						var sValue = String(InputCheck.valueOf(oInput) || "").trim();
						if (sValue) {
							bWasRight = isRight();
						}
						return;
					}
					if (bWasRight) {
						bDone = true;
						goOn();
					} else {
						sScreen = sNow; // a different screen, but not because of the value we asked for
					}
				}, 250);
				aCleanup.push(function () {
					clearInterval(iWatch);
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

		/** Fills the field and / or clicks the target for the user, after a short pause. */
		function setupAction(oStepEl) {
			var oBox = document.createElement("div");
			oBox.className = "fioriGuideAuto";
			oBox.setAttribute("aria-live", "polite");
			oBox.textContent = oBundle.getText(bAuto ? "autoDoing" : "autoFilling");
			var oText = oStepEl && (oStepEl.querySelector(".shepherd-text") || oStepEl.querySelector(".shepherd-content"));
			if (oText) {
				oText.appendChild(oBox);
			}
			var oDom = oFound;
			var iDelay = typeof oStep.actionDelay === "number" ? Math.max(oStep.actionDelay, 0) : ACTION_DELAY_MS;
			var iTimer = setTimeout(function () {
				iTimer = 0;
				if (!oTour.isActive() || oTour.getCurrentStep() !== oTour.getById(sStepId)) {
					return;
				}
				if (bFill) {
					StepAction.fill(oDom, Text.resolve(oStep.fillValue));
				}
				if (bFill && oStep.pressEnter === true) {
					StepAction.pressEnter(oDom);
				}
				if (oStep.autoClick === true) {
					StepAction.click(oDom);
				}
				oBox.classList.add("fioriGuideAutoDone");
				oBox.textContent = oBundle.getText("autoDone");
				if (bAuto) {
					// let the app react first (open a dialog, load the next screen)
					setTimeout(goOn, 400);
				}
			}, iDelay);
			aCleanup.push(function () {
				if (iTimer) {
					clearTimeout(iTimer);
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
					oRun.lastShown = iIndex;
					oRun.resumed = false;
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
					} else if (!bAuto && sAdvanceEvent && sAdvanceEvent !== "enter" && sAdvanceEvent !== "input" && oFound) {
						var bFired = false;
						listen(oFound, sAdvanceEvent, function () {
							if (!bFired) {
								bFired = true;
								// let the app react to the click first (e.g. open a dialog)
								setTimeout(goOn, 50);
							}
						});
					}
					if (bFollow && (oFound || vNextTarget)) {
						aCleanup.push(FollowUser.follow({
							element: oFound,
							target: oFound ? vTarget : null,
							nextTarget: vNextTarget,
							onDone: goOn
						}));
					}
					if ((bFill || bAuto) && oFound) {
						setupAction(oStepEl);
					} else if (bAuto) {
						setTimeout(goOn, 0); // nothing to click on: do not leave the user without a button
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

		/**
		 * false (and the tour pauses) when the user is not in this step's app. Going back into
		 * another app (keyboard arrows) shows the step the user came from again instead.
		 */
		function checkApp() {
			var oContext = oRun.currentContext();
			if (!oContext || oRun.matches(iIndex, oContext)) {
				return true;
			}
			if (oRun.lastShown > iIndex && oRun.matches(oRun.lastShown, oContext)) {
				var iBack = oRun.lastShown;
				setTimeout(function () {
					oTour.show(iBack);
				}, 0);
			} else {
				// Next into another app, or a tour started elsewhere (editor preview): open that app
				oRun.pause(iIndex, oRun.navigateOnPause || (oRun.lastShown < 0 && !oRun.resumed));
			}
			return false;
		}
		function never() {
			return new Promise(function () {}); // this step is not shown now
		}

		oOptions.beforeShowPromise = function () {
			if (!checkApp()) {
				return never();
			}
			oRun.stepStarts(iIndex);
			if (!vTarget) {
				return Promise.resolve();
			}
			var iWait = oStep.waitFor;
			if (oRun.resumed) {
				iWait = Math.max(iWait === undefined ? 5000 : iWait, RESUME_WAIT_MS);
			}
			oRun.waiting = true;
			return TargetResolver.waitFor(vTarget, iWait).then(function (oDom) {
				oRun.waiting = false;
				// the user may have moved on to another app in the meantime
				if (!oTour.isActive() || oRun.pausing || oTour.getCurrentStep() !== oTour.getById(sStepId)
					|| !checkApp()) {
					return never();
				}
				oFound = oDom;
				if (oProxy) {
					oProxy.destroy();
					oProxy = null;
				}
			});
		};

		// when resuming, the steps the user has already seen are skipped (once)
		oOptions.showOn = function () {
			if (iIndex < oRun.skipBefore) {
				return false;
			}
			if (iIndex === oRun.skipBefore) {
				oRun.skipBefore = 0;
			}
			return !(vTarget && oStep.skipIfMissing && !TargetResolver.resolve(vTarget));
		};

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
		}

		return oOptions;
	};

	return TourRunner;
});
