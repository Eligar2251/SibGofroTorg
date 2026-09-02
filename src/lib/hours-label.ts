// =========================================================
// FILE: src/lib/hours-label.ts
// Единый хелпер отображения режима работы из настройки
// working_hours (админка «Настройки → Контакты»). Используется
// серверными страницами (главная, контакты, доставка, лендинги)
// и клиентским хуком useSiteSettings — чтобы все места сайта
// показывали одно и то же время.
//
// Форматы, которые принимает настройка:
//   «8:30–17:00»            → дополняем «Пн–Пт … · Сб, Вс — выходные»
//   «Пн–Пт 8:30–17:00»      → оставляем как есть (добавляем хвост про выходные)
//   «Пн-Пт с 8:30-17:00, СБ вс» → оставляем целиком
// Раньше распознавание «Пн–Пт» ловило только типографские тире и
// ломалось на обычном дефисе «-» — получалось «Пн–Пт Пн-Пт …».
// =========================================================

/** «пн-пт» с любым видом дефиса/тире (включая обычный '-') и пробелами */
const WEEKDAYS_RE = /пн[\s\-‐‑‒–—―]*пт/i;
/** Упоминание выходных («Сб», «Вс», «выходные») в исходной строке */
const WEEKEND_RE = /сб|вс|выходн/i;

export const DEFAULT_HOURS_WEEKDAY = "8:30–17:00";

function normalizeFallback(fallback: string | undefined | null): string {
  return String(fallback || "").trim() || DEFAULT_HOURS_WEEKDAY;
}

/** Есть ли в строке уже диапазон дней («Пн–Пт», «пн-пт» и т.п.) */
export function mentionsWeekdays(raw: string): boolean {
  return WEEKDAYS_RE.test(raw);
}

/** Полная фраза «Пн–Пт 8:30–17:00 · Сб, Вс — выходные» (шапка, футер, главная) */
export function buildHoursLabel(
  rawWorkingHours: string | undefined | null,
  weekdayFallback?: string
): string {
  const workingHours = String(rawWorkingHours ?? "").trim();
  const fallback = normalizeFallback(weekdayFallback);

  if (workingHours) {
    if (mentionsWeekdays(workingHours)) {
      return WEEKEND_RE.test(workingHours)
        ? workingHours
        : `${workingHours} · Сб, Вс — выходные`;
    }
    return `Пн–Пт ${workingHours} · Сб, Вс — выходные`;
  }
  return `Пн–Пт ${fallback} · Сб, Вс — выходные`;
}

/** Короткая фраза только про будни «Пн–Пт 8:30–17:00» (контакты, самовывоз) */
export function buildWeekdayLabel(
  rawWorkingHours: string | undefined | null,
  weekdayFallback?: string
): string {
  const workingHours = String(rawWorkingHours ?? "").trim();
  const fallback = normalizeFallback(weekdayFallback);

  if (workingHours) {
    if (mentionsWeekdays(workingHours)) return workingHours;
    return `Пн–Пт ${workingHours}`;
  }
  return `Пн–Пт ${fallback}`;
}

/** Только время буднего дня «8:30–17:00» (для вставок «в будни с … до …») */
export function extractWeekdayHours(
  rawWorkingHours: string | undefined | null,
  weekdayFallback?: string
): string {
  const workingHours = String(rawWorkingHours ?? "").trim();
  const fallback = normalizeFallback(weekdayFallback);
  if (!workingHours) return fallback;
  // Вытаскиваем первое вхождение «H:MM–H:MM» из произвольной строки
  const m = workingHours.match(
    /\d{1,2}:\d{2}\s*[\-‐‑‒–—―]\s*\d{1,2}:\d{2}/
  );
  return m ? m[0].replace(/\s+/g, "") : workingHours;
}
