"use client";

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

export function MessengerFloatingBanner() {
  const { messengerBanner, ready } = useSiteSettings();
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

  if (!ready || !messengerBanner.enabled || !channels.some((channel) => channel.href)) {
    return null;
  }

  return (
    <aside className="messenger-float" aria-label="Мы есть в мессенджерах">
      <span className="messenger-float__text">
        {messengerBanner.text || "Мы есть в мессенджерах"}
      </span>
      <div className="messenger-float__links">
        {channels.map((channel) => {
          const content = channel.iconUrl ? (
            // Иконку загружает администратор, поэтому это обычный URL изображения.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={channel.iconUrl} alt="" />
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
              aria-label={`Открыть чат в ${channel.label}`}
              title={channel.label}
            >
              {content}
            </a>
          ) : (
            <span
              key={channel.id}
              className="messenger-float__link messenger-float__link--disabled"
              aria-label={`${channel.label}: ссылка не настроена`}
              title={`${channel.label}: ссылка не настроена`}
            >
              {content}
            </span>
          );
        })}
      </div>
    </aside>
  );
}
