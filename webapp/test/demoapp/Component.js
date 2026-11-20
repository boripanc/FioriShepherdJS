sap.ui.define(["sap/ui/core/UIComponent", "sap/ui/model/json/JSONModel"], function (UIComponent, JSONModel) {
	"use strict";
	return UIComponent.extend("fiori.shepherd.guide.demo.Component", {
		metadata: { manifest: "json" },
		init: function () {
			UIComponent.prototype.init.apply(this, arguments);
			this.setModel(new JSONModel({
				orders: [
					{ id: "4711", customer: "Domestic US Customer 1", amount: 1250.5, currency: "USD", status: "Open" },
					{ id: "4712", customer: "Inlandskunde DE 2", amount: 89.9, currency: "EUR", status: "In Process" },
					{ id: "4713", customer: "Siam Trading Co.", amount: 34000, currency: "THB", status: "Completed" },
					{ id: "4714", customer: "Domestic US Customer 3", amount: 640, currency: "USD", status: "Open" }
				]
			}));
		}
	});
});
