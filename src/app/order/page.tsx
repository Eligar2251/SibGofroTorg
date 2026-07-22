// =========================================================
// FILE: src/app/order/page.tsx
// Серверная обёртка: достаёт настройки доставки (цена и порог
// бесплатной — редактируются в админке) и передаёт в клиентскую форму.
// =========================================================

import { getSettings } from "@/lib/firestore-queries";
import { OrderPageClient } from "./OrderPageClient";

export default async function OrderPage() {
  let deliveryPrice = 800;
  let freeDeliveryThreshold = 30000;
  try {
    const settings = await getSettings();
    const price = Number(settings.delivery_price);
    const threshold = Number(settings.free_delivery_threshold);
    if (Number.isFinite(price) && price >= 0) deliveryPrice = price;
    if (Number.isFinite(threshold) && threshold > 0)
      freeDeliveryThreshold = threshold;
  } catch {
    // без настроек/БД используем значения по умолчанию
  }

  return (
    <OrderPageClient
      deliveryPrice={deliveryPrice}
      freeDeliveryThreshold={freeDeliveryThreshold}
    />
  );
}
