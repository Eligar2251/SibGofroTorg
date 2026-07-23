// =========================================================
// FILE: src/components/admin/MigrationButton.tsx
// Кнопка миграции данных из Firestore в Supabase.
// Поддерживает перенос по одной коллекции.
// =========================================================

"use client";

import { useState } from "react";
import { Database, Loader2, CheckCircle, AlertTriangle } from "lucide-react";

interface MigrationResult {
  success: boolean;
  results?: Record<string, number>;
  errors?: string[];
  totalErrors?: number;
  error?: string;
}

const ALL_COLLECTIONS = [
  { key: "categories", label: "Категории" },
  { key: "products", label: "Товары" },
  { key: "users", label: "Пользователи" },
  { key: "admins", label: "Админы" },
  { key: "orders", label: "Заказы" },
  { key: "settings", label: "Настройки" },
  { key: "promotions", label: "Акции" },
  { key: "popupCampaigns", label: "Pop-up кампании" },
  { key: "productReviews", label: "Отзывы" },
  { key: "productQuestions", label: "Вопросы" },
  { key: "wastepaperRequests", label: "Заявки на макулатуру" },
  { key: "counterparties", label: "Контрагенты" },
  { key: "warehouseReceipts", label: "Поступления" },
  { key: "customerDeals", label: "Заказы покупателей" },
  { key: "bankPayments", label: "Платежи" },
  { key: "employees", label: "Сотрудники" },
  { key: "salaries", label: "Зарплаты" },
];

