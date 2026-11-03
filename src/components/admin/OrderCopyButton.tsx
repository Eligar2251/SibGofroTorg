// src/components/admin/OrderCopyButton.tsx
"use client";

import { useState } from "react";
import { Copy, Loader2 } from "lucide-react";

export function OrderCopyButton({ orderId }: { orderId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleCopy() {
    if (!confirm("Создать новую копию этой заявки-заказа?")) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/orders/${encodeURIComponent(orderId)}/copy`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || "Не удалось скопировать заявку");
      }
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка копирования");
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleCopy}
        disabled={loading}
        title="Создать копию заявки-заказа"
        className="admin-btn admin-btn--ghost admin-btn--sm"
        style={{ width: "100%", justifyContent: "center" }}
      >
        {loading ? (
          <Loader2 size={13} className="animate-spin" />
        ) : (
          <Copy size={13} />
        )}
        Копировать заявку
      </button>
      {error && (
        <div style={{ fontSize: 11, color: "var(--adm-rust)", marginTop: 4 }}>
          {error}
        </div>
      )}
    </div>
  );
}
