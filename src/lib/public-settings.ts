// =========================================================
// FILE: src/lib/public-settings.ts
// Серверный доступ к публичным настройкам компании для SSR-страниц
// (главная уже читает getSettings сама; этот хелпер — общая точка
// для контактов, доставки, лендингов и оформления заказа).
//
// Все ключевые данные редактируются в админке «Настройки» и здесь
// превращаются в готовые к показу строки — страницы не должны
// хардкодить телефоны/часы/пороги бесплатной доставки.
// =========================================================

import { getSettings } from "@/lib/supabase-queries";
import {
  SITE_ADDRESS,
  SITE_EMAIL,
  SITE_PHONE,
  SITE_PHONE_HREF,
  SITE_HOURS_WEEKDAY,
} from "@/lib/site-config";
import {
  buildHoursLabel,
  buildWeekdayLabel,
  extractWeekdayHours,
  DEFAULT_HOURS_WEEKDAY,
} from "@/lib/hours-label";
import { getWastepaperPageConfig } from "@/lib/wastepaper";

export const DEFAULT_DELIVERY_PRICE = 800;
export const DEFAULT_FREE_DELIVERY_THRESHOLD = 30000;

export interface PublicSettingsView {
  /** Основной телефон отдела продаж */
  phone: string;
  phoneHref: string;
  email: string;
  address: string;
  /** Сырое значение working_hours из БД (может быть пустым) */
  workingHours: string;
  /** Полная фраза «Пн–Пт 8:30–17:00 · Сб, Вс — выходные» */
  hoursLabel: string;
  /** Короткая фраза «Пн–Пт 8:30–17:00» (карточки, самовывоз) */
  weekdayLabel: string;
  /** Только время «8:30–17:00» (для «в будни с … до …») */
  weekdayHours: string;
  deliveryPrice: number;
  freeDeliveryThreshold: number;
  /** Телефон отдела приёма макулатуры */
  wastepaperPhone: string;
  wastepaperPhoneHref: string;
}

/** Формат суммы в рублях для текстов: 30000 → «30 000» */
export function formatRubles(n: number): string {
  return n.toLocaleString("ru-RU");
}

export async function getPublicSettingsView(): Promise<PublicSettingsView> {
  const settings = await getSettings().catch(
    () => ({}) as Record<string, string>
  );

  const phone = (settings.phone || SITE_PHONE || "").trim();
  const deliveryPrice = Number(settings.delivery_price);
  const freeDeliveryThreshold = Number(settings.free_delivery_threshold);
  const wpCfg = getWastepaperPageConfig(settings);

  return {
    phone,
    phoneHref: phone ? `tel:${phone.replace(/[^\d+]/g, "")}` : SITE_PHONE_HREF,
    email: (settings.email || SITE_EMAIL || "").trim(),
    address: (settings.address || SITE_ADDRESS || "").trim(),
    workingHours: (settings.working_hours || "").trim(),
    hoursLabel: buildHoursLabel(settings.working_hours, SITE_HOURS_WEEKDAY),
    weekdayLabel: buildWeekdayLabel(settings.working_hours, SITE_HOURS_WEEKDAY),
    weekdayHours: extractWeekdayHours(
      settings.working_hours,
      SITE_HOURS_WEEKDAY || DEFAULT_HOURS_WEEKDAY
    ),
    deliveryPrice:
      Number.isFinite(deliveryPrice) && deliveryPrice >= 0
        ? deliveryPrice
        : DEFAULT_DELIVERY_PRICE,
    freeDeliveryThreshold:
      Number.isFinite(freeDeliveryThreshold) && freeDeliveryThreshold > 0
        ? freeDeliveryThreshold
        : DEFAULT_FREE_DELIVERY_THRESHOLD,
    wastepaperPhone: wpCfg.phone,
    wastepaperPhoneHref: wpCfg.phoneHref,
  };
}
