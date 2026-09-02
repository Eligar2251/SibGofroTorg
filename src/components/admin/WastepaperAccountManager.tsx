// =========================================================
// FILE: src/components/admin/WastepaperAccountManager.tsx
// Отдельный учёт макулатуры — рабочее место макулатурщика.
// Вкладки: Дни и финансы (остатки по дням, прогноз), Платежи
// (нал/безнал вместе и по отдельности), Приём от клиентов,
// Сдачи на предприятие, Перевозки (планирование рейсов с
// быстрой правкой при ЧП), Контрагенты.
// Модуль не связан с сайтом и товарным учётом.
// =========================================================

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Search,
  Loader2,
  X,
  Pencil,
  Trash2,
  RotateCcw,
  Banknote,
  CreditCard,
  ArrowDownLeft,
  ArrowUpRight,
  Truck,
  MapPin,
  PackageOpen,
  PackageCheck,
  ChevronDown,
  ChevronUp,
  Scale,
  Check,
} from "lucide-react";
import { useAdminRealtime } from "@/lib/use-admin-realtime";
import { useBodyLock } from "@/hooks/use-body-lock";
import type { WastepaperRates } from "@/lib/wastepaper";
import {
  WP_ACCOUNT_LABELS,
  WP_COUNTERPARTY_ROLE_LABELS,
  WP_STOP_STATUS_LABELS,
  WP_TRANSPORT_STATUS_LABELS,
  WP_TYPE_LABELS,
  WP_TYPE_OPTIONS,
  buildWpDayReport,
  fmtDate,
  fmtKg,
  fmtMoney,
  fmtTime,
  getWpBalance,
  getWpForecast,
  getWpStock,
  wpCollectMoneyEvents,
  wpTypeLabel,
  type WpAccount,
  type WpCounterparty,
  type WpIntake,
  type WpManualPayment,
  type WpMoneyEvent,
  type WpShipment,
  type WpTransport,
  type WpTransportItem,
} from "@/lib/wastepaper-account-shared";

/* ── Константы и хелперы ───────────────────────────────── */

const TABS = [
  { key: "days", label: "Дни и финансы" },
  { key: "payments", label: "Платежи" },
  { key: "intakes", label: "Приём" },
  { key: "shipments", label: "Сдачи" },
  { key: "transports", label: "Перевозки" },
  { key: "counterparties", label: "Контрагенты" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtPaidAt(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })} ${d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
}

