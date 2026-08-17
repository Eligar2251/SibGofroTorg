// =========================================================
// FILE: src/app/korobki-dlya-marketplejsov/page.tsx
// Посадочная под кластер «маркетплейсы»:
// коробки для маркетплейсов (17), короб для вб 800х600х600 купить в
// новосибирске (5), производство коробок для маркетплейсов новосибирск,
// ящики для поставщиков WB / Ozon.
// =========================================================

import type { Metadata } from "next";
import Link from "next/link";
import { getProducts } from "@/lib/supabase-queries";
import { SITE_URL, SITE_NAME, buildBreadcrumbJsonLd } from "@/lib/seo";
import { JsonLd } from "@/components/seo/JsonLd";
import {
  LandingFaq,
  LandingProducts,
  LandingLinks,
  LandingCta,
} from "@/components/seo/LandingSections";
import "@/app/seo-blocks.css";

export const revalidate = 600;

const PAGE_PATH = "/korobki-dlya-marketplejsov";

export const metadata: Metadata = {
  title: "Коробки для маркетплейсов WB и Ozon — купить в Новосибирске",
  description:
    "Картонные коробки для отгрузок на Wildberries и Ozon: 600×400×400, 800×600×600 и другие размеры. 3- и 5-слойные, от 1 шт. со склада в Новосибирске. Изготовление под размер партии от 1000 м².",
  alternates: { canonical: `${SITE_URL}${PAGE_PATH}` },
  openGraph: {
    title: `Коробки для маркетплейсов WB и Ozon — ${SITE_NAME}`,
    description:
      "Купить коробки для поставок на Wildberries и Ozon в Новосибирске: 3- и 5-слойные, от 1 шт. Склад на ул. Ватутина.",
    url: `${SITE_URL}${PAGE_PATH}`,
  },
};

export default async function MarketplaceBoxesPage() {
  // Товары с маркировкой «WB/OZON» (задаётся в админке промо-лейблом
  // или в названии). Фолбэк — крупные четырёхклапанные ящики,
  // которые обычно и используют для поставок.
  const all = await getProducts({ limitCount: 2000 }).catch(() => []);
  const tagged = all
    .filter((p) => p.isVisible !== false)
    .filter((p) =>
      /wb|ozon|озон|вайлдберриз|wildberries|маркетплейс/i.test(
        `${p.name} ${p.promoLabel ?? ""} ${p.sku ?? ""}`,
      ),
    )
    .slice(0, 8);

  const fallback = all
    .filter((p) => p.isVisible !== false)
    .filter((p) => p.dimensionLength === 600 || p.dimensionLength === 800)
    .slice(0, 8);

  const products = tagged.length > 0 ? tagged : fallback;

  return (
    <>
      <JsonLd
        data={buildBreadcrumbJsonLd([
          { name: "Главная", url: SITE_URL },
          { name: "Коробки для маркетплейсов", url: `${SITE_URL}${PAGE_PATH}` },
        ])}
      />

      <section className="seo-block" aria-label="Коробки для маркетплейсов">
        <div className="seo-block__inner seo-block__inner--narrow">
          <nav aria-label="Навигация" style={{ marginBottom: 12, fontSize: 14 }}>
            <Link href="/">Главная</Link> → <span>Коробки для маркетплейсов</span>
          </nav>

          <h1 className="seo-block__title">
            Коробки для маркетплейсов WB и Ozon — <span>со склада в Новосибирске</span>
          </h1>
          <p className="seo-block__intro">
            Поставщикам Wildberries и Ozon нужны прочные коробки стандартных
            «паллетных» размеров — 600×400×400, 800×600×600 мм. {SITE_NAME} держит
            эти типоразмеры в наличии: 3- и 5-слойные, от 1 штуки. Для регулярных
            отгрузок делаем{" "}
            <Link href="/korobki-na-zakaz">коробки по вашим размерам</Link> партиями
            от 1000 м².
          </p>

          {products.length > 0 && (
            <LandingProducts
              title="Коробки для отгрузок на WB и Ozon"
              note="Размеры, кратные паллете, выдерживают штабелирование при хранении на фулфилменте."
              products={products}
            />
          )}

          <h2>Какую коробку выбрать для поставки</h2>
          <p>
            <strong>Кратность паллете.</strong> Стандартный поддон 1200×800 мм —
            без остатка укладываются короба 600×400 и 400×300. Ящик 600×400×400 мм
            (Ящик № 670) — самый популярный у селлеров WB: влезает в ячейку склада
            и не завышает габаритный объём.
          </p>
          <p>
            <strong>Прочность.</strong> Коробки проходят несколько перегрузок: приёмка,
            хранение, сборка заказа, доставка. Для товаров тяжелее 15 кг берите
            5-слойный гофрокартон; для лёгких достаточно 3-слойного.
          </p>
          <p>
            <strong>Не переупаковывайте товар зря.</strong> Если продукция уже в
            индивидуальной упаковке, для отгрузки на склад нужен один общий гофрокороб
            — это дешевле, чем вложенные коробки. Подскажем оптимальный вариант под
            вашу линейку.
          </p>

          <LandingLinks
            title="Разделы каталога для селлеров"
            links={[
              { href: "/catalog/gofroyaschiki-chetyrehklapannye", label: "Четырёхклапанные ящики" },
              { href: "/catalog/upakovochnye-materialy", label: "Скотч, стрейч, плёнка" },
              { href: "/korobki-na-zakaz", label: "Коробки по своим размерам" },
              { href: "/korobki-dlya-pereezda", label: "Коробки для переезда" },
            ]}
          />

          <LandingFaq
            title="Частые вопросы селлеров"
            items={[
              {
                q: "Какая коробка нужна для отгрузки на Wildberries?",
                a: "Самый ходовой размер — 600×400×400 мм: кратен паллете, вмещает типовую партию одного SKU. Для объёмных грузов берите 800×600×600. Проверьте актуальные требования к таре в личном кабинете WB — лимиты по габаритам и весу периодически меняются.",
              },
              {
                q: "Сколько слоёв картона выбрать для Ozon/WB?",
                a: "3-слойный — для товаров до ~15 кг, 5-слойный — для тяжелее. На фулфилменте коробки штабелируют в несколько ярусов, поэтому для тяжёлых грузов 5-слойный обязателен: дно 3-слойной коробки может пробиться при перегрузке.",
              },
              {
                q: "Можно ли купить коробки для маркетплейсов от 1 штуки?",
                a: "Да, минимальный заказ на складе — 1 шт. Оптовые цены начинаются от 50 шт., для регулярных поставок зафиксируем цену по договору.",
              },
              {
                q: "Изготавливаете коробки под размер моего товара?",
                a: `Да, производство коробок по индивидуальным размерам — от 1000 м² (например, 1000 коробок 400×300×300). Сроки и расчёт — по телефону ${"+7 (383) 291-08-20"} или через форму на сайте.`,
              },
            ]}
          />

          <LandingCta text="Подберём тару под вашу номенклатуру и фулфилмент" />
        </div>
      </section>
    </>
  );
}
