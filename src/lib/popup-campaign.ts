import type {
  PopupCampaignFrequency,
  PopupCampaignStyle,
} from "@/lib/types";

function text(value: unknown, max: number): string | null {
  const clean = String(value ?? "").trim().slice(0, max);
  return clean || null;
}

export function cleanPopupCampaign(body: Record<string, unknown>) {
  const style: PopupCampaignStyle = ["info", "promo", "important"].includes(
    String(body.style)
  )
    ? (body.style as PopupCampaignStyle)
    : "info";
  const frequency: PopupCampaignFrequency = [
    "session",
    "day",
    "always",
  ].includes(String(body.frequency))
    ? (body.frequency as PopupCampaignFrequency)
    : "session";

  return {
    title: text(body.title, 200) || "",
    kicker: text(body.kicker, 80),
    description: text(body.description, 1200),
    details: text(body.details, 2000),
    imageUrl: text(body.imageUrl, 1000),
    buttonText: text(body.buttonText, 80),
    buttonUrl: text(body.buttonUrl, 1000),
    style,
    isActive: body.isActive !== false,
    startAt: text(body.startAt, 40),
    endAt: text(body.endAt, 40),
    delaySeconds: Math.min(
      3600,
      Math.max(0, Number(body.delaySeconds) || 0)
    ),
    durationSeconds: Math.min(
      600,
      Math.max(5, Number(body.durationSeconds) || 20)
    ),
    frequency,
    sortOrder: Number(body.sortOrder) || 0,
    // New fields
    isProductType: !!body.isProductType,
    isStoryType: !!body.isStoryType,
    discountPercent: Number(body.discountPercent) || null,
    stockLevel: Number(body.stockLevel) || null,
    tags: text(body.tags, 200),
    oldPrice: Number(body.oldPrice) || null,
    newPrice: Number(body.newPrice) || null,
    timerSeconds: Number(body.timerSeconds) || null,
  };
}

export function safePopupUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^(mailto:|tel:|tg:)/i.test(value)) return value;
  return null;
}
