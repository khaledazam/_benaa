"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { History, Search, Filter, ArrowLeftRight, Package } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function StockMovementsView() {
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");

  const { data: movements, isLoading } = useQuery({
    queryKey: ["stock-movements-ledger", typeFilter],
    queryFn: async () => {
      const url = typeFilter !== "ALL" ? `/api/inventory/movements?type=${typeFilter}` : "/api/inventory/movements";
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : (data.data || []);
    },
  });

  const filteredMovements = (movements || []).filter((mov: any) => {
    const term = searchTerm.toLowerCase();
    const movNum = mov.movementNumber?.toLowerCase() || "";
    const prodName = mov.product?.name?.toLowerCase() || "";
    const sku = mov.product?.sku?.toLowerCase() || "";
    const type = mov.movementType?.toLowerCase() || "";
    return movNum.includes(term) || prodName.includes(term) || sku.includes(term) || type.includes(term);
  });

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <History className="h-6 w-6 text-sky-600" /> Stock Movement Audit Ledger
        </h1>
        <p className="text-sm text-muted-foreground">
          Immutable history of all inventory transactions, receiving, transfers, adjustments, and bin relocations.
        </p>
      </div>

      {/* SEARCH & TYPE FILTER */}
      <Card className="shadow-sm">
        <CardContent className="p-4 flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by Movement #, Product Name, SKU..."
              className="pl-9 text-xs"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="w-full md:w-56">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-xs shadow-sm focus:outline-none"
            >
              <option value="ALL">All Movement Types</option>
              <option value="PURCHASE">PURCHASE</option>
              <option value="RELOCATION">RELOCATION</option>
              <option value="TRANSFER_IN">TRANSFER_IN</option>
              <option value="TRANSFER_OUT">TRANSFER_OUT</option>
              <option value="SALE">SALE</option>
              <option value="ADJUSTMENT_IN">ADJUSTMENT_IN</option>
              <option value="ADJUSTMENT_OUT">ADJUSTMENT_OUT</option>
              <option value="OPENING_BALANCE">OPENING_BALANCE</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* LEDGER TABLE */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Ledger Entries</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center text-xs text-muted-foreground">Loading movement ledger...</div>
          ) : filteredMovements.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              No stock movement records found matching criteria.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Movement # & Date</TableHead>
                  <TableHead className="text-xs">Type</TableHead>
                  <TableHead className="text-xs">Product & SKU</TableHead>
                  <TableHead className="text-xs text-right">Quantity</TableHead>
                  <TableHead className="text-xs text-right">Previous → New Stock</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMovements.map((mov: any) => (
                  <TableRow key={mov.id}>
                    <TableCell>
                      <div>
                        <p className="text-xs font-mono font-bold text-sky-600">{mov.movementNumber}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {new Date(mov.createdAt).toLocaleString()}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`text-[10px] uppercase font-mono ${
                          mov.movementType === "PURCHASE"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                            : mov.movementType === "RELOCATION"
                            ? "bg-sky-50 text-sky-700 border-sky-300"
                            : mov.movementType === "TRANSFER_IN" || mov.movementType === "TRANSFER_OUT"
                            ? "bg-purple-50 text-purple-700 border-purple-300"
                            : "bg-gray-50 text-gray-700"
                        }`}
                      >
                        {mov.movementType}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="text-xs font-medium">{mov.product?.name || mov.productId}</p>
                        <p className="text-[10px] font-mono text-muted-foreground">SKU: {mov.product?.sku}</p>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-right font-mono font-bold">
                      {mov.quantity}
                    </TableCell>
                    <TableCell className="text-xs text-right font-mono">
                      <span className="text-muted-foreground">{mov.previousStock}</span>
                      <span className="mx-1">→</span>
                      <span className="font-semibold text-foreground">{mov.newStock}</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
