"use client";

import React, { useState, useEffect } from "react";
import { ShieldCheck, AlertTriangle, AlertOctagon, Activity, RefreshCw, Warehouse, Package, Layers } from "lucide-react";

export default function InventoryHealthPage() {
  const [report, setReport] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/inventory/health");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch health report");
      setReport(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
  }, []);

  if (isLoading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[600px]">
        <div className="flex items-center gap-3 text-gray-500 dark:text-gray-400">
          <RefreshCw className="w-6 h-6 animate-spin text-blue-600" />
          <span className="font-medium text-sm">Evaluating WMS Inventory Integrity & Health Score...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <div className="p-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">
          <strong>Error loading inventory health report:</strong> {error}
        </div>
      </div>
    );
  }

  const scoreColor =
    report.healthScore >= 90
      ? "text-emerald-600 dark:text-emerald-400"
      : report.healthScore >= 70
      ? "text-amber-600 dark:text-amber-400"
      : "text-red-600 dark:text-red-400";

  const statusBadge =
    report.status === "HEALTHY"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
      : report.status === "WARNING"
      ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
      : "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300";

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-gray-200 dark:border-gray-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Activity className="w-7 h-7 text-blue-600" />
            Inventory Health & Master Invariants Monitor
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Real-time automated integrity score and anomaly detection for stock, bins, batches, and reservations.
          </p>
        </div>
        <button
          onClick={fetchHealth}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Re-evaluate Health
        </button>
      </div>

      {/* Score Banner & Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Main Health Score */}
        <div className="md:col-span-1 bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm flex flex-col justify-center items-center text-center">
          <div className={`text-5xl font-black ${scoreColor}`}>{report.healthScore}%</div>
          <div className="text-xs uppercase tracking-wider font-semibold text-gray-400 dark:text-gray-500 mt-2">
            Overall Health Score
          </div>
          <span className={`inline-flex items-center gap-1.5 px-3 py-1 mt-3 rounded-full text-xs font-semibold ${statusBadge}`}>
            {report.status === "HEALTHY" && <ShieldCheck className="w-3.5 h-3.5" />}
            {report.status === "WARNING" && <AlertTriangle className="w-3.5 h-3.5" />}
            {report.status === "CRITICAL" && <AlertOctagon className="w-3.5 h-3.5" />}
            {report.status}
          </span>
        </div>

        {/* Quick Metrics */}
        <div className="md:col-span-3 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm flex flex-col justify-center">
            <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-xs font-medium">
              <Package className="w-4 h-4 text-blue-500" />
              Products Audited
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
              {report.summary.totalProductsChecked}
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm flex flex-col justify-center">
            <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-xs font-medium">
              <Warehouse className="w-4 h-4 text-indigo-500" />
              Warehouses
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
              {report.summary.totalWarehousesChecked}
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm flex flex-col justify-center">
            <div className="flex items-center gap-2 text-red-600 dark:text-red-400 text-xs font-medium">
              <AlertOctagon className="w-4 h-4" />
              Critical Issues
            </div>
            <div className="text-2xl font-bold text-red-600 dark:text-red-400 mt-1">
              {report.summary.criticalIssuesCount}
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm flex flex-col justify-center">
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 text-xs font-medium">
              <AlertTriangle className="w-4 h-4" />
              Warnings
            </div>
            <div className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">
              {report.summary.warningIssuesCount}
            </div>
          </div>
        </div>
      </div>

      {/* Detected Anomalies List */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/50 flex justify-between items-center">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Layers className="w-4 h-4 text-blue-600" />
            Detected Integrity Anomalies ({report.issues.length})
          </h2>
          <span className="text-xs text-gray-400 dark:text-gray-500">
            Last evaluated: {new Date(report.lastReconciliationTimestamp).toLocaleTimeString()}
          </span>
        </div>

        {report.issues.length === 0 ? (
          <div className="p-12 text-center text-gray-500 dark:text-gray-400">
            <ShieldCheck className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
            <h3 className="text-base font-medium text-gray-900 dark:text-white">All Master Stock Invariants Verified</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              No stock corruption, overrun, expired batch, or allocation mismatch detected across all warehouses.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {report.issues.map((issue: any) => (
              <div key={issue.id} className="p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:bg-gray-50 dark:hover:bg-gray-900/40">
                <div className="flex items-start gap-3">
                  {issue.severity === "CRITICAL" ? (
                    <AlertOctagon className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-gray-900 dark:text-white">
                        {issue.productName} ({issue.productSku || "N/A"})
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 font-mono">
                        {issue.warehouseName}
                      </span>
                      {issue.binCode && (
                        <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 font-mono">
                          Bin: {issue.binCode}
                        </span>
                      )}
                      {issue.batchNumber && (
                        <span className="text-xs px-2 py-0.5 rounded bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300 font-mono">
                          Batch: {issue.batchNumber}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">{issue.message}</p>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <span
                    className={`inline-block px-2.5 py-1 rounded text-xs font-semibold ${
                      issue.severity === "CRITICAL"
                        ? "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300"
                        : "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                    }`}
                  >
                    {issue.category}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
