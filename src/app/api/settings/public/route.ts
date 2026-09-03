// src/app/settings/public — публичные настройки, которые читает сам сайт
// (шапка, подвал, страница контактов, success-страница и т. п.).
//
// Ключи совпадают с тем, что сохраняется в админке «Настройки → Контактная
// информация»: phone, email, address, working_hours. Если в БД значения
// нет, отдаём дефолт из src/lib/site-config.ts — чтобы клиентский код
// никогда не показывал «пустоту».
import { NextResponse } from "next/server";
import { getSettings } from "@/lib/supabase-queries";
import {
  SITE_ADDRESS,
  SITE_PHONE,
  SITE_EMAIL,
  SITE_HOURS_WEEKDAY,
} from "@/lib/site-config";
import { getWastepaperPageConfig } from "@/lib/wastepaper";

export async function GET() {
  try {
    const settings = (await getSettings()) || {};
    const deliveryPrice = Number(settings.delivery_price);
    const freeDeliveryThreshold = Number(settings.free_delivery_threshold);
    const messengerColor = /^#[0-9a-f]{6}$/i.test(
      String(settings.messenger_banner_color || "")
    )
      ? String(settings.messenger_banner_color)
      : "#1b2b4b";
    const registrationField = String(settings.registration_contact_field || "phone").toLowerCase() === "email" ? "email" : "phone";
    const wpCfg = getWastepaperPageConfig(settings);
    return NextResponse.json(
      {
        // Публичные контактные данные берём из БД (админка),
        // а если там пусто — подставляем дефолт из site-config.ts.
        phone: (settings.phone || SITE_PHONE || "").trim(),
        email: (settings.email || SITE_EMAIL || "").trim(),
        address: (settings.address || SITE_ADDRESS || "").trim(),
        // Отдельный номер отдела приёма макулатуры (вкладка «Макулатура»)
        wastepaperPhone: wpCfg.phone,
        wastepaperPhoneHref: wpCfg.phoneHref,
        // "Пн–Пт 8:30–17:00" или иной формат, сохранённый админом
        workingHours: (settings.working_hours || "").trim(),
        // Чтобы клиент мог собрать SITE_HOURS_LABEL даже когда в БД пусто
        hoursWeekday: SITE_HOURS_WEEKDAY,
        deliveryPrice:
          Number.isFinite(deliveryPrice) && deliveryPrice >= 0 ? deliveryPrice : 800,
        freeDeliveryThreshold:
          Number.isFinite(freeDeliveryThreshold) && freeDeliveryThreshold > 0
            ? freeDeliveryThreshold
            : 30000,
        registrationField,
        messengerBanner: {
          enabled: settings.messenger_banner_enabled !== "false",
          text: (settings.messenger_banner_text || "Мы есть в мессенджерах").trim(),
          color: messengerColor,
          whatsapp: {
            url: (settings.messenger_whatsapp_url || "").trim(),
            iconUrl: (settings.messenger_whatsapp_icon_url || "").trim(),
          },
          max: {
            url: (settings.messenger_max_url || "").trim(),
            iconUrl: (settings.messenger_max_icon_url || "").trim(),
          },
        },
        boxBadge: {
          enabled: settings.box_badge_enabled !== "false",
          text: (settings.box_badge_text || "подобрать коробку под ваши размеры").trim(),
        },
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        },
      }
    );
  } catch {
    return NextResponse.json(
      {
        phone: SITE_PHONE,
        email: SITE_EMAIL,
        address: SITE_ADDRESS,
        wastepaperPhone: getWastepaperPageConfig({}).phone,
        wastepaperPhoneHref: getWastepaperPageConfig({}).phoneHref,
        workingHours: "",
        hoursWeekday: SITE_HOURS_WEEKDAY,
        deliveryPrice: 800,
        freeDeliveryThreshold: 30000,
        registrationField: "phone",
        messengerBanner: {
          enabled: false,
          text: "Мы есть в мессенджерах",
          color: "#1b2b4b",
          whatsapp: { url: "", iconUrl: "" },
          max: { url: "", iconUrl: "" },
        },
        boxBadge: {
          enabled: true,
          text: "подобрать коробку под ваши размеры",
        },
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
      }
    );
  }
}
