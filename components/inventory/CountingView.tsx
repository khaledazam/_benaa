"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { CreateCountModal } from "./CreateCountModal";

export function CountingView() {
  const [counts, setCounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [scopeFilter, setScopeFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  const fetchCounts = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (scopeFilter !== "ALL") params.set("scopeType", scopeFilter);
      if (searchQuery) params.set("search", searchQuery);

      const res = await fetch(`/api/inventory/counts?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch inventory counts");
      const data = await res.json();
      setCounts(data.data || []);
    } catch (err: any) {
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCounts();
  }, [statusFilter, scopeFilter, searchQuery]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Inventory Counting & Cycle Counts</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            Auditable physical counting, scope targeting, and variance reconciliations
          </p>
        </div>
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="inline-flex items-center justify-center px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium text-sm transition-colors shadow-sm"
        >
          + Start New Inventory Count
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 flex flex-wrap gap-4 items-center justify-between">
        <div className="flex flex-wrap gap-3 items-center flex-1">
          <input
            type="text"
            placeholder="Search by count number, scope..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-white w-64"
          />

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
          >
            <option value="ALL">All Statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="SUBMITTED">Submitted</option>
            <option value="APPROVED">Approved</option>
            <option value="POSTED">Posted</option>
            <option value="CLOSED">Closed</option>
          </select>

          <select
            value={scopeFilter}
            onChange={(e) => setScopeFilter(e.target.value)}
            className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
          >
            <option value="ALL">All Scopes</option>
            <option value="WAREHOUSE">Warehouse</option>
            <option value="ZONE">Zone</option>
            <option value="BIN">Bin</option>
            <option value="PRODUCT">Product</option>
            <option value="CATEGORY">Category</option>
            <option value="LOW_STOCK">Low Stock</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-xl text-sm">
          {error}
        </div>
      )}

      {/* Directory Table */}
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-700 dark:text-slate-200 font-semibold border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="p-4">Number</th>
                <th className="p-4">Warehouse</th>
                <th className="p-4">Scope</th>
                <th className="p-4">Target</th>
                <th className="p-4">Items Counted</th>
                <th className="p-4">Status</th>
                <th className="p-4">Created By</th>
                <th className="p-4">Started At</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-slate-400">
                    Loading inventory counts...
                  </td>
                </tr>
              ) : counts.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-slate-400">
                    No inventory counts found.
                  </td>
                </tr>
              ) : (
                counts.map((cnt) => (
                  <tr key={cnt.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                    <td className="p-4 font-mono font-medium text-slate-900 dark:text-white">
                      {cnt.countNumber}
                    </td>
                    <td className="p-4">{cnt.warehouseName || cnt.warehouse?.name}</td>
                    <td className="p-4">
                      <span className="px-2 py-1 bg-slate-100 dark:bg-slate-700 text-xs font-semibold rounded-md">
                        {cnt.scopeType}
                      </span>
                    </td>
                    <td className="p-4 text-slate-900 dark:text-white font-medium">
                      {cnt.scopeName || cnt.scopeType}
                    </td>
                    <td className="p-4">
                      {cnt.items?.filter((i: any) => i.countedQuantity !== null).length || 0} / {cnt.items?.length || 0}
                    </td>
                    <td className="p-4">
                      <span
                        className={`px-2 py-1 text-xs font-semibold rounded-full ${
                          cnt.status === "POSTED" || cnt.status === "CLOSED"
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
                            : cnt.status === "APPROVED"
                            ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
                            : cnt.status === "IN_PROGRESS" || cnt.status === "SUBMITTED"
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                            : "bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-300"
                        }`}
                      >
                        {cnt.status}
                      </span>
                    </td>
                    <td className="p-4">{cnt.createdByName || "User"}</td>
                    <td className="p-4 text-xs">
                      {cnt.startedAt ? new Date(cnt.startedAt).toLocaleDateString() : "—"}
                    </td>
                    <td className="p-4 text-right">
                      <Link
                        href={`/inventory/counting/${cnt.id}`}
                        className="text-indigo-600 hover:text-indigo-800 font-medium text-sm"
                      >
                        Open Count
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isCreateModalOpen && (
        <CreateCountModal
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          onSuccess={() => {
            setIsCreateModalOpen(false);
            fetchCounts();
          }}
        />
      )}
    </div>
  );
}
