// =========================================================
// FILE: src/components/admin/OrderIssueButton.tsx
// Выдача товара по заявке — кнопка на странице «Заявки».
// Появляется, когда заказ «Готов к выдаче» (ready); после выдачи
// помечает заявку «Выдан» (issued) и фиксирует время.
// =========================================================

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PackageCheck, RotateCcw } from "lucide-react";

export function OrderIssueButton({
  orderId,
  status,
}: {
  orderId: string;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (status !== "ready" && status !== "issued") return null;

  async function act(action: "issue" | "unissue") {
    if (action === "issue" && !confirm("Выдать товар по этому заказу? Заявка будет помечена как «Выдан».")) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/issue/${orderId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Не удалось выполнить действие");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  if (status === "issued") {
    return (
      <div className="admin-status__btns">
        <button
          type="button"
          className="admin-status__btn admin-status__btn--outline"
          disabled={busy}
          onClick={() => act("unissue")}
          title="Вернуть заявку в «Готов к выдаче»"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
          Отменить выдачу
        </button>
        {error && <div className="admin-status__reason" style={{ color: "var(--adm-rust)" }}>{error}</div>}
      </div>
    );
  }

  return (
    <div className="admin-status__btns">
      <button
        type="button"
        className="admin-status__btn admin-status__btn--primary"
        disabled={busy}
        onClick={() => act("issue")}
        title="Товар собран — выдать клиенту по коду"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <PackageCheck size={14} />}
        Выдать товар
      </button>
      {error && <div className="admin-status__reason" style={{ color: "var(--adm-rust)" }}>{error}</div>}
    </div>
  );
}
