// =========================================================
// FILE: src/components/admin/MigrationButton.tsx
// Кнопка миграции данных из Firestore в Supabase.
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

export function MigrationButton() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<MigrationResult | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const handleMigrate = async () => {
    if (!confirm("Вы уверены, что хотите перенести все данные из Firestore в Supabase?\n\nЭто может занять несколько минут. Не закрывайте страницу.")) {
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const res = await fetch("/api/admin/migrate", { method: "POST" });
      const data = await res.json();
      setResult(data);
    } catch (err) {
      setResult({
        success: false,
        error: err instanceof Error ? err.message : "Неизвестная ошибка",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button
        onClick={handleMigrate}
        disabled={loading}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.75rem 1.5rem",
          borderRadius: "0.5rem",
          border: "none",
          backgroundColor: loading ? "#9ca3af" : "#2563eb",
          color: "white",
          fontSize: "0.875rem",
          fontWeight: 500,
          cursor: loading ? "not-allowed" : "pointer",
        }}
      >
        {loading ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            Перенос данных...
          </>
        ) : (
          <>
            <Database size={16} />
            Перенести из Firestore в Supabase
          </>
        )}
      </button>

      {result && (
        <div style={{ marginTop: "1rem" }}>
          {result.success ? (
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              color: "#16a34a",
              fontWeight: 500,
            }}>
              <CheckCircle size={20} />
              Миграция завершена!
            </div>
          ) : (
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              color: "#dc2626",
              fontWeight: 500,
            }}>
              <AlertTriangle size={20} />
              {result.error || "Произошла ошибка"}
            </div>
          )}

          {result.results && (
            <button
              onClick={() => setShowDetails(!showDetails)}
              style={{
                marginTop: "0.5rem",
                background: "none",
                border: "1px solid #d1d5db",
                borderRadius: "0.375rem",
                padding: "0.375rem 0.75rem",
                fontSize: "0.75rem",
                cursor: "pointer",
                color: "#6b7280",
              }}
            >
              {showDetails ? "Скрыть" : "Показать"} подробности
            </button>
          )}

          {showDetails && result.results && (
            <div style={{
              marginTop: "0.75rem",
              padding: "1rem",
              backgroundColor: "#f9fafb",
              borderRadius: "0.5rem",
              fontSize: "0.75rem",
              fontFamily: "monospace",
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
                  {result.errors && result.errors.length > 0 && (
                    <div style={{ marginTop: "0.25rem", color: "#6b7280" }}>
                      {result.errors.map((err, i) => (
                        <div key={i}>{err}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