/** Разбор числа из инпута: «1 234,5» / «1234.5» → 1234.5 */
function parseNum(raw: string): number {
  const n = Number(String(raw).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** Свободный ввод примерного времени: допускаем «~14:00», «утром» и т.п. */
function approxTimeOk(raw: string): boolean {
  return String(raw).trim().length <= 30;
}

const ACCOUNT_BADGE: Record<WpAccount, string> = {
  cash: "admin-badge admin-badge--teal",
  bank: "admin-badge admin-badge--indigo",
};

const KIND_BADGE: Record<WpMoneyEvent["kind"], { cls: string; label: string }> = {
  intake: { cls: "admin-badge admin-badge--amber", label: "Приём" },
  shipment: { cls: "admin-badge admin-badge--teal", label: "Сдача" },
  manual: { cls: "admin-badge admin-badge--blue", label: "Платёж" },
};

const TRANSPORT_BADGE: Record<string, string> = {
  planned: "admin-badge admin-badge--blue",
  active: "admin-badge admin-badge--amber",
  completed: "admin-badge admin-badge--green",
  cancelled: "admin-badge admin-badge--muted",
};

const STOP_BADGE: Record<string, string> = {
  pending: "admin-badge admin-badge--muted",
  done: "admin-badge admin-badge--green",
  skipped: "admin-badge admin-badge--red",
};

/** Конец API по виду денежного события. */
function apiBaseForEvent(e: WpMoneyEvent): string {
  if (e.kind === "intake") return "intakes";
  if (e.kind === "shipment") return "shipments";
  return "payments";
}

/* ── Основной компонент ────────────────────────────────── */

interface Props {
  adminPath: string;
  initialTab: string;
  counterparties: WpCounterparty[];
  intakes: WpIntake[];
  shipments: WpShipment[];
  manualPayments: WpManualPayment[];
  transports: WpTransport[];
  rates: WastepaperRates | null;
}

export function WastepaperAccountManager(props: Props) {
  const router = useRouter();
  // Приёмщик на весовой и бухгалтер в кабинете работают с одними и теми же
  // документами — модуль обновляется без перезагрузки страницы.
  useAdminRealtime({
    tables: [
      "wp_intakes",
      "wp_shipments",
      "wp_payments",
      "wp_transports",
      "wp_counterparties",
    ],
    pollIntervalMs: 60_000,
  });
  const [tab, setTab] = useState<TabKey>(
    (TABS.some((t) => t.key === props.initialTab)
      ? props.initialTab
      : "days") as TabKey
  );

  const [counterparties, setCounterparties] = useState(props.counterparties);
  const [intakes, setIntakes] = useState(props.intakes);
  const [shipments, setShipments] = useState(props.shipments);
  const [manualPayments, setManualPayments] = useState(props.manualPayments);
  const [transports, setTransports] = useState(props.transports);

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");

  // Модалки
  const [intakeModal, setIntakeModal] = useState<
    { mode: "create" } | { mode: "edit"; item: WpIntake } | null
  >(null);
  const [shipmentModal, setShipmentModal] = useState<
    { mode: "create" } | { mode: "edit"; item: WpShipment } | null
  >(null);
  const [paymentModal, setPaymentModal] = useState<
    { mode: "create" } | { mode: "edit"; item: WpManualPayment } | null
  >(null);
  const [counterpartyModal, setCounterpartyModal] = useState<
    { mode: "create" } | { mode: "edit"; item: WpCounterparty } | null
  >(null);
  const [transportModal, setTransportModal] = useState<
    { mode: "create" } | { mode: "edit"; item: WpTransport } | null
  >(null);

  // Мгновенное обновление при правках (Realtime + polling fallback)
  useAdminRealtime({
    tables: [
      "wp_intakes",
      "wp_shipments",
      "wp_payments",
      "wp_transports",
      "wp_counterparties",
    ],
    pollIntervalMs: 30_000,
  });

  // После router.refresh() сервер отдаёт свежие данные
  useEffect(() => setCounterparties(props.counterparties), [props.counterparties]);
  useEffect(() => setIntakes(props.intakes), [props.intakes]);
  useEffect(() => setShipments(props.shipments), [props.shipments]);
  useEffect(() => setManualPayments(props.manualPayments), [props.manualPayments]);
  useEffect(() => setTransports(props.transports), [props.transports]);

  // Сохраняем вкладку в URL (?tab=...), чтобы ссылки с дашборда и
  // обновление страницы не сбрасывали рабочее место.
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("tab") !== tab) {
        url.searchParams.set("tab", tab);
        window.history.replaceState(null, "", url.toString());
      }
    } catch {
      /* приватный режим и т.п. */
    }
  }, [tab]);

  /* ── Производные данные ── */

  const events = useMemo(
    () => wpCollectMoneyEvents(intakes, shipments, manualPayments),
    [intakes, shipments, manualPayments]
  );
  const today = todayStr();
  const balance = useMemo(() => getWpBalance(events, today), [events, today]);
  const forecast = useMemo(() => getWpForecast(events), [events]);
  const stock = useMemo(() => getWpStock(intakes, shipments), [intakes, shipments]);

  const suppliers = useMemo(
    () => counterparties.filter((c) => c.roles.includes("supplier")),
    [counterparties]
  );
  const enterprises = useMemo(
    () => counterparties.filter((c) => c.roles.includes("enterprise")),
    [counterparties]
  );

  /* ── Общие действия ── */

  async function callApi(
    fn: () => Promise<Response>,
    fallbackError: string
  ): Promise<boolean> {
    setSaving(true);
    setFormError("");
    setActionError("");
    try {
      const res = await fn();
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || fallbackError);
      router.refresh();
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : fallbackError;
      setFormError(msg);
      setActionError(msg);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function toggleEventPaid(e: WpMoneyEvent) {
    const ok = await callApi(
      () =>
        fetch(`/api/admin/wp/${apiBaseForEvent(e)}/${e.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isPaid: !e.isPaid }),
        }),
      "Не удалось обновить оплату"
    );
    if (ok) setNotice(e.isPaid ? "Помечено как неоплаченное" : "Проведено: оплачено");
  }

  function openEventEdit(e: WpMoneyEvent) {
    if (e.kind === "intake") {
      const item = intakes.find((i) => i.id === e.id);
      if (item) setIntakeModal({ mode: "edit", item });
    } else if (e.kind === "shipment") {
      const item = shipments.find((s) => s.id === e.id);
      if (item) setShipmentModal({ mode: "edit", item });
    } else {
      const item = manualPayments.find((p) => p.id === e.id);
      if (item) setPaymentModal({ mode: "edit", item });
    }
  }

  /* ── Рендер ── */

  return (
    <div>
      <div className="admin-page-head">
        <div>
          <h1 className="admin-h1">Учёт макулатуры</h1>
          <p className="admin-sub">
            Отдельный модуль: приём макулатуры, сдача на предприятие, наличка и
            безнал по дням, планирование перевозок. С сайтом и товарным учётом
            не связан.
          </p>
        </div>
      </div>

      {/* Вкладки */}
      <div className="admin-filters" style={{ marginBottom: 16 }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`admin-filter${tab === t.key ? " admin-filter--active" : ""}`}
            onClick={() => {
              setTab(t.key);
              setActionError("");
              setNotice("");
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {notice && (
        <p
          className="admin-hint"
          style={{ color: "var(--adm-green, #1c7c45)", marginTop: -6, marginBottom: 12 }}
        >
          {notice}
        </p>
      )}
      {actionError && (
        <p className="admin-error" style={{ marginTop: -6, marginBottom: 12 }}>
          {actionError}
        </p>
      )}

      {tab === "days" && (
        <DaysTab
          events={events}
          balance={balance}
          forecastCash={forecast}
          today={today}
          onTogglePaid={toggleEventPaid}
          onEdit={openEventEdit}
        />
      )}

      {tab === "payments" && (
        <PaymentsTab
          events={events}
          onTogglePaid={toggleEventPaid}
          onEdit={openEventEdit}
          onNew={() => {
            setFormError("");
            setPaymentModal({ mode: "create" });
          }}
        />
      )}

      {tab === "intakes" && (
        <IntakesTab
          intakes={intakes}
          onNew={() => {
            setFormError("");
            setIntakeModal({ mode: "create" });
          }}
          onEdit={(item) => {
            setFormError("");
            setIntakeModal({ mode: "edit", item });
          }}
          onTogglePaid={(item) =>
            toggleEventPaid({
              ...events.find((e) => e.kind === "intake" && e.id === item.id)!,
            })
          }
        />
      )}

      {tab === "shipments" && (
        <ShipmentsTab
          shipments={shipments}
          stock={stock}
          onNew={() => {
            setFormError("");
            setShipmentModal({ mode: "create" });
          }}
          onEdit={(item) => {
            setFormError("");
            setShipmentModal({ mode: "edit", item });
          }}
          onTogglePaid={(item) =>
            toggleEventPaid({
              ...events.find((e) => e.kind === "shipment" && e.id === item.id)!,
            })
          }
        />
      )}

      {tab === "transports" && (
        <TransportsTab
          transports={transports}
          counterparties={counterparties}
          saving={saving}
          onNew={() => {
            setFormError("");
            setTransportModal({ mode: "create" });
          }}
          onEdit={(item) => {
            setFormError("");
            setTransportModal({ mode: "edit", item });
          }}
          onSetStatus={async (item, status) => {
            const ok = await callApi(
              () =>
                fetch(`/api/admin/wp/transports/${item.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "status", status }),
                }),
              "Не удалось обновить статус перевозки"
            );
            if (ok) setNotice(`Перевозка ТМ-${item.number}: «${WP_TRANSPORT_STATUS_LABELS[status]}»`);
          }}
          onSaveItems={async (item, items) => {
            const ok = await callApi(
              () =>
                fetch(`/api/admin/wp/transports/${item.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    date: item.date,
                    startTime: item.startTime,
                    driverName: item.driverName,
                    driverPhone: item.driverPhone,
                    vehicle: item.vehicle,
                    note: item.note,
                    items,
                  }),
                }),
              "Не удалось сохранить остановки"
            );
            return ok;
          }}
          onCreateIntakes={async (item) => {
            const res = await fetch(`/api/admin/wp/transports/${item.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "create_intakes" }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
              setActionError(body.error || "Не удалось оформить приёмы");
              return;
            }
            setNotice(
              body.created > 0
                ? `Оформлено приёмов: ${body.created}. Укажите цену и оплату во вкладке «Приём».`
                : "Новых приёмов нет — отметьте остановки «Забрано»."
            );
            router.refresh();
          }}
          onDelete={async (item) => {
            if (!confirm(`Удалить перевозку ТМ-${item.number} на ${fmtDate(item.date)}?`)) return;
            const ok = await callApi(
              () => fetch(`/api/admin/wp/transports/${item.id}`, { method: "DELETE" }),
              "Не удалось удалить перевозку"
            );
            if (ok) setNotice("Перевозка удалена");
          }}
        />
      )}

      {tab === "counterparties" && (
        <CounterpartiesTab
          counterparties={counterparties}
          onNew={() => {
            setFormError("");
            setCounterpartyModal({ mode: "create" });
          }}
          onEdit={(item) => {
            setFormError("");
            setCounterpartyModal({ mode: "edit", item });
          }}
        />
      )}

      {/* ── Модалки ── */}
      {intakeModal && (
        <IntakeModal
          mode={intakeModal.mode}
          item={intakeModal.mode === "edit" ? intakeModal.item : null}
          suppliers={suppliers}
          rates={props.rates}
          saving={saving}
          error={formError}
          onClose={() => setIntakeModal(null)}
          onSubmit={async (form) => {
            const isEdit = intakeModal.mode === "edit";
            const ok = await callApi(
              () =>
                fetch(
                  isEdit
                    ? `/api/admin/wp/intakes/${(intakeModal as any).item.id}`
                    : "/api/admin/wp/intakes",
                  {
                    method: isEdit ? "PATCH" : "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(form),
                  }
                ),
              isEdit ? "Не удалось сохранить приём" : "Не удалось создать приём"
            );
            if (ok) {
              setIntakeModal(null);
              setNotice(isEdit ? "Приём сохранён" : "Приём добавлен");
            }
          }}
          onCancelDoc={async () => {
            if (intakeModal.mode !== "edit") return;
            const cancelled = intakeModal.item.status !== "cancelled";
            const ok = await callApi(
              () =>
                fetch(`/api/admin/wp/intakes/${intakeModal.item.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: cancelled ? "cancel" : "restore" }),
                }),
              "Не удалось изменить статус приёма"
            );
            if (ok) {
              setIntakeModal(null);
              setNotice(cancelled ? "Приём отменён" : "Приём восстановлен");
            }
          }}
          onDelete={async () => {
            if (intakeModal.mode !== "edit") return;
            if (!confirm(`Удалить приём №${intakeModal.item.number} безвозвратно?`)) return;
            const ok = await callApi(
              () =>
                fetch(`/api/admin/wp/intakes/${intakeModal.item.id}`, {
                  method: "DELETE",
                }),
              "Не удалось удалить приём"
            );
            if (ok) {
              setIntakeModal(null);
              setNotice("Приём удалён");
            }
          }}
        />
      )}

      {shipmentModal && (
        <ShipmentModal
          mode={shipmentModal.mode}
          item={shipmentModal.mode === "edit" ? shipmentModal.item : null}
          enterprises={enterprises}
          saving={saving}
          error={formError}
          onClose={() => setShipmentModal(null)}
          onSubmit={async (form) => {
            const isEdit = shipmentModal.mode === "edit";
            const ok = await callApi(
              () =>
                fetch(
                  isEdit
                    ? `/api/admin/wp/shipments/${(shipmentModal as any).item.id}`
                    : "/api/admin/wp/shipments",
                  {
                    method: isEdit ? "PATCH" : "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(form),
                  }
                ),
              isEdit ? "Не удалось сохранить сдачу" : "Не удалось создать сдачу"
            );
            if (ok) {
              setShipmentModal(null);
              setNotice(isEdit ? "Сдача сохранена" : "Сдача добавлена");
            }
          }}
          onCancelDoc={async () => {
            if (shipmentModal.mode !== "edit") return;
            const cancelled = shipmentModal.item.status !== "cancelled";
            const ok = await callApi(
              () =>
                fetch(`/api/admin/wp/shipments/${shipmentModal.item.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: cancelled ? "cancel" : "restore" }),
                }),
              "Не удалось изменить статус сдачи"
            );
            if (ok) {
              setShipmentModal(null);
              setNotice(cancelled ? "Сдача отменена" : "Сдача восстановлена");
            }
          }}
          onDelete={async () => {
            if (shipmentModal.mode !== "edit") return;
            if (!confirm(`Удалить сдачу №${shipmentModal.item.number} безвозвратно?`)) return;
            const ok = await callApi(
              () =>
                fetch(`/api/admin/wp/shipments/${shipmentModal.item.id}`, {
                  method: "DELETE",
                }),
              "Не удалось удалить сдачу"
            );
            if (ok) {
              setShipmentModal(null);
              setNotice("Сдача удалена");
            }
          }}
        />
      )}

      {paymentModal && (
        <PaymentModal
          mode={paymentModal.mode}
          item={paymentModal.mode === "edit" ? paymentModal.item : null}
          counterparties={counterparties}
          saving={saving}
          error={formError}
          onClose={() => setPaymentModal(null)}
          onSubmit={async (form) => {
            const isEdit = paymentModal.mode === "edit";
            const ok = await callApi(
              () =>
                fetch(
                  isEdit
                    ? `/api/admin/wp/payments/${(paymentModal as any).item.id}`
                    : "/api/admin/wp/payments",
                  {
                    method: isEdit ? "PATCH" : "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(form),
                  }
                ),
              isEdit ? "Не удалось сохранить платёж" : "Не удалось создать платёж"
            );
            if (ok) {
              setPaymentModal(null);
              setNotice(isEdit ? "Платёж сохранён" : "Платёж добавлен");
            }
          }}
          onDelete={async () => {
            if (paymentModal.mode !== "edit") return;
            if (!confirm(`Удалить платёж №${paymentModal.item.number} безвозвратно?`)) return;
            const ok = await callApi(
              () =>
                fetch(`/api/admin/wp/payments/${paymentModal.item.id}`, {
                  method: "DELETE",
                }),
              "Не удалось удалить платёж"
            );
            if (ok) {
              setPaymentModal(null);
              setNotice("Платёж удалён");
            }
          }}
        />
      )}

      {counterpartyModal && (
        <CounterpartyModal
          mode={counterpartyModal.mode}
          item={counterpartyModal.mode === "edit" ? counterpartyModal.item : null}
          saving={saving}
          error={formError}
          onClose={() => setCounterpartyModal(null)}
          onSubmit={async (form) => {
            const isEdit = counterpartyModal.mode === "edit";
            const ok = await callApi(
              () =>
                fetch(
                  isEdit
                    ? `/api/admin/wp/counterparties/${(counterpartyModal as any).item.id}`
                    : "/api/admin/wp/counterparties",
                  {
                    method: isEdit ? "PATCH" : "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(form),
                  }
                ),
              isEdit ? "Не удалось сохранить контрагента" : "Не удалось создать контрагента"
            );
            if (ok) {
              setCounterpartyModal(null);
              setNotice(isEdit ? "Контрагент сохранён" : "Контрагент добавлен");
            }
          }}
          onDelete={async () => {
            if (counterpartyModal.mode !== "edit") return;
            if (
              !confirm(
                `Удалить контрагента «${counterpartyModal.item.name}»? Приёмы и сдачи с ним останутся, но привязка пропадёт.`
              )
            )
              return;
            const ok = await callApi(
              () =>
                fetch(`/api/admin/wp/counterparties/${counterpartyModal.item.id}`, {
                  method: "DELETE",
                }),
              "Не удалось удалить контрагента"
            );
            if (ok) {
              setCounterpartyModal(null);
              setNotice("Контрагент удалён");
            }
          }}
        />
      )}

      {transportModal && (
        <TransportModal
          mode={transportModal.mode}
          item={transportModal.mode === "edit" ? transportModal.item : null}
          counterparties={counterparties}
          saving={saving}
          error={formError}
          onClose={() => setTransportModal(null)}
          onSubmit={async (form) => {
            const isEdit = transportModal.mode === "edit";
            const ok = await callApi(
              () =>
                fetch(
                  isEdit
                    ? `/api/admin/wp/transports/${(transportModal as any).item.id}`
                    : "/api/admin/wp/transports",
                  {
                    method: isEdit ? "PATCH" : "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(form),
                  }
                ),
              isEdit ? "Не удалось сохранить перевозку" : "Не удалось создать перевозку"
            );
            if (ok) {
              setTransportModal(null);
              setNotice(isEdit ? "Перевозка сохранена" : "Перевозка создана");
            }
          }}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   ВКЛАДКА «ДНИ И ФИНАНСЫ»
   ═══════════════════════════════════════════════════════ */

function DaysTab({
  events,
  balance,
  forecastCash,
  today,
  onTogglePaid,
  onEdit,
}: {
  events: WpMoneyEvent[];
  balance: { cash: number; bank: number; total: number };
  forecastCash: ReturnType<typeof getWpForecast>;
  today: string;
  onTogglePaid: (e: WpMoneyEvent) => void;
  onEdit: (e: WpMoneyEvent) => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sortDesc, setSortDesc] = useState(true);
  const [accountView, setAccountView] = useState<"all" | WpAccount>("all");
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      buildWpDayReport(events, {
        from: from || undefined,
        to: to || undefined,
        sortDesc,
      }),
    [events, from, to, sortDesc]
  );

  const unpaid = useMemo(
    () =>
      events
        .filter((e) => !e.cancelled && !e.isPaid)
        .sort((a, b) => a.date.localeCompare(b.date) || a.number - b.number),
    [events]
  );
  const unpaidIn = unpaid.filter((e) => e.direction === "incoming");
  const unpaidOut = unpaid.filter((e) => e.direction === "outgoing");

  const closingValue = (r: (typeof rows)[number]) =>
    accountView === "cash"
      ? r.closingCash
      : accountView === "bank"
        ? r.closingBank
        : r.closingCash + r.closingBank;
  const openingValue = (r: (typeof rows)[number]) =>
    accountView === "cash"
      ? r.openingCash
      : accountView === "bank"
        ? r.openingBank
        : r.openingCash + r.openingBank;
  const inValue = (r: (typeof rows)[number]) =>
    accountView === "cash"
      ? r.inCash
      : accountView === "bank"
        ? r.inBank
        : r.inCash + r.inBank;
  const outValue = (r: (typeof rows)[number]) =>
    accountView === "cash"
      ? r.outCash
      : accountView === "bank"
        ? r.outBank
        : r.outCash + r.outBank;

  return (
    <div>
      {/* Баланс сейчас */}
      <div className="admin-stat-grid" style={{ marginBottom: 18 }}>
        <div className="admin-stat">
          <div
            className="admin-stat__icon"
            style={{ background: "var(--adm-teal-pale)", color: "var(--adm-teal)" }}
            aria-hidden="true"
          >
            <Banknote size={18} />
          </div>
          <div className="admin-stat__value">{fmtMoney(balance.cash)}</div>
          <div className="admin-stat__label">Наличка сейчас</div>
        </div>
        <div className="admin-stat">
          <div
            className="admin-stat__icon"
            style={{ background: "var(--adm-indigo-pale)", color: "var(--adm-indigo)" }}
            aria-hidden="true"
          >
            <CreditCard size={18} />
          </div>
          <div className="admin-stat__value">{fmtMoney(balance.bank)}</div>
          <div className="admin-stat__label">Безнал сейчас</div>
        </div>
        <div className="admin-stat">
          <div
            className="admin-stat__icon"
            style={{ background: "var(--adm-steel-pale)", color: "var(--adm-steel)" }}
            aria-hidden="true"
          >
            <Scale size={18} />
          </div>
          <div className="admin-stat__value">{fmtMoney(balance.total)}</div>
          <div className="admin-stat__label">Итого (нал + безнал)</div>
        </div>
        <div className="admin-stat">
          <div
            className="admin-stat__icon"
            style={{ background: "var(--adm-pine-pale)", color: "var(--adm-pine)" }}
            aria-hidden="true"
          >
            <ArrowDownLeft size={18} />
          </div>
          <div className="admin-stat__value" style={{ fontSize: "1.25rem" }}>
            +{fmtMoney(forecastCash.inTotal)}
          </div>
          <div className="admin-stat__label">
            Прогноз прихода · нал {fmtMoney(forecastCash.inCash)} · безнал{" "}
            {fmtMoney(forecastCash.inBank)}
          </div>
        </div>
        <div className="admin-stat">
          <div
            className="admin-stat__icon"
            style={{ background: "var(--adm-kraft-pale)", color: "var(--adm-kraft)" }}
            aria-hidden="true"
          >
            <ArrowUpRight size={18} />
          </div>
          <div className="admin-stat__value" style={{ fontSize: "1.25rem" }}>
            −{fmtMoney(forecastCash.outTotal)}
          </div>
          <div className="admin-stat__label">
            Прогноз расхода · нал {fmtMoney(forecastCash.outCash)} · безнал{" "}
            {fmtMoney(forecastCash.outBank)}
          </div>
        </div>
      </div>

      {/* Отчёт по дням */}
      <div className="admin-card" style={{ marginBottom: 18 }}>
        <div className="admin-card__head">
          <span className="admin-card__title">Движение денег по дням</span>
          {/* На мобильном (≤480px) перестраивается в сетку:
              фильтры-счёт на всю ширину, даты по 50% (.wp-days-filters) */}
          <div className="wp-days-filters">
            <div className="admin-filters" style={{ marginBottom: 0 }}>
              {(
                [
                  { key: "all", label: "Всё" },
                  { key: "cash", label: "Наличка" },
                  { key: "bank", label: "Безнал" },
                ] as const
              ).map((o) => (
                <button
                  key={o.key}
                  type="button"
                  className={`admin-filter${accountView === o.key ? " admin-filter--active" : ""}`}
                  onClick={() => setAccountView(o.key)}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <input
              type="date"
              className="admin-input wp-days-filters__date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              aria-label="С даты"
            />
            <span className="wp-days-filters__dash">—</span>
            <input
              type="date"
              className="admin-input wp-days-filters__date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              aria-label="По дату"
            />
            <button
              type="button"
              className="admin-btn admin-btn--ghost admin-btn--sm"
              onClick={() => setSortDesc((v) => !v)}
              title="Сортировка по дате"
            >
              {sortDesc ? (
                <>
                  <ChevronDown size={14} /> Сначала новые
                </>
              ) : (
                <>
                  <ChevronUp size={14} /> Сначала старые
                </>
              )}
            </button>
          </div>
        </div>
        {rows.length === 0 ? (
          <div className="admin-card__pad">
            <p className="admin-hint">
              Оплаченных операций за выбранный период нет. Как только появятся
              оплаченные приёмы, сдачи или платежи — здесь будет отчёт по дням с
              остатком предыдущего дня.
            </p>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Остаток на начало</th>
                  <th>Приход</th>
                  <th>Расход</th>
                  <th>Остаток на конец</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <DayRowFragment
                    key={row.date}
                    row={row}
                    expanded={expandedDay === row.date}
                    onToggleExpand={() =>
                      setExpandedDay((cur) => (cur === row.date ? null : cur))
                    }
                    opening={openingValue(row)}
                    incoming={inValue(row)}
                    outgoing={outValue(row)}
                    closing={closingValue(row)}
                    isToday={row.date === today}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Прогноз: запланированные, но ещё не оплаченные операции */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 14,
        }}
      >
        <ForecastCard
          title={`Ожидаем приход (${unpaidIn.length})`}
          tone="in"
          events={unpaidIn}
          onTogglePaid={onTogglePaid}
          onEdit={onEdit}
        />
        <ForecastCard
          title={`Нужно выплатить (${unpaidOut.length})`}
          tone="out"
          events={unpaidOut}
          onTogglePaid={onTogglePaid}
          onEdit={onEdit}
        />
      </div>
    </div>
  );
}

function DayRowFragment({
  row,
  expanded,
  onToggleExpand,
  opening,
  incoming,
  outgoing,
  closing,
  isToday,
}: {
  row: ReturnType<typeof buildWpDayReport>[number];
  expanded: boolean;
  onToggleExpand: () => void;
  opening: number;
  incoming: number;
  outgoing: number;
  closing: number;
  isToday: boolean;
}) {
  return (
    <>
      <tr
        onClick={onToggleExpand}
        style={{ cursor: "pointer" }}
        title="Показать операции дня"
      >
        <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}{" "}
          {fmtDate(row.date)}
          {isToday && (
            <span className="admin-badge admin-badge--blue" style={{ marginLeft: 6 }}>
              сегодня
            </span>
          )}
        </td>
        <td>{fmtMoney(opening)}</td>
        <td style={{ color: "var(--adm-pine)", fontWeight: 600 }}>
          {incoming > 0 ? `+${fmtMoney(incoming)}` : "—"}
        </td>
        <td style={{ color: "var(--adm-kraft)", fontWeight: 600 }}>
          {outgoing > 0 ? `−${fmtMoney(outgoing)}` : "—"}
        </td>
        <td style={{ fontWeight: 700 }}>{fmtMoney(closing)}</td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={5} style={{ background: "var(--adm-paper)" }}>
            {row.events.map((e) => (
              <div
                key={`${e.kind}-${e.id}`}
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  flexWrap: "wrap",
                  padding: "4px 0",
                  fontSize: "0.85rem",
                }}
              >
                <span className={KIND_BADGE[e.kind].cls}>{KIND_BADGE[e.kind].label}</span>
                <span style={{ color: "var(--adm-muted)" }}>{e.title}</span>
                <span>{e.counterpartyName || "—"}</span>
                <span className={ACCOUNT_BADGE[e.account]}>
                  {WP_ACCOUNT_LABELS[e.account]}
                </span>
                <strong
                  style={{
                    color: e.direction === "incoming" ? "var(--adm-pine)" : "var(--adm-kraft)",
                  }}
                >
                  {e.direction === "incoming" ? "+" : "−"}
                  {fmtMoney(e.amount)}
                </strong>
                {e.paidAt && (
                  <span style={{ color: "var(--adm-muted)" }}>
                    оплачено {fmtPaidAt(e.paidAt)}
                  </span>
                )}
              </div>
            ))}
          </td>
        </tr>
      )}
    </>
  );
}

