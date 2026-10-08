// =========================================================
// FILE: src/lib/cp1251.ts
// Простой энкодер строки UTF-8 → Windows-1251 (CP1251).
// Только символы, которые реально встречаются в платёжках
// (кириллица А-Я, а-я, ё, Ё, а также тире/кавычки-ёлочки и базовая
// латиница + цифры + знаки препинания). Неизвестные символы заменяются
// на '?'. Не требует внешних пакетов.
// =========================================================

const UNKNOWN = 0x3f; // '?'

// Кириллица А-Я (U+0410…U+042F) → 0xC0…0xDF
// кириллица а-я (U+0430…U+044F) → 0xE0…0xFF
// Ё U+0401 → 0xA8; ё U+0451 → 0xB8
// Дополнительные буквы: Є U+0404→0xAА, І U+0406→0xB2, Ї U+0407→0xAF,
// є U+0454→0xAA, і U+0456→0xB3, ї U+0457→0xBF (не все нужны, но добавим для полноты).
// « U+00AB → 0xAB, » U+00BB → 0xBB, — (em-dash) U+2014 → 0x97,
// № U+2116 → 0xB9.

export function encodeWindows1251(input: string): Buffer {
  const buf = Buffer.alloc(input.length * 2); // запас
  let pos = 0;

  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);

    if (code < 0x80) {
      // ASCII — без изменений
      buf[pos++] = code;
      continue;
    }

    if (code === 0x0401) { buf[pos++] = 0xa8; continue; } // Ё
    if (code === 0x0451) { buf[pos++] = 0xb8; continue; } // ё
    if (code === 0x0404) { buf[pos++] = 0xaa; continue; } // Є
    if (code === 0x0406) { buf[pos++] = 0xb2; continue; } // І
    if (code === 0x0407) { buf[pos++] = 0xaf; continue; } // Ї
    if (code === 0x0454) { buf[pos++] = 0xab; continue; } // є
    if (code === 0x0456) { buf[pos++] = 0xb3; continue; } // і
    if (code === 0x0457) { buf[pos++] = 0xbf; continue; } // ї
    if (code === 0x00ab) { buf[pos++] = 0xab; continue; } // «
    if (code === 0x00bb) { buf[pos++] = 0xbb; continue; } // »
    if (code === 0x2013 || code === 0x2014) { buf[pos++] = 0x97; continue; } // –/— → —
    if (code === 0x2018 || code === 0x2019) { buf[pos++] = 0x92; continue; } // '
    if (code === 0x201c || code === 0x201d) { buf[pos++] = 0x93; continue; } // "
    if (code === 0x201a) { buf[pos++] = 0x82; continue; } // ‚
    if (code === 0x201e) { buf[pos++] = 0x84; continue; } // „
    if (code === 0x2026) { buf[pos++] = 0x85; continue; } // …
    if (code === 0x2022) { buf[pos++] = 0x95; continue; } // •
    if (code === 0x2030) { buf[pos++] = 0x89; continue; } // ‰
    if (code === 0x2039) { buf[pos++] = 0x8b; continue; } // ‹
    if (code === 0x203a) { buf[pos++] = 0x9b; continue; } // ›
    if (code === 0x20ac) { buf[pos++] = 0x88; continue; } // €
    if (code === 0x2116) { buf[pos++] = 0xb9; continue; } // №
    if (code === 0x2122) { buf[pos++] = 0x99; continue; } // ™
    if (code === 0x00a0) { buf[pos++] = 0xa0; continue; } // NBSP
    if (code === 0x00a4) { buf[pos++] = 0xa4; continue; } // ¤
    if (code === 0x00a6) { buf[pos++] = 0xa6; continue; } // ¦
    if (code === 0x00a7) { buf[pos++] = 0xa7; continue; } // §
    if (code === 0x00a9) { buf[pos++] = 0xa9; continue; } // ©
    if (code === 0x00ae) { buf[pos++] = 0xae; continue; } // ®
    if (code === 0x00b0) { buf[pos++] = 0xb0; continue; } // °
    if (code === 0x00b1) { buf[pos++] = 0xb1; continue; } // ±
    if (code === 0x00b5) { buf[pos++] = 0xb5; continue; } // µ
    if (code === 0x00b6) { buf[pos++] = 0xb6; continue; } // ¶
    if (code === 0x00b7) { buf[pos++] = 0xb7; continue; } // ·

    // А-Я U+0410-U+042F → 0xC0-0xDF
    if (code >= 0x0410 && code <= 0x042f) {
      buf[pos++] = 0xc0 + (code - 0x0410);
      continue;
    }
    // а-я U+0430-U+044F → 0xE0-0xFF
    if (code >= 0x0430 && code <= 0x044f) {
      buf[pos++] = 0xe0 + (code - 0x0430);
      continue;
    }

    // Частные диакритики и дополнения из CP1251 (0x80–0x8f, 0x90–0x9f):
    // Не поддерживаем — заменяем на '?' для безопасности.
    buf[pos++] = UNKNOWN;
  }

  return buf.subarray(0, pos);
}
