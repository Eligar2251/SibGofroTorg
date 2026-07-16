import Link from "next/link";
import { WastepaperCalculator } from "@/components/wastepaper/WastepaperCalculator";
import { CheckCircle, Truck, Coins, ShieldCheck, ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import { SITE_URL } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Приём макулатуры в Новосибирске — цены за кг",
  description:
    "Сдать картон, бумагу и архивы в Новосибирске. Вывоз от 150 кг, оплата на месте. Актуальные тарифы СибГофроТорг.",
  alternates: { canonical: `${SITE_URL}/wastepaper` },
};

export default function WastepaperPage() {
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
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="https://images.unsplash.com/photo-1532996122724-e3c354a0b15b?w=1400&q=80"
          alt="Приём макулатуры"
          className="wp-hero__bg"
        />
        <div className="container-wide wp-hero__inner">
          <div className="wp-hero__content">
            <div className="wp-hero__badge">♻️ Вторая жизнь сырья</div>
            <h1 className="wp-hero__title">Приём макулатуры<br /><span>дорого в Новосибирске</span></h1>
            <p className="wp-hero__desc">
              Принимаем гофрокартон, белую архивную бумагу, книги и журналы. Работаем с физлицами и организациями. Оплата на месте наличными или картой.
            </p>
            <div className="wp-hero__stats">
              <div className="wp-hero__stat">
                <div className="wp-hero__stat-val">от 6 ₽</div>
                <div className="wp-hero__stat-label">за кг</div>
              </div>
              <div className="wp-hero__stat-div" />
              <div className="wp-hero__stat">
                <div className="wp-hero__stat-val">от 150 кг</div>
                <div className="wp-hero__stat-label">бесплатный вывоз</div>
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
              desc: "Приедем своим транспортом при партии от 150 кг в черте города"
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
                <span className="wp-rates-card__badge">обновлено сегодня</span>
              </div>
              <div className="wp-rates-list">
                {[
                  { icon: "📦", name: "Гофрокартон (коробки в разобранном виде)", rate: 8.0, bonus: "+ 0.5 ₽/кг самовывоз" },
                  { icon: "📄", name: "Белая архивная бумага А4", rate: 11.5, bonus: "+ 0.5 ₽/кг самовывоз" },
                  { icon: "📚", name: "Книги, журналы, газеты, каталоги", rate: 9.0, bonus: "+ 0.5 ₽/кг самовывоз" },
                  { icon: "🗑️", name: "Смешанная макулатура", rate: 6.0, bonus: "+ 0.5 ₽/кг самовывоз" },
                ].map((row, i) => (
                  <div key={i} className="wp-rate-row">
                    <div className="wp-rate-row__left">
                      <span className="wp-rate-row__icon">{row.icon}</span>
                      <div>
                        <div className="wp-rate-row__name">{row.name}</div>
                        <div className="wp-rate-row__bonus">{row.bonus}</div>
                      </div>
                    </div>
                    <div className="wp-rate-row__price">{row.rate} ₽<span>/кг</span></div>
                  </div>
                ))}
              </div>
            </div>

            {/* Что принимаем */}
            <div className="wp-accept-card">
              <h3 className="wp-accept-card__title">✅ Что мы принимаем</h3>
              <div className="wp-accept-grid">
                {[
                  "Гофрокартон — коробки, листы, обрезки",
                  "Белая офисная бумага А4 и А3",
                  "Архивные документы (без папок)",
                  "Книги, журналы, газеты",
                  "Рекламные листовки и каталоги",
                  "Смешанная макулатура в связках",
                ].map((item, i) => (
                  <div key={i} className="wp-accept-item">
                    <span className="wp-accept-check">✓</span>
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
                <div className="wp-calc-card__icon">💰</div>
                <div>
                  <div className="wp-calc-card__title">Калькулятор выплаты</div>
                  <div className="wp-calc-card__sub">Узнайте сколько получите за партию</div>
                </div>
              </div>
              <WastepaperCalculator />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}