/**
 * Email Queue Webhook Handler
 * Processes queued email notifications from QStash.
 * Body is read once as text (verify + parse); never call request.json() after request.text().
 */

import { NextRequest, NextResponse } from "next/server";
import { isQStashConfigured } from "@/lib/queue/qstash";
import {
  parseEmailQueueJob,
  verifyQStashWebhook,
} from "@/lib/queue/qstash-webhook";
import { logger } from "@/lib/logger";
import { sendEmailDirectly } from "@/lib/email/queue";

export const runtime = "nodejs";

/**
 * POST /api/email/queue/process
 * Process queued email notification from QStash
 */
export async function POST(request: NextRequest) {
  try {
    if (!isQStashConfigured()) {
      return NextResponse.json({ error: "Verified email queue is not configured" }, { status: 503 });
    }
    const rawBody = await request.text();

    if (isQStashConfigured()) {
      const isValid = await verifyQStashWebhook({
        signature: request.headers.get("upstash-signature"),
        body: rawBody,
        url: request.url,
        upstashRegion: request.headers.get("upstash-region"),
      });
      if (!isValid) {
        logger.warn("Invalid QStash webhook signature");
        return NextResponse.json(
          { error: "Invalid signature" },
          { status: 401 },
        );
      }
    }

    let job;
    try {
      job = parseEmailQueueJob(rawBody);
    } catch (parseError) {
      logger.warn("Invalid email queue job payload", {
        error:
          parseError instanceof Error ? parseError.message : "Unknown error",
      });
      return NextResponse.json(
        { error: "Invalid job payload" },
        { status: 400 },
      );
    }

    await sendEmailDirectly(job, { propagateErrors: true });

    logger.info("Email queue job processed successfully", {
      type: job.type,
      recipientEmail: job.recipientEmail,
    });

    return NextResponse.json({
      success: true,
      message: "Email notification processed",
    });
  } catch (error) {
    logger.error("Error processing email queue job", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json(
      { error: "Failed to process email queue job" },
      { status: 500 },
    );
  }
}
