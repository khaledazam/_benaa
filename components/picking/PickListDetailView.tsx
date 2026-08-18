"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  PackageCheck,
  Warehouse,
  User,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Sparkles,
  Save,
  ArrowLeft,
  Loader2,
  MapPin,
  FileText,
  AlertTriangle,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";

import { CreateDispatchModal } from "@/components/dispatch/CreateDispatchModal";
import { Truck } from "lucide-react";

interface PickListDetailViewProps {
  id: string;
}

export default function PickListDetailView({ id }: PickListDetailViewProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userRole = user?.role || "VIEWER";

  const [allocationsInput, setAllocationsInput] = useState<Record<string, Record<string, number>>>({}); // itemId -> { binId -> quantity }
  const [isShortModalOpen, setIsShortModalOpen] = useState(false);
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [isDispatchModalOpen, setIsDispatchModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Permissions
  const canStart = hasPermission(userRole, BuildStockPermissions.PICK_LIST_START);
  const canUpdate = hasPermission(userRole, BuildStockPermissions.PICK_LIST_UPDATE);
  const canComplete = hasPermission(userRole, BuildStockPermissions.PICK_LIST_COMPLETE);
  const canCancel = hasPermission(userRole, BuildStockPermissions.PICK_LIST_CANCEL);

  // Fetch Pick List details
  const { data: pickList, isLoading, isError } = useQuery({
    queryKey: ["pick-list-detail", id],
    queryFn: async () => {
      const res = await fetch(`/api/pick-lists/${id}`);
      if (!res.ok) throw new Error("Failed to fetch Pick List details");
      return res.json();
    },
  });

  // Fetch bin availability for all products in this pick list
  const { data: availabilityData, isLoading: isLoadingAvailability } = useQuery({
    queryKey: ["picking-availability-all", pickList?.warehouseId, id],
    queryFn: async () => {
      if (!pickList) return {};
      const results: Record<string, any[]> = {};

      for (const item of pickList.items) {
        const res = await fetch(
          `/api/inventory/picking-availability?productId=${item.productId}&warehouseId=${pickList.warehouseId}&excludePickListId=${id}`
        );
        if (res.ok) {
          const json = await res.json();
          results[item.productId] = json.availabilities || [];
        }
      }

      return results;
    },
    enabled: !!pickList,
  });

  // Initialize draft allocation inputs from existing allocations if not set
  React.useEffect(() => {
    if (pickList && pickList.items) {
      const initialMap: Record<string, Record<string, number>> = {};
      for (const item of pickList.items) {
        initialMap[item.id] = {};
        if (item.allocations) {
          for (const alloc of item.allocations) {
            (initialMap[item.id] as Record<string, number>)[alloc.binId] = alloc.pickedQuantity ?? alloc.requestedQuantity ?? 0;
          }
        }
      }
      setAllocationsInput(initialMap);
    }
  }, [pickList]);

  // Mutations
  const startMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/pick-lists/${id}/start`, { method: "POST" });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Failed to start Pick List");
      }
      return res.json();
    },
    onSuccess: () => {
      setSuccessMessage("Pick List started!");
      queryClient.invalidateQueries({ queryKey: ["pick-list-detail", id] });
    },
    onError: (err: any) => setErrorMessage(err.message),
  });

  const suggestionsMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/pick-lists/${id}/suggestions`);
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Failed to get bin suggestions");
      }
      return res.json();
    },
    onSuccess: (data) => {
      const suggestions = data.suggestions || [];
      const updatedMap = { ...allocationsInput };

      for (const item of pickList?.items || []) {
        updatedMap[item.id] = {};
      }

      for (const sug of suggestions) {
        if (!updatedMap[sug.pickListItemId]) updatedMap[sug.pickListItemId] = {};
        (updatedMap[sug.pickListItemId] as Record<string, number>)[sug.binId] = sug.suggestedQuantity;
      }

      setAllocationsInput(updatedMap);
      setSuccessMessage("Bin suggestions auto-applied! Click 'Save Allocations' to confirm.");
    },
    onError: (err: any) => setErrorMessage(err.message),
  });

  const saveAllocationsMutation = useMutation({
    mutationFn: async () => {
      const payload: any[] = [];

      for (const itemId of Object.keys(allocationsInput)) {
        const binMap = allocationsInput[itemId] || {};
        for (const binId of Object.keys(binMap)) {
          const qty = Number(binMap[binId]) || 0;
          if (qty > 0) {
            payload.push({
              pickListItemId: itemId,
              binId,
              requestedQuantity: qty,
              pickedQuantity: qty,
            });
          }
        }
      }

      if (payload.length === 0) {
        throw new Error("No bin allocations specified. Please assign quantity to at least one bin.");
      }

      const res = await fetch(`/api/pick-lists/${id}/allocations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allocations: payload }),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Failed to save allocations");
      }
      return res.json();
    },
    onSuccess: () => {
      setSuccessMessage("Bin allocations saved successfully!");
      queryClient.invalidateQueries({ queryKey: ["pick-list-detail", id] });
    },
    onError: (err: any) => setErrorMessage(err.message),
  });

  const completeMutation = useMutation({
    mutationFn: async (allowShort: boolean) => {
      const res = await fetch(`/api/pick-lists/${id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowShort }),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Failed to complete Pick List");
      }
      return res.json();
    },
    onSuccess: () => {
      setSuccessMessage("Pick List COMPLETED! Stock is staged and ready for Phase 5D Dispatch.");
      setIsShortModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ["pick-list-detail", id] });
    },
    onError: (err: any) => {
      setErrorMessage(err.message);
      setIsShortModalOpen(false);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/pick-lists/${id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: cancelReason }),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Failed to cancel Pick List");
      }
      return res.json();
    },
    onSuccess: () => {
      setSuccessMessage("Pick List CANCELLED.");
      setIsCancelModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ["pick-list-detail", id] });
    },
    onError: (err: any) => setErrorMessage(err.message),
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (isError || !pickList) {
    return (
      <div className="p-6">
        <div className="rounded-md bg-destructive/15 p-4 text-destructive">
          Failed to load Pick List details. The item may not exist or you do not have permission.
        </div>
      </div>
    );
  }

  const isCompleted = pickList.status === "COMPLETED";
  const isCancelled = pickList.status === "CANCELLED";
  const isReadOnly = isCompleted || isCancelled;

  const handleQtyChange = (itemId: string, binId: string, val: string) => {
    const num = parseFloat(val) || 0;
    setAllocationsInput((prev) => ({
      ...prev,
      [itemId]: {
        ...(prev[itemId] || {}),
        [binId]: num,
      },
    }));
  };

  const handleAttemptComplete = () => {
    let hasShort = false;
    for (const item of pickList.items) {
      if (item.pickedQuantity < item.requestedQuantity) {
        hasShort = true;
        break;
      }
    }

    if (hasShort) {
      setIsShortModalOpen(true);
    } else {
      completeMutation.mutate(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "DRAFT":
        return <Badge variant="outline">DRAFT</Badge>;
      case "ASSIGNED":
        return <Badge className="bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300">ASSIGNED</Badge>;
      case "IN_PROGRESS":
        return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">IN PROGRESS</Badge>;
      case "COMPLETED":
        return <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">COMPLETED</Badge>;
      case "CANCELLED":
        return <Badge variant="secondary">CANCELLED</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6 p-6">
      {/* HEADER & NAV */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b pb-4">
        <div>
          <Link href="/inventory/picking" className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground mb-2">
            <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back to Pick Lists
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-foreground font-mono">
              {pickList.pickListNumber}
            </h1>
            {getStatusBadge(pickList.status)}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Sales Order: <strong className="text-foreground">{pickList.salesOrder?.salesOrderNumber}</strong> | Customer:{" "}
            <strong className="text-foreground">{pickList.salesOrder?.customer?.name}</strong> | Warehouse:{" "}
            <strong className="text-foreground">{pickList.warehouse?.name}</strong>
          </p>
        </div>

        {/* TOP ACTIONS */}
        <div className="flex flex-wrap items-center gap-2">
          {!isReadOnly && pickList.status !== "IN_PROGRESS" && canStart && (
            <Button onClick={() => startMutation.mutate()} disabled={startMutation.isPending} variant="outline">
              {startMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Start Picking
            </Button>
          )}

          {!isReadOnly && canUpdate && (
            <>
              <Button
                onClick={() => suggestionsMutation.mutate()}
                disabled={suggestionsMutation.isPending}
                variant="secondary"
                className="bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:text-indigo-300"
              >
                {suggestionsMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4 text-indigo-500" />}
                Auto-Suggest Bins
              </Button>
              <Button onClick={() => saveAllocationsMutation.mutate()} disabled={saveAllocationsMutation.isPending} className="bg-sky-600 hover:bg-sky-700 text-white">
                {saveAllocationsMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save Allocations
              </Button>
            </>
          )}

          {!isReadOnly && canComplete && (
            <Button onClick={handleAttemptComplete} disabled={completeMutation.isPending} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              {completeMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Complete Pick List
            </Button>
          )}

          {isCompleted && (
            <Button
              onClick={() => setIsDispatchModalOpen(true)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shadow-sm gap-1.5"
            >
              <Truck className="h-4 w-4" /> Create Dispatch Record
            </Button>
          )}

          {!isReadOnly && canCancel && (
            <Button onClick={() => setIsCancelModalOpen(true)} variant="outline" className="text-rose-600 hover:bg-rose-50">
              <XCircle className="mr-2 h-4 w-4" /> Cancel Pick List
            </Button>
          )}
        </div>
      </div>

      {/* MESSAGES */}
      {errorMessage && (
        <div className="flex items-center gap-2 rounded-md bg-destructive/15 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{errorMessage}</span>
          <button className="ml-auto text-xs underline" onClick={() => setErrorMessage(null)}>Dismiss</button>
        </div>
      )}
      {successMessage && (
        <div className="flex items-center gap-2 rounded-md bg-emerald-500/15 p-3 text-sm text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{successMessage}</span>
          <button className="ml-auto text-xs underline" onClick={() => setSuccessMessage(null)}>Dismiss</button>
        </div>
      )}

      {/* ISOLATION NOTICE */}
      <div className="rounded-lg bg-sky-500/10 border border-sky-500/20 p-4 text-xs text-sky-800 dark:text-sky-300 flex items-start gap-3">
        <FileText className="h-5 w-5 text-sky-600 shrink-0 mt-0.5" />
        <div>
          <h4 className="font-semibold text-sm">Phase 5C Physical Stock Isolation Policy</h4>
          <p className="mt-0.5">
            Picking assigns physical warehouse bins to fulfill this reservation. Bin selection and picking completion <strong>DO NOT deduct physical stock</strong> or generate Stock Movements. Physical inventory deduction occurs strictly in Phase 5D Dispatch.
          </p>
        </div>
      </div>

      {/* LINE ITEMS AND BIN SELECTION */}
      <div className="space-y-6">
        <h2 className="text-lg font-bold text-foreground">Pick List Line Items & Bin Allocations</h2>

        {pickList.items.map((item: any) => {
          const productBins = availabilityData?.[item.productId] || [];
          const currentItemAllocMap = allocationsInput[item.id] || {};
          const currentTotalPicked = Object.values(currentItemAllocMap).reduce((sum, v) => sum + (Number(v) || 0), 0);

          return (
            <Card key={item.id} className="border-border/60 shadow-sm overflow-hidden">
              <CardHeader className="bg-muted/20 pb-3 border-b">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="font-bold text-foreground text-base">
                      {item.product?.name}{" "}
                      <span className="text-xs font-mono font-normal text-muted-foreground">({item.product?.sku})</span>
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Requested: <strong className="text-foreground">{item.requestedQuantity} {item.unitSymbol || "units"}</strong> | Picked:{" "}
                      <strong className="text-emerald-600 font-semibold">{currentTotalPicked}</strong> | Remaining:{" "}
                      <strong className="text-amber-600 font-semibold">{Math.max(0, item.requestedQuantity - currentTotalPicked)}</strong>
                    </p>
                  </div>
                  <Badge variant={item.status === "PICKED" ? "default" : item.status === "SHORT" ? "destructive" : "secondary"}>
                    {item.status}
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="p-4 space-y-4">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-sky-500" /> Physical Warehouse Bins Available for Pick
                </h4>

                {isLoadingAvailability ? (
                  <div className="text-xs text-muted-foreground py-2 flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading physical bin availability...
                  </div>
                ) : productBins.length === 0 ? (
                  <div className="rounded-md bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                    No active bins with physical stock found for this product in {pickList.warehouse?.name}.
                  </div>
                ) : (
                  <div className="divide-y rounded-md border text-xs">
                    <div className="grid grid-cols-12 bg-muted/40 p-2 font-semibold text-muted-foreground">
                      <div className="col-span-5">Bin Location Path</div>
                      <div className="col-span-2 text-center">Physical Bin Qty</div>
                      <div className="col-span-2 text-center">Other Committed</div>
                      <div className="col-span-2 text-center">Pickable Stock</div>
                      <div className="col-span-1 text-right">Picked Qty</div>
                    </div>

                    {productBins.map((binAvail: any) => {
                      const currentVal = currentItemAllocMap[binAvail.binId] ?? 0;

                      return (
                        <div key={binAvail.binId} className="grid grid-cols-12 p-2.5 items-center hover:bg-muted/10">
                          <div className="col-span-5 font-mono text-xs font-medium text-foreground">
                            {binAvail.locationPath}
                          </div>
                          <div className="col-span-2 text-center text-muted-foreground">
                            {binAvail.physicalStock}
                          </div>
                          <div className="col-span-2 text-center text-muted-foreground/70">
                            {binAvail.alreadyCommittedToOtherActivePicks}
                          </div>
                          <div className="col-span-2 text-center font-semibold text-emerald-600">
                            {binAvail.pickableStock}
                          </div>
                          <div className="col-span-1 text-right">
                            {isReadOnly ? (
                              <span className="font-mono font-bold">{currentVal}</span>
                            ) : (
                              <Input
                                type="number"
                                min="0"
                                step="any"
                                max={binAvail.pickableStock + currentVal}
                                value={currentVal || ""}
                                onChange={(e) => handleQtyChange(item.id, binAvail.binId, e.target.value)}
                                className="h-8 text-xs text-right font-mono font-bold"
                              />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* SHORT PICK CONFIRMATION MODAL */}
      <Dialog open={isShortModalOpen} onOpenChange={setIsShortModalOpen}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="h-5 w-5" /> Confirm Short Pick Completion
            </DialogTitle>
            <DialogDescription className="pt-2">
              Some line items have not been fully picked. Completing this Pick List will mark unfulfilled quantities as <strong>SHORT</strong>.
              <br /><br />
              The unpicked portion will remain reserved on the Stock Reservation for future pick lists or release.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="pt-4">
            <Button variant="outline" onClick={() => setIsShortModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => completeMutation.mutate(true)}
              disabled={completeMutation.isPending}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {completeMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Approve & Complete Short Pick
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CANCEL MODAL */}
      <Dialog open={isCancelModalOpen} onOpenChange={setIsCancelModalOpen}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle className="text-rose-600">Cancel Pick List</DialogTitle>
            <DialogDescription>
              Cancelling releases all bin pick allocations. Reservation and physical stock remain unchanged.
            </DialogDescription>
          </DialogHeader>
          <div className="py-3">
            <label className="text-xs font-medium text-foreground mb-1 block">Reason for cancellation</label>
            <Input
              placeholder="e.g. Picker unavailable, customer requested delay..."
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCancelModalOpen(false)}>
              Back
            </Button>
            <Button
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
              className="bg-rose-600 hover:bg-rose-700 text-white"
            >
              {cancelMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Confirm Cancellation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CREATE DISPATCH MODAL */}
      {pickList && (
        <CreateDispatchModal
          isOpen={isDispatchModalOpen}
          onClose={() => setIsDispatchModalOpen(false)}
          pickList={{
            id: pickList.id,
            pickListNumber: pickList.pickListNumber,
            salesOrderNumber: pickList.salesOrder?.salesOrderNumber || "—",
            warehouseName: pickList.warehouse?.name || "—",
          }}
        />
      )}
    </div>
  );
}
