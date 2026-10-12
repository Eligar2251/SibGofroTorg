// =========================================================
// FILE: src/app/order/page.tsx
// Серверная обёртка: передаёт в форму настройки доставки из админки.
// =========================================================

import { getPublicSettingsView } from "@/lib/public-settings";
import { OrderPageClient } from "./OrderPageClient";

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