function ForecastCard({
  title,
  tone,
  events,
  onTogglePaid,
  onEdit,
}: {
  title: string;
  tone: "in" | "out";
  events: WpMoneyEvent[];
  onTogglePaid: (e: WpMoneyEvent) => void;
  onEdit: (e: WpMoneyEvent) => void;
}) {
  const total = events.reduce((s, e) => s + e.amount, 0);
  return (
    <div className="admin-card">
      <div className="admin-card__head">
        <span className="admin-card__title">{title}</span>
        <strong style={{ color: tone === "in" ? "var(--adm-pine)" : "var(--adm-kraft)" }}>
          {tone === "in" ? "+" : "−"}
          {fmtMoney(total)}
        </strong>
      </div>
      {events.length === 0 ? (
        <div className="admin-card__pad">
          <p className="admin-hint">Незапланированных ожиданий нет.</p>
        </div>
      ) : (
        <div className="admin-card__pad" style={{ display: "grid", gap: 8 }}>
          {events.slice(0, 20).map((e) => (
            <div
              key={`${e.kind}-${e.id}`}
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <span style={{ color: "var(--adm-muted)", whiteSpace: "nowrap" }}>
                {fmtDate(e.date)}
              </span>
              <span className={KIND_BADGE[e.kind].cls}>{KIND_BADGE[e.kind].label}</span>
              <span style={{ flex: 1, minWidth: 120 }}>
                {e.title}
                {e.counterpartyName ? ` · ${e.counterpartyName}` : ""}
              </span>
              <span className={ACCOUNT_BADGE[e.account]}>
                {WP_ACCOUNT_LABELS[e.account]}
              </span>
              <strong>{fmtMoney(e.amount)}</strong>
              <button
                type="button"
                className="admin-btn admin-btn--ghost admin-btn--sm"
                onClick={() => onTogglePaid(e)}
                title="Отметить оплаченным"
              >
                <Check size={13} /> Оплачено
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--ghost admin-btn--sm"
                onClick={() => onEdit(e)}
              >
                <Pencil size={13} />
              </button>
            </div>
          ))}
          {events.length > 20 && (
            <p className="admin-hint">…и ещё {events.length - 20} (см. вкладку «Платежи»)</p>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   ВКЛАДКА «ПЛАТЕЖИ»
   ═══════════════════════════════════════════════════════ */

function PaymentsTab({
  events,
  onTogglePaid,
  onEdit,
  onNew,
}: {
  events: WpMoneyEvent[];
  onTogglePaid: (e: WpMoneyEvent) => void;
  onEdit: (e: WpMoneyEvent) => void;
  onNew: () => void;
}) {
  const [direction, setDirection] = useState<"all" | "incoming" | "outgoing">("all");
  const [account, setAccount] = useState<"all" | WpAccount>("all");
  const [paidFilter, setPaidFilter] = useState<"all" | "paid" | "unpaid">("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events
      .filter((e) => {
        if (e.cancelled) return false;
        if (direction !== "all" && e.direction !== direction) return false;
        if (account !== "all" && e.account !== account) return false;
        if (paidFilter === "paid" && !e.isPaid) return false;
        if (paidFilter === "unpaid" && e.isPaid) return false;
        if (!q) return true;
        return (
          e.title.toLowerCase().includes(q) ||
          e.counterpartyName.toLowerCase().includes(q) ||
          (e.comment || "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.date.localeCompare(a.date) || b.number - a.number);
  }, [events, direction, account, paidFilter, query]);

  const totals = useMemo(() => {
    let inSum = 0;
    let outSum = 0;
    for (const e of filtered) {
      if (!e.isPaid) continue;
      if (e.direction === "incoming") inSum += e.amount;
      else outSum += e.amount;
    }
    return { inSum, outSum };
  }, [filtered]);

  return (
    <div>
      <div
        className="admin-card"
        style={{ padding: "12px 16px", marginBottom: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}
      >
        <div style={{ flex: "1 1 220px", position: "relative" }}>
          <Search
            size={14}
            style={{
              position: "absolute",
              left: 10,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--adm-muted)",
              pointerEvents: "none",
            }}
          />
          <input
            className="admin-input"
            style={{ paddingLeft: 30, width: "100%" }}
            placeholder="Поиск по документу, контрагенту, комментарию…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="admin-filters" style={{ marginBottom: 0 }}>
          {(
            [
              { key: "all", label: "Все" },
              { key: "incoming", label: "Приход" },
              { key: "outgoing", label: "Расход" },
            ] as const
          ).map((o) => (
            <button
              key={o.key}
              type="button"
              className={`admin-filter${direction === o.key ? " admin-filter--active" : ""}`}
              onClick={() => setDirection(o.key)}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="admin-filters" style={{ marginBottom: 0 }}>
          {(
            [
              { key: "all", label: "Нал+безнал" },
              { key: "cash", label: "Наличка" },
              { key: "bank", label: "Безнал" },
            ] as const
          ).map((o) => (
            <button
              key={o.key}
              type="button"
              className={`admin-filter${account === o.key ? " admin-filter--active" : ""}`}
              onClick={() => setAccount(o.key)}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="admin-filters" style={{ marginBottom: 0 }}>
          {(
            [
              { key: "all", label: "Все статусы" },
              { key: "paid", label: "Оплаченные" },
              { key: "unpaid", label: "Ожидают" },
            ] as const
          ).map((o) => (
            <button
              key={o.key}
              type="button"
              className={`admin-filter${paidFilter === o.key ? " admin-filter--active" : ""}`}
              onClick={() => setPaidFilter(o.key)}
            >
              {o.label}
            </button>
          ))}
        </div>
        <button type="button" className="admin-btn admin-btn--navy" onClick={onNew}>
          <Plus size={15} /> Платёж
        </button>
      </div>

      <p className="admin-hint" style={{ marginTop: -4 }}>
        Показано операций: {filtered.length}. По оплаченным: приход{" "}
        <b style={{ color: "var(--adm-pine)" }}>+{fmtMoney(totals.inSum)}</b>, расход{" "}
        <b style={{ color: "var(--adm-kraft)" }}>−{fmtMoney(totals.outSum)}</b>.
      </p>

      {filtered.length === 0 ? (
        <div className="admin-card">
          <div className="admin-card__pad">
            <p className="admin-hint">Операций по фильтрам нет.</p>
          </div>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Документ</th>
                <th>Контрагент</th>
                <th>Сумма</th>
                <th>Счёт</th>
                <th>Оплата</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={`${e.kind}-${e.id}`}>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtDate(e.date)}</td>
                  <td>
                    <span className={KIND_BADGE[e.kind].cls}>{KIND_BADGE[e.kind].label}</span>{" "}
                    {e.title}
                    {e.comment && (
                      <div style={{ color: "var(--adm-muted)", fontSize: "0.8rem" }}>
                        {e.comment}
                      </div>
                    )}
                  </td>
                  <td>{e.counterpartyName || "—"}</td>
                  <td
                    style={{
                      whiteSpace: "nowrap",
                      fontWeight: 700,
                      color: e.direction === "incoming" ? "var(--adm-pine)" : "var(--adm-kraft)",
                    }}
                  >
                    {e.direction === "incoming" ? "+" : "−"}
                    {fmtMoney(e.amount)}
                  </td>
                  <td>
                    <span className={ACCOUNT_BADGE[e.account]}>
                      {WP_ACCOUNT_LABELS[e.account]}
                    </span>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {e.isPaid ? (
                      <span className="admin-badge admin-badge--green" title={fmtPaidAt(e.paidAt)}>
                        Оплачен
                      </span>
                    ) : (
                      <span className="admin-badge admin-badge--amber">Ожидает</span>
                    )}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      onClick={() => onTogglePaid(e)}
                      title={e.isPaid ? "Снять отметку об оплате" : "Отметить оплаченным"}
                    >
                      {e.isPaid ? <RotateCcw size={13} /> : <Check size={13} />}
                    </button>
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      onClick={() => onEdit(e)}
                      title="Открыть документ"
                    >
                      <Pencil size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   ВКЛАДКА «ПРИЁМ»
   ═══════════════════════════════════════════════════════ */

function IntakesTab({
  intakes,
  onNew,
  onEdit,
  onTogglePaid,
}: {
  intakes: WpIntake[];
  onNew: () => void;
  onEdit: (item: WpIntake) => void;
  onTogglePaid: (item: WpIntake) => void;
}) {
  const [query, setQuery] = useState("");
  const [account, setAccount] = useState<"all" | WpAccount>("all");
  const [showCancelled, setShowCancelled] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return intakes.filter((i) => {
      if (!showCancelled && i.status === "cancelled") return false;
      if (account !== "all" && i.account !== account) return false;
      if (!q) return true;
      return (
        i.counterpartyName.toLowerCase().includes(q) ||
        (i.address || "").toLowerCase().includes(q) ||
        String(i.number).includes(q) ||
        (i.comment || "").toLowerCase().includes(q)
      );
    });
  }, [intakes, query, account, showCancelled]);

  const totals = useMemo(() => {
    const active = filtered.filter((i) => i.status === "active");
    return {
      kg: active.reduce((s, i) => s + i.weightKg, 0),
      sum: active.reduce((s, i) => s + i.total, 0),
    };
  }, [filtered]);

  return (
    <div>
      <div
        className="admin-card"
        style={{ padding: "12px 16px", marginBottom: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}
      >
        <div style={{ flex: "1 1 220px", position: "relative" }}>
          <Search
            size={14}
            style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--adm-muted)", pointerEvents: "none" }}
          />
          <input
            className="admin-input"
            style={{ paddingLeft: 30, width: "100%" }}
            placeholder="Поиск по контрагенту, адресу, №…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="admin-filters" style={{ marginBottom: 0 }}>
          {(
            [
              { key: "all", label: "Нал+безнал" },
              { key: "cash", label: "Наличка" },
              { key: "bank", label: "Безнал" },
            ] as const
          ).map((o) => (
            <button
              key={o.key}
              type="button"
              className={`admin-filter${account === o.key ? " admin-filter--active" : ""}`}
              onClick={() => setAccount(o.key)}
            >
              {o.label}
            </button>
          ))}
        </div>
        <label className="admin-hint" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={showCancelled}
            onChange={(e) => setShowCancelled(e.target.checked)}
          />
          отменённые
        </label>
        <button type="button" className="admin-btn admin-btn--navy" onClick={onNew}>
          <Plus size={15} /> Приём
        </button>
      </div>

      <p className="admin-hint" style={{ marginTop: -4 }}>
        Показано приёмов: {filtered.length} · {fmtKg(totals.kg)} на {fmtMoney(totals.sum)}.
      </p>

      {filtered.length === 0 ? (
        <div className="admin-card">
          <div className="admin-card__pad">
            <p className="admin-hint">
              Приёмов пока нет. Добавьте первый — укажите, от кого приняли
              макулатуру, вес и цену за кг.
            </p>
          </div>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>№</th>
                <th>Дата</th>
                <th>От кого</th>
                <th>Вид</th>
                <th>Вес</th>
                <th>Цена/кг</th>
                <th>Сумма</th>
                <th>Счёт</th>
                <th>Оплата</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((i) => (
                <tr
                  key={i.id}
                  style={
                    i.status === "cancelled"
                      ? { opacity: 0.55, textDecoration: "line-through" }
                      : undefined
                  }
                >
                  <td style={{ whiteSpace: "nowrap" }}>ПМ-{i.number}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtDate(i.date)}</td>
                  <td>
                    {i.counterpartyName}
                    {i.address && (
                      <div style={{ color: "var(--adm-muted)", fontSize: "0.8rem" }}>
                        {i.address}
                      </div>
                    )}
                  </td>
                  <td>{WP_TYPE_LABELS[i.wastepaperType] || i.wastepaperType}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtKg(i.weightKg)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtMoney(i.pricePerKg)}</td>
                  <td style={{ whiteSpace: "nowrap", fontWeight: 700 }}>{fmtMoney(i.total)}</td>
                  <td>
                    <span className={ACCOUNT_BADGE[i.account]}>
                      {WP_ACCOUNT_LABELS[i.account]}
                    </span>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {i.status === "cancelled" ? (
                      <span className="admin-badge admin-badge--muted">Отменён</span>
                    ) : i.isPaid ? (
                      <span className="admin-badge admin-badge--green" title={fmtPaidAt(i.paidAt)}>
                        Оплачен
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="admin-badge admin-badge--amber"
                        style={{ border: 0, cursor: "pointer" }}
                        onClick={() => onTogglePaid(i)}
                        title="Нажмите, чтобы отметить оплаченным"
                      >
                        Ожидает
                      </button>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      onClick={() => onEdit(i)}
                    >
                      <Pencil size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   ВКЛАДКА «СДАЧИ»
   ═══════════════════════════════════════════════════════ */

function ShipmentsTab({
  shipments,
  stock,
  onNew,
  onEdit,
  onTogglePaid,
}: {
  shipments: WpShipment[];
  stock: ReturnType<typeof getWpStock>;
  onNew: () => void;
  onEdit: (item: WpShipment) => void;
  onTogglePaid: (item: WpShipment) => void;
}) {
  const [query, setQuery] = useState("");
  const [showCancelled, setShowCancelled] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return shipments.filter((s) => {
      if (!showCancelled && s.status === "cancelled") return false;
      if (!q) return true;
      return (
        s.enterpriseName.toLowerCase().includes(q) ||
        String(s.number).includes(q) ||
        (s.comment || "").toLowerCase().includes(q)
      );
    });
  }, [shipments, query, showCancelled]);

  return (
    <div>
      {/* Остаток макулатуры на площадке — что можно сдавать */}
      {stock.length > 0 && (
        <div className="admin-card" style={{ marginBottom: 14 }}>
          <div className="admin-card__head">
            <span className="admin-card__title">Остаток на площадке</span>
            <span className="admin-hint">принято − сдано, по действующим документам</span>
          </div>
          <div
            className="admin-card__pad"
            style={{ display: "flex", gap: 14, flexWrap: "wrap" }}
          >
            {stock.map((row) => (
              <div key={row.wastepaperType} style={{ minWidth: 170 }}>
                <div style={{ fontWeight: 700 }}>
                  {wpTypeLabel(row.wastepaperType, WP_TYPE_LABELS)}
                </div>
                <div className="admin-hint">
                  принято {fmtKg(row.intakeKg)} · сдано {fmtKg(row.shipmentKg)}
                </div>
                <div
                  style={{
                    fontWeight: 700,
                    color: row.stockKg > 0 ? "var(--adm-pine)" : "var(--adm-muted)",
                  }}
                >
                  <PackageOpen size={13} style={{ marginRight: 4, verticalAlign: "-2px" }} />
                  {fmtKg(Math.max(0, row.stockKg))} на площадке
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div
        className="admin-card"
        style={{ padding: "12px 16px", marginBottom: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}
      >
        <div style={{ flex: "1 1 220px", position: "relative" }}>
          <Search
            size={14}
            style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--adm-muted)", pointerEvents: "none" }}
          />
          <input
            className="admin-input"
            style={{ paddingLeft: 30, width: "100%" }}
            placeholder="Поиск по предприятию, №…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <label className="admin-hint" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={showCancelled}
            onChange={(e) => setShowCancelled(e.target.checked)}
          />
          отменённые
        </label>
        <button type="button" className="admin-btn admin-btn--navy" onClick={onNew}>
          <Plus size={15} /> Сдача
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="admin-card">
          <div className="admin-card__pad">
            <p className="admin-hint">
              Сдач пока нет. Когда везёте накопленную макулатуру на предприятие —
              оформите сдачу: укажите предприятие, вес и цену; полученные деньги
              потом отметьте оплатой здесь или внесите платежом во вкладке
              «Платежи».
            </p>
          </div>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>№</th>
                <th>Дата</th>
                <th>Предприятие</th>
                <th>Вид</th>
                <th>Вес</th>
                <th>Цена/кг</th>
                <th>Сумма</th>
                <th>Счёт</th>
                <th>Оплата</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr
                  key={s.id}
                  style={
                    s.status === "cancelled"
                      ? { opacity: 0.55, textDecoration: "line-through" }
                      : undefined
                  }
                >
                  <td style={{ whiteSpace: "nowrap" }}>СМ-{s.number}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtDate(s.date)}</td>
                  <td>
                    {s.enterpriseName}
                    {s.comment && (
                      <div style={{ color: "var(--adm-muted)", fontSize: "0.8rem" }}>
                        {s.comment}
                      </div>
                    )}
                  </td>
                  <td>{WP_TYPE_LABELS[s.wastepaperType] || s.wastepaperType}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtKg(s.weightKg)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtMoney(s.pricePerKg)}</td>
                  <td style={{ whiteSpace: "nowrap", fontWeight: 700 }}>{fmtMoney(s.total)}</td>
                  <td>
                    <span className={ACCOUNT_BADGE[s.account]}>
                      {WP_ACCOUNT_LABELS[s.account]}
                    </span>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {s.status === "cancelled" ? (
                      <span className="admin-badge admin-badge--muted">Отменена</span>
                    ) : s.isPaid ? (
                      <span className="admin-badge admin-badge--green" title={fmtPaidAt(s.paidAt)}>
                        Получено
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="admin-badge admin-badge--amber"
                        style={{ border: 0, cursor: "pointer" }}
                        onClick={() => onTogglePaid(s)}
                        title="Нажмите, когда деньги получены"
                      >
                        Ожидаем
                      </button>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      onClick={() => onEdit(s)}
                    >
                      <Pencil size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   ВКЛАДКА «ПЕРЕВОЗКИ»
   ═══════════════════════════════════════════════════════ */

function TransportsTab({
  transports,
  counterparties,
  saving,
  onNew,
  onEdit,
  onSetStatus,
  onSaveItems,
  onCreateIntakes,
  onDelete,
}: {
  transports: WpTransport[];
  counterparties: WpCounterparty[];
  saving: boolean;
  onNew: () => void;
  onEdit: (item: WpTransport) => void;
  onSetStatus: (item: WpTransport, status: keyof typeof WP_TRANSPORT_STATUS_LABELS) => void;
  onSaveItems: (item: WpTransport, items: WpTransportItem[]) => Promise<boolean>;
  onCreateIntakes: (item: WpTransport) => void;
  onDelete: (item: WpTransport) => void;
}) {
  const [showPast, setShowPast] = useState(false);
  const [stopModal, setStopModal] = useState<{
    transport: WpTransport;
    stop: WpTransportItem | null; // null = новая остановка
    items: WpTransportItem[];
  } | null>(null);
  const [busyStop, setBusyStop] = useState(false);

  const active = transports
    .filter((t) => t.status === "planned" || t.status === "active")
    .sort((a, b) => a.date.localeCompare(b.date) || a.number - b.number);
  const past = transports
    .filter((t) => t.status === "completed" || t.status === "cancelled")
    .sort((a, b) => b.date.localeCompare(a.date) || b.number - a.number);
  const shown = showPast ? past : active;

  /** Быстрая отметка статуса остановки; при «Забрано» спрашиваем фактический вес. */
  async function markStop(t: WpTransport, stop: WpTransportItem, status: string) {
    if (status === stop.status) return;
    let actualKg = stop.actualKg;
    if (status === "done") {
      const answer = window.prompt(
        `Фактический вес на точке «${stop.counterpartyName || stop.address}», кг.\n` +
          "Оставьте пустым — возьмём плановый вес.",
        stop.actualKg != null ? String(stop.actualKg) : String(stop.plannedKg || "")
      );
      if (answer === null) return; // отмена ввода
      const parsed = parseNum(answer);
      actualKg = answer.trim() === "" ? null : parsed;
    }
    const items = t.items.map((i) =>
      i.id === stop.id ? { ...i, status: status as WpTransportItem["status"], actualKg } : i
    );
    setBusyStop(true);
    await onSaveItems(t, items);
    setBusyStop(false);
  }

  async function removeStop(t: WpTransport, stop: WpTransportItem) {
    if (!confirm(`Убрать остановку «${stop.counterpartyName || stop.address}» из перевозки ТМ-${t.number}?`))
      return;
    const items = t.items.filter((i) => i.id !== stop.id);
    setBusyStop(true);
    await onSaveItems(t, items);
    setBusyStop(false);
  }

  return (
    <div>
      <div
        className="admin-card"
        style={{ padding: "12px 16px", marginBottom: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}
      >
        <div className="admin-filters" style={{ marginBottom: 0 }}>
          <button
            type="button"
            className={`admin-filter${!showPast ? " admin-filter--active" : ""}`}
            onClick={() => setShowPast(false)}
          >
            Активные ({active.length})
          </button>
          <button
            type="button"
            className={`admin-filter${showPast ? " admin-filter--active" : ""}`}
            onClick={() => setShowPast(true)}
          >
            Архив ({past.length})
          </button>
        </div>
        <p className="admin-hint" style={{ margin: 0, flex: 1, minWidth: 200 }}>
          Планируйте рейсы за макулатурой: остановки с примерным временем, при ЧП
          правьте точки прямо здесь. После рейса отметьте «Забрано» и оформите
          приёмы одной кнопкой.
        </p>
        <button type="button" className="admin-btn admin-btn--navy" onClick={onNew}>
          <Plus size={15} /> Перевозка
        </button>
      </div>

      {shown.length === 0 ? (
        <div className="admin-card">
          <div className="admin-card__pad">
            <p className="admin-hint">
              {showPast
                ? "Завершённых и отменённых перевозок пока нет."
                : "Активных перевозок нет. Создайте первую — укажите дату, водителя и остановки."}
            </p>
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          {shown.map((t) => {
            const doneStops = t.items.filter((i) => i.status === "done");
            const needIntakes = doneStops.some((i) => !i.intakeId);
            const editable = t.status === "planned" || t.status === "active";
            return (
              <div key={t.id} className="admin-card">
                <div className="admin-card__head" style={{ flexWrap: "wrap" }}>
                  <span className="admin-card__title" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <Truck size={16} />
                    ТМ-{t.number} · {fmtDate(t.date)}
                    {t.startTime && (
                      <span className="admin-badge admin-badge--muted" title="Примерное время выезда">
                        {fmtTime(t.startTime)}
                      </span>
                    )}
                    <span className={TRANSPORT_BADGE[t.status]}>
                      {WP_TRANSPORT_STATUS_LABELS[t.status]}
                    </span>
                  </span>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    {(t.driverName || t.vehicle) && (
                      <span className="admin-hint">
                        {[t.driverName, t.vehicle].filter(Boolean).join(" · ")}
                      </span>
                    )}
                    {t.driverPhone && (
                      <a className="admin-hint" href={`tel:${t.driverPhone}`}>
                        {t.driverPhone}
                      </a>
                    )}
                  </div>
                </div>

                <div className="admin-card__pad" style={{ paddingTop: 12 }}>
                  {/* Кнопки статуса и действий */}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: t.items.length ? 12 : 0 }}>
                    {t.status === "planned" && (
                      <button
                        type="button"
                        className="admin-btn admin-btn--primary admin-btn--sm"
                        disabled={saving || busyStop}
                        onClick={() => onSetStatus(t, "active")}
                      >
                        <Truck size={13} /> В пути
                      </button>
                    )}
                    {editable && (
                      <button
                        type="button"
                        className="admin-btn admin-btn--primary admin-btn--sm"
                        disabled={saving || busyStop}
                        onClick={() => onSetStatus(t, "completed")}
                      >
                        <PackageCheck size={13} /> Завершена
                      </button>
                    )}
                    {needIntakes && (
                      <button
                        type="button"
                        className="admin-btn admin-btn--navy admin-btn--sm"
                        disabled={saving || busyStop}
                        onClick={() => onCreateIntakes(t)}
                        title="Создать приёмы по остановкам «Забрано»"
                      >
                        <Plus size={13} /> Оформить приёмы ({doneStops.filter((i) => !i.intakeId).length})
                      </button>
                    )}
                    {editable && (
                      <button
                        type="button"
                        className="admin-btn admin-btn--ghost admin-btn--sm"
                        disabled={saving || busyStop}
                        onClick={() => onEdit(t)}
                      >
                        <Pencil size={13} /> Править рейс
                      </button>
                    )}
                    {editable && (
                      <button
                        type="button"
                        className="admin-btn admin-btn--danger-ghost admin-btn--sm"
                        disabled={saving || busyStop}
                        onClick={() => onSetStatus(t, "cancelled")}
                      >
                        Отменить
                      </button>
                    )}
                    {t.status === "planned" && (
                      <button
                        type="button"
                        className="admin-btn admin-btn--ghost admin-btn--sm"
                        disabled={saving || busyStop}
                        onClick={() => onDelete(t)}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>

                  {t.note && <p className="admin-hint">{t.note}</p>}

                  {/* Остановки */}
                  {t.items.length === 0 ? (
                    <p className="admin-hint">
                      Остановок нет
                      {editable && " — добавьте точки забора через «Добавить остановку»."}
                    </p>
                  ) : (
                    <div className="admin-table-wrap" style={{ marginBottom: 10 }}>
                      <table className="admin-table">
                        <thead>
                          <tr>
                            <th>Время</th>
                            <th>Контрагент / адрес</th>
                            <th>Вид</th>
                            <th>План</th>
                            <th>Факт</th>
                            <th>Статус</th>
                            {editable && <th></th>}
                          </tr>
                        </thead>
                        <tbody>
                          {t.items.map((stop) => (
                            <tr key={stop.id}>
                              <td style={{ whiteSpace: "nowrap" }}>
                                {stop.approxTime ? fmtTime(stop.approxTime) : "—"}
                              </td>
                              <td>
                                <div style={{ fontWeight: 600 }}>
                                  {stop.counterpartyName || "—"}
                                </div>
                                {stop.address && (
                                  <div style={{ color: "var(--adm-muted)", fontSize: "0.8rem" }}>
                                    <MapPin size={11} style={{ verticalAlign: "-1px" }} /> {stop.address}
                                  </div>
                                )}
                                {stop.note && (
                                  <div style={{ color: "var(--adm-muted)", fontSize: "0.8rem" }}>
                                    {stop.note}
                                  </div>
                                )}
                                {stop.intakeId && (
                                  <span className="admin-badge admin-badge--teal">приём оформлен</span>
                                )}
                              </td>
                              <td>{WP_TYPE_LABELS[stop.wastepaperType] || stop.wastepaperType}</td>
                              <td style={{ whiteSpace: "nowrap" }}>{fmtKg(stop.plannedKg)}</td>
                              <td style={{ whiteSpace: "nowrap" }}>
                                {stop.actualKg != null ? fmtKg(stop.actualKg) : "—"}
                              </td>
                              <td>
                                <span className={STOP_BADGE[stop.status]}>
                                  {WP_STOP_STATUS_LABELS[stop.status]}
                                </span>
                              </td>
                              {editable && (
                                <td style={{ whiteSpace: "nowrap" }}>
                                  {stop.status !== "done" && (
                                    <button
                                      type="button"
                                      className="admin-btn admin-btn--ghost admin-btn--sm"
                                      disabled={saving || busyStop}
                                      onClick={() => markStop(t, stop, "done")}
                                      title="Макулатуру забрали"
                                    >
                                      <Check size={13} />
                                    </button>
                                  )}
                                  {stop.status !== "skipped" && (
                                    <button
                                      type="button"
                                      className="admin-btn admin-btn--ghost admin-btn--sm"
                                      disabled={saving || busyStop}
                                      onClick={() => markStop(t, stop, "skipped")}
                                      title="Точка пропущена (ЧП)"
                                    >
                                      <X size={13} />
                                    </button>
                                  )}
                                  {stop.status !== "pending" && !stop.intakeId && (
                                    <button
                                      type="button"
                                      className="admin-btn admin-btn--ghost admin-btn--sm"
                                      disabled={saving || busyStop}
                                      onClick={() => markStop(t, stop, "pending")}
                                      title="Вернуть в ожидание"
                                    >
                                      <RotateCcw size={13} />
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className="admin-btn admin-btn--ghost admin-btn--sm"
                                    disabled={saving || busyStop}
                                    onClick={() =>
                                      setStopModal({ transport: t, stop, items: t.items })
                                    }
                                    title="Править остановку"
                                  >
                                    <Pencil size={13} />
                                  </button>
                                  {!stop.intakeId && (
                                    <button
                                      type="button"
                                      className="admin-btn admin-btn--ghost admin-btn--sm"
                                      disabled={saving || busyStop}
                                      onClick={() => removeStop(t, stop)}
                                      title="Убрать остановку"
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  )}
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {editable && (
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      disabled={saving || busyStop}
                      onClick={() => setStopModal({ transport: t, stop: null, items: t.items })}
                    >
                      <Plus size={13} /> Добавить остановку
                    </button>
                  )}
                  <span className="admin-hint" style={{ marginLeft: 10 }}>
                    План всего: {fmtKg(t.totalPlannedKg)} · остановок: {t.items.length}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Модалка одной остановки (быстрая правка при ЧП) */}
      {stopModal && (
        <StopModal
          transport={stopModal.transport}
          stop={stopModal.stop}
          counterparties={counterparties}
          saving={saving || busyStop}
          onClose={() => setStopModal(null)}
          onSubmit={async (stop) => {
            let items: WpTransportItem[];
            if (stopModal.stop) {
              items = stopModal.items.map((i) => (i.id === stop.id ? stop : i));
            } else {
              items = [...stopModal.items, stop];
            }
            const ok = await onSaveItems(stopModal.transport, items);
            if (ok) setStopModal(null);
          }}
        />
      )}
    </div>
  );
}

/* ── Модалка остановки ─────────────────────────────────── */

function StopModal({
  transport,
  stop,
  counterparties,
  saving,
  onClose,
  onSubmit,
}: {
  transport: WpTransport;
  stop: WpTransportItem | null;
  counterparties: WpCounterparty[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (stop: WpTransportItem) => void;
}) {
  // Модалка рендерится inline — блокируем скролл фона (iOS-safe).
  useBodyLock(true);
  const suppliers = counterparties.filter((c) => c.roles.includes("supplier"));
  const [form, setForm] = useState({
    counterpartyName: stop?.counterpartyName || "",
    counterpartyId: stop?.counterpartyId || null as string | null,
    address: stop?.address || "",
    approxTime: stop?.approxTime || "",
    wastepaperType: stop?.wastepaperType || "cardboard",
    plannedKg: stop?.plannedKg ? String(stop.plannedKg) : "",
    actualKg: stop?.actualKg != null ? String(stop.actualKg) : "",
    note: stop?.note || "",
    status: (stop?.status || "pending") as WpTransportItem["status"],
  });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function onNameChange(value: string) {
    const found = suppliers.find(
      (c) => c.name.trim().toLowerCase() === value.trim().toLowerCase()
    );
    setForm((prev) => ({
      ...prev,
      counterpartyName: value,
      counterpartyId: found ? found.id : null,
      address: prev.address || found?.address || prev.address,
    }));
  }

  const valid = form.counterpartyName.trim() !== "" || form.address.trim() !== "";

  return (
    <div className="admin-modal-overlay" onClick={() => !saving && onClose()}>
      <div
        className="admin-modal"
        style={{ maxWidth: "32rem" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="admin-modal__head">
          <h3 className="admin-modal__title">
            {stop ? "Остановка перевозки" : "Новая остановка"} · ТМ-{transport.number}
          </h3>
          <button
            type="button"
            className="admin-modal__close"
            onClick={onClose}
            disabled={saving}
            aria-label="Закрыть"
          >
            <X size={16} />
          </button>
        </div>
        <p className="admin-modal__desc">
          Точка забора макулатуры: кто сдаёт, адрес, примерное время заезда.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            onSubmit({
              id:
                stop?.id ||
                `stop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
              counterpartyId: form.counterpartyId,
              counterpartyName: form.counterpartyName.trim(),
              address: form.address.trim(),
              approxTime: approxTimeOk(form.approxTime) ? form.approxTime.trim() : "",
              wastepaperType: form.wastepaperType,
              plannedKg: parseNum(form.plannedKg),
              actualKg: form.actualKg.trim() === "" ? null : parseNum(form.actualKg),
              note: form.note.trim(),
              status: form.status,
              intakeId: stop?.intakeId || null,
            });
          }}
        >
          <div className="admin-field">
            <label className="admin-label">Кто сдаёт *</label>
            <input
              className="admin-input"
              list="wp-stop-suppliers"
              value={form.counterpartyName}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="Имя или компания"
              autoFocus
            />
            <datalist id="wp-stop-suppliers">
              {suppliers.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
          </div>

          <div className="admin-field">
            <label className="admin-label">Адрес забора</label>
            <input
              className="admin-input"
              value={form.address}
              onChange={(e) => set("address", e.target.value)}
              placeholder="Улица, дом, ориентир"
            />
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div className="admin-field" style={{ flex: "1 1 120px" }}>
              <label className="admin-label">Примерное время</label>
              <input
                className="admin-input"
                value={form.approxTime}
                onChange={(e) => set("approxTime", e.target.value)}
                placeholder="~14:00"
              />
            </div>
            <div className="admin-field" style={{ flex: "1 1 160px" }}>
              <label className="admin-label">Вид макулатуры</label>
              <select
                className="admin-select"
                value={form.wastepaperType}
                onChange={(e) => set("wastepaperType", e.target.value)}
              >
                {WP_TYPE_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div className="admin-field" style={{ flex: "1 1 120px" }}>
              <label className="admin-label">План, кг</label>
              <input
                className="admin-input"
                type="number"
                min="0"
                step="0.1"
                value={form.plannedKg}
                onChange={(e) => set("plannedKg", e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="admin-field" style={{ flex: "1 1 120px" }}>
              <label className="admin-label">Факт, кг</label>
              <input
                className="admin-input"
                type="number"
                min="0"
                step="0.1"
                value={form.actualKg}
                onChange={(e) => set("actualKg", e.target.value)}
                placeholder="—"
              />
            </div>
            <div className="admin-field" style={{ flex: "1 1 140px" }}>
              <label className="admin-label">Статус</label>
              <select
                className="admin-select"
                value={form.status}
                onChange={(e) => set("status", e.target.value as WpTransportItem["status"])}
              >
                {Object.entries(WP_STOP_STATUS_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="admin-field">
            <label className="admin-label">Заметка</label>
            <input
              className="admin-input"
              value={form.note}
              onChange={(e) => set("note", e.target.value)}
              placeholder="Код домофона, контакт на месте…"
            />
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              onClick={onClose}
              disabled={saving}
            >
              Отмена
            </button>
            <button type="submit" className="admin-btn admin-btn--primary" disabled={saving || !valid}>
              {saving && <Loader2 size={14} className="animate-spin" />} Сохранить
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   ВКЛАДКА «КОНТРАГЕНТЫ»
   ═══════════════════════════════════════════════════════ */

function CounterpartiesTab({
  counterparties,
  onNew,
  onEdit,
}: {
  counterparties: WpCounterparty[];
  onNew: () => void;
  onEdit: (item: WpCounterparty) => void;
}) {
  const [role, setRole] = useState<"all" | "supplier" | "enterprise">("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return counterparties.filter((c) => {
      if (role !== "all" && !c.roles.includes(role)) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        (c.address || "").toLowerCase().includes(q) ||
        (c.phone || "").includes(q) ||
        (c.inn || "").includes(q)
      );
    });
  }, [counterparties, role, query]);

  return (
    <div>
      <div
        className="admin-card"
        style={{ padding: "12px 16px", marginBottom: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}
      >
        <div style={{ flex: "1 1 220px", position: "relative" }}>
          <Search
            size={14}
            style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--adm-muted)", pointerEvents: "none" }}
          />
          <input
            className="admin-input"
            style={{ paddingLeft: 30, width: "100%" }}
            placeholder="Поиск по названию, адресу, телефону, ИНН…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="admin-filters" style={{ marginBottom: 0 }}>
          {(
            [
              { key: "all", label: "Все" },
              { key: "supplier", label: "Сдают нам" },
              { key: "enterprise", label: "Принимают у нас" },
            ] as const
          ).map((o) => (
            <button
              key={o.key}
              type="button"
              className={`admin-filter${role === o.key ? " admin-filter--active" : ""}`}
              onClick={() => setRole(o.key)}
            >
              {o.label}
            </button>
          ))}
        </div>
        <button type="button" className="admin-btn admin-btn--navy" onClick={onNew}>
          <Plus size={15} /> Контрагент
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="admin-card">
          <div className="admin-card__pad">
            <p className="admin-hint">
              Контрагентов пока нет. Добавьте, от кого забираете макулатуру и
              каким предприятиям сдаёте — адрес и телефон подставятся в приёмы и
              перевозки.
            </p>
          </div>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Название</th>
                <th>Роль</th>
                <th>Телефон</th>
                <th>Адрес</th>
                <th>Контакт</th>
                <th>ИНН</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>
                    {c.name}
                    {c.comment && (
                      <div style={{ color: "var(--adm-muted)", fontSize: "0.8rem", fontWeight: 400 }}>
                        {c.comment}
                      </div>
                    )}
                  </td>
                  <td>
                    {c.roles.map((r) => (
                      <span
                        key={r}
                        className={
                          r === "supplier"
                            ? "admin-badge admin-badge--amber"
                            : "admin-badge admin-badge--teal"
                        }
                        style={{ marginRight: 4 }}
                      >
                        {WP_COUNTERPARTY_ROLE_LABELS[r as keyof typeof WP_COUNTERPARTY_ROLE_LABELS] ||
                          r}
                      </span>
                    ))}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {c.phone ? <a href={`tel:${c.phone}`}>{c.phone}</a> : "—"}
                  </td>
                  <td>{c.address || "—"}</td>
                  <td>{c.contactPerson || "—"}</td>
                  <td>{c.inn || "—"}</td>
                  <td>
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      onClick={() => onEdit(c)}
                    >
                      <Pencil size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   МОДАЛКА: ПРИЁМ
   ═══════════════════════════════════════════════════════ */

interface IntakeFormPayload {
  date: string;
  counterpartyId: string | null;
  counterpartyName: string;
  address: string | null;
  wastepaperType: string;
  weightKg: number;
  pricePerKg: number;
  account: WpAccount;
  isPaid: boolean;
  comment: string | null;
  saveCounterparty: boolean;
  counterpartyPhone: string;
}

function IntakeModal({
  mode,
  item,
  suppliers,
  rates,
  saving,
  error,
  onClose,
  onSubmit,
  onCancelDoc,
  onDelete,
}: {
  mode: "create" | "edit";
  item: WpIntake | null;
  suppliers: WpCounterparty[];
  rates: WastepaperRates | null;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (form: IntakeFormPayload) => void;
  onCancelDoc: () => void;
  onDelete: () => void;
}) {
  // Модалка рендерится inline — блокируем скролл фона (iOS-safe).
  useBodyLock(true);
  const [form, setForm] = useState({
    date: item?.date || todayStr(),
    counterpartyName: item?.counterpartyName || "",
    counterpartyId: item?.counterpartyId || (null as string | null),
    address: item?.address || "",
    wastepaperType: item?.wastepaperType || "cardboard",
    weightKg: item ? String(item.weightKg) : "",
    pricePerKg: item ? String(item.pricePerKg) : "",
    account: (item?.account || "cash") as WpAccount,
    isPaid: item?.isPaid || false,
    comment: item?.comment || "",
    saveCounterparty: true,
    counterpartyPhone: "",
  });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function onNameChange(value: string) {
    const found = suppliers.find(
      (c) => c.name.trim().toLowerCase() === value.trim().toLowerCase()
    );
    setForm((prev) => ({
      ...prev,
      counterpartyName: value,
      counterpartyId: found ? found.id : null,
      address: found?.address || prev.address,
    }));
  }

  function onTypeChange(value: string) {
    setForm((prev) => {
      // Подставляем тариф из настроек, если цена пустая.
      const rate = rates ? (rates as Record<string, number>)[value] : undefined;
      return {
        ...prev,
        wastepaperType: value,
        pricePerKg:
          prev.pricePerKg.trim() === "" && rate != null ? String(rate) : prev.pricePerKg,
      };
    });
  }

  const weight = parseNum(form.weightKg);
  const price = parseNum(form.pricePerKg);
  const total = Math.round(weight * price * 100) / 100;
  const valid = form.date !== "" && form.counterpartyName.trim() !== "" && weight > 0;

  return (
    <div className="admin-modal-overlay" onClick={() => !saving && onClose()}>
      <div
        className="admin-modal"
        style={{ maxWidth: "34rem" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="admin-modal__head">
          <h3 className="admin-modal__title">
            {mode === "edit" ? `Приём №${item?.number}` : "Новый приём макулатуры"}
          </h3>
          <button
            type="button"
            className="admin-modal__close"
            onClick={onClose}
            disabled={saving}
            aria-label="Закрыть"
          >
            <X size={16} />
          </button>
        </div>
        <p className="admin-modal__desc">
          Приняли макулатуру от клиента: от кого, сколько кг и по какой цене.
          Сумма уйдёт в расход выбранного счёта (после отметки «Оплачен»).
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            onSubmit({
              date: form.date,
              counterpartyId: form.counterpartyId,
              counterpartyName: form.counterpartyName.trim(),
              address: form.address.trim() || null,
              wastepaperType: form.wastepaperType,
              weightKg: weight,
              pricePerKg: price,
              account: form.account,
              isPaid: form.isPaid,
              comment: form.comment.trim() || null,
              saveCounterparty: form.saveCounterparty,
              counterpartyPhone: form.counterpartyPhone.trim(),
            });
          }}
        >
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div className="admin-field" style={{ flex: "1 1 150px" }}>
              <label className="admin-label">Дата *</label>
              <input
                className="admin-input"
                type="date"
                value={form.date}
                onChange={(e) => set("date", e.target.value)}
                required
              />
            </div>
            <div className="admin-field" style={{ flex: "2 1 220px" }}>
              <label className="admin-label">От кого приняли *</label>
              <input
                className="admin-input"
                list="wp-intake-suppliers"
                value={form.counterpartyName}
                onChange={(e) => onNameChange(e.target.value)}
                placeholder="Имя или компания"
                autoFocus={mode === "create"}
                required
              />
              <datalist id="wp-intake-suppliers">
                {suppliers.map((c) => (
                  <option key={c.id} value={c.name} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="admin-field">
            <label className="admin-label">Адрес</label>
            <input
              className="admin-input"
              value={form.address}
              onChange={(e) => set("address", e.target.value)}
              placeholder="Где забрали / куда привезли"
            />
          </div>

          {mode === "create" && !form.counterpartyId && form.counterpartyName.trim() && (
            <label className="admin-hint" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: -6 }}>
              <input
                type="checkbox"
                checked={form.saveCounterparty}
                onChange={(e) => set("saveCounterparty", e.target.checked)}
              />
              Сохранить «{form.counterpartyName.trim()}» в контрагенты (чтобы адрес
              подставлялся в следующий раз)
            </label>
          )}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div className="admin-field" style={{ flex: "1 1 150px" }}>
              <label className="admin-label">Вид макулатуры</label>
              <select
                className="admin-select"
                value={form.wastepaperType}
                onChange={(e) => onTypeChange(e.target.value)}
              >
                {WP_TYPE_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="admin-field" style={{ flex: "1 1 110px" }}>
              <label className="admin-label">Вес, кг *</label>
              <input
                className="admin-input"
                type="number"
                min="0"
                step="0.1"
                value={form.weightKg}
                onChange={(e) => set("weightKg", e.target.value)}
                placeholder="0"
                required
              />
            </div>
            <div className="admin-field" style={{ flex: "1 1 110px" }}>
              <label className="admin-label">Цена, ₽/кг</label>
              <input
                className="admin-input"
                type="number"
                min="0"
                step="0.01"
                value={form.pricePerKg}
                onChange={(e) => set("pricePerKg", e.target.value)}
                placeholder={
                  rates
                    ? String((rates as Record<string, number>)[form.wastepaperType] ?? 0)
                    : "0"
                }
              />
            </div>
            <div className="admin-field" style={{ flex: "1 1 120px" }}>
              <label className="admin-label">Сумма</label>
              <input className="admin-input" value={fmtMoney(total)} readOnly />
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div className="admin-field" style={{ flex: "1 1 200px" }}>
              <label className="admin-label">Счёт</label>
              <select
                className="admin-select"
                value={form.account}
                onChange={(e) => set("account", e.target.value as WpAccount)}
              >
                <option value="cash">Наличка</option>
                <option value="bank">Безнал</option>
              </select>
            </div>
            <label
              className="admin-hint"
              style={{ display: "flex", gap: 8, alignItems: "center", paddingBottom: 12 }}
            >
              <input
                type="checkbox"
                checked={form.isPaid}
                onChange={(e) => set("isPaid", e.target.checked)}
              />
              Уже оплачено
            </label>
          </div>

          <div className="admin-field">
            <label className="admin-label">Комментарий</label>
            <input
              className="admin-input"
              value={form.comment}
              onChange={(e) => set("comment", e.target.value)}
              placeholder="Например: частями, довоз завтра…"
            />
          </div>

          {error && (
            <p className="admin-error" style={{ marginTop: -4 }}>
              {error}
            </p>
          )}

          <div style={{ display: "flex", gap: 10, justifyContent: "space-between", flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 8 }}>
              {mode === "edit" && (
                <>
                  <button
                    type="button"
                    className="admin-btn admin-btn--ghost admin-btn--sm"
                    onClick={onCancelDoc}
                    disabled={saving}
                  >
                    <RotateCcw size={13} />{" "}
                    {item?.status === "cancelled" ? "Восстановить" : "Отменить приём"}
                  </button>
                  <button
                    type="button"
                    className="admin-btn admin-btn--danger-ghost admin-btn--sm"
                    onClick={onDelete}
                    disabled={saving}
                  >
                    <Trash2 size={13} /> Удалить
                  </button>
                </>
              )}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={onClose}
                disabled={saving}
              >
                Закрыть
              </button>
              <button
                type="submit"
                className="admin-btn admin-btn--primary"
                disabled={saving || !valid}
              >
                {saving && <Loader2 size={14} className="animate-spin" />}{" "}
                {mode === "edit" ? "Сохранить" : "Добавить приём"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   МОДАЛКА: СДАЧА НА ПРЕДПРИЯТИЕ
   ═══════════════════════════════════════════════════════ */

interface ShipmentFormPayload {
  date: string;
  enterpriseId: string | null;
  enterpriseName: string;
  wastepaperType: string;
  weightKg: number;
  pricePerKg: number;
  account: WpAccount;
  isPaid: boolean;
  comment: string | null;
  saveCounterparty: boolean;
}

function ShipmentModal({
  mode,
  item,
  enterprises,
  saving,
  error,
  onClose,
  onSubmit,
  onCancelDoc,
  onDelete,
}: {
  mode: "create" | "edit";
  item: WpShipment | null;
  enterprises: WpCounterparty[];
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (form: ShipmentFormPayload) => void;
  onCancelDoc: () => void;
  onDelete: () => void;
}) {
  // Модалка рендерится inline — блокируем скролл фона (iOS-safe).
  useBodyLock(true);
  const [form, setForm] = useState({
    date: item?.date || todayStr(),
    enterpriseName: item?.enterpriseName || "",
    enterpriseId: item?.enterpriseId || (null as string | null),
    wastepaperType: item?.wastepaperType || "cardboard",
    weightKg: item ? String(item.weightKg) : "",
    pricePerKg: item ? String(item.pricePerKg) : "",
    account: (item?.account || "bank") as WpAccount,
    isPaid: item?.isPaid || false,
    comment: item?.comment || "",
    saveCounterparty: true,
  });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function onNameChange(value: string) {
    const found = enterprises.find(
      (c) => c.name.trim().toLowerCase() === value.trim().toLowerCase()
    );
    setForm((prev) => ({
      ...prev,
      enterpriseName: value,
      enterpriseId: found ? found.id : null,
    }));
  }

  const weight = parseNum(form.weightKg);
  const price = parseNum(form.pricePerKg);
  const total = Math.round(weight * price * 100) / 100;
  const valid = form.date !== "" && form.enterpriseName.trim() !== "" && weight > 0;

  return (
    <div className="admin-modal-overlay" onClick={() => !saving && onClose()}>
      <div
        className="admin-modal"
        style={{ maxWidth: "34rem" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="admin-modal__head">
          <h3 className="admin-modal__title">
            {mode === "edit" ? `Сдача №${item?.number}` : "Сдача на предприятие"}
          </h3>
          <button
            type="button"
            className="admin-modal__close"
            onClick={onClose}
            disabled={saving}
            aria-label="Закрыть"
          >
            <X size={16} />
          </button>
        </div>
        <p className="admin-modal__desc">
          Сдали накопленную макулатуру на предприятие: вес, цена, сумма придёт в
          выбранный счёт. Когда деньги получите — отметьте оплату.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            onSubmit({
              date: form.date,
              enterpriseId: form.enterpriseId,
              enterpriseName: form.enterpriseName.trim(),
              wastepaperType: form.wastepaperType,
              weightKg: weight,
              pricePerKg: price,
              account: form.account,
              isPaid: form.isPaid,
              comment: form.comment.trim() || null,
              saveCounterparty: form.saveCounterparty,
            });
          }}
        >
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div className="admin-field" style={{ flex: "1 1 150px" }}>
              <label className="admin-label">Дата *</label>
              <input
                className="admin-input"
                type="date"
                value={form.date}
                onChange={(e) => set("date", e.target.value)}
                required
              />
            </div>
            <div className="admin-field" style={{ flex: "2 1 220px" }}>
              <label className="admin-label">Предприятие-приёмщик *</label>
              <input
                className="admin-input"
                list="wp-shipment-enterprises"
                value={form.enterpriseName}
                onChange={(e) => onNameChange(e.target.value)}
                placeholder="Кому сдаём"
                autoFocus={mode === "create"}
                required
              />
              <datalist id="wp-shipment-enterprises">
                {enterprises.map((c) => (
                  <option key={c.id} value={c.name} />
                ))}
              </datalist>
            </div>
          </div>

          {mode === "create" && !form.enterpriseId && form.enterpriseName.trim() && (
            <label className="admin-hint" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: -6 }}>
              <input
                type="checkbox"
                checked={form.saveCounterparty}
                onChange={(e) => set("saveCounterparty", e.target.checked)}
              />
              Сохранить «{form.enterpriseName.trim()}» в контрагенты
            </label>
          )}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div className="admin-field" style={{ flex: "1 1 150px" }}>
              <label className="admin-label">Вид макулатуры</label>
              <select
                className="admin-select"
                value={form.wastepaperType}
                onChange={(e) => set("wastepaperType", e.target.value)}
              >
                {WP_TYPE_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="admin-field" style={{ flex: "1 1 110px" }}>
              <label className="admin-label">Вес, кг *</label>
              <input
                className="admin-input"
                type="number"
                min="0"
                step="0.1"
                value={form.weightKg}
                onChange={(e) => set("weightKg", e.target.value)}
                placeholder="0"
                required
              />
            </div>
            <div className="admin-field" style={{ flex: "1 1 110px" }}>
              <label className="admin-label">Цена, ₽/кг</label>
              <input
                className="admin-input"
                type="number"
                min="0"
                step="0.01"
                value={form.pricePerKg}
                onChange={(e) => set("pricePerKg", e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="admin-field" style={{ flex: "1 1 120px" }}>
              <label className="admin-label">Сумма</label>
              <input className="admin-input" value={fmtMoney(total)} readOnly />
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div className="admin-field" style={{ flex: "1 1 200px" }}>
              <label className="admin-label">Куда придут деньги</label>
              <select
                className="admin-select"
                value={form.account}
                onChange={(e) => set("account", e.target.value as WpAccount)}
              >
                <option value="bank">Безнал</option>
                <option value="cash">Наличка</option>
              </select>
            </div>
            <label
              className="admin-hint"
              style={{ display: "flex", gap: 8, alignItems: "center", paddingBottom: 12 }}
            >
              <input
                type="checkbox"
                checked={form.isPaid}
                onChange={(e) => set("isPaid", e.target.checked)}
              />
              Деньги уже получены
            </label>
          </div>

          <div className="admin-field">
            <label className="admin-label">Комментарий</label>
            <input
              className="admin-input"
              value={form.comment}
              onChange={(e) => set("comment", e.target.value)}
              placeholder="Например: акт №…, оплата по счёту до пятницы…"
            />
          </div>

          {error && (
            <p className="admin-error" style={{ marginTop: -4 }}>
              {error}
            </p>
          )}

          <div style={{ display: "flex", gap: 10, justifyContent: "space-between", flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 8 }}>
              {mode === "edit" && (
                <>
                  <button
                    type="button"
                    className="admin-btn admin-btn--ghost admin-btn--sm"
                    onClick={onCancelDoc}
                    disabled={saving}
                  >
                    <RotateCcw size={13} />{" "}
                    {item?.status === "cancelled" ? "Восстановить" : "Отменить сдачу"}
                  </button>
                  <button
                    type="button"
                    className="admin-btn admin-btn--danger-ghost admin-btn--sm"
                    onClick={onDelete}
                    disabled={saving}
                  >
                    <Trash2 size={13} /> Удалить
                  </button>
                </>
              )}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={onClose}
                disabled={saving}
              >
                Закрыть
              </button>
              <button
                type="submit"
                className="admin-btn admin-btn--primary"
                disabled={saving || !valid}
              >
                {saving && <Loader2 size={14} className="animate-spin" />}{" "}
                {mode === "edit" ? "Сохранить" : "Добавить сдачу"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   МОДАЛКА: РУЧНОЙ ПЛАТЁЖ
   ═══════════════════════════════════════════════════════ */

interface PaymentFormPayload {
  date: string;
  direction: "incoming" | "outgoing";
  account: WpAccount;
  counterpartyId: string | null;
  counterpartyName: string;
  amount: number;
  isPaid: boolean;
  comment: string | null;
}

function PaymentModal({
  mode,
  item,
  counterparties,
  saving,
  error,
  onClose,
  onSubmit,
  onDelete,
}: {
  mode: "create" | "edit";
  item: WpManualPayment | null;
  counterparties: WpCounterparty[];
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (form: PaymentFormPayload) => void;
  onDelete: () => void;
}) {
  // Модалка рендерится inline — блокируем скролл фона (iOS-safe).
  useBodyLock(true);
  const [form, setForm] = useState({
    date: item?.date || todayStr(),
    direction: (item?.direction || "incoming") as "incoming" | "outgoing",
    account: (item?.account || "cash") as WpAccount,
    counterpartyName: item?.counterpartyName || "",
    counterpartyId: item?.counterpartyId || (null as string | null),
    amount: item ? String(item.amount) : "",
    isPaid: item ? item.isPaid : true,
    comment: item?.comment || "",
  });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function onNameChange(value: string) {
    const found = counterparties.find(
      (c) => c.name.trim().toLowerCase() === value.trim().toLowerCase()
    );
    setForm((prev) => ({
      ...prev,
      counterpartyName: value,
      counterpartyId: found ? found.id : null,
    }));
  }

  const amount = parseNum(form.amount);
  const valid = form.date !== "" && amount > 0;

  return (
    <div className="admin-modal-overlay" onClick={() => !saving && onClose()}>
      <div
        className="admin-modal"
        style={{ maxWidth: "30rem" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="admin-modal__head">
          <h3 className="admin-modal__title">
            {mode === "edit" ? `Платёж №${item?.number}` : "Новый платёж"}
          </h3>
          <button
            type="button"
            className="admin-modal__close"
            onClick={onClose}
            disabled={saving}
            aria-label="Закрыть"
          >
            <X size={16} />
          </button>
        </div>
        <p className="admin-modal__desc">
          Внесение денег вручную: например, получили оплату за сдачу не сразу, или
          выдали наличку на расходы. Приход/расход по наличке и безналу учитывается
          и отдельно, и вместе.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            onSubmit({
              date: form.date,
              direction: form.direction,
              account: form.account,
              counterpartyId: form.counterpartyId,
              counterpartyName: form.counterpartyName.trim(),
              amount,
              isPaid: form.isPaid,
              comment: form.comment.trim() || null,
            });
          }}
        >
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div className="admin-field" style={{ flex: "1 1 140px" }}>
              <label className="admin-label">Дата *</label>
              <input
                className="admin-input"
                type="date"
                value={form.date}
                onChange={(e) => set("date", e.target.value)}
                required
              />
            </div>
            <div className="admin-field" style={{ flex: "1 1 140px" }}>
              <label className="admin-label">Направление</label>
              <select
                className="admin-select"
                value={form.direction}
                onChange={(e) => set("direction", e.target.value as "incoming" | "outgoing")}
              >
                <option value="incoming">Приход</option>
                <option value="outgoing">Расход</option>
              </select>
            </div>
            <div className="admin-field" style={{ flex: "1 1 140px" }}>
              <label className="admin-label">Счёт</label>
              <select
                className="admin-select"
                value={form.account}
                onChange={(e) => set("account", e.target.value as WpAccount)}
              >
                <option value="cash">Наличка</option>
                <option value="bank">Безнал</option>
              </select>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div className="admin-field" style={{ flex: "2 1 200px" }}>
              <label className="admin-label">Контрагент</label>
              <input
                className="admin-input"
                list="wp-payment-counterparties"
                value={form.counterpartyName}
                onChange={(e) => onNameChange(e.target.value)}
                placeholder="Кто платит / кому платим"
              />
              <datalist id="wp-payment-counterparties">
                {counterparties.map((c) => (
                  <option key={c.id} value={c.name} />
                ))}
              </datalist>
            </div>
            <div className="admin-field" style={{ flex: "1 1 140px" }}>
              <label className="admin-label">Сумма, ₽ *</label>
              <input
                className="admin-input"
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(e) => set("amount", e.target.value)}
                placeholder="0"
                required
              />
            </div>
          </div>

          <label className="admin-hint" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={form.isPaid}
              onChange={(e) => set("isPaid", e.target.checked)}
            />
            Проведён (деньги реально двигаются). Снять галочку — будет в прогнозе.
          </label>

          <div className="admin-field">
            <label className="admin-label">Комментарий</label>
            <input
              className="admin-input"
              value={form.comment}
              onChange={(e) => set("comment", e.target.value)}
              placeholder="За что платёж…"
            />
          </div>

          {error && (
            <p className="admin-error" style={{ marginTop: -4 }}>
              {error}
            </p>
          )}

          <div style={{ display: "flex", gap: 10, justifyContent: "space-between", flexWrap: "wrap" }}>
            <div>
              {mode === "edit" && (
                <button
                  type="button"
                  className="admin-btn admin-btn--danger-ghost admin-btn--sm"
                  onClick={onDelete}
                  disabled={saving}
                >
                  <Trash2 size={13} /> Удалить
                </button>
              )}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={onClose}
                disabled={saving}
              >
                Закрыть
              </button>
              <button
                type="submit"
                className="admin-btn admin-btn--primary"
                disabled={saving || !valid}
              >
                {saving && <Loader2 size={14} className="animate-spin" />}{" "}
                {mode === "edit" ? "Сохранить" : "Добавить платёж"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   МОДАЛКА: КОНТРАГЕНТ
   ═══════════════════════════════════════════════════════ */

interface CounterpartyFormPayload {
  name: string;
  roles: string[];
  phone: string | null;
  address: string | null;
  contactPerson: string | null;
  inn: string | null;
  comment: string | null;
}

function CounterpartyModal({
  mode,
  item,
  saving,
  error,
  onClose,
  onSubmit,
  onDelete,
}: {
  mode: "create" | "edit";
  item: WpCounterparty | null;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (form: CounterpartyFormPayload) => void;
  onDelete: () => void;
}) {
  // Модалка рендерится inline — блокируем скролл фона (iOS-safe).
  useBodyLock(true);
  const [form, setForm] = useState({
    name: item?.name || "",
    roles: item?.roles || (["supplier"] as string[]),
    phone: item?.phone || "",
    address: item?.address || "",
    contactPerson: item?.contactPerson || "",
    inn: item?.inn || "",
    comment: item?.comment || "",
  });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleRole(role: string) {
    setForm((prev) => ({
      ...prev,
      roles: prev.roles.includes(role)
        ? prev.roles.filter((r) => r !== role)
        : [...prev.roles, role],
    }));
  }

  const valid = form.name.trim() !== "" && form.roles.length > 0;

  return (
    <div className="admin-modal-overlay" onClick={() => !saving && onClose()}>
      <div
        className="admin-modal"
        style={{ maxWidth: "32rem" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="admin-modal__head">
          <h3 className="admin-modal__title">
            {mode === "edit" ? `Контрагент: ${item?.name}` : "Новый контрагент"}
          </h3>
          <button
            type="button"
            className="admin-modal__close"
            onClick={onClose}
            disabled={saving}
            aria-label="Закрыть"
          >
            <X size={16} />
          </button>
        </div>
        <p className="admin-modal__desc">
          Кто сдаёт нам макулатуру или какое предприятие принимает у нас — с
          адресом, телефоном и реквизитами.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            onSubmit({
              name: form.name.trim(),
              roles: form.roles,
              phone: form.phone.trim() || null,
              address: form.address.trim() || null,
              contactPerson: form.contactPerson.trim() || null,
              inn: form.inn.trim() || null,
              comment: form.comment.trim() || null,
            });
          }}
        >
          <div className="admin-field">
            <label className="admin-label">Название *</label>
            <input
              className="admin-input"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Имя или компания"
              autoFocus={mode === "create"}
              required
            />
          </div>

          <div className="admin-field">
            <label className="admin-label">Роль *</label>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              {Object.entries(WP_COUNTERPARTY_ROLE_LABELS).map(([key, label]) => (
                <label key={key} className="admin-hint" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={form.roles.includes(key)}
                    onChange={() => toggleRole(key)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div className="admin-field" style={{ flex: "1 1 160px" }}>
              <label className="admin-label">Телефон</label>
              <input
                className="admin-input"
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                placeholder="+7…"
              />
            </div>
            <div className="admin-field" style={{ flex: "1 1 160px" }}>
              <label className="admin-label">Контактное лицо</label>
              <input
                className="admin-input"
                value={form.contactPerson}
                onChange={(e) => set("contactPerson", e.target.value)}
              />
            </div>
          </div>

          <div className="admin-field">
            <label className="admin-label">Адрес</label>
            <input
              className="admin-input"
              value={form.address}
              onChange={(e) => set("address", e.target.value)}
              placeholder="Где забирать / куда везти"
            />
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div className="admin-field" style={{ flex: "1 1 160px" }}>
              <label className="admin-label">ИНН</label>
              <input
                className="admin-input"
                value={form.inn}
                onChange={(e) => set("inn", e.target.value)}
              />
            </div>
            <div className="admin-field" style={{ flex: "2 1 220px" }}>
              <label className="admin-label">Комментарий</label>
              <input
                className="admin-input"
                value={form.comment}
                onChange={(e) => set("comment", e.target.value)}
              />
            </div>
          </div>

          {error && (
            <p className="admin-error" style={{ marginTop: -4 }}>
              {error}
            </p>
          )}

          <div style={{ display: "flex", gap: 10, justifyContent: "space-between", flexWrap: "wrap" }}>
            <div>
              {mode === "edit" && (
                <button
                  type="button"
                  className="admin-btn admin-btn--danger-ghost admin-btn--sm"
                  onClick={onDelete}
                  disabled={saving}
                >
                  <Trash2 size={13} /> Удалить
                </button>
              )}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={onClose}
                disabled={saving}
              >
                Закрыть
              </button>
              <button
                type="submit"
                className="admin-btn admin-btn--primary"
                disabled={saving || !valid}
              >
                {saving && <Loader2 size={14} className="animate-spin" />}{" "}
                {mode === "edit" ? "Сохранить" : "Добавить"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   МОДАЛКА: ПЕРЕВОЗКА (с редактором остановок)
   ═══════════════════════════════════════════════════════ */

interface TransportFormPayload {
  date: string;
  startTime: string | null;
  driverName: string | null;
  driverPhone: string | null;
  vehicle: string | null;
  note: string | null;
  items: WpTransportItem[];
}

function TransportModal({
  mode,
  item,
  counterparties,
  saving,
  error,
  onClose,
  onSubmit,
}: {
  mode: "create" | "edit";
  item: WpTransport | null;
  counterparties: WpCounterparty[];
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (form: TransportFormPayload) => void;
}) {
  // Модалка рендерится inline — блокируем скролл фона (iOS-safe).
  useBodyLock(true);
  const suppliers = counterparties.filter((c) => c.roles.includes("supplier"));
  const [form, setForm] = useState({
    date: item?.date || todayStr(),
    startTime: item?.startTime || "",
    driverName: item?.driverName || "",
    driverPhone: item?.driverPhone || "",
    vehicle: item?.vehicle || "",
    note: item?.note || "",
    items: (item?.items || []) as WpTransportItem[],
  });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function setStop(idx: number, patch: Partial<WpTransportItem>) {
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    }));
  }

  function addStop() {
    setForm((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        {
          id: `stop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
          counterpartyId: null,
          counterpartyName: "",
          address: "",
          approxTime: "",
          wastepaperType: "cardboard",
          plannedKg: 0,
          actualKg: null,
          note: "",
          status: "pending",
          intakeId: null,
        },
      ],
    }));
  }

  function removeStop(idx: number) {
    setForm((prev) => ({ ...prev, items: prev.items.filter((_, i) => i !== idx) }));
  }

  const valid =
    form.date !== "" &&
    form.items.every((it) => it.counterpartyName.trim() !== "" || it.address.trim() !== "");

  return (
    <div className="admin-modal-overlay" onClick={() => !saving && onClose()}>
      <div
        className="admin-modal"
        style={{ maxWidth: "46rem" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="admin-modal__head">
          <h3 className="admin-modal__title">
            {mode === "edit" ? `Перевозка ТМ-${item?.number}` : "Новая перевозка за макулатурой"}
          </h3>
          <button
            type="button"
            className="admin-modal__close"
            onClick={onClose}
            disabled={saving}
            aria-label="Закрыть"
          >
            <X size={16} />
          </button>
        </div>
        <p className="admin-modal__desc">
          Рейс за макулатурой: дата, водитель и остановки с примерным временем.
          Потом статусы точек меняются прямо в карточке перевозки.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            onSubmit({
              date: form.date,
              startTime: form.startTime.trim() || null,
              driverName: form.driverName.trim() || null,
              driverPhone: form.driverPhone.trim() || null,
              vehicle: form.vehicle.trim() || null,
              note: form.note.trim() || null,
              items: form.items.map((it) => ({ ...it, approxTime: it.approxTime.trim() })),
            });
          }}
        >
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div className="admin-field" style={{ flex: "1 1 140px" }}>
              <label className="admin-label">Дата *</label>
              <input
                className="admin-input"
                type="date"
                value={form.date}
                onChange={(e) => set("date", e.target.value)}
                required
              />
            </div>
            <div className="admin-field" style={{ flex: "1 1 120px" }}>
              <label className="admin-label">Выезд (примерно)</label>
              <input
                className="admin-input"
                value={form.startTime}
                onChange={(e) => set("startTime", e.target.value)}
                placeholder="~10:00"
                maxLength={30}
              />
            </div>
            <div className="admin-field" style={{ flex: "1 1 170px" }}>
              <label className="admin-label">Водитель</label>
              <input
                className="admin-input"
                value={form.driverName}
                onChange={(e) => set("driverName", e.target.value)}
              />
            </div>
            <div className="admin-field" style={{ flex: "1 1 140px" }}>
              <label className="admin-label">Телефон водителя</label>
              <input
                className="admin-input"
                value={form.driverPhone}
                onChange={(e) => set("driverPhone", e.target.value)}
                placeholder="+7…"
              />
            </div>
            <div className="admin-field" style={{ flex: "1 1 170px" }}>
              <label className="admin-label">Машина</label>
              <input
                className="admin-input"
                value={form.vehicle}
                onChange={(e) => set("vehicle", e.target.value)}
                placeholder="Газель А123БВ74"
              />
            </div>
          </div>

          <div className="admin-field">
            <label className="admin-label">Заметка по рейсу</label>
            <input
              className="admin-input"
              value={form.note}
              onChange={(e) => set("note", e.target.value)}
            />
          </div>

          {/* Остановки */}
          <div className="admin-field">
            <label className="admin-label">Остановки (забор макулатуры)</label>
            {form.items.length === 0 && (
              <p className="admin-hint">Пока пусто — добавьте первую точку.</p>
            )}
            <div style={{ display: "grid", gap: 10 }}>
              {form.items.map((stop, idx) => (
                <div
                  key={stop.id}
                  className="admin-card"
                  style={{ padding: "10px 12px", borderStyle: "dashed" }}
                >
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <input
                      className="admin-input"
                      style={{ flex: "2 1 170px" }}
                      list="wp-transport-suppliers"
                      placeholder="Кто сдаёт *"
                      value={stop.counterpartyName}
                      onChange={(e) => {
                        const value = e.target.value;
                        const found = suppliers.find(
                          (c) => c.name.trim().toLowerCase() === value.trim().toLowerCase()
                        );
                        setStop(idx, {
                          counterpartyName: value,
                          counterpartyId: found ? found.id : null,
                          address: stop.address || found?.address || stop.address,
                        });
                      }}
                    />
                    <input
                      className="admin-input"
                      style={{ flex: "1 1 90px" }}
                      placeholder="~время"
                      maxLength={30}
                      value={stop.approxTime}
                      onChange={(e) => setStop(idx, { approxTime: e.target.value })}
                    />
                    <select
                      className="admin-select"
                      style={{ flex: "1 1 150px" }}
                      value={stop.wastepaperType}
                      onChange={(e) => setStop(idx, { wastepaperType: e.target.value })}
                    >
                      {WP_TYPE_OPTIONS.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <input
                      className="admin-input"
                      style={{ flex: "0 1 100px" }}
                      type="number"
                      min="0"
                      step="0.1"
                      placeholder="План, кг"
                      value={stop.plannedKg || ""}
                      onChange={(e) => setStop(idx, { plannedKg: parseNum(e.target.value) })}
                    />
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      onClick={() => removeStop(idx)}
                      title="Убрать остановку"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                    <input
                      className="admin-input"
                      style={{ flex: "2 1 200px" }}
                      placeholder="Адрес забора"
                      value={stop.address}
                      onChange={(e) => setStop(idx, { address: e.target.value })}
                    />
                    <input
                      className="admin-input"
                      style={{ flex: "1 1 160px" }}
                      placeholder="Заметка (контакт, домофон…)"
                      value={stop.note}
                      onChange={(e) => setStop(idx, { note: e.target.value })}
                    />
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="admin-btn admin-btn--ghost admin-btn--sm"
              style={{ marginTop: 8 }}
              onClick={addStop}
            >
              <Plus size={13} /> Остановка
            </button>
            <datalist id="wp-transport-suppliers">
              {suppliers.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
          </div>

          {error && (
            <p className="admin-error" style={{ marginTop: -4 }}>
              {error}
            </p>
          )}

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              onClick={onClose}
              disabled={saving}
            >
              Закрыть
            </button>
            <button
              type="submit"
              className="admin-btn admin-btn--primary"
              disabled={saving || !valid}
            >
              {saving && <Loader2 size={14} className="animate-spin" />}{" "}
              {mode === "edit" ? "Сохранить рейс" : "Создать перевозку"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
