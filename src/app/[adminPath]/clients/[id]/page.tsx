// =========================================================
// FILE: src/app/[adminPath]/clients/[id]/page.tsx
// Карточка клиента: контакты, реквизиты и ВСЕ его заявки
// с управлением статусом и удалением.
//
// Заявки собираются двумя способами:
//   • по user_id — оформленные из личного кабинета;
//   • по номеру телефона — оформленные без входа (гость с тем же
//     номером). Их видно с пометкой «без входа», иначе история
//     клиента выглядела бы неполной.
// =========================================================

import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Building2, Mail, MapPin, Phone, User } from "lucide-react";
import { getAdminDb } from "@/lib/supabase";
import {
  ClientOrdersManager,
  type ClientOrderRow,
  type ClientWasteRow,
} from "@/components/admin/ClientOrdersManager";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";
export const dynamic = "force-dynamic";

function toIso(raw: unknown): string | null {
  if (!raw) return null;
  if (typeof raw === "string") return raw;
  if (raw instanceof Date) return raw.toISOString();
  return null;
}

/** Только цифры, 8… → 7… — как в user-auth.normalizePhone. */
function digitsOf(raw: unknown): string {
  let digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 10) digits = `7${digits}`;
  if (digits.startsWith("8") && digits.length === 11) digits = `7${digits.slice(1)}`;
  return digits;
}

const money = (value: number) =>
  value.toLocaleString("ru-RU", { maximumFractionDigits: 2 });

export default async function AdminClientCardPage({
  params,
}: {
  params: Promise<{ adminPath: string; id: string }>;
}) {
  const { adminPath, id } = await params;
  if (adminPath !== ADMIN_PATH) notFound();

  const db = getAdminDb();
  const { data: user } = await db
    .from("users")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!user) notFound();

  const phoneDigits = user.phone_digits || digitsOf(user.phone);

  // Заявки: свои по user_id + гостевые с тем же телефоном.
  const filters = [`user_id.eq.${id}`];
  if (phoneDigits && /^\d{10,15}$/.test(phoneDigits)) {
    filters.push(`customer_phone_digits.eq.${phoneDigits}`);
  }
  const { data: orderRows } = await db
    .from("orders")
    .select("*")
    .or(filters.join(","))
    .order("created_at", { ascending: false })
    .limit(300);

  const orders: ClientOrderRow[] = (orderRows || []).map((row: any) => ({
    id: String(row.id),
    type: row.type === "order" ? "order" : "inquiry",
    status: row.status || "new",
    customerName: row.customer_name ?? null,
    customerPhone: row.customer_phone ?? null,
    customerEmail: row.customer_email ?? null,
    totalSum: row.total_sum ?? null,
    productInfo: row.product_info ?? null,
    quantity: row.quantity ?? null,
    comment: row.comment ?? null,
    deliveryAddress: row.delivery_address ?? null,
    paymentMethod: row.payment_method ?? null,
    items: Array.isArray(row.items) ? row.items : null,
    dealId: row.deal_id ?? null,
    dealNumber: row.deal_number ?? null,
    createdAt: toIso(row.created_at),
    guest: !row.user_id,
  }));

  // Макулатура: отдельная таблица без user_id — сопоставляем по телефону.
  let wastepaper: ClientWasteRow[] = [];
  if (phoneDigits) {
    const { data: wpRows } = await db
      .from("wastepaper_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(300);
    wastepaper = (wpRows || [])
      .filter((row: any) => digitsOf(row.customer_phone) === phoneDigits)
      .map((row: any) => ({
        id: String(row.id),
        status: row.status || "new",
        wastepaperType: row.wastepaper_type ?? null,
        weight: row.weight ?? null,
        deliveryMethod: row.delivery_method ?? null,
        estimatedPayout: row.estimated_payout ?? null,
        comment: row.comment ?? null,
        createdAt: toIso(row.created_at),
      }));
  }

  const completed = orders.filter((order) => order.status === "completed");
  const totalSpent = completed.reduce(
    (sum, order) => sum + (Number(order.totalSum) || 0),
    0
  );
  const isLegal = user.customer_type === "legal";
  const title =
    user.name || user.company_name || user.phone || user.email || "Клиент";

  return (
    <div>
      <div className="admin-page-head">
        <div>
          <Link
            href={`/${ADMIN_PATH}/clients`}
            prefetch={false}
            className="admin-btn admin-btn--ghost admin-btn--sm"
            style={{ marginBottom: 8 }}
          >
            <ArrowLeft size={13} /> Все клиенты
          </Link>
          <h1 className="admin-h1">{title}</h1>
          <p className="admin-sub">
            {isLegal ? "Юридическое лицо" : "Физическое лицо"} · регистрация{" "}
            {user.created_at
              ? new Date(user.created_at).toLocaleDateString("ru-RU")
              : "—"}
          </p>
        </div>
      </div>

      <div className="admin-stack">
        {/* Контакты и реквизиты */}
        <div className="admin-card">
          <div className="admin-card__pad">
            <div className="admin-stat-grid" style={{ margin: 0 }}>
              <div className="admin-stat">
                <div className="admin-stat__value">{orders.length}</div>
                <div className="admin-stat__label">заявок всего</div>
              </div>
              <div className="admin-stat">
                <div className="admin-stat__value">{completed.length}</div>
                <div className="admin-stat__label">выполнено</div>
              </div>
              <div className="admin-stat">
                <div className="admin-stat__value">{money(totalSpent)} ₽</div>
                <div className="admin-stat__label">на сумму</div>
              </div>
              {wastepaper.length > 0 && (
                <div className="admin-stat">
                  <div className="admin-stat__value">{wastepaper.length}</div>
                  <div className="admin-stat__label">макулатура</div>
                </div>
              )}
            </div>

            <div className="client-card__contacts">
              {user.phone && (
                <a href={`tel:${digitsOf(user.phone)}`} className="client-card__contact">
                  <Phone size={14} /> {user.phone}
                </a>
              )}
              {user.email && (
                <a href={`mailto:${user.email}`} className="client-card__contact">
                  <Mail size={14} /> {user.email}
                </a>
              )}
              {user.username && (
                <span className="client-card__contact">
                  <User size={14} /> логин: {user.username}
                </span>
              )}
              {user.company_name && (
                <span className="client-card__contact">
                  <Building2 size={14} /> {user.company_name}
                  {user.inn ? ` · ИНН ${user.inn}` : ""}
                </span>
              )}
              {(user.delivery_address || user.actual_address || user.legal_address) && (
                <span className="client-card__contact">
                  <MapPin size={14} />{" "}
                  {user.delivery_address ||
                    user.actual_address ||
                    user.legal_address}
                </span>
              )}
            </div>
          </div>
        </div>

        <ClientOrdersManager
          orders={orders}
          wastepaper={wastepaper}
          adminPath={ADMIN_PATH}
        />
      </div>
    </div>
  );
}
