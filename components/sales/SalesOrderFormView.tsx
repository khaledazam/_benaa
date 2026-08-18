"use client";

import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Receipt, Plus, Trash2, ArrowLeft, Search, CheckCircle2, AlertTriangle, Box, Warehouse, Users } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface FormLineItem {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  unitId?: string;
  unitSymbol?: string;
  orderedQuantity: number;
  unitPrice: number;
  discount: number;
  tax: number;
  lineTotal: number;
}

export default function SalesOrderFormView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedCustomerId = searchParams.get("customerId") || "";

  const [customerId, setCustomerId] = useState(preselectedCustomerId);
  const [warehouseId, setWarehouseId] = useState("");
  const [requestedDeliveryDate, setRequestedDeliveryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [orderDiscount, setOrderDiscount] = useState<number>(0);
  const [orderTax, setOrderTax] = useState<number>(0);

  const [items, setItems] = useState<FormLineItem[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [lineQty, setLineQty] = useState<number>(1);
  const [linePrice, setLinePrice] = useState<number>(0);
  const [lineDiscount, setLineDiscount] = useState<number>(0);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 1. Fetch Customers
  const { data: customersData } = useQuery({
    queryKey: ["form-customers"],
    queryFn: async () => {
      const res = await fetch("/api/customers?active=true&limit=100");
      return res.ok ? res.json() : { items: [] };
    },
  });

  // 2. Fetch Warehouses
  const { data: warehouses } = useQuery({
    queryKey: ["form-warehouses"],
    queryFn: async () => {
      const res = await fetch("/api/warehouses");
      return res.ok ? res.json() : [];
    },
  });

  // 3. Search Products
  const { data: productsData } = useQuery({
    queryKey: ["form-product-search", productSearch],
    enabled: productSearch.trim().length >= 2,
    queryFn: async () => {
      const res = await fetch(`/api/products?search=${encodeURIComponent(productSearch)}&limit=10`);
      return res.ok ? res.json() : { items: [] };
    },
  });

  const searchResults = productsData?.items || productsData?.products || [];

  const handleSelectProduct = (product: any) => {
    setSelectedProduct(product);
    setLinePrice(product.price || 0);
    setProductSearch(`${product.name} (${product.sku})`);
  };

  const handleAddLineItem = () => {
    if (!selectedProduct) return;
    if (lineQty <= 0) {
      setErrorMsg("Quantity must be greater than 0");
      return;
    }

    const lineTotal = Math.round((lineQty * linePrice - lineDiscount) * 100) / 100;

    const newItem: FormLineItem = {
      id: Math.random().toString(),
      productId: selectedProduct.id,
      productName: selectedProduct.name,
      productSku: selectedProduct.sku || "",
      unitId: selectedProduct.unitId || undefined,
      unitSymbol: selectedProduct.size || "Units",
      orderedQuantity: lineQty,
      unitPrice: linePrice,
      discount: lineDiscount,
      tax: 0,
      lineTotal,
    };

    setItems([...items, newItem]);
    setSelectedProduct(null);
    setProductSearch("");
    setLineQty(1);
    setLinePrice(0);
    setLineDiscount(0);
    setErrorMsg(null);
  };

  const handleRemoveLineItem = (id: string) => {
    setItems(items.filter((i) => i.id !== id));
  };

  // Financial Calculations
  const calculatedSubtotal = Math.round(items.reduce((sum, i) => sum + i.lineTotal, 0) * 100) / 100;
  const calculatedTotal = Math.round((calculatedSubtotal - orderDiscount + orderTax) * 100) / 100;

  // Create Mutation
  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/sales-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          warehouseId,
          requestedDeliveryDate: requestedDeliveryDate || undefined,
          notes: notes || undefined,
          discount: orderDiscount,
          tax: orderTax,
          items: items.map((i) => ({
            productId: i.productId,
            unitId: i.unitId,
            orderedQuantity: i.orderedQuantity,
            unitPrice: i.unitPrice,
            discount: i.discount,
            tax: i.tax,
          })),
        }),
      });

      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "Failed to create sales order");
      return resData;
    },
    onSuccess: (data: any) => {
      router.push(`/sales/${data.id}`);
    },
    onError: (err: any) => setErrorMsg(err.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!customerId) {
      setErrorMsg("Please select a customer");
      return;
    }
    if (!warehouseId) {
      setErrorMsg("Please select a warehouse");
      return;
    }
    if (items.length === 0) {
      setErrorMsg("Please add at least one product line item to the order");
      return;
    }

    createMutation.mutate();
  };

  const customersList = customersData?.items || [];

  return (
    <div className="max-w-4xl mx-auto space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" asChild>
          <Link href="/sales">
            <ArrowLeft className="h-4 w-4" /> Back to Orders
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Receipt className="h-6 w-6 text-sky-600" /> Create Sales Order
          </h1>
          <p className="text-sm text-muted-foreground">
            Create a new DRAFT sales order for commercial or decoration materials.
          </p>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3 border border-destructive bg-destructive/10 text-destructive text-xs rounded-md flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" /> {errorMsg}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* HEADER DETAILS CARD */}
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold">1. Customer & Warehouse Selection</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs font-medium">Customer *</Label>
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                required
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs shadow-sm focus:outline-none"
              >
                <option value="">-- Select Active Customer --</option>
                {customersList.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.customerCode})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-medium">Fulfillment Warehouse *</Label>
              <select
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                required
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs shadow-sm focus:outline-none"
              >
                <option value="">-- Select Warehouse --</option>
                {warehouses?.map((wh: any) => (
                  <option key={wh.id} value={wh.id}>
                    {wh.name} ({wh.code || "WH"})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-medium">Requested Delivery Date (Optional)</Label>
              <Input
                type="date"
                value={requestedDeliveryDate}
                onChange={(e) => setRequestedDeliveryDate(e.target.value)}
                className="text-xs"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-medium">Order Notes / Delivery Terms</Label>
              <Input
                placeholder="e.g. Deliver to Sector 4 construction site"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="text-xs"
              />
            </div>
          </CardContent>
        </Card>

        {/* LINE ITEMS SELECTION CARD */}
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold">2. Add Line Items</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-3 border rounded-md bg-muted/30 space-y-3">
              <div className="relative">
                <Label className="text-xs font-medium">Search Product (Name, SKU, Barcode)</Label>
                <div className="relative mt-1">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Type at least 2 chars to search catalog..."
                    value={productSearch}
                    onChange={(e) => {
                      setProductSearch(e.target.value);
                      if (selectedProduct && e.target.value !== selectedProduct.name) {
                        setSelectedProduct(null);
                      }
                    }}
                    className="pl-9 text-xs"
                  />
                </div>

                {/* Autocomplete Dropdown */}
                {searchResults.length > 0 && !selectedProduct && (
                  <div className="absolute z-10 w-full mt-1 bg-background border rounded-md shadow-lg max-h-48 overflow-y-auto text-xs divide-y">
                    {searchResults.map((p: any) => (
                      <div
                        key={p.id}
                        onClick={() => handleSelectProduct(p)}
                        className="p-2 hover:bg-muted cursor-pointer flex justify-between items-center"
                      >
                        <div>
                          <p className="font-semibold">{p.name}</p>
                          <p className="text-[10px] font-mono text-muted-foreground">SKU: {p.sku} | UOM: {p.size || "Units"}</p>
                        </div>
                        <span className="font-mono font-medium">${p.price?.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {selectedProduct && (
                <div className="grid gap-3 md:grid-cols-4 items-end pt-2">
                  <div>
                    <Label className="text-xs font-medium">Quantity (Decimal UOM)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={lineQty || ""}
                      onChange={(e) => setLineQty(parseFloat(e.target.value) || 0)}
                      className="text-xs font-mono"
                    />
                  </div>

                  <div>
                    <Label className="text-xs font-medium">Unit Price ($)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={linePrice || ""}
                      onChange={(e) => setLinePrice(parseFloat(e.target.value) || 0)}
                      className="text-xs font-mono"
                    />
                  </div>

                  <div>
                    <Label className="text-xs font-medium">Line Discount ($)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={lineDiscount || ""}
                      onChange={(e) => setLineDiscount(parseFloat(e.target.value) || 0)}
                      className="text-xs font-mono"
                    />
                  </div>

                  <Button type="button" onClick={handleAddLineItem} className="text-xs gap-1">
                    <Plus className="h-4 w-4" /> Add Item
                  </Button>
                </div>
              )}
            </div>

            {/* ADDED ITEMS TABLE */}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Product</TableHead>
                  <TableHead className="text-xs">SKU</TableHead>
                  <TableHead className="text-xs">Quantity</TableHead>
                  <TableHead className="text-xs">Unit Price</TableHead>
                  <TableHead className="text-xs">Discount</TableHead>
                  <TableHead className="text-xs">Line Total</TableHead>
                  <TableHead className="text-xs text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-6 text-xs text-muted-foreground">
                      No line items added yet. Search and add products above.
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="text-xs font-medium">{item.productName}</TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">{item.productSku || "—"}</TableCell>
                      <TableCell className="text-xs font-mono">{item.orderedQuantity} {item.unitSymbol}</TableCell>
                      <TableCell className="text-xs font-mono">${item.unitPrice.toFixed(2)}</TableCell>
                      <TableCell className="text-xs font-mono">${item.discount.toFixed(2)}</TableCell>
                      <TableCell className="text-xs font-mono font-semibold">${item.lineTotal.toFixed(2)}</TableCell>
                      <TableCell className="text-xs text-right">
                        <Button variant="ghost" size="sm" onClick={() => handleRemoveLineItem(item.id)} className="text-rose-600">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* FINANCIAL SUMMARY & SUBMIT */}
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold">3. Order Financial Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-xs font-medium">Order Level Discount ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={orderDiscount || ""}
                  onChange={(e) => setOrderDiscount(parseFloat(e.target.value) || 0)}
                  className="text-xs font-mono"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-medium">Order Level Tax ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={orderTax || ""}
                  onChange={(e) => setOrderTax(parseFloat(e.target.value) || 0)}
                  className="text-xs font-mono"
                />
              </div>
            </div>

            <div className="p-4 bg-muted rounded-md space-y-1 text-right font-mono">
              <p className="text-xs text-muted-foreground">Subtotal: ${calculatedSubtotal.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground">Order Discount: -${orderDiscount.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground">Order Tax: +${orderTax.toFixed(2)}</p>
              <p className="text-lg font-bold text-foreground">Estimated Total: ${calculatedTotal.toFixed(2)}</p>
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" disabled={createMutation.isPending || items.length === 0} className="w-full text-xs font-semibold">
              {createMutation.isPending ? "Creating Draft..." : "Save Sales Order Draft"}
            </Button>
          </CardFooter>
        </Card>
      </form>
    </div>
  );
}
