// =========================================================
// FILE: src/components/catalog/CatalogSeoSection.tsx
// SEO-текстовый блок каталога: помогает ранжироваться по
// запросам «купить гофротару», «гофрокоробки», «каталог
// картонных коробок в Новосибирске» и связывает страницы
// каталога с коммерческими разделами сайта.
// =========================================================

import Link from "next/link";
import { SITE_PHONE, SITE_PHONE_HREF } from "@/lib/site-config";

type SeoCategory = { name: string; slug: string };

export function CatalogSeoSection({ categories }: { categories: SeoCategory[] }) {
  return (
    <section className="seo-block" aria-label="О каталоге гофротары">
      <div className="seo-block__inner seo-block__inner--narrow">
        <h2 className="seo-block__title">
          Каталог гофротары — <span>купить картонные коробки в Новосибирске</span>
        </h2>
        <p>
          В каталоге собраны гофротара и упаковочные материалы, которые есть в наличии на
          складе в Новосибирске. Можно купить картонные коробки от одной штуки — для личного
          использования, переезда или упаковки товара. На постоянные и крупные заказы
          действуют оптовые цены от 50 шт.
        </p>
        <p>
          В ассортименте — гофрокоробки Т-22, Т-23, Т-24, 3-слойный и 5-слойный гофрокартон,
          стрейч-плёнка и скотч. Выберите категорию ниже или обратитесь за помощью — поможем
          подобрать размер и рассчитаем стоимость с учётом доставки.
        </p>

        <div className="seo-block__links">
          {categories.map((c) => (
            <Link key={c.slug} href={`/catalog/${c.slug}`} className="seo-block__link">
              {c.name}
            </Link>
          ))}
        </div>

        <div className="seo-block__cta">
          <div className="seo-block__cta-text">
            Не нашли нужный размер коробки?
            <span>Сделаем под заказ, подберём гофротару под ваш товар</span>
          </div>
          <a href={SITE_PHONE_HREF} className="seo-block__cta-phone">
            {SITE_PHONE}
          </a>
        </div>
      </div>
    </section>
  );
}
