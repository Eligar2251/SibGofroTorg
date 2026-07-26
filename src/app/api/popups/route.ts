import { NextResponse } from "next/server";
import { getAllPopupCampaigns } from "@/lib/supabase-queries";
import { preparePublicCampaigns } from "@/lib/popup-campaign";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const campaigns = preparePublicCampaigns(await getAllPopupCampaigns());
    return NextResponse.json(
      { campaigns },
      {
        headers: {
          "Cache-Control": "public, max-age=30, stale-while-revalidate=120",
        },
      }
    );
  } catch (error) {
    console.error("Public popups error:", error);
    return NextResponse.json(
      { campaigns: [] },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
