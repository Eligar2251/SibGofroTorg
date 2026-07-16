"use client";

import { useState, useEffect, useRef } from "react";
import { Search, Loader2 } from "lucide-react";

interface InstantSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  loading?: boolean;
  className?: string;
  inputClassName?: string;
  buttonClassName?: string;
}

export function InstantSearchInput({
  value,
  onChange,
  placeholder = "Поиск товаров...",
  loading,
  className,
  inputClassName,
  buttonClassName,
}: InstantSearchInputProps) {
  const [localValue, setLocalValue] = useState(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function handleChange(next: string) {
    setLocalValue(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onChange(next), 300);
  }

  return (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        if (debounceRef.current) clearTimeout(debounceRef.current);
        onChange(localValue.trim());
      }}
    >
      <input
        type="text"
        value={localValue}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className={inputClassName}
      />
      <button type="submit" className={buttonClassName} aria-label="Найти">
        {loading ? (
          <Loader2 size={15} className="animate-spin" />
        ) : (
          <Search size={15} />
        )}
      </button>
    </form>
  );
}