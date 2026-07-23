// src/app/[adminPath]/reviews/page.tsx
import { notFound } from "next/navigation";
import { ReviewsManager } from "@/components/admin/ReviewsManager";
import { ReviewsRealtime } from "@/components/admin/ReviewsRealtime";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";
export const dynamic = "force-dynamic";

export default async function AdminReviewsPage({
  params,
}: {
  params: Promise<{ adminPath: string }>;
}) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) notFound();

  return (
    <div>
      <ReviewsRealtime />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 24,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <h1 className="admin-h1" style={{ margin: 0 }}>
          Отзывы покупателей
        </h1>
      </div>

      <ReviewsManager />
    </div>
  );
}