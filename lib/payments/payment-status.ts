import type { PaymentStatus } from "@/types";

/** Dollar → integer cents for settle comparisons (avoids 1880.06 float noise). */
export function toCents(amount: number): number {
  const n = Number.isFinite(amount) ? amount : 0;
  return Math.round(n * 100);
}

/** Pure: map amountPaid vs total → order paymentStatus (never refunded). */
export function deriveOrderPaymentStatus(
  amountPaid: number,
  total: number,
): Exclude<PaymentStatus, "refunded"> {
  const paidCents = toCents(amountPaid);
  const totalCents = toCents(total);
  if (paidCents <= 0 || totalCents <= 0) return "unpaid";
  if (paidCents >= totalCents) return "paid";
  return "partial";
}

