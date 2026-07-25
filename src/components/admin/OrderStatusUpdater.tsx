// =========================================================
// FILE: src/components/admin/OrderStatusUpdater.tsx
// =========================================================

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, Clock, XCircle, Loader2, Send } from "lucide-react";

const STATUSES = [
  {
    value: "new",
    label: "Новая",
    badge: "admin-badge admin-badge--amber",
    icon: <Clock size={13} />,
  },
  {
    value: "in_progress",
    label: "В работе",
    badge: "admin-badge admin-badge--blue",
    icon: <Clock size={13} />,
  },
  {
    value: "completed",
    label: "Проведена",
    badge: "admin-badge admin-badge--green",
    icon: <CheckCircle size={13} />,
  },
  {
    value: "rejected",
    label: "Отклонена",
    badge: "admin-badge admin-badge--red",
    icon: <XCircle size={13} />,
  },
];

export function OrderStatusUpdater({
  orderId,
  currentStatus,
  currentCloseReason,
  dealNumber,
  adminPath = "admin",
  endpoint,
}: {
  orderId: string;
  currentStatus: string;
  currentCloseReason?: string | null;
  dealNumber?: number | null;
  adminPath?: string;
  endpoint?: string;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const currentStatusObj =
    STATUSES.find((s) => s.value === currentStatus) ?? STATUSES[0];

  async function updateStatus(newStatus: string) {
    if (newStatus === currentStatus) return;
    setSaving(true);
    try {
      const res = await fetch(endpoint || `/api/admin/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: newStatus,
          closeReason: null,
        }),
      });
      if (res.ok) router.refresh();
    } catch (err) {
      console.error(err);
    }
    setSaving(false);
  }

  return (
    <div className="admin-status">
      <span className={currentStatusObj.badge}>
        {currentStatusObj.icon}
        {currentStatusObj.label}
      </span>

      {dealNumber != null && (
        <a
          href={`/${adminPath}/warehouse?tab=deals`}
          className="admin-badge admin-badge--green"
          style={{ textDecoration: "none", justifyContent: "center" }}
          title="Заявка передана в учёт — открыть вкладку «Заказы»"
        >
          <CheckCircle size={11} /> В учёте: ЗК-{dealNumber}
        </a>
      )}

      {currentStatus === "new" && (
        <div className="admin-status__btns">
          <button
            type="button"
            onClick={() => updateStatus("in_progress")}
            disabled={saving}
            className="admin-status__btn admin-status__btn--primary"
            title="Передать заявку в работу"
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Send size={14} />
            )}
            В работу
          </button>
          {/* Отклонить — единая логика для любой заявки
              (заказ или запрос на уточнение): просто меняет статус. */}
          <button
            type="button"
            onClick={() => updateStatus("rejected")}
            disabled={saving}
            className="admin-status__btn admin-status__btn--outline-red"
            title="Отклонить заявку"
          >
            <XCircle size={14} />
            Отклонить
          </button>
        </div>
      )}

      {currentCloseReason && (
        <div className="admin-status__reason">Причина: {currentCloseReason}</div>
      )}
    </div>
  );
}
