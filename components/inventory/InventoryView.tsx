"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Package, Search, Filter, Warehouse, MapPin, AlertCircle, ArrowLeftRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import Link from "next/link";

export default function InventoryView() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>("ALL");

  // Fetch Warehouses
  const { data: warehouses } = useQuery({
    queryKey: ["inventory-warehouses-filter"],
    queryFn: async () => {
      const res = await fetch("/api/warehouses");
      if (!res.ok) return [];
      return res.json();
    },
  });

  // Fetch Products & Inventory Allocations
  const { data: inventoryData, isLoading } = useQuery({
    queryKey: ["inventory-locations-list", selectedWarehouse],
    queryFn: async () => {
      const url = selectedWarehouse !== "ALL"
        ? `/api/inventory/locations?warehouseId=${selectedWarehouse}`
        : "/api/inventory/locations";
      const res = await fetch(url);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const filteredItems = (inventoryData || []).filter((item: any) => {
    const term = searchTerm.toLowerCase();
    const prodName = item.product?.name?.toLowerCase() || "";
    const sku = item.product?.sku?.toLowerCase() || "";
    const binCode = item.bin?.code?.toLowerCase() || "";
    const path = item.bin?.locationPath?.toLowerCase() || "";
    return prodName.includes(term) || sku.includes(term) || binCode.includes(term) || path.includes(term);
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Physical Inventory Management</h1>
          <p className="text-sm text-muted-foreground">
            Location bin allocations, unassigned warehouse stock, and inventory balance lookup.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/inventory/relocations">
            <Button size="sm" variant="outline" className="gap-2 text-xs">
              <ArrowLeftRight className="h-4 w-4" /> Bin Relocation
            </Button>
          </Link>
          <Link href="/inventory/movements">
            <Button size="sm" variant="outline" className="gap-2 text-xs">
              Movement Ledger
            </Button>
          </Link>
        </div>
      </div>

      {/* FILTER CONTROLS */}
      <Card className="shadow-sm">
        <CardContent className="p-4 flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by Product Name, SKU, Bin Code, or Path..."
              className="pl-9 text-xs"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="w-full md:w-64">
            <select
              value={selectedWarehouse}
              onChange={(e) => setSelectedWarehouse(e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="ALL">All Warehouses</option>
              {warehouses?.map((wh: any) => (
                <option key={wh.id} value={wh.id}>
                  {wh.name} ({wh.code || "WH"})
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {/* PHYSICAL INVENTORY TABLE */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Location Stock Allocations</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center text-xs text-muted-foreground">Loading physical inventory...</div>
          ) : filteredItems.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              No stock allocations found matching your search.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Product & SKU</TableHead>
                  <TableHead className="text-xs">Location Bin Path</TableHead>
                  <TableHead className="text-xs">Bin Code</TableHead>
                  <TableHead className="text-xs text-right">Quantity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.map((item: any) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div>
                        <p className="text-xs font-semibold">{item.product?.name || "Product"}</p>
                        <p className="text-[11px] font-mono text-muted-foreground">SKU: {item.product?.sku}</p>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground max-w-xs truncate">
                      {item.bin?.locationPath || "Unassigned"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {item.bin?.code || "BIN"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-right font-mono font-bold text-sky-600">
                      {item.quantity}
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
