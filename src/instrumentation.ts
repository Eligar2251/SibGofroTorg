// =========================================================
// FILE: src/instrumentation.ts
// Хук старта сервера Next.js: поднимает фоновый планировщик
// автоматического резервного копирования БД (каждые 2–3 минуты)
// сразу при запуске приложения, чтобы копии сохранялись на диск 24/7
// даже когда в браузере не открыта ни одна вкладка админки.
// =========================================================

export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NODE_ENV !== "test"
  ) {
    const { ensureAutoBackupSchedulerStarted } = await import(
      "./lib/auto-backup-scheduler"
    );
    ensureAutoBackupSchedulerStarted();
    const { ensureFullBackupSchedulerStarted } = await import("./lib/full-backup");
    ensureFullBackupSchedulerStarted();
  }
}
