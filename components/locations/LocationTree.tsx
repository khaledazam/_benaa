"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  Layers,
  Grid,
  Box,
  Plus,
  Trash2,
  Package,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";

export default function LocationTree({ warehouseId }: { warehouseId: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const userRole = user?.role || "VIEWER";
  const canCreate = hasPermission(user, BuildStockPermissions.LOCATION_CREATE);
  const canDeactivate = hasPermission(user, BuildStockPermissions.LOCATION_DEACTIVATE);

  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});
  const [selectedBin, setSelectedBin] = useState<any>(null);

  // Dialog State
  const [activeDialog, setActiveDialog] = useState<"zone" | "rack" | "shelf" | "bin" | null>(null);
  const [parentTarget, setParentTarget] = useState<{ zoneId?: string; rackId?: string; shelfId?: string }>({});
  const [formData, setFormData] = useState({ code: "", name: "", level: 1 });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Fetch Location Tree
  const { data: locationData, isLoading: treeLoading } = useQuery({
    queryKey: ["warehouse-location-tree", warehouseId],
    queryFn: async () => {
      const res = await fetch(`/api/warehouses/${warehouseId}/locations`);
      if (!res.ok) throw new Error("Failed to load location tree");
      return res.json();
    },
  });

  // Fetch Bin Inventory when Selected
  const { data: binStock, isLoading: stockLoading } = useQuery({
    queryKey: ["bin-stock", selectedBin?.id],
    enabled: !!selectedBin?.id,
    queryFn: async () => {
      const res = await fetch(`/api/inventory/locations?binId=${selectedBin.id}`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const toggleNode = (nodeId: string) => {
    setExpandedNodes((prev) => ({ ...prev, [nodeId]: !prev[nodeId] }));
  };

  // Create Mutation
  const createMutation = useMutation({
    mutationFn: async ({ endpoint, payload }: { endpoint: string; payload: any }) => {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create location");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["warehouse-location-tree", warehouseId] });
      setActiveDialog(null);
      setFormData({ code: "", name: "", level: 1 });
      setErrorMessage(null);
    },
    onError: (err: any) => {
      setErrorMessage(err.message);
    },
  });

  // Deactivate Bin Mutation
  const deactivateBinMutation = useMutation({
    mutationFn: async (binId: string) => {
      const res = await fetch(`/api/locations/bins/${binId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to deactivate bin");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["warehouse-location-tree", warehouseId] });
      setSelectedBin(null);
    },
    onError: (err: any) => {
      alert(err.message);
    },
  });

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (activeDialog === "zone") {
      createMutation.mutate({
        endpoint: "/api/locations/zones",
        payload: { warehouseId, code: formData.code, name: formData.name },
      });
    } else if (activeDialog === "rack" && parentTarget.zoneId) {
      createMutation.mutate({
        endpoint: "/api/locations/racks",
        payload: { zoneId: parentTarget.zoneId, code: formData.code, name: formData.name },
      });
    } else if (activeDialog === "shelf" && parentTarget.rackId) {
      createMutation.mutate({
        endpoint: "/api/locations/shelves",
        payload: { rackId: parentTarget.rackId, code: formData.code, name: formData.name, level: formData.level },
      });
    } else if (activeDialog === "bin" && parentTarget.shelfId) {
      createMutation.mutate({
        endpoint: "/api/locations/bins",
        payload: { shelfId: parentTarget.shelfId, code: formData.code, name: formData.name },
      });
    }
  };

  return (
    <div className="grid gap-6 md:grid-cols-3">
      {/* LOCATION TREE CONTAINER */}
      <Card className="md:col-span-2 shadow-sm border">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base font-semibold">Physical Location Hierarchy</CardTitle>
            <p className="text-xs text-muted-foreground">Zone → Rack → Shelf → Bin physical layout</p>
          </div>
          {canCreate && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setActiveDialog("zone");
                setErrorMessage(null);
              }}
              className="h-8 text-xs"
            >
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Zone
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {treeLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading location structure...</div>
          ) : !locationData?.zones || locationData.zones.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No location zones configured for this warehouse yet.
            </div>
          ) : (
            <div className="space-y-1 text-sm">
              {locationData.zones.map((zone: any) => {
                const isZoneExpanded = !!expandedNodes[zone.id];
                return (
                  <div key={zone.id} className="border-l-2 border-slate-200 dark:border-slate-800 pl-2 my-1">
                    {/* ZONE NODE */}
                    <div className="flex items-center justify-between py-1 px-2 hover:bg-muted/50 rounded group">
                      <div
                        className="flex items-center gap-2 cursor-pointer flex-1 font-medium"
                        onClick={() => toggleNode(zone.id)}
                      >
                        {isZoneExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        <Folder className="h-4 w-4 text-amber-500" />
                        <span>Zone: {zone.code}</span>
                        <span className="text-xs text-muted-foreground">({zone.name})</span>
                      </div>
                      {canCreate && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100"
                          title="Add Rack to Zone"
                          onClick={() => {
                            setParentTarget({ zoneId: zone.id });
                            setActiveDialog("rack");
                            setErrorMessage(null);
                          }}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      )}
                    </div>

                    {/* RACKS */}
                    {isZoneExpanded &&
                      zone.racks?.map((rack: any) => {
                        const isRackExpanded = !!expandedNodes[rack.id];
                        return (
                          <div key={rack.id} className="ml-4 border-l-2 border-slate-200 dark:border-slate-800 pl-2 my-1">
                            <div className="flex items-center justify-between py-1 px-2 hover:bg-muted/50 rounded group">
                              <div
                                className="flex items-center gap-2 cursor-pointer flex-1"
                                onClick={() => toggleNode(rack.id)}
                              >
                                {isRackExpanded ? (
                                  <ChevronDown className="h-3.5 w-3.5" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5" />
                                )}
                                <Layers className="h-3.5 w-3.5 text-blue-500" />
                                <span className="font-mono text-xs font-semibold">Rack: {rack.code}</span>
                                <span className="text-xs text-muted-foreground">({rack.name})</span>
                              </div>
                              {canCreate && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6 opacity-0 group-hover:opacity-100"
                                  title="Add Shelf to Rack"
                                  onClick={() => {
                                    setParentTarget({ rackId: rack.id });
                                    setActiveDialog("shelf");
                                    setErrorMessage(null);
                                  }}
                                >
                                  <Plus className="h-3 w-3" />
                                </Button>
                              )}
                            </div>

                            {/* SHELVES */}
                            {isRackExpanded &&
                              rack.shelves?.map((shelf: any) => {
                                const isShelfExpanded = !!expandedNodes[shelf.id];
                                return (
                                  <div
                                    key={shelf.id}
                                    className="ml-4 border-l-2 border-slate-200 dark:border-slate-800 pl-2 my-1"
                                  >
                                    <div className="flex items-center justify-between py-1 px-2 hover:bg-muted/50 rounded group">
                                      <div
                                        className="flex items-center gap-2 cursor-pointer flex-1"
                                        onClick={() => toggleNode(shelf.id)}
                                      >
                                        {isShelfExpanded ? (
                                          <ChevronDown className="h-3.5 w-3.5" />
                                        ) : (
                                          <ChevronRight className="h-3.5 w-3.5" />
                                        )}
                                        <Grid className="h-3.5 w-3.5 text-emerald-500" />
                                        <span className="font-mono text-xs">Shelf: {shelf.code}</span>
                                        <span className="text-xs text-muted-foreground">(Level {shelf.level})</span>
                                      </div>
                                      {canCreate && (
                                        <Button
                                          size="icon"
                                          variant="ghost"
                                          className="h-6 w-6 opacity-0 group-hover:opacity-100"
                                          title="Add Bin to Shelf"
                                          onClick={() => {
                                            setParentTarget({ shelfId: shelf.id });
                                            setActiveDialog("bin");
                                            setErrorMessage(null);
                                          }}
                                        >
                                          <Plus className="h-3 w-3" />
                                        </Button>
                                      )}
                                    </div>

                                    {/* BINS */}
                                    {isShelfExpanded &&
                                      shelf.bins?.map((bin: any) => {
                                        const isSelected = selectedBin?.id === bin.id;
                                        return (
                                          <div
                                            key={bin.id}
                                            onClick={() => setSelectedBin(bin)}
                                            className={`ml-4 flex items-center justify-between py-1 px-2 rounded cursor-pointer transition-colors ${
                                              isSelected
                                                ? "bg-sky-100 dark:bg-sky-950/60 font-semibold border border-sky-300"
                                                : "hover:bg-muted/60"
                                            }`}
                                          >
                                            <div className="flex items-center gap-2">
                                              <Box className="h-3.5 w-3.5 text-sky-600" />
                                              <span className="font-mono text-xs">Bin: {bin.code}</span>
                                              <span className="text-[11px] text-muted-foreground">({bin.name})</span>
                                            </div>
                                            <Badge variant="outline" className="text-[10px]">
                                              Bin
                                            </Badge>
                                          </div>
                                        );
                                      })}
                                  </div>
                                );
                              })}
                          </div>
                        );
                      })}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* SELECTED BIN INSPECTOR */}
      <Card className="shadow-sm border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Info className="h-4 w-4 text-sky-600" /> Bin Inspector
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!selectedBin ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              Select a Bin in the hierarchy tree to view physical location details and stored inventory.
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-xs text-muted-foreground">Location Path</p>
                <p className="text-xs font-mono font-semibold bg-muted p-2 rounded mt-1 break-all">
                  {selectedBin.locationPath || selectedBin.code}
                </p>
              </div>

              <div className="flex justify-between items-center text-xs border-b pb-2">
                <span className="text-muted-foreground">Bin Code:</span>
                <span className="font-mono font-semibold">{selectedBin.code}</span>
              </div>

              <div className="flex justify-between items-center text-xs border-b pb-2">
                <span className="text-muted-foreground">Bin Name:</span>
                <span>{selectedBin.name}</span>
              </div>

              <div>
                <p className="text-xs font-semibold mb-2 flex items-center gap-1">
                  <Package className="h-3.5 w-3.5" /> Stored Inventory
                </p>
                {stockLoading ? (
                  <p className="text-xs text-muted-foreground">Loading stock...</p>
                ) : !binStock || binStock.length === 0 ? (
                  <p className="text-xs text-muted-foreground bg-muted/40 p-3 rounded text-center">
                    Bin is currently empty (0 stock).
                  </p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {binStock.map((alloc: any) => (
                      <div key={alloc.id} className="p-2 border rounded text-xs bg-card flex justify-between items-center">
                        <div>
                          <p className="font-medium truncate max-w-[120px]">{alloc.product?.name || "Product"}</p>
                          <p className="text-[10px] font-mono text-muted-foreground">SKU: {alloc.product?.sku}</p>
                        </div>
                        <div className="text-right">
                          <span className="font-mono font-bold text-sky-600">{alloc.quantity}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {canDeactivate && (!binStock || binStock.length === 0) && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="w-full mt-2 text-xs"
                  onClick={() => deactivateBinMutation.mutate(selectedBin.id)}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" /> Deactivate Empty Bin
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* CREATE DIALOG */}
      <Dialog open={!!activeDialog} onOpenChange={() => setActiveDialog(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="capitalize">Create New {activeDialog}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateSubmit} className="space-y-4 py-2">
            {errorMessage && (
              <div className="p-2 bg-destructive/10 text-destructive text-xs rounded font-medium">
                {errorMessage}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="code" className="text-xs">
                Code (e.g. {activeDialog === "zone" ? "TILES" : activeDialog === "rack" ? "R-01" : activeDialog === "shelf" ? "S-01" : "B-01"})
              </Label>
              <Input
                id="code"
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                required
                className="text-xs uppercase"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name" className="text-xs">
                Descriptive Name
              </Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
                className="text-xs"
              />
            </div>
            {activeDialog === "shelf" && (
              <div className="space-y-2">
                <Label htmlFor="level" className="text-xs">
                  Shelf Level / Tier
                </Label>
                <Input
                  id="level"
                  type="number"
                  min="1"
                  value={formData.level}
                  onChange={(e) => setFormData({ ...formData, level: parseInt(e.target.value) || 1 })}
                  required
                  className="text-xs"
                />
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setActiveDialog(null)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Creating..." : "Save Location"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
