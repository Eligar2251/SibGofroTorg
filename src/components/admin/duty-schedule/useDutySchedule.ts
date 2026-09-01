// =========================================================
// FILE: src/components/admin/duty-schedule/useDutySchedule.ts
// Хук табеля дежурств охраны: состояние, генерация, редактирование.
//
// МЕСЯЦ НАВИГАЦИИ = МЕСЯЦ ТАБЕЛЯ: сетка всегда показывает выбранный
// месяц — числа и календарь именно его (сдвиг сетки не делается).
//
// ЗАРПЛАТА — ОТДЕЛЬНАЯ СИСТЕМА с вариантами расчёта (сдвиг):
//   • «месяц в месяц»    — зп за месяц M считается по табелю M;
//   • «прошлый месяц»    — зп за M по табелю M−1 (смена графика
//     сентября → зп за октябрь считается по сентябрю);
//   • «два месяца назад» — зп за M по табелю M−2.
// Сдвиг влияет ТОЛЬКО на нижний блок начислений и выплат: сетка
// табеля не сдвигается, а печать показывает зарплату именно за
// календарный месяц табеля.
//
// Начисления (кто и сколько) и выплаты (дни/суммы) задаёт
// пользователь: итоговые суммы можно менять руками, людей —
// убирать из зп (в табеле они остаются) и добавлять любых, даже
// не из табеля. Выплат у человека — любое число (хоть каждый
// день). Весь снимок автоматически сохраняется в Supabase;
// localStorage остаётся резервом и источником одноразового переноса
// старых данных в БД.
// =========================================================

"use client";

import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import {
  Employee,
  DayAssignment,
  CellStatus,
  DutyScheduleSaveStatus,
  DutyScheduleSnapshot,
  DutyScheduleStoredState,
  SalaryAccrual,
  SalaryPayout,
  SalaryPayoutsByPeriod,
} from "./types";
import {
  generateSchedule,
  fillMissingDays,
  getNextRotationStartId,
  daysInMonth,
} from "./scheduleGenerator";

const STORAGE_KEY = "duty_schedule_v2";
const LEGACY_STORAGE_KEY = "duty_schedule_v1";
const LEGACY_OFFSET_KEY = "duty_schedule_offset_v1";
const OFFSET_KEY = "duty_schedule_offset_v2";

type StoredState = DutyScheduleStoredState;

