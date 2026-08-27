// =========================================================
// FILE: src/lib/notification-sound.ts
// Звук уведомления о новой заявке.
//
// Синтезируем через WebAudio, а не грузим mp3: не нужен бинарник в репозитории,
// звук мгновенный (не ждёт загрузки файла) и не глушится блокировщиками.
//
// Про автоплей: браузеры не дают проигрывать звук, пока пользователь хоть раз
// не взаимодействовал со страницей. Поэтому AudioContext создаётся заранее,
// а первый же клик/нажатие клавиши его «размораживает». Пока этого не
// произошло, isSoundBlocked() === true — интерфейс показывает кнопку
// «Включить звук».
// =========================================================

"use client";

const STORAGE_KEY = "sgt-admin-sound-enabled";

let ctx: AudioContext | null = null;
let unlockBound = false;
let blockedListeners = new Set<(blocked: boolean) => void>();

function notifyBlocked() {
  const blocked = isSoundBlocked();
  for (const listener of blockedListeners) {
    try {
      listener(blocked);
    } catch {
      /* ignore */
    }
  }
}

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  const Ctor: typeof AudioContext | undefined =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  return ctx;
}

/** Звук выключен пользователем? */
export function isSoundEnabled(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(STORAGE_KEY) !== "off";
}

export function setSoundEnabled(enabled: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
  if (enabled) void unlockSound();
  notifyBlocked();
}

/** Браузер ещё не разрешил звук (не было взаимодействия со страницей)? */
export function isSoundBlocked(): boolean {
  if (!isSoundEnabled()) return false; // выключен осознанно — это не блокировка
  const audio = getCtx();
  return !!audio && audio.state === "suspended";
}

export function onSoundBlockedChange(listener: (blocked: boolean) => void): () => void {
  blockedListeners.add(listener);
  listener(isSoundBlocked());
  return () => {
    blockedListeners.delete(listener);
  };
}

/** Разблокировать звук (вызывать из обработчика реального действия пользователя). */
export async function unlockSound(): Promise<boolean> {
  const audio = getCtx();
  if (!audio) return false;
  if (audio.state === "suspended") {
    try {
      await audio.resume();
    } catch {
      return false;
    }
  }
  notifyBlocked();
  return audio.state === "running";
}

/**
 * Вешает одноразовые слушатели, которые разморозят звук при первом же
 * действии пользователя на странице. Вызывать один раз при монтировании.
 */
export function bindSoundUnlock() {
  if (unlockBound || typeof window === "undefined") return;
  unlockBound = true;
  getCtx();
  const handler = () => {
    void unlockSound();
  };
  const opts = { passive: true } as AddEventListenerOptions;
  window.addEventListener("pointerdown", handler, opts);
  window.addEventListener("keydown", handler, opts);
  window.addEventListener("touchstart", handler, opts);
}

function tone(audio: AudioContext, freq: number, startAt: number, duration: number, gainValue: number) {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, startAt);

  // Мягкая огибающая: без неё синус щёлкает на старте и в конце.
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(gainValue, startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

/**
 * Сигнал новой заявки: короткий двухнотный «динь-дон».
 * urgent — три ноты и громче (несколько пропущенных заявок).
 * Возвращает true, если звук действительно прозвучал.
 */
export function playNotificationSound(urgent = false): boolean {
  if (!isSoundEnabled()) return false;
  const audio = getCtx();
  if (!audio) return false;
  if (audio.state === "suspended") {
    // Ещё не разрешено — покажем в интерфейсе кнопку.
    notifyBlocked();
    return false;
  }

  const now = audio.currentTime;
  const volume = urgent ? 0.22 : 0.16;
  tone(audio, 880, now, 0.16, volume);
  tone(audio, 1318.5, now + 0.16, 0.22, volume);
  if (urgent) tone(audio, 1760, now + 0.36, 0.26, volume);
  return true;
}
