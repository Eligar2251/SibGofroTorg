// =========================================================
// FILE: src/app/api/admin/migrate/route.ts
// POST /api/admin/migrate — перенос данных из Firestore в Supabase.
// Поддерживает partial migration: { collections: ["categories", "products"] }
// Добавлены задержки между операциями чтобы не превышать квоту Firestore.
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getAdminDb as getSupabase } from "@/lib/supabase";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

export const runtime = "nodejs";
export const maxDuration = 300;

function getFirebaseDb() {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL и FIREBASE_PRIVATE_KEY обязательны для миграции");
  }
  const app = getApps().length > 0 ? getApps()[0]! : initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
    projectId,
  });
  return getFirestore(app);
}

function ts(raw: any): string | null {
  if (!raw) return null;
  if (typeof raw.toDate === "function") return raw.toDate().toISOString();
  if (raw._seconds != null) return new Date(raw._seconds * 1000).toISOString();
  if (raw.seconds != null) return new Date(raw.seconds * 1000).toISOString();
  if (typeof raw === "string") return raw;
  return null;
}

/** Задержка между операциями чтения Firestore */
function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Чтение коллекции с retry при quota exceeded */
async function readCollection(fireDb: any, collectionName: string, retries = 3): Promise<any[]> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const snap = await fireDb.collection(collectionName).get();
      return snap.docs;
    } catch (err: any) {
      if (err.code === 8 && attempt < retries - 1) {
        // RESOURCE_EXHAUSTED — ждём и повторяем
        const waitMs = (attempt + 1) * 5000;
        console.log(`[migrate] Quota exceeded on ${collectionName}, retry ${attempt + 1}/${retries} after ${waitMs}ms`);
        await delay(waitMs);
      } else {
        throw err;
      }
    }
  }
  return [];
}

