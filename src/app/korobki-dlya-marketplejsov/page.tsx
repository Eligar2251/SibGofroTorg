// =========================================================
// FILE: src/app/korobki-dlya-marketplejsov/page.tsx
// =========================================================

import type { Metadata } from "next";
import Link from "next/link";
import {
  LayoutGrid,
  Layers,
  Package,
  PackageCheck,
  Factory,
  Phone,
  Clock,
  MapPin,
} from "lucide-react";
import { getProducts } from "@/lib/supabase-queries";
import { getPublicSettingsView } from "@/lib/public-settings";
import { productHasAnyTag } from "@/lib/home-tiles";
import { isProductAvailable } from "@/lib/stock-availability";
import {
  isPalletShippingBox,
  footprintRank,
  PALLET_LENGTH_MM,
  PALLET_WIDTH_MM,
} from "@/lib/pallet";
import { SITE_URL, SITE_NAME, buildBreadcrumbJsonLd } from "@/lib/seo";
import {
  SITE_ADDRESS,
  SITE_HOURS_LABEL,
} from "@/lib/site-config";
import { JsonLd } from "@/components/seo/JsonLd";
import {
  LandingFaq,
  LandingProducts,
  LandingLinks,
} from "@/components/seo/LandingSections";
import { PalletGuide } from "@/components/seo/PalletGuide";
import "@/app/seo-blocks.css";
import { localizeMediaDeep } from "@/lib/media";

export const revalidate = 600;

const PAGE_PATH = "/korobki-dlya-marketplejsov";
const PAGE_TITLE = "Коробки для маркетплейсов WB и Ozon — купить в Новосибирске";
const PAGE_DESCRIPTION =
  "Картонные коробки для отгрузок на Wildberries и Ozon: паллетные размеры 600×400×400, 800×600×600 и другие — все габариты кратны поддону 1200×800. 3- и 5-слойные, от 1 шт. со склада в Новосибирске. Изготовление под размер партии от 3000 м².";

/** Метки товаров, по которым блок «для WB и Ozon» выходит на первое место. */
const MARKETPLACE_TAGS = [
  "озон",
  "ozon",
  "вб",
  "wb",
  "wildberries",
  "вайлдберриз",
  "маркетплейс",
  "маркетплейсы",
];

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: `${SITE_URL}${PAGE_PATH}` },
  openGraph: {
    title: `Коробки для маркетплейсов WB и Ozon — ${SITE_NAME}`,
    description:
      "Купить коробки для поставок на Wildberries и Ozon в Новосибирске: паллетные размеры, 3- и 5-слойные, от 1 шт. Склад на ул. Ватутина.",
    url: `${SITE_URL}${PAGE_PATH}`,
  },
};

/** Быстрые факты под заголовком. */
const FACTS = [
  {
    icon: LayoutGrid,
    title: "Габариты кратны паллете",
    text: "100, 200, 300, 400, 600, 800, 1200 мм — слой на поддоне без остатка",
  },
  {
    icon: Layers,
    title: "3 и 5 слоёв",
    text: "до 15 кг — трёхслойный гофрокартон, тяжелее — пятислойный",
  },
  {
    icon: Package,
    title: "От 1 штуки",
    text: "склад на ул. Ватутина: самовывоз или доставка по городу",
  },
  {
    icon: Factory,
    title: "Изготовление от 3000 м²",
    text: "коробки под размер вашего товара и фулфилмент",
  },
];

/** Разбор выбора тары — три карточки вместо «простыни» текста. */
const TIPS = [
  {
    icon: LayoutGrid,
    title: "Кратность паллете",
    text: (
      <>
        Поддон {PALLET_LENGTH_MM}×{PALLET_WIDTH_MM} закрывается без остатка,
        если габариты короба — 100, 200, 300, 400, 600, 800 или 1200 мм. Короб
        600×400×400 мм (Ящик № 670) — самый популярный у селлеров WB: 4 шт. в
        слой, влезает в ячейку склада и не завышает габаритный объём. Тара 350,
        500 и 700 мм ровным слоем на поддон не ложится — остаётся полоса,
        которая «съедает» место на хранении.
      </>
    ),
  },
  {
    icon: Layers,
    title: "Прочность",
    text: (
      <>
        Коробки проходят несколько перегрузок: приёмка, хранение, сборка
        заказа, доставка. Для товаров тяжелее 15 кг берите 5-слойный
        гофрокартон, для лёгких достаточно 3-слойного.
      </>
    ),
  },
  {
    icon: PackageCheck,
    title: "Не переупаковывайте зря",
    text: (
      <>
        Если продукция уже в индивидуальной упаковке, для отгрузки на склад
        нужен один общий гофрокороб — это дешевле, чем вложенные коробки.
        Подскажем оптимальный вариант под вашу линейку и посчитаем метраж.
      </>
    ),
  },
];

