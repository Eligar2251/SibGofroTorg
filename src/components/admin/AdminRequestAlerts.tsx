"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  BellRing,
  ClipboardList,
  Loader2,
  RefreshCw,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useAdminRealtime } from "@/lib/use-admin-realtime";
import {
  bindSoundUnlock,
  isSoundEnabled,
  onSoundBlockedChange,
  playNotificationSound,
  setSoundEnabled,
  unlockSound,
} from "@/lib/notification-sound";

type AlertItem = {
  id: string;
  title: string;
  description: string;
  href: string;
  createdAt?: string | null;
};

type AlertsResponse = {
  total: number;
  items: AlertItem[];
};

/**
 * Ключ «уже звонили по этой заявке».
 * Хранится в браузере, а не на сервере, намеренно: если менеджер открыл
 * админку на телефоне и на компьютере, на каждом устройстве он должен
 * услышать сигнал один раз.
 */
const SEEN_KEY = "sgt-admin-heard-requests";
const SEEN_LIMIT = 300;

function loadSeen(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

function saveSeen(ids: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    // Держим только хвост, иначе localStorage растёт бесконечно.
    const list = [...ids].slice(-SEEN_LIMIT);
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(list));
  } catch {
    /* приватный режим — переживём */
  }
}

function formatTime(raw?: string | null): string {
  if (!raw) return "";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function pluralRequests(n: number): string {
  const word =
    n % 10 === 1 && n % 100 !== 11
      ? "заявка"
      : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)
        ? "заявки"
        : "заявок";
  return `${n} ${word}`;
}

/**
 * Третий кружок рядом с планами поставок и срочными уведомлениями.
 * Показывает только необработанные заявки (status = new).
 *
 * Заявка приходит мгновенно (SSE-поток /api/admin/events) и сопровождается
 * звуком. Заявки, пришедшие пока админка была закрыта, тоже прозвенят при
 * следующем открытии: список «уже звонивших» id лежит в localStorage, и всё,
 * чего в нём нет, считается новым. Если браузер ещё не разрешил автоплей,
 * сигнал не теряется — он прозвучит после первого клика по странице.
 */
