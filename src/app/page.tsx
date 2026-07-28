import Link from "next/link";
import {
  getCategories,
  getProducts,
  getPromotions,
  getProductById,
  getWastepaperRates,
  getSettings,
} from "@/lib/supabase-queries";
import { formatRate } from "@/lib/wastepaper";
import { FirestoreCategory, FirestoreProduct, Promotion } from "@/lib/types";
import { QuickOrderForm } from "@/components/forms/QuickOrderForm";
import { HomeCatalogSection } from "@/components/home/HomeCatalogSection";
import { DealsRow } from "@/components/home/DealsRow";
import { GlyphIcon } from "@/components/ui/Glyph";
import {
  ArrowRight,
  Phone,
  MapPin,
  Clock,
  Truck,
  Zap,
  Package,
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
  title: `Гофрокоробки в Новосибирске от 1 шт. — ${SITE_NAME}`,
  description: DEFAULT_DESCRIPTION,
  alternates: { canonical: SITE_URL },
  openGraph: {
    title: `Гофрокоробки в Новосибирске — ${SITE_NAME}`,
    description: DEFAULT_DESCRIPTION,
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
  const [categories, featuredProducts, promotions, wpRates, settings] = await Promise.all([
    getCategories(),
    getProducts({
      featuredOnly: true,
      limitCount: 12,
    }),
    getPromotions(),
    getWastepaperRates(),
    getSettings().catch(() => ({} as Record<string, string>)),
  ]);

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

  const serializedProducts = featuredProducts.map((p: FirestoreProduct) => ({
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
    madeToOrder: p.madeToOrder ?? false,
    stockQty: p.stockQty ?? null,
    dimensionLength: p.dimensionLength ?? null,
    dimensionWidth: p.dimensionWidth ?? null,
    dimensionHeight: p.dimensionHeight ?? null,
    dimensionUnit: p.dimensionUnit ?? null,
    material: p.material ?? null,
  }));

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
              Минимальный заказ — 1 шт. Оптовые цены от 50 шт.
            </p>

            <div className="hero__perks">
              <div className="hero__perk">
                <Truck size={16} />
                <span>Доставка 2-3 дня</span>
              </div>
              <div className="hero__perk">
                <Zap size={16} />
                <span>Ответим за 15 мин</span>
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

        <Link
          href="/wastepaper"
          className="hero__right"
          aria-label="Приём макулатуры"
        >
          <div className="hero__right-inner container-half-right">
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
              <span>Вывоз от 150 кг — 0 ₽</span>
              <span>Оплата на месте</span>
              <span>Работаем с юрлицами</span>
            </div>

            <div className="hero__wp-phone">
              <Phone size={14} />
              <span>Отдел макулатуры: <strong>291-08-20</strong></span>
            </div>

            <span className="hero__wp-label">
              Рассчитать выплату <ChevronRight size={15} />
            </span>
          </div>
        </Link>
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

      {/* ПОИСК + КАТЕГОРИИ + ТОВАРЫ — один блок */}
      <HomeCatalogSection
        categories={serializedCategories}
        initialProducts={serializedProducts}
      />

      {/* Консультация */}
      <section className="consult-section">
        <div className="container">
          <div className="consult-grid">
            <div className="consult-left">
              <span className="consult-eyebrow">Нужна консультация?</span>
              <h2 className="consult-title">Перезвоним за 15 минут</h2>
              <p className="consult-desc">
                Подберём нужный размер короба, рассчитаем оптовую стоимость и
                организуем доставку.
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
    </div>
  );
}