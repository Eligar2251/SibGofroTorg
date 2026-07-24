// src/components/admin/OrderDeleteButton.tsx
"use client";

import { useState } from "react";
import { Trash2, Loader2 } from "lucide-react";

export function OrderDeleteButton({
  orderId,
  endpoint,
}: {
  orderId: string;
  endpoint?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleDelete() {
    if (!confirm("Удалить заявку? Это действие необратимо.")) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(endpoint || `/api/admin/orders/${orderId}`, {
        method: "DELETE",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || "Не удалось удалить заявку");
      }
      // Гарантированная перезагрузка — показывает актуальные данные
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка удаления");
    }
    setLoading(false);
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleDelete}
        disabled={loading}
        title="Удалить заявку"
        className="admin-status__btn admin-status__btn--delete"
      >
        {loading ? (
          <Loader2 size={13} className="animate-spin" />
        ) : (
          <Trash2 size={13} />
        )}
        Удалить
      </button>
      {error && (
        <div style={{ fontSize: 11, color: "var(--adm-rust)", marginTop: 4 }}>
          {error}
        </div>
      )}
    </div>
  );
}
