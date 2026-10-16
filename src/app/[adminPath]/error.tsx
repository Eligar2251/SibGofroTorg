// =========================================================
// FILE: src/app/[adminPath]/error.tsx
// Дружелюбный экран ошибки админки.
//
// РАНЬШЕ: при сбое базы React выбрасывал «An error occurred in the Server
// Components render. The specific message is omitted in production builds…» —
// понять по этому тексту причину невозможно, и он же попадал в консоль.
//
// ТЕПЕРЬ: страница объясняет, что чаще всего происходит (нет связи с базой,
// истекла сессия, сбой в модуле), и даёт кнопки «Повторить» и «Войти заново».
// Digest ошибки показывается для поиска в логах контейнера.
// =========================================================

"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useEffect } from "react";
import { CircleAlert, RefreshCw } from "lucide-react";

const card: React.CSSProperties = {
  maxWidth: 640,
  margin: "40px auto",
  background: "var(--adm-card)",
  border: "1px solid var(--adm-rust-line)",
  borderRadius: 16,
  padding: "22px 24px",
  color: "var(--adm-ink)",
};

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const pathname = usePathname() || "";
  const adminPath = pathname.split("/").filter(Boolean)[0] || "admin";

  useEffect(() => {
    console.error("[админка] ошибка рендера:", error);
  }, [error]);

  return (
    <div style={card}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 17, fontWeight: 700 }}>
        <CircleAlert size={20} color="var(--adm-rust)" aria-hidden />
        Раздел не загрузился
      </div>

      <p style={{ margin: "12px 0 0", fontSize: 14, lineHeight: 1.6 }}>
        Обычно это значит одно из трёх:
      </p>
      <ul style={{ margin: "8px 0 0 18px", padding: 0, fontSize: 14, lineHeight: 1.7 }}>
        <li>
          <b>нет связи с базой Supabase</b> (проект на паузе, ротированный ключ,
          сетевые блокировки) — тогда падает вся панель, а сайт продолжает
          открываться из кэша;
        </li>
        <li>
          <b>истекла сессия</b> — войдите заново, данные не потеряны;
        </li>
        <li>ошибка в конкретном разделе — остальные вкладки при этом работают.</li>
      </ul>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 18 }}>
        <button type="button" className="admin-btn" onClick={() => reset()}>
          <RefreshCw size={15} />
          <span style={{ marginLeft: 6 }}>Повторить</span>
        </button>
        <Link className="admin-btn" href={`/${adminPath}/login`}>
          <span>Войти заново</span>
        </Link>
      </div>

      {error.digest ? (
        <p
          style={{
            margin: "16px 0 0",
            fontSize: 12,
            color: "var(--adm-muted)",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          }}
        >
          Код ошибки для логов: {error.digest}
        </p>
      ) : null}
    </div>
  );
}
