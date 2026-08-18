"use client";

import React, { useState, useEffect, useRef } from "react";
import { Search, Barcode, CheckCircle, AlertCircle, Loader2 } from "lucide-react";

export interface BarcodeScanResult {
  product: any;
  exactMatchField: "barcode" | "sku" | "id";
  warehouseAllocations: any[];
  totalPhysicalStock: number;
  totalAvailableStock: number;
}

export interface BarcodeScannerInputProps {
  onScanSuccess: (result: BarcodeScanResult) => void;
  onScanError?: (errorMsg: string) => void;
  placeholder?: string;
  warehouseId?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
}

export function BarcodeScannerInput({
  onScanSuccess,
  onScanError,
  placeholder = "Scan barcode or enter SKU...",
  warehouseId,
  autoFocus = true,
  disabled = false,
  className = "",
}: BarcodeScannerInputProps) {
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [lastScannedCode, setLastScannedCode] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  const handleLookup = async (code: string) => {
    const cleanedCode = code.trim().replace(/[\r\n]/g, "");
    if (!cleanedCode) return;

    if (cleanedCode === lastScannedCode) {
      setStatusMessage({ type: "error", text: `Duplicate scan detected for '${cleanedCode}'` });
      if (onScanError) onScanError(`Duplicate scan detected for '${cleanedCode}'`);
      setInputValue("");
      return;
    }

    setIsLoading(true);
    setStatusMessage(null);

    try {
      const url = `/api/products/barcode/${encodeURIComponent(cleanedCode)}${warehouseId ? `?warehouseId=${warehouseId}` : ""}`;
      const res = await fetch(url);
      const data = await res.json();

      if (!res.ok || data.error) {
        const errorMsg = data.error || `No product found for code '${cleanedCode}'`;
        setStatusMessage({ type: "error", text: errorMsg });
        if (onScanError) onScanError(errorMsg);
      } else {
        setLastScannedCode(cleanedCode);
        setStatusMessage({
          type: "success",
          text: `Found: ${data.product.name} (${data.product.sku}) — Available: ${data.totalAvailableStock}`,
        });
        onScanSuccess(data);
      }
    } catch (err: any) {
      const msg = err.message || "Failed to execute barcode scan lookup";
      setStatusMessage({ type: "error", text: msg });
      if (onScanError) onScanError(msg);
    } finally {
      setIsLoading(false);
      setInputValue("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleLookup(inputValue);
    }
  };

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div className="relative flex items-center w-full">
        <Barcode className="absolute left-3 w-5 h-5 text-gray-400 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled || isLoading}
          className="w-full pl-10 pr-10 py-2.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50"
        />
        <div className="absolute right-3 flex items-center">
          {isLoading ? (
            <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
          ) : (
            <button
              type="button"
              onClick={() => handleLookup(inputValue)}
              disabled={disabled || !inputValue.trim()}
              className="text-gray-400 hover:text-blue-500 disabled:opacity-30"
            >
              <Search className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {statusMessage && (
        <div
          className={`flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-md ${
            statusMessage.type === "success"
              ? "bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300"
              : "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
          }`}
        >
          {statusMessage.type === "success" ? (
            <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
          )}
          <span>{statusMessage.text}</span>
        </div>
      )}
    </div>
  );
}
