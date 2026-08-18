import { Suspense } from "react";
import { DispatchesView } from "@/components/dispatch/DispatchesView";

export const metadata = {
  title: "Dispatches & Physical Stock Deduction | BuildStock WMS",
  description: "Manage physical dispatch records and inventory deductions",
};

export default function DispatchesPage() {
  return (
    <Suspense fallback={<div className="p-8 text-slate-500">Loading Dispatches...</div>}>
      <DispatchesView />
    </Suspense>
  );
}
