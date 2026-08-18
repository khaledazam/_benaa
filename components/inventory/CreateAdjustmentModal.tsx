"use client";

import React, { useState, useEffect } from "react";

interface CreateAdjustmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function CreateAdjustmentModal({ isOpen, onClose, onSuccess }: CreateAdjustmentModalProps) {
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [bins, setBins] = useState<any[]>([]);

  const [warehouseId, setWarehouseId] = useState("");
  const [adjustmentType, setAdjustmentType] = useState("CORRECTION");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");

  const [items, setItems] = useState<any[]>([
    { productId: "", binId: "", adjustmentQuantity: 0, reason: "" },
  ]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/warehouses")
      .then((res) => res.json())
      .then((data) => setWarehouses(data.data || data || []));

    fetch("/api/products")
      .then((res) => res.json())
      .then((data) => setProducts(data.data || data.products || []));
  }, []);

  useEffect(() => {
    if (warehouseId) {
      fetch(`/api/locations/bins?warehouseId=${warehouseId}`)
        .then((res) => res.json())
        .then((data) => setBins(data.data || data || []));
    }
  }, [warehouseId]);

  const handleAddItem = () => {
    setItems([...items, { productId: "", binId: "", adjustmentQuantity: 0, reason: "" }]);
  };

  const handleRemoveItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const handleItemChange = (index: number, field: string, value: any) => {
    const newItems = [...items];
    newItems[index][field] = value;
    setItems(newItems);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!warehouseId) {
      setError("Please select a warehouse");
      return;
    }
    if (!reason.trim()) {
      setError("Please specify a reason");
      return;
    }
    if (items.length === 0 || items.some((i) => !i.productId || i.adjustmentQuantity === 0)) {
      setError("Please provide valid product and non-zero adjustment quantity for all lines");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const payload = {
        warehouseId,
        reason,
        adjustmentType,
        notes,
        items: items.map((i) => ({
          productId: i.productId,
          binId: i.binId || undefined,
          systemQuantity: 0, // system captures automatically
          adjustmentQuantity: parseFloat(i.adjustmentQuantity),
          resultingQuantity: Math.max(0, parseFloat(i.adjustmentQuantity)),
          reason: i.reason || reason,
        })),
      };

      const res = await fetch("/api/inventory/adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to create adjustment");
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
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-6">
        <div className="flex justify-between items-center border-b pb-4">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Create Stock Adjustment</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg">
            ✕
          </button>
        </div>

        {error && (
          <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                Warehouse *
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
                Adjustment Type *
              </label>
              <select
                value={adjustmentType}
                onChange={(e) => setAdjustmentType(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
              >
                <option value="ADJUSTMENT_IN">ADJUSTMENT_IN (+)</option>
                <option value="ADJUSTMENT_OUT">ADJUSTMENT_OUT (-)</option>
                <option value="DAMAGE">DAMAGE (-)</option>
                <option value="LOSS">LOSS (-)</option>
                <option value="EXPIRY">EXPIRY (-)</option>
                <option value="FOUND">FOUND (+)</option>
                <option value="CORRECTION">CORRECTION (+/-)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Primary Reason *
            </label>
            <input
              type="text"
              placeholder="e.g. Physical count discrepancy, damaged packaging"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
              required
            />
          </div>

          {/* Item Lines */}
          <div className="space-y-3 pt-2">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Adjustment Items</h3>
              <button
                type="button"
                onClick={handleAddItem}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
              >
                + Add Item
              </button>
            </div>

            {items.map((item, idx) => (
              <div key={idx} className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg space-y-2 border">
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-500">Product *</label>
                    <select
                      value={item.productId}
                      onChange={(e) => handleItemChange(idx, "productId", e.target.value)}
                      className="w-full px-2 py-1 text-xs border rounded bg-white dark:bg-slate-800"
                      required
                    >
                      <option value="">Select Product</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.sku})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-500">Bin (Optional)</label>
                    <select
                      value={item.binId}
                      onChange={(e) => handleItemChange(idx, "binId", e.target.value)}
                      className="w-full px-2 py-1 text-xs border rounded bg-white dark:bg-slate-800"
                    >
                      <option value="">No Bin (Warehouse Stock)</option>
                      {bins.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.code} ({b.locationPath || b.code})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-500">Adjustment Delta *</label>
                    <input
                      type="number"
                      step="any"
                      placeholder="e.g. +10 or -5"
                      value={item.adjustmentQuantity}
                      onChange={(e) => handleItemChange(idx, "adjustmentQuantity", e.target.value)}
                      className="w-full px-2 py-1 text-xs border rounded bg-white dark:bg-slate-800"
                      required
                    />
                  </div>
                </div>

                <div className="flex justify-between items-center pt-1">
                  <input
                    type="text"
                    placeholder="Line note / specific reason"
                    value={item.reason}
                    onChange={(e) => handleItemChange(idx, "reason", e.target.value)}
                    className="w-full px-2 py-1 text-xs border rounded bg-white dark:bg-slate-800 mr-2"
                  />
                  {items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveItem(idx)}
                      className="text-xs text-red-600 hover:text-red-800"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
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
              {loading ? "Creating..." : "Save Draft"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
