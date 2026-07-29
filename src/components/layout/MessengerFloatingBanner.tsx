"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useSiteSettings } from "@/hooks/use-site-settings";

function safeMessengerUrl(raw: string): string | null {
  const value = String(raw || "").trim();
  if (!/^https?:\/\//i.test(value)) return null;
  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

// Критическая геометрия продублирована inline: баннер остаётся плавающим
// даже при старом CSS в браузерном/CDN-кеше. Классы ниже отвечают за hover
// и мобильную донастройку после загрузки актуального stylesheet.
const bannerStyle: CSSProperties = {
  position: "fixed",
  zIndex: 850,
  right: 14,
  bottom: 24,
  display: "flex",
  alignItems: "center",
  gap: 12,
  maxWidth: "calc(100vw - 28px)",
  padding: "9px 11px 9px 14px",
  color: "#fff",
  background: "rgba(27, 43, 75, 0.96)",
  border: "1px solid rgba(255,255,255,.18)",
  borderRadius: 999,
  boxShadow: "0 8px 28px rgba(17,29,52,.24)",
};
const linksStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
};
const linkStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 38,
  height: 38,
  flex: "0 0 38px",
  overflow: "hidden",
  color: "#1b2b4b",
  background: "#fff",
  border: "2px solid rgba(255,255,255,.9)",
  borderRadius: "50%",
  boxShadow: "0 2px 8px rgba(0,0,0,.16)",
  textDecoration: "none",
};
const imageStyle: CSSProperties = {
  display: "block",
  width: "100%",
  height: "100%",
  objectFit: "cover",
};

export function MessengerFloatingBanner() {
  const { messengerBanner, ready } = useSiteSettings();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const channels = [
    {
      id: "telegram",
      label: "Telegram",
      short: "TG",
      ...messengerBanner.telegram,
    },
    {
      id: "whatsapp",
      label: "WhatsApp",
      short: "WA",
      ...messengerBanner.whatsapp,
    },
    {
      id: "max",
      label: "MAX",
      short: "MAX",
      ...messengerBanner.max,
    },
  ].map((channel) => ({ ...channel, href: safeMessengerUrl(channel.url) }));

  if (
    !mounted ||
    !ready ||
    !messengerBanner.enabled ||
    !channels.some((channel) => channel.href)
  ) {
    return null;
  }

  return createPortal(
    <aside
      className="messenger-float"
      style={bannerStyle}
      aria-label="Мы есть в мессенджерах"
    >
      <span
        className="messenger-float__text"
        style={{ fontSize: 11, fontWeight: 700, lineHeight: 1.2 }}
      >
        {messengerBanner.text || "Мы есть в мессенджерах"}
      </span>
      <div className="messenger-float__links" style={linksStyle}>
        {channels.map((channel) => {
          const content = channel.iconUrl ? (
            // Иконку загружает администратор, поэтому это обычный URL изображения.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={channel.iconUrl} alt="" style={imageStyle} />
          ) : (
            <span>{channel.short}</span>
          );

          return channel.href ? (
            <a
              key={channel.id}
              href={channel.href}
              target="_blank"
              rel="noopener noreferrer"
              className={`messenger-float__link messenger-float__link--${channel.id}`}
              style={linkStyle}
              aria-label={`Открыть чат в ${channel.label}`}
              title={channel.label}
            >
              {content}
            </a>
          ) : (
            <span
              key={channel.id}
              className="messenger-float__link messenger-float__link--disabled"
              style={{ ...linkStyle, opacity: 0.38, filter: "grayscale(1)" }}
              aria-label={`${channel.label}: ссылка не настроена`}
              title={`${channel.label}: ссылка не настроена`}
            >
              {content}
            </span>
          );
        })}
      </div>
    </aside>,
    document.body
  );
}
