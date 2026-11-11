import { getSessionFromRequest } from "@/utils/auth";
import { hasPermission } from "@/lib/auth/permissions";
import { NextRequest, NextResponse } from "next/server";
import {
  computeAuthoritativeMetrics,
  generateBenaaAiIntelligence,
  BenaaAiInsight,
} from "@/lib/ai/benaa-analytics-engine";
import { getNaraModel, isNaraRouterConfigured } from "@/lib/ai/nararouter";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

// In-Memory Intelligence Cache (15-minute TTL to respect rate limits)
let cachedInsights: BenaaAiInsight[] = [];
let lastAnalysisTime: string | null = null;
let lastProviderName: string = "NaraRouter (nemotron-3.5-lightning-free)";
const dismissedIds = new Set<string>();
const readIds = new Set<string>();

const CACHE_TTL_MS = 15 * 60 * 1000;
let lastAnalysisEpoch = 0;

/**
 * GET /api/ai/benaa-intelligence
 * Fetch latest intelligence insights & active alerts
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!hasPermission(session, "USER_MANAGE")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { searchParams } = new URL(request.url);
    const warehouseId = searchParams.get("warehouseId");
    const role = searchParams.get("role");

    const now = Date.now();
    const isCacheExpired = now - lastAnalysisEpoch > CACHE_TTL_MS;

    if (cachedInsights.length === 0 || isCacheExpired || warehouseId) {
      const metrics = await computeAuthoritativeMetrics(warehouseId);
      const result = await generateBenaaAiIntelligence(metrics);
      if (!warehouseId) {
        cachedInsights = result.insights;
        lastProviderName = result.provider;
        lastAnalysisTime = new Date().toISOString();
        lastAnalysisEpoch = now;
      } else {
        // Warehouse-specific request
        lastProviderName = result.provider;
      }
    }

    let activeInsights = (warehouseId ? (await generateBenaaAiIntelligence(await computeAuthoritativeMetrics(warehouseId))).insights : cachedInsights)
      .filter((i) => !dismissedIds.has(`${session.id}:${i.id}`))
      .map((i) => ({
        ...i,
        isRead: readIds.has(`${session.id}:${i.id}`),
      }));

    // Filter by role if provided
    if (role === "STOREKEEPER") {
      activeInsights = activeInsights.filter((i) => i.category === "inventory");
    } else if (role === "SALES_REP") {
      activeInsights = activeInsights.filter((i) => i.category === "sales" || i.category === "inventory");
    }

    const highSeverityCount = activeInsights.filter((i) => i.severity === "high").length;
    const unreadCount = activeInsights.filter((i) => !i.isRead).length;

    return NextResponse.json(
      {
        success: true,
        provider: lastProviderName,
        model: getNaraModel(),
        isNaraRouterConfigured: isNaraRouterConfigured(),
        lastAnalysisTime,
        stats: {
          totalInsights: activeInsights.length,
          highSeverityCount,
          unreadCount,
        },
        insights: activeInsights,
      },
      { headers: corsHeaders() }
    );
  } catch (error: any) {
    console.error("[Benaa Intelligence API] Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to load intelligence" },
      { status: 500, headers: corsHeaders() }
    );
  }
}

/**
 * POST /api/ai/benaa-intelligence
 * Trigger instant analysis, dismiss, or mark insights as read
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!hasPermission(session, "USER_MANAGE")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    const action = body.action || "analyze_now";

    if (action === "dismiss") {
      const insightId = body.insightId;
      if (insightId) dismissedIds.add(`${session.id}:${insightId}`);
      return NextResponse.json({ success: true, dismissedId: insightId }, { headers: corsHeaders() });
    }

    if (action === "mark_read") {
      const insightId = body.insightId;
      if (insightId) readIds.add(`${session.id}:${insightId}`);
      return NextResponse.json({ success: true, readId: insightId }, { headers: corsHeaders() });
    }

    // Default: On-demand fresh analysis
    const metrics = await computeAuthoritativeMetrics();
    const result = await generateBenaaAiIntelligence(metrics);

    cachedInsights = result.insights;
    lastProviderName = result.provider;
    lastAnalysisTime = new Date().toISOString();
    lastAnalysisEpoch = Date.now();

    const activeInsights = cachedInsights
      .filter((i) => !dismissedIds.has(`${session.id}:${i.id}`))
      .map((i) => ({
        ...i,
        isRead: readIds.has(`${session.id}:${i.id}`),
      }));

    return NextResponse.json(
      {
        success: true,
        action: "analyze_now",
        provider: lastProviderName,
        model: getNaraModel(),
        isCloudAiGenerated: result.isCloudAiGenerated,
        lastAnalysisTime,
        insights: activeInsights,
        stats: {
          totalInsights: activeInsights.length,
          highSeverityCount: activeInsights.filter((i) => i.severity === "high").length,
          unreadCount: activeInsights.filter((i) => !i.isRead).length,
        },
      },
      { headers: corsHeaders() }
    );
  } catch (error: any) {
    console.error("[Benaa Intelligence API] Analyze error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to run intelligence analysis" },
      { status: 500, headers: corsHeaders() }
    );
  }
}
