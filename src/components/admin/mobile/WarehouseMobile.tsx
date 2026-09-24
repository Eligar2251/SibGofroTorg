"use client";

// =========================================================
// FILE: src/components/admin/mobile/WarehouseMobile.tsx
// Мобильный учёт: простая шапка быстрых действий + сетка вкладок.
// Рендерится ТОЛЬКО когда useIsMobile() === true (ветка в
// WarehouseManager) — на десктопе этих узлов нет в DOM вообще.
// =========================================================

import { useState, type ReactNode } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  BarChart3,
  Calculator,
  ChevronRight,
  CreditCard,
  History,
  Landmark,
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
        <span className={styles.simpleTitle} title="СибГофроТорг · гофротара">
          <Wallet size={18} aria-hidden /> Учёт СибГофроТорг
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
  /** Вторая карта — В.М.: свой баланс и свой прогноз. */
  vmBalance: number;
  vmIn: number;
  vmOut: number;
  vmForecast: number;
  /** Все деньги сейчас: р/с + касса + карты ЮМ и В.М. */
  totalBalance: number;
  /** Общий прогноз после всех ожидаемых оплат. */
  totalForecast: number;
  /** Должны нам (покупатели). */
  receivables: number;
  /** Мы должны (поставщикам). */
  payables: number;
  /** Платёжек р/с, которые ещё не проведены (ожидают оплаты). */
  pendingCount: number;
  /** Дата в шапке карточки («21 сентября»). */
  dateLabel: string;
}

/** Подвкладки банка, которые открываются тапом по счёту. */
export type WarehouseMobileBankSub =
  | "summary"
  | "pending"
  | "history"
  | "cash"
  | "ym"
  | "vm";

const r0 = (n: number) => fmt(Math.round(n));

function BankChip({
  tone,
  children,
}: {
  tone?: "pos" | "neg" | "gold";
  children: ReactNode;
}) {
  const cls =
    tone === "pos"
      ? `${styles.chip} ${styles.chipPos}`
      : tone === "neg"
        ? `${styles.chip} ${styles.chipNeg}`
        : tone === "gold"
          ? `${styles.chip} ${styles.chipGold}`
          : styles.chip;
  return <span className={cls}>{children}</span>;
}

type AccountTone = "bank" | "cash" | "ym" | "vm";

function BankAccount({
  icon,
  name,
  value,
  tone,
  negative,
  hint,
  onOpen,
  children,
}: {
  icon: ReactNode;
  name: string;
  value: number;
  /** Цвет плитки иконки и суммы — как у счетов в десктопном hero. */
  tone: AccountTone;
  negative?: boolean;
  /** Что откроется по тапу — для aria-label. */
  hint: string;
  onOpen: () => void;
  children: ReactNode;
}) {
  const iconCls =
    tone === "bank"
      ? `${styles.accIcon} ${styles.accIconBank}`
      : tone === "ym"
        ? `${styles.accIcon} ${styles.accIconYm}`
        : tone === "vm"
          ? `${styles.accIcon} ${styles.accIconVm}`
          : `${styles.accIcon} ${styles.accIconCash}`;
  const valueCls = negative
    ? `${styles.accValue} ${styles.accValueNeg}`
    : tone === "ym"
      ? `${styles.accValue} ${styles.accValueYm}`
      : tone === "vm"
        ? `${styles.accValue} ${styles.accValueVm}`
        : styles.accValue;
  return (
    <button
      type="button"
      className={styles.acc}
      onClick={onOpen}
      aria-label={`${name}: ${r0(value)} ₽. ${hint}`}
    >
      <span className={iconCls} aria-hidden>
        {icon}
      </span>
      <span className={styles.accName}>{name}</span>
      <strong className={valueCls}>{r0(value)} ₽</strong>
      <ChevronRight size={16} className={styles.accArrow} aria-hidden />
      <span className={styles.accChips}>{children}</span>
    </button>
  );
}

const BANK_SUBS: {
  key: WarehouseMobileBankSub;
  label: string;
  icon: ReactNode;
  tone: "kraft" | "steel" | "ym" | "vm" | "pine" | "indigo";
}[] = [
  { key: "pending", label: "Ожидают", icon: <Wallet size={20} />, tone: "kraft" },
  { key: "history", label: "История", icon: <History size={20} />, tone: "steel" },
  { key: "ym", label: "Карта ЮМ", icon: <CreditCard size={20} />, tone: "ym" },
  { key: "vm", label: "Карта В.М.", icon: <CreditCard size={20} />, tone: "vm" },
  { key: "cash", label: "Касса", icon: <Banknote size={20} />, tone: "pine" },
  { key: "summary", label: "Сводка", icon: <BarChart3 size={20} />, tone: "indigo" },
];

