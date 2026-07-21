import { NextResponse } from "next/server";
import { getAllPopupCampaigns } from "@/lib/firestore-queries";
import { safePopupUrl } from "@/lib/popup-campaign";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const now = Date.now();
    const campaigns = (await getAllPopupCampaigns())
      .filter((item) => {
        if (!item.isActive) return false;
        const end = item.endAt ? new Date(item.endAt).getTime() : 0;
        return !Number.isFinite(end) || end <= 0 || end > now;
      })
      .map((item) => ({
        id: item.id,
        type: item.type,
        title: item.title,
        kicker: item.kicker || null,
        description: item.description || null,
        details: item.details || null,
        imageUrl: item.imageUrl || null,
        buttonText: item.buttonText || null,
        buttonUrl: safePopupUrl(item.buttonUrl),
        style: item.style,
        startAt: item.startAt || null,
        endAt: item.endAt || null,
        delaySeconds: Math.min(3600, Math.max(0, item.delaySeconds || 0)),
        durationSeconds: Math.min(
          600,
          Math.max(5, item.durationSeconds || 20)
        ),
        frequency: item.frequency,
      }));
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
