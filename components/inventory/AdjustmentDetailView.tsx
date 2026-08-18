"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export function AdjustmentDetailView({ adjustmentId }: { adjustmentId: string }) {
  const router = useRouter();
  const [adjustment, setAdjustment] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchAdjustment = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/inventory/adjustments/${adjustmentId}`);
      if (!res.ok) throw new Error("Failed to fetch stock adjustment details");
      const data = await res.json();
      setAdjustment(data);
    } catch (err: any) {
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAdjustment();
  }, [adjustmentId]);

  const handleAction = async (endpoint: string, payload?: any) => {
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/inventory/adjustments/${adjustmentId}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload ? JSON.stringify(payload) : undefined,
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || `Failed to execute ${endpoint}`);
      }

      await fetchAdjustment();
    } catch (err: any) {
      setError(err.message || "Action failed");
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-400">Loading stock adjustment details...</div>;
  }

  if (!adjustment) {
    return <div className="p-8 text-center text-slate-400">Stock adjustment not found.</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <Link href="/inventory/adjustments" className="text-sm text-indigo-600 hover:text-indigo-800">
              ← Back to Stock Adjustments
            </Link>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
            Adjustment {adjustment.adjustmentNumber}
          </h1>
          <p className="text-slate-500 text-sm">{adjustment.reason}</p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {adjustment.status === "DRAFT" && (
            <button
              onClick={() => handleAction("submit")}
              disabled={actionLoading}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium text-sm transition-colors shadow-sm disabled:opacity-50"
            >
              Submit for Approval
            </button>
          )}

          {adjustment.status === "PENDING_APPROVAL" && (
            <>
              <button
                onClick={() => handleAction("approve")}
                disabled={actionLoading}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium text-sm transition-colors shadow-sm disabled:opacity-50"
              >
                Approve Adjustment
              </button>
              <button
                onClick={() => {
                  const reason = prompt("Enter rejection reason:");
                  if (reason) handleAction("approve", { action: "reject", reason });
                }}
                disabled={actionLoading}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium text-sm transition-colors shadow-sm disabled:opacity-50"
              >
                Reject
              </button>
            </>
          )}

          {adjustment.status === "APPROVED" && (
            <button
              onClick={() => handleAction("post")}
              disabled={actionLoading}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium text-sm transition-colors shadow-sm disabled:opacity-50"
            >
              Post Adjustment (Mutate Stock)
            </button>
          )}

          {adjustment.status !== "POSTED" && adjustment.status !== "CANCELLED" && (
            <button
              onClick={() => {
                const reason = prompt("Enter cancellation reason:");
                if (reason) handleAction("cancel", { reason });
              }}
              disabled={actionLoading}
              className="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-300 rounded-lg font-medium text-sm transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400 rounded-xl text-sm">
          {error}
        </div>
      )}

      {/* Overview Metadata Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
          <span className="text-xs font-semibold text-slate-400 uppercase">Status</span>
          <div className="mt-1">
            <span
              className={`px-3 py-1 text-sm font-semibold rounded-full ${
                adjustment.status === "POSTED"
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
                  : adjustment.status === "APPROVED"
                  ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
                  : adjustment.status === "PENDING_APPROVAL"
                  ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                  : "bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-300"
              }`}
            >
              {adjustment.status}
            </span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
          <span className="text-xs font-semibold text-slate-400 uppercase">Type</span>
          <div className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
            {adjustment.adjustmentType}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
          <span className="text-xs font-semibold text-slate-400 uppercase">Warehouse</span>
          <div className="mt-1 text-base font-semibold text-slate-900 dark:text-white">
            {adjustment.warehouseName || adjustment.warehouse?.name}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
          <span className="text-xs font-semibold text-slate-400 uppercase">Created By</span>
          <div className="mt-1 text-base font-semibold text-slate-900 dark:text-white">
            {adjustment.createdByName || "User"}
          </div>
        </div>
      </div>

      {/* Items Table */}
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-700">
          <h3 className="font-bold text-slate-900 dark:text-white">Adjustment Line Items</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-700 dark:text-slate-200 font-semibold border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="p-4">Product</th>
                <th className="p-4">Bin Location</th>
                <th className="p-4 text-right">System Qty</th>
                <th className="p-4 text-right">Adjustment Delta</th>
                <th className="p-4 text-right">Resulting Qty</th>
                <th className="p-4">Line Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {adjustment.items?.map((item: any) => (
                <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                  <td className="p-4 font-medium text-slate-900 dark:text-white">
                    {item.productName} ({item.productSku || item.product?.sku})
                  </td>
                  <td className="p-4">{item.locationPath || (item.bin ? item.bin.code : "Unassigned")}</td>
                  <td className="p-4 text-right">{item.systemQuantity}</td>
                  <td
                    className={`p-4 text-right font-bold ${
                      item.adjustmentQuantity > 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {item.adjustmentQuantity > 0 ? `+${item.adjustmentQuantity}` : item.adjustmentQuantity}
                  </td>
                  <td className="p-4 text-right font-semibold">{item.resultingQuantity}</td>
                  <td className="p-4 text-xs text-slate-500">{item.reason || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
