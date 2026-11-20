/*!
 * Fiori Guided Tours - SAP Fiori Launchpad plugin powered by ShepherdJS.
 *
 * The plugin is started once by the Launchpad. It
 *   1. reads the tour catalog (tours/index.json, or a URL from the plugin configuration),
 *   2. watches which app the user is in (intent, app id and in-app route),
 *   3. shows a "Guided Tour" button in the shell header when tours exist for that app,
 *   4. auto-starts a tour the first time a user opens the app (optional),
 *   5. lets apps start tours themselves through the UI5 EventBus.
 */
sap.ui.define([
	"sap/ui/core/Component",
	"sap/base/Log",
	"./lib/TourRegistry",
	"./lib/TourRunner",
	"./lib/AppContext",
	"./lib/SeenStore",
	"./lib/Text"
], function (Component, Log, TourRegistry, TourRunner, AppContext, SeenStore, Text) {
	"use strict";

	var LOG_COMPONENT = "fiori.shepherd.guide";
	var HEADER_BUTTON_ID = "fioriShepherdGuideHeaderButton";
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

			this._oHeaderItemReady = this._oConfig.showHeaderButton
				? this._createHeaderButton().catch(function (oError) {
					Log.error("Could not create the guided tour header button", oError, LOG_COMPONENT);
				})
				: Promise.resolve();

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
			var oProps = {
				id: HEADER_BUTTON_ID,
				icon: "sap-icon://learning-assistant",
				tooltip: this._oBundle.getText("headerButtonTooltip"),
				text: this._oBundle.getText("headerButtonTooltip"),
				ariaLabel: this._oBundle.getText("headerButtonTooltip"),
				press: function (oEvent) {
					that._onHeaderButtonPress(oEvent);
				}
			};
			var oContainer = getContainer();

			// Preferred API (newer UI5 versions): Extension service
			return oContainer.getServiceAsync("Extension").then(function (oExtension) {
				return oExtension.createHeaderItem(oProps, { position: "end" }).then(function (oItem) {
					that._fnShowButton = function () {
						oItem.showOnHome();
						oItem.showForAllApps();
					};
					that._fnHideButton = function () {
						oItem.hideOnHome();
						oItem.hideForAllApps();
					};
				});
			}, function () {
				// Fallback for older Launchpads: renderer API
				return that._getRenderer().then(function (oRenderer) {
					oRenderer.addHeaderEndItem("sap.ushell.ui.shell.ShellHeadItem", oProps, true, false);
					that._fnShowButton = function () {
						oRenderer.showHeaderEndItem([HEADER_BUTTON_ID], false);
					};
					that._fnHideButton = function () {
						oRenderer.hideHeaderEndItem([HEADER_BUTTON_ID], false);
					};
				});
			}).then(function () {
				that._updateButtonVisibility();
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
			if (this._oRunner.isActive()) {
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
