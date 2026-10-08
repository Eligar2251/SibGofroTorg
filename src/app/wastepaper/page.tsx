import Image from "next/image";
import Link from "next/link";
import { CheckCircle, Truck, Coins, ShieldCheck, Phone, Scale } from "lucide-react";
import "./wastepaper.css";
import { GlyphIcon } from "@/components/ui/Glyph";
import { getSettings } from "@/lib/supabase-queries";
import { getWastepaperPageConfig, WASTEPAPER_PHONE_DEFAULT } from "@/lib/wastepaper";
import type { Metadata } from "next";
import { SITE_URL } from "@/lib/seo";

export const metadata: Metadata = {
  title: `Приём макулатуры в Новосибирске — вывоз, звоните ${WASTEPAPER_PHONE_DEFAULT}`,
  description:
    `Сдать картон, бумагу и архивы в Новосибирске. Тел. ${WASTEPAPER_PHONE_DEFAULT}. Вывоз от 200 кг, оплата на месте. Цену уточняйте по телефону — СибГофроТорг.`,
  alternates: { canonical: `${SITE_URL}/wastepaper` },
};

// Телефон и условия вывоза читаем из настроек в рантайме (админка),
// поэтому страница не пререндерится на этапе сборки.
export const dynamic = "force-dynamic";

export default async function WastepaperPage() {
  const settings = await getSettings();
  const wp = getWastepaperPageConfig(settings);
  const pickupPriceLabel = wp.pickupPrice > 0 ? `${wp.pickupPrice} ₽` : "0 ₽";
  // Номер отдела макулатуры — из настроек (админка → Макулатура),
  // с дефолтом 291-08-20. Гофротара использует отдельный settings.phone.
  const contactPhone = wp.phone;
  const contactPhoneHref = wp.phoneHref;

  const materials = [
    { icon: "box", name: "Гофрокартон", desc: "Коробки и упаковка в разобранном виде" },
    { icon: "file", name: "Офисная бумага", desc: "Белая архивная бумага А4, документы" },
    { icon: "books", name: "Книги и журналы", desc: "Газеты, каталоги, печатная продукция" },
    { icon: "trash", name: "Смешанная макулатура", desc: "Разные виды бумаги и картона" },
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
            <h1 className="wp-hero__title">Приём макулатуры<br /><span>в Новосибирске</span></h1>
            <p className="wp-hero__desc">
              Принимаем гофрокартон, офисную бумагу, книги и журналы. Работаем с физлицами и организациями. Цену и условия вывоза уточняйте по телефону.
              {" "}Звоните:{" "}
              <a href={contactPhoneHref} style={{ color: "var(--green-lime)", fontWeight: 700, fontSize: "1.2em", whiteSpace: "nowrap" }}>
                {contactPhone}
              </a>
              . Вывоз от {wp.pickupMinKg} кг.
            </p>
            <div className="wp-hero__stats">
              <div className="wp-hero__stat">
                <div className="wp-hero__stat-val">по звонку</div>
                <div className="wp-hero__stat-label">актуальная цена</div>
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
                <div className="wp-hero__stat-val">1 звонок</div>
                <div className="wp-hero__stat-label">и всё решено</div>
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

        {/* Основной контент — без калькулятора: всё уточняем по телефону */}
        <div className="wpc-main">
          <div className="wpc-info">

            {/* Что принимаем */}
            <section className="wpc-card">
              <h2 className="wpc-card__title"><GlyphIcon value="recycle" size={20} /> Что мы принимаем</h2>
              <div className="wpc-types">
                {materials.map((m) => (
                  <div key={m.name} className="wpc-type">
                    <span className="wpc-type__icon"><GlyphIcon value={m.icon} size={24} /></span>
                    <div>
                      <div className="wpc-type__name">{m.name}</div>
                      <div className="wpc-type__desc">{m.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
              {wp.acceptList.length > 0 && (
                <ul className="wpc-accept">
                  {wp.acceptList.map((item, i) => (
                    <li key={i}><CheckCircle size={16} /> {item}</li>
                  ))}
                </ul>
              )}
            </section>

            {/* Как это работает */}
            <section className="wpc-card">
              <h2 className="wpc-card__title"><GlyphIcon value="ok" size={20} /> Как сдать макулатуру</h2>
              <ol className="wpc-steps">
                {[
                  { t: "Позвоните нам", d: `${contactPhone} — расскажите, что и сколько хотите сдать` },
                  { t: "Уточним условия", d: `Назовём актуальную цену и условия вывоза — вывозим от ${wp.pickupMinKg} кг` },
                  { t: "Приедем или ждём вас", d: "Согласуем удобное время вывоза или приёма на нашей площадке" },
                  { t: "Взвешивание и оплата", d: "Взвешиваем на поверенных весах и сразу рассчитываемся" },
                ].map((step, i) => (
                  <li key={i} className="wpc-step">
                    <span className="wpc-step__num">{i + 1}</span>
                    <div>
                      <div className="wpc-step__title">{step.t}</div>
                      <div className="wpc-step__desc">{step.d}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          </div>

          {/* Правый блок — звонок */}
          <aside className="wpc-call-wrap">
            <div className="wpc-call">
              <div className="wpc-call__icon"><Phone size={28} /></div>
              <div className="wpc-call__title">Цену и вывоз уточняйте по телефону</div>
              <p className="wpc-call__text">
                Стоимость зависит от вида сырья, объёма и чистоты партии. Позвоните — менеджер сразу назовёт актуальную цену и подскажет условия вывоза.
              </p>
              <a href={contactPhoneHref} className="wpc-call__phone">{contactPhone}</a>
              <a href={contactPhoneHref} className="wpc-call__btn"><Phone size={18} /> Позвонить</a>
              <ul className="wpc-call__facts">
                <li><Scale size={18} /> <span>Вывоз <b>от {wp.pickupMinKg} кг</b>{wp.pickupPrice > 0 ? ` · ${pickupPriceLabel}` : " — бесплатно"}</span></li>
                <li><Truck size={18} /> <span>Меньше {wp.pickupMinKg} кг — привозите сами</span></li>
                <li><Coins size={18} /> <span>Оплата сразу после взвешивания</span></li>
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}