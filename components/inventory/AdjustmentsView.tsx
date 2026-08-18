"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { CreateAdjustmentModal } from "./CreateAdjustmentModal";

export function AdjustmentsView() {
  const [adjustments, setAdjustments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  const fetchAdjustments = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (typeFilter !== "ALL") params.set("adjustmentType", typeFilter);
      if (searchQuery) params.set("search", searchQuery);

      const res = await fetch(`/api/inventory/adjustments?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch adjustments");
      const data = await res.json();
      setAdjustments(data.data || []);
    } catch (err: any) {
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAdjustments();
  }, [statusFilter, typeFilter, searchQuery]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Stock Adjustments</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            Auditable physical inventory corrections and variance reconciliations
          </p>
        </div>
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="inline-flex items-center justify-center px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium text-sm transition-colors shadow-sm"
        >
          + New Stock Adjustment
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 flex flex-wrap gap-4 items-center justify-between">
        <div className="flex flex-wrap gap-3 items-center flex-1">
          <input
            type="text"
            placeholder="Search by number, reason, creator..."
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
            <option value="PENDING_APPROVAL">Pending Approval</option>
            <option value="APPROVED">Approved</option>
            <option value="POSTED">Posted</option>
            <option value="REJECTED">Rejected</option>
            <option value="CANCELLED">Cancelled</option>
          </select>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
          >
            <option value="ALL">All Types</option>
            <option value="ADJUSTMENT_IN">Adjustment In (+)</option>
            <option value="ADJUSTMENT_OUT">Adjustment Out (-)</option>
            <option value="DAMAGE">Damage</option>
            <option value="LOSS">Loss</option>
            <option value="EXPIRY">Expiry</option>
            <option value="FOUND">Found (+)</option>
            <option value="CORRECTION">Correction</option>
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
                <th className="p-4">Type</th>
                <th className="p-4">Reason</th>
                <th className="p-4">Items</th>
                <th className="p-4">Status</th>
                <th className="p-4">Created By</th>
                <th className="p-4">Created At</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-slate-400">
                    Loading stock adjustments...
                  </td>
                </tr>
              ) : adjustments.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-slate-400">
                    No stock adjustments found.
                  </td>
                </tr>
              ) : (
                adjustments.map((adj) => (
                  <tr key={adj.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                    <td className="p-4 font-mono font-medium text-slate-900 dark:text-white">
                      {adj.adjustmentNumber}
                    </td>
                    <td className="p-4">{adj.warehouseName || adj.warehouse?.name}</td>
                    <td className="p-4">
                      <span className="px-2 py-1 bg-slate-100 dark:bg-slate-700 text-xs font-semibold rounded-md">
                        {adj.adjustmentType}
                      </span>
                    </td>
                    <td className="p-4 text-slate-900 dark:text-white font-medium truncate max-w-xs">
                      {adj.reason}
                    </td>
                    <td className="p-4">{adj.items?.length || 0}</td>
                    <td className="p-4">
                      <span
                        className={`px-2 py-1 text-xs font-semibold rounded-full ${
                          adj.status === "POSTED"
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
                            : adj.status === "APPROVED"
                            ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
                            : adj.status === "PENDING_APPROVAL"
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                            : adj.status === "DRAFT"
                            ? "bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-300"
                            : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                        }`}
                      >
                        {adj.status}
                      </span>
                    </td>
                    <td className="p-4">{adj.createdByName || "User"}</td>
                    <td className="p-4 text-xs">{new Date(adj.createdAt).toLocaleDateString()}</td>
                    <td className="p-4 text-right">
                      <Link
                        href={`/inventory/adjustments/${adj.id}`}
                        className="text-indigo-600 hover:text-indigo-800 font-medium text-sm"
                      >
                        View Details
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
        <CreateAdjustmentModal
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          onSuccess={() => {
            setIsCreateModalOpen(false);
            fetchAdjustments();
          }}
        />
      )}
    </div>
  );
}
