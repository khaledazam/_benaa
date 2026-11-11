import { NextResponse } from "next/server";
// HTTP seeding must never mutate company data; use isolated CLI fixtures.
export async function GET() {
  return NextResponse.json({ error: "HTTP seeding is disabled" }, { status: 403 });
}
export const POST = GET;
