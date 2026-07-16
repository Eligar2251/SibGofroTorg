// Единая точка правды для контактных данных сайта.
// Меняется в .env.local — подхватывается везде: шапка, подвал, карта на главной.

export const SITE_ADDRESS =
  process.env.NEXT_PUBLIC_COMPANY_ADDRESS || "г. Новосибирск, ул. Ватутина, 42а к1";

export const SITE_PHONE =
  process.env.NEXT_PUBLIC_COMPANY_PHONE || "+7 (383) 291-81-46";

export const SITE_PHONE_HREF = `tel:${SITE_PHONE.replace(/[^\d+]/g, "")}`;

export const SITE_HOURS_WEEKDAY =
  process.env.NEXT_PUBLIC_COMPANY_HOURS_WEEKDAY || "9:00–18:00";

export const SITE_HOURS_SATURDAY =
  process.env.NEXT_PUBLIC_COMPANY_HOURS_SATURDAY || "10:00–15:00";

export const SITE_EMAIL =
  process.env.NEXT_PUBLIC_COMPANY_EMAIL || "info@gofrotara.online";

// Виджет Яндекс.Карт по текстовому адресу — не требует API-ключа
// и координат, сам геокодирует и ставит метку.
export const SITE_MAP_EMBED_URL = `https://yandex.ru/map-widget/v1/?text=${encodeURIComponent(
  SITE_ADDRESS
)}&z=16&l=map`;

export const SITE_MAP_LINK = `https://yandex.ru/maps/?text=${encodeURIComponent(SITE_ADDRESS)}`;