export function AdminRequestAlerts({ adminPath }: { adminPath: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<AlertsResponse>({ total: 0, items: [] });
  const [soundOn, setSoundOn] = useState(true);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const [toast, setToast] = useState<{ items: AlertItem[]; key: number } | null>(null);
  const [pulse, setPulse] = useState(false);

  const seenRef = useRef<Set<string>>(new Set());
  const initedRef = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    seenRef.current = loadSeen();
    setSoundOn(isSoundEnabled());
    bindSoundUnlock();
    return onSoundBlockedChange(setSoundBlocked);
  }, []);

  /** Отметить заявки как «услышанные». */
  const markHeard = useCallback((ids: string[]) => {
    if (!ids.length) return;
    for (const id of ids) seenRef.current.add(id);
    saveSeen(seenRef.current);
  }, []);

  const announce = useCallback(
    (fresh: AlertItem[]) => {
      if (!fresh.length) return;
      const played = playNotificationSound(fresh.length > 1);
      setPulse(true);
      window.setTimeout(() => setPulse(false), 2400);

      setToast({ items: fresh.slice(0, 4), key: Date.now() });
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 12_000);

      // Если звук заблокирован автоплеем — НЕ помечаем как услышанные:
      // сигнал должен прозвучать после первого взаимодействия со страницей,
      // иначе заявка тихо потеряется. А вот если звук выключен осознанно,
      // помечаем сразу — иначе при включении зазвонят все старые заявки.
      if (played || !isSoundEnabled()) markHeard(fresh.map((item) => item.id));
    },
    [markHeard]
  );

  const load = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/admin/notifications", { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "Не удалось загрузить заявки");

        // API уже отдаёт только status=new (и заказы, и макулатуру).
        const orderItems: AlertItem[] = (Array.isArray(body.items) ? body.items : [])
          .filter((item: { type?: string }) => item.type === "order")
          .map(
            (item: {
              id: string;
              title: string;
              description: string;
              href: string;
              createdAt?: string | null;
            }) => ({
              id: String(item.id),
              title: item.title,
              description: item.description,
              href: item.href,
              createdAt: item.createdAt,
            })
          );

        setData({ total: orderItems.length, items: orderItems });

        const fresh = orderItems.filter((item) => !seenRef.current.has(item.id));
        if (fresh.length) announce(fresh);
        initedRef.current = true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Ошибка заявок");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [announce]
  );

  // Первичная загрузка. Она же «догоняет» всё, что пришло, пока админка
  // была закрыта, — по ней и звенит сигнал за пропущенные заявки.
  useEffect(() => {
    load();
  }, [load]);

  // Мгновенная доставка: заявка с сайта → INSERT в orders/wastepaper_requests
  // → событие в SSE-потоке → перезагрузка списка → звук.
  useAdminRealtime({
    tables: ["orders", "wastepaper_requests"],
    manual: true,
    pollIntervalMs: 60_000,
    onUpdate: useCallback(() => {
      load(true);
    }, [load]),
  });

  // Запасной опрос — на случай, если поток недоступен.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!document.hidden) load(true);
    }, 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  // Если звук был заблокирован автоплеем, а пользователь наконец кликнул —
  // догоняем сигнал по всё ещё неуслышанным заявкам.
  useEffect(() => {
    if (soundBlocked || !initedRef.current) return;
    const pending = data.items.filter((item) => !seenRef.current.has(item.id));
    if (!pending.length) return;
    if (!isSoundEnabled()) {
      markHeard(pending.map((item) => item.id));
      return;
    }
    if (playNotificationSound(pending.length > 1)) {
      markHeard(pending.map((item) => item.id));
    }
  }, [soundBlocked, data.items, markHeard]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Открыли панель — значит увидел глазами, звонить повторно не нужно.
  useEffect(() => {
    if (!open) return;
    markHeard(data.items.map((item) => item.id));
    setToast(null);
  }, [open, data.items, markHeard]);

  const summary = useMemo(() => {
    if (!data.total) return "Новых заявок нет";
    return `${pluralRequests(data.total)} ждут обработки`;
  }, [data.total]);

  function toggleSound() {
    const next = !soundOn;
    setSoundOn(next);
    setSoundEnabled(next);
    if (next) void unlockSound();
  }

  return (
    <div className="admin-requests-shortcut">
      <button
        type="button"
        className={`admin-notify__btn admin-requests-shortcut__btn${
          data.total > 0 ? " admin-requests-shortcut__btn--active" : ""
        }`}
        onClick={() => {
          void unlockSound();
          setOpen((v) => !v);
        }}
        aria-label="Необработанные заявки"
        title={
          soundBlocked
            ? "Необработанные заявки. Нажмите, чтобы включить звук уведомлений"
            : "Необработанные заявки"
        }
        style={pulse ? { animation: "sgtRingPulse 0.7s ease-in-out 3" } : undefined}
      >
        {loading ? (
          <Loader2 size={18} className="animate-spin" />
        ) : pulse ? (
          <BellRing size={18} />
        ) : (
          <ClipboardList size={18} />
        )}
        {data.total > 0 && (
          <span className="admin-notify__badge admin-requests-shortcut__badge">
            {data.total > 99 ? "99+" : data.total}
          </span>
        )}
      </button>

      {/* Всплывающее окно о новой заявке — видно, даже если панель закрыта */}
      {toast && (
        <div
          key={toast.key}
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            right: 16,
            bottom: 16,
            zIndex: 1200,
            width: "min(340px, calc(100vw - 32px))",
            background: "var(--adm-card, #fff)",
            color: "var(--adm-ink, #111)",
            border: "1px solid var(--adm-border, #e5e7eb)",
            borderLeft: "4px solid #16a34a",
            borderRadius: 12,
            boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
            padding: 14,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <BellRing size={16} style={{ color: "#16a34a", flexShrink: 0 }} />
            <strong style={{ fontSize: 14 }}>
              {toast.items.length > 1
                ? `Новые заявки: ${toast.items.length}`
                : "Новая заявка"}
            </strong>
            <button
              type="button"
              onClick={() => setToast(null)}
              aria-label="Закрыть"
              style={{
                marginLeft: "auto",
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "inherit",
                opacity: 0.6,
                lineHeight: 0,
              }}
            >
              <X size={14} />
            </button>
          </div>
          {toast.items.map((item) => (
            <Link
              key={item.id}
              href={item.href || `/${adminPath}/orders?status=new`}
              prefetch={false}
              onClick={() => setToast(null)}
              style={{
                display: "block",
                fontSize: 12.5,
                lineHeight: 1.35,
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <span style={{ fontWeight: 600 }}>{item.title}</span>
              <br />
              <span style={{ opacity: 0.75 }}>{item.description}</span>
            </Link>
          ))}
          {soundBlocked && (
            <button
              type="button"
              onClick={() => void unlockSound()}
              className="admin-btn admin-btn--ghost admin-btn--sm"
              style={{ alignSelf: "flex-start" }}
            >
              <Volume2 size={13} /> Включить звук
            </button>
          )}
        </div>
      )}

      {open && (
        <div className="admin-notify__panel admin-requests-shortcut__panel">
          <div className="admin-notify__head">
            <div>
              <div className="admin-notify__title">Новые заявки</div>
              <div className="admin-notify__sub">{summary}</div>
            </div>
            <div className="admin-notify__actions">
              <button
                type="button"
                onClick={toggleSound}
                className="admin-notify__iconbtn"
                title={soundOn ? "Выключить звук уведомлений" : "Включить звук уведомлений"}
              >
                {soundOn ? <Volume2 size={14} /> : <VolumeX size={14} />}
              </button>
              <button
                type="button"
                onClick={() => load(true)}
                disabled={refreshing}
                className="admin-notify__iconbtn"
                title="Обновить"
              >
                {refreshing ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <RefreshCw size={14} />
                )}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="admin-notify__iconbtn"
                title="Закрыть"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {soundBlocked && (
            <button
              type="button"
              onClick={() => void unlockSound()}
              className="admin-notify__error"
              style={{ width: "100%", textAlign: "left", cursor: "pointer" }}
            >
              Браузер пока не разрешил звук. Нажмите здесь, чтобы включить сигнал
              о новых заявках.
            </button>
          )}

          {error && <div className="admin-notify__error">{error}</div>}

          {data.items.length === 0 && !loading ? (
            <div className="admin-notify__empty">
              <ClipboardList size={22} />
              <span>Необработанных заявок нет</span>
            </div>
          ) : (
            <div className="admin-notify__list">
              {data.items.map((item) => (
                <Link
                  key={item.id}
                  href={item.href || `/${adminPath}/orders?status=new`}
                  prefetch={false}
                  className="admin-notify__item admin-notify__item--warning"
                  onClick={() => setOpen(false)}
                >
                  <span className="admin-notify__item-icon">
                    <ClipboardList size={15} />
                  </span>
                  <span className="admin-notify__item-main">
                    <span className="admin-notify__item-title">{item.title}</span>
                    <span className="admin-notify__item-desc">
                      {item.description}
                    </span>
                  </span>
                  {item.createdAt && (
                    <span className="admin-notify__time">
                      {formatTime(item.createdAt)}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          )}

          <div className="admin-requests-shortcut__footer">
            <Link
              href={`/${adminPath}/orders?status=new`}
              prefetch={false}
              onClick={() => setOpen(false)}
            >
              Открыть все новые →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
