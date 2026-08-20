import Image from "next/image";
import Link from "next/link";
import { WastepaperCalculator } from "@/components/wastepaper/WastepaperCalculator";
import { CheckCircle, Truck, Coins, ShieldCheck } from "lucide-react";
import { GlyphIcon } from "@/components/ui/Glyph";
import { getWastepaperRates, getSettings } from "@/lib/supabase-queries";
import { formatRate, getWastepaperPageConfig } from "@/lib/wastepaper";
import type { Metadata } from "next";
import { SITE_URL } from "@/lib/seo";
import { SITE_PHONE, SITE_PHONE_HREF } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Приём макулатуры в Новосибирске — цены за кг",
  description:
    "Сдать картон, бумагу и архивы в Новосибирске. Вывоз от 200 кг, оплата на месте. Актуальные тарифы СибГофроТорг.",
  alternates: { canonical: `${SITE_URL}/wastepaper` },
};

// Цены читаем из настроек в рантайме (редактируются в админке),
// поэтому страница не пререндерится на этапе сборки.
export const dynamic = "force-dynamic";

export default async function WastepaperPage() {
  const [rates, settings] = await Promise.all([getWastepaperRates(), getSettings()]);
  const wp = getWastepaperPageConfig(settings);
  const minRate = Math.min(...Object.values(rates));
  const selfBonus = `+ ${wp.selfBonus} ₽/кг самовывоз`;
  const pickupPriceLabel = wp.pickupPrice > 0 ? `${wp.pickupPrice} ₽` : "0 ₽";
  const contactPhone = (settings.phone || SITE_PHONE || "").trim() || SITE_PHONE;
  const contactPhoneHref = `tel:${contactPhone.replace(/[^\d+]/g, "")}` || SITE_PHONE_HREF;

  // Тарифы: названия фиксированные, цены — из настроек
  const rateRows = [
    { icon: "box", name: "Гофрокартон (коробки в разобранном виде)", rate: rates.cardboard, bonus: selfBonus },
    { icon: "file", name: "Белая архивная бумага А4", rate: rates.office_paper, bonus: selfBonus },
    { icon: "books", name: "Книги, журналы, газеты, каталоги", rate: rates.books, bonus: selfBonus },
    { icon: "trash", name: "Смешанная макулатура", rate: rates.mix, bonus: selfBonus },
  ];

  return (
    <div style={{ backgroundColor: "var(--bg-main)", paddingBottom: "64px" }}>

      {/* Хлебные крошки */}
      <div style={{ borderBottom: "1px solid var(--border)", backgroundColor: "#ffffff" }}>
        <div className="container-wide" style={{ paddingBlock: "14px" }}>
          <div style={{ display: "flex", gap: "8px", fontSize: "13px", color: "var(--ink-muted)" }}>
            <Link href="/" style={{ color: "var(--ink-muted)", textDecoration: "none" }}>Главная</Link>
            <span>/</span>
            <span style={{ color: "var(--ink)" }}>Приём макулатуры</span>
          </div>
        </div>
      </div>

      {/* Hero-баннер макулатуры */}
      <div className="wp-hero">
        <div className="wp-hero__overlay" />
        <Image
          src="https://images.unsplash.com/photo-1532996122724-e3c354a0b15b?w=1400&q=80"
          alt="Приём макулатуры"
          className="wp-hero__bg"
          fill
          priority
          sizes="100vw"
        />
        <div className="container-wide wp-hero__inner">
          <div className="wp-hero__content">
            <div className="wp-hero__badge"><GlyphIcon value="recycle" size={13} /> Вторая жизнь сырья</div>
            <h1 className="wp-hero__title">Приём макулатуры<br /><span>дорого в Новосибирске</span></h1>
            <p className="wp-hero__desc">
              Принимаем гофрокартон, белую архивную бумагу, книги и журналы. Работаем с физлицами и организациями. Оплата на месте наличными или картой.
              {" "}Цены уточняйте по телефону{" "}
              <a href={contactPhoneHref} style={{ color: "var(--green-lime)", fontWeight: 700 }}>
                {contactPhone}
              </a>
              . Вывоз от {wp.pickupMinKg} кг.
            </p>
            <div className="wp-hero__stats">
              <div className="wp-hero__stat">
                <div className="wp-hero__stat-val">от {formatRate(minRate)} ₽</div>
                <div className="wp-hero__stat-label">за кг</div>
              </div>
              <div className="wp-hero__stat-div" />
              <div className="wp-hero__stat">
                <div className="wp-hero__stat-val">от {wp.pickupMinKg} кг</div>
                <div className="wp-hero__stat-label">
                  {wp.pickupPrice > 0 ? `вывоз ${pickupPriceLabel}` : "бесплатный вывоз"}
                </div>
              </div>
              <div className="wp-hero__stat-div" />
              <div className="wp-hero__stat">
                <div className="wp-hero__stat-val">15 мин</div>
                <div className="wp-hero__stat-label">перезвоним</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="container-wide" style={{ marginTop: "32px" }}>

        {/* Преимущества */}
        <div className="wp-perks">
          {[
            {
              icon: <Coins size={22} style={{ color: "#16a34a" }} />,
              color: "#dcfce7",
              title: "Мгновенная оплата",
              desc: "Выплачиваем сразу наличными или картой после взвешивания"
            },
            {
              icon: <Truck size={22} style={{ color: "var(--kraft)" }} />,
              color: "#fef3c7",
              title: "Бесплатный вывоз",
              desc: `Приедем своим транспортом при партии от ${wp.pickupMinKg} кг в черте города${wp.pickupPrice > 0 ? ` · ${pickupPriceLabel}` : ""}`
            },
            {
              icon: <ShieldCheck size={22} style={{ color: "#2563eb" }} />,
              color: "#eff6ff",
              title: "Точные весы",
              desc: "Электронные весы с государственной поверкой — без обвесов"
            },
            {
              icon: <CheckCircle size={22} style={{ color: "#16a34a" }} />,
              color: "#dcfce7",
              title: "Без бюрократии",
              desc: "Просто позвоните — мы сами организуем всё остальное"
            },
          ].map((item, i) => (
            <div key={i} className="wp-perk">
              <div className="wp-perk__icon" style={{ backgroundColor: item.color }}>
                {item.icon}
              </div>
              <div>
                <div className="wp-perk__title">{item.title}</div>
                <div className="wp-perk__desc">{item.desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Основной контент — тарифы + калькулятор */}
        <div className="wp-main">

          {/* Левый блок — тарифы и правила */}
          <div className="wp-info">

            {/* Тарифная таблица */}
            <div className="wp-rates-card">
              <div className="wp-rates-card__header">
                <h2 className="wp-rates-card__title">Актуальные тарифы</h2>
                <span className="wp-rates-card__badge">ориентир · уточняйте</span>
              </div>
              <div className="wp-rates-list">
                {rateRows.map((row, i) => (
                  <div key={i} className="wp-rate-row">
                    <div className="wp-rate-row__left">
                      <span className="wp-rate-row__icon"><GlyphIcon value={row.icon} size={22} /></span>
                      <div>
                        <div className="wp-rate-row__name">{row.name}</div>
                        <div className="wp-rate-row__bonus">{row.bonus}</div>
                      </div>
                    </div>
                    <div className="wp-rate-row__price">{formatRate(row.rate)} ₽<span>/кг</span></div>
                  </div>
                ))}
              </div>
            </div>

            {/* Что принимаем */}
            <div className="wp-accept-card">
              <h3 className="wp-accept-card__title"><GlyphIcon value="ok" size={18} /> Что мы принимаем</h3>
              <div className="wp-accept-grid">
                {wp.acceptList.map((item, i) => (
                  <div key={i} className="wp-accept-item">
                    <span className="wp-accept-check"><GlyphIcon value="check" size={14} fallback={null} /></span>
                    {item}
                  </div>
                ))}
              </div>
            </div>

            {/* Как это работает */}
            <div className="wp-steps-card">
              <h3 className="wp-steps-card__title">Как сдать макулатуру</h3>
              <div className="wp-steps">
                {[
                  { n: "1", text: "Рассчитайте примерную стоимость в калькуляторе справа" },
                  { n: "2", text: "Оставьте заявку или позвоните нам по телефону" },
                  { n: "3", text: "Мы согласуем время приёма или вывоза" },
                  { n: "4", text: "Взвешивание и мгновенная выплата на месте" },
                ].map((step) => (
                  <div key={step.n} className="wp-step">
                    <div className="wp-step__num">{step.n}</div>
                    <div className="wp-step__text">{step.text}</div>
                  </div>
                ))}
              </div>
            </div>

          </div>

          {/* Правый блок — Калькулятор */}
          <div className="wp-calc-wrap">
            <div className="wp-calc-card">
              <div className="wp-calc-card__header">
                <div className="wp-calc-card__icon"><GlyphIcon value="coins" size={30} /></div>
                <div>
                  <div className="wp-calc-card__title">Калькулятор выплаты</div>
                  <div className="wp-calc-card__sub">Узнайте сколько получите за партию</div>
                </div>
              </div>
              <WastepaperCalculator
                rates={rates}
                pickupMinKg={wp.pickupMinKg}
                selfBonus={wp.selfBonus}
                pickupPrice={wp.pickupPrice}
                contactPhone={contactPhone}
                contactPhoneHref={contactPhoneHref}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}