/**
 * "Click an element" mode: outlines the UI5 control under the mouse and reports the
 * one the user clicks, without letting the click reach the app. Esc cancels.
 * Also works inside embedded pages of the same server (e.g. SAP GUI for HTML).
 */
sap.ui.define(["./SelectorBuilder", "../TargetResolver", "../FrameProxy"], function (SelectorBuilder, TargetResolver, FrameProxy) {
	"use strict";

	function ElementPicker(mOptions) {
		this._oIgnoreRoot = mOptions.ignoreRoot; // the editor panel itself
		this._fnLabel = mOptions.label || function (s) { return s; };
		this._oHighlight = null;
		this._oTip = null;
		this._oCurrent = null;
		this._mHandlers = null;
	}

	ElementPicker.prototype.isActive = function () {
		return !!this._mHandlers;
	};

	/**
	 * @returns {Promise<object|null>} SelectorBuilder result, or null when cancelled
	 */
	ElementPicker.prototype.pick = function () {
		var that = this;
		this.stop();
		return new Promise(function (resolve) {
			that._fnResolve = resolve;
			that._oHighlight = document.createElement("div");
			that._oHighlight.className = "fioriGuidePickHighlight";
			that._oTip = document.createElement("div");
			that._oTip.className = "fioriGuidePickTip";
			document.body.appendChild(that._oHighlight);
			document.body.appendChild(that._oTip);
			document.body.classList.add("fioriGuidePicking");

			var fnBlock = function (oEvent) {
				if (that._isInEditor(oEvent.target)) {
					return;
				}
				oEvent.preventDefault();
				oEvent.stopPropagation();
				oEvent.stopImmediatePropagation();
			};
			that._mHandlers = {
				mousemove: function (oEvent) {
					that._onMove(oEvent);
				},
				click: function (oEvent) {
					if (that._isInEditor(oEvent.target)) {
						return;
					}
					fnBlock(oEvent);
					var oResult = that._oCurrent;
					that._finish(oResult);
				},
				mousedown: fnBlock,
				mouseup: fnBlock,
				pointerdown: fnBlock,
				pointerup: fnBlock,
				touchstart: fnBlock,
				keydown: function (oEvent) {
					if (oEvent.key === "Escape") {
						fnBlock(oEvent);
						that._finish(null);
					}
				}
			};
			// the Launchpad window plus every same-origin embedded page (SAP GUI for HTML etc.)
			that._aWindows = [window].concat(TargetResolver.frameDocuments(true).map(function (oDoc) {
				return oDoc.defaultView;
			}).filter(Boolean));
			that._aWindows.forEach(function (oWin) {
				Object.keys(that._mHandlers).forEach(function (sEvent) {
					oWin.addEventListener(sEvent, that._mHandlers[sEvent], true);
				});
			});
		});
	};

	ElementPicker.prototype.stop = function () {
		if (this._mHandlers) {
			this._finish(null);
		}
	};

	ElementPicker.prototype._finish = function (oResult) {
		var that = this;
		if (this._mHandlers) {
			(this._aWindows || [window]).forEach(function (oWin) {
				Object.keys(that._mHandlers).forEach(function (sEvent) {
					try {
						oWin.removeEventListener(sEvent, that._mHandlers[sEvent], true);
					} catch (e) {
						// the embedded page was closed meanwhile
					}
				});
			});
			this._mHandlers = null;
			this._aWindows = null;
		}
		[this._oHighlight, this._oTip].forEach(function (oNode) {
			if (oNode && oNode.parentNode) {
				oNode.parentNode.removeChild(oNode);
			}
		});
		document.body.classList.remove("fioriGuidePicking");
		this._oCurrent = null;
		if (this._fnResolve) {
			var fnResolve = this._fnResolve;
			this._fnResolve = null;
			fnResolve(oResult);
		}
	};

	ElementPicker.prototype._isInEditor = function (oNode) {
		if (!this._oIgnoreRoot || !oNode) {
			return false;
		}
		if (this._oIgnoreRoot.contains(oNode)) {
			return true;
		}
		// popups opened from the editor (Select lists etc.) live in the static UI area
		return !!(oNode.closest && oNode.closest(".fioriGuideEditorPopup"));
	};

	ElementPicker.prototype._onMove = function (oEvent) {
		var oDoc = (oEvent.view && oEvent.view.document) || document;
		var oNode = oDoc.elementFromPoint(oEvent.clientX, oEvent.clientY);
		if (!oNode || this._isInEditor(oNode) || oNode === this._oHighlight || oNode === this._oTip) {
			return;
		}
		var oResult = SelectorBuilder.build(oNode);
		this._oCurrent = oResult;
		if (!oResult) {
			this._oHighlight.style.display = "none";
			this._oTip.style.display = "none";
			return;
		}
		var oRect = FrameProxy.rectInTopWindow(oResult.element);
		oRect.right = oRect.left + oRect.width;
		oRect.bottom = oRect.top + oRect.height;
		var oStyle = this._oHighlight.style;
		oStyle.display = "block";
		oStyle.left = oRect.left - 3 + "px";
		oStyle.top = oRect.top - 3 + "px";
		oStyle.width = oRect.width + 6 + "px";
		oStyle.height = oRect.height + 6 + "px";
		this._oHighlight.setAttribute("data-quality", oResult.quality);

		this._oTip.style.display = "block";
		this._oTip.textContent = oResult.label + " · " + this._fnLabel(oResult.quality);
		this._oTip.style.left = Math.max(4, oRect.left) + "px";
		this._oTip.style.top = (oRect.top > 30 ? oRect.top - 28 : oRect.bottom + 6) + "px";
	};

	return ElementPicker;
});
