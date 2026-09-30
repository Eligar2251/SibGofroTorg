"use client";

import { useRouter } from "next/navigation";
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

const BOX_FINDER_VALUE = "__box-finder__";

/** Мобильный выпадающий список категорий — заменяет чипы на узких экранах */
export function MobileCategorySelect({
  categories,
  activeSlug,
  onSelect,
  allLabel = "Все категории",
}: MobileCategorySelectProps) {
  const router = useRouter();

  return (
    <div className="mcs-wrap">
      <div className="mcs-select-box">
        <select
          className="mcs-select"
          value={activeSlug || ""}
          onChange={(e) => {
            const val = e.target.value;
            if (val === BOX_FINDER_VALUE) {
              router.push("/podbor-korobki");
              return;
            }
            onSelect(val || null);
          }}
          aria-label="Выбор категории"
        >
          <option value={BOX_FINDER_VALUE}>Подбор коробки по размерам</option>
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
