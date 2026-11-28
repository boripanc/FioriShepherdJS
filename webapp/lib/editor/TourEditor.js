/**
 * Point-and-click tour editor that runs inside the Launchpad.
 *
 * The author opens the editor in the app they want to explain, clicks "Add step", clicks a
 * control on the screen and types a title and text. The editor works out a stable way to
 * find that control again (see SelectorBuilder), so nobody has to deal with ids or JSON.
 * Tours are saved as drafts in the browser (visible only to the author). From there they are
 * published to the tour database (n8n, config toursApiUrl), so every user gets them at once,
 * or exported as index.json for deployment.
 *
 * A tour can go across apps: the author keeps the editor open, opens the next app and adds
 * more steps there. Those steps remember their app ("app" in the tour JSON).
 */
sap.ui.define([
	"sap/ui/model/json/JSONModel",
	"sap/m/Page",
	"sap/m/Bar",
	"sap/m/Title",
	"sap/m/Button",
	"sap/m/Label",
	"sap/m/Input",
	"sap/m/TextArea",
	"sap/m/CheckBox",
	"sap/m/Select",
	"sap/m/List",
	"sap/m/CustomListItem",
	"sap/m/HBox",
	"sap/m/VBox",
	"sap/m/Text",
	"sap/m/ObjectStatus",
	"sap/m/Toolbar",
	"sap/m/ToolbarSpacer",
	"sap/m/OverflowToolbar",
	"sap/m/MessageToast",
	"sap/m/MessageBox",
	"sap/m/MessageStrip",
	"sap/m/Dialog",
	"sap/ui/core/Item",
	"sap/ui/core/Icon",
	"sap/ui/dom/includeStylesheet",
	"../Text",
	"../TargetResolver",
	"./ElementPicker",
	"./SelectorBuilder",
	"../DraftStore",
	"../AppMatch",
	"../StartPage",
	"sap/m/FlexItemData"
], function (JSONModel, Page, Bar, Title, Button, Label, Input, TextArea, CheckBox, Select, List, CustomListItem,
	HBox, VBox, MText, ObjectStatus, Toolbar, ToolbarSpacer, OverflowToolbar, MessageToast, MessageBox, MessageStrip, Dialog, Item, Icon,
	includeStylesheet, Text, TargetResolver, ElementPicker, SelectorBuilder, DraftStore, AppMatch, StartPage, FlexItemData) {
	"use strict";

	var NEW_TOUR_KEY = "__new";
	var POSITIONS = ["bottom", "top", "left", "right", "bottom-start", "bottom-end", "top-start", "top-end", "auto"];

	function slug(s) {
		return String(s || "").toLowerCase().normalize("NFKD").replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
	}

	function escapeRegex(s) {
		return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}

	/** In-app route prefix for "only on this screen", e.g. "SalesOrder('4711')/items" -> "^SalesOrder" */
	function screenPattern(sInnerHash) {
		var sPrefix = (sInnerHash || "").split(/[(/?&]/)[0];
		return sPrefix ? "^" + escapeRegex(sPrefix) : "^$";
	}

	/** How the user moves on from a step: next | click | auto (the guide clicks) | typeEnter | type */
	function advanceOf(oStep) {
		if (oStep.autoClick === true) {
			return "auto";
		}
		if (oStep.tcode || (oStep.expectValue !== undefined && oStep.expectValue !== "")) {
			return oStep.advanceOn === "input" ? "type" : "typeEnter";
		}
		return oStep.advanceOn === "click" ? "click" : "next";
	}

	function TourEditor(oPlugin) {
		this._oPlugin = oPlugin;
		this._oBundle = oPlugin.getBundle();
		this._oModel = new JSONModel();
		this._oModel.setSizeLimit(500);
		this._oPicker = null;
		this._oPage = null;
		this._oRoot = null;
	}

	TourEditor.prototype.t = function (sKey, aArgs) {
		return this._oBundle.getText(sKey, aArgs);
	};

	TourEditor.prototype.isOpen = function () {
		return !!(this._oRoot && this._oRoot.style.display !== "none");
	};

	TourEditor.prototype.toggle = function () {
		if (this.isOpen()) {
			this.close();
		} else {
			this.open();
		}
	};

	TourEditor.prototype.open = function () {
		includeStylesheet(sap.ui.require.toUrl("fiori/shepherd/guide/css/editor.css"), "fioriShepherdGuideEditorCss");
		if (!this._oRoot) {
			this._oRoot = document.createElement("div");
			this._oRoot.id = "fioriGuideEditor";
			this._oRoot.className = "fioriGuideEditor sapUiSizeCompact";
			document.body.appendChild(this._oRoot);
			this._oPicker = new ElementPicker({
				ignoreRoot: this._oRoot,
				label: function (sQuality) {
					return this.t("editor.quality." + sQuality);
				}.bind(this)
			});
			this._createUi().placeAt(this._oRoot);
		}
		this._oRoot.style.display = "";
		document.body.classList.add("fioriGuideEditorOpen");
		this.refreshContext();
	};

	TourEditor.prototype.close = function () {
		if (this._oPicker) {
			this._oPicker.stop();
		}
		if (this._oRoot) {
			this._oRoot.style.display = "none";
		}
		document.body.classList.remove("fioriGuideEditorOpen");
	};

	/** Called when the editor opens and whenever the user navigates to another app. */
	TourEditor.prototype.refreshContext = function () {
		var that = this;
		var oContext = this._oPlugin.getContext();
		var oPrevious = this._oModel.getProperty("/context");
		if (oPrevious && oPrevious.intent === oContext.intent && this._oModel.getProperty("/dirty")) {
			this._oModel.setProperty("/context", oContext);
			return; // keep unsaved work while moving around inside the same app
		}
		var oTour = this._oModel.getProperty("/tour");
		if (oPrevious && oTour && (this._oModel.getProperty("/dirty") || (oTour.steps || []).length)) {
			// the author went on to another app: keep the tour, the next steps belong to this app
			return this._oPlugin.getToursForContext().then(function (aTours) {
				var sKey = that._oModel.getProperty("/selectedTourKey");
				var aItems = that._tourItems(aTours);
				if (!aItems.some(function (oItem) {
					return oItem.key === sKey;
				})) {
					aItems.push({ key: sKey, text: oTour.title || that.t("editor.untitled") });
				}
				that._oModel.setProperty("/context", oContext);
				that._oModel.setProperty("/tours", aItems);
				that._oModel.setProperty("/selectedTourKey", sKey);
				that._refreshStepStates();
				return that._updateDatabaseIds();
			});
		}
		return this._oPlugin.getToursForContext().then(function (aTours) {
			that._oModel.setData({
				context: oContext,
				tours: that._tourItems(aTours),
				selectedTourKey: aTours.length ? aTours[0].id : NEW_TOUR_KEY,
				tour: null,
				selectedStep: -1,
				dirty: false,
				positions: POSITIONS.map(function (s) {
					return { key: s, text: that.t("editor.position." + s.replace("-", "_")) };
				})
			});
			return Promise.all([that._loadTour(that._oModel.getProperty("/selectedTourKey")), that._updateDatabaseIds()]);
		});
	};

	/** Which tours are in the tour database, for the "Remove from database" button. */
	TourEditor.prototype._updateDatabaseIds = function () {
		var that = this;
		var bEnabled = !!(this._oPlugin.isDatabaseEnabled && this._oPlugin.isDatabaseEnabled());
		this._oModel.setProperty("/dbEnabled", bEnabled);
		if (!bEnabled) {
			this._oModel.setProperty("/dbIds", []);
			return Promise.resolve();
		}
		return this._oPlugin.getDatabaseIds().then(function (aIds) {
			that._oModel.setProperty("/dbIds", aIds);
		}, function () {
			that._oModel.setProperty("/dbIds", []);
		});
	};

	TourEditor.prototype._tourItems = function (aTours) {
		var that = this;
		return [{ key: NEW_TOUR_KEY, text: this.t("editor.newTour") }].concat(aTours.map(function (oTour) {
			return { key: oTour.id, text: (Text.resolve(oTour.title) || oTour.id) + (DraftStore.get(oTour.id) ? " " + that.t("editor.draftSuffix") : "") };
		}));
	};

	/**
	 * The app of each step as AppMatch descriptions, the same way the tour runner sees it.
	 * New steps carry the app they were picked in (pickContext) until they are saved.
	 */
	TourEditor.prototype._stepApps = function () {
		var oTour = this._oModel.getProperty("/tour") || {};
		var oContext = this._oModel.getProperty("/context") || {};
		var oPrev = { intent: oTour.intent || oContext.intent, appId: oTour.appId };
		return (oTour.steps || []).map(function (oStep) {
			if (oStep.app) {
				oPrev = AppMatch.normalize(oStep.app);
			} else if (oStep.pickContext && !AppMatch.matches(oPrev, oStep.pickContext, true)) {
				oPrev = { intent: oStep.pickContext.intent };
			}
			return oPrev;
		});
	};

	/** Updates "is the element on screen" and "which app" for every step. */
	TourEditor.prototype._refreshStepStates = function () {
		var that = this;
		var oTour = this._oModel.getProperty("/tour");
		if (!oTour) {
			return;
		}
		var oContext = this._oModel.getProperty("/context") || {};
		var oTourApp = { intent: oTour.intent || oContext.intent, appId: oTour.appId };
		var aApps = this._stepApps();
		// label every step with its app once the tour goes across apps
		var bSeveralApps = aApps.some(function (oApp) {
			return JSON.stringify(oApp) !== JSON.stringify(oTourApp);
		});
		(oTour.steps || []).forEach(function (oStep, i) {
			var bHere = AppMatch.matches(aApps[i], oContext, true);
			oStep.appLabel = bSeveralApps ? that.t("editor.stepApp", [AppMatch.labelOf(aApps[i])]) : "";
			if (!oStep.target) {
				oStep.quality = "none";
			} else if (!bHere) {
				oStep.quality = "otherApp";
			} else if (oStep.quality !== "fragile") {
				oStep.quality = TargetResolver.resolve(oStep.target) ? "found" : "missing";
			}
		});
		this._oModel.refresh(true);
	};

	TourEditor.prototype._loadTour = function (sKey) {
		var that = this;
		var oContext = this._oModel.getProperty("/context");
		if (sKey === NEW_TOUR_KEY) {
			this._setTour({
				id: "",
				title: "",
				autoStart: true,
				onlyThisScreen: false,
				intent: oContext.intent,
				// where users are taken when they start the guide from another page
				start: StartPage.suggestion(),
				version: 1,
				steps: []
			});
			return Promise.resolve();
		}
		return this._oPlugin.loadTourById(sKey).then(function (oTour) {
			that._setTour({
				id: oTour.id,
				title: Text.resolve(oTour.title),
				titleI18n: typeof oTour.title === "object" ? oTour.title : null,
				autoStart: oTour.autoStart !== false,
				onlyThisScreen: oTour.innerHash !== undefined,
				innerHash: oTour.innerHash,
				intent: oTour.intent,
				appId: oTour.appId,
				start: oTour.start || "",
				listed: oTour.listed,
				version: oTour.version || 1,
				modal: oTour.modal,
				steps: (oTour.steps || []).map(function (oStep) {
					var oFound = oStep.target ? TargetResolver.resolve(oStep.target) : null;
					return Object.assign({}, oStep, {
						title: Text.resolve(oStep.title),
						text: Text.resolve(oStep.text),
						titleI18n: typeof oStep.title === "object" ? oStep.title : null,
						textI18n: typeof oStep.text === "object" ? oStep.text : null,
						position: oStep.position || "bottom",
						advance: advanceOf(oStep),
						expectValue: oStep.tcode && typeof oStep.tcode === "string" ? oStep.tcode
							: Array.isArray(oStep.expectValue) ? oStep.expectValue.join(", ") : oStep.expectValue || "",
						tcode: !!oStep.tcode,
						fillValue: oStep.fillValue === undefined || oStep.fillValue === null ? "" : Text.resolve(oStep.fillValue),
						fillValueI18n: typeof oStep.fillValue === "object" ? oStep.fillValue : null,
						pressEnter: oStep.pressEnter === true,
						followUser: oStep.followUser !== false,
						targetLabel: oStep.target ? that._describeTarget(oStep.target) : that.t("editor.noTarget"),
						quality: oStep.target ? (oFound ? "found" : "missing") : "none"
					});
				})
			});
		});
	};

	TourEditor.prototype._setTour = function (oTour) {
		this._oModel.setProperty("/tour", oTour);
		this._oModel.setProperty("/selectedStep", -1);
		this._oModel.setProperty("/dirty", false);
		this._refreshStepStates();
		this._showStep(-1);
	};

	TourEditor.prototype._describeTarget = function (oTarget) {
		if (typeof oTarget === "string") {
			return oTarget;
		}
		if (oTarget.webgui === "okcode") {
			return this.t("editor.okcodeLabel");
		}
		if (oTarget.frame) {
			var oDom = TargetResolver.resolve(oTarget);
			var sName = oDom && (oDom.getAttribute("title") || oDom.getAttribute("aria-label"));
			return sName ? this.t("editor.frameFieldLabel", [sName]) : String(oTarget.selector || "").replace(/\\/g, "");
		}
		if (oTarget.controlId) {
			return "\u201c" + oTarget.controlId + "\u201d";
		}
		if (oTarget.controlType) {
			var aProps = Object.keys(oTarget.properties || {});
			return oTarget.controlType.split(".").pop() + (aProps.length ? " \u201c" + oTarget.properties[aProps[0]] + "\u201d" : "");
		}
		return oTarget.selector || "";
	};

	/* ---------------------------------------------------------------------- */
	/* UI                                                                      */
	/* ---------------------------------------------------------------------- */

	TourEditor.prototype._createUi = function () {
		var that = this;
		var oModel = this._oModel;

		var oTourSelect = new Select({
			width: "100%",
			selectedKey: "{/selectedTourKey}",
			items: { path: "/tours", template: new Item({ key: "{key}", text: "{text}" }), templateShareable: false },
			change: function (oEvent) {
				that._loadTour(oEvent.getParameter("selectedItem").getKey());
			}
		});

		this._oStepList = new List({
			mode: "SingleSelectMaster",
			noDataText: this.t("editor.noSteps"),
			items: {
				path: "/tour/steps",
				templateShareable: false,
				factory: function (sId, oCtx) {
					var iIndex = Number(oCtx.getPath().split("/").pop());
					return new CustomListItem(sId, {
						content: new HBox({
							alignItems: "Center",
							items: [
								new MText({ text: String(iIndex + 1) }).addStyleClass("fioriGuideEditorStepNo"),
								new VBox({
									items: [
										new MText({ text: { path: "title", formatter: function (sTitle) {
											return sTitle || that.t("editor.untitled");
										} }, maxLines: 1 }).addStyleClass("fioriGuideEditorStepTitle"),
										new MText({ text: { parts: ["appLabel", "targetLabel"], formatter: function (sApp, sTarget) {
											return sApp ? sApp + " \u00b7 " + (sTarget || "") : sTarget;
										} }, maxLines: 1 }).addStyleClass("fioriGuideEditorStepTarget")
									]
								}).addStyleClass("fioriGuideEditorStepText"),
								new Icon({
									src: { parts: ["quality", "advance"], formatter: function (sQuality, sAdvance) {
										if (sQuality === "missing" || sQuality === "fragile") {
											return "sap-icon://message-warning";
										}
										if (sQuality === "otherApp") {
											return "sap-icon://chain-link";
										}
										if (sAdvance === "typeEnter" || sAdvance === "type") {
											return "sap-icon://keyboard-and-mouse";
										}
										return sAdvance === "click" ? "sap-icon://touch" : "";
									} },
									color: { path: "quality", formatter: function (sQuality) {
										return sQuality === "missing" || sQuality === "fragile" ? "Critical" : "Default";
									} },
									tooltip: { path: "quality", formatter: function (sQuality) {
										if (sQuality === "missing") {
											return that.t("editor.targetMissing");
										}
										if (sQuality === "otherApp") {
											return that.t("editor.otherApp");
										}
										return sQuality === "fragile" ? that.t("editor.quality.fragile") : "";
									} }
								})
							]
						})
					});
				}
			},
			selectionChange: function (oEvent) {
				var oItem = oEvent.getParameter("listItem");
				that._showStep(Number(oItem.getBindingContext().getPath().split("/").pop()));
			}
		});

		this._oStepForm = new VBox({
			visible: "{= ${/selectedStep} >= 0 }",
			items: [
				new Toolbar({
					style: "Clear",
					content: [
						new Title({ text: this.t("editor.stepDetails"), level: "H4" }),
						new ToolbarSpacer(),
						new Button({ icon: "sap-icon://navigation-up-arrow", tooltip: this.t("editor.moveUp"), type: "Transparent", press: this._moveStep.bind(this, -1) }),
						new Button({ icon: "sap-icon://navigation-down-arrow", tooltip: this.t("editor.moveDown"), type: "Transparent", press: this._moveStep.bind(this, 1) }),
						new Button({ icon: "sap-icon://delete", tooltip: this.t("editor.deleteStep"), type: "Transparent", press: this._deleteStep.bind(this) })
					]
				}),
				new Label({ text: this.t("editor.stepTitle"), labelFor: "fioriGuideEditorStepTitleInput" }),
				new Input("fioriGuideEditorStepTitleInput", { value: "{title}", valueLiveUpdate: true, liveChange: this._markDirty.bind(this) }),
				new Label({ text: this.t("editor.stepText") }),
				new TextArea("fioriGuideEditorStepTextInput", { value: "{text}", rows: 4, width: "100%", valueLiveUpdate: true, liveChange: this._markDirty.bind(this), placeholder: this.t("editor.stepTextPlaceholder") }),
				new Label({ text: this.t("editor.highlights") }),
				new HBox({
					alignItems: "Center",
					items: [
						new ObjectStatus({
							text: "{targetLabel}",
							icon: "{= ${quality} === 'none' ? 'sap-icon://message-popup' : 'sap-icon://cursor-arrow' }",
							state: "{= ${quality} === 'stable' || ${quality} === 'found' ? 'Success' : ${quality} === 'good' ? 'Information' : ${quality} === 'none' ? 'None' : 'Warning' }"
						}).addStyleClass("fioriGuideEditorTarget"),
						new Button("fioriGuideEditorRepick", { text: this.t("editor.pickAgain"), type: "Transparent", icon: "sap-icon://touch", press: this._repickTarget.bind(this) }),
						new Button("fioriGuideEditorWiden", { icon: "sap-icon://full-screen", tooltip: this.t("editor.largerArea"), type: "Transparent",
							visible: "{= ${quality} !== 'none' }",
							press: this._widenTarget.bind(this) }),
						new Button({ icon: "sap-icon://show", tooltip: this.t("editor.showElement"), type: "Transparent", enabled: "{= ${quality} !== 'none' }", press: this._flashTarget.bind(this) })
					]
				}),
				new Label({ text: this.t("editor.position"), visible: "{= ${quality} !== 'none' }" }),
				new Select({
					width: "100%",
					visible: "{= ${quality} !== 'none' }",
					selectedKey: "{position}",
					change: this._markDirty.bind(this),
					items: { path: "/positions", template: new Item({ key: "{key}", text: "{text}" }), templateShareable: false }
				}),
				new Label({ text: this.t("editor.advance"), visible: "{= ${quality} !== 'none' }" }),
				new Select("fioriGuideEditorAdvance", {
					width: "100%",
					visible: "{= ${quality} !== 'none' }",
					selectedKey: "{advance}",
					change: this._markDirty.bind(this),
					items: [
						new Item({ key: "next", text: this.t("editor.advance.next") }),
						new Item({ key: "click", text: this.t("editor.advance.click") }),
						new Item({ key: "auto", text: this.t("editor.advance.auto") }),
						new Item({ key: "typeEnter", text: this.t("editor.advance.typeEnter") }),
						new Item({ key: "type", text: this.t("editor.advance.type") })
					]
				}),
				new Label({ text: this.t("editor.expectValue"), required: true, visible: "{= ${quality} !== 'none' && (${advance} === 'typeEnter' || ${advance} === 'type') }" }),
				new Input("fioriGuideEditorExpectValue", {
					value: "{expectValue}",
					valueLiveUpdate: true,
					placeholder: this.t("editor.expectValuePlaceholder"),
					visible: "{= ${quality} !== 'none' && (${advance} === 'typeEnter' || ${advance} === 'type') }",
					liveChange: this._markDirty.bind(this)
				}),
				new CheckBox({ wrapping: true, text: this.t("editor.tcode"), selected: "{tcode}",
					visible: "{= ${quality} !== 'none' && (${advance} === 'typeEnter' || ${advance} === 'type') }",
					select: this._markDirty.bind(this) }),
				new Label({ text: this.t("editor.fillValue"), visible: "{= ${quality} !== 'none' && ${advance} !== 'typeEnter' && ${advance} !== 'type' }" }),
				new Input("fioriGuideEditorFillValue", {
					value: "{fillValue}",
					valueLiveUpdate: true,
					placeholder: this.t("editor.fillValuePlaceholder"),
					visible: "{= ${quality} !== 'none' && ${advance} !== 'typeEnter' && ${advance} !== 'type' }",
					liveChange: this._markDirty.bind(this)
				}),
				new CheckBox("fioriGuideEditorPressEnter", { wrapping: true, text: this.t("editor.pressEnter"), selected: "{pressEnter}",
					visible: "{= ${quality} !== 'none' && (${advance} === 'next' || ${advance} === 'click') && !!${fillValue} }",
					select: this._markDirty.bind(this) }),
				new CheckBox("fioriGuideEditorFollowUser", { wrapping: true, text: this.t("editor.followUser"), selected: "{followUser}",
					visible: "{= ${advance} === 'next' && !${fillValue} }",
					select: this._markDirty.bind(this) })
			]
		}).addStyleClass("fioriGuideEditorStepForm");

		this._oPage = new Page({
			customHeader: new Bar({
				contentLeft: [new Icon({ src: "sap-icon://learning-assistant" }), new Title({ text: this.t("editor.title"), level: "H3" })],
				contentRight: [
					new Button("fioriGuideEditorDock", { icon: "sap-icon://resize-horizontal", type: "Transparent", tooltip: this.t("editor.switchSide"), press: this._switchSide.bind(this) }),
					new Button({ icon: "sap-icon://decline", type: "Transparent", tooltip: this.t("editor.close"), press: this.close.bind(this) })
				]
			}),
			content: [
				new VBox({
					items: [
						new MessageStrip({
							text: { path: "/context/intent", formatter: function (sIntent) {
								return that.t("editor.contextInfo", [sIntent || ""]);
							} },
							type: "Information",
							showIcon: true
						}),
						new Label({ text: this.t("editor.tour") }),
						oTourSelect,
						new Label({ text: this.t("editor.tourTitle"), required: true }),
						new Input("fioriGuideEditorTourTitle", { value: "{/tour/title}", valueLiveUpdate: true, placeholder: this.t("editor.tourTitlePlaceholder"), liveChange: this._markDirty.bind(this) }),
						new CheckBox({ wrapping: true, text: this.t("editor.autoStart"), selected: "{/tour/autoStart}", select: this._markDirty.bind(this) }),
						new CheckBox({ wrapping: true, text: this.t("editor.onlyThisScreen"), selected: "{/tour/onlyThisScreen}", select: this._markDirty.bind(this) }),
						new Label({ text: this.t("editor.startPage"), wrapping: true, labelFor: "fioriGuideEditorStartPage" }),
						new HBox({
							alignItems: "Center",
							items: [
								new Input("fioriGuideEditorStartPage", { value: "{/tour/start}", valueLiveUpdate: true, placeholder: this.t("editor.startPagePlaceholder"),
									liveChange: this._markDirty.bind(this) }).setLayoutData(new FlexItemData({ growFactor: 1 })),
								new Button("fioriGuideEditorStartHere", { icon: "sap-icon://locate-me", tooltip: this.t("editor.useThisPage"), type: "Transparent",
									press: function () {
										oModel.setProperty("/tour/start", StartPage.suggestion());
										that._markDirty();
									} })
							]
						}),
						new Toolbar({
							style: "Clear",
							content: [
								new Title({ text: { path: "/tour/steps", formatter: function (a) {
									return that.t("editor.steps", [(a || []).length]);
								} }, level: "H4" }),
								new ToolbarSpacer()
							]
						}),
						new HBox({
							wrap: "Wrap",
							items: [
								new Button("fioriGuideEditorAddStep", { text: this.t("editor.addStep"), icon: "sap-icon://touch", type: "Emphasized", press: this._addStepByPicking.bind(this) }).addStyleClass("sapUiTinyMarginEnd"),
								new Button("fioriGuideEditorAddMessage", { text: this.t("editor.addMessage"), icon: "sap-icon://message-popup", press: this._addMessageStep.bind(this) }).addStyleClass("sapUiTinyMarginEnd"),
								new Button("fioriGuideEditorAddTcode", { text: this.t("editor.addTcode"), icon: "sap-icon://keyboard-and-mouse", press: this._addTcodeStep.bind(this) })
							]
						}),
						this._oStepList,
						this._oStepForm
					]
				}).addStyleClass("fioriGuideEditorContent")
			],
			footer: new OverflowToolbar({
				content: [
					new Button("fioriGuideEditorPreview", { text: this.t("editor.preview"), icon: "sap-icon://media-play", press: this._preview.bind(this) }),
					new ToolbarSpacer(),
					new Button("fioriGuideEditorSave", { text: this.t("editor.save"),
						type: { path: "/dbEnabled", formatter: function (b) {
							return b ? "Default" : "Emphasized";
						} },
						press: this._save.bind(this) }),
					new Button("fioriGuideEditorPublish", { text: this.t("editor.publish"), icon: "sap-icon://upload-to-cloud", type: "Emphasized",
						visible: "{/dbEnabled}", press: this._publish.bind(this) }),
					new Button("fioriGuideEditorExport", { text: this.t("editor.export"), icon: "sap-icon://download", press: this._openExport.bind(this) }),
					new Button({ text: this.t("editor.discardDraft"), icon: "sap-icon://undo", type: "Transparent",
						visible: { path: "/tour/id", formatter: function (sId) {
							return !!sId && !!DraftStore.get(sId);
						} },
						press: this._discardDraft.bind(this) }),
					new Button("fioriGuideEditorUnpublish", { text: this.t("editor.unpublish"), icon: "sap-icon://delete", type: "Transparent",
						visible: { parts: ["/dbEnabled", "/dbIds", "/tour/id"], formatter: function (bEnabled, aIds, sId) {
							return !!bEnabled && !!sId && (aIds || []).indexOf(sId) >= 0;
						} },
						press: this._unpublish.bind(this) })
				]
			})
		});
		this._oPage.setModel(oModel);
		this._oPage.addStyleClass("fioriGuideEditorPage");
		return this._oPage;
	};

	/* ---------------------------------------------------------------------- */
	/* Step actions                                                            */
	/* ---------------------------------------------------------------------- */

	TourEditor.prototype._markDirty = function () {
		this._oModel.setProperty("/dirty", true);
	};

	TourEditor.prototype._steps = function () {
		return this._oModel.getProperty("/tour/steps") || [];
	};

	TourEditor.prototype._showStep = function (iIndex) {
		this._oModel.setProperty("/selectedStep", iIndex);
		if (!this._oStepForm) {
			return;
		}
		if (iIndex < 0) {
			this._oStepForm.unbindElement();
			this._oStepList.removeSelections(true);
			return;
		}
		this._oStepForm.bindElement("/tour/steps/" + iIndex);
		var oItem = this._oStepList.getItems()[iIndex];
		if (oItem) {
			this._oStepList.setSelectedItem(oItem);
		}
	};

	TourEditor.prototype._switchSide = function () {
		this._oRoot.classList.toggle("fioriGuideEditorLeft");
	};

	/** The app a new step is added in. */
	TourEditor.prototype._pickContext = function () {
		var oContext = this._oPlugin.getContext() || this._oModel.getProperty("/context") || {};
		return { intent: oContext.intent, appId: oContext.appId || undefined };
	};

	/** Adds a new step and selects it. */
	TourEditor.prototype._appendStep = function (oStep) {
		var aSteps = this._steps().slice();
		aSteps.push(Object.assign({ pickContext: this._pickContext() }, oStep));
		this._oModel.setProperty("/tour/steps", aSteps);
		this._markDirty();
		this._refreshStepStates();
		this._showStep(aSteps.length - 1);
	};

	TourEditor.prototype._fromPick = function (oPick) {
		// the picked control is kept outside the model (not serializable) for "Larger area"
		this._mPicks = this._mPicks || {};
		var sPickId = "pick" + Date.now() + Math.random().toString(36).slice(2, 6);
		this._mPicks[sPickId] = oPick;
		return {
			pickId: sPickId,
			target: oPick.target,
			targetLabel: oPick.label,
			quality: oPick.quality
		};
	};

	TourEditor.prototype._pick = function () {
		var that = this;
		MessageToast.show(this.t("editor.pickHint"), { duration: 4000 });
		this._oRoot.classList.add("fioriGuideEditorPicking");
		return this._oPicker.pick().then(function (oPick) {
			that._oRoot.classList.remove("fioriGuideEditorPicking");
			return oPick;
		});
	};

	TourEditor.prototype._addStepByPicking = function () {
		var that = this;
		this._pick().then(function (oPick) {
			if (!oPick) {
				return;
			}
			that._appendStep(Object.assign({ title: "", text: "", position: "bottom", advance: "next", expectValue: "", tcode: false, fillValue: "", pressEnter: false, followUser: true }, that._fromPick(oPick)));
			that._focusStepTitle();
			if (oPick.quality === "fragile") {
				MessageToast.show(that.t("editor.fragileHint"), { duration: 6000 });
			}
		});
	};

	TourEditor.prototype._addMessageStep = function () {
		this._appendStep({ title: "", text: "", position: "bottom", advance: "next", expectValue: "", tcode: false, fillValue: "", pressEnter: false, followUser: true, target: null, targetLabel: this.t("editor.noTarget"), quality: "none" });
		this._focusStepTitle();
	};

	/**
	 * A "type the transaction code" step. Uses the SAP GUI command field when a SAP GUI
	 * screen is open; otherwise the author clicks the field (e.g. the Launchpad search).
	 */
	TourEditor.prototype._addTcodeStep = function () {
		var that = this;
		var oOkCode = TargetResolver.resolve({ webgui: "okcode" });
		var pPick;
		if (oOkCode) {
			pPick = Promise.resolve({ target: { webgui: "okcode" }, element: oOkCode, label: this.t("editor.okcodeLabel"), quality: "stable" });
		} else {
			MessageToast.show(this.t("editor.tcodePickHint"), { duration: 5000 });
			pPick = this._pick();
		}
		pPick.then(function (oPick) {
			if (!oPick) {
				return;
			}
			that._appendStep(Object.assign({
				title: that.t("editor.tcodeDefaultTitle"),
				text: that.t("editor.tcodeDefaultText"),
				position: "bottom-start",
				advance: "typeEnter",
				expectValue: "",
				tcode: true,
				fillValue: "",
				pressEnter: false
			}, that._fromPick(oPick)));
			setTimeout(function () {
				var oInput = sap.ui.getCore().byId("fioriGuideEditorExpectValue");
				if (oInput) {
					oInput.focus();
				}
			}, 150);
		});
	};

	TourEditor.prototype._focusStepTitle = function () {
		setTimeout(function () {
			var oInput = sap.ui.getCore().byId("fioriGuideEditorStepTitleInput");
			if (oInput) {
				oInput.focus();
			}
		}, 100);
	};

	TourEditor.prototype._repickTarget = function () {
		var that = this;
		var iIndex = this._oModel.getProperty("/selectedStep");
		this._pick().then(function (oPick) {
			if (!oPick) {
				return;
			}
			var sPath = "/tour/steps/" + iIndex;
			var oStep = Object.assign({}, that._oModel.getProperty(sPath), that._fromPick(oPick));
			that._oModel.setProperty(sPath, oStep);
			that._markDirty();
			that._showStep(iIndex);
		});
	};

	TourEditor.prototype._widenTarget = function () {
		var iIndex = this._oModel.getProperty("/selectedStep");
		var sPath = "/tour/steps/" + iIndex;
		var oStep = this._oModel.getProperty(sPath);
		var oPrevious = oStep && this._mPicks && this._mPicks[oStep.pickId];
		if (!oPrevious && oStep && oStep.target) {
			var oDom = TargetResolver.resolve(oStep.target);
			oPrevious = oDom && SelectorBuilder.build(oDom);
		}
		var oPick = oPrevious && SelectorBuilder.buildParent(oPrevious);
		if (!oPick) {
			MessageToast.show(this.t("editor.noLargerArea"));
			return;
		}
		this._oModel.setProperty(sPath, Object.assign({}, oStep, this._fromPick(oPick)));
		this._markDirty();
		this._showStep(iIndex);
		this._flashTarget();
	};

	TourEditor.prototype._flashTarget = function () {
		var oStep = this._oModel.getProperty("/tour/steps/" + this._oModel.getProperty("/selectedStep"));
		var oDom = oStep && oStep.target && TargetResolver.resolve(oStep.target);
		if (!oDom) {
			MessageToast.show(this.t("editor.targetMissing"));
			return;
		}
		oDom.scrollIntoView({ block: "center", behavior: "smooth" });
		oDom.classList.add("fioriGuideFlash");
		setTimeout(function () {
			oDom.classList.remove("fioriGuideFlash");
		}, 1600);
	};

	TourEditor.prototype._moveStep = function (iDelta) {
		var iIndex = this._oModel.getProperty("/selectedStep");
		var aSteps = this._steps().slice();
		var iNew = iIndex + iDelta;
		if (iIndex < 0 || iNew < 0 || iNew >= aSteps.length) {
			return;
		}
		var oStep = aSteps.splice(iIndex, 1)[0];
		aSteps.splice(iNew, 0, oStep);
		this._oModel.setProperty("/tour/steps", aSteps);
		this._refreshStepStates();
		this._markDirty();
		this._showStep(iNew);
	};

	TourEditor.prototype._deleteStep = function () {
		var iIndex = this._oModel.getProperty("/selectedStep");
		var aSteps = this._steps().slice();
		if (iIndex < 0) {
			return;
		}
		aSteps.splice(iIndex, 1);
		this._oModel.setProperty("/tour/steps", aSteps);
		this._refreshStepStates();
		this._markDirty();
		this._showStep(Math.min(iIndex, aSteps.length - 1));
	};

	/* ---------------------------------------------------------------------- */
	/* Tour actions                                                            */
	/* ---------------------------------------------------------------------- */

	function i18nValue(vOriginal, sValue) {
		if (vOriginal && typeof vOriginal === "object") {
			var oCopy = Object.assign({}, vOriginal);
			oCopy[Text.getLanguage().split(/[-_]/)[0].toLowerCase()] = sValue;
			return oCopy;
		}
		return sValue;
	}

	/** The tour in the format TourRegistry / TourRunner understand. */
	TourEditor.prototype._toDefinition = function () {
		var oTour = this._oModel.getProperty("/tour");
		var oContext = this._oModel.getProperty("/context");
		var oDef = {
			id: oTour.id || slug(oContext.intent + "-" + oTour.title) || "tour-" + Date.now(),
			title: i18nValue(oTour.titleI18n, oTour.title),
			intent: oTour.intent || oContext.intent,
			autoStart: !!oTour.autoStart,
			version: oTour.version || 1
		};
		if (oTour.appId) {
			oDef.appId = oTour.appId;
		}
		if (oTour.modal === false) {
			oDef.modal = false;
		}
		if (oTour.start && String(oTour.start).trim()) {
			oDef.start = String(oTour.start).trim();
		}
		if (oTour.listed === false) {
			oDef.listed = false;
		}
		if (oTour.onlyThisScreen) {
			oDef.innerHash = oTour.innerHash !== undefined ? oTour.innerHash : screenPattern(oContext.innerHash);
		}
		var oPrevApp = { intent: oDef.intent, appId: oDef.appId };
		oDef.steps = (oTour.steps || []).map(function (oStep, i) {
			var oOut = {
				id: oStep.id || "step-" + (i + 1),
				title: i18nValue(oStep.titleI18n, oStep.title || ""),
				text: i18nValue(oStep.textI18n, oStep.text || "")
			};
			// a step added in another app than the step before it belongs to that app
			if (oStep.app) {
				oOut.app = oStep.app;
				oPrevApp = AppMatch.normalize(oStep.app);
			} else if (oStep.pickContext && oStep.pickContext.intent && !AppMatch.matches(oPrevApp, oStep.pickContext, true)) {
				oOut.app = oStep.pickContext.intent;
				oPrevApp = { intent: oOut.app };
			}
			if (oStep.target) {
				oOut.target = oStep.target;
				oOut.position = oStep.position || "bottom";
				if (oStep.advance === "click") {
					oOut.advanceOn = "click";
				} else if (oStep.advance === "auto") {
					oOut.autoClick = true;
				} else if ((oStep.advance === "typeEnter" || oStep.advance === "type") && String(oStep.expectValue || "").trim()) {
					var aValues = String(oStep.expectValue).split(",").map(function (sValue) {
						return sValue.trim();
					}).filter(Boolean);
					oOut.expectValue = aValues.length === 1 ? aValues[0] : aValues;
					oOut.advanceOn = oStep.advance === "type" ? "input" : "enter";
					if (oStep.tcode) {
						oOut.tcode = true;
					}
				}
				// a value the guide types in for the user (not on "the user types" steps)
				if (oStep.advance !== "typeEnter" && oStep.advance !== "type" && String(oStep.fillValue || "") !== "") {
					oOut.fillValue = i18nValue(oStep.fillValueI18n, oStep.fillValue);
					if (oStep.pressEnter && oStep.advance !== "auto") {
						oOut.pressEnter = true;
					}
				}
			}
			// "follow the user" is on by default for Next steps; only the opt-out is stored
			if (oStep.followUser === false && (oStep.advance || "next") === "next" && !oOut.fillValue) {
				oOut.followUser = false;
			}
			["waitFor", "skipIfMissing", "canClickTarget", "classes", "showNext", "expectHint", "blockWrongValue", "actionDelay"].forEach(function (sKey) {
				if (oStep[sKey] !== undefined && oStep[sKey] !== null) {
					oOut[sKey] = oStep[sKey];
				}
			});
			return oOut;
		});
		return oDef;
	};

	TourEditor.prototype._validate = function () {
		var oTour = this._oModel.getProperty("/tour");
		if (!oTour.title || !oTour.title.trim()) {
			MessageToast.show(this.t("editor.needTitle"));
			var oInput = sap.ui.getCore().byId("fioriGuideEditorTourTitle");
			if (oInput) {
				oInput.setValueState("Error");
				oInput.focus();
			}
			return false;
		}
		sap.ui.getCore().byId("fioriGuideEditorTourTitle").setValueState("None");
		if (!(oTour.steps || []).length) {
			MessageToast.show(this.t("editor.needSteps"));
			return false;
		}
		var iMissing = (oTour.steps || []).findIndex(function (oStep) {
			return (oStep.advance === "typeEnter" || oStep.advance === "type") && !String(oStep.expectValue || "").trim();
		});
		if (iMissing >= 0) {
			this._showStep(iMissing);
			MessageToast.show(this.t("editor.needExpectValue", [iMissing + 1]));
			return false;
		}
		return true;
	};

	TourEditor.prototype._preview = function () {
		if (!(this._steps().length)) {
			MessageToast.show(this.t("editor.needSteps"));
			return;
		}
		var oDef = this._toDefinition();
		this._oPicker.stop();
		this._oPlugin.previewTour(oDef);
	};

	/** Saves the tour as a draft in this browser. Resolves with the saved definition. */
	TourEditor.prototype._save = function () {
		var that = this;
		if (!this._validate()) {
			return Promise.resolve(null);
		}
		var oDef = this._toDefinition();
		var sOldId = this._oModel.getProperty("/tour/id");
		var bChanged = !!sOldId && this._oModel.getProperty("/dirty");
		// make users who already finished the tour see the new version
		if (bChanged && !DraftStore.get(oDef.id)) {
			oDef.version = (Number(oDef.version) || 1) + 1;
		}
		DraftStore.save(oDef);
		this._oModel.setProperty("/tour/id", oDef.id);
		this._oModel.setProperty("/tour/version", oDef.version);
		this._oModel.setProperty("/dirty", false);
		return this._oPlugin.onDraftsChanged().then(function () {
			return that.refreshContext();
		}).then(function () {
			that._oModel.setProperty("/selectedTourKey", oDef.id);
			return that._loadTour(oDef.id);
		}).then(function () {
			MessageToast.show(that.t(that._oModel.getProperty("/dbEnabled") ? "editor.savedDb" : "editor.saved"));
			return oDef;
		});
	};

	/** Asks for the publishing key once and keeps it in this browser. */
	TourEditor.prototype._ensurePublishKey = function () {
		var that = this;
		var sKey = this._oPlugin.getPublishKey();
		if (sKey) {
			return Promise.resolve(sKey);
		}
		return new Promise(function (resolve, reject) {
			var oInput = new Input("fioriGuideEditorPublishKey", { type: "Password", width: "100%", placeholder: that.t("editor.publishKeyPlaceholder") });
			var bDone = false;
			var oDialog = new Dialog({
				title: that.t("editor.publishKeyTitle"),
				contentWidth: "24rem",
				content: [
					new VBox({
						items: [
							new MText({ text: that.t("editor.publishKeyInfo") }).addStyleClass("sapUiSmallMarginBottom"),
							oInput
						]
					}).addStyleClass("sapUiSmallMargin")
				],
				beginButton: new Button("fioriGuideEditorPublishKeyOk", { text: that.t("editor.publish"), type: "Emphasized", press: function () {
					var sValue = String(oInput.getValue() || "").trim();
					if (!sValue) {
						return;
					}
					bDone = true;
					that._oPlugin.setPublishKey(sValue);
					oDialog.close();
					resolve(sValue);
				} }),
				endButton: new Button({ text: that.t("editor.cancel"), press: function () {
					oDialog.close();
				} }),
				afterClose: function () {
					oDialog.destroy();
					if (!bDone) {
						reject(new Error("cancelled"));
					}
				}
			});
			oDialog.addStyleClass("sapUiSizeCompact");
			oDialog.open();
		});
	};

	TourEditor.prototype._showDatabaseError = function (oError) {
		if (oError && oError.status === 401) {
			this._oPlugin.setPublishKey("");
			MessageBox.error(this.t("editor.publishKeyWrong"));
			return;
		}
		MessageBox.error(this.t("editor.databaseFailed", [(oError && oError.message) || ""]));
	};

	/** Saves the tour in the tour database, so every user gets it right away. */
	TourEditor.prototype._publish = function () {
		var that = this;
		if (!this._validate()) {
			return Promise.resolve();
		}
		var sId = this._oModel.getProperty("/tour/id");
		var pDef = this._oModel.getProperty("/dirty") || !sId ? this._save() : Promise.resolve(this._toDefinition());
		var oDef;
		return pDef.then(function (oSaved) {
			if (!oSaved) {
				throw new Error("cancelled");
			}
			oDef = oSaved;
			return that._ensurePublishKey();
		}).then(function () {
			that._oPage.setBusy(true);
			return that._oPlugin.publishTour(oDef);
		}).then(function () {
			that._oPage.setBusy(false);
			return that.refreshContext();
		}).then(function () {
			that._oModel.setProperty("/selectedTourKey", oDef.id);
			return that._loadTour(oDef.id);
		}).then(function () {
			MessageToast.show(that.t("editor.published"));
		}).catch(function (oError) {
			that._oPage.setBusy(false);
			if (oError && oError.message === "cancelled") {
				return;
			}
			that._showDatabaseError(oError);
		});
	};

	TourEditor.prototype._unpublish = function () {
		var that = this;
		var sId = this._oModel.getProperty("/tour/id");
		MessageBox.confirm(this.t("editor.unpublishConfirm", [this._oModel.getProperty("/tour/title") || sId]), {
			onClose: function (sAction) {
				if (sAction !== MessageBox.Action.OK) {
					return;
				}
				that._ensurePublishKey().then(function () {
					that._oPage.setBusy(true);
					return that._oPlugin.unpublishTour(sId);
				}).then(function () {
					that._oPage.setBusy(false);
					that._oModel.setProperty("/dirty", false);
					that._oModel.setProperty("/tour", null);
					return that.refreshContext();
				}).then(function () {
					MessageToast.show(that.t("editor.unpublished"));
				}).catch(function (oError) {
					that._oPage.setBusy(false);
					if (oError && oError.message === "cancelled") {
						return;
					}
					that._showDatabaseError(oError);
				});
			}
		});
	};

	TourEditor.prototype._discardDraft = function () {
		var that = this;
		var sId = this._oModel.getProperty("/tour/id");
		DraftStore.remove(sId);
		this._oModel.setProperty("/dirty", false);
		this._oPlugin.onDraftsChanged().then(function () {
			return that.refreshContext();
		}).then(function () {
			MessageToast.show(that.t("editor.discarded"));
		});
	};

	TourEditor.prototype._openExport = function () {
		var that = this;
		if (this._oModel.getProperty("/dirty") && this._oModel.getProperty("/tour/title")) {
			this._save();
		}
		this._oPlugin.buildExportCatalog().then(function (oCatalog) {
			var sJson = JSON.stringify(oCatalog, null, 2);
			var iDrafts = DraftStore.list().length;
			var oDialog = new Dialog({
				title: that.t("editor.exportTitle"),
				contentWidth: "40rem",
				resizable: true,
				draggable: true,
				content: [
					new VBox({
						items: [
							new MessageStrip({ text: that.t("editor.exportInfo", [iDrafts]), type: "Information", showIcon: true }).addStyleClass("sapUiSmallMarginBottom"),
							// setValue, not the constructor: the JSON's braces would be read as a binding
							new TextArea({ width: "100%", rows: 18, editable: false }).setValue(sJson).addStyleClass("fioriGuideEditorJson")
						]
					}).addStyleClass("sapUiSmallMargin")
				],
				buttons: [
					new Button({ text: that.t("editor.download"), type: "Emphasized", icon: "sap-icon://download", press: function () {
						var oBlob = new Blob([sJson], { type: "application/json" });
						var oLink = document.createElement("a");
						oLink.href = URL.createObjectURL(oBlob);
						oLink.download = "index.json";
						document.body.appendChild(oLink);
						oLink.click();
						setTimeout(function () {
							URL.revokeObjectURL(oLink.href);
							oLink.remove();
						}, 0);
					} }),
					new Button({ text: that.t("editor.copy"), icon: "sap-icon://copy", press: function () {
						navigator.clipboard.writeText(sJson).then(function () {
							MessageToast.show(that.t("editor.copied"));
						});
					} }),
					new Button({ text: that.t("editor.close"), press: function () {
						oDialog.close();
					} })
				],
				afterClose: function () {
					oDialog.destroy();
				}
			});
			oDialog.addStyleClass("sapUiSizeCompact");
			oDialog.open();
		});
	};

	TourEditor._slug = slug;
	TourEditor._screenPattern = screenPattern;
	return TourEditor;
});
