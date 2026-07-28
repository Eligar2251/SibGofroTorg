// src/components/order/SuccessContactPhone.tsx
//
// Блок «Срочный вопрос? Позвоните нам» на странице успешного заказа.
// Подхватывает телефон и режим работы из настроек (админка
// «Настройки → Контактная информация»), чтобы при смене номера
// не пришлось править код.

"use client";

import { PhoneCall } from "lucide-react";
import { useSiteSettings } from "@/hooks/use-site-settings";
import { SITE_HOURS_LABEL, SITE_PHONE, SITE_PHONE_HREF } from "@/lib/site-config";

export function SuccessContactPhone() {
  const { phone, phoneHref, hoursLabel } = useSiteSettings();
  const displayPhone = phone || SITE_PHONE;
  const displayHref = phoneHref || SITE_PHONE_HREF;
  const displayHours = hoursLabel || SITE_HOURS_LABEL;
  return (
    <>
      <a href={displayHref} className="success-phone">
        <PhoneCall size={18} /> {displayPhone}
      </a>
      <div className="success-phone-hours">{displayHours}</div>
    </>
  );
}
