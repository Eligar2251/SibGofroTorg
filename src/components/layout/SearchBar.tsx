"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { Search, Loader2 } from "lucide-react";

interface Suggestion {
  id: string;
  name: string;
  slug: string;
  sku?: string | null;
  price: number | null;
  imageUrl?: string | null;
}

interface SearchBarProps {
  placeholder?: string;
  variant?: "header" | "panel" | "compact";
  action?: string;
  hiddenFields?: Record<string, string | undefined>;
  defaultValue?: string;
}

const WRAP_CLASS: Record<string, string> = {
  header: "header-search",
  panel: "search-panel-form-wrap",
  compact: "catalog-search-wrap",
};
const FORM_CLASS: Record<string, string> = {
  header: "",
  panel: "search-panel-form",
  compact: "sidebar-search-form",
};
const INPUT_CLASS: Record<string, string> = {
  header: "",
  panel: "search-panel-input",
  compact: "catalog-search-input",
};
const BTN_CLASS: Record<string, string> = {
  header: "",
  panel: "search-panel-btn",
  compact: "catalog-search-btn",
};

export function SearchBar({
  placeholder = "Поиск товаров...",
  variant = "header",
  action = "/search",
  hiddenFields,
  defaultValue = "",
}: SearchBarProps) {
  const [query, setQuery] = useState(defaultValue);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search/suggest?q=${encodeURIComponent(trimmed)}`);
        const data = await res.json();
        setSuggestions(Array.isArray(data) ? data : []);
        setIsOpen(true);
      } catch {
        setSuggestions([]);
      }
      setLoading(false);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const iconSize = variant === "header" ? 18 : variant === "panel" ? 16 : 15;

  return (
    <div ref={wrapRef} className={WRAP_CLASS[variant]}>
      <form action={action} method="GET" className={FORM_CLASS[variant]}>
        {hiddenFields && typeof hiddenFields === 'object' &&
          Object.entries(hiddenFields).map(([key, value]) =>
            value ? <input key={key} type="hidden" name={key} value={value} /> : null
          )}
        <input
          type="text"
          name="q"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => {
            if (suggestions.length > 0) setIsOpen(true);
          }}
          placeholder={placeholder}
          autoComplete="off"
          className={INPUT_CLASS[variant] || undefined}
        />
        <button type="submit" className={BTN_CLASS[variant] || undefined}>
          {loading ? <Loader2 size={iconSize} className="animate-spin" /> : <Search size={iconSize} />}
        </button>
      </form>

      {isOpen && suggestions.length > 0 && (
        <div className="search-suggestions">
          {suggestions.map((s) => (
            <Link
              key={s.id}
              href={`/catalog/product/${s.slug}`}
              className="search-suggestion-item"
              onClick={() => setIsOpen(false)}
            >
              <div className="search-suggestion-img">
                {s.imageUrl ? (
                  <Image src={s.imageUrl} alt={s.name} fill sizes="40px" style={{ objectFit: "cover" }} />
                ) : (
                  "📦"
                )}
              </div>
              <div className="search-suggestion-info">
                <div className="search-suggestion-name">{s.name}</div>
                {s.sku && <div className="search-suggestion-sku">{s.sku}</div>}
              </div>
              <div className="search-suggestion-price">
                {s.price != null ? `${s.price.toLocaleString("ru-RU")} ₽` : "—"}
              </div>
            </Link>
          ))}
          <Link
            href={`/search?q=${encodeURIComponent(query)}`}
            className="search-suggestion-all"
            onClick={() => setIsOpen(false)}
          >
            Показать все результаты →
          </Link>
        </div>
      )}
    </div>
  );
}