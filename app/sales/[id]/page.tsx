import React from "react";
import SalesOrderDetailView from "@/components/sales/SalesOrderDetailView";

export const metadata = {
  title: "Sales Order Details | BuildStock WMS",
  description: "Sales Order details, line items, and status transitions in BuildStock WMS",
};

export default async function SalesOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SalesOrderDetailView salesOrderId={id} />;
}
