// =========================================================
// FILE: src/app/order/page.tsx
// Серверная обёртка: достаёт настройки доставки (цена и порог
// бесплатной — редактируются в админке) и передаёт в клиентскую форму.
// Адрес и режим работы склада для блока «Самовывоз» берутся из тех
// же настроек, что на странице контактов, — не дублируем их в коде.
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
