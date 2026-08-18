"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Truck,
  ArrowLeft,
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle,
  Building2,
  FileText,
  UserCheck,
  Calendar,
  Layers,
  MapPin,
  ShieldCheck,
  Boxes,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

interface DispatchDetailViewProps {
  dispatchId: string;
}

export function DispatchDetailView({ dispatchId }: DispatchDetailViewProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [dispatch, setDispatch] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const [showPostModal, setShowPostModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const fetchDispatchData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/dispatches/${dispatchId}`);
      if (res.ok) {
        const data = await res.json();
        setDispatch(data);

        if (data.status === "DRAFT") {
          const prevRes = await fetch(`/api/dispatches/${dispatchId}/preview`);
          if (prevRes.ok) {
            const prevData = await prevRes.json();
            setPreview(prevData);
          }
        }
      }
    } catch (err) {
      console.error("Failed to load dispatch detail:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDispatchData();
  }, [dispatchId]);

  const handlePostDispatch = async () => {
    setPosting(true);
    try {
      const res = await fetch(`/api/dispatches/${dispatchId}/post`, {
        method: "POST",
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to post dispatch");

      toast({ title: "Dispatch Posted", description: `Dispatch ${data.dispatchNumber} posted successfully! Physical stock deducted.` });
      setShowPostModal(false);
      fetchDispatchData();
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to post dispatch", variant: "destructive" });
    } finally {
      setPosting(false);
    }
  };

  const handleCancelDispatch = async () => {
    if (!cancelReason.trim()) {
      toast({ title: "Error", description: "Please enter a cancellation reason", variant: "destructive" });
      return;
    }
    setCancelling(true);
    try {
      const res = await fetch(`/api/dispatches/${dispatchId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: cancelReason.trim() }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to cancel dispatch");

      toast({ title: "Dispatch Cancelled", description: `Dispatch ${data.dispatchNumber} cancelled.` });
      setShowCancelModal(false);
      fetchDispatchData();
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to cancel dispatch", variant: "destructive" });
    } finally {
      setCancelling(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "DRAFT":
        return (
          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300 text-sm px-3 py-1 font-medium">
            <Clock className="h-4 w-4 mr-1.5" /> DRAFT
          </Badge>
        );
      case "POSTED":
        return (
          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-300 text-sm px-3 py-1 font-medium">
            <CheckCircle2 className="h-4 w-4 mr-1.5" /> POSTED (Physical Stock Deducted)
          </Badge>
        );
      case "CANCELLED":
        return (
          <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-300 text-sm px-3 py-1 font-medium">
            <XCircle className="h-4 w-4 mr-1.5" /> CANCELLED
          </Badge>
        );
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-slate-500">
        Loading dispatch detail...
      </div>
    );
  }

  if (!dispatch) {
    return (
      <div className="p-8 text-center space-y-4">
        <div className="text-rose-600 font-semibold">Dispatch record not found</div>
        <Link href="/inventory/dispatches">
          <Button variant="outline" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to Dispatches
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 max-w-7xl mx-auto">
      {/* Top Navigation */}
      <div className="flex items-center justify-between border-b pb-4">
        <div className="flex items-center gap-3">
          <Link href="/inventory/dispatches">
            <Button variant="outline" size="sm" className="gap-1">
              <ArrowLeft className="h-4 w-4" /> Dispatches
            </Button>
          </Link>
          <div className="h-4 w-[1px] bg-slate-200" />
          <h1 className="text-xl font-bold text-slate-900 font-mono flex items-center gap-2">
            <Truck className="h-5 w-5 text-indigo-600" />
            {dispatch.dispatchNumber}
          </h1>
          {getStatusBadge(dispatch.status)}
        </div>

        {/* Action Controls for DRAFT status */}
        {dispatch.status === "DRAFT" && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowCancelModal(true)} className="text-rose-600 hover:text-rose-700">
              <XCircle className="h-4 w-4 mr-1" /> Cancel Dispatch
            </Button>
            <Button size="sm" onClick={() => setShowPostModal(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1 shadow-sm">
              <CheckCircle2 className="h-4 w-4" /> Post & Deduct Physical Stock
            </Button>
          </div>
        )}
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border shadow-sm">
          <CardHeader className="py-3 px-4">
            <CardDescription className="text-xs font-semibold uppercase tracking-wider text-slate-500">Sales Order</CardDescription>
            <CardTitle className="text-base font-mono text-indigo-600 mt-1">
              <Link href={`/sales/${dispatch.salesOrderId}`} className="hover:underline">
                {dispatch.salesOrder.salesOrderNumber}
              </Link>
            </CardTitle>
          </CardHeader>
        </Card>

        <Card className="border shadow-sm">
          <CardHeader className="py-3 px-4">
            <CardDescription className="text-xs font-semibold uppercase tracking-wider text-slate-500">Pick List</CardDescription>
            <CardTitle className="text-base font-mono text-slate-800 mt-1">
              <Link href={`/inventory/picking/${dispatch.pickListId}`} className="hover:underline">
                {dispatch.pickList.pickListNumber}
              </Link>
            </CardTitle>
          </CardHeader>
        </Card>

        <Card className="border shadow-sm">
          <CardHeader className="py-3 px-4">
            <CardDescription className="text-xs font-semibold uppercase tracking-wider text-slate-500">Warehouse</CardDescription>
            <CardTitle className="text-base font-semibold text-slate-800 mt-1 flex items-center gap-1.5">
              <Building2 className="h-4 w-4 text-slate-400" />
              {dispatch.warehouse.name}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card className="border shadow-sm">
          <CardHeader className="py-3 px-4">
            <CardDescription className="text-xs font-semibold uppercase tracking-wider text-slate-500">Customer</CardDescription>
            <CardTitle className="text-base font-semibold text-slate-800 mt-1">
              {dispatch.customerNameSnapshot || "—"}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Dispatched Items & Source Bin Allocations */}
      <Card className="border shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Boxes className="h-5 w-5 text-indigo-600" />
            Dispatched Line Items & Bin Selection
          </CardTitle>
          <CardDescription>
            Physical inventory leaving the warehouse from specific bin locations
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {dispatch.items.map((item: any) => (
              <div key={item.id} className="border rounded-xl p-4 bg-slate-50/50 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-2">
                  <div>
                    <span className="font-bold text-slate-900 text-base">{item.productName}</span>
                    {item.productSku && (
                      <span className="text-xs font-mono text-slate-500 ml-2">SKU: {item.productSku}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <div>
                      <span className="text-slate-500">Requested: </span>
                      <span className="font-semibold text-slate-800">{item.requestedQuantity} {item.unitSymbol}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Picked: </span>
                      <span className="font-semibold text-indigo-700">{item.pickedQuantity} {item.unitSymbol}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Dispatched: </span>
                      <span className="font-bold text-emerald-700">{item.dispatchedQuantity} {item.unitSymbol}</span>
                    </div>
                  </div>
                </div>

                {/* Source Bins breakdown */}
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Source Bin Allocations</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {item.binAllocations.map((alloc: any) => (
                      <div key={alloc.id} className="bg-white p-3 rounded-lg border text-xs flex justify-between items-center shadow-2xs">
                        <div className="space-y-0.5">
                          <div className="font-bold text-slate-800 flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5 text-indigo-600" />
                            Bin {alloc.bin.code}
                          </div>
                          <div className="text-slate-500 text-[11px]">{alloc.locationPath || `Bin ${alloc.bin.code}`}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-emerald-700 text-sm">
                            -{alloc.dispatchedQuantity} {item.unitSymbol || ""}
                          </div>
                          <div className="text-[10px] text-slate-400">Physical Deduction</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Stock Deduction Preview (for DRAFT) */}
      {dispatch.status === "DRAFT" && preview && (
        <Card className="border border-indigo-200 bg-indigo-50/30 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg font-bold text-indigo-900 flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-indigo-600" />
              Physical Stock Deduction Preview (Read-Only)
            </CardTitle>
            <CardDescription className="text-indigo-700">
              Preview of physical stock changes that will occur upon posting this dispatch
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {preview.previews.map((p: any) => (
              <div key={p.productId} className="bg-white rounded-lg p-3 border space-y-2 text-xs">
                <div className="flex justify-between items-center font-semibold text-slate-800">
                  <span>{p.productName}</span>
                  <span>Warehouse Stock: {p.currentWarehouseStock} → <strong className="text-emerald-700">{p.newWarehouseStock}</strong></span>
                </div>
                <div className="space-y-1 pl-2 border-l-2 border-indigo-300">
                  {p.bins.map((b: any) => (
                    <div key={b.binId} className="flex justify-between text-slate-600">
                      <span>{b.locationPath}:</span>
                      <span>Current: {b.currentBinStock} | Deduct: -{b.dispatchedQuantity} | New Bin Stock: <strong className="text-indigo-700">{b.newBinStock}</strong></span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Stock Movement Ledger Table (when POSTED) */}
      {dispatch.status === "POSTED" && dispatch.stockMovements && (
        <Card className="border shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <FileText className="h-5 w-5 text-emerald-600" />
              Generated SALE StockMovements Ledger
            </CardTitle>
            <CardDescription>
              Immutable physical inventory ledger records created by this dispatch
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead>Movement #</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Source Bin</TableHead>
                  <TableHead>Movement Type</TableHead>
                  <TableHead className="text-right">Deducted Qty</TableHead>
                  <TableHead className="text-right">Previous Stock</TableHead>
                  <TableHead className="text-right">New Stock</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dispatch.stockMovements.map((mov: any) => (
                  <TableRow key={mov.id}>
                    <TableCell className="font-mono font-medium text-slate-900">{mov.movementNumber}</TableCell>
                    <TableCell className="font-medium text-slate-800">{mov.product?.name || "Product"}</TableCell>
                    <TableCell className="font-mono text-slate-700">{mov.sourceBin?.code || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-300">
                        {mov.movementType}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-bold text-emerald-700">-{mov.quantity}</TableCell>
                    <TableCell className="text-right font-mono text-slate-600">{mov.previousStock}</TableCell>
                    <TableCell className="text-right font-mono font-bold text-slate-900">{mov.newStock}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Confirm Post Modal */}
      <Dialog open={showPostModal} onOpenChange={setShowPostModal}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-emerald-800 flex items-center gap-2">
              <AlertTriangle className="h-6 w-6 text-emerald-600" />
              Confirm Post & Deduct Physical Stock
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2 text-sm text-slate-700">
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 font-medium">
              Posting this dispatch will <strong>permanently deduct physical warehouse stock</strong> and record SALE StockMovements.
            </div>
            <p>
              This action executes atomically inside a single database transaction. Once posted, this dispatch record and stock movements become <strong>immutable</strong>.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPostModal(false)} disabled={posting}>
              Cancel
            </Button>
            <Button onClick={handlePostDispatch} disabled={posting} className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">
              {posting ? "Posting..." : "Confirm & Deduct Stock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Modal */}
      <Dialog open={showCancelModal} onOpenChange={setShowCancelModal}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-rose-800 flex items-center gap-2">
              <XCircle className="h-5 w-5 text-rose-600" />
              Cancel Draft Dispatch
            </DialogTitle>
            <DialogDescription>
              Cancel this draft dispatch record. No physical stock will be mutated.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <Label htmlFor="reason">Cancellation Reason</Label>
            <Textarea
              id="reason"
              placeholder="Enter reason for cancelling this draft dispatch..."
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCancelModal(false)} disabled={cancelling}>
              Back
            </Button>
            <Button onClick={handleCancelDispatch} disabled={cancelling} className="bg-rose-600 hover:bg-rose-700 text-white">
              {cancelling ? "Cancelling..." : "Confirm Cancellation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
