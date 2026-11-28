/*!
 * Fiori Guided Tours - SAP Fiori Launchpad plugin powered by ShepherdJS.
 *
 * The plugin is started once by the Launchpad. It
 *   1. reads the tour catalog (tours/index.json, or a URL from the plugin configuration),
 *   2. watches which app the user is in (intent, app id and in-app route),
 *   3. shows a "Guided Tour" button in the shell header when tours exist for that app,
 *   4. auto-starts a tour the first time a user opens the app (optional),
 *   5. lets apps start tours themselves through the UI5 EventBus,
 *   6. offers a point-and-click tour editor to authors (lib/editor, loaded on demand),
 *   7. keeps a tour going when it moves on to another app or the page is reloaded (TourSession).
 */
sap.ui.define([
	"sap/ui/core/Component",
	"sap/base/Log",
	"./lib/TourRegistry",
	"./lib/TourRunner",
	"./lib/AppContext",
	"./lib/SeenStore",
	"./lib/Text",
	"./lib/DraftStore",
	"./lib/TourStore",
	"./lib/TourSession",
	"./lib/AppMatch"
], function (Component, Log, TourRegistry, TourRunner, AppContext, SeenStore, Text, DraftStore, TourStore, TourSession, AppMatch) {
	"use strict";

	var LOG_COMPONENT = "fiori.shepherd.guide";
	var HEADER_BUTTON_ID = "fioriShepherdGuideHeaderButton";
	var EDITOR_BUTTON_ID = "fioriShepherdGuideEditorButton";
	var EVENT_CHANNEL = "fiori.shepherd.guide";

	function getContainer() {
		return sap.ui.require("sap/ushell/Container") || (window.sap && sap.ushell && sap.ushell.Container);
	}

	return Component.extend("fiori.shepherd.guide.Component", {
		metadata: {
			manifest: "json"
		},

		init: function () {
			if (Component.prototype.init) {
				Component.prototype.init.apply(this, arguments);
			}

			this._oConfig = this._readConfig();
			this._oBundle = this.getModel("i18n").getResourceBundle();
			this._oStore = new TourStore(this._oConfig.toursApiUrl);
			this._oRegistry = new TourRegistry(this._oConfig.toursUrl, this._oStore);
			this._oRunner = new TourRunner({ bundle: this._oBundle });
			this._aCurrentTours = [];
			this._iContextSeq = 0;

			this._bEditorEnabled = this._isEditorEnabled();
			if (this._bEditorEnabled) {
				// the author sees their unpublished drafts like normal tours
				this._oRegistry.setOverlay(DraftStore.list);
			}

			this._oHeaderItemReady = this._oConfig.showHeaderButton
				? this._createHeaderButton().catch(function (oError) {
					Log.error("Could not create the guided tour header button", oError, LOG_COMPONENT);
				})
				: Promise.resolve();
			if (this._bEditorEnabled) {
				this._createEditorButton().catch(function (oError) {
					Log.error("Could not create the tour editor header button", oError, LOG_COMPONENT);
				});
			}

			this._onHashChange = this._refreshContext.bind(this);
			window.addEventListener("hashchange", this._onHashChange);
			this._attachAppLoaded();

			var oEventBus = sap.ui.getCore().getEventBus();
			oEventBus.subscribe(EVENT_CHANNEL, "start", this._onStartRequested, this);
			oEventBus.subscribe(EVENT_CHANNEL, "reset", this._onResetRequested, this);

			this._refreshContext();
		},

		exit: function () {
			window.removeEventListener("hashchange", this._onHashChange);
			var oEventBus = sap.ui.getCore().getEventBus();
			oEventBus.unsubscribe(EVENT_CHANNEL, "start", this._onStartRequested, this);
			oEventBus.unsubscribe(EVENT_CHANNEL, "reset", this._onResetRequested, this);
			this._oRunner.cancel();
			if (this._oActionSheet) {
				this._oActionSheet.destroy();
			}
		},

		/* ------------------------------------------------------------------ */
		/* Configuration                                                       */
		/* ------------------------------------------------------------------ */

		/**
		 * Merges the defaults from manifest.json (sap.ui5/config/fioriGuide) with the plugin
		 * configuration the Launchpad passes in (target mapping parameters on ABAP,
		 * "config" of the plugin in the sandbox / CDM site on BTP).
		 */
		_readConfig: function () {
			var oDefaults = this.getManifestEntry("/sap.ui5/config/fioriGuide") || {};
			var oComponentData = this.getComponentData() || {};
			var oFlpConfig = oComponentData.config || {};
			var oConfig = Object.assign({}, oDefaults);

			Object.keys(oFlpConfig).forEach(function (sKey) {
				var vValue = oFlpConfig[sKey];
				// ABAP target mapping parameters arrive as strings
				if (vValue === "true") {
					vValue = true;
				} else if (vValue === "false") {
					vValue = false;
				}
				oConfig[sKey] = vValue;
			});

			if (!oConfig.toursUrl) {
				oConfig.toursUrl = sap.ui.require.toUrl("fiori/shepherd/guide/tours");
			}
			return oConfig;
		},

		/* ------------------------------------------------------------------ */
		/* Header button                                                       */
		/* ------------------------------------------------------------------ */

		_createHeaderButton: function () {
			var that = this;
			return this._createHeaderItem({
				id: HEADER_BUTTON_ID,
				icon: "sap-icon://learning-assistant",
				tooltip: this._oBundle.getText("headerButtonTooltip"),
				text: this._oBundle.getText("headerButtonTooltip"),
				ariaLabel: this._oBundle.getText("headerButtonTooltip"),
				press: function (oEvent) {
					that._onHeaderButtonPress(oEvent);
				}
			}).then(function (oItem) {
				that._fnShowButton = oItem.show;
				that._fnHideButton = oItem.hide;
				that._updateButtonVisibility();
			});
		},

		/**
		 * Adds a button to the end of the shell header.
		 * @returns {Promise<{show: function, hide: function}>}
		 */
		_createHeaderItem: function (oProps) {
			var that = this;
			var oContainer = getContainer();

			// Preferred API (newer UI5 versions): Extension service
			return oContainer.getServiceAsync("Extension").then(function (oExtension) {
				return oExtension.createHeaderItem(oProps, { position: "end" }).then(function (oItem) {
					return {
						show: function () {
							oItem.showOnHome();
							oItem.showForAllApps();
						},
						hide: function () {
							oItem.hideOnHome();
							oItem.hideForAllApps();
						}
					};
				});
			}, function () {
				// Fallback for older Launchpads: renderer API
				return that._getRenderer().then(function (oRenderer) {
					oRenderer.addHeaderEndItem("sap.ushell.ui.shell.ShellHeadItem", oProps, true, false);
					return {
						show: function () {
							oRenderer.showHeaderEndItem([oProps.id], false);
						},
						hide: function () {
							oRenderer.hideHeaderEndItem([oProps.id], false);
						}
					};
				});
			});
		},

		_getRenderer: function () {
			var oContainer = getContainer();
			return new Promise(function (resolve) {
				var oRenderer = oContainer.getRenderer && oContainer.getRenderer("fiori2");
				if (oRenderer) {
					resolve(oRenderer);
					return;
				}
				var fnOnCreated = function (oEvent) {
					oContainer.detachRendererCreatedEvent(fnOnCreated);
					resolve(oEvent.getParameter("renderer"));
				};
				oContainer.attachRendererCreatedEvent(fnOnCreated);
			});
		},

		_updateButtonVisibility: function () {
			if (!this._fnShowButton) {
				return;
			}
			if (this._aCurrentTours.length > 0 || this._getPausedTour() || !this._oConfig.hideButtonWithoutTours) {
				this._fnShowButton();
			} else {
				this._fnHideButton();
			}
		},

		_onHeaderButtonPress: function (oEvent) {
			var aTours = this._aCurrentTours;
			var oPaused = this._getPausedTour();
			if (oPaused) {
				this._openTourChooser(oEvent.getSource(), aTours, oPaused);
				return;
			}
			if (aTours.length === 0) {
				sap.ui.require(["sap/m/MessageToast"], function (MessageToast) {
					MessageToast.show(this._oBundle.getText("noTours"));
				}.bind(this));
				return;
			}
			if (aTours.length === 1) {
				this.startTour(aTours[0]);
				return;
			}
			this._openTourChooser(oEvent.getSource(), aTours);
		},

		_openTourChooser: function (oSource, aTours, oPaused) {
			var that = this;
			sap.ui.require(["sap/m/ActionSheet", "sap/m/Button"], function (ActionSheet, Button) {
				if (that._oActionSheet) {
					that._oActionSheet.destroy();
				}
				var aButtons = aTours.map(function (oTour) {
					return new Button({
						text: Text.resolve(oTour.title) || oTour.id,
						icon: oTour.icon || "sap-icon://learning-assistant",
						press: function () {
							that.startTour(oTour);
						}
					});
				});
				if (oPaused) {
					aButtons.unshift(new Button("fioriShepherdGuideContinue", {
						text: that._oBundle.getText("continueTour", [
							Text.resolve(oPaused.def.title) || oPaused.def.id,
							oPaused.index + 1,
							oPaused.def.steps.length
						]),
						icon: "sap-icon://media-play",
						type: "Emphasized",
						press: function () {
							that.continueTour();
						}
					}));
					aButtons.push(new Button("fioriShepherdGuideEndPaused", {
						text: that._oBundle.getText("endPausedTour"),
						icon: "sap-icon://decline",
						press: function () {
							TourSession.clear();
							that._updateButtonVisibility();
						}
					}));
				}
				that._oActionSheet = new ActionSheet({
					title: that._oBundle.getText("chooseTour"),
					showCancelButton: true,
					placement: "Bottom",
					buttons: aButtons
				});
				that._oActionSheet.openBy(oSource);
			});
		},

		/* ------------------------------------------------------------------ */
		/* App context tracking                                                */
		/* ------------------------------------------------------------------ */

		_attachAppLoaded: function () {
			var that = this;
			getContainer().getServiceAsync("AppLifeCycle").then(function (oAppLifeCycle) {
				that._oAppLifeCycle = oAppLifeCycle;
				oAppLifeCycle.attachAppLoaded(function () {
					that._refreshContext();
				});
				that._refreshContext();
			}).catch(function (oError) {
				Log.warning("AppLifeCycle service not available; matching by URL hash only", oError, LOG_COMPONENT);
			});
		},

		_refreshContext: function () {
			var that = this;
			var iSeq = ++this._iContextSeq;
			var oContext = AppContext.fromHash(window.location.hash, this._oAppLifeCycle);
			var oPrevious = this._oContext;

			// a step that belongs to another app pauses the tour (in-app navigation keeps it running)
			this._oRunner.notifyContext(oContext);
			if (this._oEditor && this._oEditor.isOpen() && (!oPrevious || oPrevious.intent !== oContext.intent)) {
				this._oContext = oContext;
				this._oEditor.refreshContext();
			}

			this._oRegistry.findTours(oContext).then(function (aTours) {
				if (iSeq !== that._iContextSeq) {
					return; // the user navigated on in the meantime
				}
				that._oContext = oContext;
				that._aCurrentTours = aTours;
				that._oHeaderItemReady.then(that._updateButtonVisibility.bind(that));
				// a tour the user is in the middle of goes first; never auto-start another one then
				if (!that._maybeResume(oContext) && !that._getPausedTour()) {
					that._maybeAutoStart(aTours);
				}
			});
		},

		/** Where the user is right now (the hash changes before the app is loaded). */
		_currentContext: function () {
			return AppContext.fromHash(window.location.hash, this._oAppLifeCycle);
		},

		/** The tour the user is in the middle of (paused or running), or null. */
		_getPausedTour: function () {
			if (this._oRunner.isBusy()) {
				return null;
			}
			return TourSession.load(this._oConfig.resumeMinutes);
		},

		/**
		 * Goes on with a tour that was paused (other app) or interrupted (page reload) when the
		 * user is now in the app of its next step.
		 * @returns {boolean} true when the tour goes on
		 */
		_maybeResume: function (oContext) {
			var oState = this._getPausedTour();
			if (!oState) {
				return false;
			}
			var iIndex = TourRunner.resumeIndex(oState.def, oState.index, oContext);
			if (iIndex < 0) {
				return false;
			}
			this._runTour(oState.def, { startAt: iIndex, resumed: true, preview: oState.preview });
			return true;
		},

		/**
		 * Goes on with the paused tour: right here when it belongs to this app, otherwise opens
		 * the app of its next step (when the tour says which one).
		 */
		continueTour: function () {
			var that = this;
			var oState = this._getPausedTour();
			if (!oState) {
				return;
			}
			if (this._maybeResume(this._currentContext())) {
				return;
			}
			var oApp = TourRunner.stepApps(oState.def)[oState.index];
			var sHash = AppMatch.hashOf(oApp);
			if (sHash) {
				window.location.hash = sHash; // the tour goes on once the app is open
				return;
			}
			sap.ui.require(["sap/m/MessageToast"], function (MessageToast) {
				MessageToast.show(that._oBundle.getText("openAppToContinue", [AppMatch.labelOf(oApp)]));
			});
		},

		_maybeAutoStart: function (aTours) {
			// never interrupt a running tour or an author who is editing
			if (this._oRunner.isBusy() || (this._oEditor && this._oEditor.isOpen())) {
				return;
			}
			var oGlobalAutoStart = this._oConfig.autoStart;
			var oTour = aTours.find(function (oCandidate) {
				var bAuto = oCandidate.autoStart !== undefined ? oCandidate.autoStart : oGlobalAutoStart;
				return bAuto && !SeenStore.hasSeen(oCandidate);
			});
			if (oTour) {
				// give the app a moment to render its first screen
				setTimeout(this.startTour.bind(this, oTour, { auto: true }), this._oConfig.autoStartDelay || 1000);
			}
		},

		/* ------------------------------------------------------------------ */
		/* Tour editor                                                         */
		/* ------------------------------------------------------------------ */

		/**
		 * enableEditor: true (always), false (never) or "url" (default): only when the
		 * Launchpad URL contains fiori-guide-editor=true, e.g.
		 * .../FioriLaunchpad.html?fiori-guide-editor=true#SalesOrder-manage
		 */
		_isEditorEnabled: function () {
			var vSetting = this._oConfig.enableEditor === undefined ? "url" : this._oConfig.enableEditor;
			if (vSetting === true || vSetting === false) {
				return vSetting;
			}
			try {
				return new URLSearchParams(window.location.search).get("fiori-guide-editor") === "true";
			} catch (e) {
				return false;
			}
		},

		_createEditorButton: function () {
			var that = this;
			return this._createHeaderItem({
				id: EDITOR_BUTTON_ID,
				icon: "sap-icon://edit",
				tooltip: this._oBundle.getText("editorButtonTooltip"),
				text: this._oBundle.getText("editorButtonTooltip"),
				ariaLabel: this._oBundle.getText("editorButtonTooltip"),
				press: function () {
					that.openEditor();
				}
			}).then(function (oItem) {
				oItem.show();
			});
		},

		/** Opens (or closes) the tour editor; loads its code on first use. */
		openEditor: function () {
			var that = this;
			if (this._oEditor) {
				this._oEditor.toggle();
				return Promise.resolve(this._oEditor);
			}
			return new Promise(function (resolve, reject) {
				sap.ui.require(["fiori/shepherd/guide/lib/editor/TourEditor"], function (TourEditor) {
					that._oEditor = new TourEditor(that._createEditorApi());
					that._oEditor.open();
					resolve(that._oEditor);
				}, reject);
			});
		},

		/** What the editor may use from the plugin. */
		_createEditorApi: function () {
			var that = this;
			return {
				getBundle: function () {
					return that._oBundle;
				},
				getContext: function () {
					return that._oContext || AppContext.fromHash(window.location.hash, that._oAppLifeCycle);
				},
				getToursForContext: function () {
					return that._oRegistry.findTours(this.getContext());
				},
				loadTourById: function (sId) {
					return that._oRegistry.getById(sId).then(function (oEntry) {
						return that._oRegistry.loadTour(oEntry);
					});
				},
				previewTour: function (oDef) {
					return that._runTour(oDef, { preview: true });
				},
				onDraftsChanged: function () {
					that._refreshContext();
					return Promise.resolve();
				},
				/** Whether tours can be published to the tour database (config toursApiUrl). */
				isDatabaseEnabled: function () {
					return that._oStore.isEnabled();
				},
				/** Saves the tour in the database for all users and drops the local draft. */
				publishTour: function (oDef) {
					return that._oStore.save(oDef, that._getUserId()).then(function (oResult) {
						DraftStore.remove(oDef.id);
						that._oRegistry.reload();
						that._refreshContext();
						return oResult;
					});
				},
				/** Removes the tour from the database (a tour in index.json shows again). */
				unpublishTour: function (sId) {
					return that._oStore.remove(sId, that._getUserId()).then(function (oResult) {
						that._oRegistry.reload();
						that._refreshContext();
						return oResult;
					});
				},
				/** Ids of the tours in the tour database. */
				getDatabaseIds: function () {
					return that._oRegistry.loadIndex().then(function (aTours) {
						return aTours.filter(function (oTour) {
							return oTour.source === "db";
						}).map(function (oTour) {
							return oTour.id;
						});
					});
				},
				getPublishKey: function () {
					return TourStore.getKey();
				},
				setPublishKey: function (sKey) {
					TourStore.setKey(sKey);
				},
				/** Catalog file content with the drafts merged in (drafts carry their steps inline). */
				buildExportCatalog: function () {
					return that._oRegistry.loadIndex().then(function (aIndex) {
						// database tours go into the file with their steps, so the export is complete
						return Promise.all(aIndex.map(function (oTour) {
							if (oTour.source !== "db") {
								return oTour;
							}
							return that._oRegistry.loadTour(oTour).then(function (oFull) {
								var oOut = Object.assign({}, oFull);
								delete oOut.source;
								delete oOut.updatedAt;
								delete oOut.updatedBy;
								return oOut;
							}, function () {
								return null;
							});
						}));
					}).then(function (aLoaded) {
						var aCatalog = aLoaded.filter(Boolean);
						var aDrafts = DraftStore.list();
						var mDrafts = {};
						aDrafts.forEach(function (oDraft) {
							mDrafts[oDraft.id] = oDraft;
						});
						var aTours = aCatalog.map(function (oTour) {
							return mDrafts[oTour.id] || oTour;
						});
						aDrafts.forEach(function (oDraft) {
							if (!aCatalog.some(function (oTour) {
								return oTour.id === oDraft.id;
							})) {
								aTours.push(oDraft);
							}
						});
						return { tours: aTours };
					});
				}
			};
		},

		_getUserId: function () {
			try {
				var oContainer = getContainer();
				var oUser = oContainer && oContainer.getUser && oContainer.getUser();
				return (oUser && oUser.getId && oUser.getId()) || "";
			} catch (e) {
				return "";
			}
		},

		/* ------------------------------------------------------------------ */
		/* Public API                                                          */
		/* ------------------------------------------------------------------ */

		/**
		 * Starts a tour.
		 * @param {object|string} vTour Catalog entry or tour id
		 * @returns {Promise} resolves when the tour has started
		 */
		startTour: function (vTour) {
			var that = this;
			var pEntry = typeof vTour === "string" ? this._oRegistry.getById(vTour) : Promise.resolve(vTour);
			return pEntry.then(function (oEntry) {
				if (!oEntry) {
					throw new Error("Unknown tour: " + vTour);
				}
				return that._oRegistry.loadTour(oEntry);
			}).then(function (oTour) {
				return that._runTour(oTour, {});
			}).catch(function (oError) {
				Log.error("Could not start guided tour", oError, LOG_COMPONENT);
			});
		},

		/**
		 * Runs a tour and keeps track of its progress, so it can go on in another app or after
		 * a reload.
		 * @param {object} oDef full tour (with steps)
		 * @param {{startAt: number, resumed: boolean, preview: boolean}} mOptions preview: an
		 *        editor preview, which does not count as "seen"
		 */
		_runTour: function (oDef, mOptions) {
			var that = this;
			var bPreview = !!mOptions.preview;
			// keep only what is needed to go on later (catalog entries may carry more)
			var oSaved = Object.assign({}, oDef);
			delete oSaved.isDraft;
			var fnSave = function (iIndex) {
				TourSession.save({ def: oSaved, index: iIndex, preview: bPreview });
			};
			return this._oRunner.start(oDef, {
				startAt: mOptions.startAt,
				resumed: mOptions.resumed,
				getContext: this._currentContext.bind(this),
				onStep: fnSave,
				onPause: function (iIndex, oApp, bNavigate) {
					fnSave(iIndex);
					var sHash = bNavigate ? AppMatch.hashOf(oApp) : "";
					if (sHash) {
						window.location.hash = sHash; // "Next" into another app opens that app
					}
					setTimeout(that._updateButtonVisibility.bind(that), 0);
				},
				onFinish: function () {
					TourSession.clear();
					if (!bPreview) {
						SeenStore.markSeen(oDef);
					}
					that._updateButtonVisibility();
				}
			});
		},

		_onStartRequested: function (sChannel, sEvent, oData) {
			if (oData && oData.tourId) {
				this.startTour(oData.tourId);
			} else if (this._aCurrentTours.length) {
				this.startTour(this._aCurrentTours[0]);
			}
		},

		_onResetRequested: function (sChannel, sEvent, oData) {
			SeenStore.reset(oData && oData.tourId);
		}
	});
});
