"use client";

// =========================================================
// FILE: src/components/admin/mobile/WarehouseMobile.tsx
// Мобильный «банк» обычного учёта: hero с балансом и сетка вкладок.
//
// Рендерится ТОЛЬКО когда useIsMobile() === true (ветка в
// WarehouseManager) — на десктопе этих узлов нет в DOM вообще.
// Стили — CSS-модуль рядом, медиазапросов нет: «мобильность»
// определяет JS-хук, как в остальных мобильных компонентах.
// =========================================================

import type { ReactNode } from "react";
import {
  Banknote,
  Calculator,
  CreditCard,
  HandCoins,
  Wallet,
} from "lucide-react";
import styles from "./WarehouseMobile.module.css";

const fmt = (n: number) => n.toLocaleString("ru-RU");

export interface WarehouseMobileHeroData {
  /** Все деньги: счёт + касса + карта ЮМ. */
  total: number;
  bank: number;
  cash: number;
  cashNegative: boolean;
  ym: number;
  forecast: number;
  /** Должны нам (покупатели). */
  receivables: number;
  /** Мы должны (поставщикам). */
  payables: number;
  dateLabel: string;
}

export function WarehouseMobileHero({
  data,
  actions,
  onOpenBank,
  onCalculator,
  onCollectCash,
  collecting,
}: {
  /** Кнопки-триггеры ReceiptForm / DealForm / PaymentForm. */
  actions: ReactNode;
  data: WarehouseMobileHeroData;
  onOpenBank: () => void;
  onCalculator: () => void;
  onCollectCash: () => void;
  collecting: boolean;
}) {
  return (
    <section className={styles.hero} aria-label="Сводка учёта">
      <div className={styles.balance}>
        <div className={styles.caption}>
          <Wallet size={18} aria-hidden />
          <span>Учёт</span>
          <span className={styles.date}>{data.dateLabel}</span>
          <button
            type="button"
            className={styles.calcBtn}
            onClick={onCalculator}
            title="Калькулятор счёта"
            aria-label="Калькулятор счёта"
          >
            <Calculator size={16} aria-hidden />
          </button>
        </div>
        <div className={styles.totalLabel}>Всего денег</div>
        <strong className={styles.total}>{fmt(Math.round(data.total))} ₽</strong>
        <div className={styles.forecast}>
          Прогноз: <b>{fmt(Math.round(data.forecast))} ₽</b>
        </div>
        <dl className={styles.accounts}>
          <div>
            <dt>
              <CreditCard size={16} aria-hidden /> Счёт
            </dt>
            <dd>{fmt(Math.round(data.bank))} ₽</dd>
          </div>
          <div>
            <dt>
              <Banknote size={16} aria-hidden /> Касса
            </dt>
            <dd className={data.cashNegative ? styles.negative : undefined}>
              {fmt(Math.round(data.cash))} ₽
            </dd>
          </div>
          <div>
            <dt>
              <CreditCard size={16} aria-hidden /> Карта ЮМ
            </dt>
            <dd>{fmt(Math.round(data.ym))} ₽</dd>
          </div>
        </dl>
      </div>

      <button
        type="button"
        className={styles.debts}
        onClick={onOpenBank}
        aria-label="Открыть банк: долги контрагентов"
      >
        <HandCoins size={18} aria-hidden />
        <span className={styles.debtsText}>
          Нам должны <b>{fmt(Math.round(data.receivables))} ₽</b>
        </span>
        <span className={styles.debtsSep} aria-hidden>
          ·
        </span>
        <span className={styles.debtsText}>
          Мы должны <b>{fmt(Math.round(data.payables))} ₽</b>
        </span>
      </button>

      <div className={styles.actions}>
        {actions}
        <button
          type="button"
          className="admin-btn admin-btn--ghost"
          disabled={collecting}
          onClick={onCollectCash}
        >
          <Banknote size={15} aria-hidden />
          Сводка кассы
        </button>
      </div>
    </section>
  );
}

export interface WarehouseMobileBankData {
  bankBalance: number;
  bankIn: number;
  bankOut: number;
  bankForecast: number;
  cashBalance: number;
  cashNegative: boolean;
  cashPrevDays: number;
  cashOpening: number;
  cashTodayNet: number;
  ymBalance: number;
  ymIn: number;
  ymOut: number;
  ymForecast: number;
  rentBalance: number;
  rentToPay: number;
  totalForecast: number;
  totalForecastWithRent: number;
}

/**
 * Мобильная замена десктопного bank-hero на вкладке «Банк»: те же цифры
 * (ожидания и прогнозы по каждому счёту), но компактными строками.
 * Кнопки «Сводка кассы» и калькулятора живут в hero выше.
 */
