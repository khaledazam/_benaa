"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ShoppingCart, Search, Plus, CheckCircle2, Clock, XCircle, FileText, Package } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useAuth } from "@/contexts";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";

export default function PurchaseOrdersView() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userRole = user?.role || "VIEWER";

  const canCreate = hasPermission(user, BuildStockPermissions.PURCHASE_ORDER_CREATE);
  const canApprove = hasPermission(user, BuildStockPermissions.PURCHASE_ORDER_APPROVE);

  const [statusTab, setStatusTab] = useState<string>("ALL");
  const [selectedPO, setSelectedPO] = useState<any>(null);

  // Fetch Purchase Orders
  const { data: pos, isLoading } = useQuery({
    queryKey: ["purchase-orders-list", statusTab],
    queryFn: async () => {
      const url = statusTab !== "ALL" ? `/api/purchase-orders?status=${statusTab}` : "/api/purchase-orders";
      const res = await fetch(url);
      if (!res.ok) return [];
      const json = await res.json();
      return Array.isArray(json) ? json : (json.data || []);
    },
  });

  // Approve PO Mutation
  const approveMutation = useMutation({
    mutationFn: async (poId: string) => {
      const res = await fetch(`/api/purchase-orders/${poId}/approve`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to approve PO");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders-list"] });
      setSelectedPO(null);
    },
    onError: (err: any) => alert(err.message),
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <ShoppingCart className="h-6 w-6 text-sky-600" /> Purchase Orders
          </h1>
          <p className="text-sm text-muted-foreground">
            Procurement lifecycle: Draft → Pending Approval → Approved → Receiving → Close.
          </p>
        </div>
      </div>

      {/* STATUS TABS */}
      <div className="flex flex-wrap gap-2 border-b pb-2">
        {["ALL", "DRAFT", "PENDING_APPROVAL", "APPROVED", "PARTIALLY_RECEIVED", "FULLY_RECEIVED", "CANCELLED"].map(
          (status) => (
            <Button
              key={status}
              variant={statusTab === status ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusTab(status)}
              className="text-xs"
            >
              {status.replace(/_/g, " ")}
            </Button>
          )
        )}
      </div>

      {/* ORDERS TABLE */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Purchase Orders</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center text-xs text-muted-foreground">Loading purchase orders...</div>
          ) : !pos || pos.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              No purchase orders found in status {statusTab}.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">PO Number</TableHead>
                  <TableHead className="text-xs">Supplier</TableHead>
                  <TableHead className="text-xs">Warehouse</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs text-right">Items</TableHead>
                  <TableHead className="text-xs text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pos.map((po: any) => (
                  <TableRow key={po.id}>
                    <TableCell className="text-xs font-mono font-bold text-sky-600">{po.purchaseOrderNumber}</TableCell>
                    <TableCell className="text-xs font-medium">{po.supplier?.name || "Supplier"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{po.warehouse?.name || "Warehouse"}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`text-[10px] uppercase font-mono ${
                          po.status === "APPROVED"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                            : po.status === "PENDING_APPROVAL"
                            ? "bg-amber-50 text-amber-700 border-amber-300"
                            : po.status === "PARTIALLY_RECEIVED"
                            ? "bg-sky-50 text-sky-700 border-sky-300"
                            : "bg-gray-50 text-gray-700"
                        }`}
                      >
                        {po.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-right font-mono">{po.items?.length || 0}</TableCell>
                    <TableCell className="text-xs text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-sky-600"
                        onClick={() => setSelectedPO(po)}
                      >
                        Inspect
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* PO INSPECT DIALOG */}
      <Dialog open={!!selectedPO} onOpenChange={() => setSelectedPO(null)}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Purchase Order: {selectedPO?.purchaseOrderNumber}</DialogTitle>
          </DialogHeader>
          {selectedPO && (
            <div className="space-y-4 py-2 text-xs">
              <div className="grid grid-cols-2 gap-2 bg-muted p-3 rounded">
                <div>
                  <span className="text-muted-foreground">Supplier: </span>
                  <span className="font-semibold">{selectedPO.supplier?.name}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Warehouse: </span>
                  <span className="font-semibold">{selectedPO.warehouse?.name}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Status: </span>
                  <Badge variant="outline" className="text-[10px]">{selectedPO.status}</Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">Order Date: </span>
                  <span>{new Date(selectedPO.orderDate).toLocaleDateString()}</span>
                </div>
              </div>

              <div>
                <p className="font-semibold mb-2">Order Items ({selectedPO.items?.length || 0})</p>
                <div className="space-y-1">
                  {selectedPO.items?.map((item: any) => (
                    <div key={item.id} className="p-2 border rounded flex justify-between items-center">
                      <div>
                        <p className="font-medium">{item.productName || item.productId}</p>
                        <p className="text-[10px] text-muted-foreground">
                          Ordered: {item.orderedQuantity} | Received: {item.receivedQuantity} | Remaining: {item.remainingQuantity}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <DialogFooter className="gap-2">
                {canApprove && (selectedPO.status === "PENDING_APPROVAL" || selectedPO.status === "DRAFT") && (
                  <Button
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700 text-xs"
                    onClick={() => approveMutation.mutate(selectedPO.id)}
                    disabled={approveMutation.isPending}
                  >
                    {approveMutation.isPending ? "Approving..." : "Approve Purchase Order"}
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => setSelectedPO(null)}>
                  Close
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
