// src/components/order/SuccessContactPhone.tsx
//
// Контакты на странице успешного заказа: статус смотрите в ЛК
// или уточняйте по телефону / почте компании.

"use client";

import { Mail, PhoneCall } from "lucide-react";
import { useSiteSettings } from "@/hooks/use-site-settings";
import {
  SITE_EMAIL,
  SITE_HOURS_LABEL,
  SITE_PHONE,
  SITE_PHONE_HREF,
} from "@/lib/site-config";

export function SuccessContactPhone() {
  const { phone, phoneHref, hoursLabel, email } = useSiteSettings();
  const displayPhone = phone || SITE_PHONE;
  const displayHref = phoneHref || SITE_PHONE_HREF;
  const displayHours = hoursLabel || SITE_HOURS_LABEL;
  const displayEmail = email || SITE_EMAIL;
  return (
    <>
      <a href={displayHref} className="success-phone">
        <PhoneCall size={18} /> {displayPhone}
      </a>
      {displayEmail ? (
        <a href={`mailto:${displayEmail}`} className="success-email">
          <Mail size={16} /> {displayEmail}
        </a>
      ) : null}
      <div className="success-phone-hours">{displayHours}</div>
    </>
  );
}
