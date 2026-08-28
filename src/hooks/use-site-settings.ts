// src/hooks/use-site-settings.ts
//
// Клиентский хук, который подхватывает с сервера настройки компании
// (телефон, email, адрес, режим работы) из /api/settings/public.
// Эти же значения редактируются в админке («Настройки → Контактная
// информация»), поэтому администратор может сменить телефон/email
// один раз — и они автоматически появятся в шапке, футере, на
// странице контактов, success-странице и в кабинете.
//
// Использование:
//   const { phone, email, phoneHref, hoursLabel, ready } = useSiteSettings();
//
// Значения приходят «as is» (строкой). Если в БД пусто, приходит
// дефолт из src/lib/site-config.ts.

"use client";

import { useEffect, useState } from "react";

export interface MessengerChannelSettings {
  url: string;
  iconUrl: string;
}

export interface MessengerBannerSettings {
  enabled: boolean;
  text: string;
  color: string;
  whatsapp: MessengerChannelSettings;
  max: MessengerChannelSettings;
}

export interface SiteSettings {
  phone: string;
  phoneHref: string;
  email: string;
  address: string;
  /** Сырое значение working_hours из БД (может быть пустым) */
  workingHours: string;
  /** Полная фраза «Пн–Пт 8:30–17:00 · Сб, Вс — выходные» */
  hoursLabel: string;
  /** Дефолт «8:30–17:00» для случая, когда админ задал только свои часы */
  hoursWeekday: string;
  messengerBanner: MessengerBannerSettings;
  registrationField: "phone" | "email";
  ready: boolean;
}

const DEFAULT_HOURS_WEEKDAY = "8:30–17:00";
const EMPTY_MESSENGER_BANNER: MessengerBannerSettings = {
  enabled: false,
  text: "Мы есть в мессенджерах",
  color: "#1b2b4b",
  whatsapp: { url: "", iconUrl: "" },
  max: { url: "", iconUrl: "" },
};

/** Превращает произвольное значение из БД в SITE_HOURS_LABEL-формат */
function buildHoursLabel(workingHours: string, weekdayFallback: string): string {
  // 1) Если в БД задан полный формат «Пн–Пт ...» — оставляем как есть.
  if (workingHours && /пн[‐-―‑–—]?пт/i.test(workingHours)) {
    return /сб.*вс|выходн/i.test(workingHours)
      ? workingHours
      : `${workingHours} · Сб, Вс — выходные`;
  }
  // 2) Если в БД только диапазон «8:30–17:00» — дополняем обвязкой.
  if (workingHours) {
    return `Пн–Пт ${workingHours} · Сб, Вс — выходные`;
  }
  // 3) Иначе используем дефолт «Пн–Пт 8:30–17:00».
  return `Пн–Пт ${weekdayFallback || DEFAULT_HOURS_WEEKDAY} · Сб, Вс — выходные`;
}

let cache: SiteSettings | null = null;
let inflight: Promise<SiteSettings> | null = null;

async function fetchSiteSettings(): Promise<SiteSettings> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/settings/public", { cache: "no-store" });
      if (!res.ok) throw new Error("settings/public failed");
      const data = await res.json();
      const phone = String(data.phone || "").trim();
      const email = String(data.email || "").trim();
      const address = String(data.address || "").trim();
      const workingHours = String(data.workingHours || "").trim();
      const hoursWeekday =
        String(data.hoursWeekday || "").trim() || DEFAULT_HOURS_WEEKDAY;
      const registrationField = String(data.registrationField || "phone").toLowerCase() === "email" ? "email" as const : "phone" as const;
      const rawBanner = data.messengerBanner || {};
      const messengerBanner: MessengerBannerSettings = {
        enabled: rawBanner.enabled === true,
        text:
          String(rawBanner.text || "").trim() ||
          EMPTY_MESSENGER_BANNER.text,
        color: /^#[0-9a-f]{6}$/i.test(String(rawBanner.color || ""))
          ? String(rawBanner.color)
          : EMPTY_MESSENGER_BANNER.color,
        whatsapp: {
          url: String(rawBanner.whatsapp?.url || "").trim(),
          iconUrl: String(rawBanner.whatsapp?.iconUrl || "").trim(),
        },
        max: {
          url: String(rawBanner.max?.url || "").trim(),
          iconUrl: String(rawBanner.max?.iconUrl || "").trim(),
        },
      };
      const settings: SiteSettings = {
        phone,
        phoneHref: `tel:${phone.replace(/[^\d+]/g, "")}`,
        email,
        address,
        workingHours,
        hoursLabel: buildHoursLabel(workingHours, hoursWeekday),
        hoursWeekday,
        messengerBanner,
        registrationField,
        ready: true,
      };
      cache = settings;
      return settings;
    } catch {
      // Сеть упала — отдаём «неготовые» пустые значения, компоненты
      // отрисуются со своими дефолтами из site-config.ts
      const empty: SiteSettings = {
        phone: "",
        phoneHref: "",
        email: "",
        address: "",
        workingHours: "",
        hoursLabel: "",
        hoursWeekday: DEFAULT_HOURS_WEEKDAY,
        messengerBanner: EMPTY_MESSENGER_BANNER,
        registrationField: "phone",
        ready: false,
      };
      cache = empty;
      return empty;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * Подписаться на публичные настройки компании (телефон/email/адрес/часы).
 * При первом монтировании делает fetch /api/settings/public, кеширует
 * результат на сессию — повторные компоненты (Header, Footer и т.д.)
 * не делают лишних запросов.
 */
export function useSiteSettings(): SiteSettings {
  const [settings, setSettings] = useState<SiteSettings>(() => cache || {
    phone: "",
    phoneHref: "",
    email: "",
    address: "",
    workingHours: "",
    hoursLabel: "",
    hoursWeekday: DEFAULT_HOURS_WEEKDAY,
    messengerBanner: EMPTY_MESSENGER_BANNER,
    registrationField: "phone",
    ready: false,
  });

  useEffect(() => {
    let cancelled = false;
    fetchSiteSettings().then((s) => {
      if (!cancelled) setSettings(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return settings;
}

/**
 * Сбрасывает in-memory кеш. Вызывается в админке после сохранения
 * настроек, чтобы при следующем рендере клиентские компоненты сразу
 * получили свежие значения (без перезагрузки страницы).
 */
export function invalidateSiteSettingsCache(): void {
  cache = null;
  inflight = null;
}
