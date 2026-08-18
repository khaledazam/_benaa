import React from "react";
import { ReconciliationView } from "@/components/inventory/ReconciliationView";

export const metadata = {
  title: "Inventory Reconciliation | BuildStock",
  description: "Read-only inventory master audit and discrepancy detection",
};

export default function InventoryReconciliationPage() {
  return <ReconciliationView />;
}
