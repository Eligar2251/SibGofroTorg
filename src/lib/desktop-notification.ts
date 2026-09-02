// =========================================================
// FILE: src/lib/desktop-notification.ts
// Системное уведомление о новой заявке (Notification API).
//
// ЗАЧЕМ. Звук и всплывающая карточка помогают, только когда вкладка админки
// на экране. В реальной работе она почти всегда свёрнута или перекрыта
// другим окном, а браузеры вдобавок душат таймеры и звук в фоновых вкладках.
// Системное уведомление показывается поверх всего, даже когда браузер
// свёрнут, — это и есть «не пропустить заявку».
//
// Разрешение НЕ запрашиваем при загрузке страницы: непрошеный запрос
// пользователи почти всегда отклоняют, а отказ в Chrome необратим до ручной
// правки настроек сайта. Спрашиваем только по явному действию — когда
// менеджер включает звук уведомлений.
//
// Всё внутри обёрнуто в try/catch и проверки поддержки: на HTTP (не HTTPS),
// в старых браузерах и в iOS Safari вне PWA Notification недоступен, и это
// не должно ломать колокольчик.
// =========================================================

"use client";

const STORAGE_KEY = "sgt-admin-desktop-notify";

/** Поддерживает ли браузер системные уведомления. */
export function isDesktopNotifySupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/** Разрешение уже выдано? */
export function isDesktopNotifyGranted(): boolean {
  if (!isDesktopNotifySupported()) return false;
  try {
    return Notification.permission === "granted";
  } catch {
    return false;
  }
}

/** Пользователь не отключал их у нас в интерфейсе? */
export function isDesktopNotifyEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) !== "off";
}

export function setDesktopNotifyEnabled(enabled: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
}

/**
 * Запросить разрешение. Вызывать ТОЛЬКО из обработчика реального действия
 * пользователя (клик), иначе браузер отклонит запрос молча.
 */
export async function requestDesktopNotifyPermission(): Promise<boolean> {
  if (!isDesktopNotifySupported()) return false;
  try {
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    const result = await Notification.requestPermission();
    return result === "granted";
  } catch {
    return false;
  }
}

/**
 * Показать уведомление о заявке.
 * Ничего не делает, если вкладка на экране (там уже есть звук и карточка),
 * разрешения нет или пользователь их отключил.
 */
export function showDesktopNotification(input: {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}): boolean {
  if (!isDesktopNotifyGranted() || !isDesktopNotifyEnabled()) return false;
  // Вкладка активна — системное окно будет лишним раздражителем.
  if (typeof document !== "undefined" && !document.hidden) return false;

  try {
    const notification = new Notification(input.title, {
      body: input.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      // tag схлопывает повторы по одной заявке в одно окно
      tag: input.tag || "sgt-request",
      requireInteraction: false,
    });
    notification.onclick = () => {
      try {
        window.focus();
        if (input.url) window.location.href = input.url;
        notification.close();
      } catch {
        /* ignore */
      }
    };
    return true;
  } catch {
    return false;
  }
}
