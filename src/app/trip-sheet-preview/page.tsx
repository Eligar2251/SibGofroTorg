// src/app/trip-sheet-preview/page.tsx
// Dev-стенд для просмотра путевого листа и редактора точек маршрута
// на моковых данных (никакой БД не нужно). В проде страница 404.
import { notFound } from "next/navigation";
import { TripSheetPreviewClient } from "./client";

export const dynamic = "force-dynamic";

export default async function TripSheetPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ sheet?: string; admin?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { sheet, admin } = await searchParams;
  return <TripSheetPreviewClient autoOpenSheet={sheet === "1"} showManager={admin === "1"} />;
}
