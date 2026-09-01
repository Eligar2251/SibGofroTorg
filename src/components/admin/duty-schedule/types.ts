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

/**
 * Начисление зп за период: один человек и его итоговая сумма.
 * Список начислений — «кто вообще получает зп за этот месяц»:
 * человек может быть в табеле, но не в зп (и наоборот).
 */
export interface SalaryAccrual {
  /** Уникальный ключ строки: id сотрудника табеля или «acc_…». */
  id: string;
  /** id сотрудника из табеля либо 'custom' (введён вручную). */
  employeeId: string;
  employeeName: string;
  /** Ручная итоговая сумма зп, ₽. null — считать по табелю
   *  (часы × ставка базового месяца, с учётом сдвига). */
  amount: number | null;
}

/** [зарплатный период YYYY-MM] -> начисления. */
export type SalaryAccrualsByPeriod = Record<string, SalaryAccrual[]>;

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
