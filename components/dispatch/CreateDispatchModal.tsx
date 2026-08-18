"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AlertCircle, Truck, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface CreateDispatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  pickList: {
    id: string;
    pickListNumber: string;
    salesOrderNumber: string;
    warehouseName: string;
  };
}

export function CreateDispatchModal({ isOpen, onClose, pickList }: CreateDispatchModalProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch("/api/dispatches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pickListId: pickList.id,
          notes: notes.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create dispatch");

      toast({ title: "Dispatch Created", description: `Dispatch ${data.dispatchNumber} created in DRAFT status` });
      onClose();
      router.push(`/inventory/dispatches/${data.id}`);
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to create dispatch", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-bold">
            <Truck className="h-5 w-5 text-indigo-600" />
            Create Dispatch Record
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="rounded-lg bg-slate-50 p-3 text-sm space-y-1.5 border">
            <div className="flex justify-between text-slate-700 font-medium">
              <span>Pick List:</span>
              <span className="font-mono text-slate-900">{pickList.pickListNumber}</span>
            </div>
            <div className="flex justify-between text-slate-700">
              <span>Sales Order:</span>
              <span className="font-mono text-slate-900">{pickList.salesOrderNumber}</span>
            </div>
            <div className="flex justify-between text-slate-700">
              <span>Warehouse:</span>
              <span className="text-slate-900">{pickList.warehouseName}</span>
            </div>
          </div>

          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-amber-800 text-xs flex gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              Creating a Dispatch creates a <strong>DRAFT</strong> record. Physical stock is <strong>NOT</strong> deducted until you explicitly post the dispatch.
            </span>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Dispatch Notes (Optional)</Label>
            <Textarea
              id="notes"
              placeholder="Add shipping notes, driver details, or special instructions..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="bg-indigo-600 hover:bg-indigo-700 text-white">
              {loading ? "Creating..." : "Create Draft Dispatch"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
