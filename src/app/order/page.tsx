// =========================================================
// FILE: src/app/order/page.tsx
// Серверная обёртка: передаёт в форму настройки доставки из админки.
// =========================================================

import type { Metadata } from "next";
import { getPublicSettingsView } from "@/lib/public-settings";
import { SITE_URL } from "@/lib/seo";
import { OrderPageClient } from "./OrderPageClient";

export const metadata: Metadata = {
  title: "Корзина и оформление заказа",
  description:
    "Корзина СибГофроТорг: оформление заказа, самовывоз со склада или доставка по Новосибирску.",
  alternates: { canonical: `${SITE_URL}/order` },
  robots: { index: false, follow: false },
};

export default async function OrderPage() {
  const pub = await getPublicSettingsView();

  return (
    <OrderPageClient
      deliveryPrice={pub.deliveryPrice}
      freeDeliveryThreshold={pub.freeDeliveryThreshold}
      pickupAddress={pub.address}
      pickupHoursLabel={pub.weekdayLabel}
    />
  );
}
