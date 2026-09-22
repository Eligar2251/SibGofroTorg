// =========================================================
// FILE: src/lib/salary-scope.ts
// «Область» таблицы зарплат: один и тот же компонент WarehouseSalaries
// работает в двух модулях:
//   · sgt — раздел «Зарплаты» учёта СибГофроТорг (касса, карта ЮМ,
//     аренда, макулатура-наличные);
//   · wastepaper — вкладка «Зарплаты» модуля «Учёт макулатура»: только
//     счета макулатуры — наличка, безнал и сторонние средства (с пометкой,
//     откуда пришли деньги).
// Обе области пишут в общую таблицу salaries; записи макулатуры несут тег
// [Макулатура] и не трогают балансы учёта СибГофроТорг. Настройки таблицы
// (планы, долги, календарь, график) хранятся под своим префиксом, чтобы
// планы одного модуля не смешивались с планами другого.
// Файл без server-only зависимостей — безопасен для клиента.
// =========================================================

import type { SalarySource } from "./warehouse-shared";

export type SalaryScopeKind = "sgt" | "wastepaper";

export interface SalaryScope {
  kind: SalaryScopeKind;
  /** Базовый URL API зарплат: POST на него, PATCH/DELETE на `${salariesApi}/${id}`. */
  salariesApi: string;
  /** Базовый URL API сотрудников: POST на него, PUT/DELETE на `${employeesApi}/${id}`. */
  employeesApi: string;
  /** API настроек таблицы (GET всех доступных ключей / PUT части). */
  settingsApi: string;
  /** Префикс ключей настроек: `${prefix}plan_…`, `${prefix}debt_…` и т.д. */
  settingsPrefix: string;
  /** Счёт по умолчанию для быстрых выплат и плановых дат. */
  defaultSource: SalarySource;
}

export const SGT_SALARY_SCOPE: SalaryScope = {
  kind: "sgt",
  salariesApi: "/api/admin/warehouse/salaries",
  employeesApi: "/api/admin/warehouse/employees",
  settingsApi: "/api/admin/settings",
  settingsPrefix: "salary_",
  defaultSource: "cash",
};

export const WASTEPAPER_SALARY_SCOPE: SalaryScope = {
  kind: "wastepaper",
  salariesApi: "/api/admin/wp/salaries",
  employeesApi: "/api/admin/wp/employees",
  settingsApi: "/api/admin/wp/settings",
  settingsPrefix: "wp_salary_",
  defaultSource: "wastepaper",
};
