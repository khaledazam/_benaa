"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, CheckCircle2, AlertTriangle, Box, Warehouse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";

export default function StockRelocationView() {
  const queryClient = useQueryClient();

  const [warehouseId, setWarehouseId] = useState("");
  const [productId, setProductId] = useState("");
  const [fromBinId, setFromBinId] = useState("");
  const [toBinId, setToBinId] = useState("");
  const [quantity, setQuantity] = useState<number>(0);
  const [reason, setReason] = useState("");

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 1. Fetch Warehouses
  const { data: warehouses } = useQuery({
    queryKey: ["relocate-warehouses"],
    queryFn: async () => {
      const res = await fetch("/api/warehouses");
      return res.ok ? res.json() : [];
    },
  });

  // 2. Fetch Products
  const { data: products } = useQuery({
    queryKey: ["relocate-products"],
    queryFn: async () => {
      const res = await fetch("/api/products");
      return res.ok ? res.json() : [];
    },
  });

  // 3. Fetch Bins for Selected Warehouse
  const { data: bins } = useQuery({
    queryKey: ["relocate-bins", warehouseId],
    enabled: !!warehouseId,
    queryFn: async () => {
      const res = await fetch(`/api/locations/bins?warehouseId=${warehouseId}`);
      return res.ok ? res.json() : [];
    },
  });

  // 4. Fetch Source Bin Available Stock
  const { data: sourceStockData } = useQuery({
    queryKey: ["relocate-source-stock", productId, fromBinId],
    enabled: !!productId && !!fromBinId,
    queryFn: async () => {
      const res = await fetch(`/api/inventory/locations?binId=${fromBinId}&productId=${productId}`);
      if (!res.ok) return 0;
      const data = await res.json();
      return data[0]?.quantity || 0;
    },
  });

  const availableSourceStock = sourceStockData || 0;

  // Relocation Mutation
  const relocateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/stock-relocations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
          warehouseId,
          fromBinId,
          toBinId,
          quantity: Number(quantity),
          reason: reason || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Relocation failed");
      return data;
    },
    onSuccess: (data: any) => {
      setSuccessMessage(`Successfully relocated ${quantity} units. Movement #: ${data.movementNumber}`);
      setErrorMessage(null);
      queryClient.invalidateQueries({ queryKey: ["inventory-locations-list"] });
      queryClient.invalidateQueries({ queryKey: ["relocate-source-stock"] });
      setQuantity(0);
    },
    onError: (err: any) => {
      setErrorMessage(err.message);
      setSuccessMessage(null);
    },
  });

  const handleRelocate = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (quantity <= 0) {
      setErrorMessage("Relocation quantity must be greater than 0");
      return;
    }
    if (quantity > availableSourceStock) {
      setErrorMessage(`Cannot relocate ${quantity}. Source bin only contains ${availableSourceStock} available units.`);
      return;
    }
    if (fromBinId === toBinId) {
      setErrorMessage("Source bin and destination bin must be different");
      return;
    }

    relocateMutation.mutate();
  };

  const selectedFromBin = bins?.find((b: any) => b.id === fromBinId);
  const selectedToBin = bins?.find((b: any) => b.id === toBinId);

  return (
    <div className="max-w-3xl mx-auto space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <ArrowLeftRight className="h-6 w-6 text-sky-600" /> Bin Stock Relocation
        </h1>
        <p className="text-sm text-muted-foreground">
          Move product stock between physical bins inside the SAME warehouse. Total warehouse stock remains UNCHANGED.
        </p>
      </div>

      {successMessage && (
        <div className="p-3 border border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-100 rounded-md text-xs">
          <div className="font-bold flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Success</div>
          <div>{successMessage}</div>
        </div>
      )}

      {errorMessage && (
        <div className="p-3 border border-destructive bg-destructive/10 text-destructive rounded-md text-xs">
          <div className="font-bold flex items-center gap-1"><AlertTriangle className="h-4 w-4" /> Relocation Error</div>
          <div>{errorMessage}</div>
        </div>
      )}

      <Card className="shadow-sm">
        <form onSubmit={handleRelocate}>
          <CardHeader>
            <CardTitle className="text-base font-semibold">Relocation Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* WAREHOUSE SELECT */}
            <div className="space-y-2">
              <Label className="text-xs font-medium">1. Warehouse</Label>
              <select
                value={warehouseId}
                onChange={(e) => {
                  setWarehouseId(e.target.value);
                  setFromBinId("");
                  setToBinId("");
                }}
                required
                className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-xs shadow-sm focus:outline-none"
              >
                <option value="">-- Select Warehouse --</option>
                {warehouses?.map((wh: any) => (
                  <option key={wh.id} value={wh.id}>
                    {wh.name} ({wh.code || "WH"})
                  </option>
                ))}
              </select>
            </div>

            {/* PRODUCT SELECT */}
            <div className="space-y-2">
              <Label className="text-xs font-medium">2. Product</Label>
              <select
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                required
                disabled={!warehouseId}
                className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-xs shadow-sm focus:outline-none"
              >
                <option value="">-- Select Product --</option>
                {products?.map((p: any) => (
                  <option key={p.id} value={p.id}>
                    {p.name} (SKU: {p.sku})
                  </option>
                ))}
              </select>
            </div>

            {/* BINS SELECTION ROW */}
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-xs font-medium">3. Source Bin (FROM)</Label>
                <select
                  value={fromBinId}
                  onChange={(e) => setFromBinId(e.target.value)}
                  required
                  disabled={!warehouseId || !productId}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-xs shadow-sm focus:outline-none"
                >
                  <option value="">-- Select Source Bin --</option>
                  {bins?.map((b: any) => (
                    <option key={b.id} value={b.id}>
                      {b.code} ({b.name})
                    </option>
                  ))}
                </select>
                {fromBinId && (
                  <p className="text-xs text-sky-600 font-mono font-medium">
                    Available Stock in Source Bin: {availableSourceStock} units
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-medium">4. Destination Bin (TO)</Label>
                <select
                  value={toBinId}
                  onChange={(e) => setToBinId(e.target.value)}
                  required
                  disabled={!warehouseId || !productId}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-xs shadow-sm focus:outline-none"
                >
                  <option value="">-- Select Destination Bin --</option>
                  {bins?.filter((b: any) => b.id !== fromBinId).map((b: any) => (
                    <option key={b.id} value={b.id}>
                      {b.code} ({b.name})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* QUANTITY & REASON */}
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="qty" className="text-xs font-medium">
                  5. Relocation Quantity
                </Label>
                <Input
                  id="qty"
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={availableSourceStock}
                  value={quantity || ""}
                  onChange={(e) => setQuantity(parseFloat(e.target.value) || 0)}
                  required
                  className="text-xs font-mono"
                  placeholder="e.g. 25.00"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="reason" className="text-xs font-medium">
                  Reason / Notes (Optional)
                </Label>
                <Input
                  id="reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="text-xs"
                  placeholder="e.g. Reorganizing tile racks"
                />
              </div>
            </div>

            {/* PATH PREVIEW */}
            {selectedFromBin && selectedToBin && (
              <div className="p-3 bg-muted rounded-md text-xs space-y-1 font-mono">
                <p className="font-semibold text-muted-foreground uppercase text-[10px]">Relocation Path Preview</p>
                <p className="text-rose-600 dark:text-rose-400">
                  FROM: {selectedFromBin.locationPath || selectedFromBin.code}
                </p>
                <p className="text-emerald-600 dark:text-emerald-400">
                  TO: {selectedToBin.locationPath || selectedToBin.code}
                </p>
              </div>
            )}
          </CardContent>
          <CardFooter>
            <Button
              type="submit"
              disabled={relocateMutation.isPending || !warehouseId || !productId || !fromBinId || !toBinId || quantity <= 0}
              className="w-full text-xs font-semibold"
            >
              {relocateMutation.isPending ? "Executing Relocation..." : "Confirm & Execute Bin Relocation"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
