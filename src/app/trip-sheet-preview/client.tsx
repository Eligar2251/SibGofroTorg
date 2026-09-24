// src/app/trip-sheet-preview/client.tsx
// Моковые данные для dev-стенда: редактор точек + печать путевого листа.
"use client";

import "../admin.css";
import { useState } from "react";
import { TripStopsEditor } from "@/components/admin/TripStopsEditor";
import { TransportTripSheet, type TripSheetData } from "@/components/admin/TransportTripSheet";
import { TransportPrintSheet, type TransportPrintData } from "@/components/admin/TransportPrintSheet";
import { emptyCustomStop, stopKey, type TripStop } from "@/lib/trip-stops";
import type { PickerProduct } from "@/components/admin/ProductPicker";
import { TransportManager, type TransportDeal, type TransportRow } from "@/components/admin/TransportManager";

const PRODUCTS: PickerProduct[] = [
  { id: "p1", name: "Короб Т-24 (40×30×20)", sku: "KT24", price: 38, priceWholesale: 31, stockQty: 1200 },
  { id: "p2", name: "Короб Т-22 (40×30×25)", sku: "KT22", price: 42, priceWholesale: 34, stockQty: 860 },
  { id: "p3", name: "Go Box 60×40×40", sku: "GB60", price: 96, priceWholesale: 79, stockQty: 240 },
  { id: "p4", name: "Плёнка стрейч 500 мм, 2 кг", sku: "STR500", price: 210, priceWholesale: 180, stockQty: 96 },
  { id: "p5", name: "Скотч 48 мм × 66 м", sku: "SC48", price: 46, priceWholesale: 38, stockQty: 430 },
];

const STOPS: TripStop[] = [
  {
    key: "custom-1",
    kind: "custom",
    dealId: null,
    dealNumber: null,
    customerName: "ООО «ВторСырьё», приёмка",
    contactName: "Марина",
    phone: "+7 913 000-11-22",
    address: "ул. Топольская, 14, ворота со двора",
    deliveryNote: "Взять весовую, оплата наличными на месте",
    plannedTime: "09:00",
    tripType: "pickup",
    lines: [
      { productId: null, name: "Макулатура, связки", qty: 24 },
      { productId: null, name: "Поддоны деревянные (возврат)", qty: 6 },
    ],
    totalSum: null,
  },
  {
    key: "deal-d1",
    kind: "deal",
    dealId: "d1",
    dealNumber: 501,
    customerName: "Маркетол «Кедр»",
    contactName: "Артём",
    phone: "+7 913 222-33-44",
    address: "пр. Коммунистический, 28, офис 305",
    deliveryNote: "Домофон 305, звонить за 10 минут",
    plannedTime: "10:20",
    tripType: "delivery",
    lines: [
      { productId: "p1", name: "Короб Т-24 (40×30×20)", qty: 120, orderedQty: 150, maxQty: 150 },
      { productId: "p5", name: "Скотч 48 мм × 66 м", qty: 20, orderedQty: 20, maxQty: 20 },
    ],
    totalSum: 5360,
  },
  {
    key: "deal-d2",
    kind: "deal",
    dealId: "d2",
    dealNumber: 502,
    customerName: "ИП Савельева (пункт выдачи)",
    contactName: "Ольга",
    phone: "+7 923 111-00-99",
    address: "ул. Кирова, 51, помещение 8",
    deliveryNote: "Приёмка только до 12:00",
    plannedTime: "11:40",
    tripType: "delivery",
    lines: [
      { productId: "p3", name: "Go Box 60×40×40", qty: 40, orderedQty: 40, maxQty: 40 },
      { productId: "p4", name: "Плёнка стрейч 500 мм, 2 кг", qty: 6, orderedQty: 10, maxQty: 10 },
    ],
    totalSum: 4290,
  },
  {
    key: "custom-2",
    kind: "custom",
    dealId: null,
    dealNumber: null,
    customerName: "Типография «Оттиск»",
    contactName: "",
    phone: "+7 383 200-70-70",
    address: "ул. Станционная, 60, корпус 2",
    deliveryNote: "Сдать обрезки гофрокартона на переработку",
    plannedTime: "13:00",
    tripType: "handover",
    lines: [{ productId: null, name: "Обрезки гофрокартона", qty: 18 }],
    totalSum: null,
  },
  {
    key: "deal-d3",
    kind: "deal",
    dealId: "d3",
    dealNumber: 503,
    customerName: "Склад «Лесной», бокс 12",
    contactName: "Денис (охрана)",
    phone: "+7 950 300-40-50",
    address: "Лесной склад, бокс 12",
    deliveryNote: "",
    plannedTime: "14:30",
    tripType: "delivery",
    lines: [{ productId: "p2", name: "Короб Т-22 (40×30×25)", qty: 60, orderedQty: 60, maxQty: 60 }],
    totalSum: 2520,
  },
  // Макулатура: приём (ПМ) — забор, сдача (СМ) — вывоз на переработку.
  // В бланке это «ЗАБОР МАКУЛАТУРЫ» и «СДАЧА МАКУЛАТУРЫ».
  {
    key: "wp-intake-1",
    kind: "wp_intake",
    dealId: null,
    dealNumber: null,
    wpDocId: "wpi-1",
    wpDocKind: "intake",
    wpDocNumber: 12,
    customerName: "ООО «Макулатура Сибири»",
    contactName: "Сергей",
    phone: "+7 913 777-88-99",
    address: "ул. Большевистская, 131, склад 4",
    deliveryNote: "Вес уточним на площадке, оплата наличными",
    plannedTime: "08:30",
    tripType: "pickup",
    lines: [{ productId: null, name: "Картон (МС-5Б)", qty: 0 }],
    totalSum: null,
  },
  {
    key: "wp-shipment-1",
    kind: "wp_shipment",
    dealId: null,
    dealNumber: null,
    wpDocId: "wps-1",
    wpDocKind: "shipment",
    wpDocNumber: 7,
    customerName: "Переработка «ЭкоБум»",
    contactName: "Приёмка",
    phone: "+7 383 300-40-50",
    address: "ул. Петухова, 17, весовая №2",
    deliveryNote: "Заезд через весовую, талон не терять",
    plannedTime: "15:20",
    tripType: "handover",
    lines: [{ productId: null, name: "Макулатура МС-5Б", qty: 1200 }],
    totalSum: null,
  },
  // Поставка (ПО): забираем товар у поставщика — «ЗАБОР ТОВАРА».
  {
    key: "receipt-1",
    kind: "receipt",
    dealId: null,
    dealNumber: null,
    receiptId: "r-1",
    receiptNumber: 88,
    customerName: "Поставщик «ГофраОпт»",
    contactName: "Наталья",
    phone: "+7 383 210-30-40",
    address: "ул. Тайгинская, 3, склад готовой продукции",
    deliveryNote: "Документы забрать в офисе, 2 этаж",
    plannedTime: "16:40",
    tripType: "pickup",
    lines: [{ productId: "p1", name: "Короб Т-24 (40×30×20)", qty: 500 }],
    totalSum: null,
  },
];

