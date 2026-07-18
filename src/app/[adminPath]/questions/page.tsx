// src/app/[adminPath]/questions/page.tsx
import { notFound } from "next/navigation";
import { QuestionsManager } from "@/components/admin/QuestionsManager";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";
export const dynamic = "force-dynamic";

export default async function AdminQuestionsPage({
  params,
}: {
  params: Promise<{ adminPath: string }>;
}) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) notFound();

  return (
    <div>
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
          Вопросы к товарам
        </h1>
      </div>

      <QuestionsManager />
    </div>
  );
}