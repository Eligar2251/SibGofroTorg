// =========================================================
// FILE: src/lib/consent-log.ts — фиксация факта согласия (152-ФЗ)

import { getAdminDb } from "@/lib/supabase";
import { clientIp } from "@/lib/rate-limit";

/**
 * Версия текста согласия. Меняйте при правках /consent и указывайте ту же
 * дату, что в самом документе — по ней потом можно доказать, с какой
 * редакцией согласился конкретный пользователь.
 */
export const CONSENT_TEXT_VERSION = "2026-10-12";

/** Путь к документу, на который ссылается чекбокс в формах. */
export const CONSENT_DOCUMENT_PATH = "/consent";

export interface ConsentEvidenceInput {
  /** Request — нужен для IP. */
  request: Request;
  /** Откуда пришло согласие: "order" | "register" | "inquiry" | "quick-order" … */
  form: string;
  /** Телефон/почта клиента — чтобы связать согласие с обращением. */
  subject?: string | null;
  /** Значения чекбоксов: согласие на обработку ПД, рассылки и т. п. */
  accepted?: Record<string, boolean>;
}

/**
 * Пишем факт согласия. Возвращает true, если запись удалась, но решение
 * вызывающего кода от этого не зависит — заявку принимаем в любом случае.
 */
export async function logConsent(input: ConsentEvidenceInput): Promise<boolean> {
  try {
    const db = getAdminDb();
    const { error } = await db.from("consent_logs").insert({
      form: input.form,
      subject: (input.subject || "").slice(0, 200) || null,
      ip: clientIp(input.request).slice(0, 64),
      user_agent: (input.request.headers.get("user-agent") || "").slice(0, 400),
      page: (input.request.headers.get("referer") || "").slice(0, 400) || null,
      text_version: CONSENT_TEXT_VERSION,
      document_path: CONSENT_DOCUMENT_PATH,
      accepted: input.accepted ?? { personal_data: true },
    });
    if (error) {
      // Таблицы ещё нет — миграция не применена; заявку это не ломает.
      console.warn("consent_logs: запись не сохранена —", error.message);
      return false;
    }
    return true;
  } catch (error) {
    console.warn(
      "consent_logs: не удалось сохранить факт согласия —",
      error instanceof Error ? error.message : error
    );
    return false;
  }
}
