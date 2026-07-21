import { notFound } from "next/navigation";
import { getAllPopupCampaigns } from "@/lib/firestore-queries";
import { PopupCampaignsManager } from "@/components/admin/PopupCampaignsManager";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";
export const dynamic = "force-dynamic";

export default async function AdminPopupsPage({
  params,
}: {
  params: Promise<{ adminPath: string }>;
}) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) notFound();
  const campaigns = await getAllPopupCampaigns();

  return (
    <div>
      <div className="admin-page-head">
        <div>
          <h1 className="admin-h1">Информационные окна</h1>
          <p className="admin-sub">
            Отдельные всплывающие сообщения с расписанием, длительностью и
            предпросмотром.
          </p>
        </div>
      </div>
      <PopupCampaignsManager
        initialCampaigns={campaigns.map((item) => ({
          id: item.id,
          type: item.type || "banner",
          title: item.title,
          kicker: item.kicker || null,
          description: item.description || null,
          details: item.details || null,
          imageUrl: item.imageUrl || null,
          buttonText: item.buttonText || null,
          buttonUrl: item.buttonUrl || null,
          style: item.style,
          isActive: item.isActive,
          startAt: item.startAt || null,
          endAt: item.endAt || null,
          delaySeconds: item.delaySeconds,
          durationSeconds: item.durationSeconds,
          frequency: item.frequency,
          sortOrder: item.sortOrder,
        }))}
      />
    </div>
  );
}
