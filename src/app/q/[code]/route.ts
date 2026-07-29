// =========================================================
// FILE: src/app/q/[code]/route.ts
// Короткий публичный вход по QR-коду с этикетки: /q/{slug}.
//
// Зачем отдельный роут, а не прямой /{adminPath}/scan/{slug}:
//  1) ДЛИНА. adminPath секретный и может быть длинным
//     ("sgt-panel-7x2k"). Каждый лишний символ в payload раздувает
//     версию QR (v4 → v5 → v6): модулей больше, а физический размер
//     этикетки тот же (26 мм) → модуль становится меньше 0.5 мм и
//     дешёвые/старые камеры перестают его читать. Короткий /q/
//     держит payload в v3 (29 модулей) — модуль ≈0.7 мм.
//  2) БЕЗОПАСНОСТЬ. Секретный путь админки больше не печатается
//     на каждой этикетке, которая уезжает клиенту вместе с товаром.
//
// Роут ничего не отдаёт сам — только 307-редирект внутрь админки.
// Авторизацию проверяет proxy.ts на /{adminPath}/scan/*: если
// сотрудник не залогинен, его перекинет на форму входа.
// =========================================================

import { NextRequest, NextResponse } from "next/server";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;

  // Slug в QR закодирован в верхнем регистре (alphanumeric-режим
  // QR не знает строчных букв). Некоторые сканеры/почтовые клиенты
  // «нормализуют» URL в нижний регистр — приводим обратно, чтобы
  // поиск по qrSlug совпал в любом случае.
  const normalized = decodeURIComponent(code || "")
    .trim()
    .toUpperCase();

  if (!normalized) {
    return NextResponse.redirect(new URL(`/${ADMIN_PATH}/scan`, req.url), 307);
  }

  return NextResponse.redirect(
    new URL(
      `/${ADMIN_PATH}/scan/${encodeURIComponent(normalized)}`,
      req.url
    ),
    307
  );
}
