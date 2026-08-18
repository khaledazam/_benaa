import React from "react";
import SalesOrderFormView from "@/components/sales/SalesOrderFormView";

export const metadata = {
  title: "New Sales Order | BuildStock WMS",
  description: "Create DRAFT Sales Order for Construction & Decoration Materials",
};

export default function NewSalesOrderPage() {
  return <SalesOrderFormView />;
}