const SUB_TONE_CLASS: Record<(typeof BANK_SUBS)[number]["tone"], string> = {
  kraft: styles.subIconKraft,
  steel: styles.subIconSteel,
  ym: styles.subIconYm,
  vm: styles.subIconVm,
  pine: styles.subIconPine,
  indigo: styles.subIconIndigo,
};

/**
 * Мобильный банк учёта СГТ — по расположению как мобильный баланс
 * макулатуры (карточка баланса → ряд действий → сводка строками →
 * свёрнутый прогноз), а по цветам как десктопный bank-hero: графит
 * с сосновым отливом, зелёный приход, коралловый расход, золото ЮМ.
 *
 *  1. Тёмная карточка: «Деньги СГТ» + дата, крупный итог, прогноз,
 *     ниже три счёта (р/с, касса, карта ЮМ) строками с чипами —
 *     тап по счёту открывает его список.
 *  2. Ряд плиток-подвкладок (Ожидают · История · ЮМ · Касса · Сводка)
 *     — замена десктопной строки admin-filters, которая на телефоне
 *     скрыта (см. admin-warehouse-mobile.css).
 *  3. Светлая карточка-сводка: нам должны / мы должны / ожидают
 *     проведения; долги по контрагентам раскрываются тут же.
 *  4. Прогноз движения денег — <details>, чтобы не занимать экран.
 */
