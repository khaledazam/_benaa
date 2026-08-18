import React from "react";
import CustomerDetailView from "@/components/customers/CustomerDetailView";

export const metadata = {
  title: "Customer Details | BuildStock WMS",
  description: "Customer Profile and Sales Order History in BuildStock WMS",
};

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CustomerDetailView customerId={id} />;
}
