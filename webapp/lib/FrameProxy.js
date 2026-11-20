/**
 * Shepherd draws its popup and the dimmed overlay in the Launchpad page, so it cannot
 * point at an element that lives inside an embedded page (iframe), such as a SAP GUI for
 * HTML screen. A proxy is an invisible box in the Launchpad page that sits exactly over
 * that element; the step attaches to the proxy instead. Clicks go through to the real field.
 */
sap.ui.define(["./TargetResolver"], function (TargetResolver) {
	"use strict";

	/** Position of oDom relative to the Launchpad window, across nested iframes. */
	function rectInTopWindow(oDom) {
		var oRect = oDom.getBoundingClientRect();
		var iLeft = oRect.left;
		var iTop = oRect.top;
		for (var oFrame = TargetResolver.frameElementOf(oDom); oFrame; oFrame = TargetResolver.frameElementOf(oFrame)) {
			var oFrameRect = oFrame.getBoundingClientRect();
			iLeft += oFrameRect.left + oFrame.clientLeft;
			iTop += oFrameRect.top + oFrame.clientTop;
		}
		return { left: iLeft, top: iTop, width: oRect.width, height: oRect.height };
	}

	function FrameProxy(oTarget) {
		this._oTarget = oTarget;
		this._oProxy = document.createElement("div");
		this._oProxy.className = "fioriGuideFrameProxy";
		document.body.appendChild(this._oProxy);
		this._sLast = "";
		this._iFrame = 0;
		this._place();
		this._loop();
	}

	FrameProxy.rectInTopWindow = rectInTopWindow;

	FrameProxy.isInFrame = function (oDom) {
		return !!oDom && oDom.ownerDocument !== document;
	};

	FrameProxy.prototype.getElement = function () {
		return this._oProxy;
	};

	FrameProxy.prototype._place = function () {
		if (!this._oTarget.isConnected) {
			return;
		}
		var oRect = rectInTopWindow(this._oTarget);
		var sKey = [oRect.left, oRect.top, oRect.width, oRect.height].join();
		if (sKey === this._sLast) {
			return;
		}
		var bMoved = !!this._sLast;
		this._sLast = sKey;
		var oStyle = this._oProxy.style;
		oStyle.left = oRect.left + "px";
		oStyle.top = oRect.top + "px";
		oStyle.width = oRect.width + "px";
		oStyle.height = oRect.height + "px";
		if (bMoved) {
			// lets Shepherd re-position the popup and the overlay cut-out
			window.dispatchEvent(new Event("resize"));
		}
	};

	FrameProxy.prototype._loop = function () {
		var that = this;
		this._iFrame = window.requestAnimationFrame(function () {
			that._place();
			that._loop();
		});
	};

	FrameProxy.prototype.destroy = function () {
		window.cancelAnimationFrame(this._iFrame);
		if (this._oProxy.parentNode) {
			this._oProxy.parentNode.removeChild(this._oProxy);
		}
	};

	return FrameProxy;
});
