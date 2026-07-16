// src/components/admin/OrderDeleteButton.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2 } from "lucide-react";

export function OrderDeleteButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    if (
      !confirm(
        "Удалить заявку? Это действие необратимо."
      )
    )
      return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        router.refresh();
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={loading}
      title="Удалить заявку"
      style={{
        marginTop: 8,
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 12px",
        borderRadius: 8,
        border: "1px solid #fecaca",
        background: "#fff5f5",
        color: "#dc2626",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        width: "100%",
        justifyContent: "center",
      }}
    >
      {loading ? (
        <Loader2 size={13} className="animate-spin" />
      ) : (
        <Trash2 size={13} />
      )}
      Удалить
    </button>
  );
}