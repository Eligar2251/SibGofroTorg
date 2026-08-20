import Link from "next/link";
import {
  getCategories,
  getProducts,
  getPromotions,
  getProductById,
  getWastepaperRates,
  getSettings,
  getHomeTiles,
} from "@/lib/supabase-queries";
import {
  productMatchesTile,
  parseTagList,
  type HomeTile,
} from "@/lib/home-tiles";
import { formatRate, getWastepaperPageConfig } from "@/lib/wastepaper";
import { FirestoreCategory, FirestoreProduct, Promotion } from "@/lib/types";
import { QuickOrderForm } from "@/components/forms/QuickOrderForm";
import { HomeShowcase, type ShowcaseTile } from "@/components/home/HomeShowcase";
import { HomeOrderProductsSection } from "@/components/home/HomeOrderProductsSection";
import { HomeSaleSection } from "@/components/home/HomeSaleSection";
import { DealsRow } from "@/components/home/DealsRow";
import {
  ORDER_PRODUCTS_ORDER_SETTING_KEY,
  parseProductOrder,
  sortByProductOrder,
} from "@/lib/home-product-order";
import { isProductAvailable } from "@/lib/stock-availability";
import { GlyphIcon } from "@/components/ui/Glyph";
import {
  ArrowRight,
  Phone,
  MapPin,
  Clock,
  Truck,
  Wallet,
  Package,
  PackageCheck,
  Recycle,
  ChevronRight,
} from "lucide-react";
import {
  SITE_ADDRESS,
  SITE_PHONE,
  SITE_PHONE_HREF,
  SITE_HOURS_LABEL,
  SITE_MAP_EMBED_URL,
  SITE_MAP_LINK,
} from "@/lib/site-config";

import { YandexMapEmbed } from "@/components/layout/YandexMapEmbed";
import type { Metadata } from "next";
import { SITE_URL, SITE_NAME, DEFAULT_DESCRIPTION } from "@/lib/seo";
import { HomeSeoSection } from "@/components/seo/HomeSeoSection";
import "./seo-blocks.css";

/** Превращает значение working_hours из БД в SITE_HOURS_LABEL-формат */
function buildHoursLabel(workingHours: string, weekdayFallback: string): string {
  if (workingHours && /пн[‐-―‑–—]?пт/i.test(workingHours)) {
    return /сб.*вс|выходн/i.test(workingHours)
      ? workingHours
      : `${workingHours} · Сб, Вс — выходные`;
  }
  if (workingHours) {
    return `Пн–Пт ${workingHours} · Сб, Вс — выходные`;
  }
  return `Пн–Пт ${weekdayFallback} · Сб, Вс — выходные`;
}

export const metadata: Metadata = {
  // absolute — фиксирует title главной как есть, без суффикса-шаблона
  // из корневого layout (иначе возможно задвоение «… · СибГофроТорг»).
  title: {
    absolute: `Гофротара и картонные коробки в Новосибирске — купить от 1 шт. | ${SITE_NAME}`,
  },
  description:
    "Купить гофротару и картонные коробки в Новосибирске: коробки Т-22, Т-23, Т-24, 3- и 5-слойные. От 1 шт., доставка по городу и области, склад на ул. Ватутина.",
  alternates: { canonical: SITE_URL },
  openGraph: {
    title: `Гофротара и картонные коробки в Новосибирске — ${SITE_NAME}`,
    description:
      "Купить гофротару, картонные коробки и упаковку в Новосибирске. От 1 шт., доставка по городу и области.",
    url: SITE_URL,
  },
};