// Данные по умолчанию — воспроизводят пример из табеля заказчика:
// Олейников закреплён за вторником (15ч) и субботой (24ч, смена пт→сб),
// остальные дни чередуются между Ждановым и Хухоревым.
const defaultEmployees: Employee[] = [
  {
    id: "zhdanov",
    name: "Жданов Сергей",
    phone: "953 781 80 82",
    rate: 115,
    role: "rotating",
    active: true,
  },
  {
    id: "oleynikov",
    name: "Олейников Дмитрий",
    phone: "953 807 65 59",
    rate: 115,
    role: "fixed",
    active: true,
    fixedRules: [
      { weekday: 2, hours: 15 }, // Вторник 15ч
      { weekday: 6, hours: 24 }, // Суббота 24ч
    ],
  },
  {
    id: "huhorev",
    name: "Хухорев Василий",
    phone: "913 471 49 62",
    rate: 115,
    role: "rotating",
    active: true,
  },
];

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function lastDayOfMonth(year: number, month: number): string {
  const d = daysInMonth(year, month);
  return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Сдвиг месяца на delta (может быть отрицательным). */
function shiftMonth(
  year: number,
  month: number,
  delta: number
): { year: number; month: number } {
  const d = new Date(year, month - 1 + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

/** Выплата принадлежит этому человеку? Из табеля — по id,
 *  введённый вручную — по имени. */
function isSamePayoutPerson(
  payout: { employeeId: string; employeeName: string },
  person: { employeeId: string; employeeName: string }
): boolean {
  if (
    person.employeeId &&
    person.employeeId !== "custom" &&
    payout.employeeId === person.employeeId
  ) {
    return true;
  }
  const name = person.employeeName.trim().toLowerCase();
  return (
    name.length > 0 &&
    payout.employeeName.trim().toLowerCase() === name
  );
}

function readStored(key: string): Partial<StoredState> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<StoredState>;
  } catch {
    return null;
  }
}

/** Сдвиг расчёта зп: 0/1/2 месяца (сколько месяцев назад табель).
 *  По умолчанию 1 — работаем так, что сотрудник получает зп за
 *  предыдущий месяц в текущий месяц. Значение сохраняется. */
function loadOffset(): number {
  try {
    const raw = localStorage.getItem(OFFSET_KEY);
    if (raw !== null) {
      const n = Number(raw);
      if (n === 0 || n === 1 || n === 2) return n;
    }
  } catch {
    /* ignore */
  }
  return 1;
}

function createFallbackState(): StoredState {
  return {
    employees: defaultEmployees.map((employee) => ({ ...employee })),
    schedules: {},
    amountOverrides: {},
    salaryPayouts: {},
    salaryAccruals: {},
    payPlans: {},
  };
}

/** Приводит снимок из localStorage/БД к актуальному формату. */
function normalizeStoredState(source?: Partial<StoredState> | null): StoredState {
  if (!source) return createFallbackState();

  const emps = Array.isArray(source.employees)
    ? source.employees
    : defaultEmployees.map((employee) => ({ ...employee }));
  const payouts: SalaryPayoutsByPeriod =
    source.salaryPayouts && typeof source.salaryPayouts === "object"
      ? { ...source.salaryPayouts }
      : {};

  // Миграция старых payPlans в salaryPayouts, если новых записей ещё нет.
  if (source.payPlans && Object.keys(source.payPlans).length > 0) {
    for (const [periodKey, empMap] of Object.entries(source.payPlans)) {
      if (!payouts[periodKey] && empMap && Object.keys(empMap).length > 0) {
        const list: SalaryPayout[] = [];
        const [y, m] = periodKey.split("-").map(Number);
        const defDate = y && m ? lastDayOfMonth(y, m) : `${periodKey}-25`;
        for (const [empId, entry] of Object.entries(empMap)) {
          if (!entry) continue;
          const empName = emps.find((e) => e.id === empId)?.name || empId;
          list.push({
            id: `pay_${periodKey}_${empId}_legacy`,
            employeeId: empId,
            employeeName: empName,
            date: entry.date || defDate,
            amount: entry.amount ?? 0,
            comment: "",
          });
        }
        if (list.length > 0) payouts[periodKey] = list;
      }
    }
  }

  return {
    employees: emps,
    schedules:
      source.schedules && typeof source.schedules === "object"
        ? source.schedules
        : {},
    amountOverrides:
      source.amountOverrides && typeof source.amountOverrides === "object"
        ? source.amountOverrides
        : {},
    salaryPayouts: payouts,
    salaryAccruals:
      source.salaryAccruals && typeof source.salaryAccruals === "object"
        ? source.salaryAccruals
        : {},
    payPlans:
      source.payPlans && typeof source.payPlans === "object"
        ? source.payPlans
        : {},
  };
}

/** Читает старое локальное хранилище для одноразового переноса в БД. */
function loadState(): StoredState {
  const v2 = readStored(STORAGE_KEY);
  if (v2) return normalizeStoredState(v2);

  const legacy = readStored(LEGACY_STORAGE_KEY);
  if (!legacy) return createFallbackState();

  const state = normalizeStoredState({
    ...legacy,
    salaryPayouts: {},
    salaryAccruals: {},
  });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    localStorage.removeItem(LEGACY_OFFSET_KEY);
  } catch {
    /* localStorage недоступен */
  }
  return state;
}

/** Начисления по умолчанию: все активные охранники, сумма = расчёт
 *  по табелю (amount: null — «считать по табелю»). */
function defaultAccruals(employees: Employee[]): SalaryAccrual[] {
  return employees
    .filter((e) => e.active)
    .map((e) => ({
      id: e.id,
      employeeId: e.id,
      employeeName: e.name,
      amount: null,
    }));
}

/** Взять начисления периода (с подстановкой дефолтных, если ещё
 *  не задавались) — для записи в состояние. */
function accrualsToWrite(
  prev: StoredState,
  periodKey: string
): SalaryAccrual[] {
  return prev.salaryAccruals?.[periodKey] ?? defaultAccruals(prev.employees);
}

/** Часы сотрудника по расписанию (без «пропущенных» смен). */
function hoursInSchedule(
  schedule: DayAssignment[],
  employeeId: string
): number {
  return schedule
    .filter((d) => d.employeeId === employeeId && d.status !== "missed")
    .reduce((s, d) => s + (d.hours || 0), 0);
}