const PENDING_DEALS: TransportDeal[] = [
  {
    id: "d4",
    number: 504,
    customerName: "Курьер-пункт «Восход»",
    customerPhone: "+7 913 444-55-66",
    deliveryAddress: "ул. Восход, 2а, павильон 14",
    items: [
      { productId: "p1", name: "Короб Т-24 (40×30×20)", quantity: 50 },
      { productId: "p2", name: "Короб Т-22 (40×30×25)", quantity: 30 },
    ],
    shippedItems: [{ productId: "p1", shippedQty: 10 }],
    deliveryItems: [],
    totalSum: 3100,
  },
  {
    id: "d5",
    number: 505,
    customerName: "ООО «Пеллет-Сибирь»",
    customerPhone: "+7 383 555-66-77",
    deliveryAddress: "ул. Полевая, 8 (цех №2)",
    items: [{ productId: "p3", name: "Go Box 60×40×40", quantity: 25 }],
    shippedItems: [],
    deliveryItems: [],
    totalSum: 2400,
  },
];

const TRANSPORTS: TransportRow[] = [
  {
    id: "t1",
    number: 127,
    date: "2026-09-17",
    plannedDate: "2026-09-17",
    driverName: "Ковалёв Сергей Игоревич",
    driverPhone: "+7 913 999-11-00",
    status: "draft",
    note: "Топливо залито. После 15:00 звонить диспетчеру.",
    totalItems: 194,
    createdAt: "2026-09-16T04:20:00.000Z",
    items: [
      {
        dealId: "d4",
        dealNumber: 504,
        customerName: "Курьер-пункт «Восход»",
        contactName: "Ирина",
        address: "ул. Восход, 2а, павильон 14",
        phone: "+7 913 444-55-66",
        deliveryNote: "Звонить в ворота слева",
        plannedTime: "10:00",
        totalSum: 3100,
        tripType: "delivery",
        items: [
          { productId: "p1", name: "Короб Т-24 (40×30×20)", orderedQty: 40, transportQty: 40 },
          { productId: "p2", name: "Короб Т-22 (40×30×25)", orderedQty: 30, transportQty: 30 },
        ],
      },
      {
        dealId: null,
        dealNumber: null,
        customerName: "ООО «ВторСырьё», приёмка",
        address: "ул. Топольская, 14",
        phone: "+7 913 000-11-22",
        contactName: "Марина",
        deliveryNote: "Забрать поддоны",
        plannedTime: "09:00",
        totalSum: null,
        tripType: "pickup",
        items: [{ productId: null, name: "Поддоны деревянные", orderedQty: 8, transportQty: 8 }],
      },
      {
        dealId: "d5",
        dealNumber: 505,
        customerName: "ООО «Пеллет-Сибирь»",
        address: "ул. Полевая, 8 (цех №2)",
        phone: "+7 383 555-66-77",
        contactName: null,
        deliveryNote: null,
        plannedTime: null,
        totalSum: 2400,
        tripType: "handover",
        items: [{ productId: "p3", name: "Go Box 60×40×40", orderedQty: 116, transportQty: 116 }],
      },
    ],
  },
];

