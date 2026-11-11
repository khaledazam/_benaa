"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, ArrowLeft, CheckCircle2, Clock, XCircle, AlertTriangle, Lock, RotateCcw } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useAuth } from "@/contexts";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";

export default function ReservationDetailView({ reservationId }: { reservationId: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userRole = user?.role || "VIEWER";

  const [releaseModalOpen, setReleaseModalOpen] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  // Fetch Reservation
  const { data: reservation, isLoading, error } = useQuery({
    queryKey: ["reservation-detail", reservationId],
    queryFn: async () => {
      const res = await fetch(`/api/reservations/${reservationId}`);
      if (!res.ok) throw new Error("Failed to fetch reservation");
      return res.json();
    },
  });

  // Release Mutation
  const releaseMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/reservations/${reservationId}/release`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Manual reservation release" }),
      });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "Failed to release reservation");
      return resData;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reservation-detail", reservationId] });
      setReleaseModalOpen(false);
    },
    onError: (err: any) => setActionError(err.message),
  });

  // Cancel Mutation
  const cancelMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/reservations/${reservationId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: cancelReason }),
      });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "Failed to cancel reservation");
      return resData;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reservation-detail", reservationId] });
      setCancelModalOpen(false);
    },
    onError: (err: any) => setActionError(err.message),
  });

  if (isLoading) return <div className="p-8 text-center text-xs text-muted-foreground">Loading reservation details...</div>;
  if (error || !reservation) return <div className="p-8 text-center text-xs text-destructive">Failed to load reservation.</div>;

  const canRelease = hasPermission(user, BuildStockPermissions.RESERVATION_RELEASE) && ["ACTIVE", "PARTIALLY_FULFILLED"].includes(reservation.status);
  const canCancel = hasPermission(user, BuildStockPermissions.RESERVATION_CANCEL) && ["ACTIVE", "PARTIALLY_FULFILLED"].includes(reservation.status);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "ACTIVE":
        return <Badge className="bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300">ACTIVE</Badge>;
      case "PARTIALLY_FULFILLED":
        return <Badge className="bg-indigo-100 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300">PARTIALLY FULFILLED</Badge>;
      case "FULFILLED":
        return <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">FULFILLED</Badge>;
      case "RELEASED":
        return <Badge variant="outline" className="border-amber-400 text-amber-800 dark:text-amber-300">RELEASED</Badge>;
      case "CANCELLED":
        return <Badge variant="secondary">CANCELLED</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 p-6">
      {/* HEADER */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" asChild>
            <Link href="/inventory/reservations">
              <ArrowLeft className="h-4 w-4" /> Back to Reservations
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight font-mono text-foreground">{reservation.reservationNumber}</h1>
              {getStatusBadge(reservation.status)}
            </div>
            <p className="text-xs text-muted-foreground">Reserved on {new Date(reservation.createdAt).toLocaleDateString()}</p>
          </div>
        </div>

        {/* ACTION BUTTONS */}
        <div className="flex flex-wrap gap-2">
          {canRelease && (
            <Button size="sm" onClick={() => setReleaseModalOpen(true)} className="gap-1 text-xs bg-sky-600 hover:bg-sky-700 text-white">
              <RotateCcw className="h-4 w-4" /> Release Reservation
            </Button>
          )}

          {canCancel && (
            <Button size="sm" variant="outline" onClick={() => setCancelModalOpen(true)} className="gap-1 text-xs text-rose-600 border-rose-200 hover:bg-rose-50 dark:hover:bg-rose-950/30">
              <XCircle className="h-4 w-4" /> Cancel Reservation
            </Button>
          )}
        </div>
      </div>

      {actionError && (
        <div className="p-3 border border-destructive bg-destructive/10 text-destructive text-xs rounded-md">
          {actionError}
        </div>
      )}

      {["RELEASED", "CANCELLED", "FULFILLED"].includes(reservation.status) && (
        <div className="p-3 border border-muted bg-muted/40 rounded-md text-xs flex items-center gap-2 text-muted-foreground">
          <Lock className="h-4 w-4 text-sky-600" />
          <span>This Reservation is in <strong>{reservation.status}</strong> status and is <strong>READ-ONLY</strong>.</span>
        </div>
      )}

      {/* METADATA GRID */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Associated Sales Order</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <p className="text-sm font-bold font-mono text-foreground">
              <Link href={`/sales/${reservation.salesOrderId}`} className="text-sky-600 hover:underline">
                {reservation.salesOrder?.salesOrderNumber}
              </Link>
            </p>
            <p><span className="text-muted-foreground">Customer:</span> <strong className="font-semibold">{reservation.salesOrder?.customerNameSnapshot || reservation.salesOrder?.customer?.name}</strong></p>
            <p><span className="text-muted-foreground">Customer Code:</span> <span className="font-mono">{reservation.salesOrder?.customerCodeSnapshot}</span></p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Warehouse Facility</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <p className="text-sm font-bold text-foreground">{reservation.warehouse?.name}</p>
            <p><span className="text-muted-foreground">Facility Code:</span> <span className="font-mono">{reservation.warehouse?.code || "MAIN"}</span></p>
            {reservation.releasedAt && <p className="text-amber-600 font-medium">Released on {new Date(reservation.releasedAt).toLocaleDateString()}</p>}
            {reservation.cancellationReason && <p className="text-rose-600">Cancellation Reason: {reservation.cancellationReason}</p>}
          </CardContent>
        </Card>
      </div>

      {/* ITEMS BREAKDOWN TABLE */}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base font-semibold">Reserved Line Items ({reservation.items?.length || 0})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Product Name</TableHead>
                <TableHead className="text-xs">SKU</TableHead>
                <TableHead className="text-xs">Requested Qty</TableHead>
                <TableHead className="text-xs">Reserved Qty</TableHead>
                <TableHead className="text-xs">Released Qty</TableHead>
                <TableHead className="text-xs text-right">Remaining Reserved</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reservation.items?.map((item: any) => (
                <TableRow key={item.id}>
                  <TableCell className="text-xs font-medium">{item.product?.name || item.productName}</TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">{item.product?.sku || "—"}</TableCell>
                  <TableCell className="text-xs font-mono">{item.requestedQuantity} {item.unitSymbol || ""}</TableCell>
                  <TableCell className="text-xs font-mono font-semibold">{item.reservedQuantity} {item.unitSymbol || ""}</TableCell>
                  <TableCell className="text-xs font-mono text-amber-600">{item.releasedQuantity} {item.unitSymbol || ""}</TableCell>
                  <TableCell className="text-xs font-mono font-bold text-sky-600 text-right">{item.remainingQuantity} {item.unitSymbol || ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* RELEASE MODAL */}
      <Dialog open={releaseModalOpen} onOpenChange={setReleaseModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">Release Stock Reservation?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-xs text-muted-foreground">
              Releasing reservation <strong className="text-foreground">{reservation.reservationNumber}</strong> will restore available inventory for other orders.
            </p>
            <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 rounded text-[11px] text-amber-800 dark:text-amber-300">
              Note: Releasing stock reservation leaves physical warehouse stock <strong>100% UNCHANGED</strong>.
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setReleaseModalOpen(false)}>Cancel</Button>
            <Button size="sm" disabled={releaseMutation.isPending} onClick={() => releaseMutation.mutate()} className="bg-sky-600 text-white">
              {releaseMutation.isPending ? "Releasing..." : "Confirm Full Release"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CANCEL MODAL */}
      <Dialog open={cancelModalOpen} onOpenChange={setCancelModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">Cancel Stock Reservation?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-xs text-muted-foreground">Are you sure you want to cancel reservation {reservation.reservationNumber}?</p>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Cancellation Reason (Optional)</Label>
              <Input
                placeholder="e.g. Sales Order amended"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="text-xs"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setCancelModalOpen(false)}>Back</Button>
            <Button variant="destructive" size="sm" disabled={cancelMutation.isPending} onClick={() => cancelMutation.mutate()}>
              {cancelMutation.isPending ? "Cancelling..." : "Confirm Cancellation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