async function readDatabaseSnapshot(): Promise<DutyScheduleSnapshot | null> {
  const response = await fetch("/api/admin/duty-schedule", {
    method: "GET",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  const data = (await response.json().catch(() => ({}))) as {
    snapshot?: DutyScheduleSnapshot | null;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(data.error || "Не удалось загрузить табель из базы");
  }
  return data.snapshot ?? null;
}

function normalizedOffset(value: unknown): number {
  const n = Number(value);
  return n === 0 || n === 1 || n === 2 ? n : 1;
}

export function useDutySchedule(
  initialYear?: number,
  initialMonth?: number,
  initialSnapshot: DutyScheduleSnapshot | null = null,
  initialDatabaseError: string | null = null
) {
  const now = new Date();
  const initialState = normalizeStoredState(initialSnapshot?.state);
  const initialOffset = normalizedOffset(initialSnapshot?.payOffset);

  const [year, setYear] = useState(initialYear ?? now.getFullYear());
  const [month, setMonth] = useState(initialMonth ?? now.getMonth() + 1);
  const [payOffset, setPayOffsetState] = useState<number>(initialOffset);
  const [state, setState] = useState<StoredState>(initialState);
  const [message, setMessage] = useState<string | null>(null);

  // Если сервер уже прочитал запись, интерфейс готов сразу. При первой
  // установке сначала забираем прежний localStorage и переносим его в БД.
  const [storageReady, setStorageReady] = useState(Boolean(initialSnapshot));
  const [databaseEnabled, setDatabaseEnabled] = useState(
    !initialDatabaseError
  );
  const [saveStatus, setSaveStatus] = useState<DutyScheduleSaveStatus>(
    initialSnapshot ? "saved" : "loading"
  );
  const [saveError, setSaveError] = useState<string | null>(
    initialDatabaseError
  );
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(
    initialSnapshot?.updatedAt ?? null
  );

  const latestPayloadRef = useRef({ state: initialState, payOffset: initialOffset });
  const databaseEnabledRef = useRef(!initialDatabaseError);
  // true, если мы уже успешно прочитали БД (включая подтверждённо пустую)
  // и поэтому можем безопасно отправлять поверх неё текущий снимок.
  const canOverwriteDatabaseRef = useRef(
    Boolean(initialSnapshot) || !initialDatabaseError
  );
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const queuedRef = useRef(false);
  const dirtyRef = useRef(false);
  const versionRef = useRef(0);
  // Загруженный из БД снимок не нужно тут же отправлять обратно.
  const skipNextPersistenceRef = useRef(Boolean(initialSnapshot));

  const setDatabaseAvailability = useCallback((enabled: boolean) => {
    databaseEnabledRef.current = enabled;
    setDatabaseEnabled(enabled);
  }, []);

  const drainSaveQueue = useCallback(async () => {
    if (!databaseEnabledRef.current || !dirtyRef.current) return;
    if (savingRef.current) {
      queuedRef.current = true;
      return;
    }

    savingRef.current = true;
    try {
      do {
        queuedRef.current = false;
        const payload = latestPayloadRef.current;
        const savingVersion = versionRef.current;
        setSaveStatus("saving");
        setSaveError(null);

        const response = await fetch("/api/admin/duty-schedule", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = (await response.json().catch(() => ({}))) as {
          updatedAt?: string | null;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(data.error || "Не удалось сохранить табель в базе");
        }

        if (savingVersion === versionRef.current) {
          dirtyRef.current = false;
          setSaveStatus("saved");
          setLastSavedAt(data.updatedAt ?? new Date().toISOString());
        } else {
          // Пока шёл запрос, пользователь успел внести ещё одну правку.
          // Сохраняем новый снимок следом, строго после предыдущего запроса,
          // чтобы более старый ответ не мог перезаписать свежие данные.
          queuedRef.current = true;
          if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
          }
        }
      } while (queuedRef.current && databaseEnabledRef.current);
    } catch (error) {
      const text =
        error instanceof Error
          ? error.message
          : "Не удалось сохранить табель в базе";
      setSaveStatus("error");
      setSaveError(text);
      // После ошибки не спамим запросами на каждую клавишу. Кнопка
      // «Повторить» сначала безопасно перечитает БД.
      setDatabaseAvailability(false);
    } finally {
      savingRef.current = false;
    }
  }, [setDatabaseAvailability]);

  // Одноразовая инициализация: если сервер не смог прочитать БД,
  // повторяем GET из браузера. Только подтверждённо пустую БД заполняем
  // локальным снимком — так временная ошибка не затрёт существующий табель.
  useEffect(() => {
    if (initialSnapshot) return;
    let cancelled = false;

    const applyLocalState = (canSave: boolean, error?: string | null) => {
      if (cancelled) return;
      const localState = loadState();
      const localOffset = loadOffset();
      latestPayloadRef.current = { state: localState, payOffset: localOffset };
      if (canSave) canOverwriteDatabaseRef.current = true;
      setState(localState);
      setPayOffsetState(localOffset);
      setDatabaseAvailability(canSave);
      setStorageReady(true);
      setSaveStatus(canSave ? "idle" : "error");
      setSaveError(error || null);
    };

    if (!initialDatabaseError) {
      // Сервер успешно выяснил, что строки в таблице ещё нет.
      applyLocalState(true);
      return () => {
        cancelled = true;
      };
    }

    setSaveStatus("loading");
    void readDatabaseSnapshot()
      .then((snapshot) => {
        if (cancelled) return;
        if (!snapshot) {
          applyLocalState(true);
          return;
        }
        const loadedState = normalizeStoredState(snapshot.state);
        const loadedOffset = normalizedOffset(snapshot.payOffset);
        skipNextPersistenceRef.current = true;
        latestPayloadRef.current = {
          state: loadedState,
          payOffset: loadedOffset,
        };
        dirtyRef.current = false;
        canOverwriteDatabaseRef.current = true;
        setState(loadedState);
        setPayOffsetState(loadedOffset);
        setDatabaseAvailability(true);
        setLastSavedAt(snapshot.updatedAt ?? null);
        setSaveError(null);
        setSaveStatus("saved");
        setStorageReady(true);
      })
      .catch((error) => {
        applyLocalState(
          false,
          error instanceof Error ? error.message : initialDatabaseError
        );
      });

    return () => {
      cancelled = true;
    };
  }, [initialDatabaseError, initialSnapshot, setDatabaseAvailability]);

  // Резервная локальная копия + автосохранение полного снимка в БД.
  // 650 мс не отправляют запрос на каждую введённую цифру, но изменения
  // дней, зарплат, сотрудников и повторная генерация сохраняются одинаково.
  useEffect(() => {
    if (!storageReady) return;

    latestPayloadRef.current = { state, payOffset };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      localStorage.setItem(OFFSET_KEY, String(payOffset));
    } catch {
      /* localStorage недоступен — основной источник всё равно БД */
    }

    if (skipNextPersistenceRef.current) {
      skipNextPersistenceRef.current = false;
      return;
    }

    versionRef.current += 1;
    dirtyRef.current = true;
    if (!databaseEnabledRef.current) return;

    setSaveStatus("saving");
    setSaveError(null);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void drainSaveQueue();
    }, 650);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [state, payOffset, storageReady, drainSaveQueue]);

  /** После ошибки загрузки сначала перечитывает БД. После ошибки самого
   * сохранения повторяет PUT текущих правок, не откатывая их к старой БД. */
  const retryDatabase = useCallback(async () => {
    setSaveError(null);

    // База уже была успешно прочитана — ошибка возникла при записи/сети.
    // Повторяем именно несохранённый локальный снимок.
    if (canOverwriteDatabaseRef.current) {
      setDatabaseAvailability(true);
      setSaveStatus("saving");
      await drainSaveQueue();
      return;
    }

    setSaveStatus("loading");
    try {
      const snapshot = await readDatabaseSnapshot();
      if (snapshot) {
        const loadedState = normalizeStoredState(snapshot.state);
        const loadedOffset = normalizedOffset(snapshot.payOffset);
        skipNextPersistenceRef.current = true;
        dirtyRef.current = false;
        canOverwriteDatabaseRef.current = true;
        latestPayloadRef.current = {
          state: loadedState,
          payOffset: loadedOffset,
        };
        setState(loadedState);
        setPayOffsetState(loadedOffset);
        setDatabaseAvailability(true);
        setLastSavedAt(snapshot.updatedAt ?? null);
        setSaveStatus("saved");
        setStorageReady(true);
        return;
      }

      canOverwriteDatabaseRef.current = true;
      setDatabaseAvailability(true);
      versionRef.current += 1;
      dirtyRef.current = true;
      setSaveStatus("saving");
      await drainSaveQueue();
    } catch (error) {
      setDatabaseAvailability(false);
      setSaveStatus("error");
      setSaveError(
        error instanceof Error
          ? error.message
          : "Не удалось подключиться к базе табелей"
      );
    }
  }, [drainSaveQueue, setDatabaseAvailability]);

  // При закрытии вкладки пытаемся отправить последнюю правку без ожидания
  // debounce. keepalive позволяет браузеру закончить короткий PUT.
  useEffect(() => {
    const flushOnLeave = () => {
      if (
        !dirtyRef.current ||
        !databaseEnabledRef.current ||
        savingRef.current
      ) {
        return;
      }
      const payload = latestPayloadRef.current;
      void fetch("/api/admin/duty-schedule", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => undefined);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushOnLeave();
    };
    window.addEventListener("beforeunload", flushOnLeave);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", flushOnLeave);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      flushOnLeave();
    };
  }, []);

  const setPayOffset = useCallback((n: number) => {
    setPayOffsetState(normalizedOffset(n));
  }, []);

  // Месяц табеля = месяц навигации (сетка показывает именно его).
  const key = monthKey(year, month);
  const schedule = useMemo(
    () => fillMissingDays(state.schedules[key] ?? [], year, month),
    [state.schedules, key, year, month]
  );

  // Базовый месяц расчёта зп = месяц табеля − сдвиг.
  const basis = shiftMonth(year, month, -payOffset);
  const basisYear = basis.year;
  const basisMonth = basis.month;
  const basisKey = monthKey(basisYear, basisMonth);
  const basisSchedule = useMemo(
    () => fillMissingDays(state.schedules[basisKey] ?? [], basisYear, basisMonth),
    [state.schedules, basisKey, basisYear, basisMonth]
  );
  const basisAmountOverrides = useMemo(
    () => state.amountOverrides[basisKey] ?? {},
    [state.amountOverrides, basisKey]
  );

  const persistSchedule = useCallback(
    (newSchedule: DayAssignment[]) => {
      setState((prev) => ({
        ...prev,
        schedules: { ...prev.schedules, [key]: newSchedule },
      }));
    },
    [key]
  );

  const generate = useCallback(
    (startEmployeeId?: string) => {
      const rotating = state.employees.filter(
        (e) => e.role === "rotating" && e.active
      );
      let startId = startEmployeeId;
      if (!startId) {
        // Непрерывность очереди — от предыдущего месяца табеля.
        const prev = shiftMonth(year, month, -1);
        const prevKey = monthKey(prev.year, prev.month);
        const prevSchedule = state.schedules[prevKey];
        if (prevSchedule) {
          startId = getNextRotationStartId(prevSchedule, rotating);
        }
      }
      const generated = generateSchedule(year, month, state.employees, {
        rotatingStartEmployeeId: startId,
      });
      persistSchedule(generated);
      setMessage("Расписание сгенерировано автоматически");
    },
    [year, month, state.employees, state.schedules, persistSchedule]
  );

  const updateCell = useCallback(
    (date: string, patch: Partial<DayAssignment>) => {
      const exists = schedule.some((d) => d.date === date);
      const newSchedule = exists
        ? schedule.map((d) => (d.date === date ? { ...d, ...patch } : d))
        : [
            ...schedule,
            {
              date,
              weekday: new Date(date).getDay(),
              employeeId: null,
              hours: 0,
              status: "normal" as CellStatus,
              ...patch,
            },
          ];
      persistSchedule(newSchedule);
    },
    [schedule, persistSchedule]
  );

  const clearCell = useCallback(
    (date: string) => {
      updateCell(date, { employeeId: null, hours: 0, status: "normal" });
    },
    [updateCell]
  );

  const addEmployee = useCallback((emp: Omit<Employee, "id">) => {
    const id = "emp_" + Date.now().toString(36);
    setState((prev) => ({
      ...prev,
      employees: [...prev.employees, { ...emp, id }],
    }));
  }, []);

  const updateEmployee = useCallback((id: string, patch: Partial<Employee>) => {
    setState((prev) => ({
      ...prev,
      employees: prev.employees.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }));
  }, []);

  const removeEmployee = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      employees: prev.employees.filter((e) => e.id !== id),
    }));
  }, []);

  // ── Ручные суммы месяца табеля (перекрывают «часы × ставку» в сетке) ──
  const amountOverrides = useMemo(
    () => state.amountOverrides[key] ?? {},
    [state.amountOverrides, key]
  );

  const setAmountOverride = useCallback(
    (employeeId: string, value: number | null) => {
      setState((prev) => {
        const forMonth = { ...(prev.amountOverrides[key] ?? {}) };
        if (value == null || Number.isNaN(value) || value <= 0) {
          delete forMonth[employeeId];
        } else {
          forMonth[employeeId] = Math.round(value);
        }
        return {
          ...prev,
          amountOverrides: { ...prev.amountOverrides, [key]: forMonth },
        };
      });
    },
    [key]
  );

  // ── Начисления зп за период: кто и сколько ──

  /** Начисления периода. Если ещё не задавались — расчёт по табелю
   *  (все активные охранники). Пустой список = всех убрали из зп. */
  const getAccrualsFor = useCallback(
    (periodKey: string): SalaryAccrual[] => {
      const stored = state.salaryAccruals?.[periodKey];
      if (stored != null) return stored;
      return defaultAccruals(state.employees);
    },
    [state.salaryAccruals, state.employees]
  );

  /** Ручная итоговая сумма зп человека за период.
   *  null — считать по табелю (часы × ставка базового месяца). */
  const setAccrualAmount = useCallback(
    (periodKey: string, accrualId: string, amount: number | null) => {
      setState((prev) => {
        const list = accrualsToWrite(prev, periodKey).map((a) =>
          a.id === accrualId
            ? {
                ...a,
                amount:
                  amount == null
                    ? null
                    : Math.max(0, Math.round(Number(amount) || 0)),
              }
            : a
        );
        return {
          ...prev,
          salaryAccruals: { ...prev.salaryAccruals, [periodKey]: list },
        };
      });
    },
    []
  );

  /** Переименовать вручную добавленного человека (его выплаты
   *  за этот период переименовываются вместе с ним). */
  const setAccrualName = useCallback(
    (periodKey: string, accrualId: string, newName: string) => {
      const clean = newName.trim();
      setState((prev) => {
        const current = accrualsToWrite(prev, periodKey);
        const target = current.find((a) => a.id === accrualId);
        if (!target) return prev;
        // Ввод пустого имени — оставляем как есть.
        const list = current.map((a) =>
          a.id === accrualId ? { ...a, employeeName: clean || a.employeeName } : a
        );
        if (clean) {
          const payouts = (prev.salaryPayouts?.[periodKey] ?? []).map((p) =>
            isSamePayoutPerson(p, target)
              ? { ...p, employeeName: clean }
              : p
          );
          return {
            ...prev,
            salaryAccruals: { ...prev.salaryAccruals, [periodKey]: list },
            salaryPayouts: { ...prev.salaryPayouts, [periodKey]: payouts },
          };
        }
        return {
          ...prev,
          salaryAccruals: { ...prev.salaryAccruals, [periodKey]: list },
        };
      });
    },
    []
  );

  /** Добавить человека в зп за период: из табеля (по id) или любого
   *  другого (имя вручную). */
  const addAccrualPerson = useCallback(
    (
      periodKey: string,
      employeeId: string,
      employeeName: string,
      amount?: number
    ) => {
      setState((prev) => {
        const list = accrualsToWrite(prev, periodKey);
        const emp =
          employeeId && employeeId !== "custom"
            ? prev.employees.find((e) => e.id === employeeId)
            : undefined;
        const name = emp ? emp.name : employeeName.trim();
        if (emp && list.some((a) => a.id === emp.id)) {
          return prev;
        }
        if (
          !emp &&
          name.length > 0 &&
          list.some((a) => a.employeeName.trim().toLowerCase() === name.toLowerCase())
        ) {
          return prev;
        }
        const entry: SalaryAccrual = {
          id: emp ? emp.id : `acc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          employeeId: emp ? emp.id : "custom",
          employeeName: name,
          amount:
            amount != null
              ? Math.max(0, Math.round(amount))
              : emp
                ? null
                : 0,
        };
        return {
          ...prev,
          salaryAccruals: {
            ...prev.salaryAccruals,
            [periodKey]: [...list, entry],
          },
        };
      });
    },
    []
  );

  /** Убрать человека из зп за период: удаляется начисление И все его
   *  выплаты. В табеле дежурств человек остаётся — это разные системы. */
  const removeAccrual = useCallback(
    (periodKey: string, accrualId: string) => {
      setState((prev) => {
        const current = accrualsToWrite(prev, periodKey);
        const target = current.find((a) => a.id === accrualId);
        if (!target) return prev;
        const accruals = current.filter((a) => a.id !== accrualId);
        const payouts = (prev.salaryPayouts?.[periodKey] ?? []).filter(
          (p) => !isSamePayoutPerson(p, target)
        );
        return {
          ...prev,
          salaryAccruals: { ...prev.salaryAccruals, [periodKey]: accruals },
          salaryPayouts: { ...prev.salaryPayouts, [periodKey]: payouts },
        };
      });
    },
    []
  );

  /** Вернуть всех активных охранников по табелю (суммы — расчётные,
   *  ручные правки и добавленные люди сбрасываются). */
  const resetAccrualsToTimesheet = useCallback((periodKey: string) => {
    setState((prev) => ({
      ...prev,
      salaryAccruals: {
        ...prev.salaryAccruals,
        [periodKey]: defaultAccruals(prev.employees),
      },
    }));
    setMessage("Начисления восстановлены по табелю");
  }, []);

  // ── Выплаты зарплаты по дням (кто и когда получает деньги) ──

  /** Список выплат за период. Пустой, если ещё ничего не задано, —
   *  дни и суммы указывает пользователь. */
  const getPayoutsFor = useCallback(
    (payPeriodKey: string): SalaryPayout[] => {
      return state.salaryPayouts?.[payPeriodKey] ?? [];
    },
    [state.salaryPayouts]
  );

  /** Сохранить список выплат за период */
  const setSalaryPayouts = useCallback(
    (payPeriodKey: string, payouts: SalaryPayout[]) => {
      setState((prev) => ({
        ...prev,
        salaryPayouts: {
          ...prev.salaryPayouts,
          [payPeriodKey]: payouts,
        },
      }));
    },
    []
  );

  /** Добавить новую строку выплаты */
  const addPayout = useCallback(
    (payPeriodKey: string, partial?: Partial<SalaryPayout>) => {
      setState((prev) => {
        const currentList = prev.salaryPayouts?.[payPeriodKey] ?? [];
        const [y, m] = payPeriodKey.split("-").map(Number);
        const defDate = y && m ? lastDayOfMonth(y, m) : `${payPeriodKey}-25`;
        const defaultEmp = prev.employees.find((e) => e.active) || prev.employees[0];
        const empId = partial?.employeeId || defaultEmp?.id || "custom";
        const empName =
          partial?.employeeName ||
          prev.employees.find((e) => e.id === empId)?.name ||
          "";

        const newEntry: SalaryPayout = {
          id: `pay_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          employeeId: empId,
          employeeName: empName,
          date: partial?.date || defDate,
          amount: partial?.amount != null ? Math.max(0, Math.round(partial.amount)) : 0,
          comment: partial?.comment || "",
        };

        return {
          ...prev,
          salaryPayouts: {
            ...prev.salaryPayouts,
            [payPeriodKey]: [...currentList, newEntry],
          },
        };
      });
    },
    []
  );

  /** Добавить выплату конкретному человеку (день и сумму задаёт пользователь) */
  const addPayoutForEmployee = useCallback(
    (
      payPeriodKey: string,
      employeeId: string,
      employeeName?: string,
      initialAmount?: number,
      initialDate?: string
    ) => {
      setState((prev) => {
        const currentList = prev.salaryPayouts?.[payPeriodKey] ?? [];
        const emp = prev.employees.find((e) => e.id === employeeId);
        const empName =
          employeeName?.trim() || (emp ? emp.name : "") || "Сотрудник";
        const [y, m] = payPeriodKey.split("-").map(Number);
        const defDate =
          initialDate || (y && m ? lastDayOfMonth(y, m) : `${payPeriodKey}-25`);

        const newEntry: SalaryPayout = {
          id: `pay_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          employeeId,
          employeeName: empName,
          date: defDate,
          amount:
            initialAmount != null ? Math.max(0, Math.round(initialAmount)) : 0,
          comment: "",
        };

        return {
          ...prev,
          salaryPayouts: {
            ...prev.salaryPayouts,
            [payPeriodKey]: [...currentList, newEntry],
          },
        };
      });
    },
    []
  );

  /** Изменить строку выплаты (сотрудник, дата, сумма, комментарий) */
  const updatePayout = useCallback(
    (payPeriodKey: string, id: string, patch: Partial<SalaryPayout>) => {
      setState((prev) => {
        const currentList = prev.salaryPayouts?.[payPeriodKey] ?? [];

        const updated = currentList.map((item) => {
          if (item.id !== id) return item;
          const next = { ...item, ...patch };
          // При смене employeeId обновляем имя, если это известный сотрудник
          if (
            patch.employeeId &&
            patch.employeeId !== "custom" &&
            !patch.employeeName
          ) {
            const foundEmp = prev.employees.find(
              (e) => e.id === patch.employeeId
            );
            if (foundEmp) next.employeeName = foundEmp.name;
          }
          if (patch.amount != null) {
            next.amount = Math.max(0, Math.round(Number(patch.amount) || 0));
          }
          return next;
        });

        return {
          ...prev,
          salaryPayouts: {
            ...prev.salaryPayouts,
            [payPeriodKey]: updated,
          },
        };
      });
    },
    []
  );

  /** Удалить строку выплаты */
  const removePayout = useCallback(
    (payPeriodKey: string, id: string) => {
      setState((prev) => {
        const currentList = prev.salaryPayouts?.[payPeriodKey] ?? [];
        return {
          ...prev,
          salaryPayouts: {
            ...prev.salaryPayouts,
            [payPeriodKey]: currentList.filter((item) => item.id !== id),
          },
        };
      });
    },
    []
  );

  /** Разбить выплату на две части (например, пополам на разные дни) */
  const splitPayout = useCallback(
    (payPeriodKey: string, id: string) => {
      setState((prev) => {
        const currentList = prev.salaryPayouts?.[payPeriodKey] ?? [];
        const target = currentList.find((item) => item.id === id);
        if (!target) return prev;

        const half1 = Math.floor(target.amount / 2);
        const half2 = target.amount - half1;

        const [y, m] = payPeriodKey.split("-").map(Number);
        const defDate = y && m ? lastDayOfMonth(y, m) : target.date;

        const updated: SalaryPayout[] = [];
        for (const item of currentList) {
          if (item.id === id) {
            updated.push({
              ...item,
              amount: half1,
              comment: item.comment || "Выплата 1",
            });
            updated.push({
              id: `pay_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              employeeId: target.employeeId,
              employeeName: target.employeeName,
              date: defDate,
              amount: half2,
              comment: "Выплата 2",
            });
          } else {
            updated.push(item);
          }
        }

        return {
          ...prev,
          salaryPayouts: {
            ...prev.salaryPayouts,
            [payPeriodKey]: updated,
          },
        };
      });
    },
    []
  );

  /** Заполнить выплаты по начислению — по 1 строке на человека из
   *  списка начислений (ручная сумма, а если не задана — расчёт по
   *  табелю базового месяца), день — последний день периода. */
  const fillPayoutsFromAccruals = useCallback(
    (payPeriodKey: string, basisMonthKey: string) => {
      setState((prev) => {
        const accruals = accrualsToWrite(prev, payPeriodKey);
        const [by, bm] = basisMonthKey.split("-").map(Number);
        const sched = fillMissingDays(
          prev.schedules[basisMonthKey] ?? [],
          by || new Date().getFullYear(),
          bm || 1
        );
        const overrides = prev.amountOverrides[basisMonthKey] ?? {};
        const [y, m] = payPeriodKey.split("-").map(Number);
        const defDate =
          y && m ? lastDayOfMonth(y, m) : `${payPeriodKey}-25`;

        const rows: SalaryPayout[] = accruals.map((a) => {
          const emp =
            a.employeeId && a.employeeId !== "custom"
              ? prev.employees.find((e) => e.id === a.employeeId)
              : undefined;
          let amount = a.amount;
          if (amount == null) {
            if (emp) {
              const hours = hoursInSchedule(sched, emp.id);
              amount = overrides[emp.id] ?? Math.round(hours * emp.rate);
            } else {
              amount = 0;
            }
          }
          return {
            id: `pay_${payPeriodKey}_${a.employeeId}_${Math.random()
              .toString(36)
              .slice(2, 7)}`,
            employeeId: a.employeeId,
            employeeName: a.employeeName,
            date: defDate,
            amount: Math.max(0, Math.round(amount || 0)),
            comment: "",
          };
        });

        return {
          ...prev,
          salaryPayouts: {
            ...prev.salaryPayouts,
            [payPeriodKey]: rows,
          },
        };
      });
      setMessage("Выплаты заполнены по начислению");
    },
    []
  );

  const goToPrevMonth = () => {
    const prev = shiftMonth(year, month, -1);
    setYear(prev.year);
    setMonth(prev.month);
  };
  const goToNextMonth = () => {
    const next = shiftMonth(year, month, 1);
    setYear(next.year);
    setMonth(next.month);
  };

  return {
    // Состояние постоянного хранилища
    storageReady,
    databaseEnabled,
    saveStatus,
    saveError,
    lastSavedAt,
    retryDatabase,
    // Месяц табеля = месяц навигации (сетка, генерация, печать)
    year,
    month,
    setYear,
    setMonth,
    goToPrevMonth,
    goToNextMonth,
    // Базовый месяц расчёта зп = месяц − сдвиг
    basisYear,
    basisMonth,
    basisKey,
    basisSchedule,
    basisAmountOverrides,
    // Сдвиг расчёта зп, месяцев (0 = месяц в месяц)
    payOffset,
    setPayOffset,
    employees: state.employees,
    addEmployee,
    updateEmployee,
    removeEmployee,
    schedule,
    generate,
    updateCell,
    clearCell,
    amountOverrides,
    setAmountOverride,
    // Начисления (кто и сколько)
    getAccrualsFor,
    setAccrualAmount,
    setAccrualName,
    addAccrualPerson,
    removeAccrual,
    resetAccrualsToTimesheet,
    // Выплаты по дням
    getPayoutsFor,
    setSalaryPayouts,
    addPayout,
    addPayoutForEmployee,
    updatePayout,
    removePayout,
    splitPayout,
    fillPayoutsFromAccruals,
    message,
    setMessage,
  };
}
