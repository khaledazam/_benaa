"use client";

import React, { useState, useEffect } from "react";

export function InventoryReportsView() {
  const [reportType, setReportType] = useState<"variance" | "history" | "damage">("variance");
  const [reportData, setReportData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReport = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/inventory/reports/variance?type=${reportType}`);
      if (!res.ok) throw new Error("Failed to fetch report");
      const data = await res.json();
      setReportData(data);
    } catch (err: any) {
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
  }, [reportType]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Inventory Control Reports</h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm">
          Read-only audit reports for physical stock adjustments, count variances, and loss analysis
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-700 space-x-4">
        <button
          onClick={() => setReportType("variance")}
          className={`py-2 px-4 border-b-2 font-medium text-sm transition-colors ${
            reportType === "variance"
              ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          Inventory Variance & Accuracy
        </button>
        <button
          onClick={() => setReportType("history")}
          className={`py-2 px-4 border-b-2 font-medium text-sm transition-colors ${
            reportType === "history"
              ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          Adjustment History Audit
        </button>
        <button
          onClick={() => setReportType("damage")}
          className={`py-2 px-4 border-b-2 font-medium text-sm transition-colors ${
            reportType === "damage"
              ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          Damage & Loss Analysis
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400 rounded-xl text-sm">
          {error}
        </div>
      )}

      {/* KPI Cards */}
      {reportData?.summary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          {reportType === "variance" && (
            <>
              <div className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                <span className="text-xs font-semibold text-slate-400 uppercase">Counts Evaluated</span>
                <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">
                  {reportData.summary.totalCountsEvaluated}
                </div>
              </div>
              <div className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                <span className="text-xs font-semibold text-slate-400 uppercase">Accuracy Rate</span>
                <div className="mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                  {reportData.summary.accuracyPercentage}%
                </div>
              </div>
              <div className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                <span className="text-xs font-semibold text-slate-400 uppercase">Total Items Counted</span>
                <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">
                  {reportData.summary.totalItemsCounted}
                </div>
              </div>
              <div className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                <span className="text-xs font-semibold text-slate-400 uppercase">Total Discrepancy Units</span>
                <div className="mt-1 text-2xl font-bold text-amber-600 dark:text-amber-400">
                  {reportData.summary.totalVarianceUnits}
                </div>
              </div>
            </>
          )}

          {reportType === "history" && (
            <>
              <div className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                <span className="text-xs font-semibold text-slate-400 uppercase">Posted Adjustments</span>
                <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">
                  {reportData.summary.totalPostedAdjustments}
                </div>
              </div>
              <div className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                <span className="text-xs font-semibold text-slate-400 uppercase">Positive Stock Delta (+)</span>
                <div className="mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                  +{reportData.summary.totalPositiveDelta}
                </div>
              </div>
              <div className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                <span className="text-xs font-semibold text-slate-400 uppercase">Negative Stock Delta (-)</span>
                <div className="mt-1 text-2xl font-bold text-red-600 dark:text-red-400">
                  -{reportData.summary.totalNegativeDelta}
                </div>
              </div>
              <div className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                <span className="text-xs font-semibold text-slate-400 uppercase">Net Stock Delta</span>
                <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">
                  {reportData.summary.netDelta}
                </div>
              </div>
            </>
          )}

          {reportType === "damage" && (
            <>
              <div className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                <span className="text-xs font-semibold text-slate-400 uppercase">Total Lost Units</span>
                <div className="mt-1 text-2xl font-bold text-red-600 dark:text-red-400">
                  {reportData.summary.totalLostUnits}
                </div>
              </div>
              <div className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                <span className="text-xs font-semibold text-slate-400 uppercase">Damaged Goods</span>
                <div className="mt-1 text-2xl font-bold text-amber-600 dark:text-amber-400">
                  {reportData.summary.damageQuantity}
                </div>
              </div>
              <div className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                <span className="text-xs font-semibold text-slate-400 uppercase">Unexplained Loss</span>
                <div className="mt-1 text-2xl font-bold text-red-600 dark:text-red-400">
                  {reportData.summary.lossQuantity}
                </div>
              </div>
              <div className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                <span className="text-xs font-semibold text-slate-400 uppercase">Expired Stock</span>
                <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">
                  {reportData.summary.expiryQuantity}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Table Data */}
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-700 font-bold text-slate-900 dark:text-white">
          Report Log Details
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-700 dark:text-slate-200 font-semibold border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="p-4">Reference Number</th>
                <th className="p-4">Warehouse</th>
                <th className="p-4">Type / Scope</th>
                <th className="p-4">Reason / Notes</th>
                <th className="p-4">Status</th>
                <th className="p-4">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-400">
                    Loading report details...
                  </td>
                </tr>
              ) : !reportData?.data || reportData.data.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-400">
                    No report data found.
                  </td>
                </tr>
              ) : (
                reportData.data.map((row: any) => (
                  <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                    <td className="p-4 font-mono font-medium text-slate-900 dark:text-white">
                      {row.adjustmentNumber || row.countNumber}
                    </td>
                    <td className="p-4">{row.warehouseName || row.warehouse?.name}</td>
                    <td className="p-4">{row.adjustmentType || row.scopeType}</td>
                    <td className="p-4 font-medium text-slate-900 dark:text-white">{row.reason || row.notes || "—"}</td>
                    <td className="p-4">
                      <span className="px-2 py-1 bg-slate-100 dark:bg-slate-700 text-xs font-semibold rounded-md">
                        {row.status}
                      </span>
                    </td>
                    <td className="p-4 text-xs">
                      {new Date(row.postedAt || row.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