export function WarehouseMobileBankDetails({
  data,
  sub,
  onOpenSub,
  debts,
}: {
  data: WarehouseMobileBankData;
  /** Активная подвкладка — подсветка плитки. */
  sub: WarehouseMobileBankSub;
  onOpenSub: (sub: WarehouseMobileBankSub) => void;
  /** Списки «Покупатели должны нам / Поставщики — мы должны» (.bank-due). */
  debts?: ReactNode;
}) {
  const [debtsOpen, setDebtsOpen] = useState(false);
  const todaySign = data.cashTodayNet >= 0 ? "+" : "−";
  return (
    <section className={styles.bank} aria-label="Деньги и счета">
      {/* 1. Карточка баланса — тёмная, как десктопный hero */}
      <div className={styles.bankHero}>
        <div className={styles.bankHeroHead}>
          <span className={styles.bankHeroTitle}>
            <Wallet size={16} aria-hidden /> Деньги СибГофроТорг
          </span>
          <span className={styles.bankHeroDate}>{data.dateLabel}</span>
        </div>
        <strong className={styles.bankHeroValue}>{r0(data.totalBalance)} ₽</strong>
        <div className={styles.bankHeroForecast}>
          <span>р/с + касса + карта ЮМ</span>
          <span className={styles.bankHeroForecastVal}>
            прогноз <b>{r0(data.totalForecast)} ₽</b>
          </span>
        </div>

        <div className={styles.accounts}>
          <BankAccount
            icon={<Landmark size={17} />}
            name="Расчётный счёт"
            value={data.bankBalance}
            tone="bank"
            hint="Открыть платежи, которые ожидают оплаты"
            onOpen={() => onOpenSub("pending")}
          >
            <BankChip tone="pos">+{r0(data.bankIn)} ожидаем</BankChip>
            <BankChip tone="neg">−{r0(data.bankOut)} к оплате</BankChip>
            <BankChip tone="gold">→ {r0(data.bankForecast)} ₽</BankChip>
          </BankAccount>

          <BankAccount
            icon={<Banknote size={17} />}
            name="Касса"
            value={data.cashBalance}
            tone="cash"
            negative={data.cashNegative}
            hint="Открыть кассу"
            onOpen={() => onOpenSub("cash")}
          >
            <BankChip>с прошлых дней {r0(data.cashPrevDays)}</BankChip>
            <BankChip>на начало дня {r0(data.cashOpening)}</BankChip>
            <BankChip tone={data.cashTodayNet >= 0 ? "pos" : "neg"}>
              сегодня {todaySign}
              {r0(Math.abs(data.cashTodayNet))}
            </BankChip>
          </BankAccount>

          <BankAccount
            icon={<CreditCard size={17} />}
            name="Карта ЮМ"
            value={data.ymBalance}
            tone="ym"
            hint="Открыть карту ЮМ"
            onOpen={() => onOpenSub("ym")}
          >
            <BankChip tone="pos">+{r0(data.ymIn)} ожидаем</BankChip>
            <BankChip tone="neg">−{r0(data.ymOut)} к оплате</BankChip>
            <BankChip tone="gold">→ {r0(data.ymForecast)} ₽</BankChip>
          </BankAccount>

          <BankAccount
            icon={<CreditCard size={17} />}
            name="Карта В.М."
            value={data.vmBalance}
            tone="vm"
            hint="Открыть карту В.М."
            onOpen={() => onOpenSub("vm")}
          >
            <BankChip tone="pos">+{r0(data.vmIn)} ожидаем</BankChip>
            <BankChip tone="neg">−{r0(data.vmOut)} к оплате</BankChip>
            <BankChip tone="gold">→ {r0(data.vmForecast)} ₽</BankChip>
          </BankAccount>
        </div>
      </div>

      {/* 2. Подвкладки банка — ряд плиток, как действия в макулатуре */}
      <div className={styles.subs} role="tablist" aria-label="Разделы банка">
        {BANK_SUBS.map((item) => {
          const active = item.key === sub;
          const badge = item.key === "pending" ? data.pendingCount : 0;
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={active}
              className={active ? `${styles.sub} ${styles.subActive}` : styles.sub}
              onClick={() => onOpenSub(item.key)}
            >
              <span className={`${styles.subIcon} ${SUB_TONE_CLASS[item.tone]}`} aria-hidden>
                {item.icon}
                {badge > 0 && (
                  <span className={styles.subBadge}>{badge > 99 ? "99+" : badge}</span>
                )}
              </span>
              <span className={styles.subLabel}>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* 3. Сводка строками: долги и очередь платежей */}
      <div className={styles.summary}>
        <button
          type="button"
          className={styles.row}
          aria-expanded={debtsOpen}
          onClick={() => setDebtsOpen((v) => !v)}
        >
          <span className={`${styles.rowIcon} ${styles.rowIconPos}`} aria-hidden>
            <ArrowDownLeft size={17} />
          </span>
          <span className={styles.rowText}>
            <span className={styles.rowLabel}>Нам должны</span>
            <span className={styles.rowHint}>покупатели · по контрагентам</span>
          </span>
          <strong className={`${styles.rowValue} ${styles.rowValuePos}`}>
            +{r0(data.receivables)} ₽
          </strong>
          <ChevronRight
            size={16}
            className={debtsOpen ? `${styles.rowArrow} ${styles.rowArrowOpen}` : styles.rowArrow}
            aria-hidden
          />
        </button>
        <button
          type="button"
          className={styles.row}
          aria-expanded={debtsOpen}
          onClick={() => setDebtsOpen((v) => !v)}
        >
          <span className={`${styles.rowIcon} ${styles.rowIconNeg}`} aria-hidden>
            <ArrowUpRight size={17} />
          </span>
          <span className={styles.rowText}>
            <span className={styles.rowLabel}>Мы должны</span>
            <span className={styles.rowHint}>поставщикам · по контрагентам</span>
          </span>
          <strong className={`${styles.rowValue} ${styles.rowValueNeg}`}>
            −{r0(data.payables)} ₽
          </strong>
          <ChevronRight
            size={16}
            className={debtsOpen ? `${styles.rowArrow} ${styles.rowArrowOpen}` : styles.rowArrow}
            aria-hidden
          />
        </button>
        {debtsOpen && debts && <div className={styles.debtsBody}>{debts}</div>}
        <button
          type="button"
          className={styles.row}
          onClick={() => onOpenSub("pending")}
        >
          <span className={`${styles.rowIcon} ${styles.rowIconKraft}`} aria-hidden>
            <Wallet size={17} />
          </span>
          <span className={styles.rowText}>
            <span className={styles.rowLabel}>Ожидают проведения</span>
            <span className={styles.rowHint}>платёжки р/с без отметки «оплачено»</span>
          </span>
          <strong className={styles.rowValue}>{data.pendingCount}</strong>
          <ChevronRight size={16} className={styles.rowArrow} aria-hidden />
        </button>
      </div>

      {/* 4. Прогноз — свёрнут, как в макулатуре */}
      <details className={styles.forecast}>
        <summary className={styles.forecastSummary}>
          <span>Прогноз движения денег</span>
          <b>{r0(data.totalForecast)} ₽</b>
        </summary>
        <dl className={styles.forecastList}>
          <div>
            <dt>Р/С после всех оплат</dt>
            <dd>
              {r0(data.bankBalance)} <i>+{r0(data.bankIn)}</i> <u>−{r0(data.bankOut)}</u> ={" "}
              <b>{r0(data.bankForecast)} ₽</b>
            </dd>
          </div>
          <div>
            <dt>Касса · факт, в прогноз р/с не входит</dt>
            <dd>
              <b className={data.cashNegative ? styles.negative : undefined}>{r0(data.cashBalance)} ₽</b>
              {" · "}сегодня {todaySign}
              {r0(Math.abs(data.cashTodayNet))}
            </dd>
          </div>
          <div>
            <dt>Карта ЮМ после оплат</dt>
            <dd>
              {r0(data.ymBalance)} <i>+{r0(data.ymIn)}</i> <u>−{r0(data.ymOut)}</u> ={" "}
              <b className={styles.gold}>{r0(data.ymForecast)} ₽</b>
            </dd>
          </div>
          <div>
            <dt>Всего после всех оплат</dt>
            <dd>
              р/с {r0(data.bankForecast)} + касса {r0(data.cashBalance)} + ЮМ {r0(data.ymForecast)} ={" "}
              <b>{r0(data.totalForecast)} ₽</b>
            </dd>
          </div>
        </dl>
      </details>
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
