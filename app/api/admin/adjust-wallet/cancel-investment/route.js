import { NextResponse } from "next/server";

// Retired duplicate of /api/admin/cancel-investment.
//
// This path used to run a non-atomic cancellation (separate wallet,
// investment and transaction updates) that bypassed the safety checks
// in cancel_investment_atomically, including the block on cancelling
// while an investment withdrawal claim is being processed. No
// application code calls it. It now always returns 410 Gone and
// performs no reads or writes.
function gone() {
  return NextResponse.json(
    { error: "This endpoint has been removed. Use /api/admin/cancel-investment." },
    { status: 410 }
  );
}

export const GET = gone;
export const POST = gone;
export const PUT = gone;
export const PATCH = gone;
export const DELETE = gone;
