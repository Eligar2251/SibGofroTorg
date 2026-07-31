// src/app/api/admin/client-requests/route.ts
// Ручные заявки клиентов (CRM): список и создание.
import { NextRequest, NextResponse } from "next/server";
import {
  createClientRequest,
  getClientRequests,
} from "@/lib/supabase-queries";
import { requireAdminApi } from "@/lib/auth";
import { logAdminAction } from "@/lib/activity-log";

export const dynamic = "force-dynamic";

const CONTACT_METHODS = [
  "call",
  "whatsapp",
  "telegram",
  "max",
  "email",
  "visit",
  "other",
];

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const status = request.nextUrl.searchParams.get("status") || "all";
    const items = await getClientRequests({ status, limit: 500 });
    return NextResponse.json({ items });
  } catch (error) {
    console.error("List client requests error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json();
    const customerName = String(body.customerName || "").trim();
    const subject = String(body.subject || "").trim();
    if (!customerName) {
      return NextResponse.json(
        { error: "Укажите имя клиента или название компании" },
        { status: 400 }
      );
    }
    if (!subject) {
      return NextResponse.json(
        { error: "Укажите, что нужно клиенту" },
        { status: 400 }
      );
    }
    const contactMethod = CONTACT_METHODS.includes(body.contactMethod)
      ? body.contactMethod
      : "call";
    const { id } = await createClientRequest({
      customerName,
      customerPhone: String(body.customerPhone || "").trim(),
      contactMethod,
      subject,
      comment: String(body.comment || "").trim(),
      createdBy: auth.displayName,
    });
    await logAdminAction(
      auth.displayName,
      auth.role,
      "create",
      "client-request",
      id,
      `Заявка клиента: ${customerName} — «${subject.slice(0, 80)}»`,
      { customerName, contactMethod }
    );
    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error("Create client request error:", error);
    return NextResponse.json(
      { error: "Не удалось создать заявку" },
      { status: 500 }
    );
  }
}
