"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, Plus, CheckCircle2, AlertTriangle, FileText, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useAuth } from "@/contexts";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";

export default function GoodsReceiptsView() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userRole = user?.role || "VIEWER";

  const canCreate = hasPermission(user, BuildStockPermissions.GOODS_RECEIPT_CREATE);
  const canPost = hasPermission(user, BuildStockPermissions.GOODS_RECEIPT_POST);

  const [statusTab, setStatusTab] = useState<string>("ALL");
  const [selectedGRN, setSelectedGRN] = useState<any>(null);
  const [showPostConfirm, setShowPostConfirm] = useState(false);

  // Fetch Goods Receipts
  const { data: grns, isLoading } = useQuery({
    queryKey: ["goods-receipts-list", statusTab],
    queryFn: async () => {
      const url = statusTab !== "ALL" ? `/api/goods-receipts?status=${statusTab}` : "/api/goods-receipts";
      const res = await fetch(url);
      if (!res.ok) return [];
      const json = await res.json();
      return Array.isArray(json) ? json : (json.data || []);
    },
  });

  // Post GRN Mutation
  const postMutation = useMutation({
    mutationFn: async (grnId: string) => {
      const res = await fetch(`/api/goods-receipts/${grnId}/post`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to post Goods Receipt");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["goods-receipts-list"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-locations-list"] });
      setSelectedGRN(null);
      setShowPostConfirm(false);
    },
    onError: (err: any) => alert(err.message),
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <ClipboardCheck className="h-6 w-6 text-sky-600" /> Goods Receipts (GRN)
          </h1>
          <p className="text-sm text-muted-foreground">
            Warehouse receiving operations. DRAFT receipts do NOT alter stock; POSTING updates physical bin inventory.
          </p>
        </div>
      </div>

      {/* STATUS TABS */}
      <div className="flex gap-2 border-b pb-2">
        {["ALL", "DRAFT", "POSTED"].map((status) => (
          <Button
            key={status}
            variant={statusTab === status ? "default" : "outline"}
            size="sm"
            onClick={() => setStatusTab(status)}
            className="text-xs"
          >
            {status}
          </Button>
        ))}
      </div>

      {/* GOODS RECEIPTS TABLE */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Receipt Documents</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center text-xs text-muted-foreground">Loading goods receipts...</div>
          ) : !grns || grns.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              No goods receipts found in status {statusTab}.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">GRN Number</TableHead>
                  <TableHead className="text-xs">PO Reference</TableHead>
                  <TableHead className="text-xs">Warehouse</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs text-right">Items</TableHead>
                  <TableHead className="text-xs text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {grns.map((grn: any) => (
                  <TableRow key={grn.id}>
                    <TableCell className="text-xs font-mono font-bold text-sky-600">{grn.receiptNumber}</TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">
                      {grn.purchaseOrder?.purchaseOrderNumber || grn.purchaseOrderId}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{grn.warehouse?.name || "Warehouse"}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`text-[10px] uppercase font-mono ${
                          grn.status === "POSTED"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                            : "bg-amber-50 text-amber-700 border-amber-300"
                        }`}
                      >
                        {grn.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-right font-mono">{grn.items?.length || 0}</TableCell>
                    <TableCell className="text-xs text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-sky-600"
                        onClick={() => setSelectedGRN(grn)}
                      >
                        {grn.status === "POSTED" ? "View (Read-Only)" : "Review & Post"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* GRN INSPECT & POST DIALOG */}
      <Dialog open={!!selectedGRN} onOpenChange={() => setSelectedGRN(null)}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Goods Receipt: {selectedGRN?.receiptNumber}
              {selectedGRN?.status === "POSTED" && <Lock className="h-4 w-4 text-emerald-600" />}
            </DialogTitle>
          </DialogHeader>
          {selectedGRN && (
            <div className="space-y-4 py-2 text-xs">
              <div className="grid grid-cols-2 gap-2 bg-muted p-3 rounded">
                <div>
                  <span className="text-muted-foreground">PO Reference: </span>
                  <span className="font-mono font-semibold">{selectedGRN.purchaseOrder?.purchaseOrderNumber}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Status: </span>
                  <Badge variant="outline" className="text-[10px]">{selectedGRN.status}</Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">Received Date: </span>
                  <span>{new Date(selectedGRN.receivedAt).toLocaleString()}</span>
                </div>
                {selectedGRN.postedAt && (
                  <div>
                    <span className="text-muted-foreground">Posted At: </span>
                    <span className="text-emerald-700 font-semibold">{new Date(selectedGRN.postedAt).toLocaleString()}</span>
                  </div>
                )}
              </div>

              {selectedGRN.status === "DRAFT" && (
                <div className="p-3 border border-amber-400 bg-amber-50 dark:bg-amber-950/20 text-amber-900 dark:text-amber-100 rounded-md text-xs">
                  <div className="font-bold flex items-center gap-1"><AlertTriangle className="h-4 w-4 text-amber-600" /> Draft Document</div>
                  <div>This Goods Receipt is currently in DRAFT status. Stock has NOT been updated yet.</div>
                </div>
              )}

              <div>
                <p className="font-semibold mb-2">Received Line Items ({selectedGRN.items?.length || 0})</p>
                <div className="space-y-1">
                  {selectedGRN.items?.map((item: any) => (
                    <div key={item.id} className="p-2 border rounded flex justify-between items-center">
                      <div>
                        <p className="font-medium">{item.product?.name || item.productId}</p>
                        <p className="text-[10px] font-mono text-muted-foreground">
                          Qty: {item.receivedQuantity} | Bin: {item.destinationBinId || "Unassigned Warehouse Stock"}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {showPostConfirm && (
                <div className="p-3 border border-destructive bg-destructive/10 text-destructive rounded-md text-xs">
                  <div className="font-bold flex items-center gap-1"><AlertTriangle className="h-4 w-4" /> Post Confirmation Warning</div>
                  <div>Posting this receipt will permanently update warehouse inventory and physical bin allocations. This action cannot be undone.</div>
                </div>
              )}

              <DialogFooter className="gap-2">
                {selectedGRN.status === "DRAFT" && canPost && (
                  !showPostConfirm ? (
                    <Button
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-700 text-xs"
                      onClick={() => setShowPostConfirm(true)}
                    >
                      Post Goods Receipt
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      className="bg-destructive hover:bg-destructive/90 text-xs"
                      onClick={() => postMutation.mutate(selectedGRN.id)}
                      disabled={postMutation.isPending}
                    >
                      {postMutation.isPending ? "Posting Stock..." : "Confirm & Post Now"}
                    </Button>
                  )
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelectedGRN(null);
                    setShowPostConfirm(false);
                  }}
                >
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
