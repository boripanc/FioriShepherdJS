sap.ui.define(["sap/ui/core/mvc/Controller", "sap/ui/model/Filter", "sap/ui/model/FilterOperator"], function (Controller, Filter, FilterOperator) {
	"use strict";
	return Controller.extend("fiori.shepherd.guide.demo.view.Main", {
		onSearch: function (oEvent) {
			var sQuery = oEvent.getParameter("query");
			this.byId("ordersTable").getBinding("items").filter(sQuery ? new Filter({
				filters: [new Filter("customer", FilterOperator.Contains, sQuery), new Filter("id", FilterOperator.Contains, sQuery)],
				and: false
			}) : []);
		},
		onFilter: function (oEvent) {
			var sKey = oEvent.getParameter("item").getKey();
			this.byId("ordersTable").getBinding("items").filter(sKey ? new Filter("status", FilterOperator.EQ, sKey) : []);
		},
		onCreate: function () {
			this.byId("createDialog").open();
		},
		onCloseDialog: function () {
			this.byId("createDialog").close();
		}
	});
});
