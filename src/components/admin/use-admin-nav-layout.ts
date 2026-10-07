// =========================================================
// FILE: src/components/admin/use-admin-nav-layout.ts
// Общее состояние раскладки меню: кэш в localStorage, чтобы
// группы не мигали при открытии, и запись в базу.
// =========================================================

"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  ADMIN_NAV_CATALOG,
  sanitizeNavLayout,
  type AdminNavLayout,
} from "@/lib/admin-nav";

const ALLOWED = ADMIN_NAV_CATALOG.map((item) => item.id);

type Snap = {
  username: string;
  layout: AdminNavLayout | null;
  ready: boolean;
  error: string | null;
  saving: boolean;
};

let snap: Snap = {
  username: "",
  layout: null,
  ready: false,
  error: null,
  saving: false,
};

const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;

function emit(patch: Partial<Snap>) {
  snap = { ...snap, ...patch };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnap() {
  return snap;
}

function cacheKey(username: string) {
  return `admin-nav-layout:${username}`;
}

function readCache(username: string): AdminNavLayout | null {
  try {
    const raw = localStorage.getItem(cacheKey(username));
    if (!raw) return null;
    return sanitizeNavLayout(JSON.parse(raw), ALLOWED);
  } catch {
    return null;
  }
}

function writeCache(username: string, layout: AdminNavLayout | null) {
  try {
    if (!layout) localStorage.removeItem(cacheKey(username));
    else localStorage.setItem(cacheKey(username), JSON.stringify(layout));
  } catch {
    /* приватный режим — меню всё равно сохранится в базе */
  }
}

async function refresh(username: string) {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/admin/nav-layout", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Не удалось загрузить меню");
      if (snap.username !== username) return;
      const layout = body.layout ? sanitizeNavLayout(body.layout, ALLOWED) : null;
      writeCache(username, layout);
      emit({ layout, ready: true, error: null });
    } catch (error) {
      if (snap.username !== username) return;
      emit({
        ready: true,
        error: error instanceof Error ? error.message : "Не удалось загрузить меню",
      });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function ensure(username: string) {
  if (!username) return;
  if (snap.username === username && (snap.ready || inflight)) return;
  const cached = typeof window !== "undefined" ? readCache(username) : null;
  emit({
    username,
    layout: cached,
    ready: false,
    error: null,
    saving: false,
  });
  void refresh(username);
}

export function useAdminNavLayout(username: string) {
  const state = useSyncExternalStore(subscribe, getSnap, getSnap);

  useEffect(() => {
    if (username) ensure(username);
  }, [username]);

  const save = useCallback(
    async (layout: AdminNavLayout) => {
      emit({ saving: true, error: null });
      try {
        const res = await fetch("/api/admin/nav-layout", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ layout }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "Не удалось сохранить меню");
        const saved = sanitizeNavLayout(body.layout, ALLOWED) || layout;
        writeCache(username, saved);
        emit({ layout: saved, saving: false, ready: true, error: null });
        return saved;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Не удалось сохранить меню";
        emit({ saving: false, error: message });
        throw error;
      }
    },
    [username],
  );

  const reset = useCallback(async () => {
    emit({ saving: true, error: null });
    try {
      const res = await fetch("/api/admin/nav-layout", { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Не удалось сбросить меню");
      writeCache(username, null);
      emit({ layout: null, saving: false, ready: true, error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось сбросить меню";
      emit({ saving: false, error: message });
      throw error;
    }
  }, [username]);

  const active = Boolean(username) && state.username === username;
  return {
    layout: active ? state.layout : null,
    ready: active ? state.ready : false,
    error: active ? state.error : null,
    saving: active ? state.saving : false,
    save,
    reset,
  };
}