export function WarehouseMobileBankDetails({
  data,
  onOpenYm,
}: {
  data: WarehouseMobileBankData;
  onOpenYm: () => void;
}) {
  return (
    <section className={styles.bank} aria-label="Детали по счетам">
      <div className={styles.bankRow}>
        <div className={styles.bankTop}>
          <span className={styles.bankName}>
            <CreditCard size={15} aria-hidden /> Расчётный счёт
          </span>
          <strong className={styles.bankValue}>
            {fmt(Math.round(data.bankBalance))} ₽
          </strong>
        </div>
        <div className={styles.bankSub}>
          ожидаем <b className={styles.pos}>+{fmt(Math.round(data.bankIn))}</b>
          {" · "}к оплате{" "}
          <b className={styles.neg}>−{fmt(Math.round(data.bankOut))}</b>
          {" → "}прогноз <b>{fmt(Math.round(data.bankForecast))} ₽</b>
        </div>
      </div>

      <div className={styles.bankRow}>
        <div className={styles.bankTop}>
          <span className={styles.bankName}>
            <Banknote size={15} aria-hidden /> Касса
          </span>
          <strong
            className={
              data.cashNegative
                ? `${styles.bankValue} ${styles.negative}`
                : styles.bankValue
            }
          >
            {fmt(Math.round(data.cashBalance))} ₽
          </strong>
        </div>
        <div className={styles.bankSub}>
          с прошлых дней <b>{fmt(Math.round(data.cashPrevDays))}</b>
          {" · "}на начало дня <b>{fmt(Math.round(data.cashOpening))}</b>
          {" · "}сегодня{" "}
          <b>
            {data.cashTodayNet >= 0 ? "+" : ""}
            {fmt(Math.round(data.cashTodayNet))} ₽
          </b>
        </div>
      </div>

      <div className={styles.bankRow}>
        <div className={styles.bankTop}>
          <span className={styles.bankName}>
            <CreditCard size={15} aria-hidden /> Карта ЮМ
          </span>
          <strong className={styles.bankValue}>
            {fmt(Math.round(data.ymBalance))} ₽
          </strong>
        </div>
        <div className={styles.bankSub}>
          ожидаем <b className={styles.pos}>+{fmt(Math.round(data.ymIn))}</b>
          {" · "}к оплате <b className={styles.neg}>−{fmt(Math.round(data.ymOut))}</b>
          {" → "}прогноз <b>{fmt(Math.round(data.ymForecast))} ₽</b>{" "}
          <button
            type="button"
            className={styles.bankLink}
            onClick={onOpenYm}
          >
            Открыть карту ЮМ
          </button>
        </div>
      </div>

      <div className={styles.bankRow}>
        <div className={styles.bankTop}>
          <span className={styles.bankName}>
            <Wallet size={15} aria-hidden /> Аренда · отдельный счёт
          </span>
          <strong className={styles.bankValue}>
            {fmt(Math.round(data.rentBalance))} ₽
          </strong>
        </div>
        <div className={styles.bankSub}>
          к оплате <b className={styles.neg}>−{fmt(Math.round(data.rentToPay))} ₽</b>
          {" · "}не списывает р/с
        </div>
      </div>

      <div className={styles.bankFoot}>
        Общий прогноз <b>{fmt(Math.round(data.totalForecast))} ₽</b>
        {" · "}с арендой{" "}
        <b>{fmt(Math.round(data.totalForecastWithRent))} ₽</b>
      </div>
    </section>
  );
}

export interface WarehouseMobileNavItem {
  key: string;
  label: string;
  icon: ReactNode;
  /** Короткая строка статистики под названием. */
  stat?: string;
  /** Красный счётчик «требует внимания». */
  badge?: number;
}

export function WarehouseMobileNav({
  items,
  activeKey,
  onSelect,
}: {
  items: WarehouseMobileNavItem[];
  activeKey: string;
  onSelect: (key: string) => void;
}) {
  return (
    <nav className={styles.nav} aria-label="Разделы учёта">
      {items.map((item) => {
        const active = item.key === activeKey;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onSelect(item.key)}
            className={active ? styles.tileActive : styles.tile}
            aria-current={active ? "page" : undefined}
          >
            <span className={styles.tileTop}>
              <span className={styles.tileIcon} aria-hidden>
                {item.icon}
              </span>
              <span className={styles.tileLabel}>{item.label}</span>
              {item.badge != null && item.badge > 0 && (
                <span className={styles.badge}>
                  {item.badge > 99 ? "99+" : item.badge}
                </span>
              )}
            </span>
            {item.stat != null && item.stat !== "" && (
              <span className={styles.tileStat}>{item.stat}</span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