export function MigrationButton() {
  const [loading, setLoading] = useState(false);
  const [currentCollection, setCurrentCollection] = useState("");
  const [result, setResult] = useState<MigrationResult | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [allResults, setAllResults] = useState<Record<string, number>>({});
  const [mode, setMode] = useState<"all" | "single">("single");

  const migrateCollections = async (collections: string[]) => {
    setLoading(true);
    setResult(null);

    const combinedResults: Record<string, number> = { ...allResults };

    for (const collection of collections) {
      setCurrentCollection(collection);
      try {
        const res = await fetch("/api/admin/migrate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ collections: [collection] }),
        });
        const data = await res.json();
        if (data.success && data.results) {
          Object.assign(combinedResults, data.results);
        }
        if (data.errors && data.errors.length > 0) {
          setResult({ success: false, results: combinedResults, errors: data.errors, totalErrors: data.totalErrors });
          setLoading(false);
          setCurrentCollection("");
          setAllResults(combinedResults);
          return;
        }
      } catch (err) {
        setResult({
          success: false,
          results: combinedResults,
          error: err instanceof Error ? err.message : "Ошибка",
        });
        setLoading(false);
        setCurrentCollection("");
        setAllResults(combinedResults);
        return;
      }
    }

    setAllResults(combinedResults);
    setResult({ success: true, results: combinedResults });
    setLoading(false);
    setCurrentCollection("");
  };

  const handleMigrateAll = async () => {
    if (!confirm("Перенести ВСЕ данные из Firestore в Supabase?\n\nЭто может занять несколько минут.")) return;
    await migrateCollections(ALL_COLLECTIONS.map(c => c.key));
  };

  const handleMigrateSingle = async (key: string) => {
    const label = ALL_COLLECTIONS.find(c => c.key === key)?.label || key;
    if (!confirm(`Перенести «${label}» из Firestore в Supabase?`)) return;
    await migrateCollections([key]);
  };

  return (
    <div>
      {/* Переключатель режима */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <button
          onClick={() => setMode("single")}
          style={{
            padding: "0.375rem 0.75rem",
            borderRadius: "0.375rem",
            border: "1px solid",
            borderColor: mode === "single" ? "#2563eb" : "#d1d5db",
            backgroundColor: mode === "single" ? "#eff6ff" : "white",
            color: mode === "single" ? "#2563eb" : "#6b7280",
            fontSize: "0.8125rem",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          По одной коллекции
        </button>
        <button
          onClick={() => setMode("all")}
          style={{
            padding: "0.375rem 0.75rem",
            borderRadius: "0.375rem",
            border: "1px solid",
            borderColor: mode === "all" ? "#2563eb" : "#d1d5db",
            backgroundColor: mode === "all" ? "#eff6ff" : "white",
            color: mode === "all" ? "#2563eb" : "#6b7280",
            fontSize: "0.8125rem",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Все сразу
        </button>
      </div>

      {mode === "all" ? (
        <button
          onClick={handleMigrateAll}
          disabled={loading}
          style={{
            display: "inline-flex", alignItems: "center", gap: "0.5rem",
            padding: "0.75rem 1.5rem", borderRadius: "0.5rem", border: "none",
            backgroundColor: loading ? "#9ca3af" : "#2563eb",
            color: "white", fontSize: "0.875rem", fontWeight: 500,
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? (<><Loader2 size={16} className="animate-spin" />Переношу {currentCollection}...</>) : (<><Database size={16} />Перенести ВСЁ</>)}
        </button>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
          {ALL_COLLECTIONS.map(({ key, label }) => {
            const done = allResults[key] != null;
            const isCurrent = loading && currentCollection === key;
            return (
              <button
                key={key}
                onClick={() => handleMigrateSingle(key)}
                disabled={loading}
                style={{
                  display: "flex", alignItems: "center", gap: "0.5rem",
                  padding: "0.5rem 0.75rem", borderRadius: "0.375rem",
                  border: "1px solid #e5e7eb",
                  backgroundColor: isCurrent ? "#eff6ff" : done ? "#f0fdf4" : "white",
                  color: loading && !isCurrent ? "#9ca3af" : "#374151",
                  fontSize: "0.8125rem", fontWeight: 500,
                  cursor: loading ? "not-allowed" : "pointer",
                  textAlign: "left",
                }}
              >
                {isCurrent && <Loader2 size={14} className="animate-spin" style={{ color: "#2563eb" }} />}
                {done && !isCurrent && <CheckCircle size={14} style={{ color: "#16a34a" }} />}
                {!done && !isCurrent && <span style={{ width: 14 }} />}
                <span style={{ flex: 1 }}>{label}</span>
                {done && <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>{allResults[key]} записей</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* Результат */}
      {result && (
        <div style={{ marginTop: "1rem" }}>
          {result.success ? (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "#16a34a", fontWeight: 500 }}>
              <CheckCircle size={20} />
              Миграция завершена!
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "#dc2626", fontWeight: 500 }}>
              <AlertTriangle size={20} />
              {result.error || "Произошла ошибка"}
            </div>
          )}

          {result.results && Object.keys(result.results).length > 0 && (
            <>
              <button
                onClick={() => setShowDetails(!showDetails)}
                style={{
                  marginTop: "0.5rem", background: "none",
                  border: "1px solid #d1d5db", borderRadius: "0.375rem",
                  padding: "0.375rem 0.75rem", fontSize: "0.75rem",
                  cursor: "pointer", color: "#6b7280",
                }}
              >
                {showDetails ? "Скрыть" : "Показать"} подробности
              </button>

              {showDetails && (
                <div style={{
                  marginTop: "0.75rem", padding: "1rem",
                  backgroundColor: "#f9fafb", borderRadius: "0.5rem",
                  fontSize: "0.75rem", fontFamily: "monospace",
                }}>
                  {Object.entries(result.results).map(([collection, count]) => (
                    <div key={collection} style={{ display: "flex", justifyContent: "space-between", padding: "0.25rem 0" }}>
                      <span>{collection}:</span>
                      <strong>{count} записей</strong>
                    </div>
                  ))}
                  {result.totalErrors && result.totalErrors > 0 && (
                    <div style={{ color: "#dc2626", marginTop: "0.5rem" }}>
                      <strong>Ошибок: {result.totalErrors}</strong>
                      {result.errors?.map((err, i) => (
                        <div key={i} style={{ marginTop: "0.25rem", color: "#6b7280" }}>{err}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
