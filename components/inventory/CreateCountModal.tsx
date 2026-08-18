"use client";

import React, { useState, useEffect } from "react";

interface CreateCountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function CreateCountModal({ isOpen, onClose, onSuccess }: CreateCountModalProps) {
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [scopeType, setScopeType] = useState("WAREHOUSE");
  const [scopeId, setScopeId] = useState("");
  const [notes, setNotes] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/warehouses")
      .then((res) => res.json())
      .then((data) => setWarehouses(data.data || data || []));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!warehouseId) {
      setError("Please select a warehouse");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const payload = {
        warehouseId,
        scopeType,
        scopeId: scopeId || undefined,
        notes,
      };

      const res = await fetch("/api/inventory/counts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to create count");
      }

      onSuccess();
    } catch (err: any) {
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl w-full max-w-md p-6 space-y-6">
        <div className="flex justify-between items-center border-b pb-4">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Start Inventory Count</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg">
            ✕
          </button>
        </div>

        {error && (
          <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Target Warehouse *
            </label>
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
              required
            >
              <option value="">Select Warehouse</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Count Scope Type *
            </label>
            <select
              value={scopeType}
              onChange={(e) => setScopeType(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
            >
              <option value="WAREHOUSE">Full Warehouse Count</option>
              <option value="BIN">Specific Bin</option>
              <option value="PRODUCT">Specific Product</option>
              <option value="CATEGORY">Category Cycle Count</option>
              <option value="LOW_STOCK">Low Stock Audit</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Notes / Instructions
            </label>
            <textarea
              rows={2}
              placeholder="e.g. Q3 End-of-month cycle count for Section A"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-sm bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg font-medium shadow-sm disabled:opacity-50"
            >
              {loading ? "Creating..." : "Create Count"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
