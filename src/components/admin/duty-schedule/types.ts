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

/**
 * Полный рабочий снимок модуля табелей.
 *
 * Он хранится одной защищённой JSONB-записью в Supabase. Такой формат важен
 * для автосохранения: повторная генерация месяца и любая ручная правка не
 * создают дубликаты, а атомарно обновляют уже существующий снимок.
 */
export interface DutyScheduleStoredState {
  employees: Employee[];
  schedules: Record<string, DayAssignment[]>;
  /** Ручные суммы месяца табеля: [YYYY-MM] -> [employeeId] -> сумма. */
  amountOverrides: Record<string, Record<string, number>>;
  /** Старый формат планов выплат — оставлен только для миграции данных. */
  payPlans?: PayPlans;
  /** [зарплатный месяц YYYY-MM] -> выплаты по дням. */
  salaryPayouts?: SalaryPayoutsByPeriod;
  /** Редактируемый заголовок таблицы выплат: [YYYY-MM] -> текст. */
  payoutTitles?: Record<string, string>;
  /** [зарплатный месяц YYYY-MM] -> начисления (кто и сколько). */
  salaryAccruals?: SalaryAccrualsByPeriod;
}

/** Снимок, который API читает и сохраняет в базе данных. */
export interface DutyScheduleSnapshot {
  state: DutyScheduleStoredState;
  /** Сколько месяцев назад брать табель только для блока выплат: 0 / 1 / 2. */
  payOffset: number;
  updatedAt?: string | null;
  /** Отпечаток содержимого (см. lib/duty-schedule-hash). Может быть пустым
   *  у баз, где миграция истории ещё не применена. */
  hash?: string | null;
}

/** Итоги одного зарплатного месяца внутри сохранённой версии. */
export interface DutyScheduleRevisionPeriod {
  /** 'YYYY-MM' — зарплатный месяц. */
  month: string;
  /** Сколько человек в начислении. */
  people: number;
  /** Итого начислено, ₽ (ручные суммы и расчёт по табелю). */
  accrualTotal: number;
  /** Сколько строк выплат с суммой больше нуля. */
  payoutRows: number;
  /** Итого выплат, ₽. */
  payoutTotal: number;
}

/** Краткая сводка сохранённой версии — показывается в списке истории. */
export interface DutyScheduleRevisionSummary {
  /** Сотрудников всего / активных. */
  employees: number;
  activeEmployees: number;
  /** Сколько месяцев охватывает снимок. */
  months: number;
  firstMonth: string | null;
  lastMonth: string | null;
  /** Смен с назначенным охранником за все месяцы. */
  scheduleDays: number;
  /** Последние зарплатные месяцы (не больше трёх). */
  periods: DutyScheduleRevisionPeriod[];
}

/** Строка списка истории версий табеля. */
export interface DutyScheduleRevisionMeta {
  id: number;
  /** Когда версия впервые сохранена (ISO). */
  createdAt: string;
  /** Когда версия последний раз обновлялась (ISO). */
  updatedAt: string;
  /** Кто сохранил (логин администратора). */
  createdBy: string | null;
  /** Пометка: ручное восстановление, перенос и т.п. */
  note: string | null;
  /** Отпечаток содержимого версии. */
  hash: string;
  summary: DutyScheduleRevisionSummary | null;
}

/** Полный снимок одной сохранённой версии (для просмотра и отката). */
export interface DutyScheduleRevisionSnapshot extends DutyScheduleSnapshot {
  id: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  note: string | null;
}

/** Ответ API истории: список версий + признак, доступна ли история. */
export interface DutyScheduleHistoryResponse {
  revisions: DutyScheduleRevisionMeta[];
  /** Отпечаток текущего (рабочего) снимка — им помечается актуальная версия. */
  currentHash: string | null;
  /** false — таблица истории ещё не создана (нужна миграция). */
  historyEnabled: boolean;
  /** Подсказка, если история недоступна. */
  hint?: string | null;
}

export type DutyScheduleSaveStatus =
  | "loading"
  | "idle"
  | "saving"
  | "saved"
  | "error";