// Firestore читается в рантайме (учётка Firebase недоступна на этапе сборки
// образа), поэтому страницу не пытаемся пререндерить в `next build`.
// Кэширование данных всё равно работает через unstable_cache (TTL 120с)
// в src/lib/firestore-queries.ts — см. теги [categories]/[products]/...
export const revalidate = 120;
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [categories, allVisibleProducts, promotions, wpRates, settings, homeTiles] =
    await Promise.all([
      getCategories(),
      getProducts({}),
      getPromotions(),
      getWastepaperRates(),
      getSettings().catch(() => ({} as Record<string, string>)),
      getHomeTiles().catch(() => [] as HomeTile[]),
    ]);
  // «Распродажа остатков»: товары с флагом isSale, которые в наличии.
  const saleProducts = allVisibleProducts
    .filter((p) => p.isSale && isProductAvailable(p))
    .slice(0, 16);
  const orderProducts = sortByProductOrder(
    allVisibleProducts.filter((product) => !isProductAvailable(product)),
    parseProductOrder(settings[ORDER_PRODUCTS_ORDER_SETTING_KEY])
  ).slice(0, 12);

  // Берём контактные данные из настроек (админка «Настройки →
  // Контактная информация»), с дефолтами из site-config.ts.
  const homePhone = (settings.phone || SITE_PHONE || "").trim();
  const homePhoneHref = `tel:${homePhone.replace(/[^\d+]/g, "")}` || SITE_PHONE_HREF;
  const homeAddress = (settings.address || SITE_ADDRESS || "").trim();
  const homeWorkingHours = (settings.working_hours || "").trim();
  const homeHoursLabel = buildHoursLabel(homeWorkingHours, "8:30–17:00") || SITE_HOURS_LABEL;

  // Для акций со ссылкой на товар резолвим slug товара,
  // чтобы «Подробнее» вело прямо на страницу товара
  const promoProductIds = [
    ...new Set(
      promotions
        .filter((p: Promotion) => p.linkType === "product" && p.productId)
        .map((p: Promotion) => p.productId as string)
    ),
  ];
  const promoProducts = await Promise.all(
    promoProductIds.map((id) => getProductById(id).catch(() => null))
  );
  const slugByProductId = new Map<string, string>();
  promoProductIds.forEach((id, i) => {
    const slug = promoProducts[i]?.slug;
    if (slug) slugByProductId.set(id, slug);
  });

  // Transform promotions to deal cards format
  const deals = promotions.map((p: Promotion) => {
    // Куда ведёт кнопка в карточке акции
    let href = "/catalog";
    let external = false;
    if (p.linkType === "url" && p.linkUrl) {
      href = p.linkUrl;
      external = /^https?:\/\//i.test(href);
    } else if (p.linkType === "product" && p.productId) {
      const slug = slugByProductId.get(p.productId);
      if (slug) href = `/catalog/product/${slug}`;
    }
    return {
      tag: p.badge || "Акция",
      title: p.title,
      desc: p.subtitle || "",
      color: p.color || "var(--kraft)",
      light: p.light || "var(--kraft-light)",
      icon: p.icon || "box",
      deadline: p.deadline || null,
      href,
      external,
    };
  });

  const serializedCategories = categories.map((cat: FirestoreCategory) => ({
    id: cat.id,
    name: cat.name,
    slug: cat.slug,
    icon: cat.icon ?? "box",
  }));

  const serializeHomeProduct = (p: FirestoreProduct) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    sku: p.sku ?? null,
    price: p.price,
    priceWholesale: p.priceWholesale ?? null,
    minWholesaleQty: p.minWholesaleQty ?? null,
    packQty: p.packQty ?? null,
    imageUrl: p.imageUrl ?? null,
    inStock: p.inStock,
    promoLabel: p.promoLabel ?? null,
    promoLabelColor: p.promoLabelColor ?? null,
    promoLabelTextColor: p.promoLabelTextColor ?? null,
    madeToOrder: p.madeToOrder ?? false,
    madeToOrderMinQty: (p as any).madeToOrderMinQty ?? null,
    isCuttable: (p as any).isCuttable ?? false,
    cutMetersPerRoll: (p as any).cutMetersPerRoll ?? null,
    cutPricePerMeter: (p as any).cutPricePerMeter ?? null,
    cutUnitName: (p as any).cutUnitName || 'м',
    stockQty: p.stockQty ?? null,
    dimensionLength: p.dimensionLength ?? null,
    dimensionWidth: p.dimensionWidth ?? null,
    dimensionHeight: p.dimensionHeight ?? null,
    dimensionUnit: p.dimensionUnit ?? null,
    material: p.material ?? null,
    hasVariants: p.hasVariants ?? false,
    variantCount: p.variantCount ?? 0,
    variantPriceMin: p.variantPriceMin ?? null,
    variantPriceMax: p.variantPriceMax ?? null,
    variantTotalStock: p.variantTotalStock ?? 0,
  });
  const serializedOrderProducts = orderProducts.map(serializeHomeProduct);

  // ── Плитки разделов (витрина главной) ──
  // Порядок и содержимое задаёт админка. Если плитки ещё не заведены
  // (или миграция не применена) — собираем их автоматически из
  // видимых категорий каталога, чтобы главная не осталась пустой.
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const tileSource: HomeTile[] = homeTiles.length
    ? homeTiles
    : [
        {
          id: "auto-featured",
          title: "Популярные",
          subtitle: "Чаще всего заказывают",
          imageUrl: null,
          icon: "star",
          kind: "featured" as const,
          categoryId: null,
          tag: null,
          accent: null,
          sortOrder: -1,
          isVisible: true,
        },
        ...categories.map((cat, index) => ({
          id: `auto-${cat.id}`,
          title: cat.name,
          subtitle: cat.description ?? null,
          imageUrl: cat.imageUrl ?? null,
          icon: cat.icon ?? "box",
          kind: "category" as const,
          categoryId: cat.id,
          tag: null,
          accent: null,
          sortOrder: index,
          isVisible: true,
        })),
      ];

  const showcaseTiles: ShowcaseTile[] = tileSource.flatMap((tile) => {
      const cat = tile.categoryId ? categoryById.get(tile.categoryId) : null;
      // Категорию могли удалить — такую плитку не показываем.
      if (tile.kind === "category" && !cat) return [];

      // В плитке «Популярные» показываем только то, что в наличии:
      // закончившиеся позиции живут в отдельном блоке «Под заказ».
      const matched = allVisibleProducts.filter(
        (p) =>
          productMatchesTile(p, tile) &&
          (tile.kind !== "featured" || isProductAvailable(p))
      );
      if (matched.length === 0) return [];

      const params = new URLSearchParams();
      if (tile.kind === "category" && cat) params.set("category", cat.slug);
      if (tile.kind === "tag") params.set("tag", parseTagList(tile.tag).join(","));
      if (tile.kind === "featured") {
        params.set("featured", "1");
        params.set("stock", "yes");
      }
      if (tile.kind === "sale") params.set("sale", "1");

      const showcaseTile: ShowcaseTile = {
        id: tile.id,
        title: tile.title || cat?.name || "Раздел",
        subtitle: tile.subtitle ?? cat?.description ?? null,
        // Фото плитки: своё → фото категории → фото первого товара.
        imageUrl:
          tile.imageUrl ||
          cat?.imageUrl ||
          matched.find((p) => p.imageUrl)?.imageUrl ||
          null,
        icon: tile.icon || cat?.icon || "box",
        accent: tile.accent ?? null,
        href: tile.kind === "category" && cat ? `/catalog/${cat.slug}` : "/catalog",
        apiQuery: params.toString(),
        count: matched.length,
        products: matched.slice(0, 12).map(serializeHomeProduct),
      };
      return [showcaseTile];
  });

  const wpCfg = getWastepaperPageConfig(settings);

  const serializeSaleProduct = (p: FirestoreProduct) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    sku: p.sku ?? null,
    price: p.price,
    imageUrl: p.imageUrl ?? null,
    inStock: p.inStock,
    stockQty: p.stockQty ?? null,
    discountType: p.discountType ?? null,
    discountValue: p.discountValue ?? null,
  });
  const serializedSaleProducts = saleProducts.map(serializeSaleProduct);

  return (
    <div className="page-home">
      {/* HERO */}
      <section className="hero" aria-label="Главный баннер">
        <div className="hero__left">
          <div className="hero__left-inner container-half">
            <span className="hero__eyebrow">
              Склад в Новосибирске · быстрая отгрузка
            </span>
            <h1 className="hero__h1">
              Гофрокороб
              <br />
              <span className="hero__accent">от 1 штуки</span>
              <br />
              со склада
            </h1>
            <p className="hero__sub">
              Марки Т-22, Т-23, Т-24 · 3 и 5-слойный.
              <br />
              Минимальный заказ — 1 шт. Оплата при получении.
            </p>

            <div className="hero__reserve-note">
              <PackageCheck size={20} />
              <div>
                <strong>Забронируйте товар без предоплаты</strong>
                <span>
                  Оформите заказ на сайте, приезжайте на склад и оплатите при получении.
                </span>
              </div>
            </div>

            <div className="hero__perks">
              <div className="hero__perk">
                <Truck size={16} />
                <span>Доставка 2-3 дня</span>
              </div>
              <div className="hero__perk">
                <Wallet size={16} />
                <span>Оплата при получении</span>
              </div>
              <div className="hero__perk">
                <Package size={16} />
                <span>От 1 шт. в наличии</span>
              </div>
            </div>

            <div className="hero__ctas">
              <Link href="/catalog" className="btn-hero-primary">
                Перейти в каталог <ArrowRight size={16} />
              </Link>
              <a href={homePhoneHref} className="btn-hero-ghost">
                <Phone size={15} /> {homePhone}
              </a>
            </div>
          </div>
        </div>

        {/* Правая панель — одна ссылка на /wastepaper.
            Телефон вынесен соседним <a>, чтобы не было <a> внутри <a>. */}
        <div className="hero__right">
          <Link href="/wastepaper" className="hero__right-inner container-half-right">
            <div className="hero__wp-tag">
              <Recycle size={13} />
              <span>Экосервис</span>
            </div>
            <h2 className="hero__wp-title">
              Принимаем
              <br />
              макулатуру
            </h2>
            <p className="hero__wp-sub">
              Сдай картон, бумагу, архивы
            </p>

            <div className="hero__wp-rates">
              <div className="hero__wp-rate">
                <span>Гофрокартон</span>
                <strong>{formatRate(wpRates.cardboard)} ₽/кг</strong>
              </div>
              <div className="hero__wp-rate">
                <span>Белая бумага</span>
                <strong>{formatRate(wpRates.office_paper)} ₽/кг</strong>
              </div>
              <div className="hero__wp-rate">
                <span>Книги / архив</span>
                <strong>{formatRate(wpRates.books)} ₽/кг</strong>
              </div>
            </div>

            <div className="hero__wp-features">
              <span>
                Вывоз от {wpCfg.pickupMinKg} кг — {wpCfg.pickupPrice > 0 ? `${wpCfg.pickupPrice} ₽` : "0 ₽"}
              </span>
              <span>Оплата на месте</span>
              <span>Работаем с юрлицами</span>
            </div>

            <div className="hero__wp-bottom">
              <span className="hero__wp-label">
                Рассчитать выплату <ChevronRight size={15} />
              </span>
              <span className="hero__wp-phone-spacer" aria-hidden />
            </div>
          </Link>
          <a
            href="tel:+73832910820"
            className="hero__wp-phone-badge"
            aria-label="Позвонить в отдел макулатуры 291-08-20"
          >
            <Phone size={13} />
            <strong>291-08-20</strong>
          </a>
        </div>
      </section>

      {/* АКЦИИ */}
      <section className="deals-section">
        <div className="container">
          <div className="deals-head">
            <h2 className="section-title">Акции и спецпредложения</h2>
            <Link href="/catalog" className="deals-head__all">
              Все предложения <ArrowRight size={13} />
            </Link>
          </div>
          <DealsRow>
            {deals.map((d, i) => (
              <div
                key={i}
                className="deal-card"
                style={{
                  "--deal-color": d.color,
                  "--deal-light": d.light,
                } as React.CSSProperties}
              >
                <div className="deal-card__top">
                  <span className="deal-card__icon"><GlyphIcon value={d.icon} size={20} /></span>
                  <span className="deal-card__tag">{d.tag}</span>
                  {d.deadline && (
                    <span className="deal-card__deadline">до {d.deadline}</span>
                  )}
                </div>
                <div className="deal-card__title">
                  {d.title.split("\n").map((line, j) => (
                    <span key={j}>
                      {line}
                      <br />
                    </span>
                  ))}
                </div>
                <p className="deal-card__desc">{d.desc}</p>
                {d.external ? (
                  <a
                    href={d.href}
                    className="deal-card__cta"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Подробнее <ArrowRight size={12} />
                  </a>
                ) : (
                  <Link href={d.href} className="deal-card__cta">
                    Подробнее <ArrowRight size={12} />
                  </Link>
                )}
              </div>
            ))}
          </DealsRow>
        </div>
      </section>

      {/* РАСПРОДАЖА ОСТАТКОВ — перед популярными товарами */}
      <HomeSaleSection products={serializedSaleProducts} />

      {/* ПЛИТКИ РАЗДЕЛОВ → мгновенное окно каталога (поиск + фильтр) */}
      <HomeShowcase tiles={showcaseTiles} />

      {/* Закончившиеся, но доступные к поставке позиции */}
      <HomeOrderProductsSection products={serializedOrderProducts} />

      {/* Консультация */}
      <section className="consult-section">
        <div className="container">
          <div className="consult-grid">
            <div className="consult-left">
              <span className="consult-eyebrow">Оформление заказа</span>
              <h2 className="consult-title">Оформите заказ — заберите со склада</h2>
              <p className="consult-desc">
                Добавьте товар в корзину и оформите заказ. Сразу получите номер
                получения — приезжайте на склад и оплатите при получении.
              </p>
              <a href={homePhoneHref} className="consult-phone">
                <Phone size={18} /> {homePhone}
              </a>
              <p className="consult-hours">{homeHoursLabel}</p>
            </div>
            <div className="consult-form">
              <QuickOrderForm />
            </div>
          </div>
        </div>
      </section>

      {/* Карта — отступ сверху/снизу, чтобы не «прилипала» к футеру */}
      <section className="map-section">
        <div className="container">
          <div className="map-card">
            <div className="map-info">
              <h3 className="map-info__title">Склад-магазин</h3>
              <div className="map-info__row">
                <MapPin size={15} />
                <span>{homeAddress}</span>
              </div>
              <div className="map-info__row">
                <Clock size={15} />
                <span>{homeHoursLabel}</span>
              </div>
              <div className="map-info__row">
                <Phone size={15} />
                <a href={homePhoneHref}>{homePhone}</a>
              </div>
              <a
                href={SITE_MAP_LINK}
                target="_blank"
                rel="noopener noreferrer"
                className="map-cta"
              >
                <MapPin size={13} /> Открыть на карте
              </a>
            </div>
            <div className="map-embed">
              <YandexMapEmbed
                src={SITE_MAP_EMBED_URL}
                title="Карта — СибГофроТорг"
                address={homeAddress}
              />
            </div>
          </div>
        </div>
      </section>

      {/* SEO-текстовый блок с ключевыми запросами и FAQ */}
      <HomeSeoSection categories={serializedCategories} />
    </div>
  );
}