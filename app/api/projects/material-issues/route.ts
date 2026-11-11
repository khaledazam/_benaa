import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { scheduleInvalidateStockAllocationCaches } from "@/lib/cache/post-mutation";
import { applyProjectOperation, listProjectRecords, ProjectIssueError } from "@/lib/projects/projectMaterialIssueService";
export async function GET(request: NextRequest) {
  try {
    const actor = await getSessionFromRequest(request);
    if (!actor) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    return NextResponse.json(await listProjectRecords(prisma, actor, { issues: true, projectId: request.nextUrl.searchParams.get("projectId"), warehouseId: request.nextUrl.searchParams.get("warehouseId") }));
  } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  try {
    const actor = await getSessionFromRequest(request);
    if (!actor) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const body = await request.json();
    const result = await applyProjectOperation(prisma, actor, body, request.headers.get("Idempotency-Key"));
    await scheduleInvalidateStockAllocationCaches();
    return NextResponse.json(result, { status: body.action === "CREATE" && !result.replayed ? 201 : 200 });
  } catch (error) { return failure(error); }
}
function failure(error: unknown) {
  return NextResponse.json({ success: false, error: error instanceof ProjectIssueError ? error.message : "Project material operation failed safely" }, { status: error instanceof ProjectIssueError ? error.status : 503 });
}
