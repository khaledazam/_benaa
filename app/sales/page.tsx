import React from "react";
import SalesOrdersView from "@/components/sales/SalesOrdersView";

export const metadata = {
  title: "Sales Orders | BuildStock WMS",
  description: "Sales Order Management for BuildStock Construction & Decoration Warehouse System",
};

export default function SalesOrdersPage() {
  return <SalesOrdersView />;
}
