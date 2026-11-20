/*!
 * Fiori Guided Tours - SAP Fiori Launchpad plugin powered by ShepherdJS.
 *
 * The plugin is started once by the Launchpad. It
 *   1. reads the tour catalog (tours/index.json, or a URL from the plugin configuration),
 *   2. watches which app the user is in (intent, app id and in-app route),
 *   3. shows a "Guided Tour" button in the shell header when tours exist for that app,
 *   4. auto-starts a tour the first time a user opens the app (optional),
 *   5. lets apps start tours themselves through the UI5 EventBus,
 *   6. offers a point-and-click tour editor to authors (lib/editor, loaded on demand).
 */
sap.ui.define([
	"sap/ui/core/Component",
	"sap/base/Log",
	"./lib/TourRegistry",
	"./lib/TourRunner",
	"./lib/AppContext",
	"./lib/SeenStore",
	"./lib/Text",
	"./lib/DraftStore"
], function (Component, Log, TourRegistry, TourRunner, AppContext, SeenStore, Text, DraftStore) {
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
			this._oRegistry = new TourRegistry(this._oConfig.toursUrl);
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
			if (this._aCurrentTours.length > 0 || !this._oConfig.hideButtonWithoutTours) {
				this._fnShowButton();
			} else {
				this._fnHideButton();
			}
		},

		_onHeaderButtonPress: function (oEvent) {
			var aTours = this._aCurrentTours;
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

		_openTourChooser: function (oSource, aTours) {
			var that = this;
			sap.ui.require(["sap/m/ActionSheet", "sap/m/Button"], function (ActionSheet, Button) {
				if (that._oActionSheet) {
					that._oActionSheet.destroy();
				}
				that._oActionSheet = new ActionSheet({
					title: that._oBundle.getText("chooseTour"),
					showCancelButton: true,
					placement: "Bottom",
					buttons: aTours.map(function (oTour) {
						return new Button({
							text: Text.resolve(oTour.title) || oTour.id,
							icon: oTour.icon || "sap-icon://learning-assistant",
							press: function () {
								that.startTour(oTour);
							}
						});
					})
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

			// leaving the app ends its tour (in-app navigation keeps it running)
			if (oPrevious && oPrevious.intent !== oContext.intent) {
				this._oRunner.cancel();
			}
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
				that._maybeAutoStart(aTours);
			});
		},

		_maybeAutoStart: function (aTours) {
			// never interrupt a running tour or an author who is editing
			if (this._oRunner.isActive() || (this._oEditor && this._oEditor.isOpen())) {
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
					return that._oRunner.start(oDef);
				},
				onDraftsChanged: function () {
					that._refreshContext();
					return Promise.resolve();
				},
				/** Catalog file content with the drafts merged in (drafts carry their steps inline). */
				buildExportCatalog: function () {
					return that._oRegistry.loadIndex().then(function (aCatalog) {
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
				return that._oRunner.start(oTour, {
					onFinish: function () {
						SeenStore.markSeen(oTour);
					}
				});
			}).catch(function (oError) {
				Log.error("Could not start guided tour", oError, LOG_COMPONENT);
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
