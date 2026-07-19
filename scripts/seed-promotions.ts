// scripts/seed-promotions.ts
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// Initialize Firebase Admin
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

const db = getFirestore();

const defaultPromotions = [
  {
    tag: "Оптовая скидка",
    title: "−15% при заказе\nот 500 коробов",
    desc: "На все стандартные размеры Т-23",
    color: "var(--kraft)",
    light: "var(--kraft-light)",
    icon: "📦",
    deadline: null,
    badge: "Оптовая скидка",
    subtitle: "На все стандартные размеры Т-23",
    sortOrder: 0,
    isVisible: true,
    linkType: "none",
    productId: null,
    linkUrl: null,
    imageUrl: null,
    createdAt: FieldValue.serverTimestamp(),
  },
  {
    tag: "Доставка",
    title: "Бесплатная доставка\nот 30 000 ₽",
    desc: "По Новосибирску и области",
    color: "var(--eco)",
    light: "var(--eco-light)",
    icon: "🚚",
    deadline: null,
    badge: "Доставка",
    subtitle: "По Новосибирску и области",
    sortOrder: 1,
    isVisible: true,
    linkType: "none",
    productId: null,
    linkUrl: null,
    imageUrl: null,
    createdAt: FieldValue.serverTimestamp(),
  },
  {
    tag: "Макулатура → Скидка",
    title: "Сдай картон —\nполучи −7% на тару",
    desc: "Принимаем от 50 кг, оплата сразу",
    color: "#2D6A4F",
    light: "#D8EFE3",
    icon: "♻️",
    deadline: null,
    badge: "Макулатура → Скидка",
    subtitle: "Принимаем от 50 кг, оплата сразу",
    sortOrder: 2,
    isVisible: true,
    linkType: "url",
    productId: null,
    linkUrl: "/wastepaper",
    imageUrl: null,
    createdAt: FieldValue.serverTimestamp(),
  },
  {
    tag: "Новинки",
    title: "Самосборные\nкоробки со скидкой",
    desc: "Быстрая сборка без скотча",
    color: "#7C3AED",
    light: "#EDE9FE",
    icon: "⚡",
    deadline: "31 июля",
    badge: "Новинки",
    subtitle: "Быстрая сборка без скотча",
    sortOrder: 3,
    isVisible: true,
    linkType: "none",
    productId: null,
    linkUrl: null,
    imageUrl: null,
    createdAt: FieldValue.serverTimestamp(),
  },
];

async function seedPromotions() {
  console.log("Seeding default promotions...");
  
  for (const promo of defaultPromotions) {
    const docRef = await db.collection("promotions").add(promo);
    console.log(`Created promotion: ${promo.title} (ID: ${docRef.id})`);
  }
  
  console.log("Done!");
  process.exit(0);
}

seedPromotions().catch((err) => {
  console.error("Error seeding promotions:", err);
  process.exit(1);
});