export default async function MarketplaceBoxesPage() {
  const all = localizeMediaDeep(
    await getProducts({ limitCount: 2000 }).catch(() => [])
  );
  // Телефон отдела продаж — из настроек админки, не хардкодим
  const pub = await getPublicSettingsView();
  const visible = all.filter((p) => p.isVisible !== false);

  // Релевантность подборки: 0 — метка «озон/вб», 1 — упоминание в названии.
  const relevance = (p: (typeof visible)[number]): number => {
    if (productHasAnyTag(p, MARKETPLACE_TAGS)) return 0;
    if (
      /wb|ozon|озон|вайлдберриз|wildberries|маркетплейс/i.test(
        `${p.name} ${p.promoLabel ?? ""} ${p.sku ?? ""}`
      )
    ) {
      return 1;
    }
    return 2;
  };

  // В подборке — только коробки, все габариты которых кратны паллете
  // 1200×800. Затем ходовые размеры (600×400, 800×600…), потом остальные.
  const products = visible
    .filter((p) => isPalletShippingBox(p))
    .sort(
      (a, b) =>
        relevance(a) - relevance(b) ||
        Number(isProductAvailable(b)) - Number(isProductAvailable(a)) ||
        footprintRank(a.dimensionLength, a.dimensionWidth) -
          footprintRank(b.dimensionLength, b.dimensionWidth) ||
        a.name.localeCompare(b.name, "ru")
    )
    .slice(0, 8);

  const itemListLd = products.length
    ? {
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: "Коробки для маркетплейсов, кратные паллете 1200×800",
        itemListElement: products.map((p, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: p.name,
          url: `${SITE_URL}/catalog/product/${p.slug}`,
        })),
      }
    : null;

  return (
    <>
      <JsonLd
        data={buildBreadcrumbJsonLd([
          { name: "Главная", url: SITE_URL },
          { name: "Коробки для маркетплейсов", url: `${SITE_URL}${PAGE_PATH}` },
        ])}
      />
      {itemListLd ? <JsonLd data={itemListLd} /> : null}

      <section className="seo-home" aria-label="Коробки для маркетплейсов">
        <div className="seo-home__inner">
          <nav className="mk-breadcrumbs" aria-label="Навигация">
            <Link href="/">Главная</Link>
            <span aria-hidden>→</span>
            <span>Коробки для маркетплейсов</span>
          </nav>

          {/* ── Заголовок ── */}
          <header className="seo-home__head">
            <span className="seo-home__eyebrow">
              Кратны паллете {PALLET_LENGTH_MM}×{PALLET_WIDTH_MM}
            </span>
            <h1 className="seo-home__title">
              Коробки для маркетплейсов WB и Ozon —{" "}
              <span>со склада в Новосибирске</span>
            </h1>
            <p className="seo-home__intro">
              Поставщикам Wildberries и Ozon нужны прочные коробки стандартных
              «паллетных» размеров — 600×400×400, 800×600×600 мм. {SITE_NAME}{" "}
              держит эти типоразмеры в наличии: 3- и 5-слойные, от 1 штуки. Для
              регулярных отгрузок делаем{" "}
              <Link href="/proizvodstvo-korobok">коробки по вашим размерам</Link>{" "}
              партиями от 3000 м².
            </p>
          </header>

          {/* ── Быстрые факты ── */}
          <div className="seo-home__facts">
            {FACTS.map((fact) => (
              <div key={fact.title} className="seo-home__fact">
                <span className="seo-home__fact-icon" aria-hidden>
                  <fact.icon size={18} strokeWidth={2} />
                </span>
                <div className="seo-home__fact-copy">
                  <strong>{fact.title}</strong>
                  <span>{fact.text}</span>
                </div>
              </div>
            ))}
          </div>

          {/* ── Паллета: схемы + таблица ── */}
          <PalletGuide />

          {/* ── Коробки из каталога под паллетную отгрузку ── */}
          {products.length > 0 && (
            <LandingProducts
              title="Коробки под паллетную отгрузку"
              note={`В подборке — только размеры, у которых все габариты кратны паллете ${PALLET_LENGTH_MM}×${PALLET_WIDTH_MM} мм: слой на поддоне сходится без остатка. Нужен другой размер — изготовим под ваш товар.`}
              products={products}
            />
          )}

          {/* ── Как выбрать ── */}
          <h2 className="seo-home__h3 mk-subhead">
            Какую коробку выбрать для поставки
          </h2>
          <div className="mk-tips">
            {TIPS.map((tip) => (
              <article key={tip.title} className="mk-tip">
                <span className="mk-tip__icon" aria-hidden>
                  <tip.icon size={20} strokeWidth={2} />
                </span>
                <h3 className="mk-tip__title">{tip.title}</h3>
                <p className="mk-tip__text">{tip.text}</p>
              </article>
            ))}
          </div>

          {/* ── Перелинковка с каталогом ── */}
          <div className="mk-links">
            <LandingLinks
              title="Разделы каталога для селлеров"
              headingClassName="seo-home__h3"
              links={[
                {
                  href: "/catalog/gofroyaschiki-chetyrehklapannye",
                  label: "Четырёхклапанные ящики",
                },
                {
                  href: "/catalog/upakovochnye-materialy",
                  label: "Скотч, стрейч, плёнка",
                },
                { href: "/korobki-na-zakaz", label: "Коробки по своим размерам" },
                { href: "/proizvodstvo-korobok", label: "Производство коробок" },
                { href: "/korobki-dlya-pereezda", label: "Коробки для переезда" },
              ]}
            />
          </div>

          {/* ── FAQ ── */}
          <div className="mk-faq">
            <LandingFaq
              title="Частые вопросы селлеров"
              headingClassName="seo-home__h3"
              items={[
                {
                  q: "Какие размеры коробок кратны паллете 1200×800?",
                  a: "Паллетные габариты делят стороны поддона без остатка: 100, 200, 300, 400, 600, 800 и 1200 мм. Короб 600×400×400 мм ложится 4 шт. в слой (2 вдоль длинной стороны × 2 вдоль короткой), 800×600 — 2 шт., 400×300 — 8 шт., 600×200 — 8 шт. Размеры 350, 500 или 700 мм ровным слоем на поддон не встают: по краю остаётся полоса, из-за которой теряется место и на складе, и на фулфилменте.",
                },
                {
                  q: "Какая коробка нужна для отгрузки на Wildberries?",
                  a: "Самый ходовой размер — 600×400×400 мм: кратен паллете, вмещает типовую партию одного SKU и не завышает габаритный объём. Для объёмных грузов берите 800×600×600 мм. Проверьте актуальные требования к таре в личном кабинете WB — лимиты по габаритам и весу периодически меняются.",
                },
                {
                  q: "Сколько слоёв картона выбрать для Ozon и WB?",
                  a: "3-слойный — для товаров до ~15 кг, 5-слойный — для более тяжёлых. На фулфилменте коробки штабелируют в несколько ярусов, поэтому для тяжёлых грузов 5-слойный обязателен: дно 3-слойной коробки может пробиться при перегрузке.",
                },
                {
                  q: "Можно ли купить коробки для маркетплейсов от 1 штуки?",
                  a: "Да, минимальный заказ на складе — 1 шт. Оптовые цены начинаются от 50 шт., для регулярных поставок зафиксируем цену по договору.",
                },
                {
                  q: "Изготавливаете коробки под размер моего товара?",
                  a: `Четырёхклапанные коробки по вашим размерам — от 3000 м² (для 400×300×300 мм это около 3 500 шт.), самосборные — от 1 штуки, но под новый размер изготавливается штанцформа от 6000 ₽. Если ваш габарит не кратен паллете, подберём компромиссный размер из паллетного ряда и посчитаем, сколько теряется на неполном слое. Подробнее — на странице «Производство коробок». Сроки и расчёт — по телефону отдела продаж ${pub.phone} или через форму на сайте.`,
                },
              ]}
            />
          </div>

          {/* ── CTA ── */}
          <div className="seo-home__cta mk-cta">
            <div className="seo-home__cta-body">
              <div className="seo-home__cta-title">
                Подберём тару под вашу номенклатуру и фулфилмент
              </div>
              <div className="seo-home__cta-meta">
                <span>
                  <Clock size={14} /> {SITE_HOURS_LABEL}
                </span>
                <span>
                  <MapPin size={14} /> {SITE_ADDRESS}
                </span>
              </div>
            </div>
            <a href={pub.phoneHref} className="seo-home__cta-phone">
              <Phone size={18} /> {pub.phone}
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
