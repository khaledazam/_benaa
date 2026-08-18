"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";

export function CountDetailView({ countId }: { countId: string }) {
  const [count, setCount] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [countInputs, setCountInputs] = useState<Record<string, number>>({});

  const fetchCount = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/inventory/counts/${countId}`);
      if (!res.ok) throw new Error("Failed to fetch count details");
      const data = await res.json();
      setCount(data);

      const inputs: Record<string, number> = {};
      data.items?.forEach((item: any) => {
        if (item.countedQuantity !== null) {
          inputs[item.id] = item.countedQuantity;
        }
      });
      setCountInputs(inputs);
    } catch (err: any) {
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCount();
  }, [countId]);

  const handleInputChange = (itemId: string, value: string) => {
    setCountInputs({
      ...countInputs,
      [itemId]: parseFloat(value) || 0,
    });
  };

  const handleSaveCounts = async () => {
    setActionLoading(true);
    setError(null);
    try {
      const itemsToRecord = count.items.map((item: any) => ({
        productId: item.productId,
        binId: item.binId || undefined,
        countedQuantity: countInputs[item.id] ?? 0,
      }));

      const res = await fetch(`/api/inventory/counts/${countId}/record`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: itemsToRecord }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to record count items");
      }

      await fetchCount();
    } catch (err: any) {
      setError(err.message || "Action failed");
    } finally {
      setActionLoading(false);
    }
  };

  const handleAction = async (endpoint: string) => {
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/inventory/counts/${countId}/${endpoint}`, {
        method: "POST",
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || `Failed to execute ${endpoint}`);
      }

      await fetchCount();
    } catch (err: any) {
      setError(err.message || "Action failed");
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-400">Loading inventory count details...</div>;
  }

  if (!count) {
    return <div className="p-8 text-center text-slate-400">Inventory count not found.</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <Link href="/inventory/counting" className="text-sm text-indigo-600 hover:text-indigo-800">
              ← Back to Inventory Counts
            </Link>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
            Count Sheet {count.countNumber}
          </h1>
          <p className="text-slate-500 text-sm">
            Scope: {count.scopeName || count.scopeType} • Warehouse: {count.warehouseName || count.warehouse?.name}
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {count.status === "DRAFT" && (
            <button
              onClick={() => handleAction("start")}
              disabled={actionLoading}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium text-sm transition-colors shadow-sm disabled:opacity-50"
            >
              Start Counting (Freeze Snapshots)
            </button>
          )}

          {count.status === "IN_PROGRESS" && (
            <>
              <button
                onClick={handleSaveCounts}
                disabled={actionLoading}
                className="px-4 py-2 bg-slate-800 dark:bg-slate-700 text-white hover:bg-slate-900 rounded-lg font-medium text-sm transition-colors shadow-sm disabled:opacity-50"
              >
                Save Recorded Counts
              </button>
              <button
                onClick={() => handleAction("submit")}
                disabled={actionLoading}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium text-sm transition-colors shadow-sm disabled:opacity-50"
              >
                Submit Count Sheet
              </button>
            </>
          )}

          {count.status === "SUBMITTED" && (
            <button
              onClick={() => handleAction("approve")}
              disabled={actionLoading}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium text-sm transition-colors shadow-sm disabled:opacity-50"
            >
              Approve Count Sheet
            </button>
          )}

          {count.status === "APPROVED" && (
            <button
              onClick={() => handleAction("post")}
              disabled={actionLoading}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium text-sm transition-colors shadow-sm disabled:opacity-50"
            >
              Post Variance Adjustment
            </button>
          )}

          {count.status === "POSTED" && (
            <button
              onClick={() => handleAction("close")}
              disabled={actionLoading}
              className="px-4 py-2 bg-slate-600 hover:bg-slate-700 text-white rounded-lg font-medium text-sm transition-colors shadow-sm disabled:opacity-50"
            >
              Close Count Session
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400 rounded-xl text-sm">
          {error}
        </div>
      )}

      {/* KPI Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
          <span className="text-xs font-semibold text-slate-400 uppercase">Status</span>
          <div className="mt-1">
            <span
              className={`px-3 py-1 text-sm font-semibold rounded-full ${
                count.status === "POSTED" || count.status === "CLOSED"
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
                  : count.status === "APPROVED"
                  ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
                  : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
              }`}
            >
              {count.status}
            </span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
          <span className="text-xs font-semibold text-slate-400 uppercase">Items Counted</span>
          <div className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
            {count.items?.filter((i: any) => i.countedQuantity !== null).length || 0} / {count.items?.length || 0}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
          <span className="text-xs font-semibold text-slate-400 uppercase">Total Variance</span>
          <div className="mt-1 text-lg font-bold text-amber-600 dark:text-amber-400">
            {count.items?.reduce((sum: number, i: any) => sum + Math.abs(i.varianceQuantity || 0), 0) || 0} units
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
          <span className="text-xs font-semibold text-slate-400 uppercase">Linked Adjustment</span>
          <div className="mt-1 text-sm font-medium text-slate-900 dark:text-white">
            {count.adjustmentId ? (
              <Link href={`/inventory/adjustments/${count.adjustmentId}`} className="text-indigo-600 hover:underline">
                View Adjustment
              </Link>
            ) : (
              "None"
            )}
          </div>
        </div>
      </div>

      {/* Grid of Count Sheet Items */}
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-700">
          <h3 className="font-bold text-slate-900 dark:text-white">Physical Count Lines</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-700 dark:text-slate-200 font-semibold border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="p-4">Product</th>
                <th className="p-4">Bin Location</th>
                <th className="p-4 text-right">System Qty Snapshot</th>
                <th className="p-4 text-right">Physical Counted Qty</th>
                <th className="p-4 text-right">Variance Qty</th>
                <th className="p-4 text-right">Variance %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {count.items?.map((item: any) => (
                <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                  <td className="p-4 font-medium text-slate-900 dark:text-white">
                    {item.productName} ({item.productSku || item.product?.sku})
                  </td>
                  <td className="p-4">{item.locationPath || (item.bin ? item.bin.code : "Unassigned")}</td>
                  <td className="p-4 text-right font-mono font-semibold">{item.systemQuantity}</td>
                  <td className="p-4 text-right">
                    {count.status === "IN_PROGRESS" ? (
                      <input
                        type="number"
                        step="any"
                        value={countInputs[item.id] ?? item.countedQuantity ?? ""}
                        onChange={(e) => handleInputChange(item.id, e.target.value)}
                        className="w-24 px-2 py-1 border rounded text-right bg-white dark:bg-slate-900 font-mono"
                      />
                    ) : (
                      <span className="font-mono font-bold text-slate-900 dark:text-white">
                        {item.countedQuantity !== null ? item.countedQuantity : "—"}
                      </span>
                    )}
                  </td>
                  <td
                    className={`p-4 text-right font-mono font-bold ${
                      (item.varianceQuantity || 0) < 0
                        ? "text-red-600 dark:text-red-400"
                        : (item.varianceQuantity || 0) > 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-slate-600 dark:text-slate-400"
                    }`}
                  >
                    {item.varianceQuantity !== null ? (item.varianceQuantity > 0 ? `+${item.varianceQuantity}` : item.varianceQuantity) : "—"}
                  </td>
                  <td className="p-4 text-right font-mono text-xs">
                    {item.variancePercentage !== null ? `${item.variancePercentage}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