export function TripSheetPreviewClient({
  autoOpenSheet = false,
  showManager = false,
}: {
  autoOpenSheet?: boolean;
  showManager?: boolean;
}) {
  const [stops, setStops] = useState<TripStop[]>(STOPS);
  const [manualSheet, setManualSheet] = useState(false);
  const [strips, setStrips] = useState<TransportPrintData | null>(null);

  const tripData: TripSheetData = {
    transportNumber: 128,
    date: "2026-09-17",
    note: "Топливо залито. После 15:00 звонить диспетчеру.",
    driverName: "Ковалёв Сергей Игоревич",
    driverPhone: "+7 913 999-11-00",
    stops,
    companyPhone: "+7 (383) 202-35-35",
    companyAddress: "Новосибирск, ул. Станционная, 60",
  };
  // Открытый по ссылке бланк (/trip-sheet-preview?sheet=1) — чтобы можно
  // было смотреть печать, не кликая.
  const sheet = autoOpenSheet || manualSheet ? tripData : null;

  function addNoiseStops(count: number) {
    setStops((prev) => {
      const next = [...prev];
      for (let i = 0; i < count; i += 1) {
        const stop = emptyCustomStop();
        next.push({
          ...stop,
          key: stopKey("mock"),
          customerName: `Точка ${next.length + 1}`,
          address: `ул. Тестовая, ${next.length + 1}`,
          tripType: next.length % 2 === 0 ? "pickup" : "delivery",
          lines: [{ productId: null, name: "Короб гофрокартон", qty: 10 + i }],
        });
      }
      return next;
    });
  }

  return (
    <div style={{ padding: 24, maxWidth: 920, margin: "0 auto", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 20, margin: "0 0 6px" }}>Dev-стенд: путевой лист</h1>
      <p style={{ color: "#6b6b60", fontSize: 13, marginTop: 0 }}>
        Порядок точек = порядок в бланке. Тяните карточку за ⠿ или жмите ↑↓, меняйте пометку, время и груз.
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0 16px" }}>
        <button type="button" className="admin-btn admin-btn--primary" onClick={() => setManualSheet(true)}>
          Открыть путевой лист (А4)
        </button>
        <button
          type="button"
          className="admin-btn admin-btn--outline"
          onClick={() =>
            setStrips({
              transportNumber: 128,
              date: "2026-09-17",
              driverName: "Ковалёв С.И.",
              driverPhone: "+7 913 999-11-00",
              items: stops
                .filter((s) => s.lines.some((l) => l.qty > 0))
                .map((s) => ({
                  dealNumber: s.dealNumber ?? 0,
                  customerName: s.customerName,
                  contactName: s.contactName,
                  address: s.address,
                  phone: s.phone,
                  deliveryNote: s.deliveryNote,
                  tripType: s.tripType,
                  items: s.lines.filter((l) => l.qty > 0).map((l) => ({ name: l.name, transportQty: l.qty })),
                })),
              companyPhone: "+7 (383) 202-35-35",
              companyAddress: "Новосибирск, ул. Станционная, 60",
            })
          }
        >
          Открыть полоски под УПД
        </button>
        <button type="button" className="admin-btn admin-btn--ghost" onClick={() => addNoiseStops(4)}>
          + 4 точки (проверка второй страницы)
        </button>
        <button type="button" className="admin-btn admin-btn--ghost" onClick={() => setStops(STOPS)}>
          Сбросить
        </button>
      </div>

      <TripStopsEditor
        stops={stops}
        defaultOpen="all"
        onChange={setStops}
        products={PRODUCTS}
        onOpenDeal={() => {}}
        title="Точки маршрута по порядку"
        hint="тот же порядок уйдёт в бланк"
      />

      {showManager && (
        <div style={{ marginTop: 28, paddingTop: 18, borderTop: "2px dashed #dbd8d0" }}>
          <h2 style={{ fontSize: 15, margin: "0 0 4px" }}>Как это выглядит в админке (моковые данные)</h2>
          <p style={{ fontSize: 12, color: "#6b6b60", marginTop: 0 }}>
            Сохранение здесь, естественно, не работает — это стенд. Кликабельно всё: порядок точек,
            пометки, «Путевой лист (А4)», модалка «Новая перевозка».
          </p>
          <div data-admin="true">
            <TransportManager
              transports={TRANSPORTS}
              pendingDeals={PENDING_DEALS}
              drivers={[
                { id: "dr1", name: "Ковалёв Сергей Игоревич", phone: "+7 913 999-11-00" },
                { id: "dr2", name: "Титов Андрей", phone: "+7 913 777-88-99" },
              ]}
              focusTransportId={showManager ? "t1" : null}
              products={PRODUCTS}
              companyPhone="+7 (383) 202-35-35"
              companyAddress="Новосибирск, ул. Станционная, 60"
            />
          </div>
        </div>
      )}

      {sheet && <TransportTripSheet data={sheet} onDone={() => setManualSheet(false)} />}
      {strips && <TransportPrintSheet data={strips} onDone={() => setStrips(null)} />}
    </div>
  );
}
