import { getSessionFromRequest } from "@/utils/auth";
import { hasPermission } from "@/lib/auth/permissions";
/**
 * Email Notifications API Route
 * Handles email notification requests via Brevo API
 * Supports various notification types: low stock alerts, stock out, inventory reports
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { emailNotificationBodySchema } from "@/lib/validations/notification";
import {
  sendEmailViaBrevo,
  isBrevoConfigured,
  getAdminEmail,
  type SendEmailRequest,
} from "@/lib/email";
import {
  generateLowStockAlertEmail,
  generateStockOutNotificationEmail,
  generateInventoryReportEmail,
} from "@/lib/email/templates";
import type {
  LowStockAlertData,
  StockOutNotificationData,
  InventoryReportData,
} from "@/lib/email/types";
import { successResponse, errorResponse } from "@/lib/api/response-helpers";
import { getErrorMessage } from "@/lib/api/errors";

/**
 * POST /api/notifications
 * Send email notification
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) return errorResponse("Unauthorized", 401);
    if (!hasPermission(session, "SYSTEM_CONFIG")) return errorResponse("Forbidden", 403);
    // Check if Brevo is configured
    if (!isBrevoConfigured()) {
      logger.warn("Brevo email service is not configured");
      return errorResponse(
        "Email service is not configured. Please configure Brevo API credentials.",
        503
      );
    }

    const body = await request.json();
    const validationResult = emailNotificationBodySchema.safeParse(body);
    if (!validationResult.success) {
      logger.warn("Invalid email notification data", {
        errors: validationResult.error.issues,
      });
      return errorResponse("Invalid request body", 400, {
        details: validationResult.error.issues,
      });
    }

    const {
      type,
      recipientEmail,
      recipientName,
      data,
      adminEmail: requestAdminEmail,
    } = validationResult.data;

    // Generate email content based on type
    let emailContent;
    const tags: string[] = [type];

    switch (type) {
      case "low_stock_alert": {
        const alertData = data as unknown as LowStockAlertData;
        emailContent = generateLowStockAlertEmail(alertData);
        tags.push("alert", "low_stock");
        break;
      }

      case "stock_out_notification": {
        const stockOutData = data as unknown as StockOutNotificationData;
        emailContent = generateStockOutNotificationEmail(stockOutData);
        tags.push("alert", "stock_out");
        break;
      }

      case "inventory_report": {
        const reportData = data as unknown as InventoryReportData;
        emailContent = generateInventoryReportEmail(reportData);
        tags.push("report", reportData.reportType);
        break;
      }

      default:
        return errorResponse(`Unsupported notification type: ${type}`, 400);
    }

    // Prepare email request
    const emailRequest: SendEmailRequest = {
      to: {
        email: recipientEmail,
        name: recipientName,
      },
      subject: emailContent.subject,
      htmlContent: emailContent.htmlContent,
      textContent: emailContent.textContent,
      tags,
    };

    // Send email
    const result = await sendEmailViaBrevo(emailRequest);

    if (!result.success) {
      logger.error("Failed to send email notification", {
        type,
        recipientEmail,
        error: result.error,
      });
      return errorResponse(
        result.error || "Failed to send email notification",
        500
      );
    }

    // Optionally send to admin email as well
    const adminEmail = requestAdminEmail || getAdminEmail();
    if (adminEmail && adminEmail !== recipientEmail) {
      const adminEmailRequest: SendEmailRequest = {
        ...emailRequest,
        to: {
          email: adminEmail,
          name: "Administrator",
        },
        tags: [...tags, "admin_copy"],
      };

      // Send admin copy asynchronously (don't wait for it)
      sendEmailViaBrevo(adminEmailRequest).catch((error) => {
        logger.warn("Failed to send admin copy of notification", {
          type,
          adminEmail,
          error: getErrorMessage(error),
        });
      });
    }

    logger.info("Email notification sent successfully", {
      type,
      recipientEmail,
      messageId: result.messageId,
    });

    return successResponse(
      {
        success: true,
        messageId: result.messageId,
        provider: result.provider,
      },
      "Email notification sent successfully"
    );
  } catch (error) {
    logger.error("Error sending email notification", {
      error: getErrorMessage(error),
    });
    return errorResponse(
      `Failed to send email notification: ${getErrorMessage(error)}`,
      500
    );
  }
}

/**
 * GET /api/notifications/status
 * Check email service status
 */
export async function GET(request: NextRequest) {
  try {
    const isConfigured = isBrevoConfigured();
    const adminEmail = getAdminEmail();

    return successResponse({
      configured: isConfigured,
      provider: isConfigured ? "Brevo" : null,
      adminEmail: adminEmail || null,
    });
  } catch (error) {
    logger.error("Error checking email service status", {
      error: getErrorMessage(error),
    });
    return errorResponse(
      `Failed to check email service status: ${getErrorMessage(error)}`,
      500
    );
  }
}
