// =========================================================
// FILE: src/lib/pickup-code.ts
// Генерация короткого кода выдачи заказа.
// Код выдаётся клиенту после оформления заказа; по нему сотрудник
// на вкладке «Выдача товара» в админке находит заказ и отмечает выдачу.
// =========================================================

import { randomBytes } from "crypto";

// Алфавит без похожих символов (0/O, 1/I) для удобного ввода.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generatePickupCode(length = 6): string {
  const bytes = randomBytes(length);
  let code = "";
  for (let i = 0; i < length; i++) {
    code += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return code;
}

/** Человекочитаемый вид: «Выдача: ABC2DE». */
export function formatPickupCode(code: string | null | undefined): string {
  return code ? String(code).trim().toUpperCase() : "—";
}
