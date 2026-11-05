// =========================================================
// FILE: src/components/layout/BegetEmergencyBanner.tsx
// Информационный баннер об аварийном режиме сайта из-за проблем
// в дата-центре Beget с прямыми контактами для клиентов.
// По умолчанию включён; чтобы скрыть после восстановления ДЦ без
// правки кода, достаточно задать NEXT_PUBLIC_EMERGENCY_BANNER=0 в .env.
// =========================================================

"use client";

import { AlertTriangle, Mail, Phone } from "lucide-react";

const BANNER_ENV = process.env.NEXT_PUBLIC_EMERGENCY_BANNER;
const IS_ENABLED =
  BANNER_ENV === undefined ||
  (BANNER_ENV !== "0" && BANNER_ENV.toLowerCase() !== "false");

export function BegetEmergencyBanner() {
  if (!IS_ENABLED) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        background: "linear-gradient(90deg, #7f1d1d 0%, #991b1b 50%, #7c2d12 100%)",
        color: "#fffbeb",
        borderBottom: "2px solid #f59e0b",
        padding: "10px 16px",
        fontSize: 13.5,
        lineHeight: 1.45,
        position: "relative",
        zIndex: 60,
      }}
    >
      <div
        style={{
          maxWidth: 1280,
          margin: "0 auto",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "center",
          gap: "8px 16px",
          textAlign: "center",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontWeight: 600,
          }}
        >
          <AlertTriangle
            size={18}
            style={{ color: "#fbbf24", flexShrink: 0 }}
            aria-hidden="true"
          />
          <span>
            Дата-центр в Beget столкнулся с проблемами, поэтому сайт временно
            функционирует в аварийном режиме. Пожалуйста, обратитесь по номеру
            или на почту:
          </span>
        </span>

        <span
          style={{
            display: "inline-flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px 12px",
          }}
        >
          <a
            href="tel:+79139158146"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 11px",
              borderRadius: 999,
              background: "#fbbf24",
              color: "#1f2937",
              fontWeight: 800,
              textDecoration: "none",
              whiteSpace: "nowrap",
              fontSize: 13.5,
            }}
          >
            <Phone size={14} aria-hidden="true" />
            +7 913 915 81 46
          </a>

          <a
            href="mailto:sk2-tdstm@mail.ru"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 11px",
              borderRadius: 999,
              background: "rgba(255, 255, 255, 0.16)",
              border: "1px solid rgba(255, 251, 235, 0.38)",
              color: "#fffbeb",
              fontWeight: 700,
              textDecoration: "none",
              whiteSpace: "nowrap",
              fontSize: 13.5,
            }}
          >
            <Mail size={14} aria-hidden="true" />
            sk2-tdstm@mail.ru
          </a>
        </span>
      </div>
    </div>
  );
}
