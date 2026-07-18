// =========================================================
// FILE: src/components/admin/OrderStatusUpdater.tsx
// =========================================================

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  X,
  CheckCircle,
  Clock,
  XCircle,
  Loader2,
} from "lucide-react";

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

const CLOSE_REASONS = [
  "Клиент отменил заказ",
  "Товар закончился на складе",
  "Нет ответа от клиента",
  "Другая причина",
];

export function OrderStatusUpdater({
  orderId,
  currentStatus,
  currentCloseReason,
}: {
  orderId: string;
  currentStatus: string;
  currentCloseReason?: string | null;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closeReason, setCloseReason] = useState(currentCloseReason ?? "");
  const [customReason, setCustomReason] = useState("");

  const currentStatusObj =
    STATUSES.find((s) => s.value === currentStatus) ?? STATUSES[0];

  async function updateStatus(newStatus: string, reason?: string) {
    if (newStatus === currentStatus && !reason) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: newStatus,
          closeReason: reason ?? null,
        }),
      });
      if (res.ok) {
        setShowCloseModal(false);
        router.refresh();
      }
    } catch (err) {
      console.error(err);
    }
    setSaving(false);
  }

  function handleCloseSubmit() {
    const reason =
      closeReason === "Другая причина" ? customReason : closeReason;
    updateStatus("rejected", reason);
  }

  return (
    <div className="admin-status">
      <span className={currentStatusObj.badge}>
        {currentStatusObj.icon}
        {currentStatusObj.label}
      </span>

      {(currentStatus === "new" || currentStatus === "in_progress") && (
        <div className="admin-status__btns">
          <button
            type="button"
            onClick={() => updateStatus("completed")}
            disabled={saving}
            className="admin-status__btn admin-status__btn--primary"
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <CheckCircle size={14} />
            )}
            Провести
          </button>

          <button
            type="button"
            onClick={() => setShowCloseModal(true)}
            disabled={saving}
            className="admin-status__btn admin-status__btn--outline-red"
          >
            <XCircle size={14} />
            Отменить
          </button>
        </div>
      )}

      {currentCloseReason && (
        <div className="admin-status__reason">Причина: {currentCloseReason}</div>
      )}

      {showCloseModal && (
        <div className="admin-modal-overlay">
          <div className="admin-modal">
            <div className="admin-modal__head">
              <h3 className="admin-modal__title">Отменить заявку</h3>
              <button
                type="button"
                onClick={() => setShowCloseModal(false)}
                className="admin-modal__close"
              >
                <X size={20} />
              </button>
            </div>

            <p className="admin-modal__desc">
              Выберите причину отмены или введите вручную:
            </p>

            <div className="admin-radio-list">
              {CLOSE_REASONS.map((reason) => (
                <label key={reason} className="admin-radio-item">
                  <input
                    type="radio"
                    name="closeReason"
                    value={reason}
                    checked={closeReason === reason}
                    onChange={() => setCloseReason(reason)}
                  />
                  <span>{reason}</span>
                </label>
              ))}
            </div>

            {closeReason === "Другая причина" && (
              <textarea
                rows={2}
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                placeholder="Опишите причину..."
                className="admin-textarea"
                style={{ marginBottom: 16 }}
              />
            )}

            <div className="admin-modal__actions">
              <button
                type="button"
                onClick={handleCloseSubmit}
                disabled={saving || !closeReason}
                className="admin-btn"
                style={{
                  flex: 1,
                  background: "#ef4444",
                  color: "#fff",
                }}
              >
                {saving ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <XCircle size={14} />
                )}
                Подтвердить отмену
              </button>
              <button
                type="button"
                onClick={() => setShowCloseModal(false)}
                className="admin-btn admin-btn--outline"
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}