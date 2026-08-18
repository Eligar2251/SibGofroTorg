// =========================================================
// FILE: src/app/seo-preview/page.tsx
// ВРЕМЕННЫЙ предпросмотр нового SEO-блока главной (без БД):
// показывает HomeSeoSection с демо-категориями, чтобы оценить
// дизайн локально/на превью. В production маршрут не отдаётся.
// =========================================================

import { notFound } from "next/navigation";
import { HomeSeoSection } from "@/components/seo/HomeSeoSection";
import "./seo-preview.css";

export const metadata = {
  title: "Предпросмотр SEO-блока главной",
};

export const dynamic = "force-dynamic";

const DEMO_CATEGORIES = [
  { name: "Гофрокороба", slug: "gofrokoroba", icon: "box" },
  { name: "Овощные ящики", slug: "ovoshchnye-yashchiki", icon: "package" },
  { name: "Кондитерские лотки", slug: "konditerskie-lotki", icon: "layers" },
  { name: "Пицца-коробки", slug: "picca-korobki", icon: "gift" },
  { name: "Миникороба", slug: "minikoroba", icon: "archive" },
  { name: "Скотч и плёнка", slug: "skotch-i-plenka", icon: "recycle" },
];

export default function SeoPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <div className="seo-preview">
      <div className="seo-preview__note">
        Предпросмотр нового блока «Гофротара и картонные коробки» с главной —
        демо-данные, без подключения к базе.
      </div>
      <HomeSeoSection categories={DEMO_CATEGORIES} />
    </div>
  );
}
