// scripts/seed-promotions-supabase.ts
// Заполняет таблицу promotions в Supabase тестовыми акциями.
// Запуск: npx tsx scripts/seed-promotions-supabase.ts

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const db = createClient(SUPABASE_URL, SUPABASE_KEY);

interface PromoInsert {
  title: string;
  subtitle?: string | null;
  badge?: string | null;
  link_type: string;
  link_url?: string | null;
  sort_order: number;
  is_visible: boolean;
  icon?: string | null;
  color?: string | null;
  light?: string | null;
}

const promotions: PromoInsert[] = [
  {
    title: "Скидка 20% на гофрокоробки",
    subtitle: "При заказе от 100 шт.",
    badge: "-20%",
    link_type: "none",
    link_url: null,
    sort_order: 1,
    is_visible: true,
    icon: "percent",
    color: "#dc2626",
    light: "#fef2f2",
  },
  {
    title: "Бесплатная доставка",
    subtitle: "При заказе от 30 000 ₽",
    badge: "FREE",
    link_type: "none",
    link_url: null,
    sort_order: 2,
    is_visible: true,
    icon: "truck",
    color: "#16a34a",
    light: "#f0fdf4",
  },
  {
    title: "Индивидуальные размеры",
    subtitle: "Изготовим под ваш продукт",
    badge: null,
    link_type: "url",
    link_url: "/contacts",
    sort_order: 3,
    is_visible: true,
    icon: "ruler",
    color: "#2563eb",
    light: "#eff6ff",
  },
];

async function main() {
  console.log("Seeding promotions to Supabase...");
  for (const promo of promotions) {
    const { error } = await db.from("promotions").insert(promo);
    if (error) {
      console.error("Error:", error.message);
    } else {
      console.log(`✅ "${promo.title}"`);
    }
  }
  console.log("Done!");
}

main().catch(console.error);
