import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { applyProjectManagement, listProjectRecords, ProjectIssueError } from "@/lib/projects/projectMaterialIssueService";
export async function GET(request: NextRequest) {
  try {
    const actor = await getSessionFromRequest(request);
    if (!actor) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    return NextResponse.json(await listProjectRecords(prisma, actor));
  } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  try {
    const actor = await getSessionFromRequest(request);
    if (!actor) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const body = await request.json();
    return NextResponse.json(await applyProjectManagement(prisma, actor, body, request.headers.get("Idempotency-Key")), { status: body.projectId ? 200 : 201 });
  } catch (error) { return failure(error); }
}
function failure(error: unknown) {
  return NextResponse.json({ success: false, error: error instanceof ProjectIssueError ? error.message : "Project operation failed safely" }, { status: error instanceof ProjectIssueError ? error.status : 503 });
}
