// =========================================================
// FILE: src/app/api/admin/migrate/route.ts
// POST /api/admin/migrate — перенос всех данных из Firestore в Supabase.
// Требует: ADMIN_SESSION_SECRET (уже есть), FIREBASE_* и SUPABASE_* env vars.
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getAdminDb as getSupabase } from "@/lib/supabase";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 min

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

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const fireDb = getFirebaseDb();
    const supaDb = getSupabase();
    const results: Record<string, number> = {};
    const errors: string[] = [];

    // ─── Categories ────────────────────────────────────────
    {
      const snap = await fireDb.collection("categories").get();
      let count = 0;
      for (const doc of snap.docs) {
        const d = doc.data();
        const { error } = await supaDb.from("categories").upsert({
          id: doc.id,
          name: d.name || "",
          slug: d.slug || "",
          icon: d.icon || null,
          description: d.description || null,
          sort_order: d.sortOrder || 0,
          is_visible: d.isVisible ?? true,
          image_url: d.imageUrl || null,
          created_at: ts(d.createdAt) || new Date().toISOString(),
        }, { onConflict: "id" });
        if (error) errors.push(`category ${doc.id}: ${error.message}`);
        else count++;
      }
      results.categories = count;
    }

    // ─── Products ──────────────────────────────────────────
    {
      const snap = await fireDb.collection("products").get();
      let count = 0;
      for (const doc of snap.docs) {
        const d = doc.data();
        const { error } = await supaDb.from("products").upsert({
          id: doc.id,
          name: d.name || "",
          slug: d.slug || "",
          category_id: d.categoryId || null,
          sku: d.sku || null,
          description: d.description || null,
          price: d.price ?? null,
          price_wholesale: d.priceWholesale ?? null,
          min_wholesale_qty: d.minWholesaleQty ?? null,
          dimension_length: d.dimensionLength ?? null,
          dimension_width: d.dimensionWidth ?? null,
          dimension_height: d.dimensionHeight ?? null,
          dimension_unit: d.dimensionUnit || "мм",
          weight: d.weight ?? null,
          material: d.material || null,
          pack_qty: d.packQty ?? null,
          volume: d.volume ?? null,
          note: d.note || null,
          in_stock: d.inStock ?? true,
          stock_qty: d.stockQty ?? null,
          stock_warn_qty: d.stockWarnQty ?? null,
          is_promo: d.isPromo ?? false,
          promo_label: d.promoLabel || null,
          made_to_order: d.madeToOrder ?? false,
          discount_type: d.discountType || null,
          discount_value: d.discountValue ?? null,
          discount_badge: d.discountBadge || null,
          is_visible: d.isVisible ?? true,
          is_featured: d.isFeatured ?? false,
          image_url: d.imageUrl || null,
          images: d.images || [],
          view_count: d.viewCount || 0,
          average_rating: d.averageRating || 0,
          total_reviews: d.totalReviews || 0,
          created_at: ts(d.createdAt) || new Date().toISOString(),
        }, { onConflict: "id" });
        if (error) errors.push(`product ${doc.id}: ${error.message}`);
        else count++;
      }
      results.products = count;
    }

    // ─── Users ─────────────────────────────────────────────
    {
      const snap = await fireDb.collection("users").get();
      let count = 0;
      for (const doc of snap.docs) {
        const d = doc.data();
        const { error } = await supaDb.from("users").upsert({
          id: doc.id,
          phone: d.phone || "",
          phone_digits: d.phoneDigits || "",
          password_hash: d.passwordHash || "",
          name: d.name || null,
          email: d.email || null,
          customer_type: d.customerType || null,
          company_name: d.companyName || null,
          inn: d.inn || null,
          kpp: d.kpp || null,
          ogrn: d.ogrn || null,
          legal_address: d.legalAddress || null,
          actual_address: d.actualAddress || null,
          delivery_address: d.deliveryAddress || null,
          created_at: ts(d.createdAt) || new Date().toISOString(),
        }, { onConflict: "id" });
        if (error) errors.push(`user ${doc.id}: ${error.message}`);
        else count++;
      }
      results.users = count;
    }

    // ─── Admins ────────────────────────────────────────────
    {
      const snap = await fireDb.collection("admins").get();
      let count = 0;
      for (const doc of snap.docs) {
        const d = doc.data();
        const { error } = await supaDb.from("admins").upsert({
          username: d.username || "",
          password_hash: d.passwordHash || d.password || "",
        }, { onConflict: "username" });
        if (error) errors.push(`admin ${doc.id}: ${error.message}`);
        else count++;
      }
      results.admins = count;
    }

    // ─── Orders ────────────────────────────────────────────
    {
      const snap = await fireDb.collection("orders").get();
      let count = 0;
      for (const doc of snap.docs) {
        const d = doc.data();
        const { error } = await supaDb.from("orders").upsert({
          id: doc.id,
          type: d.type || "order",
          customer_type: d.customerType || "individual",
          customer_name: d.customerName || "",
          customer_phone: d.customerPhone || "",
          customer_phone_digits: d.customerPhoneDigits || null,
          user_id: d.userId || null,
          customer_email: d.customerEmail || null,
          communication_channel: d.communicationChannel || "call",
          payment_method: d.paymentMethod || null,
          items: d.items || null,
          total_sum: d.totalSum ?? null,
          product_info: d.productInfo || null,
          quantity: d.quantity ?? null,
          comment: d.comment || null,
          channel: d.channel || "website",
          status: d.status || "new",
          close_reason: d.closeReason || null,
          deal_id: d.dealId || null,
          deal_number: d.dealNumber ?? null,
          payment_id: d.paymentId || null,
          company_name: d.companyName || null,
          inn: d.inn || null,
          kpp: d.kpp || null,
          ogrn: d.ogrn || null,
          legal_address: d.legalAddress || null,
          actual_address: d.actualAddress || null,
          delivery_address: d.deliveryAddress || null,
          created_at: ts(d.createdAt) || new Date().toISOString(),
        }, { onConflict: "id" });
        if (error) errors.push(`order ${doc.id}: ${error.message}`);
        else count++;
      }
      results.orders = count;
    }

    // ─── Settings ──────────────────────────────────────────
    {
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
    }

    // ─── Promotions ────────────────────────────────────────
    {
      const snap = await fireDb.collection("promotions").get();
      let count = 0;
      for (const doc of snap.docs) {
        const d = doc.data();
        const { error } = await supaDb.from("promotions").upsert({
          id: doc.id,
          title: d.title || "",
          subtitle: d.subtitle || null,
          badge: d.badge || null,
          image_url: d.imageUrl || null,
          link_type: d.linkType || "none",
          product_id: d.productId || null,
          link_url: d.linkUrl || null,
          sort_order: d.sortOrder || 0,
          is_visible: d.isVisible ?? true,
          icon: d.icon || null,
          color: d.color || null,
          light: d.light || null,
          deadline: d.deadline || null,
          is_popup: d.isPopup ?? false,
          popup_start_at: d.popupStartAt || null,
          popup_delay_seconds: d.popupDelaySeconds ?? null,
          popup_duration_seconds: d.popupDurationSeconds ?? null,
          created_at: ts(d.createdAt) || new Date().toISOString(),
        }, { onConflict: "id" });
        if (error) errors.push(`promotion ${doc.id}: ${error.message}`);
        else count++;
      }
      results.promotions = count;
    }

    // ─── Popup Campaigns ───────────────────────────────────
    {
      const snap = await fireDb.collection("popupCampaigns").get();
      let count = 0;
      for (const doc of snap.docs) {
        const d = doc.data();
        const { error } = await supaDb.from("popup_campaigns").upsert({
          id: doc.id,
          type: d.type || "banner",
          title: d.title || "",
          is_active: d.isActive ?? true,
          kicker: d.kicker || null,
          description: d.description || null,
          details: d.details || null,
          button_text: d.buttonText || null,
          button_url: d.buttonUrl || null,
          style: d.style || "info",
          image_url: d.imageUrl || null,
          start_at: d.startAt || null,
          end_at: d.endAt || null,
          delay_seconds: d.delaySeconds || 0,
          duration_seconds: d.durationSeconds || 20,
          frequency: d.frequency || "session",
          sort_order: d.sortOrder || 0,
          created_at: ts(d.createdAt) || new Date().toISOString(),
        }, { onConflict: "id" });
        if (error) errors.push(`popup ${doc.id}: ${error.message}`);
        else count++;
      }
      results.popupCampaigns = count;
    }

    // ─── Product Reviews ───────────────────────────────────
    {
      const snap = await fireDb.collection("productReviews").get();
      let count = 0;
      for (const doc of snap.docs) {
        const d = doc.data();
        const { error } = await supaDb.from("product_reviews").upsert({
          id: doc.id,
          product_id: d.productId || "",
          user_id: d.userId || "",
          user_name: d.userName || "",
          user_avatar: d.userAvatar || null,
          order_id: d.orderId || "",
          rating: d.rating || 0,
          title: d.title || null,
          text: d.text || "",
          pros: d.pros || null,
          cons: d.cons || null,
          images: d.images || [],
          is_verified_purchase: d.isVerifiedPurchase ?? false,
          helpful_count: d.helpfulCount || 0,
          is_approved: d.isApproved ?? false,
          moderation_status: d.moderationStatus || "pending",
          moderation_note: d.moderationNote || null,
          created_at: ts(d.createdAt) || new Date().toISOString(),
        }, { onConflict: "id" });
        if (error) errors.push(`review ${doc.id}: ${error.message}`);
        else count++;
      }
      results.productReviews = count;
    }

    // ─── Product Questions ─────────────────────────────────
    {
      const snap = await fireDb.collection("productQuestions").get();
      let count = 0;
      for (const doc of snap.docs) {
        const d = doc.data();
        const { error } = await supaDb.from("product_questions").upsert({
          id: doc.id,
          product_id: d.productId || "",
          user_id: d.userId || "",
          user_name: d.userName || "",
          user_avatar: d.userAvatar || null,
          question: d.question || "",
          answer: d.answer || null,
          answer_author: d.answerAuthor || null,
          answered_at: ts(d.answeredAt),
          is_answered: d.isAnswered ?? false,
          helpful_count: d.helpfulCount || 0,
          is_approved: d.isApproved ?? false,
          moderation_status: d.moderationStatus || "pending",
          created_at: ts(d.createdAt) || new Date().toISOString(),
        }, { onConflict: "id" });
        if (error) errors.push(`question ${doc.id}: ${error.message}`);
        else count++;
      }
      results.productQuestions = count;
    }

    // ─── Wastepaper Requests ───────────────────────────────
    {
      const snap = await fireDb.collection("wastepaper_requests").get();
      let count = 0;
      for (const doc of snap.docs) {
        const d = doc.data();
        const { error } = await supaDb.from("wastepaper_requests").upsert({
          id: doc.id,
          customer_name: d.customerName || "",
          customer_phone: d.customerPhone || "",
          wastepaper_type: d.wastepaperType || null,
          weight: d.weight || 0,
          delivery_method: d.deliveryMethod || null,
          estimated_payout: d.estimatedPayout || 0,
          comment: d.comment || "",
          status: d.status || "new",
          created_at: ts(d.createdAt) || new Date().toISOString(),
        }, { onConflict: "id" });
        if (error) errors.push(`wastepaper ${doc.id}: ${error.message}`);
        else count++;
      }
      results.wastepaperRequests = count;
    }

    // ─── Counterparties ────────────────────────────────────
    {
      const snap = await fireDb.collection("counterparties").get();
      let count = 0;
      for (const doc of snap.docs) {
        const d = doc.data();
        const { error } = await supaDb.from("counterparties").upsert({
          id: doc.id,
          name: d.name || "",
          normalized_name: d.normalizedName || "",
          roles: d.roles || [],
          supplier_prices: d.supplierPrices || {},
          phone: d.phone ?? null,
          email: d.email ?? null,
          inn: d.inn ?? null,
          kpp: d.kpp ?? null,
          ogrn: d.ogrn ?? null,
          full_name: d.fullName ?? null,
          short_name: d.shortName ?? null,
          legal_address: d.legalAddress ?? null,
          tax_system: d.taxSystem ?? null,
          bank_account: d.bankAccount ?? null,
          bank_name: d.bankName ?? null,
          bik: d.bik ?? null,
          correspondent_account: d.correspondentAccount ?? null,
          address: d.address ?? null,
          contact_name: d.contactName ?? null,
          comment: d.comment ?? null,
          created_at: ts(d.createdAt) || new Date().toISOString(),
        }, { onConflict: "id" });
        if (error) errors.push(`counterparty ${doc.id}: ${error.message}`);
        else count++;
      }
      results.counterparties = count;
    }

    // ─── Warehouse Receipts ────────────────────────────────
    {
      const snap = await fireDb.collection("warehouseReceipts").get();
      let count = 0;
      for (const doc of snap.docs) {
        const d = doc.data();
        const { error } = await supaDb.from("warehouse_receipts").upsert({
          id: doc.id,
          number: d.number || 0,
          date: d.date || "",
          supplier: d.supplier || "",
          counterparty_id: d.counterpartyId || null,
          status: d.status || "draft",
          phone: d.phone ?? null,
          email: d.email ?? null,
          inn: d.inn ?? null,
          kpp: d.kpp ?? null,
          address: d.address ?? null,
          contact_name: d.contactName ?? null,
          comment: d.comment ?? null,
          items: d.items || [],
          total: d.total || 0,
          bank_adjustment: d.bankAdjustment || 0,
          vat_rate: d.vatRate ?? 22,
          vat_amount: d.vatAmount || 0,
          linked_deal_ids: d.linkedDealIds || [],
          linked_deal_numbers: d.linkedDealNumbers || [],
          created_at: ts(d.createdAt) || new Date().toISOString(),
        }, { onConflict: "id" });
        if (error) errors.push(`receipt ${doc.id}: ${error.message}`);
        else count++;
      }
      results.warehouseReceipts = count;
    }

    // ─── Customer Deals ────────────────────────────────────
    {
      const snap = await fireDb.collection("customerDeals").get();
      let count = 0;
      for (const doc of snap.docs) {
        const d = doc.data();
        const { error } = await supaDb.from("customer_deals").upsert({
          id: doc.id,
          number: d.number || 0,
          date: d.date || "",
          customer_name: d.customerName || "",
          counterparty_id: d.counterpartyId || null,
          customer_phone: d.customerPhone ?? null,
          phone: d.phone ?? null,
          email: d.email ?? null,
          inn: d.inn ?? null,
          kpp: d.kpp ?? null,
          address: d.address ?? null,
          contact_name: d.contactName ?? null,
          comment: d.comment ?? null,
          items: d.items || [],
          total: d.total || 0,
          bank_adjustment: d.bankAdjustment || 0,
          vat_rate: d.vatRate ?? 22,
          vat_amount: d.vatAmount || 0,
          status: d.status || "new",
          cancel_reason: d.cancelReason ?? null,
          source_order_id: d.sourceOrderId || null,
          created_at: ts(d.createdAt) || new Date().toISOString(),
        }, { onConflict: "id" });
        if (error) errors.push(`deal ${doc.id}: ${error.message}`);
        else count++;
      }
      results.customerDeals = count;
    }

    // ─── Bank Payments ─────────────────────────────────────
    {
      const snap = await fireDb.collection("bankPayments").get();
      let count = 0;
      for (const doc of snap.docs) {
        const d = doc.data();
        const { error } = await supaDb.from("bank_payments").upsert({
          id: doc.id,
          number: d.number || 0,
          date: d.date || "",
          direction: d.direction || "incoming",
          type: d.type || "regular",
          counterparty: d.counterparty || "",
          counterparty_id: d.counterpartyId || null,
          deal_ids: d.dealIds || [],
          deal_numbers: d.dealNumbers || [],
          receipt_ids: d.receiptIds || [],
          receipt_numbers: d.receiptNumbers || [],
          amount: d.amount || 0,
          invoice_number: d.invoiceNumber ?? null,
          vat_rate: d.vatRate ?? 22,
          vat_amount: d.vatAmount || 0,
          is_paid: d.isPaid ?? false,
          paid_at: d.paidAt ?? null,
          exclude_from_balance: d.excludeFromBalance ?? false,
          comment: d.comment ?? null,
          created_at: ts(d.createdAt) || new Date().toISOString(),
        }, { onConflict: "id" });
        if (error) errors.push(`payment ${doc.id}: ${error.message}`);
        else count++;
      }
      results.bankPayments = count;
    }

    // ─── Employees ─────────────────────────────────────────
    {
      const snap = await fireDb.collection("employees").get();
      let count = 0;
      for (const doc of snap.docs) {
        const d = doc.data();
        const { error } = await supaDb.from("employees").upsert({
          id: doc.id,
          name: d.name || "",
          position: d.position ?? null,
          phone: d.phone ?? null,
          comment: d.comment ?? null,
          created_at: ts(d.createdAt) || new Date().toISOString(),
        }, { onConflict: "id" });
        if (error) errors.push(`employee ${doc.id}: ${error.message}`);
        else count++;
      }
      results.employees = count;
    }

    // ─── Salaries ──────────────────────────────────────────
    {
      const snap = await fireDb.collection("salaries").get();
      let count = 0;
      for (const doc of snap.docs) {
        const d = doc.data();
        const { error } = await supaDb.from("salaries").upsert({
          id: doc.id,
          employee_id: d.employeeId ?? null,
          employee_name: d.employeeName || "",
          amount: d.amount || 0,
          date: d.date || "",
          source: d.source || "bank",
          is_paid: d.isPaid ?? false,
          paid_at: d.paidAt ?? null,
          comment: d.comment ?? null,
          created_at: ts(d.createdAt) || new Date().toISOString(),
        }, { onConflict: "id" });
        if (error) errors.push(`salary ${doc.id}: ${error.message}`);
        else count++;
      }
      results.salaries = count;
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
