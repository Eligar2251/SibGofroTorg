"use client";

// =========================================================
// FILE: src/components/admin/mobile/WarehouseMobile.tsx
// Мобильный учёт: простая шапка быстрых действий + сетка вкладок.
// Рендерится ТОЛЬКО когда useIsMobile() === true (ветка в
// WarehouseManager) — на десктопе этих узлов нет в DOM вообще.
// =========================================================

import type { ReactNode } from "react";
import {
  Banknote,
  Calculator,
  CreditCard,
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
  onCalculator,
  onCollectCash,
  collecting,
}: {
  /** Кнопки-триггеры ReceiptForm / DealForm / PaymentForm. */
  actions: ReactNode;
  data: WarehouseMobileHeroData;
  onCalculator: () => void;
  onCollectCash: () => void;
  collecting: boolean;
}) {
  // Главная учёта — просто стиль мобильного приложения, а не буквальный
  // банковский дашборд. Балансы (счёт/касса/карта ЮМ) и долги живут
  // только на отдельной вкладке «Банк» (WarehouseMobileBankDetails).
  // Здесь — компактная шапка с датой, калькулятором и быстрыми
  // действиями, без крупных сумм.
  return (
    <section className={styles.hero} aria-label="Быстрые действия">
      <div className={styles.simpleHead}>
        <span className={styles.simpleTitle}>
          <Wallet size={18} aria-hidden /> Учёт
        </span>
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
