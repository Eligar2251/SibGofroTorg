// =========================================================
// FILE: src/components/admin/OrderStatusUpdater.tsx
// =========================================================

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, Clock, XCircle, Loader2, Send, RotateCcw, PackageCheck } from "lucide-react";

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
    value: "ready",
    label: "Готов к выдаче",
    badge: "admin-badge admin-badge--indigo",
    icon: <PackageCheck size={13} />,
  },
  {
    value: "completed",
    label: "Проведена",
    badge: "admin-badge admin-badge--green",
    icon: <CheckCircle size={13} />,
  },
  {
    value: "rejected",
    label: "Отменена",
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
  const [error, setError] = useState("");

  const currentStatusObj =
    STATUSES.find((s) => s.value === currentStatus) ?? STATUSES[0];

  async function updateStatus(
    newStatus: string,
    options: { removeFromWork?: boolean } = {}
  ) {
    if (newStatus === currentStatus && !options.removeFromWork) return;
    if (options.removeFromWork && !confirm("Убрать заявку из работы? Созданный заказ и автоматический платёж будут удалены из учёта.")) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch(endpoint || `/api/admin/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: newStatus,
          oldStatus: currentStatus,
          closeReason: null,
          ...options,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || "Не удалось обновить заявку");
      }
      if (body.dealError) {
        throw new Error(body.dealError);
      }
      router.refresh();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Ошибка обновления заявки");
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
            title="Передать заявку в работу и создать заказ/платёж в учёте"
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Send size={14} />
            )}
            В работу
          </button>
          <button
            type="button"
            onClick={() => updateStatus("rejected")}
            disabled={saving}
            className="admin-status__btn admin-status__btn--outline-red"
            title="Отменить заявку"
          >
            <XCircle size={14} />
            Отменить
          </button>
        </div>
      )}

      {(currentStatus === "in_progress" || currentStatus === "ready") && (
        <div className="admin-status__btns">
          {/* «Готов к выдаче» — только для заявок сайта (у макулатуры свой
              процесс): заказ собран, клиент в кабинете видит тот же статус.
              После отпуска товара в учёте заявка закроется сама. */}
          {!endpoint && currentStatus === "in_progress" && (
            <button
              type="button"
              onClick={() => updateStatus("ready")}
              disabled={saving}
              className="admin-status__btn admin-status__btn--primary"
              title="Заказ собран — клиент может забирать (статус виден и в его кабинете)"
            >
              {saving ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <PackageCheck size={14} />
              )}
              Готов к выдаче
            </button>
          )}
          {/* Заявка не передана в учёт (уточнение цены, макулатура) —
              менеджер закрывает её прямо здесь. Заявке со связью ЗК
              статус «Проведена» придёт автоматически из учёта. */}
          {dealNumber == null && (
            <button
              type="button"
              onClick={() => updateStatus("completed")}
              disabled={saving}
              className="admin-status__btn admin-status__btn--primary"
              title="Закрыть заявку как проведённую (у клиента в кабинете статус тоже обновится)"
            >
              {saving ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <CheckCircle size={14} />
              )}
              Проведена
            </button>
          )}
          {!endpoint && currentStatus === "ready" && (
            <button
              type="button"
              onClick={() => updateStatus("in_progress")}
              disabled={saving}
              className="admin-status__btn admin-status__btn--outline"
              title="Вернуть заявку в работу (заказ ещё не отдан клиенту)"
            >
              {saving ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Clock size={14} />
              )}
              Вернуть в работу
            </button>
          )}
          {!endpoint && (
            <button
              type="button"
              onClick={() => updateStatus("new", { removeFromWork: true })}
              disabled={saving}
              className="admin-status__btn admin-status__btn--outline"
              title="Вернуть заявку в новые и убрать созданные документы из учёта"
            >
              {saving ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RotateCcw size={14} />
              )}
              Убрать из работы
            </button>
          )}
        </div>
      )}

      {currentCloseReason && (
        <div className="admin-status__reason">Причина: {currentCloseReason}</div>
      )}
      {error && <div className="admin-status__reason" style={{ color: "var(--adm-rust)" }}>{error}</div>}
    </div>
  );
}
