/**
 * Loads ShepherdJS and its styles lazily, the first time a tour is started, so the
 * plugin adds almost nothing to Launchpad start-up time.
 */
sap.ui.define(["sap/ui/dom/includeStylesheet"], function (includeStylesheet) {
	"use strict";

	var pShepherd = null;

	function css(sPath, sId) {
		return new Promise(function (resolve) {
			// a missing stylesheet must not block the tour
			includeStylesheet(sap.ui.require.toUrl(sPath), sId, resolve, resolve);
		});
	}

	return {
		load: function () {
			if (!pShepherd) {
				pShepherd = Promise.all([
					new Promise(function (resolve, reject) {
						if (window.Shepherd) {
							resolve(window.Shepherd);
							return;
						}
						sap.ui.require(["fiori/shepherd/guide/lib/thirdparty/shepherd"], function () {
							resolve(window.Shepherd);
						}, reject);
					}),
					css("fiori/shepherd/guide/lib/thirdparty/shepherd.css", "fioriShepherdGuideBaseCss"),
					css("fiori/shepherd/guide/css/guide.css", "fioriShepherdGuideCss")
				]).then(function (aResults) {
					if (!aResults[0]) {
						throw new Error("ShepherdJS did not load");
					}
					return aResults[0];
				}, function (oError) {
					pShepherd = null;
					throw oError;
				});
			}
			return pShepherd;
		}
	};
});
