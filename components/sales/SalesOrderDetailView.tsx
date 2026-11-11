"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Receipt, ArrowLeft, CheckCircle2, Clock, XCircle, AlertTriangle, FileText, Lock, Play, Check, ClipboardCheck } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useAuth } from "@/contexts";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";

export default function SalesOrderDetailView({ salesOrderId }: { salesOrderId: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userRole = user?.role || "VIEWER";

  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const [invoiceDueDate, setInvoiceDueDate] = useState("");
  const invoiceCommandKey = React.useRef<string | null>(null);
  const [issuedInvoiceId, setIssuedInvoiceId] = useState<string | null>(null);
  const invoiceMutation = useMutation({
    mutationFn: async () => {
      if (!invoiceDueDate) throw new Error("حدد تاريخ استحقاق الفاتورة صراحةً");
      invoiceCommandKey.current ??= crypto.randomUUID();
      const response = await fetch(`/api/sales-orders/${salesOrderId}/invoice`, {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": invoiceCommandKey.current },
        body: JSON.stringify({ dueDate: invoiceDueDate }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Failed to issue invoice");
      return result;
    },
    onSuccess: result => setIssuedInvoiceId(result.invoice.id),
    onError: (error: Error) => setActionError(error.message),
  });

  // Fetch Sales Order Details
  const { data: order, isLoading, error } = useQuery({
    queryKey: ["sales-order-detail", salesOrderId],
    queryFn: async () => {
      const res = await fetch(`/api/sales-orders/${salesOrderId}`);
      if (!res.ok) throw new Error("Failed to fetch sales order");
      return res.json();
    },
  });

  const { data: customerBalance } = useQuery({
    queryKey: ["erp-customer-balance", order?.customerId],
    enabled: !!order?.customerId && hasPermission(user, BuildStockPermissions.SALES_ORDER_APPROVE),
    queryFn: async () => {
      const response = await fetch(`/api/customers/${order.customerId}/balance`);
      if (!response.ok) throw new Error("تعذر تحميل رصيد العميل");
      return response.json();
    },
  });

  // Action Mutations
  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/sales-orders/${salesOrderId}/submit`, { method: "POST" });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "Failed to submit sales order");
      return resData;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sales-order-detail", salesOrderId] }),
    onError: (err: any) => setActionError(err.message),
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/sales-orders/${salesOrderId}/approve`, { method: "POST" });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "Failed to approve sales order");
      return resData;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sales-order-detail", salesOrderId] }),
    onError: (err: any) => setActionError(err.message),
  });

  const startProcessingMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/sales-orders/${salesOrderId}/start-processing`, { method: "POST" });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "Failed to start processing sales order");
      return resData;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sales-order-detail", salesOrderId] }),
    onError: (err: any) => setActionError(err.message),
  });

  const completeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/sales-orders/${salesOrderId}/complete`, { method: "POST" });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "Failed to complete sales order");
      return resData;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sales-order-detail", salesOrderId] }),
    onError: (err: any) => setActionError(err.message),
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/sales-orders/${salesOrderId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: cancelReason }),
      });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "Failed to cancel sales order");
      return resData;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales-order-detail", salesOrderId] });
      setCancelModalOpen(false);
    },
    onError: (err: any) => setActionError(err.message),
  });

  // Fetch Active Reservation for this Sales Order
  const { data: reservationData } = useQuery({
    queryKey: ["sales-order-reservation", salesOrderId],
    queryFn: async () => {
      const res = await fetch(`/api/reservations?salesOrderId=${salesOrderId}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data.items?.find((r: any) => ["ACTIVE", "PARTIALLY_FULFILLED"].includes(r.status)) || null;
    },
  });

  // Reserve Stock Mutation
  const reserveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ salesOrderId }),
      });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "Failed to reserve stock");
      return resData;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales-order-detail", salesOrderId] });
      queryClient.invalidateQueries({ queryKey: ["sales-order-reservation", salesOrderId] });
    },
    onError: (err: any) => setActionError(err.message),
  });

  if (isLoading) return <div className="p-8 text-center text-xs text-muted-foreground">Loading sales order details...</div>;
  if (error || !order) return <div className="p-8 text-center text-xs text-destructive">Failed to load sales order details.</div>;

  const canSubmit = hasPermission(user, BuildStockPermissions.SALES_ORDER_SUBMIT) && order.status === "DRAFT";
  const canApprove = hasPermission(user, BuildStockPermissions.SALES_ORDER_APPROVE) && order.status === "PENDING_APPROVAL";
  const canReserve = hasPermission(user, BuildStockPermissions.RESERVATION_CREATE) && order.status === "APPROVED" && !reservationData;
  const canProcess = hasPermission(user, BuildStockPermissions.SALES_ORDER_PROCESS) && order.status === "APPROVED";
  const canComplete = hasPermission(user, BuildStockPermissions.SALES_ORDER_COMPLETE) && order.status === "PROCESSING";
  const canCancel = hasPermission(user, BuildStockPermissions.SALES_ORDER_CANCEL) && ["DRAFT", "PENDING_APPROVAL", "APPROVED"].includes(order.status);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "DRAFT":
        return <Badge variant="outline" className="border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">DRAFT</Badge>;
      case "PENDING_APPROVAL":
        return <Badge variant="outline" className="border-sky-400 bg-sky-50 text-sky-800 dark:bg-sky-950/30 dark:text-sky-300">PENDING APPROVAL</Badge>;
      case "APPROVED":
        return <Badge className="bg-indigo-100 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300">APPROVED</Badge>;
      case "PROCESSING":
        return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300">PROCESSING</Badge>;
      case "COMPLETED":
        return <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">COMPLETED</Badge>;
      case "CANCELLED":
        return <Badge variant="secondary">CANCELLED</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 p-6">
      {order.status === "COMPLETED" && hasPermission(user, BuildStockPermissions.SALES_ORDER_APPROVE) && (
        <Card><CardHeader><CardTitle>فاتورة أمر البيع المعتمد</CardTitle></CardHeader><CardContent className="space-y-3">
          <p>فاتورة واحدة بكامل الإجمالي المعتمد، بعد اكتمال الصرف الفعلي. لا توزيع جديد للخصومات أو الضريبة.</p>
          <Label htmlFor="invoice-due-date">تاريخ الاستحقاق</Label>
          <Input id="invoice-due-date" type="date" value={invoiceDueDate} onChange={e => setInvoiceDueDate(e.target.value)} />
          <Button disabled={invoiceMutation.isPending || !invoiceDueDate} onClick={() => invoiceMutation.mutate()}>إصدار / استرجاع الفاتورة</Button>
          {issuedInvoiceId && <Link href={`/invoices/${issuedInvoiceId}`}>عرض الفاتورة والدفع</Link>}
          {customerBalance && <p>رصيد العميل المستحق ضمن المستودعات المصرّح بها: {customerBalance.amountDue.toFixed(2)}</p>}
        </CardContent></Card>
      )}

      {/* HEADER */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" asChild>
            <Link href="/sales">
              <ArrowLeft className="h-4 w-4" /> Back to Orders
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight font-mono text-foreground">{order.salesOrderNumber}</h1>
              {getStatusBadge(order.status)}
            </div>
            <p className="text-xs text-muted-foreground">Order Date: {new Date(order.createdAt).toLocaleDateString()}</p>
          </div>
        </div>

        {/* ACTION BUTTONS */}
        <div className="flex flex-wrap gap-2">
          {canSubmit && (
            <Button size="sm" onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending} className="gap-1 text-xs">
              <Clock className="h-4 w-4" /> Submit for Approval
            </Button>
          )}

          {canApprove && (
            <Button size="sm" onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending} className="gap-1 text-xs bg-indigo-600 hover:bg-indigo-700 text-white">
              <Check className="h-4 w-4" /> Approve Order
            </Button>
          )}

          {canReserve && (
            <Button size="sm" onClick={() => reserveMutation.mutate()} disabled={reserveMutation.isPending} className="gap-1 text-xs bg-sky-600 hover:bg-sky-700 text-white">
              <ClipboardCheck className="h-4 w-4" /> Reserve Stock
            </Button>
          )}

          {reservationData && (
            <Button size="sm" variant="outline" asChild className="gap-1 text-xs border-sky-400 text-sky-700 dark:text-sky-300">
              <Link href={`/inventory/reservations/${reservationData.id}`}>
                <ClipboardCheck className="h-4 w-4 text-sky-600" /> Active Reservation ({reservationData.reservationNumber})
              </Link>
            </Button>
          )}

          {canProcess && (
            <Button size="sm" onClick={() => startProcessingMutation.mutate()} disabled={startProcessingMutation.isPending} className="gap-1 text-xs bg-blue-600 hover:bg-blue-700 text-white">
              <Play className="h-4 w-4" /> Start Processing
            </Button>
          )}

          {canComplete && (
            <Button size="sm" onClick={() => completeMutation.mutate()} disabled={completeMutation.isPending} className="gap-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white">
              <CheckCircle2 className="h-4 w-4" /> Complete Order
            </Button>
          )}

          {canCancel && (
            <Button size="sm" variant="outline" onClick={() => setCancelModalOpen(true)} className="gap-1 text-xs text-rose-600 border-rose-200 hover:bg-rose-50 dark:hover:bg-rose-950/30">
              <XCircle className="h-4 w-4" /> Cancel Order
            </Button>
          )}
        </div>
      </div>

      {actionError && (
        <div className="p-3 border border-destructive bg-destructive/10 text-destructive text-xs rounded-md">
          {actionError}
        </div>
      )}

      {/* READ ONLY BANNER FOR TERMINAL / APPROVED STATES */}
      {["APPROVED", "PROCESSING", "COMPLETED", "CANCELLED"].includes(order.status) && (
        <div className="p-3 border border-muted bg-muted/40 rounded-md text-xs flex items-center gap-2 text-muted-foreground">
          <Lock className="h-4 w-4 text-sky-600" />
          <span>This Sales Order is in <strong>{order.status}</strong> status and is <strong>IMMUTABLE</strong>. Customer and line items cannot be edited.</span>
        </div>
      )}

      {/* METADATA GRID */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Customer Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <p className="text-sm font-bold text-foreground">{order.customerNameSnapshot || order.customer?.name}</p>
            <p className="font-mono text-muted-foreground">Code: {order.customerCodeSnapshot || order.customer?.customerCode}</p>
            {order.customerPhoneSnapshot && <p className="text-muted-foreground">Phone: {order.customerPhoneSnapshot}</p>}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Order & Warehouse Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <p><span className="text-muted-foreground">Fulfillment Warehouse:</span> <strong className="font-semibold">{order.warehouse?.name} ({order.warehouse?.code})</strong></p>
            <p><span className="text-muted-foreground">Requested Delivery:</span> {order.requestedDeliveryDate ? new Date(order.requestedDeliveryDate).toLocaleDateString() : "Not specified"}</p>
            {order.approvedAt && <p className="text-emerald-600 font-medium">Approved on {new Date(order.approvedAt).toLocaleDateString()}</p>}
            {order.cancellationReason && <p className="text-rose-600">Cancellation Reason: {order.cancellationReason}</p>}
          </CardContent>
        </Card>
      </div>

      {/* LINE ITEMS TABLE */}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base font-semibold">Ordered Line Items ({order.items?.length || 0})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Product Name</TableHead>
                <TableHead className="text-xs">SKU</TableHead>
                <TableHead className="text-xs">Ordered Qty</TableHead>
                <TableHead className="text-xs">Unit Price</TableHead>
                <TableHead className="text-xs">Discount</TableHead>
                <TableHead className="text-xs">Tax</TableHead>
                <TableHead className="text-xs text-right">Line Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.items?.map((item: any) => (
                <TableRow key={item.id}>
                  <TableCell className="text-xs font-medium">{item.productName}</TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">{item.productSku || "—"}</TableCell>
                  <TableCell className="text-xs font-mono font-semibold">{item.orderedQuantity} {item.unitSymbol || ""}</TableCell>
                  <TableCell className="text-xs font-mono">${item.unitPrice.toFixed(2)}</TableCell>
                  <TableCell className="text-xs font-mono">${(item.discount || 0).toFixed(2)}</TableCell>
                  <TableCell className="text-xs font-mono">${(item.tax || 0).toFixed(2)}</TableCell>
                  <TableCell className="text-xs font-mono font-bold text-right">${item.lineTotal.toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* FINANCIAL SUMMARY */}
          <div className="p-4 border-t bg-muted/20 space-y-1 text-right font-mono text-xs">
            <p><span className="text-muted-foreground">Subtotal:</span> ${order.subtotal?.toFixed(2)}</p>
            <p><span className="text-muted-foreground">Discount:</span> -${(order.discount || 0).toFixed(2)}</p>
            <p><span className="text-muted-foreground">Tax:</span> +${(order.tax || 0).toFixed(2)}</p>
            <p className="text-base font-bold text-foreground pt-1 border-t mt-1">Total Order Value: ${order.total?.toFixed(2)}</p>
          </div>
        </CardContent>
      </Card>

      {/* CANCEL MODAL */}
      <Dialog open={cancelModalOpen} onOpenChange={setCancelModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">Cancel Sales Order {order.salesOrderNumber}?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-xs text-muted-foreground">Are you sure you want to cancel this order? This action is permanent.</p>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Cancellation Reason (Optional)</Label>
              <Input
                placeholder="e.g. Customer requested cancellation"
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
