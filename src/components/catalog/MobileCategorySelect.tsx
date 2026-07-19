"use client";

import { ChevronDown } from "lucide-react";

interface CategoryOption {
  id: string;
  name: string;
  slug: string;
  icon?: string | null;
}

interface MobileCategorySelectProps {
  categories: CategoryOption[];
  activeSlug: string | null;
  onSelect: (slug: string | null) => void;
  allLabel?: string;
}

/** Мобильный выпадающий список категорий — заменяет чипы на узких экранах */
export function MobileCategorySelect({
  categories,
  activeSlug,
  onSelect,
  allLabel = "Все категории",
}: MobileCategorySelectProps) {
  return (
    <div className="mcs-wrap">
      <div className="mcs-select-box">
        <select
          className="mcs-select"
          value={activeSlug || ""}
          onChange={(e) => onSelect(e.target.value || null)}
          aria-label="Выбор категории"
        >
          <option value="">{allLabel}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
        <ChevronDown size={16} className="mcs-select-chevron" />
      </div>
    </div>
  );
}
