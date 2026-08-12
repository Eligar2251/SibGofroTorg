"use client";

// Селект сортировки списка заявок (в т.ч. архива «Проведённые»).
// Серверная страница читает параметр ?sort=..., селект просто
// перезапускает навигацию с новым значением.

import { useRouter } from "next/navigation";
import { ArrowDownWideNarrow } from "lucide-react";
import { ORDER_SORT_OPTIONS, type OrderSortId } from "@/lib/orders-sort";

export function OrdersSortControl({
  basePath,
  status,
  q,
  sort,
}: {
  basePath: string;
  status: string;
  q: string;
  sort: OrderSortId;
}) {
  const router = useRouter();

  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        fontSize: 12,
        color: "var(--adm-ink-muted)",
      }}
    >
      <ArrowDownWideNarrow size={14} />
      Сортировка
      <select
        className="admin-select"
        style={{ width: "auto", minWidth: 180 }}
        value={sort}
        onChange={(e) => {
          const params = new URLSearchParams();
          params.set("status", status);
          if (q) params.set("q", q);
          params.set("sort", e.target.value);
          router.push(`${basePath}?${params.toString()}`);
        }}
      >
        {ORDER_SORT_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
