import { erpFinancialAccess } from "@/lib/sales/financialAccess";
import { prisma } from "@/prisma/client";
/**
 * POST /api/payments/confirm-session
 * REQ-0209 — Browser return from Stripe applies/syncs payment when webhook is delayed
 * or hits another host. Idempotent with webhook via PaymentIntent match.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { logger } from "@/lib/logger";
import { isStripeConfigured, getStripe } from "@/lib/stripe";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { confirmCheckoutSessionBodySchema } from "@/lib/validations/payment";
import { confirmCheckoutSessionById } from "@/lib/payments/confirm-checkout-session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const rateLimitResponse = await withRateLimit(
      request,
      defaultRateLimits.standard,
    );
    if (rateLimitResponse) return rateLimitResponse;

    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isStripeConfigured()) {
      return NextResponse.json(
        { error: "Payment system is not configured" },
        { status: 503 },
      );
    }

    const body = await request.json();
    const parsed = confirmCheckoutSessionBodySchema.safeParse(body);
    if (!parsed.success) {
      logger.warn("Invalid confirm-session body", {
        errors: parsed.error.issues,
      });
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const providerSession = await getStripe().checkout.sessions.retrieve(parsed.data.sessionId);
    const metadata = providerSession.metadata || {};
    const invoiceId = metadata.type === "invoice" ? metadata.invoiceId || metadata.referenceId : null;
    const orderId = metadata.type === "order" ? metadata.orderId || metadata.referenceId : invoiceId ? (await prisma.invoice.findUnique({ where: { id: invoiceId } }))?.orderId : null;
    if (orderId && await erpFinancialAccess(prisma, session.id, orderId) === false) return NextResponse.json({ error: "Forbidden ERP payment confirmation" }, { status: 403 });
    const result = await confirmCheckoutSessionById(parsed.data.sessionId, providerSession);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error ?? "Failed to confirm session" },
        { status: 400 },
      );
    }

    return NextResponse.json({
      alreadyApplied: result.alreadyApplied,
      orderId: result.orderId,
      invoiceId: result.invoiceId,
      paymentStatus: result.paymentStatus,
      orderStatus: result.orderStatus,
      // REQ-0215 — client patch invoice badge to paid after remainder settle
      invoiceStatus: result.invoiceStatus,
    });
  } catch (error) {
    logger.error("confirm-session failed:", error);
    return NextResponse.json(
      { error: "Failed to confirm checkout session" },
      { status: 500 },
    );
  }
}