/** Upssert одного документа в Supabase с retry */
async function upsertDoc(supaDb: any, table: string, data: any, retries = 2): Promise<string | null> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const { data: result, error } = await supaDb.from(table).upsert(data, { onConflict: "id" }).select("id").single();
      if (error) {
        if (attempt < retries - 1) { await delay(1000); continue; }
        throw error;
      }
      return result.id;
    } catch (err: any) {
      if (attempt < retries - 1) { await delay(1000); }
      else throw err;
    }
  }
  return null;
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json().catch(() => ({}));
    const onlyCollections = (body.collections as string[] | undefined) || null;
    const should = (name: string) => !onlyCollections || onlyCollections.includes(name);

    const fireDb = getFirebaseDb();
    const supaDb = getSupabase();
    const results: Record<string, number> = {};
    const errors: string[] = [];

    // ─── Categories ────────────────────────────────────────
    if (should("categories")) {
      try {
        const docs = await readCollection(fireDb, "categories");
        let count = 0;
        for (const doc of docs) {
          const d = doc.data();
          await upsertDoc(supaDb, "categories", {
            id: doc.id,
            name: d.name || "", slug: d.slug || "",
            icon: d.icon || null, description: d.description || null,
            sort_order: d.sortOrder || 0, is_visible: d.isVisible ?? true,
            image_url: d.imageUrl || null,
            created_at: ts(d.createdAt) || new Date().toISOString(),
          });
          count++;
        }
        results.categories = count;
        await delay(200);
      } catch (e: any) { errors.push(`categories: ${e.message}`); }
    }

    // ─── Products ──────────────────────────────────────────
    if (should("products")) {
      try {
        const docs = await readCollection(fireDb, "products");
        let count = 0;
        for (const doc of docs) {
          const d = doc.data();
          await upsertDoc(supaDb, "products", {
            id: doc.id,
            name: d.name || "", slug: d.slug || "",
            category_id: d.categoryId || null, sku: d.sku || null,
            description: d.description || null, price: d.price ?? null,
            price_wholesale: d.priceWholesale ?? null,
            min_wholesale_qty: d.minWholesaleQty ?? null,
            dimension_length: d.dimensionLength ?? null,
            dimension_width: d.dimensionWidth ?? null,
            dimension_height: d.dimensionHeight ?? null,
            dimension_unit: d.dimensionUnit || "мм",
            weight: d.weight ?? null, material: d.material || null,
            pack_qty: d.packQty ?? null, volume: d.volume ?? null,
            note: d.note || null, in_stock: d.inStock ?? true,
            stock_qty: d.stockQty ?? null, stock_warn_qty: d.stockWarnQty ?? null,
            is_promo: d.isPromo ?? false, promo_label: d.promoLabel || null,
            made_to_order: d.madeToOrder ?? false,
            discount_type: d.discountType || null,
            discount_value: d.discountValue ?? null,
            discount_badge: d.discountBadge || null,
            is_visible: d.isVisible ?? true, is_featured: d.isFeatured ?? false,
            image_url: d.imageUrl || null, images: d.images || [],
            view_count: d.viewCount || 0, average_rating: d.averageRating || 0,
            total_reviews: d.totalReviews || 0,
            created_at: ts(d.createdAt) || new Date().toISOString(),
          });
          count++;
          if (count % 20 === 0) await delay(300); // пауза каждые 20 товаров
        }
        results.products = count;
        await delay(200);
      } catch (e: any) { errors.push(`products: ${e.message}`); }
    }

    // ─── Users ─────────────────────────────────────────────
    if (should("users")) {
      try {
        const docs = await readCollection(fireDb, "users");
        let count = 0;
        for (const doc of docs) {
          const d = doc.data();
          await upsertDoc(supaDb, "users", {
            id: doc.id, phone: d.phone || "", phone_digits: d.phoneDigits || "",
            password_hash: d.passwordHash || "", name: d.name || null,
            email: d.email || null, customer_type: d.customerType || null,
            company_name: d.companyName || null, inn: d.inn || null,
            kpp: d.kpp || null, ogrn: d.ogrn || null,
            legal_address: d.legalAddress || null,
            actual_address: d.actualAddress || null,
            delivery_address: d.deliveryAddress || null,
            created_at: ts(d.createdAt) || new Date().toISOString(),
          });
          count++;
        }
        results.users = count;
        await delay(200);
      } catch (e: any) { errors.push(`users: ${e.message}`); }
    }

    // ─── Admins ────────────────────────────────────────────
    if (should("admins")) {
      try {
        const docs = await readCollection(fireDb, "admins");
        let count = 0;
        for (const doc of docs) {
          const d = doc.data();
          // Admins используют username как conflict key
          const { error } = await supaDb.from("admins").upsert({
            username: d.username || "", password_hash: d.passwordHash || d.password || "",
          }, { onConflict: "username" });
          if (!error) count++;
          else errors.push(`admin ${doc.id}: ${error.message}`);
        }
        results.admins = count;
        await delay(200);
      } catch (e: any) { errors.push(`admins: ${e.message}`); }
    }

    // ─── Orders ────────────────────────────────────────────
    if (should("orders")) {
      try {
        const docs = await readCollection(fireDb, "orders");
        let count = 0;
        for (const doc of docs) {
          const d = doc.data();
          await upsertDoc(supaDb, "orders", {
            id: doc.id, type: d.type || "order",
            customer_type: d.customerType || "individual",
            customer_name: d.customerName || "",
            customer_phone: d.customerPhone || "",
            customer_phone_digits: d.customerPhoneDigits || null,
            user_id: d.userId || null, customer_email: d.customerEmail || null,
            communication_channel: d.communicationChannel || "call",
            payment_method: d.paymentMethod || null,
            items: d.items || null, total_sum: d.totalSum ?? null,
            product_info: d.productInfo || null, quantity: d.quantity ?? null,
            comment: d.comment || null, channel: d.channel || "website",
            status: d.status || "new", close_reason: d.closeReason || null,
            deal_id: d.dealId || null, deal_number: d.dealNumber ?? null,
            payment_id: d.paymentId || null,
            company_name: d.companyName || null, inn: d.inn || null,
            kpp: d.kpp || null, ogrn: d.ogrn || null,
            legal_address: d.legalAddress || null,
            actual_address: d.actualAddress || null,
            delivery_address: d.deliveryAddress || null,
            created_at: ts(d.createdAt) || new Date().toISOString(),
          });
          count++;
          if (count % 20 === 0) await delay(300);
        }
        results.orders = count;
        await delay(200);
      } catch (e: any) { errors.push(`orders: ${e.message}`); }
    }

    // ─── Settings ──────────────────────────────────────────
    if (should("settings")) {
      try {
        const doc = await fireDb.collection("settings").doc("main").get();
        if (doc.exists) {
          const d = doc.data() || {};
          let count = 0;
          for (const [key, value] of Object.entries(d)) {
            if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
              await supaDb.from("settings").upsert({ key, value: String(value) });
              count++;
            }
          }
          results.settings = count;
        }
        await delay(200);
      } catch (e: any) { errors.push(`settings: ${e.message}`); }
    }

    // ─── Promotions ────────────────────────────────────────
    if (should("promotions")) {
      try {
        const docs = await readCollection(fireDb, "promotions");
        let count = 0;
        for (const doc of docs) {
          const d = doc.data();
          await upsertDoc(supaDb, "promotions", {
            id: doc.id, title: d.title || "", subtitle: d.subtitle || null,
            badge: d.badge || null, image_url: d.imageUrl || null,
            link_type: d.linkType || "none", product_id: d.productId || null,
            link_url: d.linkUrl || null, sort_order: d.sortOrder || 0,
            is_visible: d.isVisible ?? true, icon: d.icon || null,
            color: d.color || null, light: d.light || null,
            deadline: d.deadline || null, is_popup: d.isPopup ?? false,
            popup_start_at: d.popupStartAt || null,
            popup_delay_seconds: d.popupDelaySeconds ?? null,
            popup_duration_seconds: d.popupDurationSeconds ?? null,
            created_at: ts(d.createdAt) || new Date().toISOString(),
          });
          count++;
        }
        results.promotions = count;
        await delay(200);
      } catch (e: any) { errors.push(`promotions: ${e.message}`); }
    }

    // ─── Popup Campaigns ───────────────────────────────────
    if (should("popupCampaigns")) {
      try {
        const docs = await readCollection(fireDb, "popupCampaigns");
        let count = 0;
        for (const doc of docs) {
          const d = doc.data();
          await upsertDoc(supaDb, "popup_campaigns", {
            id: doc.id, type: d.type || "banner", title: d.title || "",
            is_active: d.isActive ?? true, kicker: d.kicker || null,
            description: d.description || null, details: d.details || null,
            button_text: d.buttonText || null, button_url: d.buttonUrl || null,
            style: d.style || "info", image_url: d.imageUrl || null,
            start_at: d.startAt || null, end_at: d.endAt || null,
            delay_seconds: d.delaySeconds || 0,
            duration_seconds: d.durationSeconds || 20,
            frequency: d.frequency || "session", sort_order: d.sortOrder || 0,
            created_at: ts(d.createdAt) || new Date().toISOString(),
          });
          count++;
        }
        results.popupCampaigns = count;
        await delay(200);
      } catch (e: any) { errors.push(`popupCampaigns: ${e.message}`); }
    }

    // ─── Product Reviews ───────────────────────────────────
    if (should("productReviews")) {
      try {
        const docs = await readCollection(fireDb, "productReviews");
        let count = 0;
        for (const doc of docs) {
          const d = doc.data();
          await upsertDoc(supaDb, "product_reviews", {
            id: doc.id, product_id: d.productId || "",
            user_id: d.userId || "", user_name: d.userName || "",
            user_avatar: d.userAvatar || null, order_id: d.orderId || "",
            rating: d.rating || 0, title: d.title || null,
            text: d.text || "", pros: d.pros || null, cons: d.cons || null,
            images: d.images || [],
            is_verified_purchase: d.isVerifiedPurchase ?? false,
            helpful_count: d.helpfulCount || 0,
            is_approved: d.isApproved ?? false,
            moderation_status: d.moderationStatus || "pending",
            moderation_note: d.moderationNote || null,
            created_at: ts(d.createdAt) || new Date().toISOString(),
          });
          count++;
          if (count % 20 === 0) await delay(300);
        }
        results.productReviews = count;
        await delay(200);
      } catch (e: any) { errors.push(`productReviews: ${e.message}`); }
    }

    // ─── Product Questions ─────────────────────────────────
    if (should("productQuestions")) {
      try {
        const docs = await readCollection(fireDb, "productQuestions");
        let count = 0;
        for (const doc of docs) {
          const d = doc.data();
          await upsertDoc(supaDb, "product_questions", {
            id: doc.id, product_id: d.productId || "",
            user_id: d.userId || "", user_name: d.userName || "",
            user_avatar: d.userAvatar || null, question: d.question || "",
            answer: d.answer || null, answer_author: d.answerAuthor || null,
            answered_at: ts(d.answeredAt), is_answered: d.isAnswered ?? false,
            helpful_count: d.helpfulCount || 0,
            is_approved: d.isApproved ?? false,
            moderation_status: d.moderationStatus || "pending",
            created_at: ts(d.createdAt) || new Date().toISOString(),
          });
          count++;
        }
        results.productQuestions = count;
        await delay(200);
      } catch (e: any) { errors.push(`productQuestions: ${e.message}`); }
    }

    // ─── Wastepaper Requests ───────────────────────────────
    if (should("wastepaperRequests")) {
      try {
        const docs = await readCollection(fireDb, "wastepaper_requests");
        let count = 0;
        for (const doc of docs) {
          const d = doc.data();
          await upsertDoc(supaDb, "wastepaper_requests", {
            id: doc.id, customer_name: d.customerName || "",
            customer_phone: d.customerPhone || "",
            wastepaper_type: d.wastepaperType || null,
            weight: d.weight || 0, delivery_method: d.deliveryMethod || null,
            estimated_payout: d.estimatedPayout || 0, comment: d.comment || "",
            status: d.status || "new",
            created_at: ts(d.createdAt) || new Date().toISOString(),
          });
          count++;
        }
        results.wastepaperRequests = count;
        await delay(200);
      } catch (e: any) { errors.push(`wastepaperRequests: ${e.message}`); }
    }

    // ─── Counterparties ────────────────────────────────────
    if (should("counterparties")) {
      try {
        const docs = await readCollection(fireDb, "counterparties");
        let count = 0;
        for (const doc of docs) {
          const d = doc.data();
          await upsertDoc(supaDb, "counterparties", {
            id: doc.id, name: d.name || "",
            normalized_name: d.normalizedName || "",
            roles: d.roles || [], supplier_prices: d.supplierPrices || {},
            phone: d.phone ?? null, email: d.email ?? null,
            inn: d.inn ?? null, kpp: d.kpp ?? null, ogrn: d.ogrn ?? null,
            full_name: d.fullName ?? null, short_name: d.shortName ?? null,
            legal_address: d.legalAddress ?? null, tax_system: d.taxSystem ?? null,
            bank_account: d.bankAccount ?? null, bank_name: d.bankName ?? null,
            bik: d.bik ?? null, correspondent_account: d.correspondentAccount ?? null,
            address: d.address ?? null, contact_name: d.contactName ?? null,
            comment: d.comment ?? null,
            created_at: ts(d.createdAt) || new Date().toISOString(),
          });
          count++;
        }
        results.counterparties = count;
        await delay(200);
      } catch (e: any) { errors.push(`counterparties: ${e.message}`); }
    }

    // ─── Warehouse Receipts ────────────────────────────────
    if (should("warehouseReceipts")) {
      try {
        const docs = await readCollection(fireDb, "warehouseReceipts");
        let count = 0;
        for (const doc of docs) {
          const d = doc.data();
          await upsertDoc(supaDb, "warehouse_receipts", {
            id: doc.id, number: d.number || 0, date: d.date || "",
            supplier: d.supplier || "", counterparty_id: d.counterpartyId || null,
            status: d.status || "draft", phone: d.phone ?? null,
            email: d.email ?? null, inn: d.inn ?? null, kpp: d.kpp ?? null,
            address: d.address ?? null, contact_name: d.contactName ?? null,
            comment: d.comment ?? null, items: d.items || [],
            total: d.total || 0, bank_adjustment: d.bankAdjustment || 0,
            vat_rate: d.vatRate ?? 22, vat_amount: d.vatAmount || 0,
            linked_deal_ids: d.linkedDealIds || [],
            linked_deal_numbers: d.linkedDealNumbers || [],
            created_at: ts(d.createdAt) || new Date().toISOString(),
          });
          count++;
          if (count % 10 === 0) await delay(300);
        }
        results.warehouseReceipts = count;
        await delay(200);
      } catch (e: any) { errors.push(`warehouseReceipts: ${e.message}`); }
    }

    // ─── Customer Deals ────────────────────────────────────
    if (should("customerDeals")) {
      try {
        const docs = await readCollection(fireDb, "customerDeals");
        let count = 0;
        for (const doc of docs) {
          const d = doc.data();
          await upsertDoc(supaDb, "customer_deals", {
            id: doc.id, number: d.number || 0, date: d.date || "",
            customer_name: d.customerName || "",
            counterparty_id: d.counterpartyId || null,
            customer_phone: d.customerPhone ?? null, phone: d.phone ?? null,
            email: d.email ?? null, inn: d.inn ?? null, kpp: d.kpp ?? null,
            address: d.address ?? null, contact_name: d.contactName ?? null,
            comment: d.comment ?? null, items: d.items || [],
            total: d.total || 0, bank_adjustment: d.bankAdjustment || 0,
            vat_rate: d.vatRate ?? 22, vat_amount: d.vatAmount || 0,
            status: d.status || "new", cancel_reason: d.cancelReason ?? null,
            source_order_id: d.sourceOrderId || null,
            created_at: ts(d.createdAt) || new Date().toISOString(),
          });
          count++;
          if (count % 10 === 0) await delay(300);
        }
        results.customerDeals = count;
        await delay(200);
      } catch (e: any) { errors.push(`customerDeals: ${e.message}`); }
    }

    // ─── Bank Payments ─────────────────────────────────────
    if (should("bankPayments")) {
      try {
        const docs = await readCollection(fireDb, "bankPayments");
        let count = 0;
        for (const doc of docs) {
          const d = doc.data();
          await upsertDoc(supaDb, "bank_payments", {
            id: doc.id, number: d.number || 0, date: d.date || "",
            direction: d.direction || "incoming", type: d.type || "regular",
            counterparty: d.counterparty || "",
            counterparty_id: d.counterpartyId || null,
            deal_ids: d.dealIds || [], deal_numbers: d.dealNumbers || [],
            receipt_ids: d.receiptIds || [], receipt_numbers: d.receiptNumbers || [],
            amount: d.amount || 0, invoice_number: d.invoiceNumber ?? null,
            vat_rate: d.vatRate ?? 22, vat_amount: d.vatAmount || 0,
            is_paid: d.isPaid ?? false, paid_at: d.paidAt ?? null,
            exclude_from_balance: d.excludeFromBalance ?? false,
            comment: d.comment ?? null,
            created_at: ts(d.createdAt) || new Date().toISOString(),
          });
          count++;
          if (count % 10 === 0) await delay(300);
        }
        results.bankPayments = count;
        await delay(200);
      } catch (e: any) { errors.push(`bankPayments: ${e.message}`); }
    }

    // ─── Employees ─────────────────────────────────────────
    if (should("employees")) {
      try {
        const docs = await readCollection(fireDb, "employees");
        let count = 0;
        for (const doc of docs) {
          const d = doc.data();
          await upsertDoc(supaDb, "employees", {
            id: doc.id, name: d.name || "",
            position: d.position ?? null, phone: d.phone ?? null,
            comment: d.comment ?? null,
            created_at: ts(d.createdAt) || new Date().toISOString(),
          });
          count++;
        }
        results.employees = count;
        await delay(200);
      } catch (e: any) { errors.push(`employees: ${e.message}`); }
    }

    // ─── Salaries ──────────────────────────────────────────
    if (should("salaries")) {
      try {
        const docs = await readCollection(fireDb, "salaries");
        let count = 0;
        for (const doc of docs) {
          const d = doc.data();
          await upsertDoc(supaDb, "salaries", {
            id: doc.id, employee_id: d.employeeId ?? null,
            employee_name: d.employeeName || "", amount: d.amount || 0,
            date: d.date || "", source: d.source || "bank",
            is_paid: d.isPaid ?? false, paid_at: d.paidAt ?? null,
            comment: d.comment ?? null,
            created_at: ts(d.createdAt) || new Date().toISOString(),
          });
          count++;
        }
        results.salaries = count;
      } catch (e: any) { errors.push(`salaries: ${e.message}`); }
    }

    return NextResponse.json({
      success: true,
      results,
      errors: errors.slice(0, 50),
      totalErrors: errors.length,
    });
  } catch (error) {
    console.error("Migration error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка миграции" },
      { status: 500 }
    );
  }
}
