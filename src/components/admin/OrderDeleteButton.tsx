// src/components/admin/OrderDeleteButton.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2 } from "lucide-react";

export function OrderDeleteButton({
  orderId,
  endpoint,
}: {
  orderId: string;
  endpoint?: string;
}) {
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
      const res = await fetch(endpoint || `/api/admin/orders/${orderId}`, {
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
      className="admin-status__btn admin-status__btn--delete"
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