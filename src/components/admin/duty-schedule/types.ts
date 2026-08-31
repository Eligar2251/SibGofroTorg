// =========================================================
// FILE: src/components/admin/duty-schedule/types.ts
// Типы табеля дежурств охраны.
// =========================================================

export type CellStatus = "normal" | "missed" | "temporary";
export type EmployeeRole = "fixed" | "rotating";

export interface FixedRule {
  /** 0 - Вс, 1 - Пн, 2 - Вт, 3 - Ср, 4 - Чт, 5 - Пт, 6 - Сб */
  weekday: number;
  /** Сколько часов длится смена в этот день недели */
  hours: number;
}

export interface Employee {
  id: string;
  name: string;
  phone?: string;
  /** Ставка руб/час */
  rate: number;
  /** fixed - жёстко закреплённые дни, rotating - по очереди */
  role: EmployeeRole;
  /** Используется только если role === 'fixed' */
  fixedRules?: FixedRule[];
  active: boolean;
}

export interface DayAssignment {
  /** 'YYYY-MM-DD' */
  date: string;
  /** 0..6 */
  weekday: number;
  employeeId: string | null;
  hours: number;
  status: CellStatus;
}

export interface GenerationOptions {
  rotatingStartEmployeeId?: string;
}

export interface PayrollItem {
  employeeId: string;
  employeeName: string;
  totalHours: number;
  amount: number;
}

export interface PayrollPayload {
  /** Период зарплаты (как пишет пользователь). */
  year: number;
  /** 1-12 — месяц, за который переносится зарплата. */
  month: number;
  /** Календарный месяц фактических смен (период − сдвиг). */
  calYear?: number;
  calMonth?: number;
  items: PayrollItem[];
  totalAmount: number;
  generatedAt: string;
}

/**
 * Отдельная выплата зарплаты (один день выплаты для сотрудника).
 * У одного сотрудника может быть несколько выплат за месяц (разбивка зп по дням).
 * Каждый элемент списка — это отдельная выплата со своим днём, суммой и сотрудником.
 */
export interface SalaryPayout {
  id: string;
  employeeId: string;
  employeeName: string;
  /** 'YYYY-MM-DD' — день выплаты (указывает пользователь). */
  date: string;
  /** Сумма выплаты, ₽. */
  amount: number;
  /** Примечание / комментарий (например, «Аванс», «Окончательный расчёт», «Выплата 1»). */
  comment?: string;
}

/** [зарплатный месяц YYYY-MM] -> список выплат по дням. */
export type SalaryPayoutsByPeriod = Record<string, SalaryPayout[]>;

/**
 * План выплаты по сотруднику (для обратной совместимости со старыми записями):
 * [зарплатный месяц YYYY-MM] -> [employeeId] -> план выплаты.
 */
export interface PayPlanEntry {
  /** 'YYYY-MM-DD' — день выплаты (указывает пользователь). */
  date?: string;
  /** Сумма, ₽. null/отсутствует — считается по табелю (часы × ставка). */
  amount?: number;
}

/** [зарплатный месяц YYYY-MM] -> [employeeId] -> план выплаты. */
export type PayPlans = Record<string, Record<string, PayPlanEntry>>;

/** Запись зарплаты, уже перенесённой из табеля (для защиты от дублей). */
export interface ExistingSalaryTransfer {
  periodMonth: string;
  employeeName: string;
  amount: number;
  comment: string | null;
}
